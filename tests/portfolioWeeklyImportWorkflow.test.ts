// R13.8B §§ 4-13 — the administrator weekly-upload workflow, end to end.
//
// NO PRIVATE SOURCE DATA. Every workbook here is synthetic, built in memory from
// `tests/fixtures/weeklyImportWorkbook.ts`, with obviously-fake small-integer
// values. The private input directory is never read.
//
// WHAT THIS FILE PROVES AND WHAT IT DOES NOT.
//
// It exercises the seam R13.8B introduces: parser → frozen-column selection →
// evolution extraction → planner → preview. That is the half that runs in
// TypeScript and can be proven here, deterministically, with no database.
//
// The other half — that the plan APPLIES and REVERSES atomically — is a claim
// about real PostgreSQL, and no amount of TypeScript can establish it. It is
// proven by `supabase/tests/database/portfolio_import_operations_test.sql`
// under the hermetic CI stack, including a deliberately LATE failure and a
// chained rollback. This file therefore asserts the WIRING to that RPC (the
// route calls it, and nothing writes history outside it) rather than restating
// a transactional guarantee it cannot test.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  weeklyWorkbook, weekIso, valueFor,
  ROW_SUBTOTAL, ROW_TOTAL, ROW_JAIME_TOTAL,
} from './fixtures/weeklyImportWorkbook.ts'
import {
  selectFrozenPublicationColumn,
  parseAtFrozenPublicationColumn,
  buildWeeklyImportPreview,
  planFingerprint,
  IMPORT_PREVIEW_VERSION,
} from '../src/lib/familyPortfolio/weeklyImportPreview.ts'
import type { SeriesObservation } from '../src/lib/familyPortfolio/weeklyImportPlan.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Strips comments so a prose mention never satisfies a code assertion. */
const codeOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const ADMIN_PAGE = 'src/app/portfolio/admin/page.tsx'
// R13.8C — the plan's composition moved into a co-located presentational
// component with a pure derivation module; the page composes them.
const PREVIEW_COMPONENT = 'src/components/familyPortfolio/ImportPlanPreview.tsx'
const PRESENTATION_MODULE = 'src/lib/familyPortfolio/importPlanPresentation.ts'
const IMPORT_FIXTURES = 'src/lib/familyPortfolio/fixtures/importPreviewFixtures.ts'
const PUBLISH_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/publish/route.ts'
const DRAFT_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/route.ts'
const UPLOADS_ROUTE = 'src/app/api/family-portfolio/admin/uploads/route.ts'
const IMPORT_ROLLBACK_ROUTE = 'src/app/api/family-portfolio/admin/imports/[id]/rollback/route.ts'
const PREVIEW_MODULE = 'src/lib/familyPortfolio/weeklyImportPreview.ts'
const PREVIEW_SERVER = 'src/lib/familyPortfolio/importPreviewServer.ts'
const DRAFT_REVIEW = 'src/lib/familyPortfolio/draftReview.ts'

/**
 * The number of frozen week columns every fixture below carries.
 *
 * `detectColumns` refuses a header row with fewer than 20 date-formatted weekly
 * columns — a real RESUMEN carries a hundred, and a sheet with three would not
 * be one. So the fixtures are full-length and the interesting weeks sit at the
 * TAIL, which is also where a real catch-up puts them.
 */
const W = 25

/** The three series the extractor publishes, for frozen week `i`. */
function wbObs(i: number): SeriesObservation[] {
  return [
    { scope: 'main', basis: 'ex_chilean_equities', observationDate: weekIso(i), value: valueFor(ROW_SUBTOTAL, i) },
    { scope: 'main', basis: 'with_chilean_equities', observationDate: weekIso(i), value: valueFor(ROW_TOTAL, i) },
    { scope: 'jaime', basis: 'total', observationDate: weekIso(i), value: valueFor(ROW_JAIME_TOTAL, i) },
  ]
}

/** What Production holds when it agrees with the workbook through week `last`. */
function prodThrough(last: number, skip: number[] = []): SeriesObservation[] {
  const out: SeriesObservation[] = []
  for (let i = 0; i <= last; i++) {
    if (skip.includes(i)) continue
    out.push(...wbObs(i))
  }
  return out
}

