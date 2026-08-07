// R13.5 — draft review and publication lifecycle.
//
// NO PRIVATE SOURCE DATA. Every fixture below is invented; the STRUCTURES come
// from docs 02-05, the values do not. No workbook, no real holding, no real
// amount.
//
// WHAT THIS FILE PROVES AND WHAT IT CANNOT. The pure lifecycle rules, the
// refusal codes and the payload guards execute here. Atomicity, the partial
// unique index, the RPC privilege boundary and the RLS on `portfolio_commentary`
// are PostgreSQL behaviour and are proven only by the pgTAP suite in CI —
// asserting the SQL text here would prove the migration was written, not that it
// works. The static assertions below are therefore about STRUCTURE (a rule is
// present, a posture is not weakened), never a substitute for execution.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  resolvePublicationDate,
  isCalendarDate,
  applyEventClassifications,
  isClassifiableEventType,
  assertSingleCurrencyAggregate,
  validateEventClassifications,
  verifyPerCurrencySubtotals,
  spansMultipleCurrencies,
  assessPublishability,
  nextRevision,
  planPublication,
  planRollback,
  nextCommentaryRevision,
  normalizeCommentary,
  CLASSIFIABLE_EVENT_TYPES,
  MAX_COMMENTARY_LENGTH,
  PUBLICATION_LIFECYCLE_VERSION,
  type ExistingPublication,
} from '../src/lib/familyPortfolio/publication.ts'
import type { AlternativesEvent } from '../src/lib/familyPortfolio/alternatives/parseAlternatives.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const MIGRATION = 'supabase/migrations/20260810000000_family_portfolio_publication.sql'
const PUBLISH_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts'
const ROLLBACK_ROUTE = 'src/app/api/family-portfolio/admin/publications/[id]/rollback/route.ts'
const COMMENTARY_ROUTE = 'src/app/api/family-portfolio/admin/publications/[id]/commentary/route.ts'
const UPLOAD_DETAIL_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/route.ts'
const UPLOADS_ROUTE = 'src/app/api/family-portfolio/admin/uploads/route.ts'
const ADMIN_PAGE = 'src/app/family-portfolio/admin/page.tsx'
const PGTAP = 'supabase/tests/database/family_portfolio_entitlements_test.sql'

/** Strips comments so a rule can never be "satisfied" by prose about it. */
function codeOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|\s)--\s.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n')
}

/** Every `.ts`/`.tsx`/`.sql`/`.css`/`.md` file beneath `dir`, repo-relative. */
function allSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(join(ROOT, rel)).isDirectory()) allSources(rel, acc)
    else if (/\.(ts|tsx|sql|css|md)$/.test(entry)) acc.push(rel)
  }
  return acc
}

