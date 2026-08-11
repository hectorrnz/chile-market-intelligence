// R13.R1 § 10/§ 11 — historical portfolio publication backfill.
//
// SERVER-SIDE CLI ONLY. Lives outside src/app, so it is not part of the Next.js
// router and cannot be reached over HTTP — the same property that makes
// scripts/admin/setUserRole.ts safe. There is deliberately NO route, server
// action or browser control that backfills history.
//
// WHAT IT DOES
//   Publishes the historical RESUMEN weeks that genuinely qualify, through the
//   EXISTING publication architecture: the real parser, the real normalization,
//   the real `nmi_publish_portfolio` transaction. It supplies no financial value
//   of its own — every figure is re-parsed here from the stored workbook, whose
//   SHA-256 is re-verified first, exactly as the publish route does.
//
// WHICH WEEKS QUALIFY (§ 8/§ 10)
//   Only a week whose FULL parse is clean: every required cell present, the
//   hierarchy unambiguous, and both Main performance blocks bound to exactly one
//   total each. R13.R1's inventory found the source maintains that completeness
//   only for its most recent weeks; the earlier two years carry the total-level
//   series (which § 9 persists separately) but not a publishable row-level
//   snapshot. A week that does not parse cleanly is REPORTED AND SKIPPED —
//   never published with substituted or carried-forward values, and never
//   approximated from a neighbouring week.
//
// IDEMPOTENT
//   Each week is its own `(upload_kind, as_of_date)` series, so a backfilled
//   week never supersedes another week — least of all the current one. Re-running
//   is safe: the database's own duplicate-submission guard refuses a republish of
//   the same upload at the same parser version, which this script reports as
//   `already_published` rather than treating as a failure.
//
// USAGE — plain `node` (Node 24 strips TypeScript types natively), never `npx tsx`.
//
//   node scripts/admin/backfillPortfolioHistory.ts --list
//   node scripts/admin/backfillPortfolioHistory.ts --actor <admin-username> --write
//   node scripts/admin/backfillPortfolioHistory.ts --actor <admin> --max 3 --write
//
//   Dry-run is the DEFAULT: without --write nothing is published.
//
// SAFETY
//   · never logs a service-role key, a Supabase URL, an email or a password
//   · never prints a portfolio amount — counts, dates and row types only
//   · requires an explicitly named APPROVED ADMINISTRATOR actor to write
//   · re-verifies the stored object's digest before parsing (TOCTOU)
//   · refuses to touch a week that already has a current publication from a
//     DIFFERENT upload — that is a real conflict for a human to resolve
//   · fails closed on every unexpected state

// @next/env is CJS — import via default (the pattern every other script uses).
import pkg from '@next/env'
import { createHash } from 'node:crypto'
import { parseResumen, RESUMEN_PARSER_VERSION } from '../../src/lib/familyPortfolio/resumen/parseResumen.ts'
import {
  findPublishableHistoricalColumns,
  extractEvolutionHistory,
} from '../../src/lib/familyPortfolio/resumen/evolutionHistory.ts'

pkg.loadEnvConfig(process.cwd())

interface Args {
  actor: string
  list: boolean
  write: boolean
  max: number
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { actor: '', list: false, write: false, max: Number.POSITIVE_INFINITY }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') args.list = true
    else if (a === '--write') args.write = true
    else if (a === '--actor') args.actor = (argv[++i] ?? '').trim()
    else if (a === '--max') {
      const n = Number(argv[++i])
      if (Number.isInteger(n) && n > 0) args.max = n
    }
  }
  return args
}

