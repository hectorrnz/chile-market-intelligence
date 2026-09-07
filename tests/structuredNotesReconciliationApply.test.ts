// R13.7B3.1 — the atomic reconciliation apply mechanism.
//
// TWO HALVES, AND THIS IS ONLY ONE OF THEM. Atomicity, rollback, idempotency
// and the EXECUTE privilege are properties of a real database and are proven in
// `supabase/tests/database/structured_notes_reconciliation_apply_test.sql`,
// which runs against an isolated PostgreSQL stack in CI. This file proves the
// half that lives in TypeScript: that the packet handed to that function is
// derived from the reviewed analysis rather than improvised, that its identity
// is deterministic, that the orchestrator cannot apply by accident, and that
// the migration's security posture is what it claims to be.
//
// It also guards the runtime defect that made R13.7B3's read-only runner
// unrunnable: an extensionless relative import anywhere in the reconciliation
// tooling's own import closure.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { reconcileNote } from '../src/lib/structuredNotes/reconciliation.ts'
import {
  buildReconciliationPacket,
  canonicalizeReconciliationPacket,
  hashReconciliationPacket,
  validateReconciliationPacket,
  nextAutocallObservationNumber,
  archivedAtForCallDate,
  type ReconciliationPacket,
} from '../src/lib/structuredNotes/reconciliationPacket.ts'
import type { ResolvedValuationClose } from '../src/lib/structuredNotes/valuationClose.ts'
import type { StructuredNote, StructuredNoteUnderlying, StructuredNoteObservation } from '../src/lib/structuredNotes/types.ts'

const MIGRATION = readFileSync('supabase/migrations/20260819000000_structured_notes_reconciliation_apply.sql', 'utf8')
const ORCHESTRATOR = readFileSync('scripts/reconcile/applyStructuredNotesReconciliation.ts', 'utf8')
const RUNNER = readFileSync('scripts/reconcile/structuredNotesReconcile.ts', 'utf8')
const PGTAP = readFileSync('supabase/tests/database/structured_notes_reconciliation_apply_test.sql', 'utf8')
const PACKET_MODULE = readFileSync('src/lib/structuredNotes/reconciliationPacket.ts', 'utf8')

/** Comment-stripped TS source, so a rule is never satisfied by prose describing it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

/**
 * Comment-stripped SQL. Essential rather than tidy: the migration's header
 * explains at length that the function reads no prices and evaluates no
 * barrier, so a check for those words against the raw file would fail on the
 * very sentence promising they are absent.
 */
function sqlCode(src: string): string {
  return src.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '')
}

// -- A synthetic note in exactly the defective shape -------------------------

const U1: StructuredNoteUnderlying = {
  id: 'u1', underlyingOrder: 1, underlyingName: 'AAA Index', sourceTicker: 'AAA Index',
  bloombergTicker: 'AAA Index', yahooSymbol: '^AAA', assetClass: 'index',
  initialLevel: 100, strikeLevel: 100, knockInBarrierLevel: 65, couponBarrierLevel: 65,
  autocallBarrierLevel: 100, knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1,
}
const U2: StructuredNoteUnderlying = {
  ...U1, id: 'u2', underlyingOrder: 2, underlyingName: 'BBB Index',
  sourceTicker: 'BBB Index', bloombergTicker: 'BBB Index', yahooSymbol: '^BBB',
  initialLevel: 200, strikeLevel: 200, knockInBarrierLevel: 130, couponBarrierLevel: 130,
  autocallBarrierLevel: 200,
}

function obs(
  n: number, type: StructuredNoteObservation['observationType'], date: string,
  status: StructuredNoteObservation['status'] = 'scheduled',
  redemptionDate: string | null = null,
): StructuredNoteObservation {
  return {
    id: `o-${type}-${n}`, observationNumber: n, observationType: type, valuationDate: date,
    paymentDate: null, redemptionDate,
    couponDuePct: 0.025, autocallBarrierPct: 1, couponBarrierPct: 0.65, status,
  }
}

