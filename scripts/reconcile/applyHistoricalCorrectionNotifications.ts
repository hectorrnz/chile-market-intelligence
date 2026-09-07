// R13.7B3.2 — THE HISTORICAL-CORRECTION NOTIFICATION ORCHESTRATOR.
//
// The step that runs AFTER a successful atomic reconciliation. It is separate
// from the financial apply on purpose: a notification failure must never roll
// back a correct book, so this is its own independently retryable operation.
//
// IT CANNOT TOUCH FINANCIAL STATE. The only table it writes is `notifications`,
// through one repository function whose input type has no address field. There
// is no reference to structured_notes, structured_note_observations or the
// reconciliation RPC anywhere in this file, and no email transport is imported.
//
// THE OPERATOR SUPPLIES ONE VALUE: the reconciliation operation id. Which notes
// were corrected, their original contractual call dates, when the correction was
// applied and each settlement classification are all read from the durable
// `backfill` audit record that reconciliation wrote. Retyping eight ISINs is
// exactly the step at which a note gets missed, so there is no way to do it.
//
// INSPECT-ONLY IS THE DEFAULT. Applying additionally requires ALL of:
//
//   --apply
//   --operation-id <the reconciliation's id>
//   --expect-project-ref <ref>          must equal the configured project
//   --confirm CREATE-HISTORICAL-CORRECTIONS
//
// Usage (plain `node` — no extra runner):
//   node scripts/reconcile/applyHistoricalCorrectionNotifications.ts --operation-id r13-7-b3-001
//   node scripts/reconcile/applyHistoricalCorrectionNotifications.ts --operation-id r13-7-b3-001 \
//        --apply --expect-project-ref cnxfougkpynovlwsmmdz --confirm CREATE-HISTORICAL-CORRECTIONS

import * as nextEnvNs from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { getReconciliationAuditRuns } from '../../src/lib/db/repositories/structuredNotesRepository.ts'
import {
  listHistoricalCorrectionKeys,
  createHistoricalCorrectionNotification,
} from '../../src/lib/db/repositories/notificationsRepository.ts'
import {
  parseReconciliationAuditRecord,
  buildHistoricalCorrectionRows,
  planHistoricalCorrectionNotifications,
  correctionDateFromAudit,
} from '../../src/lib/structuredNotes/historicalCorrectionNotifications.ts'

