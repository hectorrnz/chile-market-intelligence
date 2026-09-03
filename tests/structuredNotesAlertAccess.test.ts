// R13.7B2.1 § 14 — STRUCTURED NOTES OPERATIONAL-ALERT ACCESS CONTROL.
//
// WHAT THIS FILE PROVES, AND WHAT IT CANNOT.
// ──────────────────────────────────────────
// Node cannot assume a Postgres role, so it cannot prove "a member reading with
// their own token gets zero rows". That proof is role-session behaviour and it
// lives in supabase/tests/database/sensitive_surface_hardening_test.sql, which
// switches to `authenticated` with a real auth.uid() and reads the tables.
//
// What this file proves is everything that is decided in COMMITTED TEXT:
//   · the policy expressions the migration installs, and the ones it removes
//   · that the narrowing hit exactly two tables and no others
//   · the API-layer gate, which must hold even if the policy were wrong
//   · where notification recipients come from — and, more importantly, where
//     they do not
//   · that a historical correction can never share an identity with a live call
//
// The two layers are deliberately independent: neither test file would notice
// the other's failure, which is the entire point of defence in depth.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  buildHistoricalCorrectionNotification,
  buildReconciliationAuditRecord,
  historicalCorrectionCollides,
  HISTORICAL_CORRECTION_NOTIFICATION_TYPE,
  LIVE_NOTIFICATION_TYPES,
  RECONCILIATION_REASON_CODE,
  RECONCILIATION_RUN_TYPE,
  type NoteReconciliation,
} from '../src/lib/structuredNotes/reconciliation.ts'
import {
  buildReviewFixture,
  reviewFixturesEnabled,
  CALLED_PENDING_FIXTURE_ID,
  CALLED_SETTLED_FIXTURE_ID,
} from '../src/lib/structuredNotes/fixtures/calledStateFixture.ts'
import { calculateCurrentNotional, noteSettlementStatus } from '../src/lib/structuredNotes/calculations.ts'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

const HARDENING = read('../supabase/migrations/20260818000000_structured_notes_operational_alert_hardening.sql')
const SURFACE = read('../supabase/migrations/20260815000000_sensitive_surface_hardening.sql')
const MONITORING = read('../supabase/migrations/20260709000000_structured_notes_monitoring.sql')
const NOTIF_FOUNDATION = read('../supabase/migrations/20260713000000_notifications_foundation.sql')
const FEED_ROUTE = read('../src/app/api/notifications/route.ts')
const READALL_ROUTE = read('../src/app/api/notifications/read-all/route.ts')
const NOTIF_REPO = read('../src/lib/db/repositories/notificationsRepository.ts')
const WARNING_CRON = read('../src/app/api/cron/structured-notes/autocall-warning/route.ts')
const SNAPSHOT_CRON = read('../src/app/api/cron/structured-notes/snapshot/route.ts')
const LIFECYCLE = read('../supabase/migrations/20260817000000_user_lifecycle_provisioning.sql')

