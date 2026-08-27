// R13.8 — Weekly Changes UI/contract tests (doc 08 Stage 8; doc 07 Parts
// A2/A3, page order § 6h).
//
// The FINANCIAL semantics are locked and tested behaviorally in
// `tests/familyPortfolioWeeklyChanges.test.ts` (44 tests over the pure
// module). This file covers the UI half: the § 6h section order, the exact
// § 4.2 product vocabulary in EN and ES, the § 4.3 forbidden-vocabulary rule,
// privacy completeness, cash-toggle semantics, hierarchy/drill-down wiring,
// honest states (`no_previous_week` above all), responsive/accessibility
// structure, and the Stage-9 / `/portfolio` boundaries.
//
// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import { formatChangePct, formatRatioPct, roundsToZeroAt } from '../src/lib/formatters.ts'
import { weeklyProfit } from '../src/lib/familyPortfolio/resumen/performance.ts'
import { reconcileFlowAndProfit } from '../src/lib/familyPortfolio/weeklyChanges.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const PAGE = 'src/app/family-portfolio/weekly-changes/page.tsx'
const ROUTE = 'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts'
// R13.R3C — `ValueChangeWaterfall` and `DivergingBarChart` are both retired.
// The shared Contributors and Detractors pair replaces them on this page AND
// on Summary, which is the property most of this file now guards: ONE chart,
// ONE popup, rendered by both surfaces.
const CONTRIB = 'src/components/familyPortfolio/ContributionChart.tsx'
const MODAL = 'src/components/familyPortfolio/ContributionBreakdownModal.tsx'
const RECON = 'src/components/familyPortfolio/ReconciliationStatus.tsx'
const DATA_HELPER = 'src/lib/data/familyPortfolio.ts'
const PURE_MODULE = 'src/lib/familyPortfolio/weeklyChanges.ts'

const STAGE8_UI_FILES = [PAGE, CONTRIB, MODAL, RECON]

