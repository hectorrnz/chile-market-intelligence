// R13.7B3.2 — the idempotent historical-correction notification apply path.
//
// TWO HALVES AGAIN. Who may READ a correction is a property of PostgreSQL RLS
// and is proven with real role sessions in
// supabase/tests/database/structured_notes_reconciliation_apply_test.sql. This
// file proves the half that lives in TypeScript: that the corrected-note set is
// derived from the durable audit record rather than typed by a human, that the
// identity is deterministic, that a retry and a PARTIAL retry both do the right
// thing, that a malformed or non-backfill audit record is refused, and that no
// email path exists to be invoked.
//
// The fake Supabase client below enforces the unique index the migration adds,
// so the concurrency case — a row appearing between the pre-read and the insert
// — is exercised here as a real 23505, not asserted about.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  parseReconciliationAuditRecord,
  buildHistoricalCorrectionRows,
  planHistoricalCorrectionNotifications,
  historicalCorrectionKey,
  correctionDateFromAudit,
  HISTORICAL_CORRECTION_KEY_FIELD,
  type AuditRunRow,
} from '../src/lib/structuredNotes/historicalCorrectionNotifications.ts'
import {
  HISTORICAL_CORRECTION_NOTIFICATION_TYPE,
  LIVE_NOTIFICATION_TYPES,
  RECONCILIATION_REASON_CODE,
} from '../src/lib/structuredNotes/reconciliation.ts'
import {
  listHistoricalCorrectionKeys,
  createHistoricalCorrectionNotification,
} from '../src/lib/db/repositories/notificationsRepository.ts'

const MIGRATION = readFileSync('supabase/migrations/20260820000000_historical_correction_notification_identity.sql', 'utf8')
const ORCHESTRATOR = readFileSync('scripts/reconcile/applyHistoricalCorrectionNotifications.ts', 'utf8')
const MODULE = readFileSync('src/lib/structuredNotes/historicalCorrectionNotifications.ts', 'utf8')
const NOTIF_REPO = readFileSync('src/lib/db/repositories/notificationsRepository.ts', 'utf8')
const PGTAP = readFileSync('supabase/tests/database/structured_notes_reconciliation_apply_test.sql', 'utf8')

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}
function sqlCode(src: string): string {
  return src.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '')
}

// -- The audit record a real reconciliation writes --------------------------
// Eight corrected notes and one deliberately unchanged, matching the shape
// 20260819000000 stores: metadata.notes is the packet's own note array.

const OP = 'r13-7-b3-001'

function auditNote(isin: string, noteId: string, callDate: string | null, settlement: string, corrected: boolean) {
  return {
    noteId,
    isin,
    expectedStatus: 'active',
    correctedStatus: corrected ? 'autocalled' : 'active',
    callDate,
    redemptionDate: callDate ? `${callDate.slice(0, 8)}${String(Number(callDate.slice(8)) + 7).padStart(2, '0')}` : null,
    settlement,
    classification: corrected ? 'confirmed_missed_autocall' : 'not_called',
  }
}

const CORRECTED = [
  auditNote('XS0000000001', '11111111-1111-1111-1111-111111111101', '2026-08-12', 'settled', true),
  auditNote('XS0000000002', '11111111-1111-1111-1111-111111111102', '2026-08-17', 'settled', true),
  auditNote('XS0000000003', '11111111-1111-1111-1111-111111111103', '2026-08-17', 'settled', true),
  auditNote('XS0000000004', '11111111-1111-1111-1111-111111111104', '2026-08-20', 'settled', true),
  auditNote('XS0000000005', '11111111-1111-1111-1111-111111111105', '2026-08-28', 'settled', true),
  auditNote('XS0000000006', '11111111-1111-1111-1111-111111111106', '2026-09-01', 'pending', true),
  auditNote('XS0000000007', '11111111-1111-1111-1111-111111111107', '2026-09-04', 'pending', true),
  auditNote('XS0000000008', '11111111-1111-1111-1111-111111111108', '2026-09-04', 'pending', true),
]
const UNCHANGED = auditNote('XS0000000009', '11111111-1111-1111-1111-111111111109', null, 'unknown', false)

