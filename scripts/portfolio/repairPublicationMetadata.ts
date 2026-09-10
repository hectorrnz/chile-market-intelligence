// POST-R13.8 FOLLOW-UP F § 5 — THE PUBLICATION-METADATA REPAIR ORCHESTRATOR.
//
// The one tool that can correct a stored publication anchor, and it does so
// through exactly one call: the atomic RPC
// `nmi_repair_portfolio_publication_metadata`. There is deliberately NO
// per-table write in this file — no `.from(...).update(...)` — so there is no
// path along which a failed atomic apply could degrade into partial writes. If
// the RPC fails, nothing was written, and this tool reports it and stops.
//
// VALIDATE-ONLY IS THE DEFAULT. With no `--apply` it reads production, derives
// the plan, prints every intended correction with its before and after, and
// exits without touching anything. Applying additionally requires ALL of:
//
//   --apply
//   --operation-id <stable id>          idempotency identity
//   --actor "<named human operator>"    who authorized it
//   --expect-project-ref <ref>          must equal the configured project
//   --confirm APPLY-METADATA-REPAIR     typed intent
//
// WHERE THE CORRECT DATE COMES FROM. It is DERIVED, never typed in: the correct
// anchor for a week is the immediately preceding SOURCE-BACKED reporting date —
// the greatest frozen reporting date strictly before it, read from the
// evolution spine (and cross-checked against row history once that exists).
// `--expect` then asserts the derived mapping equals the one the owner
// authorized, so a derivation that disagrees with the authorization STOPS
// instead of silently writing its own answer.
//
// Usage (plain `node` — no extra runner):
//   node scripts/portfolio/repairPublicationMetadata.ts --expect scripts/portfolio/previousWeekDateRepair.expected.json
//   node scripts/portfolio/repairPublicationMetadata.ts --expect ... --operation-id post-r13-8-f-001 \
//        --actor "H Martinez" --apply --expect-project-ref cnxfougkpynovlwsmmdz --confirm APPLY-METADATA-REPAIR

import { readFileSync } from 'node:fs'
import * as nextEnvNs from '@next/env'
import { createClient } from '@supabase/supabase-js'
import {
  buildMetadataRepairPacket,
  validateMetadataRepairPacket,
  previousSourceReportingDate,
  METADATA_REPAIR_RPC,
  REPAIRABLE_METADATA_FIELDS,
  type MetadataRepairEntry,
  type MetadataRepairPacket,
  type RepairableMetadataField,
} from '../../src/lib/familyPortfolio/publicationMetadataRepair.ts'

/** The typed intent token. Deliberately not derivable from any flag value. */
export const APPLY_CONFIRMATION_TOKEN = 'APPLY-METADATA-REPAIR'

/** The reason recorded on the audit row. Fixed text, per the owner's brief. */
export const REPAIR_REASON =
  'Correct previousWeekDate metadata written during the R13.8 historical publication restatement; ' +
  'financial values are unchanged and each publication is aligned to its actual source predecessor.'

type LoadEnv = (dir: string, dev?: boolean, logger?: { info: (m: string) => void; error: (m: string) => void }) => unknown

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

function fail(message: string): never {
  console.error('')
  console.error(`STOP: ${message}`)
  console.error('')
  process.exit(1)
}

/** `https://<ref>.supabase.co` -> `<ref>`. Never guesses; null if unrecognizable. */
export function projectRefFromUrl(url: string): string | null {
  const m = /^https:\/\/([a-z0-9-]+)\.supabase\.(co|in)$/i.exec(url.replace(/\/+$/, ''))
  return m ? m[1] : null
}

interface ExpectedCorrection {
  asOfDate: string
  expectedRevision: number
  expectedValue: string
  correctedValue: string
}

interface PublicationRow {
  id: string
  as_of_date: string
  revision: number
  is_current: boolean
  upload_kind: string
  metadata: Record<string, unknown> | null
}

/** The one structural capability this tool needs of the client: a paged read. */
type ReadClient = { from: (t: string) => { select: (c: string) => unknown } }

/** Page through a table until it stops returning rows — PostgREST caps a page at 1,000. */
async function readAll<T>(
  client: ReadClient,
  table: string,
  columns: string,
  shape: (q: unknown) => unknown,
): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const q = client.from(table).select(columns)
    const built = shape(q) as { range: (a: number, b: number) => Promise<{ data: T[] | null; error: unknown }> }
    const { data, error } = await built.range(from, from + page - 1)
    if (error) throw new Error(`read of ${table} failed: ${JSON.stringify(error)}`)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < page) return out
  }
}

function renderPlan(packet: MetadataRepairPacket): string {
  const L: string[] = []
  const pad = (s: unknown, n: number) => String(s ?? '—').padEnd(n)
  L.push('')
  L.push(`INTENDED CORRECTIONS — field "${packet.field}"`)
  L.push('='.repeat(104))
  L.push(pad('WEEK', 14) + pad('REV', 6) + pad('PUBLICATION', 38) + pad('STORED (WRONG)', 18) + 'CORRECT')
  for (const e of packet.entries) {
    L.push(
      pad(e.asOfDate, 14) + pad(e.expectedRevision, 6) + pad(e.publicationId, 38) +
      pad(e.expectedValue ?? '<absent>', 18) + e.correctedValue,
    )
  }
  L.push('-'.repeat(104))
  L.push(`TOTAL  ${packet.expectedCount} publication(s), 0 financial rows touched`)
  return L.join('\n')
}