function event(overrides: Partial<AlternativesEvent> = {}): AlternativesEvent {
  return {
    investmentName: 'Fixture Fund I',
    sociedad: 'FIXTURE SOCIEDAD',
    currency: 'dolares',
    eventDate: '2026-03-31',
    amount: 1,
    eventType: 'unclassified',
    rawFill: null,
    resolvedHex: null,
    classificationMethod: null,
    sourceSheet: 'Alternatives',
    sourceCell: 'Alternatives!J9',
    sourceRow: 9,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Publication date — proposed, never asserted
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · publication date', () => {
  test('accepting the detected date needs no note', () => {
    const r = resolvePublicationDate({ detected: '2026-08-06' })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.date, '2026-08-06')
      assert.equal(r.overridden, false)
      assert.equal(r.overrideNote, null)
    }
  })

  test('confirming the SAME date is not an override', () => {
    const r = resolvePublicationDate({ detected: '2026-08-06', confirmed: '2026-08-06' })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.overridden, false)
  })

  test('a different confirmed date WITHOUT a note is refused', () => {
    const r = resolvePublicationDate({ detected: '2026-08-06', confirmed: '2026-07-31' })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'date_override_note_required')
  })

  test('a whitespace-only note does not satisfy the requirement', () => {
    const r = resolvePublicationDate({
      detected: '2026-08-06',
      confirmed: '2026-07-31',
      overrideNote: '   \t  ',
    })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'date_override_note_required')
  })

  test('a different confirmed date WITH a note is accepted and the note is kept', () => {
    const r = resolvePublicationDate({
      detected: '2026-08-06',
      confirmed: '2026-07-31',
      overrideNote: '  workbook recalculated on a later day  ',
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.date, '2026-07-31')
      assert.equal(r.overridden, true)
      assert.equal(r.overrideNote, 'workbook recalculated on a later day')
    }
  })

  test('no detected and no confirmed date is refused, never defaulted to today', () => {
    const r = resolvePublicationDate({ detected: null })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'no_publication_date')
  })

  test('a dataset with no detectable date publishes on an explicit confirmation alone', () => {
    // Alternatives carries no TODAY() column, so the administrator supplies the
    // date. That is a confirmation, not an override, so no note is required.
    const r = resolvePublicationDate({ detected: null, confirmed: '2026-08-06' })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.overridden, false)
  })

  test('a malformed or impossible date is refused', () => {
    for (const bad of ['06-08-2026', '2026-8-6', '2026-02-30', '2026-13-01', 'today', '']) {
      const r = resolvePublicationDate({ detected: null, confirmed: bad })
      assert.equal(r.ok, false, bad)
    }
  })

  test('isCalendarDate rejects non-strings and impossible days', () => {
    assert.equal(isCalendarDate('2026-08-06'), true)
    assert.equal(isCalendarDate('2024-02-29'), true)
    assert.equal(isCalendarDate('2026-02-29'), false)
    assert.equal(isCalendarDate(20260806), false)
    assert.equal(isCalendarDate(null), false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Administrator classification
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · administrator event classification', () => {
  test('unclassified is NOT an assignable type', () => {
    assert.equal(isClassifiableEventType('aporte'), true)
    assert.equal(isClassifiableEventType('unclassified'), false)
    assert.equal(isClassifiableEventType('made_up'), false)
    assert.ok(!(CLASSIFIABLE_EVENT_TYPES as readonly string[]).includes('unclassified'))
  })

  test('a decision resolves the matching cell and stamps administrator provenance', () => {
    const out = applyEventClassifications(
      [event({ sourceCell: 'Alternatives!J9' })],
      [{ sourceCell: 'Alternatives!J9', eventType: 'aporte' }],
    )
    assert.equal(out.events[0].eventType, 'aporte')
    assert.equal(out.events[0].classificationMethod, 'administrator')
    assert.deepEqual(out.unresolved, [])
  })

  test('decisions address a cell, so an unrelated event is untouched', () => {
    const out = applyEventClassifications(
      [event({ sourceCell: 'Alternatives!J9' }), event({ sourceCell: 'Alternatives!K9' })],
      [{ sourceCell: 'Alternatives!J9', eventType: 'dividendo' }],
    )
    assert.equal(out.events[1].eventType, 'unclassified')
    assert.deepEqual(out.unresolved, ['Alternatives!K9'])
  })

  test('an administrator decision NEVER overwrites a legend classification', () => {
    const legendClassified = event({
      sourceCell: 'Alternatives!J9',
      eventType: 'aporte',
      classificationMethod: 'legend_exact',
    })
    const out = applyEventClassifications(
      [legendClassified],
      [{ sourceCell: 'Alternatives!J9', eventType: 'distribucion' }],
    )
    assert.equal(out.events[0].eventType, 'aporte')
    assert.equal(out.events[0].classificationMethod, 'legend_exact')
    assert.deepEqual(out.ignoredAlreadyClassified, ['Alternatives!J9'])
  })

  test('a decision matching no event is reported, never silently dropped', () => {
    const out = applyEventClassifications(
      [event({ sourceCell: 'Alternatives!J9' })],
      [{ sourceCell: 'Alternatives!ZZ999', eventType: 'aporte' }],
    )
    assert.deepEqual(out.unmatched, ['Alternatives!ZZ999'])
    assert.deepEqual(out.unresolved, ['Alternatives!J9'])
  })

  test('the input array is not mutated', () => {
    const original = event({ sourceCell: 'Alternatives!J9' })
    applyEventClassifications([original], [{ sourceCell: 'Alternatives!J9', eventType: 'aporte' }])
    assert.equal(original.eventType, 'unclassified')
    assert.equal(original.classificationMethod, null)
  })
})

describe('R13.5 · classification submissions fail closed', () => {
  const unresolved = event({ sourceCell: 'Alternatives!J9' })
  const byLegend = event({
    sourceCell: 'Alternatives!K9',
    eventType: 'dividendo',
    classificationMethod: 'legend_exact',
  })

  test('a well-formed decision on an unresolved event is accepted', () => {
    assert.deepEqual(
      validateEventClassifications([unresolved], [{ sourceCell: 'Alternatives!J9', eventType: 'aporte' }]),
      [],
    )
  })

  test('two decisions for the SAME cell are refused, not silently last-wins', () => {
    const out = validateEventClassifications(
      [unresolved],
      [
        { sourceCell: 'Alternatives!J9', eventType: 'aporte' },
        { sourceCell: 'Alternatives!J9', eventType: 'distribucion' },
      ],
    )
    assert.equal(out.length, 1)
    assert.equal(out[0].code, 'duplicate_event_classification')
    assert.deepEqual(out[0].cells, ['Alternatives!J9'])
  })

  test('a cell this reparse never produced is refused', () => {
    const out = validateEventClassifications(
      [unresolved],
      [{ sourceCell: 'Alternatives!ZZ999', eventType: 'aporte' }],
    )
    assert.equal(out.length, 1)
    assert.equal(out[0].code, 'unknown_event_classification')
  })

  test('a legend-classified event cannot be reinterpreted from a request', () => {
    const out = validateEventClassifications(
      [byLegend],
      [{ sourceCell: 'Alternatives!K9', eventType: 'aporte' }],
    )
    assert.equal(out.length, 1)
    assert.equal(out[0].code, 'event_already_classified')
  })

  test('every rejection is reported at once', () => {
    const out = validateEventClassifications(
      [unresolved, byLegend],
      [
        { sourceCell: 'Alternatives!J9', eventType: 'aporte' },
        { sourceCell: 'Alternatives!J9', eventType: 'aporte' },
        { sourceCell: 'Alternatives!ZZ999', eventType: 'aporte' },
        { sourceCell: 'Alternatives!K9', eventType: 'aporte' },
      ],
    )
    assert.deepEqual(out.map((r) => r.code).sort(), [
      'duplicate_event_classification',
      'event_already_classified',
      'unknown_event_classification',
    ])
  })

  test('a portfolio publish carries no events, so no decision can be smuggled in', () => {
    // The route validates against `alternatives?.events ?? []`. For a portfolio
    // upload that list is empty, so ANY decision is unknown and refused.
    const out = validateEventClassifications([], [{ sourceCell: 'Alternatives!J9', eventType: 'aporte' }])
    assert.equal(out[0].code, 'unknown_event_classification')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Cross-currency guard (doc 03 § 4.2, decision D4)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · cross-currency guard', () => {
  test('a single-currency aggregate passes; a mixed one names the currencies', () => {
    assert.equal(
      assertSingleCurrencyAggregate([
        { category: 'Real Assets', currency: 'dolares', currentValue: 1 },
        { category: 'Real Assets', currency: 'dolares', currentValue: 2 },
      ]).ok,
      true,
    )
    const mixed = assertSingleCurrencyAggregate([
      { category: 'Real Assets', currency: 'dolares', currentValue: 1 },
      { category: 'Real Assets', currency: 'euros', currentValue: 2 },
    ])
    assert.equal(mixed.ok, false)
    if (!mixed.ok) assert.deepEqual(mixed.currencies, ['dolares', 'euros'])
  })

  test('spansMultipleCurrencies detects the condition on its own', () => {
    assert.equal(spansMultipleCurrencies([{ category: 'a', currency: 'usd', currentValue: null }]), false)
    assert.equal(
      spansMultipleCurrencies([
        { category: 'a', currency: 'usd', currentValue: null },
        { category: 'a', currency: 'clp', currentValue: null },
      ]),
      true,
    )
  })

  test('a category held in three currencies REQUIRES three subtotal entries', () => {
    const holdings = [
      { category: 'Real Assets', currency: 'dolares' },
      { category: 'Real Assets', currency: 'euros' },
      { category: 'Real Assets', currency: 'pesos' },
    ]
    const correct = verifyPerCurrencySubtotals(holdings, [
      { category: 'Real Assets', currency: 'dolares', currentValue: 1 },
      { category: 'Real Assets', currency: 'euros', currentValue: 2 },
      { category: 'Real Assets', currency: 'pesos', currentValue: 3 },
    ])
    assert.equal(correct.ok, true)
  })

  test('ONE merged subtotal over three currencies is refused — the real failure', () => {
    const holdings = [
      { category: 'Real Assets', currency: 'dolares' },
      { category: 'Real Assets', currency: 'euros' },
      { category: 'Real Assets', currency: 'pesos' },
    ]
    const merged = verifyPerCurrencySubtotals(holdings, [
      { category: 'Real Assets', currency: 'dolares', currentValue: 6 },
    ])
    assert.equal(merged.ok, false)
    if (!merged.ok) {
      assert.equal(merged.category, 'Real Assets')
      assert.deepEqual(merged.expected, ['dolares', 'euros', 'pesos'])
      assert.deepEqual(merged.found, ['dolares'])
    }
  })

  test('a subtotal for a currency no holding uses is refused', () => {
    const out = verifyPerCurrencySubtotals(
      [{ category: 'Private Equity', currency: 'dolares' }],
      [
        { category: 'Private Equity', currency: 'dolares', currentValue: 1 },
        { category: 'Private Equity', currency: 'euros', currentValue: 2 },
      ],
    )
    assert.equal(out.ok, false)
  })

  test('a category with NO subtotal at all is refused', () => {
    const out = verifyPerCurrencySubtotals([{ category: 'Venture', currency: 'dolares' }], [])
    assert.equal(out.ok, false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Publishability
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · publishability', () => {
  const clean = { findings: [], parsed: true, recordCount: 10 }

  test('a clean draft is publishable', () => {
    const v = assessPublishability(clean)
    assert.equal(v.publishable, true)
    assert.deepEqual(v.refusals, [])
  })

  test('a BLOCKING finding refuses publication', () => {
    const v = assessPublishability({
      ...clean,
      findings: [{ severity: 'blocking', code: 'source_cell_error', detail: 'a required cell is in error' }],
    })
    assert.equal(v.publishable, false)
    assert.ok(v.refusals.includes('blocking_findings'))
    assert.equal(v.blockingFindings.length, 1)
  })

  test('a WARNING alone does not refuse publication', () => {
    const v = assessPublishability({
      ...clean,
      findings: [{ severity: 'warning', code: 'performance_definition_mismatch', detail: 'residual beyond tolerance' }],
    })
    assert.equal(v.publishable, true)
    assert.equal(v.warningCount, 1)
  })

  test('an unresolved event refuses publication at PUBLISH time', () => {
    // Doc 03 § 3.4 makes it a warning at PARSE time; doc 05 § 5.4 turns it into
    // a publication block. Both must hold — the draft ingests, the book does not.
    const v = assessPublishability({ ...clean, unresolvedEventCells: ['Alternatives!J9'] })
    assert.equal(v.publishable, false)
    assert.ok(v.refusals.includes('unclassified_events'))
  })

  test('an empty draft refuses publication rather than blanking the week', () => {
    const v = assessPublishability({ ...clean, recordCount: 0 })
    assert.equal(v.publishable, false)
    assert.ok(v.refusals.includes('nothing_to_publish'))
  })

  test('an unparsed draft refuses publication', () => {
    const v = assessPublishability({ ...clean, parsed: false })
    assert.equal(v.publishable, false)
    assert.ok(v.refusals.includes('draft_not_parsed'))
  })

  test('every reason is reported at once, not one per attempt', () => {
    const v = assessPublishability({
      findings: [{ severity: 'blocking', code: 'x', detail: 'y' }],
      parsed: false,
      recordCount: 0,
      unresolvedEventCells: ['Alternatives!J9'],
    })
    assert.equal(v.refusals.length, 4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Revisions, supersession, rollback
// ═══════════════════════════════════════════════════════════════════════════

function pub(o: Partial<ExistingPublication> & { id: string }): ExistingPublication {
  return {
    uploadKind: 'portfolio',
    asOfDate: '2026-08-06',
    revision: 1,
    isCurrent: false,
    ...o,
  }
}

describe('R13.5 · revisions and supersession', () => {
  test('a first publication is revision 1', () => {
    assert.equal(nextRevision([], '2026-08-06', 'portfolio'), 1)
  })

  test('a re-publish of the same week is revision 2', () => {
    assert.equal(nextRevision([pub({ id: 'a', isCurrent: true })], '2026-08-06', 'portfolio'), 2)
  })

  test('revision numbering is per (kind, date), so alternatives starts at 1', () => {
    const existing = [pub({ id: 'a', revision: 3, isCurrent: true })]
    assert.equal(nextRevision(existing, '2026-08-06', 'alternatives'), 1)
    assert.equal(nextRevision(existing, '2026-08-13', 'portfolio'), 1)
  })

  test('numbering uses max(revision), never the row COUNT', () => {
    // After a rollback the retained revisions are 1 and 2 with 1 current.
    // Counting rows would reissue 3 correctly here but 2 after a delete-free
    // gap; max() is the only form that can never collide.
    const existing = [pub({ id: 'a', revision: 1, isCurrent: true }), pub({ id: 'b', revision: 2 })]
    assert.equal(nextRevision(existing, '2026-08-06', 'portfolio'), 3)
  })

  test('a publication supersedes what readers are CURRENTLY seeing', () => {
    const existing = [pub({ id: 'rev1', revision: 1, isCurrent: true }), pub({ id: 'rev2', revision: 2 })]
    const planned = planPublication({
      uploadKind: 'portfolio',
      date: { ok: true, date: '2026-08-06', overridden: false, overrideNote: null },
      existing,
    })
    assert.equal(planned.ok, true)
    if (planned.ok) {
      // NOT rev2, which is the highest revision but was rolled back.
      assert.equal(planned.plan.supersedes, 'rev1')
      assert.equal(planned.plan.revision, 3)
      assert.equal(planned.plan.isRevision, true)
    }
  })

  test('a first publication supersedes nothing', () => {
    const planned = planPublication({
      uploadKind: 'portfolio',
      date: { ok: true, date: '2026-08-06', overridden: false, overrideNote: null },
      existing: [],
    })
    assert.equal(planned.ok, true)
    if (planned.ok) {
      assert.equal(planned.plan.supersedes, null)
      assert.equal(planned.plan.isRevision, false)
    }
  })

  test('a refused date short-circuits the plan with its own code', () => {
    const planned = planPublication({
      uploadKind: 'portfolio',
      date: { ok: false, code: 'date_override_note_required' },
      existing: [],
    })
    assert.equal(planned.ok, false)
    if (!planned.ok) assert.equal(planned.code, 'date_override_note_required')
  })
})

describe('R13.5 · rollback', () => {
  test('rollback restores a retained revision and demotes the current one', () => {
    const existing = [pub({ id: 'rev1', revision: 1 }), pub({ id: 'rev2', revision: 2, isCurrent: true })]
    const planned = planRollback('rev1', existing)
    assert.equal(planned.ok, true)
    if (planned.ok) {
      assert.equal(planned.plan.restore.id, 'rev1')
      assert.equal(planned.plan.demote.id, 'rev2')
    }
  })

  test('rolling back to the CURRENT revision is refused', () => {
    const planned = planRollback('rev2', [pub({ id: 'rev2', revision: 2, isCurrent: true })])
    assert.equal(planned.ok, false)
    if (!planned.ok) assert.equal(planned.code, 'already_current')
  })

  test('an unknown publication is refused', () => {
    const planned = planRollback('nope', [pub({ id: 'rev1', isCurrent: true })])
    assert.equal(planned.ok, false)
    if (!planned.ok) assert.equal(planned.code, 'publication_not_found')
  })

  test('rollback cannot cross datasets — a different KIND is refused', () => {
    const existing = [
      pub({ id: 'p1', uploadKind: 'portfolio', isCurrent: true }),
      pub({ id: 'a1', uploadKind: 'alternatives', revision: 1 }),
    ]
    const planned = planRollback('a1', existing)
    assert.equal(planned.ok, false)
    if (!planned.ok) assert.equal(planned.code, 'kind_mismatch')
  })

  test('rollback cannot cross weeks — a different DATE is refused', () => {
    const existing = [
      pub({ id: 'w1', asOfDate: '2026-08-06', isCurrent: true }),
      pub({ id: 'w2', asOfDate: '2026-07-31', revision: 1 }),
    ]
    const planned = planRollback('w2', existing)
    assert.equal(planned.ok, false)
    if (!planned.ok) assert.equal(planned.code, 'date_mismatch')
  })

  test('with nothing current at all, rollback is refused', () => {
    const planned = planRollback('rev1', [pub({ id: 'rev1', revision: 1 })])
    assert.equal(planned.ok, false)
    if (!planned.ok) assert.equal(planned.code, 'no_current_publication')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Commentary
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · commentary', () => {
  test('the first revision is 1 and each edit appends', () => {
    assert.equal(nextCommentaryRevision([]), 1)
    assert.equal(nextCommentaryRevision([{ revision: 1, supersededBy: 'x' }]), 2)
    assert.equal(
      nextCommentaryRevision([
        { revision: 1, supersededBy: 'x' },
        { revision: 2, supersededBy: null },
      ]),
      3,
    )
  })

  test('an empty or whitespace body is refused', () => {
    assert.equal(normalizeCommentary('').ok, false)
    assert.equal(normalizeCommentary('   ').ok, false)
    assert.equal(normalizeCommentary(null).ok, false)
    assert.equal(normalizeCommentary(42).ok, false)
  })

  test('a body is trimmed, and an oversized one is refused', () => {
    const ok = normalizeCommentary('  a note  ')
    assert.equal(ok.ok, true)
    if (ok.ok) assert.equal(ok.body, 'a note')
    const long = normalizeCommentary('x'.repeat(MAX_COMMENTARY_LENGTH + 1))
    assert.equal(long.ok, false)
    if (!long.ok) assert.equal(long.code, 'too_long')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Migration structure (STRUCTURE only — execution is pgTAP's job)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · migration', () => {
  const sql = read(MIGRATION)
  const code = codeOf(sql)

  test('it is ordered after every earlier R13 migration and named for its stage', () => {
    const all = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
    const mine = '20260810000000_family_portfolio_publication.sql'
    assert.ok(all.includes(mine))
    for (const earlier of [
      '20260806000000_family_portfolio_entitlements.sql',
      '20260807000000_family_portfolio_upload_storage.sql',
      '20260808000000_family_portfolio_snapshots.sql',
      '20260809000000_family_portfolio_alternatives.sql',
    ]) {
      assert.ok(all.includes(earlier))
      assert.ok(earlier < mine, `${earlier} must sort before ${mine}`)
    }
    // No two migrations may share a timestamp — apply order would be undefined.
    const stamps = all.map((f) => f.slice(0, 14))
    assert.equal(new Set(stamps).size, stamps.length)
  })

  test('it refuses to apply before its dependencies', () => {
    assert.match(code, /portfolio_publications is missing/)
    assert.match(code, /alternatives_holdings is missing/)
    assert.match(code, /nmi_can_access_scope\(text\) is missing/)
  })

  test('publication is ONE function call, so the whole write is one transaction', () => {
    assert.match(code, /create or replace function public\.nmi_publish_portfolio/)
    assert.match(code, /create or replace function public\.nmi_publish_alternatives/)
    assert.match(code, /create or replace function public\.nmi_rollback_publication/)
  })

  test('every publication function is SECURITY INVOKER and pins search_path', () => {
    // DEFINER would run as the owner: any caller who could execute it would get
    // write access to the whole book. INVOKER means RLS and grants still apply.
    // Matched as a standalone ATTRIBUTE line, so the postcondition's own error
    // message (which necessarily contains the phrase) cannot satisfy or break it.
    const declared = code.split('\n').filter((l) => /^\s*security\s+definer\s*$/i.test(l))
    assert.deepEqual(declared, [], 'no publication function may be SECURITY DEFINER')
    const pins = code.match(/set search_path = ''/g) ?? []
    assert.ok(pins.length >= 6, `expected every function to pin search_path, found ${pins.length}`)
    assert.match(code, /is SECURITY DEFINER — publication functions must run as the caller/)
  })

  test('EXECUTE is revoked from anon and authenticated, granted only to service_role', () => {
    assert.match(code, /revoke all on function %s from public, anon, authenticated/)
    assert.match(code, /grant execute on function %s to service_role/)
    assert.match(code, /can EXECUTE % — publication must stay service-role only/)
  })

  test('the database refuses a blocking-finding upload on its own', () => {
    assert.match(code, /publication_refused_blocking_findings/)
    assert.match(code, /severity = 'blocking'/)
  })

  test('the database refuses an unclassified event on its own', () => {
    assert.match(code, /publication_refused_unclassified_events/)
    assert.match(code, /event_type = 'unclassified'/)
  })

  test('the database refuses an empty payload rather than blanking the week', () => {
    const hits = code.match(/publication_refused_nothing_to_publish/g) ?? []
    assert.ok(hits.length >= 2, 'both publish functions must refuse an empty payload')
  })

  test('the new revision is INSERTED before the predecessor points at it', () => {
    // CORRECTED after run 31210961884. This test previously asserted the exact
    // opposite — demote-then-insert — which satisfied the partial current-row
    // index but violated the non-deferrable `superseded_by` self-FK: the
    // predecessor was pointed at a row that did not exist yet, so PostgreSQL
    // raised 23503 on every re-publication. The assertion was wrong, not merely
    // outdated, and it could never have caught the defect because it encoded it.
    //
    // The repaired order is insert-non-current -> fill -> demote -> promote,
    // which satisfies BOTH constraints. Verified at runtime in pgTAP against the
    // deployed `prosrc`; this static check exists only so the order cannot
    // silently regress in the migration text.
    for (const fn of ['nmi_publish_portfolio', 'nmi_publish_alternatives']) {
      const body = functionBody(fn)
      const insert = body.indexOf('insert into public.portfolio_publications')
      const demote = body.indexOf('set is_current = false, superseded_by = v_pub_id')
      const promote = body.indexOf('set is_current = true where id = v_pub_id')
      assert.ok(insert > 0 && demote > 0 && promote > 0, fn)
      assert.ok(insert < demote, `${fn}: the successor must exist before it is referenced`)
      assert.ok(demote < promote, `${fn}: demote must precede promote — never two current rows`)
    }
  })

  test('the new revision is inserted NON-current', () => {
    // A row inserted `is_current = true` alongside a still-current predecessor
    // would collide with the partial unique index immediately.
    for (const fn of ['nmi_publish_portfolio', 'nmi_publish_alternatives']) {
      const body = functionBody(fn)
      assert.match(body, /p_published_by, false,/, `${fn} must insert non-current`)
    }
  })

  test('commentary inserts the new revision before superseding the prior one', () => {
    const body = functionBody('nmi_upsert_portfolio_commentary')
    const insert = body.indexOf('insert into public.portfolio_commentary')
    const demote = body.indexOf('set superseded_by = v_id')
    assert.ok(insert > 0 && demote > 0 && insert < demote)
    // The new row is parked behind its predecessor so the one-live partial index
    // is satisfied, then released once the predecessor has been superseded.
    assert.match(body, /revision, superseded_by\)/)
    assert.match(body, /set superseded_by = null\s*\n\s*where id = v_id/)
  })

  test('rollback never writes a forward reference', () => {
    // Both rows already exist and both statements CLEAR superseded_by, so
    // rollback needed no equivalent repair.
    const body = functionBody('nmi_rollback_publication')
    assert.ok(!/superseded_by = v_[a-z_]*id/.test(body),
      'rollback must not point a row at another publication')
    const clears = body.match(/superseded_by = null/g) ?? []
    assert.equal(clears.length, 2)
  })

  test('rollback moves a pointer and DELETES nothing', () => {
    assert.ok(!/delete\s+from\s+public\.portfolio_(publications|snapshot_rows|performance_rows)/i.test(code))
    assert.ok(!/delete\s+from\s+public\.alternatives_/i.test(code))
    assert.match(code, /rollback_refused_already_current/)
  })

  test('a NULL value is never coalesced to zero on the way in', () => {
    // `unavailable` is not 0 (doc 02 § 9). coalesce() appears only for currency,
    // metadata and revision defaults — never for a numeric portfolio value.
    assert.ok(!/coalesce\(\s*r\.value/i.test(code))
    assert.ok(!/coalesce\(\s*m\.value/i.test(code))
    assert.ok(!/coalesce\(\s*h\.current_value/i.test(code))
  })

  test('commentary is append-and-supersede with exactly one live revision', () => {
    assert.match(code, /portfolio_commentary_current_idx/)
    assert.match(code, /where superseded_by is null/)
    assert.match(code, /set superseded_by = v_id/)
  })

  test('commentary reads through the same scope predicate as the rows it annotates', () => {
    assert.match(code, /create policy "portfolio_commentary_scope_select"/)
    assert.match(code, /using \(public\.nmi_can_access_scope\(scope\)\)/)
  })

  test('commentary carries no insert/update/delete policy for authenticated', () => {
    assert.match(code, /revoke all privileges on table public\.portfolio_commentary from public, anon, authenticated/)
    assert.match(code, /grant select on table public\.portfolio_commentary to authenticated/)
    assert.match(code, /a non-SELECT policy exists on portfolio_commentary/)
  })

  // ── Concurrency audit (R13.5 pre-commit) ────────────────────────────────
  //
  // These are STRUCTURAL. True concurrency is not exercisable in the local Node
  // environment — no Docker, no psql — so the behaviour is proven by the pgTAP
  // suite in CI. What is proven here is that the mechanism the design depends on
  // is actually present in every writer and has not silently reverted.

  test('every publication writer serialises through the SHARED series lock', () => {
    for (const fn of ['nmi_publish_portfolio', 'nmi_publish_alternatives', 'nmi_rollback_publication']) {
      const start = code.indexOf(`create or replace function public.${fn}`)
      assert.ok(start > 0, fn)
      const body = code.slice(start, code.indexOf('end $$;', start))
      assert.ok(body.includes('nmi_lock_publication_series'),
        `${fn} must serialise through the shared helper`)
    }
  })

  /**
   * The body of one `create or replace function`, comments stripped.
   *
   * Scoped deliberately: the postcondition blocks quote the very phrases these
   * assertions look for ("FOR UPDATE", "pg_advisory_xact_lock"), so a
   * whole-file match would be satisfied — or broken — by the migration's own
   * self-check rather than by the functions under test.
   */
  function functionBody(name: string): string {
    const start = code.indexOf(`create or replace function public.${name}`)
    assert.ok(start > 0, `${name} is missing`)
    return code.slice(start, code.indexOf('end $$;', start))
  }

  const WRITERS = ['nmi_publish_portfolio', 'nmi_publish_alternatives', 'nmi_rollback_publication']

  test('FOR UPDATE is NOT the serialization mechanism', () => {
    // It locks NOTHING on the first publication of a week — precisely the case
    // two concurrent publishers collide on — so relying on it would make the
    // "serialises" claim false. The migration asserts this in-database too.
    for (const fn of WRITERS) {
      assert.ok(!/for update/i.test(functionBody(fn)), `${fn} must not rely on FOR UPDATE`)
    }
    assert.match(code, /still relies on FOR UPDATE, which locks nothing on a first publication/)
  })

  test('the series lock key is derived in exactly one place', () => {
    // Only the two lock-owning helpers may name the primitive; every other
    // writer must go through them. A hand-rolled key elsewhere would look
    // correct and silently fail to serialise against the rest.
    const owners = ['nmi_lock_publication_series', 'nmi_upsert_portfolio_commentary']
    for (const fn of owners) {
      assert.match(functionBody(fn), /pg_advisory_xact_lock/, `${fn} owns a lock`)
    }
    for (const fn of WRITERS) {
      assert.ok(!functionBody(fn).includes('pg_advisory_xact_lock'),
        `${fn} must take its lock through the shared helper, not a hand-rolled key`)
    }
    assert.match(code, /hashtext\('nmi_publication_series'\)/)
    assert.match(code, /hashtext\('nmi_commentary_chain'\)/)
  })

  test('commentary serialises its own revision chain', () => {
    const start = code.indexOf('create or replace function public.nmi_upsert_portfolio_commentary')
    const body = code.slice(start, code.indexOf('end $$;', start))
    assert.ok(body.includes('pg_advisory_xact_lock'))
    // ...and the lock is taken BEFORE the revision is computed, or it serialises
    // nothing that matters.
    assert.ok(body.indexOf('pg_advisory_xact_lock') < body.indexOf('max(revision)'))
  })

  test('revision numbers cannot duplicate even if a lock were removed', () => {
    // The unique keys are the guarantee; the locks turn a lost race into an
    // orderly turn rather than an opaque constraint violation. The publications
    // key lives in the R13.3 migration that created the ledger, the commentary
    // key in this one — and R13.5 re-asserts BOTH at apply time, so neither can
    // be dropped without this migration failing.
    assert.match(
      read('supabase/migrations/20260808000000_family_portfolio_snapshots.sql'),
      /constraint portfolio_publications_revision_key unique \(upload_kind, as_of_date, revision\)/,
    )
    assert.match(code, /constraint portfolio_commentary_revision_key unique \(publication_id, scope, revision\)/)
    assert.match(code, /the \(upload_kind, as_of_date, revision\) unique key is missing/)
    assert.match(code, /the \(publication_id, scope, revision\) unique key is missing/)
  })

  test('the rollback lifecycle is DERIVED from the target, never supplied', () => {
    const start = code.indexOf('create or replace function public.nmi_rollback_publication')
    const body = code.slice(start, code.indexOf('end $$;', start))
    // The only identifying parameter is the target id; kind and date are read
    // off the target's own row, so no request can redirect the demote at a
    // different week or dataset.
    assert.match(body, /select upload_kind, as_of_date, upload_id into v_kind, v_date, v_target_upload/)
    assert.ok(!/p_kind|p_upload_kind|p_as_of_date/.test(body),
      'rollback must not accept a caller-supplied lifecycle')
    // Every read and write is confined to that derived series.
    const scoped = body.match(/upload_kind = v_kind and as_of_date = v_date/g) ?? []
    assert.ok(scoped.length >= 1)
  })

  test('the duplicate-submission guard cannot block a legitimate re-publish', () => {
    // It fires only when the SAME upload is already current at the SAME parser
    // version. A corrected workbook is a different upload (R13.2 makes the same
    // bytes unrepeatable per kind); a parser upgrade is a different version.
    const hits = code.match(/publication_refused_duplicate_submission/g) ?? []
    assert.equal(hits.length, 2, 'both publish functions must carry the guard')
    assert.match(code, /v_prev_upload = p_upload_id\s*\n\s*and v_prev_parser is not distinct from p_parser_version/)
  })

  test('earlier-stage posture is re-asserted, not assumed', () => {
    assert.match(code, /authenticated gained UPDATE on user_profiles/)
    assert.match(code, /authenticated gained INSERT on portfolio_snapshot_rows/)
    assert.match(code, /authenticated gained INSERT on alternatives_events/)
    assert.match(code, /the one-current-publication index disappeared/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Route posture
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · routes', () => {
  const routes = [PUBLISH_ROUTE, ROLLBACK_ROUTE, COMMENTARY_ROUTE, UPLOAD_DETAIL_ROUTE, UPLOADS_ROUTE]

  test('every route authorizes before it does any work', () => {
    for (const rel of routes) {
      const src = read(rel)
      assert.match(src, /guardPrivateApi\(\)/, rel)
      assert.match(src, /isAdministrator/, rel)
      const guard = src.indexOf('guardPrivateApi()')
      const admin = src.indexOf('isAdministrator')
      assert.ok(guard < admin, `${rel}: session guard must precede the capability check`)
    }
  })

  test('a non-administrator gets an identical refusal everywhere, leaking nothing', () => {
    for (const rel of routes) {
      assert.match(read(rel), /'not_authorized'/, rel)
    }
  })

  test('every route runs on Node and is never cached', () => {
    for (const rel of routes) {
      const src = read(rel)
      assert.match(src, /export const runtime = 'nodejs'/, rel)
      assert.match(src, /export const dynamic = 'force-dynamic'/, rel)
      assert.match(src, /'Cache-Control': 'no-store'/, rel)
    }
  })

  test('the publish route never trusts a client-supplied value or row', () => {
    const src = codeOf(read(PUBLISH_ROUTE))
    // The workbook is re-parsed server-side; only DECISIONS come from the body.
    assert.match(src, /loadDraft\(id\)/)
    assert.ok(!/body\.rows/.test(src), 'rows must never come from the request')
    assert.ok(!/body\.value/.test(src), 'values must never come from the request')
    assert.ok(!/body\.performance/.test(src))
    for (const allowed of ['confirmedAsOfDate', 'overrideNote', 'adminNote', 'eventClassifications', 'commentary']) {
      assert.ok(src.includes(allowed), `${allowed} is the documented decision surface`)
    }
  })

  test('the publish route refuses before it writes, and reports every reason', () => {
    const src = read(PUBLISH_ROUTE)
    const refuse = src.indexOf('publication_refused')
    const write = src.indexOf('publishPortfolio(')
    assert.ok(refuse > 0 && write > 0 && refuse < write)
    assert.match(src, /refusals: review\.refusals/)
  })

  test('the publish route stores the SOURCE performance figure, cross-checks in metadata', () => {
    const src = read(PUBLISH_ROUTE)
    assert.match(src, /value: p\.sourceValue/)
    assert.match(src, /crossChecks: p\.crossChecks/)
  })

  test('the publish route preserves a null value rather than zeroing it', () => {
    const src = codeOf(read(PUBLISH_ROUTE))
    assert.match(src, /value: r\.value/)
    assert.ok(!/value: r\.value \?\? 0/.test(src))
  })

  test('an event is attached to exactly one holding, or the publish fails closed', () => {
    const src = read(PUBLISH_ROUTE)
    assert.match(src, /candidates\.length !== 1/)
    assert.match(src, /ambiguous_event_holding/)
  })

  test('the cross-currency guard runs before any write', () => {
    const src = read(PUBLISH_ROUTE)
    const guard = src.indexOf('verifyPerCurrencySubtotals')
    const write = src.indexOf('publishAlternatives(')
    assert.ok(guard > 0 && write > 0 && guard < write)
    assert.match(src, /cross_currency_total/)
  })

  test('no route echoes a driver message; refusals collapse to known codes', () => {
    const repo = read('src/lib/db/repositories/portfolioPublicationRepository.ts')
    assert.match(repo, /export function refusalCodeOf/)
    assert.match(repo, /'publication_failed'/)
  })

  test('publication parses the STORED object, never browser state', () => {
    const review = read('src/lib/familyPortfolio/draftReview.ts')
    const src = read(PUBLISH_ROUTE)
    // The object path is read off the upload row inside loadDraft; the route
    // supplies only the upload id from the URL path.
    assert.match(review, /downloadUploadBytes\(found\.upload\.storageObjectPath\)/)
    assert.ok(!/body\.storageObjectPath|body\.objectPath|body\.path/.test(src),
      'no request may name a storage object')
    assert.ok(!/body\.uploadKind|body\.kind/.test(src),
      'no request may choose which parser runs')
    // uploadKind comes from the row and decides the parser.
    assert.match(review, /const kind = found\.upload\.uploadKind/)
    assert.match(review, /kind === 'portfolio' \? parseResumen/)
  })

  test('the re-downloaded object is verified against the recorded digest', () => {
    const review = read('src/lib/familyPortfolio/draftReview.ts')
    assert.match(review, /createHash\('sha256'\)\.update\(downloaded\.bytes\)\.digest\('hex'\)/)
    assert.match(review, /digest !== found\.upload\.fileSha256/)
    assert.match(review, /source_digest_mismatch/)
  })

  test('R13.2 storage semantics keep a previewed object immutable', () => {
    const uploadRepo = read('src/lib/db/repositories/portfolioUploadRepository.ts')
    // A fresh opaque key per upload, and an upload that refuses to overwrite.
    assert.match(uploadRepo, /upsert: false/)
    assert.match(read('src/lib/familyPortfolio/uploadValidation.ts'), /buildStorageObjectKey/)
    assert.match(read(UPLOADS_ROUTE), /buildStorageObjectKey\(kindRaw, new Date\(\)\.getUTCFullYear\(\), randomUUID\(\)\)/)
  })

  test('the parser version recorded is the one that actually ran', () => {
    const src = read(PUBLISH_ROUTE)
    assert.match(src, /parserVersion: RESUMEN_PARSER_VERSION/)
    assert.match(src, /parserVersion: ALTERNATIVES_PARSER_VERSION/)
    assert.ok(!/body\.parserVersion/.test(src), 'no request may declare a parser version')
    // And it is reported back, so a preview/publish version shift is visible
    // rather than silent — there is no snapshot isolation across deployments.
    assert.match(src, /parserVersion: record\?\.parserVersion/)
  })

  test('classification submissions are validated against the server reparse', () => {
    const src = read(PUBLISH_ROUTE)
    assert.match(src, /validateEventClassifications\(loaded\.draft\.alternatives\?\.events \?\? \[\], decisions\)/)
    assert.match(src, /classification_refused/)
    // ...and before anything is written.
    const check = src.indexOf('validateEventClassifications')
    const write = src.indexOf('publishAlternatives(')
    assert.ok(check > 0 && write > 0 && check < write)
  })

  test('the draft preview carries counts and references, never amounts', () => {
    const review = read('src/lib/familyPortfolio/draftReview.ts')
    for (const banned of ['currentValue', 'sourceValue:', 'capitalCommitted', 'lastValuation']) {
      assert.ok(!review.includes(`${banned},`), `${banned} must not be serialized into the review`)
    }
    assert.match(review, /rowCount/)
    assert.match(review, /unavailableCount/)
    assert.match(review, /agrees/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Admin page — presentation, never protection
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · administrator page', () => {
  const page = read(ADMIN_PAGE)

  test('it renders only what the API returned and states so', () => {
    assert.match(page, /NEVER PROTECTION/)
    // No client-side entitlement decision: the page never imports the rule.
    assert.ok(!page.includes('portfolioAccess/entitlements'))
  })

  test('it does not build the Stage 6 module shell', () => {
    // Comments are stripped: the page's own SCOPE NOTE names the later-stage
    // navigation precisely to say it is NOT built here.
    const code = codeOf(page)
    for (const later of ['Weekly Changes', 'weekly-changes', 'ScopeSelector', 'scopeSelector']) {
      assert.ok(!code.includes(later), `${later} belongs to a later stage`)
    }
  })

  test('every user-visible string comes from the dictionary', () => {
    assert.match(page, /useLang\(\)/)
    assert.match(page, /const a = t\.fpAdmin/)
  })

  test('it uses semantic tokens only — no raw palette, no hardcoded hex', () => {
    assert.ok(!/(bg|text|border)-(gray|zinc|slate|emerald|red|blue)-\d/.test(page))
    // The only hex-like literals allowed are none: colours come from var(--…).
    assert.ok(!/#[0-9a-fA-F]{6}/.test(page))
    assert.match(page, /var\(--negative\)/)
    assert.match(page, /var\(--positive\)/)
  })

  test('dense tables scroll inside their card, never the page', () => {
    const widths = page.match(/minWidth=\{(\d+)\}/g) ?? []
    assert.ok(widths.length >= 2, 'both tables must declare a card-level min width')
    assert.match(page, /grid-cols-1 sm:grid-cols-3/)
  })

  test('each table ends with exactly one TableSourceFooter', () => {
    const footers = page.match(/<TableSourceFooter/g) ?? []
    assert.equal(footers.length, 2)
  })

  test('the override note is surfaced exactly when the date diverges', () => {
    assert.match(page, /const overriding = detected !== null && confirmDate !== '' && confirmDate !== detected/)
    assert.match(page, /noteMissing/)
  })

  test('both languages define every fpAdmin key', () => {
    const i18n = read('src/lib/i18n.ts')
    const blocks = i18n.match(/fpAdmin: \{[\s\S]*?\n {4}\},/g) ?? []
    assert.equal(blocks.length, 2, 'fpAdmin must exist in both en and es')
    const keys = (block: string) => (block.match(/^ {6}([a-zA-Z_]+):/gm) ?? []).map((k) => k.trim())
    assert.deepEqual(keys(blocks[0]), keys(blocks[1]))
    assert.ok(keys(blocks[0]).length > 20)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10 · Source hygiene — the R13.5 regression
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · service-role boundary', () => {
  /** Every module reachable from a `'use client'` file through relative/@ imports. */
  function clientReachable(): Set<string> {
    const resolve = (from: string, spec: string): string | null => {
      let base: string
      if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2))
      else if (spec.startsWith('.')) base = join(ROOT, from, '..', spec)
      else return null
      for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const p = base.replace(/\.ts$/, '') + ext
        try {
          if (statSync(p).isFile()) return p.replace(ROOT.replace(/[/\\]$/, ''), '').replace(/\\/g, '/').replace(/^\//, '')
        } catch { /* keep trying */ }
      }
      return null
    }

    const seen = new Set<string>()
    const queue: string[] = []
    for (const rel of allSources('src')) {
      if (/^'use client'|^"use client"/.test(readFileSync(join(ROOT, rel), 'utf8').trimStart())) {
        queue.push(rel)
        seen.add(rel)
      }
    }
    while (queue.length > 0) {
      const rel = queue.pop() as string
      const src = readFileSync(join(ROOT, rel), 'utf8')
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        const next = resolve(rel, m[1])
        if (next && !seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    return seen
  }

  test('no client component can reach the service-role admin client', () => {
    const reachable = clientReachable()
    assert.ok(reachable.size > 0, 'the traversal must actually find client components')
    for (const forbidden of [
      'src/lib/supabase/admin.ts',
      'src/lib/db/repositories/portfolioPublicationRepository.ts',
      'src/lib/db/repositories/portfolioUploadRepository.ts',
      'src/lib/familyPortfolio/draftReview.ts',
    ]) {
      assert.ok(!reachable.has(forbidden), `${forbidden} is reachable from a client component`)
    }
  })

  test('the admin page reaches the server only through fetch', () => {
    const page = read(ADMIN_PAGE)
    assert.ok(!page.includes('@/lib/db/'), 'a page must not import a repository')
    assert.ok(!page.includes('supabase'), 'a page must not import a Supabase client')
    assert.match(page, /fetch\('\/api\/family-portfolio\/admin\/uploads'/)
  })

  test('the publication repository is server-only and says so', () => {
    const repo = read('src/lib/db/repositories/portfolioPublicationRepository.ts')
    assert.match(repo, /SERVER-ONLY/)
    assert.ok(!/^'use client'/.test(repo.trimStart()))
    assert.match(repo, /getSupabaseAdminClient/)
  })

  test('no route names the service-role key or echoes a driver message', () => {
    for (const rel of [PUBLISH_ROUTE, ROLLBACK_ROUTE, COMMENTARY_ROUTE, UPLOAD_DETAIL_ROUTE, UPLOADS_ROUTE]) {
      const src = codeOf(read(rel))
      assert.ok(!/SERVICE_ROLE|service_role/.test(src), `${rel} must not name the service-role key`)
      assert.ok(!/\berror\.message\b|\bexception\.message\b/.test(src),
        `${rel} must not echo a driver message`)
    }
    // The repository reduces any driver text to a known code before returning.
    const repo = read('src/lib/db/repositories/portfolioPublicationRepository.ts')
    assert.match(repo, /const known = \/\(publication_refused_/)
    assert.match(repo, /return known \? known\[1\] : 'publication_failed'/)
  })

  test('no opaque storage key is ever serialized to a client', () => {
    // FOUND BY THIS AUDIT. The R13.5 console listing originally returned the
    // full upload record, which carries `storageObjectPath`. Doc 05 § 3.2 makes
    // that key opaque precisely because it leaks through logs, error messages
    // and signed URLs, and the R13.2 detail route already withholds it. The
    // field is now dropped at the repository boundary.
    const repo = read('src/lib/db/repositories/portfolioPublicationRepository.ts')
    assert.match(repo, /export type AdminUploadSummary = Omit<UploadRecord, 'storageObjectPath'>/)
    assert.match(repo, /listUploads\(\): Promise<AdminUploadSummary\[\]>/)

    // The four data-returning routes never mention it at all.
    for (const rel of [PUBLISH_ROUTE, ROLLBACK_ROUTE, COMMENTARY_ROUTE, UPLOAD_DETAIL_ROUTE]) {
      assert.ok(!/storageObjectPath|storage_object_path/.test(read(rel)),
        `${rel} must not mention an object path`)
    }
    // The uploads route builds a key server-side for storage — legitimately —
    // but its GET handler must not carry one.
    const uploads = read(UPLOADS_ROUTE)
    const get = uploads.slice(uploads.indexOf('export async function GET'), uploads.indexOf('export async function POST'))
    assert.ok(get.length > 0)
    assert.ok(!/storageObjectPath|storage_object_path/.test(get))

    // And the admin page never renders one.
    assert.ok(!/storageObjectPath/.test(read(ADMIN_PAGE)))
  })
})

describe('R13.5 · source hygiene', () => {
  // FOUND IN R13.5, PRESENT SINCE R13.4. `parseAlternatives.ts` carried a RAW
  // NUL BYTE inside a template literal used as a Map key. The runtime string was
  // correct, but the file read as BINARY to grep, diff and every review tool
  // built on them — so the line could not be inspected the way every other line
  // in this repository is. It is now written as an escape.
  //
  // The guard is deliberately repository-wide rather than R13-only: nothing
  // about the defect was specific to this module.
  test('no source file contains a raw NUL byte', () => {
    const offenders: string[] = []
    for (const rel of [...allSources('src'), ...allSources('supabase')]) {
      if (readFileSync(join(ROOT, rel)).includes(0)) offenders.push(rel)
    }
    assert.deepEqual(offenders, [], `raw NUL bytes make a file read as binary: ${offenders.join(', ')}`)
  })

  test('the alternatives grouping key still separates category from currency', () => {
    // The behaviour the escape preserves: two fields joined by a separator that
    // neither of them can contain, so ('Real Assets','USD') and
    // ('Real','Assets USD') can never collapse into one group.
    const src = read('src/lib/familyPortfolio/alternatives/parseAlternatives.ts')
    assert.match(src, /const key = `\$\{h\.category\}\\u0000\$\{h\.currency\}`/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11 · Contract version and pgTAP coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.5 · contract', () => {
  test('the lifecycle version is stamped and recorded on every publication', () => {
    assert.equal(PUBLICATION_LIFECYCLE_VERSION, 'r13.5.publication.1')
    assert.match(read(PUBLISH_ROUTE), /lifecycleVersion: PUBLICATION_LIFECYCLE_VERSION/)
  })

  test('the pgTAP suite covers what only PostgreSQL can prove', () => {
    const sql = read(PGTAP)
    for (const marker of [
      'nmi_publish_portfolio',
      'nmi_rollback_publication',
      'nmi_upsert_portfolio_commentary',
      'portfolio_commentary',
      'publication_refused_blocking_findings',
      'publication_refused_unclassified_events',
      // Publication-safety audit additions.
      'nmi_lock_publication_series',
      'publication_refused_duplicate_submission',
      'a DUPLICATE REVISION NUMBER is impossible',
      'no publication supersedes itself',
      'no supersession pointer crosses a lifecycle or a week',
      'ROLLING BACK ALTERNATIVES DID NOT TOUCH',
      'the week is never left with zero current revisions',
      'two live commentary revisions',
      // Revision-ordering repair (run 31210961884).
      'every publication superseded_by resolves to an existing revision',
      'every commentary superseded_by resolves to an existing revision',
      'revision 1 points at revision 2, and revision 2 is a real row',
      'commentary revision 1 points at revision 2, and revision 2 is a real row',
      'the refused edit left revision 2 live and untouched',
      'inserts the new revision BEFORE pointing the predecessor at it',
      'anon is REFUSED outright on commentary',
    ]) {
      assert.ok(sql.includes(marker), `pgTAP must exercise ${marker}`)
    }
  })

  test('the pgTAP suite does not claim concurrency was runtime-validated', () => {
    const sql = read(PGTAP)
    // One session inside one transaction cannot start a second writer. Saying so
    // in the suite keeps a future reader from mistaking these assertions for a
    // concurrency test.
    assert.match(sql, /TRUE CONCURRENCY IS NOT EXERCISED HERE/)
  })

  test('the parser modules stay pure — no Supabase or Next import', () => {
    for (const rel of [
      'src/lib/familyPortfolio/publication.ts',
      'src/lib/familyPortfolio/alternatives/parseAlternatives.ts',
      'src/lib/familyPortfolio/resumen/parseResumen.ts',
    ]) {
      const src = read(rel)
      assert.ok(!src.includes('@supabase'), rel)
      assert.ok(!src.includes('next/'), rel)
      assert.ok(!src.includes('process.env'), rel)
    }
  })
})
