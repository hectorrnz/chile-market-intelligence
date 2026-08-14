// R13.R2 § 34 — behavioural tests for the recomposed Summary.
//
// TWO KINDS of assertion, deliberately separated:
//
//   * BEHAVIOURAL — the pure modules (`evolutionRange`, `allocationSettings`,
//     `overview`'s personal-scope composition) are exercised against
//     hand-checkable synthetic fixtures. These are the ones that would catch a
//     real financial or selection defect.
//   * STRUCTURAL — the page, the route, the migration and the i18n dictionary
//     are read as text to pin contracts that have no runtime surface here (a
//     section's ORDER, an authority split, a terminology ban). They are
//     written against PROPERTIES, not incidental phrasing, so a visual pass
//     can restyle freely without breaking them.
//
// NO PRIVATE DATA. Every number below is invented and hand-checkable. Nothing
// in this file reproduces a real portfolio value, label or holding name.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dict } from '../src/lib/i18n.ts'
import {
  EVOLUTION_PERIODS,
  isEvolutionPeriod,
  periodBoundary,
  selectEvolutionRange,
  shiftIsoMonths,
  sharedEndpoint,
  observationAt,
  valueChange,
} from '../src/lib/familyPortfolio/evolutionRange.ts'
import {
  ALLOCATION_PALETTES,
  DEFAULT_ALLOCATION_SETTINGS,
  DONUT_THICKNESSES,
  LABEL_CONTENTS,
  LABEL_POSITIONS,
  PALETTE_TOKENS,
  THICKNESS_INNER_RATIO,
  normalizeStoredSettings,
  paletteTokenAt,
  validateAllocationSettings,
} from '../src/lib/familyPortfolio/allocationSettings.ts'
import {
  RECON_ABS_TOLERANCE,
  RECON_REL_TOLERANCE,
  resolveDisplayedDifference,
} from '../src/lib/familyPortfolio/difference.ts'
import {
  buildPersonalAllocation,
  buildPersonalComparisonRows,
  buildPersonalHero,
  buildWeeklySnapshot,
  extractPerformanceBlocksFor,
  identifyPersonalStructure,
  PERSONAL_PERFORMANCE_BASES,
  type OverviewPerformanceRow,
  type OverviewSnapshotRow,
} from '../src/lib/familyPortfolio/overview.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Strips comments so hygiene regexes cannot be tripped by prose. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = 'src/app/family-portfolio/page.tsx'
const ROUTE = 'src/app/api/family-portfolio/overview/[scope]/route.ts'
const SETTINGS_ROUTE = 'src/app/api/family-portfolio/presentation-settings/route.ts'
const SETTINGS_REPO = 'src/lib/db/repositories/familyPortfolioSettingsRepository.ts'
const MIGRATION = 'supabase/migrations/20260812000000_family_portfolio_presentation_settings.sql'
const PGTAP = 'supabase/tests/database/family_portfolio_presentation_settings_test.sql'
const EVO_CHART = 'src/components/familyPortfolio/PortfolioEvolutionChart.tsx'
const DONUT = 'src/components/familyPortfolio/AllocationDonut.tsx'
const SETTINGS_DIALOG = 'src/components/familyPortfolio/AllocationSettingsDialog.tsx'
const STRIP = 'src/components/familyPortfolio/PerformanceMarketsStrip.tsx'

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Summary information architecture (§ 6)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · Summary architecture', () => {
  test('the regions render in the owner-approved order', () => {
    const src = read(PAGE)
    // Anchored on each region's own i18n key or component, so a visual pass may
    // restyle freely; only a REORDER breaks this.
    // Every needle is a RENDER site (`<Component`), never a bare identifier —
    // an import at the top of the file would otherwise satisfy the ordering
    // trivially and the test would assert nothing.
    //
    // WEEKLY NOTES NOW PRECEDES PORTFOLIO EVOLUTION — the owner review inverted
    // the original § 6 pair deliberately: the notes carry the week's actual
    // activity (buys, sells, decisions), and that context should be read before
    // the long-term value chart, not after it.
    const order = [
      '<PageHeader',                // 1 · identity / scope / as-of
      '<PortfolioValueHero',        //     … + the dominant latest total value
      '<PerformanceMarketsStrip',   // 2 · performance & markets
      '<WeeklySnapshotCard',        // 3 · weekly snapshot …
      '<AllocationPanel',           //     … + allocation
      'o.notesTitle',               // 4 · weekly notes
      'o.evoTitle',                 // 5 · portfolio evolution
      '<DualFreshnessBadge',        // 6 · provenance / freshness / disclosure
    ]
    const positions = order.map((needle) => src.indexOf(needle))
    for (const [i, p] of positions.entries()) {
      assert.ok(p > 0, `${order[i]} must render on the Summary`)
      if (i > 0) {
        assert.ok(p > positions[i - 1], `${order[i]} must come after ${order[i - 1]}`)
      }
    }
  })

  test('the weekly close survives the reorder as the snapshot detail', () => {
    const src = read(PAGE)
    // R13.7's per-line Cierre Semanal is SUBSTANCE; the recomposition moved it
    // below the snapshot rather than dropping it.
    assert.match(src, /<HierarchicalTable/)
    assert.match(src, /o\.snapDetailTitle/)
    assert.ok(src.indexOf('<HierarchicalTable') > src.indexOf('<WeeklySnapshotCard'))
  })

  test('every R13.7 element still renders — nothing was dropped in the reorder', () => {
    const src = read(PAGE)
    for (const key of [
      'o.flow', 'o.flowHelp', 'o.weeklyProfit', 'o.ytdReturn', 'o.ytdProfit',
      'o.allocationNote', 'o.residualWarning', 'o.denominator',
      // `o.inretailImpact` was removed by owner review pass 2 § 2 — the InRetail
      // portfolio-value impact is already a line of the Weekly close by line
      // table, so annotating it again above the fold was one figure presented
      // twice. The DATA is untouched: the route still composes `inretailImpact`
      // and the holding still carries its own difference in the table (asserted
      // in `portfolioR2bOwnerReview.test.ts`).
      'o.benchmarksPending', 'o.provisionalDisclaimer',
      'o.commentaryAttribution',
    ]) {
      assert.ok(src.includes(key), `${key} must still render on the Summary`)
    }
    assert.match(src, /TableSourceFooter/)
    assert.match(src, /parserLabel/)
  })

  test('the header carries one hierarchy, not three near-equivalent labels', () => {
    const src = read(PAGE)
    // § 7 — the eyebrow names the MODULE TAB and the title names the PORTFOLIO;
    // the R13.7 header repeated "Portfolio" in the eyebrow and again in the
    // scope heading below the title.
    assert.match(src, /eyebrow=\{t\.fp\.navOverview\}/)
    assert.match(src, /title=\{scopeHeading \|\| t\.fp\.navOverview\}/)
    // The scope heading is no longer ALSO repeated in the metadata slot.
    const metaStart = src.indexOf('metadata={')
    const metaEnd = src.indexOf('actions={')
    assert.ok(metaStart > 0 && metaEnd > metaStart)
    assert.ok(!src.slice(metaStart, metaEnd).includes('scopeHeading'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Performance & Markets, Main vs personal (§§ 8-10)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · performance & markets', () => {
  test('the strip is a composition, not a table', () => {
    const src = read(STRIP)
    assert.ok(!/<table|<thead|<tbody|<th\b|<td\b/.test(src),
      '§ 8 forbids a traditional data table for the metric strip')
    assert.match(src, /portfolioLabel/)
    assert.match(src, /marketsLabel/)
  })

  test('an unavailable market metric renders an em dash and keeps its slot', () => {
    const src = read(STRIP)
    assert.match(src, /—/)
    // Never a fabricated zero for a missing observation.
    assert.ok(!/\?\?\s*0\b/.test(codeOf(src)))
  })

  test('Main shows both bases; a personal scope shows only its own', () => {
    const src = read(PAGE)
    // PASS 4 § 4 — the band is a 2 × 2 composition now, so the metrics are built
    // as GROUPS rather than one flat portfolio array. The property under test is
    // unchanged and still asserted below: Main names both bases, a personal
    // scope names none of them.
    assert.match(src, /const portfolioPrimary: StripGroup\[\] = isMain/)
    assert.match(src, /o\.personalWeekly/)
    const personalBranch = src.slice(
      src.indexOf("key: 'personal-weekly'"),
      src.indexOf('// ── ROW 2'),
    )
    assert.ok(personalBranch.length > 0, 'the personal branch must be locatable')
    assert.ok(!/blockExChilean|blockWithChilean|blockLabel/.test(personalBranch))
  })

  test('InRetail market metrics are Main-only and the impact is Main-only', () => {
    const src = read(PAGE)
    // PASS 4 § 4A — the pair moved OUT of the weekly comparison row into the
    // supporting market row. Still Main-gated, and now by a whole group that a
    // personal scope never receives at all.
    assert.match(src, /const marketsSecondary: StripGroup\[\] = isMain\s*\n?\s*\?\s*\[/)
    const personalMarkets = src.slice(src.indexOf('const marketsPrimary'), src.indexOf('const anyUnverified'))
    assert.ok(/: \[\]/.test(personalMarkets), 'a personal scope gets an EMPTY supporting market group')
    // The second guard here used to gate the InRetail portfolio-impact
    // ANNOTATION, which owner review pass 2 § 2 removed as a duplicate of the
    // Weekly close by line row. What the test protects — that the page cannot
    // render InRetail content for a personal scope — is now stronger, because
    // the page no longer reads the impact value at all.
    assert.ok(!/data\.inretailImpact/.test(src))
    // The route never searches a personal scope for an InRetail-like row.
    assert.match(read(ROUTE), /mainStructure \? inretailImpact\(mainStructure\) : \{ rowKey: null, value: null \}/)
  })

  test('the BVL/InRetail symbol gate is untouched — still unverified', () => {
    const bench = read('src/config/onePagerBenchmarks.ts')
    const inret = bench.slice(bench.indexOf("id: 'inretc1'"))
    assert.match(inret, /verified: false/)
    assert.match(read('src/lib/providers/market/bvlProvider.ts'), /BVL_SOURCE_VERIFIED = false/)
    // No Yahoo substitution, no hardcoded price, no delayed-ticker fallback:
    // the page reaches InRetail only through i18n LABEL keys and the route's
    // own response FIELDS — never a market symbol and never a literal figure.
    const page = codeOf(read(PAGE))
    assert.ok(!/INRETC1|INRETAIL\.|inretail['"]\s*:/i.test(page),
      'the page must not name a market symbol for InRetail')
    // The allowed references are now only the InRetail MARKET-metric i18n label
    // keys and the third allocation basis' own key
    // (`basisExChileanExInretail`), which names a DENOMINATOR, not a symbol.
    // The portfolio-impact keys are gone with the annotation owner review
    // pass 2 § 2 removed.
    for (const m of page.match(/[A-Za-z]*inretail\w*/gi) ?? []) {
      assert.ok(
        // `inretailGroup` (pass 4 § 4) is the React list key of the market
        // group the pair moved into — an identifier local to this file, never a
        // market symbol.
        /^(inretail(Title|Price|Variation|Group)|basisExChileanExInretail)$/i.test(m),
        `unexpected InRetail reference on the page: ${m}`,
      )
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Weekly snapshot (§§ 11-12)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · weekly snapshot', () => {
  const row = (over: Partial<OverviewSnapshotRow> = {}): OverviewSnapshotRow => ({
    rowKey: 'total', parentRowKey: null, depth: 0, displayOrder: 10,
    rowType: 'portfolio_total', labelEs: 'TOTAL', labelEn: 'TOTAL', currency: 'USD',
    value: 1_200, valueClass: 'source_value',
    previousValue: 1_000, beginningOfYearValue: 900, difference: 200,
    differenceClass: 'source_value', ...over,
  })

  test('the three levels come straight off the bound row', () => {
    const s = buildWeeklySnapshot(row())
    assert.equal(s.beginningOfYear, 900)
    assert.equal(s.previousWeek, 1_000)
    assert.equal(s.thisWeek, 1_200)
  })

  // ── THE CONTRACT ────────────────────────────────────────────────────────
  // displayed Difference = displayed This Week − displayed Previous Week.
  // The workbook's `Diferencia` column is never ingested (parseResumen header
  // rule 2, doc 02 § 4) and the PERSISTED figure is a reconciliation artifact,
  // never an override. An earlier revision of this file asserted the opposite;
  // it was wrong and is replaced.

  test('a DISAGREEING persisted figure does not win — the arithmetic does, and it is flagged', () => {
    const s = buildWeeklySnapshot(row({ difference: 175 }))
    assert.equal(s.difference, 200, 'displayed Difference is 1200 − 1000')
    assert.notEqual(s.difference, 175, 'the persisted figure is never displayed')
    assert.equal(s.differenceStatus, 'mismatch')
  })

  test('an AGREEING persisted figure reconciles, and the arithmetic is still the source of truth', () => {
    const s = buildWeeklySnapshot(row({ difference: 200 }))
    assert.equal(s.difference, 200)
    assert.equal(s.differenceStatus, 'reconciled')
  })

  test('a missing PREVIOUS anchor leaves Difference unavailable — the persisted figure is not shown', () => {
    const s = buildWeeklySnapshot(row({ previousValue: null, difference: 200 }))
    assert.equal(s.previousWeek, null)
    assert.equal(s.difference, null, 'never 0, and never the persisted figure standing in')
    assert.equal(s.differenceStatus, 'not_comparable')
  })

  test('a missing CURRENT anchor leaves Difference unavailable', () => {
    const s = buildWeeklySnapshot(row({ value: null, difference: 200 }))
    assert.equal(s.thisWeek, null)
    assert.equal(s.difference, null)
    assert.equal(s.differenceStatus, 'not_comparable')
  })

  test('a missing anchor stays null — never zero, never carried forward', () => {
    const s = buildWeeklySnapshot(row({ previousValue: null, beginningOfYearValue: null, difference: null }))
    assert.equal(s.previousWeek, null)
    assert.equal(s.beginningOfYear, null)
    assert.equal(s.difference, null)
    assert.equal(s.thisWeek, 1_200)
  })

  test('a non-finite value degrades to unavailable', () => {
    const s = buildWeeklySnapshot(row({ value: Number.NaN, difference: Number.POSITIVE_INFINITY }))
    assert.equal(s.thisWeek, null)
    assert.equal(s.difference, null)
    assert.equal(s.differenceStatus, 'not_comparable')
  })

  test('no bound row at all → every figure unavailable', () => {
    assert.deepEqual(buildWeeklySnapshot(null), {
      beginningOfYear: null, previousWeek: null, thisWeek: null,
      difference: null, differenceStatus: 'not_comparable',
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3b · The shared Difference invariant, and all three consumers using it
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · the displayed-Difference invariant', () => {
  test('A · both anchors present → current − previous', () => {
    const r = resolveDisplayedDifference(1_200, 1_000, null)
    assert.equal(r.displayed, 200)
  })

  test('B · either anchor unavailable → null, never zero', () => {
    for (const [c, p] of [[null, 1_000], [1_200, null], [null, null]] as const) {
      const r = resolveDisplayedDifference(c, p, 200)
      assert.equal(r.displayed, null)
      assert.notEqual(r.displayed, 0)
      assert.equal(r.status, 'not_comparable')
      assert.equal(r.persisted, 200, 'the persisted figure is retained for audit, not displayed')
    }
  })

  test('C · persisted agrees within tolerance → reconciled', () => {
    assert.equal(resolveDisplayedDifference(1_200, 1_000, 200).status, 'reconciled')
    // Inside the module's standard absolute tolerance.
    assert.equal(resolveDisplayedDifference(1_200, 1_000, 200.005).status, 'reconciled')
    // Relative tolerance carries the large-magnitude case.
    assert.equal(resolveDisplayedDifference(1e9 + 200, 1e9, 200.0001).status, 'reconciled')
  })

  test('D · persisted disagrees → mismatch, and the arithmetic still wins', () => {
    const r = resolveDisplayedDifference(1_200, 1_000, 175)
    assert.equal(r.displayed, 200)
    assert.equal(r.status, 'mismatch')
    assert.equal(resolveDisplayedDifference(1_200, 1_000, 200.5).status, 'mismatch')
  })

  test('E · no persisted figure → not comparable, arithmetic unaffected', () => {
    const r = resolveDisplayedDifference(1_200, 1_000, null)
    assert.equal(r.displayed, 200)
    assert.equal(r.status, 'not_comparable')
    assert.equal(resolveDisplayedDifference(1_200, 1_000, Number.NaN).status, 'not_comparable')
  })

  test('the tolerances are the module\'s established pair, declared once', () => {
    assert.equal(RECON_ABS_TOLERANCE, 0.01)
    assert.equal(RECON_REL_TOLERANCE, 1e-6)
    // `overview.ts` must IMPORT them rather than keep a second copy that could
    // drift — its allocation residual uses the same pair.
    const overview = read('src/lib/familyPortfolio/overview.ts')
    assert.match(overview, /from '\.\/difference\.ts'/)
    assert.ok(!/const RECON_ABS_TOLERANCE\s*=/.test(overview),
      'overview.ts must not redeclare the tolerances')
  })

  test('CONSUMER 1 · buildWeeklySnapshot resolves through the shared invariant', () => {
    const src = read('src/lib/familyPortfolio/overview.ts')
    const fn = src.slice(src.indexOf('export function buildWeeklySnapshot'))
    assert.match(fn.slice(0, 700), /resolveDisplayedDifference\(/)
    assert.ok(!/difference: finite\(row\.difference\)/.test(fn.slice(0, 700)),
      'the persisted figure must not be passed through as the display value')
  })

  test('CONSUMER 2 · buildHero (and the personal hero) resolve through it', () => {
    const src = read('src/lib/familyPortfolio/overview.ts')
    for (const name of ['export function buildHero', 'export function buildPersonalHero']) {
      const fn = src.slice(src.indexOf(name))
      const body = fn.slice(0, 700)
      assert.match(body, /resolveDisplayedDifference\(/, name)
      assert.ok(!/weeklyDifference: s\.totalRow\?\.difference/.test(body),
        `${name} must not pass the persisted figure through`)
    }
  })

  test('CONSUMER 3 · HierarchicalTable resolves through it', () => {
    const src = read('src/components/familyPortfolio/HierarchicalTable.tsx')
    assert.match(src, /import \{ resolveDisplayedDifference \}/)
    assert.match(src, /resolveDisplayedDifference\(row\.value, row\.previousValue, row\.difference\)/)
    // The Difference cell renders the DERIVED figure, not the stored one.
    assert.match(src, /amountCell\(\s*\n?\s*diff\.displayed,/)
    assert.ok(!/amountCell\(row\.difference/.test(src),
      'the table must not render the persisted difference')
    // …and its sign colour follows the derived figure too.
    assert.match(src, /diff\.displayed === null \? '' : diff\.displayed >= 0/)
  })

  test('no consumer keeps a second, ad hoc subtraction', () => {
    for (const rel of [
      'src/lib/familyPortfolio/overview.ts',
      'src/components/familyPortfolio/HierarchicalTable.tsx',
      'src/app/family-portfolio/page.tsx',
    ]) {
      const src = codeOf(read(rel))
      assert.ok(!/value\s*-\s*previousValue|thisWeek\s*-\s*previousWeek/.test(src),
        `${rel} must not reimplement the subtraction — it belongs to difference.ts`)
    }
  })

  test('a mismatch warns in WORDS, in both languages, and never by colour alone', () => {
    for (const lang of ['en', 'es'] as const) {
      const msg = dict[lang].fp.portfolio.differenceMismatch
      assert.ok(msg.length > 0, lang)
      // States which figure is authoritative — the reader must not be left
      // guessing which of two numbers to trust.
      assert.ok(/authoritative|autoritativa/i.test(msg), lang)
    }
    // The table cell carries a glyph + screen-reader text + a title.
    const table = read('src/components/familyPortfolio/HierarchicalTable.tsx')
    assert.match(table, /<span className="sr-only">\{warning\}<\/span>/)
    assert.match(table, /title=\{warning\}/)
    // The snapshot card carries a dot + WORDS.
    const card = read('src/components/familyPortfolio/WeeklySnapshotCard.tsx')
    assert.match(card, /row\.warning !== undefined && \(/)
    assert.match(card, /\{row\.warning\}/)
    // Neither surface may recolour the figure itself into an error state: an
    // ordinary negative week is not an anomaly.
    assert.ok(!/text-negative.*warning|warning.*text-negative/.test(codeOf(card)))
  })

  test('a reconciled row produces NO warning — zero clutter on current data', () => {
    const page = read(PAGE)
    assert.match(page, /snap\?\.differenceStatus === 'mismatch' \? t\.fp\.portfolio\.differenceMismatch : undefined/)
    const table = read('src/components/familyPortfolio/HierarchicalTable.tsx')
    assert.match(table, /diff\.status === 'mismatch' \? t\.fp\.portfolio\.differenceMismatch : undefined/)
  })

  test('data written by the current parser reconciles — no row can produce a warning', () => {
    // The live 102-week book is not reachable from the test runner (no DB
    // credentials in CI, by design), so the property is asserted against the
    // parser's OWN rule instead: `parseResumen.ts` stores
    // `difference = value − prev` whenever both anchors exist, and stores null
    // otherwise. Every row shaped that way must reconcile — which is what makes
    // "zero new warnings on current data" a structural consequence rather than
    // an observation. The corresponding live check (102 publications, 17,011
    // comparable rows, 0 mismatches, worst relative deviation 0) is run
    // separately against the database and reported with the stage.
    let warnings = 0
    let compared = 0
    for (let i = 0; i < 500; i++) {
      // Magnitudes spanning cents to billions, both signs, plus the
      // anchor-missing cases the parser also emits.
      const prev = (i % 7 === 0 ? -1 : 1) * (i * 137.11 + 0.07) * 10 ** (i % 6)
      const curr = prev + (i % 5 === 0 ? -1 : 1) * (i * 3.13 + 0.01)
      const persisted = curr - prev // exactly what the parser stores
      const r = resolveDisplayedDifference(curr, prev, persisted)
      compared++
      assert.equal(r.displayed, curr - prev)
      if (r.status !== 'reconciled') warnings++
    }
    assert.equal(warnings, 0, 'parser-written rows must never produce a reconciliation warning')
    assert.equal(compared, 500)

    // …and the anchor-missing shape the parser also writes yields no warning
    // either: it is `not_comparable`, which renders no marker.
    for (const [c, p] of [[null, 1_000], [1_200, null]] as const) {
      assert.equal(resolveDisplayedDifference(c, p, null).status, 'not_comparable')
    }
  })

  test('privacy is unchanged — the derived figure still renders through the guarded path', () => {
    const table = codeOf(read('src/components/familyPortfolio/HierarchicalTable.tsx'))
    // Still exactly one formatUsd call site (inside amountCell's PrivacyValue)
    // plus the import — the repair added no second, unmasked render path.
    assert.equal(table.split('formatUsd').length - 1, 2)
    assert.match(table, /<PrivacyValue masked=\{masked\}>\{formatUsd\(value\)\}<\/PrivacyValue>/)
    // The warning text is never an amount.
    assert.ok(!/warning=\{[^}]*(formatUsd|value|difference)\}/.test(table))
    const card = codeOf(read('src/components/familyPortfolio/WeeklySnapshotCard.tsx'))
    assert.ok(!card.includes('formatUsd'), 'the card still formats nothing itself')
    assert.match(card, /<MaskedAmount/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Personal-scope composition (§ 10)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · personal-scope composition', () => {
  // A hand-checkable personal shape: two asset classes and one named holding
  // under a bound total. 300 + 500 + 200 = 1000.
  const rows: OverviewSnapshotRow[] = [
    { rowKey: 'soc.a', parentRowKey: null, depth: 0, displayOrder: 1, rowType: 'sociedad_header', labelEs: 'S A', labelEn: null, currency: 'USD', value: null, valueClass: 'source_value', previousValue: null, beginningOfYearValue: null, difference: null, differenceClass: null },
    { rowKey: 'ac.eq', parentRowKey: 'soc.a', depth: 1, displayOrder: 2, rowType: 'asset_class', labelEs: 'Renta Variable', labelEn: 'Equity', currency: 'USD', value: 300, valueClass: 'source_value', previousValue: 280, beginningOfYearValue: 250, difference: 20, differenceClass: 'source_value' },
    { rowKey: 'ac.fi', parentRowKey: 'soc.a', depth: 1, displayOrder: 3, rowType: 'asset_class', labelEs: 'Renta Fija', labelEn: 'Fixed Income', currency: 'USD', value: 500, valueClass: 'source_value', previousValue: 500, beginningOfYearValue: 480, difference: 0, differenceClass: 'source_value' },
    // A sociedad subtotal that AGGREGATES the two asset classes above. It must
    // never join the constituent set — that is the § 15 double count.
    { rowKey: 'soc.a.total', parentRowKey: null, depth: 0, displayOrder: 4, rowType: 'sociedad_total', labelEs: 'Total S A', labelEn: null, currency: 'USD', value: 800, valueClass: 'source_value', previousValue: 780, beginningOfYearValue: 730, difference: 20, differenceClass: 'source_value' },
    { rowKey: 'nh.x', parentRowKey: null, depth: 0, displayOrder: 5, rowType: 'named_holding', labelEs: 'Posición X', labelEn: 'Position X', currency: 'USD', value: 200, valueClass: 'source_value', previousValue: 190, beginningOfYearValue: 180, difference: 10, differenceClass: 'source_value' },
    { rowKey: 'pf.total', parentRowKey: null, depth: 0, displayOrder: 6, rowType: 'portfolio_total', labelEs: 'TOTAL', labelEn: 'TOTAL', currency: 'USD', value: 1_000, valueClass: 'source_value', previousValue: 970, beginningOfYearValue: 910, difference: 30, differenceClass: 'source_value' },
    // A SECOND portfolio_total, which real personal scopes carry — picking by
    // row type alone would be ambiguous and sometimes wrong.
    { rowKey: 'pf.other', parentRowKey: null, depth: 0, displayOrder: 7, rowType: 'portfolio_total', labelEs: 'OTRO TOTAL', labelEn: null, currency: 'USD', value: 4_242, valueClass: 'source_value', previousValue: null, beginningOfYearValue: null, difference: null, differenceClass: null },
  ]
  const perf: OverviewPerformanceRow[] = [
    { basis: 'total', metric: 'flow', value: 5, valueClass: 'source_value', boundRowKey: 'pf.total' },
    { basis: 'total', metric: 'weekly_return', value: 0.025, valueClass: 'source_value', boundRowKey: 'pf.total' },
    { basis: 'total', metric: 'weekly_profit', value: 25, valueClass: 'source_value', boundRowKey: 'pf.total' },
    { basis: 'total', metric: 'ytd_return', value: 0.09, valueClass: 'source_value', boundRowKey: 'pf.total' },
    { basis: 'total', metric: 'ytd_profit', value: 90, valueClass: 'source_value', boundRowKey: 'pf.total' },
  ]

  test('the total is the NUMERICALLY BOUND row, not "a portfolio_total"', () => {
    const s = identifyPersonalStructure(rows, perf)
    assert.equal(s.totalRow?.rowKey, 'pf.total')
    assert.notEqual(s.totalRow?.rowKey, 'pf.other')
  })

  test('no binding → no total, and the allocation is unavailable (fail closed)', () => {
    const s = identifyPersonalStructure(rows, [])
    assert.equal(s.totalRow, null)
    assert.equal(buildPersonalAllocation(s)[0].status, 'unavailable')
    assert.equal(buildPersonalComparisonRows(s), null)
  })

  test('constituents are asset classes + named holdings, and they TIE to the total', () => {
    const s = identifyPersonalStructure(rows, perf)
    assert.deepEqual(s.constituentRows.map((r) => r.rowKey), ['ac.eq', 'ac.fi', 'nh.x'])
    const basis = buildPersonalAllocation(s)[0]
    assert.equal(basis.status, 'ok')
    assert.equal(basis.residual, null, 'a tying structure reports no residual')
    assert.equal(basis.denominatorValue, 1_000)
    assert.deepEqual(basis.entries.map((e) => e.weight), [0.3, 0.5, 0.2])
  })

  test('no parent + child double counting — the sociedad total is excluded', () => {
    const s = identifyPersonalStructure(rows, perf)
    assert.ok(!s.constituentRows.some((r) => r.rowType === 'sociedad_total'))
    assert.ok(!s.constituentRows.some((r) => r.rowKey === 'pf.total'))
    // Including it would have summed to 1800 against a 1000 denominator.
    const sum = s.constituentRows.reduce((a, r) => a + (r.value ?? 0), 0)
    assert.equal(sum, 1_000)
  })

  test('a structure that does NOT tie surfaces a visible residual, never absorbs it', () => {
    const broken = rows.map((r) => (r.rowKey === 'nh.x' ? { ...r, value: 250 } : r))
    const basis = buildPersonalAllocation(identifyPersonalStructure(broken, perf))[0]
    assert.equal(basis.status, 'ok')
    assert.equal(basis.residual, 50)
  })

  test('a personal scope has exactly ONE basis and one performance basis name', () => {
    assert.deepEqual([...PERSONAL_PERFORMANCE_BASES], ['total'])
    assert.equal(buildPersonalAllocation(identifyPersonalStructure(rows, perf)).length, 1)
    const blocks = extractPerformanceBlocksFor(perf, PERSONAL_PERFORMANCE_BASES)
    assert.equal(blocks.length, 1)
    assert.deepEqual(blocks[0], {
      basis: 'total', flow: 5, weeklyReturn: 0.025, weeklyProfit: 25, ytdReturn: 0.09, ytdProfit: 90,
    })
  })

  test('the hero reads the personal basis, never a Main basis name', () => {
    const hero = buildPersonalHero(identifyPersonalStructure(rows, perf), perf)
    assert.deepEqual(hero, {
      totalValue: 1_000,
      // DERIVED 1000 − 970, and reconciled against the persisted 30.
      weeklyDifference: 30,
      weeklyDifferenceStatus: 'reconciled',
      weeklyReturn: 0.025,
      ytdReturn: 0.09,
    })
    // Main's basis names must not resolve anything for a personal scope.
    const mainOnly: OverviewPerformanceRow[] = perf.map((p) => ({ ...p, basis: 'with_chilean_equities' }))
    const blank = buildPersonalHero(identifyPersonalStructure(rows, mainOnly), mainOnly)
    assert.equal(blank.weeklyReturn, null)
    assert.equal(blank.ytdReturn, null)
  })

  test('the route filters EVERY read to the requested scope', () => {
    const src = read(ROUTE)
    assert.match(src, /getSnapshotRowsForScope\(selected\.id, scope\)/)
    assert.match(src, /getPerformanceRowsForScope\(selected\.id, scope\)/)
    assert.match(src, /getCurrentCommentary\(selected\.id, scope\)/)
    // R13.R2C § 15 removed the LAST hardcoded 'main': the evolution history is
    // read per scope too, so every read on this route is scope-filtered without
    // exception, and RLS re-derives the same filter independently.
    assert.match(src, /getEvolutionObservations\(scope\)/)
    assert.match(src, /getWeeklyNotes\(selected\.id, scope\)/)
    assert.ok(!/getEvolutionObservations\('main'\)/.test(src))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Evolution range selection (§§ 16-21)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · evolution range selection', () => {
  /** 105 weekly observations, every 7 days from 2024-08-23. Hand-checkable. */
  const weekly = (() => {
    const out: Array<{ date: string; value: number }> = []
    const start = Date.UTC(2024, 7, 23)
    for (let i = 0; i < 105; i++) {
      const d = new Date(start + i * 7 * 86_400_000)
      out.push({ date: d.toISOString().slice(0, 10), value: 1_000 + i })
    }
    return out
  })()
  const END = weekly[weekly.length - 1].date

  test('the five broker periods, and nothing arbitrary', () => {
    assert.deepEqual([...EVOLUTION_PERIODS], ['1M', '3M', 'YTD', '1Y', 'ALL'])
    assert.ok(isEvolutionPeriod('YTD'))
    assert.ok(!isEvolutionPeriod('6M'))
    assert.ok(!isEvolutionPeriod('MAX'))
  })

  test('month arithmetic clamps at end of month — 31 Jul minus 1M is 30 Jun', () => {
    assert.equal(shiftIsoMonths('2026-07-31', -1), '2026-06-30')
    assert.equal(shiftIsoMonths('2026-03-31', -1), '2026-02-28')
    assert.equal(shiftIsoMonths('2024-03-31', -1), '2024-02-29')
    assert.equal(shiftIsoMonths('2026-01-15', -1), '2025-12-15')
  })

  test('YTD is the calendar year of the ENDPOINT, never the viewer\'s today', () => {
    assert.equal(periodBoundary('2026-07-31', 'YTD'), '2026-01-01')
    assert.equal(periodBoundary('2024-09-06', 'YTD'), '2024-01-01')
    assert.equal(periodBoundary('2026-07-31', 'ALL'), null)
  })

  test('the endpoint is the series\' own latest observation', () => {
    const r = selectEvolutionRange(weekly, 'ALL')
    assert.equal(r.endDate, END)
    assert.equal(r.startDate, '2024-08-23')
    assert.equal(r.points.length, 105)
  })

  test('a range selects only REAL observations — nothing is interpolated', () => {
    for (const p of EVOLUTION_PERIODS) {
      const r = selectEvolutionRange(weekly, p)
      const real = new Set(weekly.map((w) => w.date))
      for (const pt of r.points) {
        assert.ok(real.has(pt.date), `${p}: ${pt.date} is not a source observation`)
        assert.equal(pt.value, weekly.find((w) => w.date === pt.date)!.value)
      }
      // Windows nest: a shorter period is a subset of a longer one.
      assert.ok(r.points.length <= 105)
    }
  })

  test('the window starts at the first ACTUAL observation on/after the boundary', () => {
    const r = selectEvolutionRange(weekly, '1M')
    const boundary = r.boundary!
    assert.ok(r.startDate! >= boundary)
    // The observation immediately before the start is genuinely before the
    // boundary — i.e. nothing eligible was skipped.
    const prior = weekly.filter((w) => w.date < r.startDate!).at(-1)
    assert.ok(prior === undefined || prior.date < boundary)
  })

  test('a gap in the source stays a gap', () => {
    const gapped = weekly.filter((_, i) => i < 90 || i > 96)
    const r = selectEvolutionRange(gapped, 'ALL')
    assert.equal(r.points.length, gapped.length)
    for (const missing of weekly.slice(90, 97)) {
      assert.equal(observationAt(r.points, missing.date), null)
    }
  })

  test('a period longer than the record is reported as truncated, not padded', () => {
    const short = weekly.slice(-3)
    const r = selectEvolutionRange(short, '1Y')
    assert.equal(r.points.length, 3)
    assert.equal(r.truncatedByHistory, true)
    assert.equal(selectEvolutionRange(weekly, '1M').truncatedByHistory, false)
  })

  test('an empty series yields an empty range, never a fabricated point', () => {
    const r = selectEvolutionRange([], 'ALL')
    assert.deepEqual(r.points, [])
    assert.equal(r.startDate, null)
    assert.equal(r.endDate, null)
  })

  test('Compare pins both series to a shared endpoint neither can exceed', () => {
    const shorter = weekly.slice(0, 100)
    const end = sharedEndpoint(weekly, shorter)
    assert.equal(end, shorter[shorter.length - 1].date)
    const a = selectEvolutionRange(weekly, 'ALL', end)
    assert.equal(a.endDate, end, 'the longer series is not drawn past the shared endpoint')
    assert.equal(sharedEndpoint(weekly, []), null)
  })

  test('an endpoint override cannot invent a point beyond the record', () => {
    const r = selectEvolutionRange(weekly, 'ALL', '2027-12-31')
    assert.equal(r.endDate, END)
    assert.equal(r.points.length, 105)
  })

  test('value change is a VALUE change — and null off a non-positive base', () => {
    const c = valueChange([
      { date: '2026-01-05', value: 200 },
      { date: '2026-01-12', value: 250 },
    ])
    assert.equal(c.absolute, 50)
    assert.equal(c.ratio, 0.25)
    assert.equal(c.openingDate, '2026-01-05')
    assert.equal(c.closingDate, '2026-01-12')
    assert.equal(valueChange([{ date: '2026-01-05', value: 0 }, { date: '2026-01-12', value: 5 }]).ratio, null)
    assert.equal(valueChange([{ date: '2026-01-05', value: -5 }, { date: '2026-01-12', value: 5 }]).ratio, null)
  })

  test('a single observation has no change — null, never a flat zero', () => {
    const c = valueChange([{ date: '2026-01-05', value: 200 }])
    assert.equal(c.absolute, null)
    assert.equal(c.ratio, null)
    assert.deepEqual(valueChange([]), { absolute: null, ratio: null, openingDate: null, closingDate: null })
  })

  test('the crosshair reads an exact observation, never the nearest', () => {
    assert.equal(observationAt(weekly, '2024-08-23')!.value, 1_000)
    assert.equal(observationAt(weekly, '2024-08-24'), null)
  })

  test('the module holds no clock — a range cannot depend on when it is run', () => {
    const src = codeOf(read('src/lib/familyPortfolio/evolutionRange.ts'))
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(src),
      'a period must be derived from the series, not from the viewer\'s today')
  })

  test('the chart never smooths, resamples or fills', () => {
    const src = codeOf(read(EVO_CHART))
    assert.ok(!/curve|spline|bezier|smooth|interpolat|monotone/i.test(src),
      'the line must connect real observations only')
    assert.ok(!/\bC \$\{|\bQ \$\{/.test(src), 'no bezier path commands')
    assert.ok(!/fill="url\(#|linearGradient|radialGradient/.test(src),
      '§ 22 forbids gradients and area fills')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · § 18 — value change is not investment return
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · § 18 terminology contract', () => {
  test('the evolution vocabulary says value, never return', () => {
    for (const lang of ['en', 'es'] as const) {
      const o = dict[lang].fp.overview
      // R13.R2E §§ 9-10 — `evoValueChange` and `evoChangeInValue` are RETIRED.
      // The plotted level is DERIVED, and both generic names read as statements
      // about the real balance. Their replacements carry the same § 18
      // guarantee, asserted here on the labels actually in use.
      for (const key of ['evoValueLabel', 'evoActualValueLabel', 'evoAdjustedValueLabel', 'evoAdjustedValueChange'] as const) {
        assert.ok(o[key].length > 0, `${lang}.${key}`)
        assert.ok(!/\breturn\b|retorno|rentabilidad/i.test(o[key]),
          `${lang}.${key} must not call a value change a return: "${o[key]}"`)
      }
      // The disclosure states the distinction outright rather than relying on
      // the label alone.
      assert.match(o.evoValueChangeNote, /not an investment[- ]return|no es un cálculo de retorno/i)
      assert.match(o.evoValueChangeNote, /withdrawal|retiro/i)
    }
  })

  test('the evolution region on the page uses only value vocabulary', () => {
    const src = read(PAGE)
    // The evolution region now runs from its own heading to the closing
    // provenance block — Weekly Notes moved ABOVE it in the owner review, so
    // it can no longer be used as the region's end marker.
    const start = src.indexOf('o.evoTitle')
    const end = src.indexOf('<DualFreshnessBadge')
    assert.ok(start > 0 && end > start)
    const region = src.slice(start, end)
    // R13.R2E §§ 9-10 — the region names THREE distinct things: the ACTUAL
    // published balance, the DERIVED plotted path, and the change along it. The
    // § 18 contract is unchanged and asserted below: the region still speaks in
    // VALUE, and still may not borrow a performance-block return label.
    assert.match(region, /o\.evoActualValueLabel/)
    assert.match(region, /o\.evoAdjustedValueLabel/)
    assert.match(region, /o\.evoAdjustedValueChange/)
    assert.match(region, /o\.evoValueChangeNote/)
    assert.ok(!/\breturn\b|retorno/i.test(dict.en.fp.overview.evoAdjustedValueLabel + dict.es.fp.overview.evoAdjustedValueLabel),
      'the adjusted-value label is still a value, never a return')
    // The performance-basis return keys belong to region 2, not here.
    assert.ok(!/o\.weeklyReturn|o\.ytdReturn/.test(region),
      'a flow-adjusted return label must not appear in the value-level region')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Evolution privacy (§ 23) and personal history (§ 24)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · evolution privacy and personal history', () => {
  test('masking replaces the whole chart — no axis, tooltip or value survives', () => {
    const src = read(PAGE)
    const guard = src.indexOf(') : masked ? (')
    const chart = src.indexOf('<PortfolioEvolutionChart')
    assert.ok(guard > 0 && chart > guard)
    const branch = src.slice(guard, chart)
    assert.match(branch, /<PrivacyValue masked/)
    for (const leak of ['formatUsd', 'formatValue', 'aria-label={', 'title={', 'data-value']) {
      assert.ok(!branch.includes(leak), `the masked branch must not carry ${leak}`)
    }
  })

  test('the chart exposes no amount through a data attribute', () => {
    const src = codeOf(read(EVO_CHART))
    assert.ok(!/data-(value|amount|raw)/.test(src))
  })

  // SUPERSEDED BY R13.R2C § 15. R13.R2 § 24 reported personal history as
  // unavailable because none had been normalised — a statement about the
  // INGEST, not about the source. The owner has since asked for it, and the
  // workbook's historical grid does carry each personal scope's own
  // numerically-bound total row, so the histories are now published through the
  // same extractor, into the same table, under the same per-scope RLS.
  //
  // The honesty rule the old assertion protected is intact and still asserted:
  // nothing is back-projected, a scope that joined the book later simply starts
  // later, and the honest empty state remains for a scope with no history.
  test('personal history is source-backed, and the honest empty state remains', () => {
    const route = read(ROUTE)
    assert.match(route, /const persisted = await getEvolutionObservations\(scope\)/)
    assert.match(route, /total: isMain \? \[\] : pointsFor\('total'\)/)
    const page = read(PAGE)
    assert.match(page, /isMain \? o\.evolutionEmpty : o\.evoUnavailablePersonal/)
    for (const lang of ['en', 'es'] as const) {
      const msg = dict[lang].fp.overview.evoUnavailablePersonal
      assert.ok(msg.length > 0, lang)
      // States a fact about the source; never an error, never a promise.
      assert.ok(!/error|fail|coming soon|pr[óo]ximamente/i.test(msg), lang)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Allocation presentation settings (§§ 14-15)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · allocation presentation settings', () => {
  test('every vocabulary is CLOSED and matches the § 14 list', () => {
    assert.deepEqual([...LABEL_POSITIONS], ['inside', 'outside', 'legend_only'])
    assert.deepEqual([...LABEL_CONTENTS], ['percentage', 'value', 'percentage_value'])
    assert.deepEqual([...DONUT_THICKNESSES], ['thin', 'medium', 'thick'])
    // TWO palettes since the owner-review pass: `oceanic` was eight shades of
    // blue and is withdrawn. See tests/portfolioR2OwnerReview.test.ts, which
    // measures why.
    assert.deepEqual([...ALLOCATION_PALETTES], ['institutional', 'spectrum'])
  })

  test('the default reproduces the pre-R13.R2 presentation', () => {
    assert.deepEqual(DEFAULT_ALLOCATION_SETTINGS, {
      labelPosition: 'legend_only', labelContent: 'percentage',
      legendVisible: true, palette: 'institutional', donutThickness: 'medium',
      // Added by the owner review; `auto` is the owner-required behaviour.
      referenceLine: 'auto',
    })
  })

  test('a palette is a NAME resolving to tokens — a colour is unrepresentable', () => {
    for (const p of ALLOCATION_PALETTES) {
      const tokens = PALETTE_TOKENS[p]
      // Twelve slots since the owner review: the live book's personal scopes
      // carry up to 12 constituents, and eight tokens made slices 1/9, 2/10,
      // 3/11 and 4/12 render in the identical colour.
      assert.equal(tokens.length, 12, p)
      for (const tok of tokens) {
        assert.match(tok, /^--fp-[a-z]+-(1[0-2]|[1-9])$/, `${p}: ${tok} must be a design token name`)
        assert.ok(!/#|rgb|hsl/.test(tok))
      }
      assert.equal(new Set(tokens).size, 12, `${p} must have 12 distinct slots`)
    }
    assert.equal(paletteTokenAt('institutional', 0), '--fp-slice-1')
    assert.equal(paletteTokenAt('spectrum', 12), '--fp-spectrum-1', 'slots wrap past the twelfth')
    assert.equal(paletteTokenAt('spectrum', -1), '--fp-spectrum-1', 'a bad index falls back to the first')
  })

  test('no palette borrows a signal token or the reserved Review purple', () => {
    const css = read('src/app/globals.css')
    for (const tok of Object.values(PALETTE_TOKENS).flat()) {
      assert.ok(!/positive|negative|warning|review/.test(tok), tok)
      for (const m of css.matchAll(new RegExp(`${tok}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))) {
        // #7A68AE and #56004E are the project's reserved/near purples.
        assert.ok(!/^#(7A68AE|56004E)$/i.test(m[1]), `${tok} must not use the reserved purple`)
      }
    }
  })

  test('thickness is a named step, never a caller-supplied number', () => {
    for (const t of DONUT_THICKNESSES) {
      const r = THICKNESS_INNER_RATIO[t]
      assert.ok(r > 0 && r < 1, t)
    }
    assert.ok(THICKNESS_INNER_RATIO.thick < THICKNESS_INNER_RATIO.medium)
    assert.ok(THICKNESS_INNER_RATIO.medium < THICKNESS_INNER_RATIO.thin)
  })

  test('validation REJECTS an unknown member and names it — never coerces', () => {
    const bad = validateAllocationSettings({
      ...DEFAULT_ALLOCATION_SETTINGS, palette: '#FF00FF', labelPosition: 'floating',
    })
    assert.equal(bad.ok, false)
    assert.ok(bad.ok === false && bad.invalidFields.includes('palette'))
    assert.ok(bad.ok === false && bad.invalidFields.includes('labelPosition'))
    for (const junk of [null, undefined, 42, 'x', []]) {
      assert.equal(validateAllocationSettings(junk).ok, false)
    }
  })

  test('an arbitrary style payload cannot survive validation', () => {
    const v = validateAllocationSettings({
      ...DEFAULT_ALLOCATION_SETTINGS,
      customCss: 'body{display:none}', hex: '#123456', style: { color: 'red' },
    })
    assert.equal(v.ok, true)
    assert.ok(v.ok === true)
    assert.deepEqual(Object.keys(v.settings).sort(), [
      'donutThickness', 'labelContent', 'labelPosition', 'legendVisible', 'palette', 'referenceLine',
    ])
  })

  test('a stored row falls back to defaults; a caller write does not', () => {
    // Reading must never take the page down; writing must never silently store
    // something other than what was sent.
    assert.deepEqual(normalizeStoredSettings(null), DEFAULT_ALLOCATION_SETTINGS)
    assert.equal(normalizeStoredSettings({ palette: 'nope' }).palette, 'institutional')
    assert.equal(validateAllocationSettings({ ...DEFAULT_ALLOCATION_SETTINGS, palette: 'nope' }).ok, false)
  })

  test('the migration is additive, forward-only and enum-constrained', () => {
    assert.ok(existsSync(join(ROOT, MIGRATION)))
    const sql = read(MIGRATION).toLowerCase()
    assert.ok(!/drop table|drop column|alter column .* type|rename/.test(sql))
    assert.match(sql, /create table if not exists public\.family_portfolio_presentation_settings/)
    for (const member of ['inside', 'outside', 'legend_only', 'percentage_value', 'institutional', 'spectrum', 'thin', 'medium', 'thick', 'auto', 'hidden']) {
      assert.ok(sql.includes(`'${member}'`), `CHECK must admit ${member}`)
    }
    // No free-form style payload COLUMN. Scoped to the create-table block —
    // the migration's own postcondition mentions `json`/`jsonb` precisely
    // because it asserts their absence, and a whole-file scan would fire on
    // that guard rather than on a real column.
    const createBlock = sql.slice(
      sql.indexOf('create table if not exists public.family_portfolio_presentation_settings'),
    )
    const columns = createBlock.slice(0, createBlock.indexOf(');'))
    assert.ok(!/\bjsonb\b|\bjson\b/.test(columns), 'no free-form style payload column')
    assert.ok(!/(hex|rgb|css|style)\b/.test(columns), 'no colour or style column')
  })

  test('§ 15 authority split: administrator writes, member reads', () => {
    const sql = read(MIGRATION)
    assert.match(sql, /for select to authenticated\s*\n\s*using \(coalesce\(array_length\(public\.nmi_current_portfolio_scopes\(\)/)
    assert.match(sql, /for update to authenticated\s*\n\s*using \(public\.nmi_is_administrator\(\)\)\s*\n\s*with check \(public\.nmi_is_administrator\(\)\)/)
    assert.match(sql, /for insert to authenticated\s*\n\s*with check \(public\.nmi_is_administrator\(\)\)/)
    // The route enforces the same split independently of RLS.
    const route = read(SETTINGS_ROUTE)
    assert.match(route, /if \(!canAdminister\(entitlement\.input\)/)
    assert.match(route, /scopesFor\(entitlement\.input\)\.length === 0/)
    // A refused write must be reported, never reported as success.
    assert.match(read(SETTINGS_REPO), /if \(!data\) return \{ ok: false, code: 'not_authorized' \}/)
    // Never the service-role client for a user-authority decision.
    assert.ok(!/getSupabaseAdminClient|service_role|SERVICE_ROLE/.test(read(SETTINGS_REPO)))
    assert.ok(existsSync(join(ROOT, PGTAP)), 'the settings table needs its own pgTAP suite')
  })

  test('the settings surface offers presets only — no hex, RGB or free text', () => {
    const dialog = codeOf(read(SETTINGS_DIALOG))
    assert.ok(!/type="color"|type='color'/.test(dialog), 'no colour picker')
    assert.ok(!/type="text"|type='text'|<textarea/.test(dialog), 'no free-text field')
    assert.ok(!/#[0-9a-fA-F]{6}/.test(dialog), 'no literal colour')
    assert.match(dialog, /PALETTE_TOKENS/)
  })

  test('a member sees the control absent, not disabled, and is told why', () => {
    const page = read(PAGE)
    assert.match(page, /onOpenSettings=\{canEditSettings \? \(\) => setSettingsOpen\(true\) : undefined\}/)
    assert.match(page, /readOnlyNote=\{canEditSettings \? undefined : o\.settingsReadOnly\}/)
    for (const lang of ['en', 'es'] as const) {
      assert.ok(dict[lang].fp.overview.settingsReadOnly.length > 0, lang)
      assert.ok(dict[lang].fp.overview.settingsGlobalNote.length > 0, lang)
    }
  })

  test('allocation denominator semantics are unchanged by the settings layer', () => {
    // Presentation may not touch the arithmetic: the settings module knows
    // nothing about weights, denominators or values.
    const src = read('src/lib/familyPortfolio/allocationSettings.ts')
    assert.ok(!/weight|denominator|residual|value \/|entries/.test(codeOf(src)))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Layout, accessibility and EN/ES parity
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · layout, accessibility, localization', () => {
  test('the snapshot and allocation are one coordinated row at wide widths', () => {
    const src = read(PAGE)
    assert.match(src, /xl:grid-cols-|xl:flex-row|xl:col-span-/,
      'the pair must become side-by-side at a wide breakpoint')
  })

  test('no fixed height binds below lg, and no page-level horizontal scroll', () => {
    const src = read(PAGE)
    // The app's convention: measured-height pinning binds via a CSS variable
    // at lg+ only. An inline numeric height would lock stacked mobile cards.
    for (const m of src.match(/style=\{\{[^}]*height:[^}]*\}\}/g) ?? []) {
      assert.ok(/minHeight/.test(m), `an inline height must be a minHeight placeholder, saw ${m}`)
    }
    assert.ok(!/min-w-\[\d{4,}px\]/.test(src), 'no four-digit min-width on the page')
    assert.ok(!/overflow-x-scroll/.test(src), 'dense content scrolls inside its card, not the page')
  })

  test('the dense weekly-close table scrolls inside its own card', () => {
    assert.match(read(PAGE), /minWidth=\{760\}/)
  })

  test('the chart is keyboard operable and has a textual alternative', () => {
    const src = read(EVO_CHART)
    assert.match(src, /onKeyDown/)
    assert.match(src, /ArrowRight|ArrowLeft/)
    assert.match(src, /tabIndex/)
    assert.match(src, /sr-only/)
    assert.match(src, /aria-live/)
  })

  test('the donut carries meaning in text, not colour alone', () => {
    const src = read(DONUT)
    assert.match(src, /role="img"/)
    assert.match(src, /aria-label/)
    assert.match(src, /<title>/)
    // With the legend hidden the accessible name must still enumerate slices.
    assert.match(src, /settings\.legendVisible\s*\n?\s*\?\s*summary/)
  })

  test('every new i18n key exists in BOTH languages and neither is blank', () => {
    const KEYS = [
      'performanceMarketsTitle', 'portfolioGroup', 'marketsGroup', 'weeklySnapshotTitle',
      'notesTitle', 'notesEmpty', 'personalWeekly', 'personalYtd',
      'snapBeginningOfYear', 'snapPreviousWeek', 'snapThisWeek', 'snapDifference', 'snapDetailTitle',
      // R13.R2E §§ 9-10: `evoValueChange`/`evoChangeInValue` retired in favour of
      // the three explicitly-named concepts.
      'evoTitle', 'evoValueLabel', 'evoActualValueLabel', 'evoAdjustedValueLabel',
      'evoAdjustedValueChange', 'evoValueChangeNote',
      'evoModeCompare', 'evoModeIncl', 'evoModeExcl', 'evoSeriesLabel', 'evoPeriodLabel',
      'evoPeriod1M', 'evoPeriod3M', 'evoPeriodYTD', 'evoPeriod1Y', 'evoPeriodALL',
      'evoNoRange', 'evoTruncated', 'evoMasked', 'evoUnavailablePersonal', 'evoTableAlternative',
      'settingsTitle', 'settingsOpen', 'settingsGlobalNote', 'settingsReadOnly',
      'settingsLabelPosition', 'settingsPosInside', 'settingsPosOutside', 'settingsPosLegend',
      'settingsLabelContent', 'settingsContentPct', 'settingsContentValue', 'settingsContentBoth',
      'settingsLegend', 'settingsLegendShow', 'settingsLegendHide',
      // `settingsPaletteOceanic` is gone with the withdrawn palette.
      'settingsPalette', 'settingsPaletteInstitutional', 'settingsPaletteSpectrum',
      'settingsThickness', 'settingsThicknessThin', 'settingsThicknessMedium', 'settingsThicknessThick',
      'settingsSave', 'settingsCancel', 'settingsSaved', 'settingsError', 'settingsMaskNote',
      // Added by the owner review — both languages, both surfaces.
      // `inretailIncluded` is gone with the annotation pass 2 § 2 removed.
      'aumLabel', 'aumBasis',
      'hwmLabel', 'hwmTooltip', 'hwmSetAt', 'hwmCurrent', 'hwmHelpLabel',
      'hwmSetting', 'hwmSettingAuto', 'hwmSettingHidden', 'hwmSettingHelp',
      'settingsEvolution', 'settingsEvolutionTitle',
      // Owner review pass 2 — the snapshot basis, the flow disclosure, and the
      // Weekly Notes editor.
      'snapBasisTotal', 'snapBasisInclChile', 'snapFlowNote', 'snapFlowIdentity',
      'notesEdit', 'notesAdd', 'notesEditorLabel', 'notesPlaceholder',
      'notesSave', 'notesSaving', 'notesSaved', 'notesCancel',
      'notesEmptyError', 'notesTooLong', 'notesSaveError', 'notesRemaining',
    ] as const
    for (const key of KEYS) {
      for (const lang of ['en', 'es'] as const) {
        const v = (dict[lang].fp.overview as Record<string, string>)[key]
        assert.equal(typeof v, 'string', `${lang}.${key} must exist`)
        assert.ok(v.trim().length > 0, `${lang}.${key} must not be blank`)
      }
    }
  })

  test('the fp.overview vocabulary still avoids attribution language', () => {
    const FORBIDDEN = /performance attribution|performance contribution|contribution to return|selection effect|allocation effect|active return|\balpha\b/i
    for (const lang of ['en', 'es'] as const) {
      assert.ok(!FORBIDDEN.test(JSON.stringify(dict[lang].fp.overview)), lang)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10 · Regression — R13.R1/R1.1 and the deferred stages are untouched
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2 · regression', () => {
  test('Weekly Changes financial semantics are unchanged', () => {
    const wc = read('src/lib/familyPortfolio/weeklyChanges.ts')
    for (const fn of [
      'selectComparisonRange', 'selectWeekPair', 'buildChangeNodes', 'buildTotalMetrics',
      'deriveDrivers', 'buildWaterfall', 'detectReclassifications', 'suppressSingleWeekMetrics',
    ]) {
      assert.ok(wc.includes(`export function ${fn}`), `${fn} must still exist`)
    }
    assert.match(wc, /export type NodeLifecycle = 'ongoing' \| 'new_position' \| 'exited_position'/)
    // R13.R3 owns the waterfall redesign — not started here.
    assert.ok(!/R13\.R3/.test(read(PAGE)))
  })

  test('the R13.R1.1 parser contract is untouched', () => {
    const parser = read('src/lib/familyPortfolio/resumen/parseResumen.ts')
    assert.match(parser, /r13\.r1\.1\.resumen\.5/)
    assert.match(parser, /rowCarriesValueAnywhere/)
  })

  test('Alternatives and Weekly Changes pages were not redesigned', () => {
    for (const p of [
      'src/app/family-portfolio/alternatives/page.tsx',
      'src/app/family-portfolio/weekly-changes/page.tsx',
    ]) {
      const src = read(p)
      // R13.R2F5 § C is the first R13.R2-series change these two pages have
      // taken: the shared footnote band, which repacks existing provenance
      // text and adds nothing. That is not the Summary redesign this test
      // exists to keep out, so the proxy ("the string R13.R2 never appears")
      // is replaced by the property it was standing in for.
      for (const m of src.match(/R13\.R2\S*/g) ?? []) {
        assert.match(m, /^R13\.R2F5/, `${p} may only carry the R13.R2F5 note band — found ${m}`)
      }
      // The property itself: neither page has become the Summary. None of the
      // Summary's composition pieces may appear here.
      for (const c of [
        'PortfolioValueHero',
        'WeeklySnapshotCard',
        'AllocationPanel',
        'PerformanceMarketsStrip',
        'PortfolioEvolutionChart',
        'SummaryPrintSheet',
      ]) {
        assert.ok(!src.includes(c), `${p} must not import the Summary's ${c}`)
      }
    }
  })

  test('the legacy /portfolio route and the module nav are intact', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/portfolio/page.tsx')))
    const nav = read('src/components/familyPortfolio/FamilyPortfolioNav.tsx')
    for (const key of ['navOverview', 'navPortfolio', 'navWeeklyChanges', 'navAlternatives', 'navAdmin']) {
      assert.ok(nav.includes(key), `${key} must remain in the module nav`)
    }
  })

  test('entitlement semantics are unchanged', () => {
    const ent = read('src/lib/portfolioAccess/entitlements.ts')
    assert.match(ent, /jaime: \['main', 'jaime', 'alternatives'\]/)
    assert.match(ent, /andres: \['main', 'andres', 'alternatives'\]/)
    assert.match(ent, /pablo: \['main', 'pablo', 'alternatives'\]/)
  })
})