function makeNote(overrides: Partial<StructuredNote> = {}): StructuredNote {
  return {
    id: 'note-a', isin: 'XS0000000AAA', productName: 'Fixture', issuerName: 'Fixture Bank',
    issuerDisplayName: 'Fixture', custodian: null, guarantorName: null, structureType: 'autocall',
    payoffType: null, currency: 'USD', issueSize: 1_000_000, denomination: null, issuePricePct: null,
    tradeDate: null, issueDate: null, initialValuationDate: null, finalValuationDate: '2026-10-05',
    maturityDate: '2026-10-12', redemptionDate: '2026-10-12', couponFrequency: 'quarterly',
    couponRatePeriodic: 0.025, couponRateAnnualized: 0.1, memoryCoupon: true, principalProtection: false,
    knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1, status: 'active',
    sourceType: 'pdf_extraction', sourceName: null, sourceFileName: null, confidenceScore: 1,
    archivedAt: null,
    underlyings: [U1, U2],
    observations: [
      obs(1, 'coupon', '2026-01-05', 'coupon_paid', '2026-01-12'),
      // The calling date carries its own Mandatory Early Redemption date, which
      // is what makes settlement derivable rather than 'unknown'.
      obs(2, 'coupon', '2026-04-06', 'coupon_paid', '2026-04-13'),
      obs(3, 'coupon', '2026-07-06', 'scheduled', '2026-07-13'),
      obs(4, 'final', '2026-10-05'),
    ],
    allocations: [],
    ...overrides,
  }
}

function closes(date: string, a: number | null, b: number | null): ResolvedValuationClose[] {
  const one = (order: number, name: string, v: number | null): ResolvedValuationClose => ({
    underlyingOrder: order, underlyingName: name, valuationDate: date, close: v,
    source: v === null ? 'unavailable' : 'persisted_snapshot',
    corroborated: v !== null, disagreementPct: null,
    unavailableReason: v === null ? 'no_close_recorded' : null,
  } as ResolvedValuationClose)
  return [one(1, 'AAA Index', a), one(2, 'BBB Index', b)]
}

/** A note whose SECOND opportunity called, reconciled as-of after it. */
function calledEntry() {
  const note = makeNote()
  const map = new Map<string, ResolvedValuationClose[]>([
    ['2026-01-05', closes('2026-01-05', 90, 180)],
    ['2026-04-06', closes('2026-04-06', 101, 205)],
    ['2026-07-06', closes('2026-07-06', 120, 240)],
  ])
  return { note, result: reconcileNote({ note, closesByDate: map, asOf: '2026-09-07' }) }
}

/** A note with no opportunity yet - examined, deliberately unchanged. */
function untouchedEntry() {
  const note = makeNote({
    id: 'note-b', isin: 'XS0000000BBB',
    observations: [obs(1, 'coupon', '2027-01-05'), obs(2, 'coupon', '2027-04-05'), obs(3, 'final', '2027-07-05')],
  })
  return { note, result: reconcileNote({ note, closesByDate: new Map(), asOf: '2026-09-07' }) }
}

const CTX = { operationId: 'op-test-001', actor: 'Test Operator', asOf: '2026-09-07' }