function die(message: string): never {
  console.error(`✖ ${message}`)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (!url || !key) die('Supabase is not configured in this environment.')

const { createClient } = await import('@supabase/supabase-js')
const admin = createClient(url, key, { auth: { persistSession: false } })

// ── 1. Locate the portfolio upload whose bytes the history comes from ─────────
const uploadRes = await admin
  .from('portfolio_source_uploads')
  .select('id, original_filename, file_sha256, storage_object_path, uploaded_at')
  .eq('upload_kind', 'portfolio')
  .order('uploaded_at', { ascending: false })
  .limit(1)
  .maybeSingle()
if (uploadRes.error) die(`could not read the upload ledger: ${uploadRes.error.message}`)
if (!uploadRes.data) die('no portfolio upload exists — upload a RESUMEN workbook first.')
const upload = uploadRes.data as {
  id: string
  original_filename: string
  file_sha256: string
  storage_object_path: string
  uploaded_at: string
}

// A blocking finding on the upload invalidates the whole dataset (doc 02 § 6.3),
// and `nmi_assert_publishable` would refuse anyway — say so up front.
const findingsRes = await admin
  .from('portfolio_upload_findings')
  .select('code')
  .eq('upload_id', upload.id)
  .eq('severity', 'blocking')
if (findingsRes.error) die(`could not read upload findings: ${findingsRes.error.message}`)
if ((findingsRes.data ?? []).length > 0) {
  die('the upload carries blocking findings — recalculate and re-upload rather than publishing around them.')
}

// ── 2. Re-download and re-verify the digest (TOCTOU, same as the publish route) ─
const dl = await admin.storage.from('portfolio-source-uploads').download(upload.storage_object_path)
if (dl.error || !dl.data) die(`could not download the stored workbook: ${dl.error?.message ?? 'no object'}`)
const bytes = Buffer.from(await dl.data.arrayBuffer())
if (createHash('sha256').update(bytes).digest('hex') !== upload.file_sha256) {
  die('source_digest_mismatch — the stored object does not match the upload record.')
}

console.log(`source        : ${upload.original_filename} (sha256 ${upload.file_sha256.slice(0, 12)}…, digest re-verified)`)
console.log(`parser        : ${RESUMEN_PARSER_VERSION}`)

// ── 3. Which historical weeks are genuinely publishable ───────────────────────
const publishable = findPublishableHistoricalColumns(bytes)
if (publishable.length === 0) die('no historical column parses cleanly — nothing can be backfilled.')

const existingRes = await admin
  .from('portfolio_publications')
  .select('as_of_date, revision, upload_id, parser_version')
  .eq('upload_kind', 'portfolio')
  .eq('is_current', true)
if (existingRes.error) die(`could not read the publication ledger: ${existingRes.error.message}`)
const existing = new Map(
  (existingRes.data ?? []).map((p) => [
    p.as_of_date as string,
    p as { as_of_date: string; revision: number; upload_id: string; parser_version: string },
  ]),
)

console.log(`\npublishable historical weeks: ${publishable.length}`)
for (const w of publishable) {
  const cur = existing.get(w.date)
  const state = !cur
    ? 'NEW'
    : cur.upload_id !== upload.id
      ? 'CONFLICT (current revision came from a different upload)'
      : cur.parser_version === RESUMEN_PARSER_VERSION
        ? `already_published (rev ${cur.revision}, same parser)`
        : `REPUBLISH (rev ${cur.revision} at ${cur.parser_version} → ${RESUMEN_PARSER_VERSION})`
  console.log(`  ${w.date}  col ${w.letter.padStart(3)}  rows ${w.rowCount}  perf ${w.performanceCount}  → ${state}`)
}

if (args.list || !args.write) {
  console.log('\nDRY RUN — nothing was published. Re-run with --actor <admin-username> --write to apply.')
  process.exit(0)
}

// ── 4. Resolve the administrator actor ────────────────────────────────────────
if (!args.actor) die('--write requires --actor <approved administrator username>.')
const actorRes = await admin
  .from('user_profiles')
  .select('id, username, role')
  .eq('username', args.actor)
  .maybeSingle()
if (actorRes.error) die(`could not resolve the actor: ${actorRes.error.message}`)
const actor = actorRes.data as { id: string; username: string | null; role: string } | null
if (!actor) die('the named actor does not exist.')
if (actor.role !== 'administrator') die('the named actor is not an administrator.')
if (!actor.username || actor.username.trim().length === 0) die('the named actor is not approved.')

// ── 5. Publish, one week at a time, through the real transaction ──────────────
let published = 0
let skipped = 0
let failed = 0

for (const week of publishable) {
  if (published >= args.max) break
  const cur = existing.get(week.date)
  if (cur && cur.upload_id !== upload.id) {
    console.log(`  ${week.date}  skipped — current revision came from a different upload`)
    skipped += 1
    continue
  }
  if (cur && cur.parser_version === RESUMEN_PARSER_VERSION) {
    console.log(`  ${week.date}  skipped — already published at this parser version`)
    skipped += 1
    continue
  }

  // The draft is re-parsed HERE from the verified bytes, for THIS column.
  const draft = parseResumen(bytes, { publicationColumnLetter: week.letter })
  if (!draft.ok) {
    console.log(`  ${week.date}  refused — parse is not clean (${draft.findings.filter((f) => f.severity === 'blocking').map((f) => f.code).join(', ')})`)
    failed += 1
    continue
  }
  if (draft.detectedAsOfDate !== week.date) {
    console.log(`  ${week.date}  refused — the parsed column reports ${draft.detectedAsOfDate}`)
    failed += 1
    continue
  }

  // Identical mapping to the publish route — the same fields, the same nulls.
  const rows = draft.rows.map((r) => ({
    scope: r.scope,
    row_key: r.rowKey,
    parent_row_key: r.parentRowKey,
    depth: r.depth,
    display_order: r.displayOrder,
    row_type: r.rowType,
    label_es: r.labelEs,
    label_en: null,
    currency: 'USD',
    value: r.value,
    value_class: r.valueClass,
    source_sheet: r.sourceSheet,
    source_cell: r.sourceCell,
    metadata: {
      sourceRow: r.sourceRow,
      previousValue: r.previousValue,
      beginningOfYearValue: r.beginningOfYearValue,
      difference: r.difference,
      differenceClass: r.differenceClass,
    },
  }))

  const performance = draft.performance.map((p) => ({
    scope: p.scope,
    basis: p.basis,
    metric: p.metric,
    value: p.sourceValue,
    value_class: p.valueClass,
    source_sheet: p.sourceSheet,
    source_cell: p.sourceCell,
    metadata: {
      sourceRow: p.sourceRow,
      boundRowKey: p.boundRowKey,
      boundSourceCell: p.boundSourceCell,
      crossChecks: p.crossChecks,
    },
  }))

  const { data, error } = await admin.rpc('nmi_publish_portfolio', {
    p_upload_id: upload.id,
    p_as_of_date: week.date,
    p_published_by: actor.id,
    p_parser_version: RESUMEN_PARSER_VERSION,
    p_rows: rows,
    p_performance: performance,
    p_admin_note:
      'R13.R1 historical backfill — published from the same verified workbook at its own historical column ' +
      `${week.letter}. Values are the source’s own for that week; nothing is carried forward or interpolated.`,
    p_metadata: {
      backfill: true,
      backfillStage: 'R13.R1',
      sourceColumnLetter: week.letter,
      detectedAsOfDate: draft.detectedAsOfDate,
      dateOverridden: false,
      previousWeekDate: draft.previousWeekDate,
      beginningOfYearDate: draft.beginningOfYearDate,
    },
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('publication_refused_duplicate_submission')) {
      console.log(`  ${week.date}  skipped — already published (duplicate-submission guard)`)
      skipped += 1
    } else {
      console.log(`  ${week.date}  FAILED — ${msg}`)
      failed += 1
    }
    continue
  }
  console.log(`  ${week.date}  published (${rows.length} rows, ${performance.length} performance) → ${String(data)}`)
  published += 1
}

console.log(`\npublished ${published} · skipped ${skipped} · failed ${failed}`)

// ── 6. The weekly evolution history (§ 9), refreshed once from the same bytes ──
//
// Whole-history, so it runs ONCE rather than per week. The bases are bound from
// the newest publishable column — the same reconciliation the publish route
// uses — and the values then come from every historical column, including the
// two years that cannot produce a publishable snapshot.
const evolution = extractEvolutionHistory(bytes, {
  bindingColumnLetter: publishable[publishable.length - 1].letter,
})
if (!evolution.ok) {
  console.log(
    `\nevolution history: NOT ingested — ${evolution.findings.map((f) => f.code).join(', ') || 'no observations'}`,
  )
} else {
  console.log(`\nevolution history`)
  console.log(`  historical columns : ${evolution.historicalDates.length}`)
  console.log(`  span               : ${evolution.historicalDates[0]} → ${evolution.historicalDates.at(-1)}`)
  console.log(`  cadence gaps (days): ${evolution.cadenceGapDays.join(', ')}`)
  for (const s of evolution.series) {
    console.log(
      `  ${s.basis.padEnd(22)} row ${String(s.sourceRow ?? '—').padStart(4)} “${s.boundRowLabel ?? '—'}” · ` +
        `${s.observationCount} observations · ${s.earliestDate ?? '—'} → ${s.latestDate ?? '—'} · ${s.gapDates.length} gaps`,
    )
  }

  const rows = evolution.observations.map((o) => ({
    scope: o.scope,
    basis: o.basis,
    observation_date: o.observationDate,
    value: o.value,
    currency: 'USD',
    source_upload_id: upload.id,
    source_sheet: o.sourceSheet,
    source_cell: o.sourceCell,
    source_row_label: o.sourceRowLabel,
    parser_version: evolution.parserVersion,
    extractor_version: evolution.extractorVersion,
    ingested_by: actor.id,
    metadata: {},
  }))

  const CHUNK = 250
  let written = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin
      .from('portfolio_evolution_observations')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'scope,basis,observation_date' })
    if (error) die(`evolution upsert failed: ${error.message}`)
    written += Math.min(CHUNK, rows.length - i)
  }
  console.log(`  upserted           : ${written} observations`)
}

if (failed > 0) process.exit(1)