function auditRow(overrides: Partial<AuditRunRow> = {}, metaOverrides: Record<string, unknown> = {}): AuditRunRow {
  return {
    id: 'audit-run-1',
    run_type: 'backfill',
    status: 'success',
    metadata: {
      operationId: OP,
      packetHash: 'a'.repeat(64),
      actor: 'H Martinez',
      reasonCode: RECONCILIATION_REASON_CODE,
      asOf: '2026-09-07',
      appliedAt: '2026-09-08T14:32:11Z',
      counts: {
        observationsInserted: 59, observationsAutocalled: 8, observationsCancelled: 96,
        notesCorrected: 8, notesUnchanged: 1,
      },
      notes: [...CORRECTED, UNCHANGED],
      ...metaOverrides,
    },
    ...overrides,
  }
}

function parsedAudit() {
  const p = parseReconciliationAuditRecord(auditRow(), OP)
  assert.ok(p.ok, 'fixture audit must parse')
  return p.audit
}

// -- A fake Supabase client that enforces the migration's unique index -------

interface FakeRow { id: string; notification_type: string; metadata: Record<string, unknown>; [k: string]: unknown }

function makeFakeDb(seed: FakeRow[] = []) {
  const rows: FakeRow[] = [...seed]
  let n = seed.length
  const client = {
    from(table: string) {
      if (table !== 'notifications') throw new Error(`unexpected table ${table}`)
      return {
        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  const meta = (row.metadata ?? {}) as Record<string, unknown>
                  const key = meta[HISTORICAL_CORRECTION_KEY_FIELD]
                  // The partial unique index, exactly as the migration defines it.
                  const clash = rows.some(
                    (r) => r.notification_type === row.notification_type &&
                      typeof key === 'string' &&
                      r.metadata?.[HISTORICAL_CORRECTION_KEY_FIELD] === key,
                  )
                  if (clash) {
                    return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
                  }
                  n += 1
                  const stored = { ...row, id: `notif-${n}` } as FakeRow
                  rows.push(stored)
                  return { data: { id: stored.id }, error: null }
                },
              }
            },
          }
        },
        select() {
          const filters: [string, string][] = []
          const builder = {
            eq(col: string, val: string) { filters.push([col, val]); return builder },
            then(resolve: (v: unknown) => void) {
              const data = rows
                .filter((r) => filters.every(([c, v]) =>
                  c === 'notification_type' ? r.notification_type === v
                    : c === 'metadata->>operationId' ? r.metadata?.operationId === v
                      : false))
                .map((r) => ({ metadata: r.metadata }))
              resolve({ data, error: null })
            },
          }
          return builder
        },
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, rows }
}

// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B3.2 A - the corrected set is derived from the audit record', () => {
  it('A: 8 corrected + 1 unchanged produces exactly 8 notifications', () => {
    const audit = parsedAudit()
    assert.equal(audit.notesExamined.length, 9)
    assert.equal(audit.correctedNotes.length, 8)
    assert.equal(buildHistoricalCorrectionRows(audit).length, 8)
  })

  it('B: the unchanged note gets none', () => {
    const rows = buildHistoricalCorrectionRows(parsedAudit())
    assert.ok(!rows.some((r) => r.relatedEntityId === UNCHANGED.noteId))
    assert.ok(!rows.some((r) => r.body.includes('XS0000000009')))
  })

  it('C: the ORIGINAL contractual call date is preserved per note', () => {
    const rows = buildHistoricalCorrectionRows(parsedAudit())
    for (const n of CORRECTED) {
      const r = rows.find((x) => x.relatedEntityId === n.noteId)!
      assert.ok(r.body.includes(n.callDate!), `${n.isin}: body must state ${n.callDate}`)
      assert.equal(r.metadata.originalCallDate, n.callDate)
    }
  })

  it('D: the correction/apply date comes from the audit record, not today', () => {
    const audit = parsedAudit()
    assert.equal(correctionDateFromAudit(audit), '2026-09-08')
    for (const r of buildHistoricalCorrectionRows(audit)) {
      assert.ok(r.body.includes('Correction applied 2026-09-08'))
      assert.equal(r.metadata.correctionDate, '2026-09-08')
    }
  })

  it('reads as a historical reconciliation, never a live call alert', () => {
    for (const r of buildHistoricalCorrectionRows(parsedAudit())) {
      assert.match(r.title, /^Historical correction/)
      assert.match(r.body, /not a new call event/)
      assert.match(r.body, /previously missed autocall detection/)
      assert.equal(r.metadata.historicalCorrection, true)
      assert.ok(!/detected today|new alert|just called/i.test(r.body))
    }
  })

  it('states settlement on the right side of the line', () => {
    const rows = buildHistoricalCorrectionRows(parsedAudit())
    const settled = rows.find((r) => r.relatedEntityId === CORRECTED[0].noteId)!
    const pending = rows.find((r) => r.relatedEntityId === CORRECTED[5].noteId)!
    assert.match(settled.body, /and is settled/)
    assert.ok(!/remains outstanding/.test(settled.body))
    assert.match(pending.body, /remains outstanding/)
  })

  it('carries the type that can never be confused with a live alert', () => {
    for (const r of buildHistoricalCorrectionRows(parsedAudit())) {
      assert.equal(r.notificationType, HISTORICAL_CORRECTION_NOTIFICATION_TYPE)
      assert.ok(!(LIVE_NOTIFICATION_TYPES as readonly string[]).includes(r.notificationType))
    }
  })
})

describe('R13.7B3.2 B - deterministic identity', () => {
  it('is operation id + note id, and is stored for audit', () => {
    for (const r of buildHistoricalCorrectionRows(parsedAudit())) {
      assert.equal(r.correctionKey, historicalCorrectionKey(OP, r.relatedEntityId))
      assert.equal(r.metadata[HISTORICAL_CORRECTION_KEY_FIELD], r.correctionKey)
      assert.equal(r.metadata.operationId, OP)
      assert.equal(r.metadata.auditRunId, 'audit-run-1')
    }
  })

  it('the identity is not the message text - rewording keeps it stable', () => {
    const a = buildHistoricalCorrectionRows(parsedAudit())
    const reworded = { ...a[0], title: 'Something else entirely', body: 'different words' }
    assert.equal(reworded.correctionKey, a[0].correctionKey)
    assert.doesNotMatch(sqlCode(MIGRATION), /title|body/, 'the index must not key on message text')
  })

  it('the same note corrected by a DIFFERENT operation is a different notification', () => {
    assert.notEqual(historicalCorrectionKey('op-A', 'note-1'), historicalCorrectionKey('op-B', 'note-1'))
  })

  it('all eight identities are distinct', () => {
    const keys = buildHistoricalCorrectionRows(parsedAudit()).map((r) => r.correctionKey)
    assert.equal(new Set(keys).size, 8)
  })
})