describe('R13.7B3.1 A - the packet is derived from the reviewed analysis', () => {
  it('classifies the fixture exactly as the reviewed dry run would', () => {
    const { result } = calledEntry()
    assert.equal(result.classification, 'confirmed_missed_autocall')
    assert.equal(result.expectedCallDate, '2026-04-06')
    assert.equal(result.expectedStatus, 'autocalled')
  })

  it('takes the EARLIEST satisfying date, never a later one', () => {
    const { note } = calledEntry()
    const map = new Map<string, ResolvedValuationClose[]>([
      ['2026-01-05', closes('2026-01-05', 105, 210)],
      ['2026-04-06', closes('2026-04-06', 101, 205)],
    ])
    const r = reconcileNote({ note, closesByDate: map, asOf: '2026-09-07' })
    assert.equal(r.expectedCallDate, '2026-01-05', 'the first satisfying opportunity is terminal')
  })

  it('builds one autocall insert per non-final scheduled date, numbered from 1', () => {
    const packet = buildReconciliationPacket([calledEntry()], CTX)
    const n = packet.notes[0]
    assert.equal(n.insertObservations.length, 3)
    assert.deepEqual(n.insertObservations.map((o) => o.valuationDate), ['2026-01-05', '2026-04-06', '2026-07-06'])
    assert.deepEqual(n.insertObservations.map((o) => o.observationNumber), [1, 2, 3])
    assert.ok(n.insertObservations.every((o) => o.observationType === 'autocall'))
  })

  it('numbers past any autocall row that already exists rather than colliding', () => {
    const note = makeNote({ observations: [...makeNote().observations, obs(4, 'autocall', '2026-01-05')] })
    assert.equal(nextAutocallObservationNumber(note), 5)
    assert.equal(nextAutocallObservationNumber(makeNote()), 1)
  })

  it('voids every post-call row - stored AND newly inserted - and nothing earlier', () => {
    const packet = buildReconciliationPacket([calledEntry()], CTX)
    const keys = packet.notes[0].cancelObservations.map((c) => `${c.observationType}@${c.valuationDate}`).sort()
    assert.deepEqual(keys, ['autocall@2026-07-06', 'coupon@2026-07-06', 'final@2026-10-05'])
    assert.ok(!keys.some((k) => k.includes('2026-01-05')), 'a pre-call row is never voided')
    assert.ok(!keys.includes('coupon@2026-04-06'), 'the call-date coupon is never voided')
  })

  it('names the call-date coupon as preserved, with the status it was reviewed in', () => {
    const packet = buildReconciliationPacket([calledEntry()], CTX)
    assert.deepEqual(packet.notes[0].preserveObservations, [
      { observationType: 'coupon', valuationDate: '2026-04-06', expectedStatus: 'coupon_paid' },
    ])
  })

  it('carries the call-date evidence and the binding leg', () => {
    const packet = buildReconciliationPacket([calledEntry()], CTX)
    const r = packet.notes[0].autocallResult
    assert.ok(r)
    assert.equal(r.valuationDate, '2026-04-06')
    assert.equal(r.observedSource, 'persisted_snapshot')
    assert.deepEqual(r.observedLevels, { 'AAA Index': 101, 'BBB Index': 205 })
    assert.equal(r.reviewRequired, false)
    assert.equal(packet.notes[0].evidence.length, 2)
  })

  it('archives at the contractual call date, not the correction date', () => {
    const packet = buildReconciliationPacket([calledEntry()], CTX)
    assert.equal(packet.notes[0].correctedArchivedAt, '2026-04-06T00:00:00.000Z')
    assert.equal(archivedAtForCallDate('2026-04-06'), '2026-04-06T00:00:00.000Z')
  })

  it('includes an unchanged note, and proposes nothing for it beyond its schedule', () => {
    const packet = buildReconciliationPacket([calledEntry(), untouchedEntry()], CTX)
    const b = packet.notes[1]
    assert.equal(b.classification, 'not_called')
    assert.equal(b.correctedStatus, b.expectedStatus)
    assert.equal(b.autocallResult, null)
    assert.equal(b.cancelObservations.length, 0)
    assert.equal(b.insertObservations.length, 2, 'its contractual schedule is still completed')
    assert.equal(b.correctedArchivedAt, null)
  })

  it('records settlement for audit but never as a corrected note state', () => {
    const packet = buildReconciliationPacket([calledEntry()], CTX)
    assert.equal(packet.notes[0].settlement, 'settled')
    assert.equal(packet.notes[0].correctedStatus, 'autocalled')
    assert.ok(!Object.keys(packet.notes[0]).includes('settlementStatus'))
  })

  it('counts exactly what the packet contains', () => {
    const packet = buildReconciliationPacket([calledEntry(), untouchedEntry()], CTX)
    assert.deepEqual(packet.expectedCounts, {
      observationsInserted: 5,
      observationsAutocalled: 1,
      observationsCancelled: 3,
      notesCorrected: 1,
      notesUnchanged: 1,
    })
    assert.deepEqual(validateReconciliationPacket(packet), [])
  })

  it('never proposes a correction from an unknown outcome', () => {
    const note = makeNote()
    const map = new Map<string, ResolvedValuationClose[]>([['2026-04-06', closes('2026-04-06', null, 205)]])
    const r = reconcileNote({ note, closesByDate: map, asOf: '2026-09-07' })
    assert.equal(r.classification, 'insufficient_data')
    const packet = buildReconciliationPacket([{ note, result: r }], CTX)
    assert.equal(packet.notes[0].correctedStatus, 'active')
    assert.equal(packet.notes[0].autocallResult, null)
    assert.equal(packet.notes[0].cancelObservations.length, 0)
  })
})