async function main(): Promise<void> {
  const envMod = nextEnvNs as unknown as { loadEnvConfig?: LoadEnv; default?: { loadEnvConfig?: LoadEnv } }
  const loadEnvConfig = envMod.loadEnvConfig ?? envMod.default?.loadEnvConfig
  if (!loadEnvConfig) throw new Error('@next/env did not expose loadEnvConfig')
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} })

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) fail('Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')

  const apply = process.argv.includes('--apply')
  const operationId = arg('--operation-id')
  const actor = arg('--actor')
  const expectPath = arg('--expect')
  const field = (arg('--field') ?? 'previousWeekDate') as RepairableMetadataField
  const projectRef = projectRefFromUrl(url)

  console.log('')
  console.log('POST-R13.8F — PORTFOLIO PUBLICATION METADATA REPAIR')
  console.log('='.repeat(104))
  console.log(`  target Supabase project ref : ${projectRef ?? '<unrecognized url shape>'}`)
  console.log(`  mode                        : ${apply ? '*** APPLY (WRITES TO THE DATABASE ABOVE) ***' : 'VALIDATE ONLY (no write)'}`)
  console.log(`  field                       : ${field}`)
  console.log(`  operation id                : ${operationId ?? '<missing>'}`)
  console.log(`  actor                       : ${actor ?? '<missing>'}`)
  console.log('')

  if (!(REPAIRABLE_METADATA_FIELDS as readonly string[]).includes(field)) {
    fail(`--field ${field} is not repairable — only ${REPAIRABLE_METADATA_FIELDS.join(', ')}`)
  }
  if (!expectPath?.trim()) {
    fail('--expect <file> is required: the derived plan must be checked against the corrections the owner authorized.')
  }
  if (!operationId?.trim()) {
    fail('--operation-id is required in both modes: it is the idempotency identity, and a validation run must produce the same packet the apply will send.')
  }
  if (!actor?.trim()) fail('--actor is required: the audit record must name the human who authorized this.')

  const authorized = JSON.parse(readFileSync(expectPath, 'utf8')) as {
    field: string
    corrections: ExpectedCorrection[]
  }
  if (authorized.field !== field) {
    fail(`the authorization file is for field "${authorized.field}", not "${field}".`)
  }

  const client = createClient(url, key, { auth: { persistSession: false } })

  // ── Read the current publication set ──────────────────────────────────────
  const pubs = await readAll<PublicationRow>(
    client as never as ReadClient,
    'portfolio_publications',
    'id, as_of_date, revision, is_current, upload_kind, metadata',
    (q) =>
      (q as { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => { order: (c: string, o: { ascending: boolean }) => unknown } } })
        .eq('upload_kind', 'portfolio')
        .eq('is_current', true)
        .order('as_of_date', { ascending: true }),
  )
  console.log(`  current portfolio publications : ${pubs.length}`)

  // ── The source-backed reporting spine ─────────────────────────────────────
  // Evolution observations carry EVERY frozen reporting date the workbook has
  // supplied, published or not — which is precisely the set a "previous source
  // week" must be drawn from.
  const obs = await readAll<{ observation_date: string }>(
    client as never as ReadClient,
    'portfolio_evolution_observations',
    'observation_date',
    (q) =>
      (q as { eq: (c: string, v: unknown) => { order: (c: string, o: { ascending: boolean }) => unknown } })
        .eq('scope', 'main')
        .order('observation_date', { ascending: true }),
  )
  const spine = [...new Set(obs.map((o) => o.observation_date))].sort()
  console.log(`  source-backed reporting dates  : ${spine.length}  (${spine[0]} .. ${spine[spine.length - 1]})`)

  // Cross-check against row history when it exists. Absent before the backfill,
  // which is not an error — it is the documented pre-state.
  try {
    const rh = await readAll<{ observation_date: string }>(
      client,
      'portfolio_row_history',
      'observation_date',
      (q) =>
        (q as { eq: (c: string, v: unknown) => { order: (c: string, o: { ascending: boolean }) => unknown } })
          .eq('scope', 'main')
          .order('observation_date', { ascending: true }),
    )
    const rhDates = [...new Set(rh.map((r) => r.observation_date))].sort()
    console.log(`  row-history reporting dates    : ${rhDates.length}`)
    if (rhDates.length > 0) {
      const mismatch = rhDates.filter((d) => !spine.includes(d))
      if (mismatch.length > 0) {
        fail(`row history holds ${mismatch.length} date(s) the evolution spine does not: ${mismatch.join(', ')}`)
      }
    }
  } catch {
    console.log('  row-history reporting dates    : table absent (pre-backfill) — spine taken from evolution history')
  }

  // ── Derive the plan ───────────────────────────────────────────────────────
  const entries: MetadataRepairEntry[] = []
  const problems: string[] = []

  for (const want of authorized.corrections) {
    const pub = pubs.find((p) => p.as_of_date === want.asOfDate)
    if (!pub) {
      problems.push(`${want.asOfDate}: no current portfolio publication`)
      continue
    }
    if (pub.revision !== want.expectedRevision) {
      problems.push(
        `${want.asOfDate}: current revision is ${pub.revision}, the authorization expected ${want.expectedRevision}`,
      )
      continue
    }
    const storedRaw = (pub.metadata ?? {})[field]
    const stored = typeof storedRaw === 'string' ? storedRaw.slice(0, 10) : null
    if (stored !== want.expectedValue) {
      problems.push(
        `${want.asOfDate}: stored ${field} is ${stored ?? '<absent>'}, the authorization expected ${want.expectedValue}`,
      )
      continue
    }

    // DERIVED, not typed in.
    const derived = previousSourceReportingDate(spine, want.asOfDate)
    if (derived === null) {
      problems.push(`${want.asOfDate}: the source has no earlier reporting date to use as a predecessor`)
      continue
    }
    if (derived !== want.correctedValue) {
      problems.push(
        `${want.asOfDate}: the source predecessor derives to ${derived}, the authorization proposed ${want.correctedValue}`,
      )
      continue
    }
    if (!(derived < want.asOfDate)) {
      problems.push(`${want.asOfDate}: derived predecessor ${derived} is not strictly earlier`)
      continue
    }

    entries.push({
      publicationId: pub.id,
      asOfDate: pub.as_of_date,
      expectedRevision: pub.revision,
      expectedIsCurrent: pub.is_current,
      expectedUploadKind: pub.upload_kind,
      expectedValue: stored,
      correctedValue: derived,
    })
  }

  if (problems.length > 0) {
    console.error('')
    console.error('PLAN DOES NOT MATCH PRODUCTION:')
    for (const p of problems) console.error(`   · ${p}`)
    fail('the reviewed authorization no longer describes the database — regenerate the plan. Nothing was sent.')
  }

  if (entries.length !== authorized.corrections.length) {
    fail(`derived ${entries.length} correction(s) from ${authorized.corrections.length} authorized — refusing.`)
  }

  const packet = buildMetadataRepairPacket(entries, {
    operationId,
    actor,
    reason: REPAIR_REASON,
    field,
  })
  console.log(renderPlan(packet))
  console.log('')
  console.log(`  packet hash: ${packet.packetHash}`)

  const errors = validateMetadataRepairPacket(packet)
  if (errors.length > 0) {
    console.error('')
    console.error('PACKET VALIDATION FAILED:')
    for (const e of errors) console.error(`   · ${e}`)
    fail('the packet is malformed — nothing was sent.')
  }
  console.log('  packet validation: OK')

  if (!apply) {
    console.log('')
    console.log('VALIDATE ONLY — no database write was attempted.')
    console.log('To apply, re-run with:')
    console.log(`   --apply --expect-project-ref ${projectRef ?? '<ref>'} --confirm ${APPLY_CONFIRMATION_TOKEN}`)
    console.log('')
    return
  }

  // ── Explicit production safety gate ───────────────────────────────────────
  const expectRef = arg('--expect-project-ref')
  const confirm = arg('--confirm')

  if (!expectRef?.trim()) fail('--expect-project-ref is required to apply.')
  if (!projectRef) fail(`the configured Supabase URL (${url}) is not a recognizable project URL — refusing to apply.`)
  if (expectRef !== projectRef) {
    fail(`project ref mismatch: configured project is "${projectRef}", but --expect-project-ref said "${expectRef}". Refusing to apply.`)
  }
  if (confirm !== APPLY_CONFIRMATION_TOKEN) {
    fail(`--confirm must be exactly ${APPLY_CONFIRMATION_TOKEN} to apply.`)
  }

  console.log('')
  console.log(`APPLYING via ${METADATA_REPAIR_RPC} — ONE atomic transaction, all-or-nothing.`)

  // The ONLY write in this tool. There is no fallback: an error here means the
  // transaction rolled back and the book is untouched, which is the correct
  // outcome, not something to route around.
  const { data, error } = await client.rpc(METADATA_REPAIR_RPC, { p_packet: packet })

  if (error) {
    console.error('')
    console.error('APPLY FAILED — the transaction rolled back and NOTHING was written.')
    console.error(`   ${error.message}`)
    if (error.details) console.error(`   details: ${error.details}`)
    if (error.hint) console.error(`   hint: ${error.hint}`)
    console.error('')
    console.error('This tool does not retry and does not fall back to sequential writes.')
    process.exit(1)
  }

  console.log('')
  console.log('APPLY RESULT')
  console.log('='.repeat(104))
  console.log(JSON.stringify(data, null, 2))
  console.log('')
  const status = (data as { status?: string } | null)?.status
  if (status === 'already_applied') {
    console.log(`Operation ${operationId} had already been applied — no duplicate mutation, no duplicate audit record.`)
  } else {
    console.log('Applied. No financial row was read for value or written by this operation.')
  }
  console.log('')
}

main().catch((e) => {
  console.error('Publication metadata repair failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