describe('R13.7B3.2 C - retry, partial retry and concurrency', () => {
  it('E: a full retry plans zero creations', () => {
    const expected = buildHistoricalCorrectionRows(parsedAudit())
    const plan = planHistoricalCorrectionNotifications(expected, expected.map((r) => r.correctionKey))
    assert.equal(plan.toCreate.length, 0)
    assert.equal(plan.alreadyPresent.length, 8)
  })

  it('F: after a partial success, only the genuinely missing rows are planned', () => {
    const expected = buildHistoricalCorrectionRows(parsedAudit())
    const plan = planHistoricalCorrectionNotifications(expected, expected.slice(0, 5).map((r) => r.correctionKey))
    assert.equal(plan.alreadyPresent.length, 5)
    assert.equal(plan.toCreate.length, 3)
    assert.deepEqual(plan.toCreate.map((r) => r.correctionKey), expected.slice(5).map((r) => r.correctionKey))
  })

  it('E: writing twice through the repository creates exactly one row', async () => {
    const { client, rows } = makeFakeDb()
    const row = buildHistoricalCorrectionRows(parsedAudit())[0]
    const input = {
      notificationType: row.notificationType, title: row.title, body: row.body, linkUrl: row.linkUrl,
      relatedEntityType: row.relatedEntityType, relatedEntityId: row.relatedEntityId, metadata: row.metadata,
    }
    const first = await createHistoricalCorrectionNotification(client, input)
    const second = await createHistoricalCorrectionNotification(client, input)
    assert.deepEqual(first, { ok: true, id: 'notif-1', created: true })
    assert.deepEqual(second, { ok: true, created: false }, 'a duplicate is a retry, not a failure')
    assert.equal(rows.length, 1)
  })

  it('G: a row appearing between the pre-read and the insert cannot duplicate', async () => {
    const expected = buildHistoricalCorrectionRows(parsedAudit())
    const { client, rows } = makeFakeDb()
    // Both "runs" read an empty feed, then both try to write the same identity.
    const keysA = await listHistoricalCorrectionKeys(client, OP)
    const keysB = await listHistoricalCorrectionKeys(client, OP)
    assert.deepEqual(keysA, [])
    assert.deepEqual(keysB, [])
    const planA = planHistoricalCorrectionNotifications(expected, keysA)
    const planB = planHistoricalCorrectionNotifications(expected, keysB)
    assert.equal(planA.toCreate.length, 8)
    assert.equal(planB.toCreate.length, 8, 'both runs believe they must create all eight')

    const write = async (r: (typeof expected)[number]) => createHistoricalCorrectionNotification(client, {
      notificationType: r.notificationType, title: r.title, body: r.body, linkUrl: r.linkUrl,
      relatedEntityType: r.relatedEntityType, relatedEntityId: r.relatedEntityId, metadata: r.metadata,
    })
    for (const r of planA.toCreate) await write(r)
    let duplicatesRefused = 0
    for (const r of planB.toCreate) {
      const res = await write(r)
      assert.ok(res.ok, 'the loser reports success, not an error')
      if (res.ok && !res.created) duplicatesRefused += 1
    }
    assert.equal(duplicatesRefused, 8)
    assert.equal(rows.length, 8, 'sixteen attempts, eight rows')
  })

  it('the pre-read finds only this operation, never another reconciliation', async () => {
    const expected = buildHistoricalCorrectionRows(parsedAudit())
    const { client } = makeFakeDb([{
      id: 'other', notification_type: HISTORICAL_CORRECTION_NOTIFICATION_TYPE,
      metadata: { operationId: 'a-different-operation', correctionKey: 'a-different-operation:x' },
    }])
    assert.deepEqual(await listHistoricalCorrectionKeys(client, OP), [])
    const plan = planHistoricalCorrectionNotifications(expected, await listHistoricalCorrectionKeys(client, OP))
    assert.equal(plan.toCreate.length, 8)
  })
})

