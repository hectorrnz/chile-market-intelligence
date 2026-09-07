// R13.7B3.1 § 13–14 — THE RECONCILIATION APPLY ORCHESTRATOR.
//
// The one tool that can change a production note's contractual state, and it
// does so through exactly one call: the atomic RPC
// `nmi_apply_structured_note_reconciliation`. There is deliberately NO
// per-table write in this file — no `.from(...).insert(...)`, no
// `.from(...).update(...)` — so there is no code path along which a failed
// atomic apply could degrade into a sequence of partial writes. If the RPC
// fails, nothing was written, and this tool reports the failure and stops.
//
// VALIDATE-ONLY IS THE DEFAULT. Running it with no `--apply` reads production,
// rebuilds the packet from the same pure engine the dry-run report uses, checks
// it locally, prints every intended mutation, and exits without touching
// anything. Applying additionally requires ALL of:
//
//   --apply
//   --operation-id <stable id>          idempotency identity
//   --actor "<named human operator>"    who authorized it
//   --expect-project-ref <ref>          must equal the configured project
//   --confirm APPLY-RECONCILIATION      typed intent
//
// Usage (plain `node` — no extra runner):
//   node scripts/reconcile/applyStructuredNotesReconciliation.ts --operation-id r13-7-b3-001 --actor "H Martinez"
//   node scripts/reconcile/applyStructuredNotesReconciliation.ts --operation-id r13-7-b3-001 --actor "H Martinez" \
//        --apply --expect-project-ref cnxfougkpynovlwsmmdz --confirm APPLY-RECONCILIATION

import * as nextEnvNs from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { listStructuredNotes } from '../../src/lib/db/repositories/structuredNotesRepository.ts'
import { resolveNoteValuationCloses } from '../../src/lib/structuredNotes/valuationCloseResolver.ts'
import { reconcileNote, contractualAutocallSchedule, summarizeReconciliation } from '../../src/lib/structuredNotes/reconciliation.ts'
import {
  buildReconciliationPacket,
  validateReconciliationPacket,
  type PacketEntry,
  type ReconciliationPacket,
} from '../../src/lib/structuredNotes/reconciliationPacket.ts'

/** The typed intent token. Deliberately not derivable from any flag value. */
export const APPLY_CONFIRMATION_TOKEN = 'APPLY-RECONCILIATION'

/** The single RPC this tool is allowed to call. */
export const APPLY_RPC = 'nmi_apply_structured_note_reconciliation'

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

/** `https://<ref>.supabase.co` -> `<ref>`. Never guesses; returns null if unrecognizable. */
export function projectRefFromUrl(url: string): string | null {
  const m = /^https:\/\/([a-z0-9-]+)\.supabase\.(co|in)$/i.exec(url.replace(/\/+$/, ''))
  return m ? m[1] : null
}

function renderPacket(packet: ReconciliationPacket): string {
  const L: string[] = []
  const pad = (s: unknown, n: number) => String(s ?? '—').padEnd(n)
  L.push('')
  L.push('INTENDED MUTATIONS')
  L.push('='.repeat(120))
  L.push(
    pad('ISIN', 14) + pad('CLASSIFICATION', 27) + pad('STATE', 24) +
    pad('CALL DATE', 12) + pad('INSERT', 8) + pad('CANCEL', 8) + pad('KEEP', 6) + 'SETTLEMENT',
  )
  for (const n of packet.notes) {
    const state = n.correctedStatus === n.expectedStatus ? 'unchanged' : `${n.expectedStatus} -> ${n.correctedStatus}`
    L.push(
      pad(n.isin, 14) + pad(n.classification, 27) + pad(state, 24) + pad(n.callDate, 12) +
      pad(n.insertObservations.length, 8) + pad(n.cancelObservations.length, 8) +
      pad(n.preserveObservations.length, 6) + n.settlement,
    )
  }
  L.push('-'.repeat(120))
  const c = packet.expectedCounts
  L.push(
    `TOTALS  inserted=${c.observationsInserted}  autocalled=${c.observationsAutocalled}  ` +
    `cancelled=${c.observationsCancelled}  notesCorrected=${c.notesCorrected}  notesUnchanged=${c.notesUnchanged}`,
  )
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
  const asOf = arg('--as-of') ?? new Date().toISOString().slice(0, 10)
  const projectRef = projectRefFromUrl(url)

  // The target is printed BEFORE anything else happens, in both modes (§ 14).
  console.log('')
  console.log('R13.7 — STRUCTURED NOTES RECONCILIATION APPLY')
  console.log('='.repeat(120))
  console.log(`  target Supabase project ref : ${projectRef ?? '<unrecognized url shape>'}`)
  console.log(`  mode                        : ${apply ? '*** APPLY (WRITES TO THE DATABASE ABOVE) ***' : 'VALIDATE ONLY (no write)'}`)
  console.log(`  as-of                       : ${asOf}`)
  console.log(`  operation id                : ${operationId ?? '<missing>'}`)
  console.log(`  actor                       : ${actor ?? '<missing>'}`)
  console.log('')

  if (!operationId?.trim()) fail('--operation-id is required in both modes: it is the idempotency identity, and a validation run must produce the same packet the apply will send.')
  if (!actor?.trim()) fail('--actor is required: the audit record must name the human who authorized this.')

  const client = createClient(url, key, { auth: { persistSession: false } })

  // ── Rebuild the packet from the SAME pure engine the reviewed dry run used ──
  const notes = await listStructuredNotes(client)
  const entries: PacketEntry[] = []
  for (const note of notes) {
    const dates = contractualAutocallSchedule(note).map((s) => s.valuationDate).filter((d) => d <= asOf)
    const closes = dates.length > 0
      ? await resolveNoteValuationCloses(client, note, dates)
      : { byDate: new Map(), snapshots: [], history: [] }
    entries.push({ note, result: reconcileNote({ note, closesByDate: closes.byDate, asOf }) })
  }

  const summary = summarizeReconciliation(entries.map((e) => e.result))
  console.log(`  notes examined: ${entries.length}   ${JSON.stringify(summary)}`)

  if (summary.insufficient_data > 0 || summary.contract_ambiguous > 0) {
    fail(
      `${summary.insufficient_data} note(s) have insufficient data and ${summary.contract_ambiguous} are contractually ambiguous. ` +
      'An UNKNOWN outcome is never written as called or not-called — resolve the evidence first.',
    )
  }

  const packet = buildReconciliationPacket(entries, { operationId, actor, asOf })
  console.log(renderPacket(packet))
  console.log('')
  console.log(`  packet hash: ${packet.packetHash}`)

  const errors = validateReconciliationPacket(packet)
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

  // ── § 14 · Explicit production safety gate ────────────────────────────────
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
  console.log(`APPLYING via ${APPLY_RPC} — ONE atomic transaction, all-or-nothing.`)

  // The ONLY write in this tool. There is no fallback: an error here means the
  // transaction rolled back and the book is untouched, which is the correct
  // outcome, not something to route around.
  const { data, error } = await client.rpc(APPLY_RPC, { p_packet: packet })

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
  console.log('='.repeat(120))
  console.log(JSON.stringify(data, null, 2))
  console.log('')
  const status = (data as { status?: string } | null)?.status
  if (status === 'already_applied') {
    console.log(`Operation ${operationId} had already been applied — no duplicate mutation, no duplicate audit record.`)
  } else {
    console.log(`Applied. Historical-correction notifications are a SEPARATE, idempotent step (§ 12) and were not created here.`)
  }
  console.log('')
}

main().catch((e) => {
  console.error('Reconciliation apply failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