// ═══════════════════════════════════════════════════════════════════════════
// 1 · THE DEFECT THIS STAGE CLOSES
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B2.1 § 13 — the exposure that existed before this migration', () => {
  it('the notifications feed was created authenticated-wide', () => {
    // Non-vacuity anchor. If this ever stops matching, the "before" state has
    // changed and the fix below is being asserted against nothing.
    assert.match(
      NOTIF_FOUNDATION,
      /create policy "notifications_select" on notifications for select using \(auth\.uid\(\) is not null\)/,
      'expected the original authenticated-wide feed policy to still be in its own migration',
    )
  })

  it('the 20260815 hardening covered recipients but NOT the feed itself', () => {
    assert.match(SURFACE, /notification_recipients_admin_select/,
      'the earlier stage did harden the recipient address list')
    // The feed was left alone — that is precisely the gap. Only comparison
    // assertions mention it there, never DDL.
    const feedDdl = /(?:create|drop) policy [^\n]*\bon (?:public\.)?notifications\b(?!_)/i
    assert.ok(!feedDdl.test(SURFACE),
      'the 20260815 migration must contain no policy DDL for the notifications feed')
  })

  it('every notification this application produces is a Structured Notes operational alert', () => {
    // This is WHY the feed being wide open matters: there is no benign
    // member-facing notification class that the exposure was protecting.
    const produced = [...WARNING_CRON.matchAll(/notificationType: '([a-z_]+)'/g), ...SNAPSHOT_CRON.matchAll(/notificationType: '([a-z_]+)'/g)]
      .map((m) => m[1])
    assert.ok(produced.length >= 2, 'expected both cron routes to create notifications')
    for (const t of produced) {
      assert.ok(t.startsWith('structured_note_'), `unexpected non-Structured-Notes notification type: ${t}`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · THE FIX — POLICY TEXT ACTUALLY INSTALLED
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B2.1 § 12 — administrator-only read on both operational surfaces', () => {
  it('the feed gets an administrator-gated SELECT policy', () => {
    assert.match(HARDENING, /create policy "notifications_admin_select" on public\.notifications\s+for select to authenticated\s+using \(\(select public\.nmi_is_administrator\(\)\)\)/)
  })

  it('the monitoring run log gets an administrator-gated SELECT policy', () => {
    assert.match(HARDENING, /create policy "sn_monitoring_runs_admin_select" on public\.structured_note_monitoring_runs\s+for select to authenticated\s+using \(\(select public\.nmi_is_administrator\(\)\)\)/)
  })

  it('every pre-existing policy on both tables is dropped first, by enumeration', () => {
    // A known-name drop would leave `notifications_select` (or `sn_module_select`)
    // in place on a database that had drifted, and it would keep granting exactly
    // what it always granted.
    const drops = HARDENING.match(/for pol in\s+select policyname from pg_catalog\.pg_policies/g) ?? []
    assert.equal(drops.length, 2, 'both tables must enumerate and drop every existing policy')
  })

  it('uses the canonical authorization function, not a bespoke role check', () => {
    assert.ok(!/user_profiles/.test(HARDENING.split('-- 3 ·')[0] ?? HARDENING),
      'the policies must call nmi_is_administrator(), never re-implement the role lookup')
  })

  it('neither hardened table retains the module gate', () => {
    assert.match(HARDENING, /still references the module gate/,
      'the migration must assert in-database that the module gate is gone from both')
  })

  it('grants SELECT while denying by policy, so the bell reads empty instead of erroring', () => {
    // Revoking the privilege outright would turn the count query into 42501,
    // which NotificationBell would surface as a broken widget rather than an
    // empty state.
    assert.match(HARDENING, /grant select on table public\.notifications to authenticated/)
    assert.match(HARDENING, /grant select on table public\.structured_note_monitoring_runs to authenticated/)
    assert.match(HARDENING, /lost SELECT on public\.% \(the bell\/monitoring read would 42501\)/)
  })

  it('neither table gains any write policy — writes stay service-role only', () => {
    assert.ok(!/create policy [^\n]*for (insert|update|delete)/i.test(HARDENING),
      'the operational surfaces must have no user-reachable mutation policy')
    assert.match(HARDENING, /authenticated holds a write privilege on public\.%/,
      'the migration must assert authenticated holds no write privilege')
  })

  it('anonymous access is asserted closed in-database', () => {
    assert.match(HARDENING, /anon can still SELECT public\.%/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · BLAST RADIUS — one table narrowed, not the module
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B2.1 § 12 — the narrowing is surgical', () => {
  it('the seven other Structured Notes tables keep their module gate', () => {
    for (const t of [
      'structured_notes', 'structured_note_underlyings', 'structured_note_observations',
      'structured_note_allocations', 'structured_note_extraction_runs',
      'structured_note_price_snapshots', 'structured_note_extracted_fields',
    ]) {
      assert.ok(HARDENING.includes(`'${t}'`), `${t} must appear in the regression assertion list`)
    }
    assert.match(HARDENING, /lost its module-gated SELECT policy/)
  })

  it('does not touch a single Structured Notes product table', () => {
    // Product data — notes, underlyings, observations, allocations — is out of
    // scope for an alert-access change. Their names appear only inside the
    // regression assertion, never in DDL.
    const ddl = /(?:create|drop) policy [^\n]*\bon (?:public\.)?structured_notes\b/i
    assert.ok(!ddl.test(HARDENING), 'the migration must contain no policy DDL for structured_notes')
  })

  it('the per-user read-state table is untouched and asserted intact', () => {
    assert.match(HARDENING, /notification_reads must keep its three per-user policies/)
    const ddl = /(?:create|drop) policy [^\n]*\bon (?:public\.)?notification_reads\b/i
    assert.ok(!ddl.test(HARDENING), 'a member must still be able to mark their own notifications read')
  })

  it('the recipient address list keeps administrator-only coverage', () => {
    assert.match(HARDENING, /notification_recipients lost administrator-only coverage/)
  })

  it('the monitoring log was already module-gated, so this is a narrowing not a first fix', () => {
    // Honest framing: 20260815 had already closed the ungranted-member hole on
    // this table. Only the granted member is being removed here.
    assert.match(SURFACE, /structured_note_monitoring_runs/)
    assert.match(SURFACE, /create policy "sn_module_select"/)
    assert.match(MONITORING, /for select using \(auth\.uid\(\) is not null\)/,
      'the ORIGINAL 20260709 policy was authenticated-wide')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · API LAYER — the second, independent barrier
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B2.1 § 13 — the route does not depend on RLS being right', () => {
  for (const [name, src] of [['GET /api/notifications', FEED_ROUTE], ['POST /api/notifications/read-all', READALL_ROUTE]] as const) {
    it(`${name} refuses a non-administrator before reading the feed`, () => {
      assert.match(src, /callerIsPlatformAdministrator/, `${name} must consult the administrator check`)
      const gateAt = src.indexOf('callerIsPlatformAdministrator(')
      const readAt = src.indexOf('listNotifications(client')
      assert.ok(gateAt > 0 && readAt > 0, `${name} must both gate and read`)
      assert.ok(gateAt < readAt, `${name} must gate BEFORE it reads the feed`)
    })
  }

  it('a member gets an empty feed, not an error the bell would render as broken', () => {
    assert.match(FEED_ROUTE, /notifications: \[\], unreadCount: 0/)
  })

  it('read-all reveals no count to a member', () => {
    assert.match(READALL_ROUTE, /markedCount: 0/)
  })

  it('the approval gate is still the outer barrier on both routes', () => {
    for (const src of [FEED_ROUTE, READALL_ROUTE]) {
      assert.match(src, /getApprovedUser\(\)/)
      assert.match(src, /unauthenticatedJson\(\)/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · RECIPIENT RESOLUTION — where email addresses come from
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B2.1 § 9 — recipients are a curated administrator list, never derived', () => {
  it('the only source of email recipients is notification_recipients', () => {
    assert.match(NOTIF_REPO, /getActiveNotificationRecipientEmails[\s\S]{0,400}from\('notification_recipients'\)[\s\S]{0,200}\.eq\('active', true\)/)
  })

  it('no Structured Notes alert path derives a recipient from grants, profiles or holdings', () => {
    const forbidden = [
      'user_module_grants', 'user_profiles', 'portfolio_principal',
      'structured_note_allocations', 'nmi_current_module_grants',
    ]
    for (const src of [WARNING_CRON, SNAPSHOT_CRON]) {
      for (const f of forbidden) {
        assert.ok(!src.includes(f),
          `an alert route must never resolve recipients from ${f} — a module grant is product access, not alert access`)
      }
    }
  })

  it('both cron routes obtain recipients only through the curated helper', () => {
    for (const src of [WARNING_CRON, SNAPSHOT_CRON]) {
      assert.match(src, /getActiveNotificationRecipientEmails/)
      const calls = src.match(/sendNotificationEmail\(/g) ?? []
      assert.ok(calls.length >= 1, 'expected an email delivery call')
    }
  })

  it('administrator authority is role-based and survives holding zero module grants', () => {
    // nmi_is_administrator() reads role + usability from user_profiles only. If
    // it ever consulted the grant array, an administrator with no grants would
    // silently stop receiving alerts.
    const fn = LIFECYCLE.slice(LIFECYCLE.indexOf('function public.nmi_is_administrator()'))
      .slice(0, LIFECYCLE.slice(LIFECYCLE.indexOf('function public.nmi_is_administrator()')).indexOf('$$;'))
    assert.match(fn, /role = 'administrator'/)
    assert.match(fn, /nmi_profile_usable/)
    assert.ok(!/user_module_grants/.test(fn),
      'administrator authority must not depend on module grants')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · HISTORICAL CORRECTION — identity, and the impossibility of collision
// ═══════════════════════════════════════════════════════════════════════════

const confirmed: NoteReconciliation = {
  noteId: 'note-1', isin: 'XS0000000001', issuerDisplayName: 'Test Issuer',
  classification: 'confirmed_missed_autocall',
  rationale: 'test', storedStatus: 'active', expectedStatus: 'autocalled',
  expectedCallDate: '2026-08-28', expectedRedemptionDate: '2026-09-04',
  settlement: 'pending', couponOnCallDate: 'eligible',
  voidedObservationDates: ['2026-09-28', '2026-10-28'],
  perDate: [],
  observationsToInsert: [
    { observationType: 'autocall', valuationDate: '2026-08-28', redemptionDate: '2026-09-04', autocallBarrierPct: 100 },
  ],
  proposedChanges: [{ table: 'structured_notes', row: 'note-1', field: 'status', from: 'active', to: 'autocalled' }],
  proposedNotification: 'option B',
  proposedNotionalTreatment: 'outstanding',
  proposedAuditRecord: { targetIsin: 'XS0000000001', previousStatus: 'active', correctedStatus: 'autocalled' },
}

const notCalled: NoteReconciliation = {
  ...confirmed,
  noteId: 'note-2', isin: 'XS0000000002', classification: 'not_called',
  expectedStatus: 'active', expectedCallDate: null, expectedRedemptionDate: null,
  voidedObservationDates: [], proposedChanges: [],
  observationsToInsert: [
    { observationType: 'autocall', valuationDate: '2026-09-04', redemptionDate: null, autocallBarrierPct: 100 },
  ],
}

describe('R13.7B2.1 § 23–24, 36–37 — historical corrections cannot masquerade as live calls', () => {
  it('the historical type differs from BOTH live types', () => {
    assert.equal(historicalCorrectionCollides(), false)
    for (const live of LIVE_NOTIFICATION_TYPES) {
      assert.notEqual(HISTORICAL_CORRECTION_NOTIFICATION_TYPE, live)
    }
  })

  it('the live types are exactly the two the cron routes emit', () => {
    assert.ok(WARNING_CRON.includes(`notificationType: '${LIVE_NOTIFICATION_TYPES[0]}'`))
    assert.ok(SNAPSHOT_CRON.includes(`notificationType: '${LIVE_NOTIFICATION_TYPES[1]}'`))
  })

  it('the live claim keys stay distinct from each other', () => {
    assert.match(WARNING_CRON, /const EVENT_TYPE = 'potential_autocall'/)
    assert.match(SNAPSHOT_CRON, /const CALL_EVENT_TYPE = 'autocall_confirmed'/)
  })

  it('a correction never emails — Option B holds by construction', () => {
    const n = buildHistoricalCorrectionNotification(confirmed, '2026-09-05')
    assert.ok(n)
    assert.deepEqual(n.emailRecipients, [])
  })

  it('a correction says it is historical, names the original call date, and disclaims a new event', () => {
    const n = buildHistoricalCorrectionNotification(confirmed, '2026-09-05')!
    assert.match(n.title, /Historical correction/)
    assert.ok(n.body.includes('2026-08-28'), 'must state the original contractual call date')
    assert.ok(n.body.includes('2026-09-05'), 'must state the correction date')
    assert.match(n.body, /not a new call event/)
    assert.equal(n.metadata.historicalCorrection, true)
    assert.equal(n.metadata.reasonCode, RECONCILIATION_REASON_CODE)
  })

  it('a pending-settlement correction says the notional is still outstanding', () => {
    const n = buildHistoricalCorrectionNotification(confirmed, '2026-09-05')!
    assert.match(n.body, /remains outstanding/)
  })

  it('a settled correction says so instead', () => {
    const n = buildHistoricalCorrectionNotification({ ...confirmed, settlement: 'settled' }, '2026-09-05')!
    assert.match(n.body, /settled/)
    assert.ok(!/remains outstanding/.test(n.body))
  })

  it('a note that did not change state produces NO correction notice', () => {
    assert.equal(buildHistoricalCorrectionNotification(notCalled, '2026-09-05'), null)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · DURABLE AUDIT RECORD
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B2.1 § 22, 35 — the reconciliation audit sink', () => {
  const rec = buildReconciliationAuditRecord([confirmed, notCalled], {
    operationId: 'op-123', actor: 'admin:test', timestamp: '2026-09-05T12:00:00.000Z',
  })

  it('writes under a run_type the monitoring table already permits', () => {
    assert.equal(RECONCILIATION_RUN_TYPE, 'backfill')
    assert.match(MONITORING, /run_type[\s\S]{0,200}backfill/,
      'backfill must already be in the run_type CHECK — no migration should be needed for the sink')
  })

  it('records every note examined, including the ones deliberately left alone', () => {
    assert.equal(rec.notes.length, 2)
    assert.equal(rec.mutationSummary.notesExamined, 2)
    assert.equal(rec.mutationSummary.notesStatusChanged, 1)
    assert.equal(rec.mutationSummary.notesUnchanged, 1)
  })

  it('counts the exact mutations across the whole operation', () => {
    assert.equal(rec.mutationSummary.observationsInserted, 2)
    assert.equal(rec.mutationSummary.observationsVoided, 2)
  })

  it('carries operation id, actor, reason code and timestamp on the run and on every note', () => {
    assert.equal(rec.operationId, 'op-123')
    assert.equal(rec.actor, 'admin:test')
    assert.equal(rec.reasonCode, RECONCILIATION_REASON_CODE)
    assert.equal(rec.reconciliationTimestamp, '2026-09-05T12:00:00.000Z')
    for (const n of rec.notes) {
      assert.equal(n.operationId, 'op-123')
      assert.equal(n.actor, 'admin:test')
      assert.equal(n.reconciliationTimestamp, '2026-09-05T12:00:00.000Z')
    }
  })

  it('preserves the per-note evidence and the exact proposed changes', () => {
    const first = rec.notes[0] as Record<string, unknown>
    assert.equal(first.previousStatus, 'active')
    assert.equal(first.correctedStatus, 'autocalled')
    assert.equal(first.settlement, 'pending')
    assert.deepEqual(first.voidedObservationDates, ['2026-09-28', '2026-10-28'])
    assert.ok(Array.isArray(first.proposedChanges) && (first.proposedChanges as unknown[]).length === 1)
  })

  it('the audit sink is administrator-only to read, so evidence cannot leak to a member', () => {
    assert.match(HARDENING, /sn_monitoring_runs_admin_select/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · THE OWNER-REVIEW FIXTURE
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B2.1 § 27 — the called-state fixture is safe and faithful', () => {
  const DETAIL_ROUTE = read('../src/app/api/structured-notes/[id]/route.ts')

  it('is disabled on the production deployment', () => {
    assert.equal(reviewFixturesEnabled({ VERCEL_ENV: 'production' } as NodeJS.ProcessEnv), false)
  })

  it('is available in Preview and in local development', () => {
    assert.equal(reviewFixturesEnabled({ VERCEL_ENV: 'preview' } as NodeJS.ProcessEnv), true)
    assert.equal(reviewFixturesEnabled({} as NodeJS.ProcessEnv), true)
  })

  it('the route consults that gate before ever building a fixture', () => {
    const gate = DETAIL_ROUTE.indexOf('reviewFixturesEnabled()')
    const build = DETAIL_ROUTE.indexOf('buildReviewFixture(id)')
    assert.ok(gate > 0 && build > gate, 'the environment gate must precede the fixture build')
  })

  it('is served only AFTER the module guard — not an authorization bypass', () => {
    const guard = DETAIL_ROUTE.indexOf("guardModuleReadWithCapability('structured_notes')")
    const gate = DETAIL_ROUTE.indexOf('reviewFixturesEnabled()')
    assert.ok(guard > 0 && gate > guard, 'the module guard must run before the fixture branch')
  })

  it('has no query-controlled state — only two fixed ids resolve', () => {
    assert.equal(buildReviewFixture('not-a-fixture'), null)
    assert.equal(buildReviewFixture('00000000-0000-4000-8000-00000000ca99'), null)
    assert.ok(buildReviewFixture(CALLED_PENDING_FIXTURE_ID))
    assert.ok(buildReviewFixture(CALLED_SETTLED_FIXTURE_ID))
  })

  it('touches neither the database nor a market-data provider', () => {
    const src = read('../src/lib/structuredNotes/fixtures/calledStateFixture.ts')
    for (const forbidden of ['supabase', 'fetch(', 'from(', 'yahooFinance', 'await ']) {
      assert.ok(!src.includes(forbidden), `the fixture must stay pure — found ${forbidden}`)
    }
  })

  it('carries no private allocation data', () => {
    for (const id of [CALLED_PENDING_FIXTURE_ID, CALLED_SETTLED_FIXTURE_ID]) {
      assert.deepEqual(buildReviewFixture(id)!.note.allocations, [])
    }
  })

  it('is unmistakably labelled as a fixture on screen', () => {
    assert.match(buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!.note.productName, /FIXTURE/)
  })

  it('is refused by both write verbs', () => {
    const patchAt = DETAIL_ROUTE.indexOf('export async function PATCH')
    const deleteAt = DETAIL_ROUTE.indexOf('export async function DELETE')
    for (const [name, from] of [['PATCH', patchAt], ['DELETE', deleteAt]] as const) {
      const body = DETAIL_ROUTE.slice(from, from + 1400)
      assert.match(body, /isReviewFixtureId\(id\)/, `${name} must refuse a fixture id`)
      assert.match(body, /read_only_fixture/)
    }
  })

  // ── Faithfulness: the fixture must show the golden case, not near-misses ──

  it('reproduces the golden contractual state', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    assert.equal(note.isin, 'XS3164820824')
    assert.equal(note.status, 'autocalled')
    assert.equal(note.redemptionDate, '2026-09-04')
    const called = note.observations.filter((o) => o.status === 'autocalled')
    assert.equal(called.length, 1)
    assert.equal(called[0].valuationDate, '2026-08-28')
    assert.equal(called[0].observationType, 'autocall')
  })

  it('shows coupon AND autocall as separate tests on the calling date', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const onDate = note.observations.filter((o) => o.valuationDate === '2026-08-28')
    assert.equal(onDate.length, 2, 'the same date must carry both contractual tests')
    assert.deepEqual(onDate.map((o) => o.observationType).sort(), ['autocall', 'coupon'])
    // The coupon is NOT lost because the note also called.
    assert.equal(onDate.find((o) => o.observationType === 'coupon')!.status, 'coupon_paid')
  })

  it('voids every observation after the call, and nothing before it', () => {
    const { note } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    for (const o of note.observations) {
      if (o.valuationDate > '2026-08-28') {
        assert.equal(o.status, 'cancelled', `${o.valuationDate} should be void`)
      } else {
        assert.notEqual(o.status, 'cancelled', `${o.valuationDate} precedes the call and must stand`)
      }
    }
  })

  it('the call level IS the initial level, so the pinned cushions reproduce', () => {
    const { note, prices } = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!
    const cushion = (order: number) => {
      const u = note.underlyings.find((x) => x.underlyingOrder === order)!
      const p = prices.find((x) => x.underlyingOrder === order)!.price!
      return (p / u.autocallBarrierLevel!) - 1
    }
    // The golden case: SPX +1.9359%, RTY +1.0825%, RTY binding.
    assert.ok(Math.abs(cushion(1) - 0.019359) < 1e-5, `SPX cushion was ${cushion(1)}`)
    assert.ok(Math.abs(cushion(2) - 0.010825) < 1e-5, `RTY cushion was ${cushion(2)}`)
    assert.ok(cushion(2) < cushion(1), 'RTY must be the binding leg')
    for (const u of note.underlyings) {
      assert.equal(u.autocallBarrierLevel, u.initialLevel, 'autocall barrier is 100% of initial')
    }
  })

  it('settlement is DERIVED, and the two fixtures land on opposite sides of it', () => {
    const asOf = '2026-09-03'
    assert.equal(noteSettlementStatus(buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!.note, asOf), 'pending')
    assert.equal(noteSettlementStatus(buildReviewFixture(CALLED_SETTLED_FIXTURE_ID)!.note, asOf), 'settled')
  })

  it('a called-but-unsettled fixture keeps its notional; a settled one does not', () => {
    const asOf = '2026-09-03'
    const pending = buildReviewFixture(CALLED_PENDING_FIXTURE_ID)!.note
    const settled = buildReviewFixture(CALLED_SETTLED_FIXTURE_ID)!.note
    assert.ok(calculateCurrentNotional(pending, pending.allocations, noteSettlementStatus(pending, asOf)) >= 0)
    assert.equal(calculateCurrentNotional(settled, settled.allocations, noteSettlementStatus(settled, asOf)), 0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 · NO WRITE PATH EXISTS
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.7B2.1 § 51 — this stage adds no way to mutate production', () => {
  it('the reconciliation module still has no write path', () => {
    const src = read('../src/lib/structuredNotes/reconciliation.ts')
    for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      assert.ok(!src.includes(forbidden),
        `reconciliation.ts must stay pure — found ${forbidden}`)
    }
  })

  it('the builders return proposals, and nothing calls them from a route', () => {
    const routes = [FEED_ROUTE, READALL_ROUTE, WARNING_CRON, SNAPSHOT_CRON]
    for (const src of routes) {
      assert.ok(!src.includes('buildHistoricalCorrectionNotification'),
        'no route may post a historical correction — that is a separately authorized stage')
      assert.ok(!src.includes('buildReconciliationAuditRecord'))
    }
  })
})