describe('R13.7B3.2 D - a bad audit record is refused, never guessed at', () => {
  const bad = (row: AuditRunRow | null, op = OP) => {
    const r = parseReconciliationAuditRecord(row, op)
    assert.equal(r.ok, false, 'must be refused')
    return r.ok ? [] : r.errors
  }

  it('H: a wrong/absent operation id refuses', () => {
    assert.match(bad(null, OP).join(' '), /no reconciliation audit record found/)
    assert.match(bad(auditRow(), 'some-other-op').join(' '), /does not match the requested/)
  })

  it('J: a non-backfill run refuses', () => {
    assert.match(bad(auditRow({ run_type: 'scheduled_snapshot' })).join(' '), /run_type/)
  })

  it('a run that did not succeed refuses', () => {
    assert.match(bad(auditRow({ status: 'partial_success' })).join(' '), /only a completed, successful reconciliation/)
  })

  it('I: malformed metadata refuses', () => {
    assert.match(bad(auditRow({ metadata: 'not an object' })).join(' '), /metadata is not an object/)
    assert.match(bad(auditRow({}, { notes: [] })).join(' '), /no notes array/)
    assert.match(bad(auditRow({}, { actor: '' })).join(' '), /no actor/)
    assert.match(bad(auditRow({}, { appliedAt: null })).join(' '), /no appliedAt/)
    assert.match(bad(auditRow({}, { packetHash: null })).join(' '), /no packetHash/)
    assert.match(bad(auditRow({}, { reasonCode: 'something_else' })).join(' '), /reasonCode/)
    assert.match(bad(auditRow({}, { counts: null })).join(' '), /no counts object/)
  })

  it('I: a counts/notes disagreement refuses - neither half can then be trusted', () => {
    const errs = bad(auditRow({}, {
      counts: { notesCorrected: 6, observationsInserted: 59, observationsAutocalled: 8, observationsCancelled: 96, notesUnchanged: 1 },
    }))
    assert.match(errs.join(' '), /counts\.notesCorrected is 6 but 8 note\(s\) show a status change/)
  })

  it('a corrected note with no original call date refuses - it cannot be described honestly', () => {
    const notes = [...CORRECTED.map((n, i) => (i === 0 ? { ...n, callDate: null } : n)), UNCHANGED]
    assert.match(bad(auditRow({}, { notes })).join(' '), /has no original call date/)
  })

  it('a note missing its status fields refuses', () => {
    const notes = [{ noteId: 'x', isin: 'XS1' }, ...CORRECTED, UNCHANGED]
    assert.match(bad(auditRow({}, { notes })).join(' '), /missing expectedStatus or correctedStatus/)
  })
})

describe('R13.7B3.2 E - absolutely no email', () => {
  it('P: every built row carries an empty recipient list', () => {
    for (const r of buildHistoricalCorrectionRows(parsedAudit())) {
      assert.deepEqual(r.emailRecipients, [])
      assert.equal(r.emailRecipients.length, 0)
    }
  })

  it('P: the type makes a recipient list unrepresentable', () => {
    assert.match(MODULE, /emailRecipients: readonly never\[\]/,
      'readonly never[] admits no value but the empty array')
  })

  it('Q: no email module, transport or recipient lookup is reachable from this path', () => {
    for (const [name, src] of [['orchestrator', ORCHESTRATOR], ['builder', MODULE]] as const) {
      const c = code(src)
      assert.doesNotMatch(c, /emailProvider|sendNotificationEmail|getActiveNotificationRecipientEmails/,
        `${name} must not reference any email path`)
      assert.doesNotMatch(c, /resend|RESEND_API_KEY|notification_recipients/i, `${name} must not reach the mail transport`)
    }
  })

  it('Q: the writer function itself cannot fan out to recipients', () => {
    // Only this function's own body — the recipient helpers that follow it in
    // the same file are a different path and legitimately mention email.
    const after = code(NOTIF_REPO).split('export async function createHistoricalCorrectionNotification')[1] ?? ''
    const fn = after.split(/\nexport (?:async )?(?:function|const)/)[0]
    assert.ok(fn.length > 0 && fn.includes("from('notifications')"), 'the writer body was located')
    assert.doesNotMatch(fn, /recipient|email|send/i)
    assert.doesNotMatch(fn, /notification_recipients/)
  })

  it('Q: the live cron routes still DO email - this is a difference, not a regression', () => {
    const snapshot = readFileSync('src/app/api/cron/structured-notes/snapshot/route.ts', 'utf8')
    assert.match(snapshot, /sendNotificationEmail/, 'the live T0 path is unchanged')
  })
})

