// R13.R2C § 15/§ 17 — one-time backfill of the PERSONAL weekly evolution series.
//
// SERVER-SIDE CLI ONLY. Lives outside src/app, so it is not part of the Next.js
// router and cannot be reached over HTTP — the same property that makes
// `backfillPortfolioHistory.ts` and `setUserRole.ts` safe. There is deliberately
// no route, server action or browser control that backfills history.
//
// WHY A ONE-OFF SCRIPT AND NOT A MIGRATION. The values are not schema; they are
// read out of the stored source workbook by the SAME extractor the publish route
// runs. From the next publication onwards no script is needed at all: widening
// `extractEvolutionHistory` to every published scope means the publish path
// ingests the personal series automatically, exactly as it already ingests
// Main's. This script exists only to catch the series up to the workbook that
// has already been published.
//
// NO NEW SCHEMA. `portfolio_evolution_observations` already CHECK-constrains
// `scope in ('main','jaime','andres','pablo')` and `basis in (…,'total')`, keys
// on `(scope, basis, observation_date)`, and reads through
// `nmi_can_access_scope(scope)`. The personal series therefore inherit Main's
// idempotency and Main's per-scope entitlement without a single DDL statement.
//
// IDEMPOTENT. The upsert is on the table's own unique key, so re-running
// rewrites the same rows in place. Nothing is ever deleted: a week that stops
// appearing in a newer workbook keeps its observation, because that value was
// really published by the source.
//
// USAGE — plain `node` (Node 24 strips TypeScript types natively).
//
//   node scripts/admin/backfillEvolutionHistory.ts            # dry run (default)
//   node scripts/admin/backfillEvolutionHistory.ts --actor <admin-username> --write
//
// SAFETY
//   · never logs a service-role key, a Supabase URL, an email or a password
//   · never prints a portfolio AMOUNT — counts, dates, cells and labels only
//   · requires an explicitly named APPROVED ADMINISTRATOR actor to write
//   · re-verifies the stored object's digest before parsing (TOCTOU)
//   · fails closed on every unexpected state

// @next/env is CJS — import via default (the pattern every other script uses).
import pkg from '@next/env'
import { createHash } from 'node:crypto'
import { RESUMEN_PARSER_VERSION } from '../../src/lib/familyPortfolio/resumen/parseResumen.ts'
import {
  extractEvolutionHistory,
  EVOLUTION_EXTRACTOR_VERSION,
} from '../../src/lib/familyPortfolio/resumen/evolutionHistory.ts'

pkg.loadEnvConfig(process.cwd())

interface Args {
  actor: string
  write: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { actor: '', write: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') args.write = true
    else if (argv[i] === '--actor') args.actor = (argv[++i] ?? '').trim()
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

// ── 1. The upload whose bytes the history comes from ──────────────────────────
const uploadRes = await admin
  .from('portfolio_source_uploads')
  .select('id, original_filename, file_sha256, storage_object_path')
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
}

const findingsRes = await admin
  .from('portfolio_upload_findings')
  .select('code')
  .eq('upload_id', upload.id)
  .eq('severity', 'blocking')
if (findingsRes.error) die(`could not read upload findings: ${findingsRes.error.message}`)
if ((findingsRes.data ?? []).length > 0) {
  die('the upload carries blocking findings — recalculate and re-upload rather than ingesting around them.')
}

// ── 2. Re-download and re-verify the digest (TOCTOU, as the publish route does) ─
const dl = await admin.storage.from('portfolio-source-uploads').download(upload.storage_object_path)
if (dl.error || !dl.data) die(`could not download the stored workbook: ${dl.error?.message ?? 'no object'}`)
const bytes = Buffer.from(await dl.data.arrayBuffer())
if (createHash('sha256').update(bytes).digest('hex') !== upload.file_sha256) {
  die('source_digest_mismatch — the stored object does not match the upload record.')
}

console.log(`source      : ${upload.original_filename} (sha256 ${upload.file_sha256.slice(0, 12)}…, re-verified)`)
console.log(`parser      : ${RESUMEN_PARSER_VERSION}`)
console.log(`extractor   : ${EVOLUTION_EXTRACTOR_VERSION}`)

// ── 3. Extract every scope's series from the historical column grid ───────────
const extraction = extractEvolutionHistory(bytes)
if (!extraction.ok) {
  for (const f of extraction.findings) console.error(`  ${f.severity}: ${f.code} — ${f.detail}`)
  die('extraction failed — nothing was written.')
}

console.log(`\nhistorical columns: ${extraction.historicalDates.length} ` +
  `(${extraction.historicalDates[0]} .. ${extraction.historicalDates.at(-1)})`)
if (extraction.duplicateDates.length > 0) die(`duplicate week dates: ${extraction.duplicateDates.join(', ')}`)

console.log('\nseries inventory (no amounts printed):')
for (const s of extraction.series) {
  console.log(
    `  ${`${s.scope}:${s.basis}`.padEnd(30)} n=${String(s.observationCount).padStart(3)}` +
    `  ${s.earliestDate ?? '—'} .. ${s.latestDate ?? '—'}` +
    `  gaps=${s.gapDates.length}` +
    `  row=${s.boundRowKey ?? 'UNBOUND'} (“${s.boundRowLabel ?? '—'}” src row ${s.sourceRow ?? '—'})`,
  )
  if (s.gapDates.length > 0) {
    // Leading blanks mean the portfolio joined the book later — reported, never
    // back-projected into a fabricated opening value.
    console.log(`      gap dates: ${s.gapDates.join(', ')}`)
  }
}
for (const f of extraction.findings) console.log(`  ${f.severity}: ${f.code} — ${f.detail}`)

// What is already persisted, so the run reports NEW vs REFRESHED honestly.
const existingRes = await admin
  .from('portfolio_evolution_observations')
  .select('scope, basis, observation_date')
  .limit(5000)
if (existingRes.error) die(`could not read the evolution table: ${existingRes.error.message}`)
const existing = new Set(
  (existingRes.data ?? []).map((r) => `${r.scope}|${r.basis}|${r.observation_date}`),
)
const incoming = extraction.observations
const fresh = incoming.filter((o) => !existing.has(`${o.scope}|${o.basis}|${o.observationDate}`))
console.log(`\npersisted now: ${existing.size} rows · incoming: ${incoming.length} · new: ${fresh.length} · refreshed: ${incoming.length - fresh.length}`)

if (!args.write) {
  console.log('\nDRY RUN — nothing was written. Re-run with --actor <admin-username> --write to apply.')
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

// ── 5. Upsert on the table's own key — idempotent, additive, never deleting ───
const rows = incoming.map((o) => ({
  scope: o.scope,
  basis: o.basis,
  observation_date: o.observationDate,
  value: o.value,
  currency: 'USD',
  source_upload_id: upload.id,
  source_sheet: o.sourceSheet,
  source_cell: o.sourceCell,
  source_row_label: o.sourceRowLabel,
  parser_version: extraction.parserVersion,
  extractor_version: extraction.extractorVersion,
  ingested_by: actor.id,
  metadata: {},
}))

const CHUNK = 250
let written = 0
for (let i = 0; i < rows.length; i += CHUNK) {
  const slice = rows.slice(i, i + CHUNK)
  const { error } = await admin
    .from('portfolio_evolution_observations')
    .upsert(slice, { onConflict: 'scope,basis,observation_date' })
  if (error) die(`upsert failed at row ${i}: ${error.message}`)
  written += slice.length
}
console.log(`\n✔ ${written} observations upserted by ${actor.username}.`)