/** The typed intent token. Deliberately distinct from the financial apply's. */
export const CORRECTION_CONFIRMATION_TOKEN = 'CREATE-HISTORICAL-CORRECTIONS'

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
  const projectRef = projectRefFromUrl(url)

  // The target is printed BEFORE anything else happens, in both modes.
  console.log('')
  console.log('R13.7 — HISTORICAL CORRECTION NOTIFICATIONS')
  console.log('='.repeat(118))
  console.log(`  target Supabase project ref : ${projectRef ?? '<unrecognized url shape>'}`)
  console.log(`  mode                        : ${apply ? '*** APPLY (WRITES NOTIFICATIONS TO THE PROJECT ABOVE) ***' : 'INSPECT ONLY (no write)'}`)
  console.log(`  reconciliation operation id : ${operationId ?? '<missing>'}`)
  console.log('')

  if (!operationId?.trim()) {
    fail('--operation-id is required: the corrected-note set is derived from that reconciliation\'s audit record, never from a typed list.')
  }

  const client = createClient(url, key, { auth: { persistSession: false } })

  // ── The audit record is the only source of truth ──────────────────────────
  const runs = await getReconciliationAuditRuns(client, operationId)
  if (runs.length === 0) fail(`no reconciliation audit record exists for operation "${operationId}".`)
  if (runs.length > 1) {
    fail(`${runs.length} audit records match operation "${operationId}" — refusing to guess which reconciliation to announce.`)
  }

  const parsed = parseReconciliationAuditRecord(runs[0], operationId)
  if (!parsed.ok) {
    console.error('')
    console.error('AUDIT RECORD REJECTED:')
    for (const e of parsed.errors) console.error(`   · ${e}`)
    fail('the audit record does not describe a completed, self-consistent reconciliation.')
  }
  const audit = parsed.audit

  console.log(`  audit run id                : ${audit.auditRunId}`)
  console.log(`  applied at                  : ${audit.appliedAt}   (correction date ${correctionDateFromAudit(audit)})`)
  console.log(`  applied by                  : ${audit.actor}`)
  console.log(`  packet hash                 : ${audit.packetHash}`)
  console.log(`  notes examined              : ${audit.notesExamined.length}`)
  console.log(`  notes actually corrected    : ${audit.correctedNotes.length}`)
  console.log('')

  const expected = buildHistoricalCorrectionRows(audit)
  const existingKeys = await listHistoricalCorrectionKeys(client, operationId)
  const plan = planHistoricalCorrectionNotifications(expected, existingKeys)

  const pad = (s: unknown, n: number) => String(s ?? '—').padEnd(n)
  console.log('PLAN')
  console.log('='.repeat(118))
  console.log(pad('NOTE', 14) + pad('CALL DATE', 12) + pad('SETTLEMENT', 12) + pad('STATE CHANGE', 24) + 'ACTION')
  for (const r of expected) {
    const n = audit.correctedNotes.find((x) => x.noteId === r.relatedEntityId)!
    console.log(
      pad(n.isin ?? n.noteId, 14) + pad(n.callDate, 12) + pad(n.settlement, 12) +
      pad(`${n.expectedStatus} -> ${n.correctedStatus}`, 24) +
      (plan.toCreate.includes(r) ? 'CREATE' : 'already present — skip'),
    )
  }
  for (const n of audit.notesExamined.filter((x) => x.correctedStatus === x.expectedStatus)) {
    console.log(pad(n.isin ?? n.noteId, 14) + pad('—', 12) + pad('—', 12) + pad('unchanged', 24) + 'no notification (correct)')
  }
  console.log('-'.repeat(118))
  console.log(`TOTALS  expected=${plan.expected.length}  alreadyPresent=${plan.alreadyPresent.length}  toCreate=${plan.toCreate.length}  emails=0 (always)`)

  if (expected.length > 0) {
    console.log('')
    console.log('SAMPLE MESSAGE')
    console.log('-'.repeat(118))
    console.log(`  ${expected[0].title}`)
    console.log(`  ${expected[0].body}`)
  }

  if (!apply) {
    console.log('')
    console.log('INSPECT ONLY — no notification was created.')
    console.log('To create the missing notifications, re-run with:')
    console.log(`   --apply --expect-project-ref ${projectRef ?? '<ref>'} --confirm ${CORRECTION_CONFIRMATION_TOKEN}`)
    console.log('')
    return
  }

  // ── Production safety gate ────────────────────────────────────────────────
  const expectRef = arg('--expect-project-ref')
  const confirm = arg('--confirm')

  if (!expectRef?.trim()) fail('--expect-project-ref is required to apply.')
  if (!projectRef) fail(`the configured Supabase URL (${url}) is not a recognizable project URL — refusing to apply.`)
  if (expectRef !== projectRef) {
    fail(`project ref mismatch: configured project is "${projectRef}", but --expect-project-ref said "${expectRef}". Refusing to apply.`)
  }
  if (confirm !== CORRECTION_CONFIRMATION_TOKEN) {
    fail(`--confirm must be exactly ${CORRECTION_CONFIRMATION_TOKEN} to apply.`)
  }

  if (plan.toCreate.length === 0) {
    console.log('')
    console.log('Nothing to create — every historical correction for this operation already exists.')
    console.log('')
    return
  }

  console.log('')
  console.log(`CREATING ${plan.toCreate.length} administrator-only in-platform notification(s). NO EMAIL IS SENT.`)

  let created = 0
  let alreadyPresent = plan.alreadyPresent.length
  const failures: { note: string; error: string }[] = []

  for (const row of plan.toCreate) {
    const res = await createHistoricalCorrectionNotification(client, {
      notificationType: row.notificationType,
      title: row.title,
      body: row.body,
      linkUrl: row.linkUrl,
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
      metadata: row.metadata,
    })
    if (res.ok && res.created) {
      created += 1
      console.log(`   created  ${row.correctionKey}`)
    } else if (res.ok) {
      // The unique index caught a row the pre-read could not see. A retry, not
      // a failure — this is exactly what makes two concurrent runs safe.
      alreadyPresent += 1
      console.log(`   existing ${row.correctionKey}  (identity already recorded)`)
    } else {
      failures.push({ note: row.correctionKey, error: res.error })
      console.error(`   FAILED   ${row.correctionKey}: ${res.error}`)
    }
  }

  console.log('')
  console.log('RESULT')
  console.log('='.repeat(118))
  console.log(`  created        : ${created}`)
  console.log(`  alreadyPresent : ${alreadyPresent}`)
  console.log(`  failed         : ${failures.length}`)
  console.log(`  emails sent    : 0`)
  console.log('')

  if (failures.length > 0) {
    console.error('Some notifications were not created. The financial reconciliation is unaffected and')
    console.error('remains correct; re-run this command with the same --operation-id to create only the')
    console.error('missing rows. It cannot duplicate the ones that succeeded.')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('Historical correction notifications failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