describe('R13.7B3.1 B - deterministic packet identity', () => {
  it('hashes identically across independent builds of the same content', () => {
    const a = buildReconciliationPacket([calledEntry(), untouchedEntry()], CTX)
    const b = buildReconciliationPacket([calledEntry(), untouchedEntry()], CTX)
    assert.equal(a.packetHash, b.packetHash)
    assert.equal(a.packetHash.length, 64)
  })

  it('is insensitive to key order but sensitive to content', () => {
    const a = buildReconciliationPacket([calledEntry()], CTX)

    // Same content, every object's keys inserted in the opposite order.
    const reverseKeys = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reverseKeys)
      if (v && typeof v === 'object') {
        const src = v as Record<string, unknown>
        const out: Record<string, unknown> = {}
        for (const k of Object.keys(src).reverse()) out[k] = reverseKeys(src[k])
        return out
      }
      return v
    }
    const reordered = reverseKeys(a) as ReconciliationPacket
    assert.notEqual(JSON.stringify(reordered), JSON.stringify(a), 'the fixture really is reordered')
    assert.equal(canonicalizeReconciliationPacket(reordered), canonicalizeReconciliationPacket(a))
    assert.equal(hashReconciliationPacket(reordered), a.packetHash)

    const changed: ReconciliationPacket = { ...a, notes: [{ ...a.notes[0], correctedStatus: 'matured' }] }
    assert.notEqual(hashReconciliationPacket(changed), a.packetHash)
  })

  it('changes when the operation id or actor changes', () => {
    const a = buildReconciliationPacket([calledEntry()], CTX)
    const b = buildReconciliationPacket([calledEntry()], { ...CTX, operationId: 'op-other' })
    const c = buildReconciliationPacket([calledEntry()], { ...CTX, actor: 'Someone Else' })
    assert.notEqual(a.packetHash, b.packetHash)
    assert.notEqual(a.packetHash, c.packetHash)
  })

  it('excludes the hash field from its own input', () => {
    const a = buildReconciliationPacket([calledEntry()], CTX)
    assert.ok(!canonicalizeReconciliationPacket(a).includes(a.packetHash))
    assert.equal(hashReconciliationPacket(a), a.packetHash)
  })
})

describe('R13.7B3.1 C - local packet validation', () => {
  const base = () => buildReconciliationPacket([calledEntry(), untouchedEntry()], CTX)

  it('rejects a tampered hash', () => {
    assert.ok(validateReconciliationPacket({ ...base(), packetHash: 'deadbeef' })
      .some((e) => e.includes('packetHash does not match')))
  })

  it('rejects counts that disagree with the content', () => {
    const p = base()
    p.expectedCounts.observationsInserted = 4
    assert.ok(validateReconciliationPacket(p).some((e) => e.includes('observationsInserted')))
  })

  it('rejects a correction to autocalled with no call-date result', () => {
    const p = base()
    p.notes[0].autocallResult = null
    assert.ok(validateReconciliationPacket(p).some((e) => e.includes('without a call-date result')))
  })

  it('rejects a call-date result on a note that is not being called', () => {
    const p = base()
    p.notes[1].autocallResult = { ...p.notes[0].autocallResult! }
    assert.ok(validateReconciliationPacket(p).some((e) => e.includes('not corrected to autocalled')))
  })

  it('rejects a missing operationId or actor', () => {
    assert.ok(validateReconciliationPacket({ ...base(), operationId: '' }).some((e) => e.includes('operationId')))
    assert.ok(validateReconciliationPacket({ ...base(), actor: '  ' }).some((e) => e.includes('actor')))
  })
})

