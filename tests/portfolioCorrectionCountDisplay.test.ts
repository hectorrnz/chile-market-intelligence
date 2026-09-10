// FOLLOW-UP — the authorization card's correction count.
//
// WHAT THIS FILE PROVES. The historical-correction gate has FOUR independent
// causes: an evolution overwrite, a publication restatement, a row-history
// correction and a performance-history correction. Any one of them raises
// `requiresHistoricalCorrection` and puts the administrator in front of the
// authorization card.
//
// The card's heading used to read `{verdictCorrectionTitle} · {corrections.length}`
// — the EVOLUTION count alone. An import that restates seven already-published
// weeks while overwriting no evolution point therefore displayed
//
//     Historical correction required · 0
//
// directly above the checkbox authorizing those seven weeks. The number was
// accurate about evolution overwrites and false about what was being authorized.
//
// The rule these tests hold: a count is shown on the card that shows the thing
// it counts, and the gate heading — a condition, not a quantity — carries none.
// Nothing about classification, authorization or analytical history changes.
//
// NO PRIVATE DATA. Every figure below is a small synthetic integer.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  planWeeklyImport,
  type SeriesObservation,
  type HistoricalPublicationRestatement,
  type RowHistorySummary,
  type PerformanceHistorySummary,
} from '../src/lib/familyPortfolio/weeklyImportPlan.ts'
import { dict } from '../src/lib/i18n.ts'

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const component = read('../src/components/familyPortfolio/ImportPlanPreview.tsx')

/** The body of one component function, so a source assertion cannot stray. */
function fnSource(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start > 0, `${name} must exist`)
  const next = src.indexOf('\nfunction ', start + 1)
  return src.slice(start, next > start ? next : src.length)
}

const card = fnSource(component, 'HistoricalChangesCard')

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — the shape of the R13.8 restoration, at synthetic scale.
// ─────────────────────────────────────────────────────────────────────────────

/** Production's settled weeks; the endpoint is the last of them. */
const PUBLISHED = [
  '2026-06-19', '2026-06-26', '2026-07-03',
  '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31',
] as const
/** The catch-up weeks the workbook adds above that endpoint. */
const NEW_WEEKS = ['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04'] as const

function obs(date: string, value: number): SeriesObservation {
  return { scope: 'main', basis: 'with_chilean_equities', observationDate: date, value, status: 'stated' }
}

function restatement(asOfDate: string, differenceCount = 5): HistoricalPublicationRestatement {
  return { asOfDate, publicationId: `pub-${asOfDate}`, revision: 2, differenceCount, differences: [] }
}

function rowHistory(over: Partial<RowHistorySummary> = {}): RowHistorySummary {
  return { insertedCount: 0, changedCount: 0, datesInserted: [], datesChanged: [], ...over }
}

function perfHistory(over: Partial<PerformanceHistorySummary> = {}): PerformanceHistorySummary {
  return { insertedCount: 0, changedCount: 0, datesInserted: [], datesChanged: [], ...over }
}

/**
 * The restoration's own shape: five NEW weeks, seven restated published weeks
 * carrying 35 differing figures, ZERO evolution overwrites, and analytical
 * history inserted for every date and overwritten at none.
 */