/** Strips comments so hygiene regexes cannot be tripped by prose. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const page = read(PAGE)
const route = read(ROUTE)
const contrib = read(CONTRIB)
const modal = read(MODAL)
const recon = read(RECON)
const wEn = dict.en.fp.weeklyChanges
const wEs = dict.es.fp.weeklyChanges

// ═══════════════════════════════════════════════════════════════════════════
// 1 · § 6h page order — the nine documented sections, in the documented order
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · § 6h page order', () => {
  test('every surviving section renders, in the contract order', () => {
    // Each marker is the section's own i18n title reference (or its anchor
    // component for item 1), so the assertion tracks the REAL render order.
    //
    // R13.R3B.1 — § 6h ITEM 4 IS ABSENT ON PURPOSE. The Drivers waterfall was
    // retired from this page and now lives on Summary over 3M / YTD / 1Y /
    // ALL; the section below asserts it is genuinely gone rather than merely
    // moved down. Every other item keeps its contract position.
    const markers = [
      'WeekSelector', // 1 · header, portfolio selector, week selector
      // R13.R3C.4 — item 2 is the HERO alone: the *Total-level weekly metrics*
      // card that used to follow it is deleted, so the hero's own label is the
      // section's marker.
      'w.weeklyValueChange', // 2 · total-level weekly metrics
      'w.flowReconTitle', // 3 · flow / investment-result reconciliation
      // 4 · RETIRED — see `R13.R3B.1 · the waterfall is retired from this page`
      'w.increasesTitle', // 5a · Largest Weekly Value Increases
      'w.decreasesTitle', // 5b · Largest Weekly Value Decreases
      'w.hierarchyTitle', // 6 · Weekly Value Change by Portfolio Hierarchy
      'w.fullTableTitle', // 7 · full changes table
      // 8 · RETIRED (R13.R3C.2) — see `the historical trend chart is retired`
      'w.statusTitle', // 9 · freshness, statuses, sources
      'w.methodologyTitle', // 9 · persistent methodology note
    ]
    // Skip imports/helpers: measure inside the page component body.
    const body = page.slice(page.indexOf('function WeeklyChangesPageInner'))
    let cursor = -1
    for (const marker of markers) {
      const at = body.indexOf(marker)
      assert.ok(at >= 0, `section marker ${marker} must render`)
      assert.ok(at > cursor, `${marker} must come after the previous § 6h section`)
      cursor = at
    }
  })

  test('a single (scope, week) selection drives every section — one fetch, no per-section week', () => {
    const body = codeOf(page)
    const calls = body.match(/fetchFamilyPortfolioWeeklyChanges\(/g) ?? []
    // One import-free call site: a single effect keyed on the whole selection.
    // R13.R1.1 § 13 widened that selection to include the custom range's FROM
    // endpoint; the invariant under test is that there is still exactly ONE
    // effect and ONE fetch driving every section, not that the key has two
    // members.
    assert.equal(calls.length, 1, 'exactly one fetch call site')
    assert.match(body, /useEffect\(\(\) => \{[\s\S]*?\}, \[activeScope, asOf, compareFrom\]\)/)
    assert.equal((body.match(/useEffect\(/g) ?? []).length, 1, 'exactly one effect')
    // No component holds its own week: the chart/status components never fetch.
    for (const rel of [CONTRIB, MODAL, RECON]) {
      assert.ok(!/fetch\(/.test(codeOf(read(rel))), `${rel} must not fetch`)
    }
  })

  test('week selection is exact — a vanished week resets to latest, never a nearest-week guess', () => {
    assert.match(page, /res\.status === 404 && asOf !== null/)
    assert.match(page, /setAsOf\(null\)/)
    assert.ok(!/nearest|closest|fallbackWeek/i.test(codeOf(page)))
    const helper = codeOf(read(DATA_HELPER))
    assert.ok(!/nearest|closest/i.test(helper), 'the data helper must not offer a nearest-week fallback')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 1b · R13.R3B.1 — the waterfall is RETIRED from this page
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3B.1 / R13.R3C · the waterfall is retired, everywhere', () => {
  test('no waterfall survives ANYWHERE in the app — not the component, not the bridge', () => {
    // R13.R3B.1 removed the waterfall from this page; R13.R3C removed it from
    // Summary too, and with it the only two files that existed to draw one. The
    // guard is therefore repo-wide rather than page-local: a waterfall cannot
    // "come back" if nothing can build or render one.
    for (const gone of [
      'src/components/familyPortfolio/ValueChangeWaterfall.tsx',
      'src/lib/familyPortfolio/valueChangeBridge.ts',
      'src/components/familyPortfolio/DivergingBarChart.tsx',
    ]) {
      assert.ok(!existsSync(join(ROOT, gone)), `${gone} must be deleted, not merely unused`)
    }
    const code = codeOf(page)
    assert.ok(!code.includes('ValueChangeWaterfall'), 'the component is not even imported')
    assert.ok(!code.includes('buildBridge'), 'the bridge layout is not built here')
    assert.ok(!code.includes('valueChangeBridge'), 'the bridge module is not imported here')
    assert.ok(!code.includes('DivergingBarChart'), 'the retired horizontal chart is gone too')
  })

  test('nor is a second copy of the Summary card smuggled in instead', () => {
    // Retiring a chart and then re-adding it under another name would defeat
    // the point of the move; Summary owns this decomposition now.
    const code = codeOf(page)
    for (const forbidden of ['PeriodValueChangeCard', 'valueChangeRange', 'VALUE_CHANGE_PERIODS']) {
      assert.ok(!code.includes(forbidden), `${forbidden} belongs to Summary, not here`)
    }
  })

  test('the personal-scope driver-view rail went with it', () => {
    const code = codeOf(page)
    assert.ok(!code.includes('groupBySociedad'), 'the rail option labels are gone')
    assert.ok(!code.includes('groupByAssetClass'))
    assert.ok(!code.includes('groupingSelector'))
    // …and the vocabulary went with the control, rather than lingering unused.
    for (const key of ['waterfallTitle', 'waterfallNote', 'groupBySociedad', 'groupByAssetClass', 'groupingSelector']) {
      assert.ok(!(key in wEn), `dead key ${key} must be removed from EN`)
      assert.ok(!(key in wEs), `dead key ${key} must be removed from ES`)
    }
  })

  test('the DRIVER RECONCILIATION survives — it describes the week, not a chart', () => {
    const code = codeOf(page)
    // Still derived from the very same locked function the route calls…
    assert.match(code, /buildWaterfall\(total, hierarchyDrivers, STEP_LABELS\)/)
    // …and still reported, under a name that no longer points at a card.
    assert.match(code, /\{w\.driverStatusLabel\}/)
    assert.match(code, /driverReconciliation\.status/)
    assert.equal(wEn.driverStatusLabel, 'Driver reconciliation')
    assert.equal(wEs.driverStatusLabel, 'Conciliación de factores')
    assert.ok(!/waterfall/i.test(wEn.driverStatusLabel), 'the label must not name a retired card')
    assert.ok(!/cascada/i.test(wEs.driverStatusLabel))
  })

  test('ONE driver set is derived, not two — the retired card had its own', () => {
    const code = codeOf(page)
    assert.equal((code.match(/deriveDrivers\(/g) ?? []).length, 1, 'exactly one driver derivation')
    assert.ok(!code.includes('waterfallDrivers'), 'the card-specific driver list is gone')
    assert.ok(!code.includes('waterfallGrouping'))
  })

  test('everything the owner asked to preserve is still on the page', () => {
    for (const marker of [
      'WeekSelector', // week selection
      'compareFrom', // weekly vs custom comparison semantics
      'w.increasesTitle', // Largest Weekly Value Increases
      'w.decreasesTitle', // Largest Weekly Value Decreases
      'w.hierarchyTitle', // change hierarchy
      'w.fullTableTitle', // full changes table
      'TableSourceFooter', // source / provenance
      'w.methodologyTitle', // methodology
    ]) {
      assert.ok(page.includes(marker), `${marker} must survive the waterfall's removal`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Exact § 4.2 product vocabulary, EN and ES
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · § 4.2 vocabulary', () => {
  test('the § 4.2 required wording is exact in both languages', () => {
    assert.equal(wEn.weeklyValueChange, 'Weekly Value Change')
    assert.equal(wEs.weeklyValueChange, 'Variación de Valor Semanal')
    assert.equal(wEn.contribution, 'Contribution to Weekly Portfolio Value Change')
    assert.equal(wEs.contribution, 'Contribución a la Variación de Valor Semanal del Portafolio')
    assert.equal(wEn.impactOnPortfolio, 'Impact on Portfolio Value')
    assert.equal(wEs.impactOnPortfolio, 'Impacto en el Valor del Portafolio')
    assert.equal(wEn.increasesTitle, 'Largest Weekly Value Increases')
    assert.equal(wEs.increasesTitle, 'Mayores Aumentos de Valor Semanal')
    assert.equal(wEn.decreasesTitle, 'Largest Weekly Value Decreases')
    assert.equal(wEs.decreasesTitle, 'Mayores Disminuciones de Valor Semanal')
    // R13.R3B.1 — § 4.2's "Drivers of Weekly Portfolio Value Change" wording
    // was the retired waterfall's title and went with it. Its successor on
    // Summary is deliberately NOT that string: it spans a period, so it is
    // period-neutral. Asserted in `portfolioR3bSummaryWaterfall`.
  })

  test('the page tab and hierarchy titles match the contract', () => {
    assert.equal(wEn.title, 'Weekly Changes')
    assert.equal(wEs.title, 'Cambios Semanales')
    assert.equal(wEn.hierarchyTitle, 'Weekly Value Change by Portfolio Hierarchy')
    // The page renders the exact hierarchy/ranked titles from the dict.
    assert.match(page, /\{w\.hierarchyTitle\}/)
    assert.match(page, /\{w\.increasesTitle\}|title=\{w\.increasesTitle\}/)
    assert.match(page, /title=\{w\.decreasesTitle\}/)
  })

  test('Impact on Portfolio Value renders under its own label, never as a return figure', () => {
    // R13.R3C — the retired horizontal chart carried this as supporting text
    // under each bar; the full changes table still carries it, under the same
    // label, which is what this rule has always been about.
    assert.match(page, /\{w\.impactOnPortfolio\}/)
    // R13.R3C.4 — through the weekly-change formatter now, which differs from
    // `formatRatioPct` in exactly one way: a figure that PRINTS as zero prints
    // a dash instead. The measure and its label are unchanged.
    assert.match(page, /formatChangePct\(n\.impactOnPortfolioValue\)/)
  })

  test('R13.R3C.4 — every CHANGE column dashes when it would print zero; the VALUE columns keep their numbers', () => {
    // Three states, three marks, and none of them a fabricated zero:
    //   prints as zero → "-"   the row did not move this week
    //   null / ±∞      → "—"   the two weeks could not be compared
    //   anything else  → the number, sign and all
    assert.equal(formatChangePct(0), '-')
    assert.equal(formatChangePct(-0), '-')
    // The test is on the RENDERED figure, not the raw number: at two decimals
    // `0` and `0,000004` are the same `0,00%` on screen, so dashing one while
    // printing the other would claim a difference the column cannot show.
    assert.equal(formatChangePct(0.00004), '-')
    assert.equal(formatChangePct(-0.00004), '-')
    assert.equal(formatChangePct(0.0000499), '-')
    // …and the first figure that DOES survive rounding keeps its number.
    assert.equal(formatChangePct(0.00005), formatRatioPct(0.00005))
    assert.notEqual(formatChangePct(0.00005), '-')
    // Unavailable stays the em dash — a different mark for a different state.
    assert.equal(formatChangePct(null), formatRatioPct(null))
    assert.equal(formatChangePct(undefined), '—')
    assert.equal(formatChangePct(Number.NaN), '—')
    assert.equal(formatChangePct(Number.POSITIVE_INFINITY), '—')
    // Ordinary values are untouched, sign and all.
    for (const r of [0.0123, -0.0456, 1, -1]) {
      assert.equal(formatChangePct(r), formatRatioPct(r))
    }
    // `roundsToZeroAt` is the one rule behind both the percentage and the
    // amount, so the two can never drift into different ideas of "zero".
    assert.equal(roundsToZeroAt(0.4, 0), true)
    assert.equal(roundsToZeroAt(-0.4, 0), true)
    assert.equal(roundsToZeroAt(0.5, 0), false)
    assert.equal(roundsToZeroAt(0.004, 2), true)
    assert.equal(roundsToZeroAt(0.005, 2), false)

    // In the page: all THREE change columns of the full listing dash, and so do
    // the ranked panels' two — one rule, so the two tables cannot disagree.
    assert.equal(
      (page.match(/value=\{n\.weeklyValueChange\} masked=\{masked\} signed zeroDash/g) ?? []).length,
      2,
      'both value-change columns',
    )
    assert.equal((page.match(/formatChangePct\(n\./g) ?? []).length, 3, 'both own % columns + impact')
    // R13.R5C.1 § 2.2 — the same rule reached the rest of the page: the parent
    // net change and the flow reconciliation's own MOVEMENT rows. Its two
    // endpoint rows are levels and are excluded by `r.signed`.
    assert.match(page, /value=\{contributionSet\.netChange\} masked=\{masked\} signed zeroDash/)
    assert.match(page, /signed=\{r\.signed\} zeroDash=\{r\.signed\}/)
    // A LEVEL is never dashed: a holding worth exactly nothing is a real state,
    // and dashing it would collide with "could not be compared".
    assert.ok(
      !/value=\{n\.(previousValue|currentValue)\} masked=\{masked\}[^/]*zeroDash/.test(page),
      'the previous/this-week value columns must keep their numbers',
    )
    // And the reader is told which mark means what.
    for (const lang of [dict.en, dict.es]) {
      assert.ok('zeroDashNote' in lang.fp.weeklyChanges)
      assert.ok(!('impactZeroNote' in lang.fp.weeklyChanges), 'the impact-only wording is retired')
    }
    assert.match(page, /\{w\.zeroDashNote\}/)
  })

  test('R13.R3C.4 — the zero dash lives in the ONE guarded renderer, and shows through the mask', () => {
    // Putting it in `MaskedAmount` is what stops one table dashing a zero while
    // another prints it — and keeps the dash on the single guarded path rather
    // than a call site formatting an amount for itself.
    const amount = read('src/components/familyPortfolio/MaskedAmount.tsx')
    assert.match(amount, /zeroDash\?: boolean/)
    assert.match(amount, /if \(zeroDash && roundsToZeroAt\(value, compact \? 1 : decimals\)\)/)
    // The dash is returned BEFORE the mask, deliberately: "this row did not
    // move" is not a figure, and the module already makes it public — the
    // contributors chart keeps relative bar extents visible while masked, and
    // the omitted-zero footnote NAMES the entities that did not move.
    const dashAt = amount.indexOf('zeroDash && roundsToZeroAt')
    const maskAt = amount.indexOf('<PrivacyValue')
    assert.ok(dashAt > 0 && maskAt > dashAt, 'the dash short-circuits ahead of the mask')
    // No table cell formats an amount for itself — every one still goes
    // through `MaskedAmount` (the hero's guarded `formatValue` is covered by
    // its own test above).
    const table = page.slice(page.indexOf('§ 6h item 7'))
    assert.ok(!table.includes('formatUsd('), 'the full listing must not format an amount itself')
  })

  test('R13.R3C.4 — the Status column is gone, and its content is not', () => {
    // The column was one word plus a reason for a handful of rows and an empty
    // cell for every other. Removing it is right; losing the REASON would not
    // be — an em dash in the value cells is indistinguishable from a bug
    // without it — so it moved under the row's own hierarchy label.
    for (const lang of [dict.en, dict.es]) {
      assert.ok(!('statusColumn' in lang.fp.weeklyChanges), 'the dead column header is retired')
      assert.ok('statusUnavailable' in lang.fp.weeklyChanges, 'the state itself still has a name')
    }
    const table = page.slice(page.indexOf('§ 6h item 7'))
    assert.ok(!table.includes('w.statusColumn'), 'no Status header renders')
    assert.match(table, /\{w\.statusUnavailable\}/)
    assert.match(table, /reasonText\(n\.unavailableReason, w\)/)
    // Six columns now, header and body agreeing — one fewer than before.
    assert.equal((table.match(/<th className=\{`\$\{TH\}/g) ?? []).length, 6)
    assert.equal((table.match(/<td className=\{`\$\{CELL\}/g) ?? []).length, 6)
    // Every numeric column is centred; the hierarchy column keeps its left
    // origin, because its indent IS the tree and centring would destroy it.
    assert.equal((table.match(/\$\{TH\} text-center/g) ?? []).length, 5)
    assert.equal((table.match(/\$\{CELL\} text-center/g) ?? []).length, 5)
    assert.equal((table.match(/\$\{TH\} text-left/g) ?? []).length, 1)
    assert.equal((table.match(/\$\{CELL\} text-left/g) ?? []).length, 1)
    // One fewer column, so the card's dense-table minimum comes down with it.
    assert.match(page, /minWidth=\{760\}/)
  })

  test('R13.R3C.4 — Main and every personal portfolio get the SAME block and the SAME table', () => {
    // The page is one page; the scope selector only changes which rows it is
    // handed. Neither the combined block nor the full table may branch on the
    // scope, or the two would drift into two different weekly pages.
    const block = page.slice(page.indexOf('items 2–3'), page.indexOf('§ 6h items 5–6'))
    const table = page.slice(page.indexOf('§ 6h item 7'))
    for (const [name, region] of [['the combined block', block], ['the full table', table]] as const) {
      assert.ok(!region.includes('isMain'), `${name} must not branch on the scope`)
      assert.ok(!region.includes('activeScope'), `${name} must not read the scope directly`)
    }
    // The one control that IS scope-aware stays where it belongs: the subject
    // rail inside the hierarchy card, which only a personal book has.
    const hierarchy = page.slice(page.indexOf('§ 6h items 5–6'), page.indexOf('§ 6h item 7'))
    assert.match(hierarchy, /!isMain && subjects\.length > 1/)
  })

  test('R13.R3C.4 — the hero renders BARE inside the combined card, never a nested material', () => {
    // Two stacked glass surfaces are forbidden outright by the material rules,
    // so the hero drops its own card rather than the page copying its innards.
    const hero = read('src/components/fable/KpiHero.tsx')
    assert.match(hero, /bare\?: boolean/)
    assert.match(hero, /const Surface = bare \? BareSurface : GlassSurface/)
    assert.match(hero, /function BareSurface\(/)
    // Declared at module scope — the project's React-Compiler rule, and it also
    // keeps the count-up from restarting on every render.
    assert.ok(!/const BareSurface = \(/.test(hero), 'BareSurface must not be defined inside render')
    // Everything else about the hero is identical in both placements: one
    // element tree, one privacy path, one count-up.
    assert.equal((hero.match(/<PrivacyValue/g) ?? []).length, 2, 'headline + minis, as before')
    assert.equal((hero.match(/useCountUp\(/g) ?? []).length, 1)
    assert.equal((hero.match(/return \(/g) ?? []).length, 1, 'one render path, not a forked copy')
  })

  test('the hierarchy chart is captioned with the § 4.2 contribution term — a value change, not a return', () => {
    assert.match(page, /\{w\.contribution\}/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · § 4.3 forbidden vocabulary — EN and ES, with the one REQUIRED negation
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · § 4.3 forbidden vocabulary', () => {
  const FORBIDDEN_EN =
    /performance attribution|performance contribution|contribution to return|top performance (contributors|detractors)|security return contribution|selection effect|allocation effect|active return|\balpha\b/i
  const FORBIDDEN_ES =
    /atribuci[oó]n|contribuci[oó]n al desempe[ñn]o|efecto (de )?selecci[oó]n|efecto (de )?asignaci[oó]n|retorno activo|\balfa\b/i

  test('no forbidden term in any Stage-8 UI file, the route, or the pure module', () => {
    for (const rel of [...STAGE8_UI_FILES, ROUTE, PURE_MODULE, DATA_HELPER]) {
      const src = read(rel)
      assert.ok(!FORBIDDEN_EN.test(src), `${rel} must not carry EN attribution vocabulary`)
      assert.ok(!FORBIDDEN_ES.test(src), `${rel} must not carry ES attribution vocabulary`)
    }
  })

  test('no forbidden term in the weeklyChanges dictionaries, either language', () => {
    assert.ok(!FORBIDDEN_EN.test(JSON.stringify(wEn)))
    assert.ok(!FORBIDDEN_ES.test(JSON.stringify(wEs)))
  })

  test('the REQUIRED § 7.3 negation is the ONLY place "return contribution" may appear', () => {
    // Doc 07 § 7.3 mandates the methodology note state plainly that these are
    // "value changes, not return contributions" — a negation, never a label.
    for (const [key, value] of Object.entries(wEn)) {
      if (/return contribution/i.test(String(value))) {
        assert.equal(key, 'methodologyLevel')
        assert.match(String(value), /not a return contribution/)
      }
    }
    for (const [key, value] of Object.entries(wEs)) {
      if (/contribuci[oó]n al retorno/i.test(String(value))) {
        assert.equal(key, 'methodologyLevel')
        assert.match(String(value), /no una contribución al retorno/)
      }
    }
    assert.match(wEn.methodologyLevel, /not a return contribution/)
    assert.match(wEs.methodologyLevel, /no una contribución al retorno/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Fable boundary — components present, the locked module calculates
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · calculation boundary', () => {
  test('the page derives every figure through the LOCKED pure module', () => {
    // R13.R3C — `buildHierarchyLevel` went with the in-place breadcrumb drill;
    // the frontier pair that replaced it lives in the SAME pure module, so the
    // property (no figure is computed on the page) is unchanged.
    for (const fn of [
      'deriveDrivers(',
      'buildWaterfall(',
      'rankWeeklyChanges(',
      'contributionChildren(',
      'buildContributionSet(',
      'buildFullChangesTable(',
    ]) {
      assert.ok(page.includes(fn), `the page must call ${fn} from a pure module`)
    }
    assert.match(page, /from '@\/lib\/familyPortfolio\/weeklyChanges'/)
    assert.match(page, /from '@\/lib\/familyPortfolio\/contributionChart'/)
  })

  test('the chart components never recalculate a financial value', () => {
    // The chart imports a SHAPE, never a calculation: its only value binding
    // from the calculation layer is nothing at all — `ContributionSet` and
    // `ContributionAxis` arrive as types.
    assert.match(contrib, /import type \{[^}]*\} from '@\/lib\/familyPortfolio\/contributionChart'/)
    assert.ok(
      !/import \{[^}]*\} from '@\/lib\/familyPortfolio\/(weeklyChanges|contributionChart)'/.test(codeOf(contrib)),
      'the chart must not import a value binding from a calculation module',
    )
    for (const [rel, src] of [
      [CONTRIB, contrib],
      [MODAL, modal],
      [RECON, recon],
    ] as const) {
      const code = codeOf(src)
      assert.ok(!/\.reduce\(/.test(code), `${rel} must not aggregate values`)
      assert.ok(!/\+=/.test(code), `${rel} must not accumulate values`)
      assert.ok(!/currentValue\s*-\s*previousValue/.test(code), `${rel} must not recompute a change`)
      assert.ok(!/\.sort\(/.test(code), `${rel} must not order the set itself`)
    }
  })

  test('the ranked lists carry the module default of five — no page-side limit, no viewport reduction', () => {
    const code = codeOf(page)
    assert.ok(!/limit:/.test(code), 'the page must not override the binding top-five default')
    assert.ok(!/increases\.slice|decreases\.slice|rows\.slice\(0/.test(code))
    for (const rel of STAGE8_UI_FILES) {
      const src = codeOf(read(rel))
      // Viewport-width queries are the forbidden shape (top five is binding at
      // every breakpoint); the reduced-motion media query is NOT data variation.
      assert.ok(!/innerWidth|matchMedia\('\(m(ax|in)-width/.test(src),
        `${rel} must not vary the DATA by viewport — top five is binding at every breakpoint`)
    }
  })

  test('the View All smooth scroll honours prefers-reduced-motion in the same change', () => {
    assert.match(page, /prefers-reduced-motion: reduce/)
  })

  test('the hierarchy chart consumes the module frontier — parentage is never rebuilt from labels', () => {
    // The components of the chosen subject come from the pure module, and the
    // popup asks the SAME function again one level down.
    assert.match(page, /resolveSubject\(nodes, hierarchyDrivers, total, safeSubjectKey\)/)
    assert.match(modal, /contributionChildren\(nodes, parentRowKey\)/)
    assert.ok(
      !/parentRowKey ===|labelEs ===|\.depth ===/.test(codeOf(contrib)),
      'ContributionChart must hold no parentage model of its own',
    )
    // § 6g fixes the drill tiling per scope kind.
    assert.match(page, /isMain \? 'top_level' : 'sociedad'/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Cash toggle (§ 3.3 / § 6f)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · cash toggle', () => {
  test('cash is excluded by default and the toggle re-runs the SAME pure selector', () => {
    assert.match(page, /const \[includeCash, setIncludeCash\] = useState\(false\)/)
    assert.match(page, /rankWeeklyChanges\(nodes, \{ excludeCash: !includeCash \}\)/)
  })

  test('the toggle is a visible, labelled, reversible control that discloses what is withheld', () => {
    assert.match(page, /type="checkbox"/)
    assert.match(page, /checked=\{includeCash\}/)
    assert.match(page, /\{w\.cashToggleLabel\}/)
    assert.match(page, /\{w\.cashWhy\}/)
    assert.match(page, /ranked\.cashRowCount > 0/)
    assert.match(page, /\{w\.cashWithheldSuffix\}/)
    assert.match(page, /\{w\.cashIncludedNote\}/)
  })

  test('a scope switch resets the cash toggle', () => {
    assert.match(page, /setIncludeCash\(false\)/)
    // R13.R3B.1 — there is no personal "driver view" state left to reset: the
    // rail was the retired waterfall's own tiling control, and the hierarchy
    // drill has always been fixed at sociedad for a personal scope (§ 6g).
    assert.ok(!/setGrouping|useState<DriverGrouping>/.test(codeOf(page)))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · View All Changes and the full table (§ 6f / § 6h item 7)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · View All Changes', () => {
  test('View All opens the complete table built from the SAME change-node dataset', () => {
    assert.match(page, /\{w\.viewAll\}/)
    assert.match(page, /fullTableRef/)
    assert.match(page, /scrollIntoView/)
    assert.match(page, /buildFullChangesTable\(nodes\)/)
  })

  test('structural rows are visually structural — never styled as asset changes', () => {
    assert.match(page, /structuralRowClasses/)
    assert.match(page, /portfolio_subtotal/)
    assert.match(page, /sociedad_subtotal/)
  })

  test('the cash state stays consistent: the unfiltered listing says so while cash is withheld above', () => {
    assert.match(page, /\{!includeCash && <p [^>]*>\{w\.fullTableCashNote\}<\/p>\}/)
  })

  test('unavailable rows carry a visible textual state with the reason — never a fabricated zero', () => {
    assert.match(page, /reasonText\(n\.unavailableReason, w\)/)
    assert.match(page, /\{w\.statusUnavailable\}/)
    assert.ok(!/weeklyValueChange \?\? 0|change \?\? 0/.test(codeOf(page)),
      'an unavailable change must never be coalesced to zero')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Honest states — no_previous_week above all
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · honest states', () => {
  test('every page-level state is distinct', () => {
    for (const marker of [
      "kind=\"loading\"",
      "outcome === 'denied'",
      "outcome === 'error'",
      "state === 'no_publications'",
      "state === 'empty'",
      "state === 'no_previous_week'",
    ]) {
      assert.ok(page.includes(marker), `page must distinguish ${marker}`)
    }
  })

  test('no_previous_week is an explanation, not an error — and no zero-change page is synthesised', () => {
    const at = page.indexOf("state === 'no_previous_week'")
    const block = page.slice(at, page.indexOf('showSections ?'))
    assert.match(block, /kind="empty"/)
    assert.ok(!/kind="error"/.test(block), 'the earliest week is not an error')
    assert.match(block, /\{w\.noPreviousWeek\}/)
    assert.ok(!/KpiHero|ValueChangeWaterfall|DivergingBarChart|LineChart/.test(block),
      'no metric cards or charts render without a prior published week')
    assert.match(wEn.noPreviousWeek, /no prior published observation exists/)
  })

  test('the pair disclosure names both real published dates — never an implied seven-day gap', () => {
    assert.match(page, /formatIsoDateLabel\(prevPub\.asOfDate\)/)
    assert.match(page, /\{w\.pairNote\}/)
    assert.match(wEn.pairNote, /not necessarily seven calendar days earlier/)
    assert.match(wEs.pairNote, /no necesariamente siete días calendario antes/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Privacy completeness
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · privacy', () => {
  test('the contributors chart keeps only RELATIVE extents while masked — every amount is withheld', () => {
    // R13.R3C — the retired bridge blanked its whole plot because its bars
    // floated at absolute cumulative LEVELS. These bars all start at zero and
    // encode a magnitude relative to the axis maximum, which is the
    // allocation-donut / diverging-bar precedent the standing privacy policy
    // already permits. What must NOT survive masking is any absolute amount:
    // the axis gutter is withheld outright, and every other figure is routed
    // through `MaskedAmount`, which fails closed on its own.
    assert.match(contrib, /masked \? null : <MaskedAmount value=\{tick\}/)
    assert.match(contrib, /<MaskedAmount\s+value=\{active\.value\}\s+masked=\{masked\}/)
    assert.match(contrib, /<MaskedAmount value=\{bar\.value\} masked=\{masked\}/)
    // …and no unmasked amount reaches the DOM by another route.
    assert.ok(
      !/formatUsd\(|formatUsdCompactM\(/.test(codeOf(contrib)),
      'the chart must never format an amount itself — that would bypass the mask',
    )
  })

  test('R13.R3C.2 — the historical trend chart is retired, and its privacy path went with it', () => {
    // § 6h item 8 plotted a series ACROSS weeks on a page about ONE week, and
    // Portfolio Evolution answers that question on a flow-adjusted basis. It
    // is the only surface here that ever plotted absolute LEVELS, which is why
    // it needed a whole-chart privacy replacement; both are gone together.
    assert.ok(!page.includes('<LineChart'), 'no line chart survives on this page')
    assert.ok(!/from '@\/components\/charts\/LineChart'/.test(page), 'and it is not imported either')
    assert.ok(!page.includes('trendTitle') && !page.includes('trendNote'))
    for (const lang of [dict.en, dict.es]) {
      assert.ok(
        !('trendTitle' in lang.fp.weeklyChanges) && !('trendNote' in lang.fp.weeklyChanges),
        'the dead trend copy is removed from the dictionary, not left orphaned',
      )
    }
    // Nothing upstream changed: the route still publishes the series.
    assert.match(route, /trend/)
  })

  test('every raw formatUsd call in the page sits in a guarded context', () => {
    for (const line of page.split('\n')) {
      if (!line.includes('formatUsd(')) continue
      assert.ok(
        /formatValue=\{|valueFormatter=\{|value: formatUsd/.test(line),
        `unguarded amount formatter in page: ${line.trim()}`,
      )
    }
    // R13.R3C.4 — THE HERO HAS NO MINIS ANY MORE. Opening and closing value
    // are rows 1 and 4 of the ledger beside it, so the hero was printing the
    // same two amounts a card away from where they do work. What is left is
    // the headline amount, still bound to the hero's own privacy state.
    assert.ok(!/minis=\{/.test(page), 'the hero states no amount the ledger already states')
    assert.match(page, /privacyMasked=\{masked\}/)
  })

  test('R13.R3C.4 — the ledger reads opening → made → moved → closing, and states nothing else', () => {
    const ledger = page.slice(page.indexOf('{w.flowReconTitle}'), page.indexOf('item 4 · RETIRED'))
    assert.ok(ledger.length > 0, 'the reconciliation card exists')
    const order = ['w.previousValueLabel', 'o.weeklyProfit', 'w.flowLabel', 'w.endingValueLabel']
    let cursor = -1
    for (const marker of order) {
      const at = ledger.indexOf(marker)
      assert.ok(at >= 0, `${marker} is a row of the ledger`)
      assert.ok(at > cursor, `${marker} must follow the previous ledger row`)
      cursor = at
    }
    // Exactly four rows, with the closing line set off as the SUM of the three
    // above it rather than a fifth term.
    assert.equal((ledger.match(/\{ label: [wo]\./g) ?? []).length, 4)
    assert.equal((ledger.match(/divider: true/g) ?? []).length, 1)
    // Every ledger amount goes through the mask; none through formatUsd.
    assert.ok(!ledger.includes('formatUsd('), 'the ledger never formats an amount itself')
    assert.equal((ledger.match(/<MaskedAmount value=\{r\.value\}/g) ?? []).length, 1)

    // THE YEAR IS NOT ON THIS PAGE. Both YTD figures went with the metrics
    // card; Summary reports them over a period the reader chooses.
    const body = page.slice(page.indexOf('function WeeklyChangesPageInner'))
    for (const dead of ['o.ytdProfit', 'o.ytdReturn', 'w.totalsTitle']) {
      assert.ok(!body.includes(dead), `${dead} must not render on the weekly page`)
    }
    // And the dead copy is removed from the dictionary, never left orphaned.
    for (const lang of [dict.en, dict.es]) {
      for (const dead of ['totalsTitle', 'impliedCurrent', 'publishedCurrent']) {
        assert.ok(!(dead in lang.fp.weeklyChanges), `fp.weeklyChanges.${dead} is retired`)
      }
      for (const live of ['flowLabel', 'endingValueLabel', 'flowReconResidual']) {
        assert.ok(live in lang.fp.weeklyChanges, `fp.weeklyChanges.${live} must exist`)
      }
    }
  })

  test('R13.R3C.4 — implied-vs-published is still COMPUTED, only no longer drawn here', () => {
    // The removal is presentational. Nothing upstream may quietly stop checking
    // the identity because the card stopped printing it.
    assert.match(route, /reconcileFlowAndProfit\(/)
    assert.match(route, /flowReconciliation/)
    assert.match(page, /const flowRecon = data\?\.flowReconciliation \?\? null/)
    // The two figures are gone from the CARD…
    const ledger = page.slice(page.indexOf('{w.flowReconTitle}'), page.indexOf('item 4 · RETIRED'))
    assert.ok(!/expectedCurrent/.test(ledger), 'the implied value is no longer printed')
    // …and the verdict still reaches the reader in the status section, beside
    // the driver reconciliation — so a real residual can never go silent.
    const status = page.slice(page.indexOf('{w.statusTitle}'))
    assert.match(status, /state=\{displayState\(flowRecon\.status\)\}/)
    // A residual also says so on the card itself — one line, and no second
    // amount, so the note above it can never assert an identity the rows deny.
    assert.match(page, /flowRecon\.status === 'residual'/)
    assert.match(page, /\{w\.flowReconResidual\}/)
  })

  test('R13.R3C.4 — a mismatch is caught at UPLOAD, which is why the card need not print it', () => {
    // The identity the card stopped drawing and the identity the parser checks
    // on every upload are ONE identity, rearranged — so removing the display
    // removes nothing from the guarantee.
    //
    //   parser:  stated profit  ≟  this − previous − flow
    //   card:    previous + flow + profit  ≟  published
    //
    // Proved here on real arithmetic rather than asserted in prose.
    const previous = 145_836_553
    const flow = 250_000
    const published = 147_120_884
    const statedProfit = weeklyProfit(published, previous, flow)
    assert.equal(statedProfit, published - previous - flow)
    const clean = reconcileFlowAndProfit({
      previousValue: previous,
      currentValue: published,
      flow,
      weeklyProfit: statedProfit,
      weeklyValueChange: published - previous,
      weeklyReturn: null,
      ytdProfit: null,
      ytdReturn: null,
    } as never)
    assert.equal(clean.status, 'ok', 'a workbook the parser accepts reconciles at read time')
    assert.equal(clean.residual, 0)

    // And a workbook whose stated profit disagrees is exactly what the runtime
    // would have shown as an implied/published gap — the same number, caught a
    // step earlier.
    const wrong = reconcileFlowAndProfit({
      previousValue: previous,
      currentValue: published,
      flow,
      weeklyProfit: (statedProfit as number) - 1_000_000,
      weeklyValueChange: published - previous,
      weeklyReturn: null,
      ytdProfit: null,
      ytdReturn: null,
    } as never)
    assert.equal(wrong.status, 'residual')
    assert.equal(wrong.residual, 1_000_000)

    // The upload path that catches it first: the parser recomputes the profit
    // against each candidate total, refuses to bind a block it cannot
    // reconcile, and reports a disagreement it can.
    const parser = read('src/lib/familyPortfolio/resumen/parseResumen.ts')
    assert.match(parser, /weeklyProfit\(bound\.value, bound\.previousValue, block\.flow \?\? 0\)/)
    for (const code of [
      'ambiguous_performance_basis', // blocking — no candidate reconciles
      'performance_definition_mismatch', // warning — the bound one disagrees
      'flow_cell_unreadable', // blocking — the flow term cannot be read
    ]) {
      assert.ok(parser.includes(code), `${code} must still be reported by the parser`)
    }
    // …and the administrator sees it before publishing: findings are listed
    // with their severity, and each cross-check is chipped agrees/mismatch.
    const admin = read('src/app/family-portfolio/admin/page.tsx')
    assert.match(admin, /review\.findings\.map/)
    assert.match(admin, /f\.severity === 'warning' \? a\.warning/)
    assert.match(admin, /review\.performance\.map/)
    assert.match(admin, /p\.agrees \? a\.agrees : a\.mismatch/)
  })

  test('the chart/status components render amounts only through MaskedAmount', () => {
    for (const [rel, src] of [
      [CONTRIB, contrib],
      [MODAL, modal],
      [RECON, recon],
    ] as const) {
      assert.ok(!codeOf(src).includes('formatUsd'), `${rel} must not format an amount itself`)
      assert.match(src, /MaskedAmount/)
    }
  })

  test('no amount reaches a title attribute or an aria label', () => {
    for (const rel of STAGE8_UI_FILES) {
      const src = codeOf(read(rel))
      assert.ok(!/title=\{[^}]*(formatUsd|Value|change)/i.test(src) || /title=\{(nodeLabel|classification|bar\.label|label)\b/.test(src),
        `${rel}: title attributes may carry labels only`)
      assert.ok(!/aria-label=\{[^}]*(formatUsd|\.value|Change)/.test(src),
        `${rel}: aria labels must not carry amounts`)
    }
  })

  test('residual amounts are masked like every other monetary figure', () => {
    assert.match(recon, /<MaskedAmount value=\{residual\} masked=\{masked\}/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Reconciliation display (§ 6d / § 6e / § 6g)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · reconciliation display', () => {
  test('the three documented states stay distinct — partial never collapses into success', () => {
    assert.match(recon, /\{w\.reconciled\}|w\.reconciled/)
    assert.match(recon, /w\.partiallyReconciled/)
    assert.match(recon, /w\.reconciliationUnavailable/)
    // The page maps residual/partial to 'partial', never to 'reconciled'.
    assert.match(page, /if \(status === 'residual' \|\| status === 'partial'\) return 'partial'/)
  })

  test('state is text plus dot — never colour alone', () => {
    assert.match(recon, /\{label\}/)
    assert.match(recon, /aria-hidden/)
  })

  test('the flow identity, the contributors set and the status section all surface it', () => {
    const uses = page.match(/<ReconciliationStatus/g) ?? []
    // R13.R3B.1 retired the waterfall card's own copy; R13.R3C's contributors
    // set reports its reconciliation through the same component.
    assert.ok(uses.length >= 3, 'flow card, contributors set, and status section')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10 · Hierarchy drill-down UI (§ 6g)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R3C · hierarchy drill-down is a popup, not a breadcrumb', () => {
  test('depth lives in the modal — the in-place breadcrumb drill is gone', () => {
    const code = codeOf(page)
    assert.ok(!code.includes('drillKey'), 'the page no longer holds a drill path')
    assert.ok(!code.includes('buildHierarchyLevel'), 'nor the level builder that served it')
    assert.match(page, /<ContributionBreakdownModal/)
    // The parent and its reconciliation stay on screen while the reader
    // descends, which is the whole reason depth moved inside the overlay.
    assert.match(modal, /\{c\.parentContribution\}/)
    assert.match(modal, /aria-expanded=\{isOpen\}/)
    assert.match(modal, /<BreakdownLevel/)
  })

  test('bars extend from a drawn common zero axis — up for positive, down for negative', () => {
    assert.match(contrib, /const zeroTop = topPct\(0\)/)
    assert.match(contrib, /const top = positive \? topPct\(bar\.value\) : zeroTop/)
    assert.match(contrib, /const bottom = positive \? zeroTop : topPct\(bar\.value\)/)
    // Zero is a DRAWN gridline, stronger than the rest, because every bar is
    // anchored to it.
    assert.match(contrib, /tick === 0 \? 'var\(--border-strong\)' : 'var\(--chart-grid\)'/)
  })

  test('a bar the source can decompose is a real button; a leaf gets no affordance', () => {
    assert.match(contrib, /const interactive = bar\.drillable && bar\.rowKey !== null/)
    assert.match(contrib, /interactive \? \(\s*<button/)
    assert.match(contrib, /aria-label=\{`\$\{c\.drillInto\} \$\{label\}`\}/)
    // `drillable` is decided by the pure module, never by the chart.
    assert.match(page, /isDrillable: \(key\) => contributionChildren\(nodes, key\)\.length > 0/)
  })

  test('a new (scope, week) request resets the subject and closes the popup', () => {
    assert.match(page, /setSubjectKey\(COMBINED_SUBJECT\)/)
    assert.match(page, /setOpenKey\(null\)/)
    assert.match(page, /prevRequestKey !== requestKey/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11 · Responsive and accessibility structure
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · responsive & accessibility', () => {
  test('layout grids carry responsive prefixes; dense tables scroll inside their card', () => {
    // R13.R3C.2 — two regions, both responsive. R13.R3C.4 narrowed the
    // information row to TWO blocks, so it collapses 2 → 1 and no longer needs
    // an md step; the movers/chart row still collapses 2 → 1, and at xl its two
    // sides now end level (`items-stretch`) instead of each taking its own
    // natural height.
    // R13.R3C.4 — items 2–3 are ONE card split by a rule, so the top region's
    // grid is now internal to it and collapses 2 → 1 at the same breakpoint;
    // the movers/chart row still collapses 2 → 1 and ends level at xl.
    assert.match(page, /grid-cols-1 xl:grid-cols-\[1fr_minmax\(0,0\.8fr\)\] gap-4 xl:gap-0/)
    assert.match(page, /grid-cols-1 xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.15fr\)\] gap-4 items-stretch/)
    assert.match(page, /minWidth=\{760\}/)
    assert.match(page, /maxHeight=\{640\}/)
    assert.match(read(PAGE), /minWidth=\{560\}/)
  })

  test('R13.R3C.4 — the divider is VERTICAL on a wide card and horizontal once it stacks', () => {
    // One rule, two orientations, chosen by the same breakpoint that decides
    // whether the block is two columns at all — so it can never be a vertical
    // line across a stacked layout, or a horizontal one splitting two columns.
    assert.match(page, /border-b border-border pb-4 xl:border-b-0 xl:border-l xl:pb-0 xl:pl-6/)
    assert.match(page, /xl:order-1 flex flex-col gap-2 min-w-0 xl:pr-6/)
    // The ledger is LEFT and the headline RIGHT at xl, while DOM order stays
    // the contract's (item 2, then item 3) — see the block's own comment.
    assert.match(page, /xl:order-2/)
  })

  test('the contributors chart narrows its axis gutter below sm', () => {
    // Columns, not rows: on a narrow viewport the value gutter is what gives
    // way first, before the plot itself has to scroll.
    // R13.R3C.2 — the gutter narrowed one step (w-14/sm:w-16 → w-12/sm:w-14)
    // once its labels became the compact one-unit form, and the reclaimed
    // width went to the plot. THREE places must stay in sync: the tick span,
    // the bars container's left offset, and the x-axis spacer.
    assert.equal((contrib.match(/w-12 sm:w-14/g) ?? []).length, 2, 'tick span + x-axis spacer')
    assert.match(contrib, /left-12 sm:left-14/)
  })

  test('R13.R3C — the chart scrolls inside its own card rather than compressing its columns', () => {
    // Below a readable column width the honest behaviour is the project's
    // dense-chart convention — scroll within the card on a computed minimum —
    // never squeezing every column into a sliver. The minimum is derived from
    // the bar COUNT, so a two-bar chart never scrolls and a twelve-bar one
    // always can.
    assert.match(contrib, /overflow-x-auto/)
    assert.match(contrib, /const MIN_COLUMN_PX = \d+/)
    assert.match(contrib, /minWidth: Math\.max\(1, n\) \* MIN_COLUMN_PX/)
    // A one-CSS-pixel visibility floor that does not scale with plot height.
    assert.match(contrib, /const MIN_BAR_PX = 1/)
    assert.match(contrib, /`max\(\$\{MIN_BAR_PX\}px, \$\{bottom - top\}%\)`/)
  })

  test('controls wrap; headings are semantic; the chart has a real-text route', () => {
    assert.match(page, /flex-wrap/)
    // Three fewer card headings than the original page: the R13.R3B.1
    // waterfall's, the R13.R3C.2 historical trend's, and the R13.R3C.4 metrics
    // card's. What carries a heading now is the ledger, the hierarchy and the
    // status block; the hero labels itself.
    assert.equal((page.match(/<h2 className="ui-label/g) ?? []).length, 3)
    // R13.R3C — the chart is columns, so its non-visual route is a real table
    // of the same figures rather than a list of rows. The popup stays a list.
    // The table is WRAPPED, not itself `sr-only` — see the regression guard in
    // `portfolioR3cContributors.test.ts`; an unwrapped one widened the page.
    assert.match(contrib, /<div className="sr-only">\s*<table>/)
    assert.match(contrib, /<caption>\{ariaLabel\}<\/caption>/)
    assert.match(modal, /role="list"/)
  })

  test('no new Date, no hardcoded hex, no animation library in any Stage-8 UI file', () => {
    for (const rel of STAGE8_UI_FILES) {
      const src = codeOf(read(rel))
      assert.ok(!src.includes('new Date'), `${rel} must stay on the calendar-safe date path`)
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${rel} must not hardcode a hex color`)
      assert.ok(!/framer|gsap|animejs/i.test(src), `${rel} must not add an animation library`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 12 · Route contract and stage boundaries
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · route and boundaries', () => {
  test('the route runs the full authorization ladder, in order, before any read', () => {
    const code = codeOf(route)
    const guard = code.indexOf('guardPrivateApi()')
    const entitlement = code.indexOf('getFamilyPortfolioEntitlement()')
    const scopeCheck = code.indexOf('canReadScope(')
    const firstRead = code.indexOf('listCurrentPublications(')
    assert.ok(guard >= 0 && guard < entitlement && entitlement < scopeCheck && scopeCheck < firstRead,
      'guard → entitlement → canReadScope → read, strictly in that order')
    assert.match(route, /no-store/)
  })

  test('the route exposes no draft, upload, storage, or admin operational metadata', () => {
    const code = codeOf(route)
    assert.ok(!/draft|upload|storage|signedUrl|admin/i.test(code))
  })

  test('week_not_found is a 404; no_previous_week is a 200 explanation', () => {
    // R13.R1.1 § 13 inverted the expression when it added the custom-range
    // failures (`from_not_found`, `from_not_before_to`), which are 404s for the
    // same reason `week_not_found` is: the caller named a week the book does
    // not hold. `no_publications` remains the one 200 — an empty book is a
    // state, not an error — and `no_previous_week` is still an explained 200.
    assert.match(route, /pair\.code === 'no_publications' \? 200 : 404/)
    assert.match(route, /state: 'no_previous_week'/)
  })

  test('R13.8 audit: one semantic source — dict step labels, pure fail-closed denominator', () => {
    // The waterfall step labels come from the SAME dictionary the page reads,
    // so the server and client waterfalls cannot drift apart on a label.
    assert.match(route, /dict\.(en|es)\.fp\.weeklyChanges\.previousValueLabel/)
    assert.match(route, /dict\.(en|es)\.fp\.weeklyChanges\.currentValueLabel/)
    assert.match(route, /dict\.(en|es)\.fp\.weeklyChanges\.residualStep/)
    assert.ok(!/es: 'Valor|en: 'Previous|en: 'This Week|es: 'Residuo/.test(route),
      'the route must not hardcode a waterfall step label')
    // The Impact on Portfolio Value denominator resolves through the pure
    // helper that fails closed on a missing or currency-changed bound row.
    assert.match(route, /resolvePreviousPortfolioTotal\(currentRows\.rows, previousRows\.rows, boundKey\)/)
  })

  test('Stage 8 never touches the Alternatives surface, even now that Stage 9 exists', () => {
    // R13.9 graduated Alternatives — the API and real page now exist — but the
    // Stage-8 files still must not import, read, or render any of it.
    assert.ok(existsSync(join(ROOT, 'src/app/api/family-portfolio/alternatives')),
      'the Stage-9 Alternatives API exists (R13.9)')
    for (const rel of [...STAGE8_UI_FILES, ROUTE]) {
      assert.ok(!/alternatives/i.test(codeOf(read(rel)).replace(/s\.id !== 'alternatives'/g, '')),
        `${rel} must not touch the Stage-9 Alternatives surface`)
    }
  })

  test('the Chilean-equities /portfolio module remains untouched by Stage 8', () => {
    const chilean = read('src/app/portfolio/page.tsx')
    assert.ok(!chilean.includes('weeklyChanges'))
    assert.ok(!chilean.includes('family-portfolio'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 13 · Methodology note and i18n integrity
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · methodology & i18n', () => {
  test('the methodology note is persistent — all five statements always render, never a tooltip', () => {
    assert.match(page, /\[w\.methodologyLevel, w\.methodologyPair, w\.methodologyImpact, w\.methodologyDrivers, w\.methodologyCash\]/)
    // Rendered as list items in the flow of section 9 — not inside a title.
    assert.ok(!/title=\{w\.methodology/.test(page))
  })

  test('the methodology covers the documented distinctions in both languages', () => {
    assert.match(wEn.methodologyPair, /immediately preceding published week/)
    assert.match(wEn.methodologyImpact, /^Impact on Portfolio Value/)
    // R13.R3B.1 — the methodological point survived the waterfall's removal,
    // restated without the chart vocabulary it no longer has: the flow and
    // profit effects are already inside the asset-level changes, so they are
    // not separate COMPONENTS (they used to be "not separate BARS").
    assert.match(wEn.methodologyDrivers, /not separate components/)
    assert.ok(!/bar/i.test(wEn.methodologyDrivers), 'no chart vocabulary left in the methodology')
    assert.match(wEn.methodologyCash, /excluded from the ranked lists by default/)
    assert.match(wEs.methodologyPair, /semana publicada inmediatamente anterior/)
    assert.match(wEs.methodologyDrivers, /no son componentes separados/)
    assert.ok(!/barra/i.test(wEs.methodologyDrivers))
  })

  test('EN and ES weeklyChanges dictionaries carry identical key sets', () => {
    assert.deepEqual(Object.keys(wEn).sort(), Object.keys(wEs).sort())
  })

  test('no hardcoded user-facing English strings in the Stage-8 components', () => {
    // Every visible label flows through `t.fp.weeklyChanges` / shared keys;
    // literal JSX text is limited to punctuation and glyphs.
    for (const src of [contrib, modal, recon]) {
      assert.ok(!/>\s*[A-Z][a-z]+ [a-z]+/.test(codeOf(src).replace(/className="[^"]*"/g, '')),
        'component JSX must not embed English sentences')
    }
  })
})