describe('R13.7B3.1 D - the migration is minimum-privilege and non-dynamic', () => {
  const c = sqlCode(MIGRATION)

  it('creates the apply function as SECURITY INVOKER, never DEFINER', () => {
    assert.match(c, /create or replace function public\.nmi_apply_structured_note_reconciliation\(p_packet jsonb\)/)
    assert.match(c, /security invoker/)
    assert.doesNotMatch(c, /security definer/)
  })

  it('pins search_path to empty and schema-qualifies its tables', () => {
    assert.match(c, /set search_path = ''/)
    for (const t of ['public.structured_notes', 'public.structured_note_observations', 'public.structured_note_monitoring_runs']) {
      assert.ok(c.includes(t), `${t} is schema-qualified`)
    }
  })

  it('revokes EXECUTE from public, anon and authenticated and grants only service_role', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      assert.match(c, new RegExp(`revoke all on function public\\.nmi_apply_structured_note_reconciliation\\(jsonb\\) from ${role}`))
    }
    assert.match(c, /grant execute on function public\.nmi_apply_structured_note_reconciliation\(jsonb\) to service_role/)
    assert.doesNotMatch(c, /grant execute on function public\.nmi_apply_structured_note_reconciliation\(jsonb\) to (anon|authenticated|public)/)
  })

  it('contains no dynamic SQL at all', () => {
    assert.doesNotMatch(c, /execute\s+format\s*\(/i, 'no format()-built statement')
    assert.doesNotMatch(c, /execute\s+'/i, 'no string-built statement')
  })

  it('serializes on a transaction-scoped advisory lock', () => {
    assert.match(c, /pg_advisory_xact_lock/)
    assert.doesNotMatch(c, /pg_advisory_lock\s*\(/, 'a session-scoped lock would leak past the transaction')
  })

  it('enforces both identity indexes', () => {
    assert.match(c, /create unique index if not exists sn_observations_contract_identity_uidx[\s\S]*?\(note_id, observation_type, valuation_date\)/)
    assert.match(c, /create unique index if not exists sn_monitoring_runs_operation_uidx/)
    assert.match(c, /metadata ->> 'operationId'/)
  })

  it('refuses to create the identity index over already-duplicated data', () => {
    assert.match(c, /having count\(\*\) > 1/)
    assert.match(c, /cannot enforce contractual observation identity/)
  })

  it('writes its audit record to the approved administrator-only sink', () => {
    assert.match(c, /insert into public\.structured_note_monitoring_runs/)
    assert.match(c, /'backfill'/)
    assert.doesNotMatch(c, /create table/i, 'no parallel audit table was invented')
  })

  it('carries no note-specific production data (section 17)', () => {
    for (const isin of [
      'XS3288738696', 'XS3288776431', 'XS3165117832', 'XS3165032924', 'XS3164820824',
      'XS3164749858', 'XS3180975347', 'XS3376583269', 'XS3346439303',
    ]) {
      assert.ok(!MIGRATION.includes(isin), `${isin} must never be embedded in a migration`)
    }
    assert.doesNotMatch(MIGRATION, /202\d-\d\d-\d\d/, 'no valuation date is hard-coded')
  })

  it('asserts its own postconditions in-database', () => {
    assert.match(c, /must be SECURITY INVOKER, not DEFINER/)
    assert.match(c, /does not pin search_path/)
    assert.match(c, /anon can execute the reconciliation apply function/)
    assert.match(c, /structured_note_monitoring_runs no longer administrator-only/)
  })
})

describe('R13.7B3.1 E - the apply function validates before it mutates', () => {
  const c = sqlCode(MIGRATION)

  it('locks each note row before checking its pre-state', () => {
    assert.match(c, /from public\.structured_notes\s+where id = v_note_id\s+for update/)
  })

  it('refuses a stale note status, archived_at, cancel target and preserve target', () => {
    for (const msg of [
      'stale packet: note % is in status %',
      'stale packet: note % is already archived at %',
      'stale packet: note % archived_at is %',
      'stale packet: note % has no % observation on % in status % to cancel',
      'stale packet: preserved % observation for note % on % is not in status %',
      'stale packet: an autocall observation already exists for note % on %',
    ]) {
      assert.ok(c.includes(msg), `missing stale-state guard: ${msg}`)
    }
  })

  it('guards every cancellation by the exact status the packet reviewed', () => {
    assert.match(c, /and o\.status = v_obs ->> 'expectedStatus'/)
    assert.match(c, /matched % rows in status %, expected exactly 1/)
  })

  it('asserts the supplied counts as a postcondition', () => {
    for (const k of ['observationsInserted', 'observationsAutocalled', 'observationsCancelled', 'notesCorrected']) {
      assert.ok(c.includes(`v_expected ->> '${k}'`), `no postcondition for ${k}`)
    }
  })

  it('re-checks preserved rows AFTER mutating', () => {
    assert.match(c, /preserved % observation for note % on % changed during apply/)
  })

  it('never invents a contractual outcome of its own', () => {
    assert.doesNotMatch(c, /barrier_level|worst_of|evaluate/i)
    assert.ok(!c.includes('structured_note_price_snapshots'), 'the apply function reads no prices')
  })

  it('is idempotent by operation id and refuses id reuse with different content', () => {
    assert.match(c, /'already_applied'/)
    assert.match(c, /was already applied with a different packet hash/)
  })

  it('does not persist settlement or notional (section 11)', () => {
    assert.doesNotMatch(c, /issue_size/i, 'the apply function never writes notional')
    assert.doesNotMatch(c, /settlement_status/i, 'no second settlement state model')
  })
})

describe('R13.7B3.1 F - the orchestrator cannot apply by accident', () => {
  const c = code(ORCHESTRATOR)

  it('defaults to validate-only', () => {
    assert.match(c, /const apply = process\.argv\.includes\('--apply'\)/)
    assert.match(c, /VALIDATE ONLY/)
    assert.match(c, /if \(!apply\)/)
  })

  it('requires an operation id and a named actor in both modes', () => {
    assert.match(c, /if \(!operationId\?\.trim\(\)\) fail\(/)
    assert.match(c, /if \(!actor\?\.trim\(\)\) fail\(/)
  })

  it('requires the expected project ref, and stops on a mismatch', () => {
    assert.match(c, /--expect-project-ref is required to apply/)
    assert.match(c, /if \(expectRef !== projectRef\)/)
    assert.match(c, /Refusing to apply/)
  })

  it('requires the typed confirmation token', () => {
    assert.match(c, /APPLY_CONFIRMATION_TOKEN = 'APPLY-RECONCILIATION'/)
    assert.match(c, /if \(confirm !== APPLY_CONFIRMATION_TOKEN\)/)
  })

  it('prints the target project ref before doing anything', () => {
    const refLine = c.indexOf('target Supabase project ref')
    const rpcLine = c.indexOf('client.rpc(')
    assert.ok(refLine > 0 && refLine < rpcLine, 'the target must be printed before the write')
  })

  it('performs exactly one write, through the atomic RPC, with no fallback', () => {
    assert.equal((c.match(/\.rpc\(/g) ?? []).length, 1, 'exactly one RPC call')
    assert.match(c, /client\.rpc\(APPLY_RPC, \{ p_packet: packet \}\)/)
    assert.doesNotMatch(c, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/, 'no per-table write path exists')
    assert.match(c, /does not retry and does not fall back to sequential writes/)
  })

  it('stops rather than guessing when any outcome is unknown or ambiguous', () => {
    assert.match(c, /summary\.insufficient_data > 0 \|\| summary\.contract_ambiguous > 0/)
    assert.match(c, /never written as called or not-called/)
  })

  it('creates no notification - section 12 keeps that outside the core transaction', () => {
    assert.doesNotMatch(c, /from\('notifications'\)/)
    assert.match(c, /SEPARATE, idempotent step/)
  })

  it('reports the exact database result rather than its own expectation', () => {
    assert.match(c, /JSON\.stringify\(data, null, 2\)/)
  })
})

describe('R13.7B3.1 G - the tooling actually runs under plain node', () => {
  const ROOT = process.cwd()

  /** The reconciliation tooling's own import closure. */
  const CLOSURE = [
    'scripts/reconcile/structuredNotesReconcile.ts',
    'scripts/reconcile/applyStructuredNotesReconciliation.ts',
    'src/lib/structuredNotes/valuationCloseResolver.ts',
    'src/lib/structuredNotes/reconciliation.ts',
    'src/lib/structuredNotes/reconciliationPacket.ts',
    'src/lib/structuredNotes/valuationClose.ts',
    'src/lib/structuredNotes/contractualEvents.ts',
    'src/lib/structuredNotes/marketDate.ts',
    'src/lib/db/repositories/structuredNotesRepository.ts',
    'src/lib/providers/market/yahooHistoryProvider.ts',
  ]

  it('has no extensionless relative import anywhere in that closure', () => {
    const offenders: string[] = []
    for (const rel of CLOSURE) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8')
      const re = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+['"](\.[^'"]*)['"]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        if (!/\.(ts|tsx|js|mjs|json)$/.test(m[1])) offenders.push(`${rel} -> ${m[1]}`)
      }
    }
    assert.deepEqual(offenders, [], 'Node ESM adds no extension; these would fail at runtime')
  })

  it('documents plain node, not a runner that is not a dependency', () => {
    assert.doesNotMatch(RUNNER, /npx tsx/, 'tsx is not a dependency of this repository')
    assert.doesNotMatch(ORCHESTRATOR, /npx tsx/)
    assert.match(RUNNER, /node scripts\/reconcile\/structuredNotesReconcile\.ts/)
  })

  it('left the read-only runner read-only', () => {
    const c = code(RUNNER)
    assert.doesNotMatch(c, /\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/)
    assert.doesNotMatch(c, /--apply|--write/)
  })

  it('keeps the node:crypto packet module out of every client bundle', () => {
    assert.match(PACKET_MODULE, /from 'node:crypto'/)
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = path.join(dir, e)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.tsx?$/.test(p)) continue
        if (readFileSync(p, 'utf8').includes('reconciliationPacket')) {
          offenders.push(path.relative(ROOT, p).replace(/\\/g, '/'))
        }
      }
    }
    walk(path.join(ROOT, 'src', 'app'))
    walk(path.join(ROOT, 'src', 'components'))
    assert.deepEqual(offenders, [], 'no route or component may import the tooling-only packet module')
  })
})