function restorationPlan() {
  const published = PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10))
  return planWeeklyImport({
    // Every settled week is restated identically at the evolution level, so the
    // only thing the workbook adds is the five catch-up weeks.
    workbookObservations: [
      ...published,
      ...NEW_WEEKS.map((d, i) => obs(d, 1_100 + i * 10)),
    ],
    publishedObservations: published,
    historicalPublicationRestatements: PUBLISHED.map((d) => restatement(d, 5)),
    rowHistory: rowHistory({ insertedCount: 19_757, datesInserted: [...PUBLISHED, ...NEW_WEEKS] }),
    performanceHistory: perfHistory({ insertedCount: 2_260, datesInserted: [...PUBLISHED, ...NEW_WEEKS] }),
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · The state that produced the false zero
// ═══════════════════════════════════════════════════════════════════════════

describe('seven restated weeks with no evolution overwrite', () => {
  const plan = restorationPlan()

  test('the gate is on, and its cause is the publication restatement alone', () => {
    assert.equal(plan.requiresHistoricalCorrection, true)
    assert.equal(plan.requiresPublicationRestatementCorrection, true)
    assert.equal(plan.requiresEvolutionCorrection, false)
    assert.equal(plan.requiresRowHistoryCorrection, false)
    assert.equal(plan.requiresPerformanceHistoryCorrection, false)
    assert.deepEqual(plan.blockCodes, ['historical_correction_required'])
  })

  test('the evolution correction count is genuinely zero while seven weeks restate', () => {
    assert.equal(plan.corrections.length, 0)
    assert.equal(plan.historicalPublicationRestatements.length, 7)
    assert.equal(
      plan.historicalPublicationRestatements.reduce((s, r) => s + r.differenceCount, 0),
      35,
    )
  })

  test('the authorization card cannot display that zero as the correction count', () => {
    // The heading names the gate and carries no number of any kind.
    assert.match(card, /\{a\.verdictCorrectionTitle\}\s*\n/)
    assert.doesNotMatch(card, /a\.verdictCorrectionTitle\}\s*·/)
    // The evolution count is never rendered outside the branch that renders the
    // evolution table, so a plan with zero corrections shows no count at all.
    const heading = card.slice(card.indexOf('a.verdictCorrectionTitle'), card.indexOf('a.correctionHint'))
    assert.doesNotMatch(heading, /corrections\.length/)
  })

  test('the seven restated weeks keep their own visible count on their own card', () => {
    const restatementCard = fnSource(component, 'RestatementCard')
    assert.match(restatementCard, /\{a\.restatementTitle\}\s*·\s*<span className="ui-number">\{weeks\.length\}<\/span>/)
    assert.equal(dict.en.fpAdmin.restatementTitle, 'Restated published weeks')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · The count still exists, on the table it counts
// ═══════════════════════════════════════════════════════════════════════════

describe('an evolution overwrite still reports its own count', () => {
  const plan = planWeeklyImport({
    workbookObservations: PUBLISHED.map((d, i) => obs(d, i === 2 ? 9_999 : 1_000 + i * 10)),
    publishedObservations: PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
    historicalPublicationRestatements: [],
  })

  test('the plan carries the overwrite and nothing else', () => {
    assert.equal(plan.corrections.length, 1)
    assert.equal(plan.requiresEvolutionCorrection, true)
    assert.equal(plan.requiresPublicationRestatementCorrection, false)
    assert.equal(plan.requiresHistoricalCorrection, true)
  })

  test('the count is rendered with the evolution table, inside the same guard', () => {
    const guard = card.indexOf('{plan.corrections.length > 0 && (')
    assert.ok(guard > 0, 'the evolution table stays behind its own guard')
    const label = card.indexOf('{a.planChanged} ·', guard)
    assert.ok(label > guard, 'the evolution count sits inside that guard')
    assert.match(card.slice(label, label + 140), /<span className="ui-number">\{plan\.corrections\.length\}<\/span>/)
    // And it is labelled as a historical CHANGE, not as the gate.
    assert.equal(dict.en.fpAdmin.planChanged, 'Historical changes')
    assert.equal(dict.es.fpAdmin.planChanged, 'Cambios históricos')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Analytical history stays a separate concept
// ═══════════════════════════════════════════════════════════════════════════

describe('analytical history is counted apart from publication restatement', () => {
  test('inserts alone never ask for a historical-correction authorization', () => {
    const plan = planWeeklyImport({
      workbookObservations: PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
      publishedObservations: PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
      historicalPublicationRestatements: [],
      rowHistory: rowHistory({ insertedCount: 19_757, datesInserted: [...PUBLISHED] }),
      performanceHistory: perfHistory({ insertedCount: 2_260, datesInserted: [...PUBLISHED] }),
    })
    assert.equal(plan.requiresRowHistoryCorrection, false)
    assert.equal(plan.requiresPerformanceHistoryCorrection, false)
    assert.equal(plan.requiresHistoricalCorrection, false)
    assert.deepEqual(plan.blockCodes, [])
  })

  test('an analytical CHANGED row gates on its own, without inventing a restatement', () => {
    const plan = planWeeklyImport({
      workbookObservations: PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
      publishedObservations: PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
      historicalPublicationRestatements: [],
      rowHistory: rowHistory({ changedCount: 3, datesChanged: ['2026-07-17'] }),
    })
    assert.equal(plan.requiresRowHistoryCorrection, true)
    assert.equal(plan.requiresHistoricalCorrection, true)
    // The two counts never merge into one another.
    assert.equal(plan.corrections.length, 0)
    assert.equal(plan.historicalPublicationRestatements.length, 0)
    assert.equal(plan.rowHistory.changedCount, 3)
  })

  test('the restoration inserts analytical history and overwrites none of it', () => {
    const plan = restorationPlan()
    assert.equal(plan.rowHistory.changedCount, 0)
    assert.equal(plan.performanceHistory.changedCount, 0)
    assert.equal(plan.rowHistory.insertedCount, 19_757)
    assert.equal(plan.performanceHistory.insertedCount, 2_260)
    // …and that insertion is not what raised the gate.
    assert.equal(plan.requiresRowHistoryCorrection, false)
    assert.equal(plan.requiresPerformanceHistoryCorrection, false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · The restoration's classification is untouched by the display change
// ═══════════════════════════════════════════════════════════════════════════

describe('the 5 / 7 / 35 restoration plan is unchanged', () => {
  const plan = restorationPlan()

  test('five new weeks, nothing gap-filled, nothing changed, nothing invalid', () => {
    assert.equal(plan.newDates.length, 5)
    assert.deepEqual([...plan.newDates], [...NEW_WEEKS])
    assert.equal(plan.gapFillDates.length, 0)
    assert.equal(plan.changedDates.length, 0)
    assert.equal(plan.invalidDates.length, 0)
  })

  test('seven restated weeks carrying thirty-five differing figures', () => {
    assert.deepEqual(
      plan.historicalPublicationRestatements.map((r) => r.asOfDate),
      [...PUBLISHED],
    )
    assert.equal(plan.historicalRestatementDates.length, 7)
    assert.equal(
      plan.historicalPublicationRestatements.reduce((s, r) => s + r.differenceCount, 0),
      35,
    )
  })

  test('authorization with a written reason is what clears the one block', () => {
    const authorized = planWeeklyImport({
      workbookObservations: [
        ...PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
        ...NEW_WEEKS.map((d, i) => obs(d, 1_100 + i * 10)),
      ],
      publishedObservations: PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
      historicalPublicationRestatements: PUBLISHED.map((d) => restatement(d, 5)),
      historicalCorrectionAuthorized: true,
      correctionReason: 'Restore the accidentally rolled-back R13.8 import.',
    })
    assert.equal(authorized.blocked, false)
    assert.deepEqual(authorized.blockCodes, [])
    assert.equal(authorized.atomic, true)

    // Authorizing without a reason is refused by a stricter code, never waved through.
    const noReason = planWeeklyImport({
      workbookObservations: [
        ...PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
        ...NEW_WEEKS.map((d, i) => obs(d, 1_100 + i * 10)),
      ],
      publishedObservations: PUBLISHED.map((d, i) => obs(d, 1_000 + i * 10)),
      historicalPublicationRestatements: PUBLISHED.map((d) => restatement(d, 5)),
      historicalCorrectionAuthorized: true,
      correctionReason: '   ',
    })
    assert.equal(noReason.blocked, true)
    assert.deepEqual(noReason.blockCodes, ['correction_reason_required'])
  })
})