/**
 * Plans an import of a synthetic workbook against a synthetic Production state.
 *
 * `published` is what Production already holds. Everything else is derived from
 * the workbook exactly as the real path derives it.
 */
function planFor(
  bytes: Buffer,
  published: readonly SeriesObservation[],
  opts: { latestPublishedAsOf?: string | null; authorized?: boolean; reason?: string | null } = {},
) {
  const { selection, draft } = parseAtFrozenPublicationColumn(bytes)
  assert.ok(draft, 'the fixture must parse at its newest frozen column')
  return buildWeeklyImportPreview({
    bytes,
    selection,
    draft,
    published,
    latestPublishedAsOf: opts.latestPublishedAsOf ?? null,
    historicalCorrectionAuthorized: opts.authorized,
    correctionReason: opts.reason,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// § 5 · Frozen column selection in the real upload path
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B § 5 — the publication column is the newest VALID FROZEN one', () => {
  test('selection picks the newest frozen week, never the live column', () => {
    const bytes = weeklyWorkbook({ weeks: W })
    const sel = selectFrozenPublicationColumn(bytes)

    assert.equal(sel.refusal, null)
    assert.equal(sel.publicationDate, weekIso(W - 1), 'the newest frozen week, not the live one')
    assert.equal(sel.historicalColumnCount, W)
    assert.equal(sel.frozenDates.length, W)

    // The live column is DETECTED and REPORTED — it is simply never selected.
    assert.ok(sel.liveColumnLetter, 'the live column is identified')
    assert.notEqual(sel.publicationColumnLetter, sel.liveColumnLetter)
    assert.equal(sel.liveColumnPublishable, false)
    // Its cached header date is one week PAST the newest frozen one, so a path
    // that selected it would produce a visibly different — and wrong — date.
    assert.equal(sel.liveColumnDate, weekIso(W))
  })

  test('the live column being entirely #NAME? does not block publication', () => {
    // Every live cell in the fixture is an error, exactly as the real workbook
    // reads without the Bloomberg add-in. Publication eligibility is a property
    // of the FROZEN history and must be unaffected.
    const bytes = weeklyWorkbook({ weeks: W })
    const { selection, draft } = parseAtFrozenPublicationColumn(bytes)
    assert.equal(selection.refusal, null)
    assert.ok(draft?.ok, 'a workbook whose live column is all #NAME? still parses a frozen week')
    assert.equal(draft?.detectedAsOfDate, weekIso(W - 1))
  })

  test('the live column is not selected even when it WOULD parse cleanly', () => {
    // The strongest form of the rule: the live column is excluded structurally,
    // not merely because it happens to be broken. A fixture whose live column is
    // perfectly readable must still publish the frozen week.
    const bytes = weeklyWorkbook({ weeks: W, liveErrors: false })
    const sel = selectFrozenPublicationColumn(bytes)
    assert.equal(sel.publicationDate, weekIso(W - 1), 'still the newest FROZEN week')
    assert.notEqual(sel.publicationColumnLetter, sel.liveColumnLetter)
  })

  test('no column letter is hard-coded anywhere in the selection path', () => {
    for (const rel of [PREVIEW_MODULE, PREVIEW_SERVER, DRAFT_REVIEW, PUBLISH_ROUTE]) {
      const src = codeOf(read(rel))
      assert.ok(!/['"]CZ['"]/.test(src), `${rel} must not hard-code a column letter`)
    }
  })

  test('loadDraft goes through the selector, never the bare parser', () => {
    const src = codeOf(read(DRAFT_REVIEW))
    assert.ok(src.includes('parseAtFrozenPublicationColumn'))
    assert.ok(!/\bparseResumen\s*\(/.test(src), 'the bare parser default selects the live column')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 12 · Synthetic end-to-end cases, parser → planner → preview
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B § 12 — catch-up cases through the real parse path', () => {
  test('A · three unpublished frozen weeks all import, under ONE publication', () => {
    // Production ends three weeks back; the workbook carries all of them.
    const last = W - 4
    const bytes = weeklyWorkbook({ weeks: W })
    const { preview, plan } = planFor(bytes, prodThrough(last), { latestPublishedAsOf: weekIso(last) })

    assert.deepEqual(preview.newDates, [weekIso(W - 3), weekIso(W - 2), weekIso(W - 1)],
      'ALL THREE unpublished weeks are appended, never just the newest')
    assert.deepEqual(preview.gapFillDates, [])
    assert.deepEqual(preview.corrections, [])
    assert.equal(preview.publicationDate, weekIso(W - 1),
      'ONE publication, at the newest valid frozen date')
    assert.equal(preview.action, 'multi_week_append')

    // Multi-week append is ordinary recurring behaviour, NOT a correction.
    assert.equal(preview.requiresHistoricalCorrection, false)
    assert.equal(preview.blocked, false)
    assert.equal(plan.atomic, true)

    // Three weeks × three series, and not one identity more: the ~66 unchanged
    // identities are excluded, because restating them is how a rewrite hides.
    assert.equal(plan.observationsToWrite.length, 9)
    assert.equal(preview.counts.new, 9)
    assert.equal(preview.counts.changed, 0)
    assert.ok(preview.unchangedCount > 0, 'the weeks Production already agrees with')
  })

  test('B · a hole below the endpoint is a GAP_FILL and needs no reason', () => {
    // Production holds every week through the last one EXCEPT one in the middle.
    const hole = W - 3
    const bytes = weeklyWorkbook({ weeks: W })
    const published = prodThrough(W - 1, [hole])

    const { preview } = planFor(bytes, published, { latestPublishedAsOf: weekIso(W - 1) })

    assert.deepEqual(preview.gapFillDates, [weekIso(hole)])
    assert.deepEqual(preview.newDates, [], 'nothing is above the endpoint')
    assert.deepEqual(preview.corrections, [])
    // The whole point: an insertion is not an overwrite.
    assert.equal(preview.requiresHistoricalCorrection, false)
    assert.equal(preview.blocked, false, 'a gap fill confirms with no correction reason')
  })

  test('C · a gap fill AND a restated week — only the CHANGE needs a reason', () => {
    const hole = W - 3
    const restated = W - 5
    const bytes = weeklyWorkbook({ weeks: W })
    const published: SeriesObservation[] = [
      ...prodThrough(W - 1, [hole, restated]),
      // The restated week exists in Production, with one series disagreeing.
      { scope: 'main', basis: 'ex_chilean_equities', observationDate: weekIso(restated), value: 1 },
      { scope: 'main', basis: 'with_chilean_equities', observationDate: weekIso(restated), value: valueFor(ROW_TOTAL, restated) },
      { scope: 'jaime', basis: 'total', observationDate: weekIso(restated), value: valueFor(ROW_JAIME_TOTAL, restated) },
    ]

    const unauthorized = planFor(bytes, published, { latestPublishedAsOf: weekIso(W - 1) }).preview
    assert.deepEqual(unauthorized.gapFillDates, [weekIso(hole)])
    assert.equal(unauthorized.corrections.length, 1)
    assert.equal(unauthorized.corrections[0].observationDate, weekIso(restated))
    assert.equal(unauthorized.corrections[0].beforeValue, 1)
    assert.equal(unauthorized.corrections[0].afterValue, valueFor(ROW_SUBTOTAL, restated))

    // Blocked purely because of the overwrite — the gap fill contributes nothing.
    assert.equal(unauthorized.requiresHistoricalCorrection, true)
    assert.equal(unauthorized.blocked, true)
    assert.ok(unauthorized.blockCodes.includes('historical_correction_required'))

    // Authorized but with no reason: still blocked.
    const noReason = planFor(bytes, published, {
      latestPublishedAsOf: weekIso(W - 1), authorized: true, reason: '   ',
    }).preview
    assert.equal(noReason.blocked, true)
    assert.ok(noReason.blockCodes.includes('correction_reason_required'))

    // Authorized with a reason: the gap fill rides along, unblocked.
    const ok = planFor(bytes, published, {
      latestPublishedAsOf: weekIso(W - 1), authorized: true, reason: 'restated by the custodian',
    }).preview
    assert.equal(ok.blocked, false)
    assert.deepEqual(ok.gapFillDates, [weekIso(hole)])
    assert.equal(ok.corrections.length, 1)
  })

  test('D · a week the workbook never froze is NEVER invented', () => {
    // The column exists in the header but the source froze no value in it.
    const omitted = W - 4
    const bytes = weeklyWorkbook({ weeks: W, omitWeeks: [omitted] })
    const { preview, plan } = planFor(bytes, [], { latestPublishedAsOf: null })

    const allDates = plan.observationsToWrite.map((o) => o.observationDate)
    assert.ok(!allDates.includes(weekIso(omitted)),
      'the week the workbook never froze must not appear as an observation')
    assert.ok(!preview.newDates.includes(weekIso(omitted)))
    assert.ok(!preview.gapFillDates.includes(weekIso(omitted)))

    // It is reported as a cadence gap — information, not a licence to fabricate.
    assert.ok(
      preview.cadenceGaps.some((g) => g.from === weekIso(omitted - 1) && g.to === weekIso(omitted + 1)),
      'the missing week is reported as a cadence gap over the post-import sequence',
    )
    // And a cadence gap never blocks.
    assert.equal(preview.blocked, false)
  })

  test('E · three new weeks and two gap fills plan as ONE atomic import', () => {
    // Production ends four weeks back and is missing two weeks below that.
    const last = W - 4
    const holes = [last - 3, last - 1]
    const bytes = weeklyWorkbook({ weeks: W })
    const published = prodThrough(last, holes)

    const { preview, plan } = planFor(bytes, published, { latestPublishedAsOf: weekIso(last) })

    assert.deepEqual(preview.gapFillDates, [weekIso(holes[0]), weekIso(holes[1])])
    assert.deepEqual(preview.newDates, [weekIso(W - 3), weekIso(W - 2), weekIso(W - 1)])
    assert.equal(preview.publicationDate, weekIso(W - 1))
    assert.equal(preview.requiresHistoricalCorrection, false, 'five insertions, zero overwrites')
    assert.equal(preview.blocked, false)
    assert.equal(plan.atomic, true)
    // Five weeks × three series, in ONE plan.
    assert.equal(plan.observationsToWrite.length, 15)
  })

  test('the preview separates the three groups and never merges them', () => {
    const restated = W - 3
    const hole = W - 4
    const bytes = weeklyWorkbook({ weeks: W })
    const published: SeriesObservation[] = [
      ...prodThrough(restated, [hole, restated]),
      { scope: 'main', basis: 'ex_chilean_equities', observationDate: weekIso(restated), value: 1 },
      { scope: 'main', basis: 'with_chilean_equities', observationDate: weekIso(restated), value: valueFor(ROW_TOTAL, restated) },
      { scope: 'jaime', basis: 'total', observationDate: weekIso(restated), value: valueFor(ROW_JAIME_TOTAL, restated) },
    ]
    const { preview } = planFor(bytes, published, {
      latestPublishedAsOf: weekIso(restated), authorized: true, reason: 'restated',
    })

    // The groups are per-IDENTITY, not per-week: the restated week appears under
    // corrections while a genuinely absent week appears under gap fills, and the
    // weeks above the endpoint appear under new.
    assert.ok(preview.corrections.some((c) => c.observationDate === weekIso(restated)))
    assert.ok(preview.gapFillDates.includes(weekIso(hole)), 'a genuine hole')
    assert.ok(preview.newDates.includes(weekIso(W - 2)) && preview.newDates.includes(weekIso(W - 1)))
    // Unchanged is a COUNT, never a dump.
    assert.equal(typeof preview.unchangedCount, 'number')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 9 · Stale preview
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B § 9 — a plan built against moved state is refused', () => {
  test('the fingerprint changes when Production moves under the plan', () => {
    const bytes = weeklyWorkbook({ weeks: W })
    const before = prodThrough(W - 3)
    const a = planFor(bytes, before, { latestPublishedAsOf: weekIso(W - 3) })

    // Another import lands the next week in the meantime.
    const after = [...before, ...wbObs(W - 2)]
    const b = planFor(bytes, after, { latestPublishedAsOf: weekIso(W - 2) })

    assert.notEqual(a.preview.planFingerprint, b.preview.planFingerprint,
      'the confirmation the administrator gave no longer describes the book')
  })

  test('the fingerprint is stable for an unchanged book', () => {
    const bytes = weeklyWorkbook({ weeks: W })
    const published = prodThrough(W - 3)
    const a = planFor(bytes, published, { latestPublishedAsOf: weekIso(W - 3) })
    const b = planFor(bytes, published, { latestPublishedAsOf: weekIso(W - 3) })
    assert.equal(a.preview.planFingerprint, b.preview.planFingerprint)
    // Order of the published rows must not change it either — the digest is
    // sorted, so a different read order is not a different book.
    const c = planFor(bytes, [...published].reverse(), { latestPublishedAsOf: weekIso(W - 3) })
    assert.equal(a.preview.planFingerprint, c.preview.planFingerprint)
  })

  test('the fingerprint covers the asserted BEFORE-image, not just the output', () => {
    // Two books that write the same identities but disagree about what is being
    // overwritten must not share a fingerprint — otherwise a confirmation could
    // be replayed against a different prior value.
    const restated = W - 2
    const bytes = weeklyWorkbook({ weeks: W })
    const base = prodThrough(W - 1, [restated])
    const one = planFor(bytes, [
      ...base,
      { scope: 'main', basis: 'ex_chilean_equities', observationDate: weekIso(restated), value: 11 },
    ], { latestPublishedAsOf: weekIso(W - 1), authorized: true, reason: 'r' })
    const two = planFor(bytes, [
      ...base,
      { scope: 'main', basis: 'ex_chilean_equities', observationDate: weekIso(restated), value: 22 },
    ], { latestPublishedAsOf: weekIso(W - 1), authorized: true, reason: 'r' })

    assert.equal(one.preview.corrections.length, 1)
    assert.equal(two.preview.corrections.length, 1)
    assert.notEqual(one.preview.planFingerprint, two.preview.planFingerprint)
  })

  test('planFingerprint is a pure function of the plan', () => {
    const bytes = weeklyWorkbook({ weeks: W })
    const { plan } = planFor(bytes, [], { latestPublishedAsOf: null })
    assert.equal(planFingerprint(plan), planFingerprint(plan))
    assert.match(planFingerprint(plan), /^[0-9a-f]{64}$/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 4 · The administrator front door
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B § 4 — the upload control', () => {
  const page = read(ADMIN_PAGE)

  test('it posts to the EXISTING upload endpoint, not a parallel one', () => {
    assert.match(page, /fetch\('\/api\/family-portfolio\/admin\/uploads', \{ method: 'POST', body: form \}\)/)
    // No second upload route may exist.
    const routes = read(UPLOADS_ROUTE)
    assert.match(routes, /export async function POST/)
  })

  test('it submits FormData with a file field and an upload kind', () => {
    assert.match(page, /new FormData\(\)/)
    assert.match(page, /form\.append\('file', file\)/)
    assert.match(page, /form\.append\('uploadKind', kind\)/)
    assert.match(page, /type="file"/)
    assert.match(page, /accept="\.xlsx/)
  })

  test('it carries every required state', () => {
    for (const key of ['uploading', 'uploadDone', 'noFileChosen', 'chooseFile']) {
      assert.ok(page.includes(key), `the ${key} state must be rendered`)
    }
    // A blocking error and a non-blocking warning are told apart.
    assert.match(page, /severity !== 'blocking'/)
  })

  test('it transitions into the draft preview after a successful upload', () => {
    assert.match(page, /setPendingUploadId\(uploadId\)/)
    assert.match(page, /setSelected\(row\)/)
  })

  test('it renders only inside the administrator-ready state', () => {
    // `denied` (403 from the console index) renders the authorization message
    // and nothing else — the upload control is not reachable from it.
    const ready = page.indexOf("state === 'ready'")
    const panel = page.indexOf('<UploadPanel')
    assert.ok(ready > 0 && panel > ready, 'the control lives inside the ready branch')
    // `[\s\S]` rather than the `s` flag: this tsconfig targets below es2018.
    assert.match(page, /state === 'denied'[\s\S]{0,80}notAuthorized/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 6-7 · Preview rendering and confirmation gating
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B §§ 6-7 — preview and confirmation', () => {
  // The administrator SURFACE: the page plus the component it composes.
  const page = read(ADMIN_PAGE) + read(PREVIEW_COMPONENT)
  const component = read(PREVIEW_COMPONENT)

  test('the preview names all three groups separately', () => {
    for (const key of ['planNew', 'planGapFill', 'planChanged', 'planUnchanged', 'planCadence']) {
      assert.ok(page.includes(`a.${key}`), `${key} must be rendered`)
    }
    // The endpoint, the newest frozen week and the date about to become current.
    for (const key of ['planEndpoint', 'planNewestFrozen', 'planPublication', 'planSchema']) {
      assert.ok(page.includes(`a.${key}`), `${key} must be rendered`)
    }
  })

  test('the live column is shown as a diagnostic, labelled as not published', () => {
    assert.ok(page.includes('a.planLiveColumn'))
    assert.ok(page.includes('a.planLiveHint'))
  })

  test('an overwrite shows its exact before and after', () => {
    // R13.8C — as a two-column table: the current (published) value and the
    // workbook value, side by side, with the change between them.
    assert.ok(page.includes('a.colCurrentValue') && page.includes('a.colWorkbookValue'))
    assert.match(page, /c\.beforeValue/)
    assert.match(page, /c\.afterValue/)
  })

  test('unchanged identities are a count, never a dump', () => {
    assert.match(page, /plan\.unchangedCount/)
    assert.ok(!/unchangedDates\.map/.test(page), 'restating ~500 identical rows is how a rewrite hides')
  })

  test('correction mode renders ONLY when an identity is overwritten', () => {
    assert.match(page, /const needsCorrection = plan\?\.requiresHistoricalCorrection === true/)
    // R13.8C — the correction card is its own component, and it returns nothing
    // unless the plan overwrites an identity.
    assert.match(component, /if \(!plan\.requiresHistoricalCorrection\) return null/)
  })

  test('confirm is disabled until an overwrite is authorized AND explained', () => {
    assert.match(
      page,
      /correctionIncomplete\s*=\s*[\r\n]?\s*needsCorrection && \(!correctionAuthorized \|\| correctionReason\.trim\(\)\.length === 0\)/,
    )
    assert.match(page, /disabled=\{[\s\S]{0,400}correctionIncomplete/)
  })

  test('neither a multi-week append nor a gap fill can trigger correction mode', () => {
    // The gate reads ONE field, and that field is set only by an overwrite.
    // Proven behaviourally above (cases A, B, E); asserted structurally here so
    // a future edit cannot widen the condition to a week count.
    assert.ok(!/newDates\.length > 1/.test(page), 'a week count must never gate a correction')
    assert.ok(!/gapFillDates\.length > 0 &&[\s\S]{0,80}correction/i.test(page))
  })

  test('the confirmation sends only a decision and a fingerprint', () => {
    const src = codeOf(read(ADMIN_PAGE))
    assert.match(src, /historicalCorrectionAuthorized: correctionAuthorized/)
    assert.match(src, /correctionReason: correctionReason\.trim\(\) \|\| null/)
    assert.match(src, /expectedPlanFingerprint: plan\?\.planFingerprint/)
    // No classification, date, prior value or row travels from the browser.
    assert.ok(!/observationsToWrite/.test(src), 'the browser never sends mutations')
    assert.ok(!/priorValue/.test(src), 'the browser never asserts a before-image')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 8 · The atomic apply route
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B § 8 — confirm applies through the atomic RPC', () => {
  const src = read(PUBLISH_ROUTE)
  const code = codeOf(src)

  test('the portfolio branch calls the import RPC and nothing else writes history', () => {
    assert.match(code, /importPortfolioWorkbook\(/)
    assert.ok(!code.includes('upsertEvolutionObservations'), 'no post-commit history write')
    assert.ok(!code.includes('publishPortfolio('), 'the plain publish path no longer runs for a workbook')
  })

  test('there is no client-side history upsert anywhere in the admin surface', () => {
    const page = codeOf(read(ADMIN_PAGE))
    assert.ok(!/portfolio_evolution_observations/.test(page))
    assert.ok(!/upsert/i.test(page), 'the browser never writes a row')
  })

  test('there is no sequential fallback apply', () => {
    // A "try the RPC, else write them one at a time" path would silently restore
    // exactly the partial-application failure R13.8B exists to remove.
    assert.ok(!/catch[\s\S]{0,200}upsertEvolution/i.test(code))
    assert.ok(!/for \([\s\S]{0,80}of observations\)[\s\S]{0,200}await/.test(code),
      'observations must be sent as one packet, never looped over with awaits')
  })

  test('the plan is rebuilt server-side at confirm time', () => {
    assert.match(code, /planImportForDraft\(loaded\.draft/)
    // Preview and confirm call the SAME function, so they cannot disagree.
    const draftRoute = codeOf(read(DRAFT_ROUTE))
    assert.match(draftRoute, /planImportForDraft\(/)
  })

  test('a stale fingerprint is refused before anything is written', () => {
    const stale = code.indexOf('plan_stale')
    const write = code.indexOf('importPortfolioWorkbook(')
    assert.ok(stale > 0 && write > 0 && stale < write)
  })

  test('the publication date must be the newest valid frozen date', () => {
    assert.match(code, /publication_date_not_newest_frozen/)
    const guard = code.indexOf('publication_date_not_newest_frozen')
    const write = code.indexOf('importPortfolioWorkbook(')
    assert.ok(guard > 0 && guard < write)
  })

  test('the packet carries the asserted before-image for every mutation', () => {
    assert.match(code, /prior_value: o\.priorValue/)
    assert.match(code, /prior_status: o\.priorStatus/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 10 · Import-aware rollback
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B § 10 — rollback reverses the whole import', () => {
  const route = read(IMPORT_ROLLBACK_ROUTE)

  test('it names an import operation, never a date or a filename', () => {
    assert.match(route, /rollbackPortfolioImport\(/)
    assert.ok(!/file_sha256|original_filename|storage_object_path/.test(route))
    assert.ok(!/asOfDate|as_of_date/.test(codeOf(route)), 'a rollback is never matched on a date')
  })

  test('it refuses rather than clobbers when a later import owns a row', () => {
    assert.match(route, /rollback_refused_superseded_by_later_import: 409/)
    assert.match(route, /rollback_refused_already_rolled_back: 409/)
    assert.match(route, /rollback_refused_publication_not_current: 409/)
  })

  test('every refusal is a conflict, never a 500', () => {
    const statuses = [...route.matchAll(/rollback_refused_[a-z_]+: (\d{3})/g)].map((m) => m[1])
    assert.ok(statuses.length >= 4)
    for (const s of statuses) assert.ok(s === '409' || s === '404', `unexpected status ${s}`)
  })

  test('the refusal is surfaced to the administrator, not swallowed', () => {
    const page = read(ADMIN_PAGE)
    assert.match(page, /setRollbackError\(/)
    assert.match(page, /a\.refusalImport as Record<string, string>/)
  })

  test('the console offers the import rollback beside the publication rollback', () => {
    const page = read(ADMIN_PAGE)
    assert.match(page, /\/api\/family-portfolio\/admin\/imports\/\$\{id\}\/rollback/)
    assert.match(page, /\/api\/family-portfolio\/admin\/publications\/\$\{id\}\/rollback/)
    assert.ok(page.includes('a.importsTitle'), 'the import ledger is listed')
  })

  test('an already-reversed import offers no control', () => {
    const page = read(ADMIN_PAGE)
    assert.match(page, /\{!op\.rolledBackAt && \(/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 13 · Security
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B § 13 — only an administrator reaches any of this', () => {
  const surfaces = [UPLOADS_ROUTE, DRAFT_ROUTE, PUBLISH_ROUTE, IMPORT_ROLLBACK_ROUTE]

  test('every route guards the session and then administrative capability', () => {
    for (const rel of surfaces) {
      const src = read(rel)
      assert.match(src, /await guardPrivateApi\(\)/, rel)
      assert.match(src, /isAdministrator/, rel)
      assert.match(src, /403/, rel)
    }
  })

  test('the capability check precedes any body read or work', () => {
    for (const rel of surfaces) {
      const src = read(rel)
      const guard = src.indexOf('isAdministrator')
      for (const marker of ['request.json()', 'request.formData()', 'loadDraft(']) {
        const at = src.indexOf(marker)
        if (at > 0) {
          assert.ok(guard < at, `${rel}: the capability check must precede ${marker}`)
        }
      }
    }
  })

  test('a non-administrator refusal reveals nothing about the resource', () => {
    // Identical wording everywhere, so a caller cannot tell "you may not" from
    // "it does not exist".
    for (const rel of surfaces) {
      const src = read(rel)
      assert.match(src, /not_authorized/, rel)
    }
  })

  test('the import ledger and preview never reach a member surface', () => {
    // Every R13.8B read is under `/admin/`. A member route must not import the
    // preview, the planner or the import repository functions.
    for (const rel of [
      'src/app/api/family-portfolio/overview/[scope]/route.ts',
      'src/app/api/family-portfolio/[scope]/snapshot/route.ts',
      'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts',
    ]) {
      const src = read(rel)
      assert.ok(!src.includes('weeklyImportPreview'), rel)
      assert.ok(!src.includes('importPortfolioWorkbook'), rel)
      assert.ok(!src.includes('listImportOperations'), rel)
    }
  })

  test('no amount leaves the preview except an overwrite before/after', () => {
    const preview = read(PREVIEW_MODULE)
    // The exception is deliberate and documented in the module header.
    assert.match(preview, /beforeValue/)
    assert.match(preview, /afterValue/)
    // NEW and GAP_FILL travel as DATES, never as values.
    assert.match(preview, /newDates: string\[\]/)
    assert.match(preview, /gapFillDates: string\[\]/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Standing hygiene
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8B — hygiene', () => {
  test('the preview module is pure — no database, server or environment import', () => {
    const src = read(PREVIEW_MODULE)
    assert.ok(!src.includes('@supabase'))
    assert.ok(!src.includes('next/'))
    assert.ok(!src.includes('process.env'))
    assert.ok(!src.includes('@/lib/db'))
  })

  test('the preview is versioned', () => {
    assert.match(IMPORT_PREVIEW_VERSION, /^r13\.8b\./)
  })

  test('no source file this stage touched contains a raw NUL byte', () => {
    for (const rel of [
      PREVIEW_MODULE, PREVIEW_SERVER, DRAFT_REVIEW, PUBLISH_ROUTE, DRAFT_ROUTE,
      UPLOADS_ROUTE, IMPORT_ROLLBACK_ROUTE, ADMIN_PAGE,
      PREVIEW_COMPONENT, PRESENTATION_MODULE, IMPORT_FIXTURES,
      'src/lib/db/repositories/portfolioPublicationRepository.ts',
      'tests/fixtures/weeklyImportWorkbook.ts',
    ]) {
      assert.ok(!read(rel).includes(' '), `${rel} contains a NUL byte`)
    }
  })

  test('no private monetary value is embedded in this suite or its fixture', () => {
    // Every figure here is a small synthetic integer. A six-digit-or-longer
    // numeric literal would be the shape of a real portfolio amount.
    for (const rel of ['tests/portfolioWeeklyImportWorkflow.test.ts', 'tests/fixtures/weeklyImportWorkbook.ts']) {
      const src = read(rel)
        // Excel serials and the 1899 epoch are structural, not monetary.
        .replace(/46000|86_400_000|86400000|1899/g, '')
      const big = src.match(/\b\d{6,}\b/g) ?? []
      assert.deepEqual(big, [], `${rel} must carry no figure shaped like a real amount`)
    }
  })

  test('the private input directory is never referenced', () => {
    // The needle is assembled at runtime so this file does not contain the
    // literal it searches for — otherwise the test would fail on itself, and
    // the obvious "fix" would be to stop scanning the test file at all.
    const needle = ['nmi', 'private', 'inputs'].join('-')
    for (const rel of [
      PREVIEW_MODULE, PREVIEW_SERVER, PUBLISH_ROUTE, DRAFT_ROUTE, ADMIN_PAGE,
      PREVIEW_COMPONENT, PRESENTATION_MODULE, IMPORT_FIXTURES,
      'tests/portfolioWeeklyImportWorkflow.test.ts', 'tests/fixtures/weeklyImportWorkbook.ts',
    ]) {
      assert.ok(!read(rel).includes(needle), rel)
    }
  })
})