describe('R13.7B3.1 H - the hermetic suite proves what TypeScript cannot', () => {
  it('is wired to run in the isolated database validation workflow', () => {
    const wf = readFileSync('.github/workflows/r13-family-portfolio-db-validation.yml', 'utf8')
    assert.match(wf, /supabase test db/, 'every file under supabase/tests/database runs there')
    assert.match(wf, /supabase db reset/, 'the full migration chain applies from clean')
  })

  it('proves rollback with a LATE failure, after real mutations happened', () => {
    assert.match(PGTAP, /late-fail/)
    assert.match(PGTAP, /ROLLBACK: not one of the 5 inserted autocall rows survived/)
    assert.match(PGTAP, /ROLLBACK: the audit record did not survive/)
    assert.match(PGTAP, /ROLLBACK: the call-date coupon result is untouched/)
  })

  it('covers authorization, idempotency, staleness and duplicate identity', () => {
    for (const claim of [
      'anon calling the apply function is refused outright',
      'a structured_notes-granted member cannot execute the apply function',
      're-running the SAME operation reports already_applied',
      'the retry wrote no second audit record',
      'a second audit row for the same operation id violates the unique index',
      'a packet whose expected note status no longer matches is refused',
      'a duplicate (note, type, valuation date) observation is impossible',
      'a coupon is not lost because the note also called',
      'an administrator CAN read the reconciliation audit record',
      'a structured_notes-granted member cannot read the reconciliation audit record',
    ]) {
      assert.ok(PGTAP.includes(claim), `hermetic suite is missing: ${claim}`)
    }
  })

  it('uses only throwaway fixtures - no production identity or ISIN', () => {
    for (const isin of ['XS3288738696', 'XS3164820824', 'XS3180975347', 'XS3376583269', 'XS3346439303']) {
      assert.ok(!PGTAP.includes(isin), `${isin} must not appear in a test fixture`)
    }
    assert.match(PGTAP, /rollback;\s*$/, 'the suite rolls its fixtures back')
  })
})