describe('R13.7B3.2 F - the orchestrator cannot fire by accident or touch money', () => {
  const c = code(ORCHESTRATOR)

  it('T: inspect-only is the default and writes nothing', () => {
    assert.match(c, /const apply = process\.argv\.includes\('--apply'\)/)
    assert.match(c, /INSPECT ONLY — no notification was created/)
    const guard = c.indexOf('if (!apply)')
    const write = c.indexOf('createHistoricalCorrectionNotification(client')
    assert.ok(guard > 0 && guard < write, 'the early return must precede every write')
  })

  it('S: the project-ref gate and confirmation token are required to apply', () => {
    assert.match(c, /--expect-project-ref is required to apply/)
    assert.match(c, /if \(expectRef !== projectRef\)/)
    assert.match(c, /Refusing to apply/)
    assert.match(c, /CORRECTION_CONFIRMATION_TOKEN = 'CREATE-HISTORICAL-CORRECTIONS'/)
    assert.match(c, /if \(confirm !== CORRECTION_CONFIRMATION_TOKEN\)/)
  })

  it('S: its token is distinct from the financial apply token', () => {
    const financial = readFileSync('scripts/reconcile/applyStructuredNotesReconciliation.ts', 'utf8')
    assert.match(financial, /APPLY_CONFIRMATION_TOKEN = 'APPLY-RECONCILIATION'/)
    assert.notEqual('CREATE-HISTORICAL-CORRECTIONS', 'APPLY-RECONCILIATION')
  })

  it('prints the target project ref before any write', () => {
    const ref = c.indexOf('target Supabase project ref')
    const write = c.indexOf('createHistoricalCorrectionNotification(client')
    assert.ok(ref > 0 && ref < write)
  })

  it('R: it cannot mutate a single financial row', () => {
    assert.doesNotMatch(c, /structured_notes|structured_note_observations|nmi_apply_structured_note_reconciliation/,
      'no financial table or the reconciliation RPC may be referenced')
    assert.doesNotMatch(c, /\.rpc\(/, 'it calls no RPC at all')
    assert.equal((c.match(/\.from\(/g) ?? []).length, 0, 'it writes only through repository functions')
  })

  it('requires the operation id and refuses an ambiguous or missing audit record', () => {
    assert.match(c, /--operation-id is required/)
    assert.match(c, /no reconciliation audit record exists for operation/)
    assert.match(c, /refusing to guess which reconciliation to announce/)
    assert.match(c, /the audit record does not describe a completed, self-consistent reconciliation/)
  })

  it('never asks an operator to name the notes', () => {
    assert.doesNotMatch(c, /--isin|--notes|--note-id/, 'the corrected set is derived, never typed')
    assert.doesNotMatch(ORCHESTRATOR, /XS3\d{9}/, 'no production ISIN appears in the tooling')
  })

  it('a notification failure is reported as retryable, never as a reason to undo money', () => {
    assert.match(c, /The financial reconciliation is unaffected and/)
    assert.match(c, /re-run this command with the same --operation-id/)
    assert.doesNotMatch(c, /rollback|revert/i)
  })

  it('runs under plain node - every relative import carries an extension', () => {
    const re = /from\s+['"](\.[^'"]*)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(ORCHESTRATOR)) !== null) {
      assert.match(m[1], /\.(ts|tsx|js|mjs|json)$/, `extensionless import: ${m[1]}`)
    }
    assert.doesNotMatch(ORCHESTRATOR, /npx tsx/)
  })
})

describe('R13.7B3.2 G - the identity migration is narrow and preserves the hardened posture', () => {
  const c = sqlCode(MIGRATION)

  it('adds ONE partial unique index, scoped to the historical type only', () => {
    assert.match(c, /create unique index if not exists notifications_historical_correction_identity_uidx/)
    assert.match(c, /\(\(metadata ->> 'correctionKey'\)\)/)
    assert.match(c, /where notification_type = 'structured_note_historical_correction'/)
    assert.match(c, /must be UNIQUE and PARTIAL/)
  })

  it('leaves the live alert types unconstrained - a repeat warning is a real event', () => {
    for (const live of LIVE_NOTIFICATION_TYPES) assert.ok(!c.includes(`'${live}'`))
    assert.match(c, /an unexpected unique index exists on public\.notifications/)
  })

  it('refuses to build over already-duplicated data', () => {
    assert.match(c, /having count\(\*\) > 1/)
    assert.match(c, /cannot enforce historical-correction identity/)
  })

  it('re-asserts the administrator-only posture rather than changing it', () => {
    assert.match(c, /lost its administrator-gated SELECT policy/)
    assert.match(c, /anon can read public\.notifications/)
    assert.match(c, /notification_recipients lost administrator-only coverage/)
    assert.doesNotMatch(c, /create policy|drop policy/, 'this migration adds an identity, not an audience')
  })

  it('carries no production data', () => {
    assert.doesNotMatch(MIGRATION, /XS3\d{9}/)
    assert.doesNotMatch(MIGRATION, /202\d-\d\d-\d\d/)
    assert.doesNotMatch(MIGRATION, /r13-7-b3-\d/)
  })

  it('does not mutate the already-validated reconciliation migration', () => {
    const prior = readFileSync('supabase/migrations/20260819000000_structured_notes_reconciliation_apply.sql', 'utf8')
    assert.doesNotMatch(prior, /correctionKey|historical_correction_identity/,
      'the identity lives in its own migration, leaving 20260819000000 as CI validated it')
  })
})

describe('R13.7B3.2 H - who may read a correction is proven in the database', () => {
  it('K-O: the hermetic suite covers every role on this feed', () => {
    for (const claim of [
      'K: an administrator CAN read historical corrections',
      'L: a structured_notes-GRANTED member cannot read the correction feed at all',
      'M: an ungranted member cannot read the correction feed',
      'N: anon cannot read the correction feed at all',
      'O: and the badge/count query leaks nothing either',
      'a member cannot forge a historical correction',
      'a granted member still cannot read the email recipient list',
    ]) {
      assert.ok(PGTAP.includes(claim), `hermetic suite is missing: ${claim}`)
    }
    const hardening = readFileSync('supabase/tests/database/sensitive_surface_hardening_test.sql', 'utf8')
    assert.match(hardening, /notification_recipients is not a grantable module/,
      'a module grant still cannot make anyone an email recipient')
  })

  it('G: duplicate identity and per-operation scoping are proven against real PostgreSQL', () => {
    for (const claim of [
      'G: re-announcing the same operation+note is impossible, whatever the wording',
      'the same note under a DIFFERENT operation is a distinct, allowed correction',
      'and again — the identity index does not touch the live types',
      'that index is UNIQUE and PARTIAL',
    ]) {
      assert.ok(PGTAP.includes(claim), `hermetic suite is missing: ${claim}`)
    }
  })

  it('the correction is written by the service role only - no user-facing insert path exists', () => {
    const foundation = readFileSync('supabase/migrations/20260713000000_notifications_foundation.sql', 'utf8')
    assert.match(foundation, /No insert\/update\/delete policy/)
    const hardening = readFileSync('supabase/migrations/20260818000000_structured_notes_operational_alert_hardening.sql', 'utf8')
    assert.match(hardening, /notifications_admin_select/)
    assert.match(hardening, /grant select on table public\.notifications to authenticated/)
  })

  it('O: the badge count reads the same RLS-filtered table, so it cannot leak', () => {
    assert.match(NOTIF_REPO, /getUnreadNotificationCount[\s\S]{0,400}from\('notifications'\)/,
      'the badge count is a plain select on notifications — administrator-only by RLS')
  })
})
