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

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const PAGE = 'src/app/family-portfolio/weekly-changes/page.tsx'
const ROUTE = 'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts'
const WATERFALL = 'src/components/familyPortfolio/ValueChangeWaterfall.tsx'
const DIVERGING = 'src/components/familyPortfolio/DivergingBarChart.tsx'
const RECON = 'src/components/familyPortfolio/ReconciliationStatus.tsx'
const DATA_HELPER = 'src/lib/data/familyPortfolio.ts'
const PURE_MODULE = 'src/lib/familyPortfolio/weeklyChanges.ts'

const STAGE8_UI_FILES = [PAGE, WATERFALL, DIVERGING, RECON]

/** Strips comments so hygiene regexes cannot be tripped by prose. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const page = read(PAGE)
const route = read(ROUTE)
const waterfall = read(WATERFALL)
const diverging = read(DIVERGING)
const recon = read(RECON)
const wEn = dict.en.fp.weeklyChanges
const wEs = dict.es.fp.weeklyChanges

// ═══════════════════════════════════════════════════════════════════════════
// 1 · § 6h page order — the nine documented sections, in the documented order
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · § 6h page order', () => {
  test('all nine sections render, in the contract order', () => {
    // Each marker is the section's own i18n title reference (or its anchor
    // component for item 1), so the assertion tracks the REAL render order.
    const markers = [
      'WeekSelector', // 1 · header, portfolio selector, week selector
      'w.totalsTitle', // 2 · total-level weekly metrics
      'w.flowReconTitle', // 3 · flow / investment-result reconciliation
      'w.waterfallTitle', // 4 · Drivers of Weekly Portfolio Value Change
      'w.increasesTitle', // 5a · Largest Weekly Value Increases
      'w.decreasesTitle', // 5b · Largest Weekly Value Decreases
      'w.hierarchyTitle', // 6 · Weekly Value Change by Portfolio Hierarchy
      'w.fullTableTitle', // 7 · full changes table
      'w.trendTitle', // 8 · historical weekly-change trend
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
    // One import-free call site: the single effect keyed on (scope, asOf).
    assert.equal(calls.length, 1, 'exactly one fetch call site')
    assert.match(body, /useEffect\(\(\) => \{[\s\S]*?\}, \[activeScope, asOf\]\)/)
    // No component holds its own week: the chart/status components never fetch.
    for (const rel of [WATERFALL, DIVERGING, RECON]) {
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
    assert.equal(wEn.waterfallTitle, 'Drivers of Weekly Portfolio Value Change')
    assert.equal(wEs.waterfallTitle, 'Factores de la Variación de Valor Semanal del Portafolio')
  })

  test('the page tab and hierarchy titles match the contract', () => {
    assert.equal(wEn.title, 'Weekly Changes')
    assert.equal(wEs.title, 'Cambios Semanales')
    assert.equal(wEn.hierarchyTitle, 'Weekly Value Change by Portfolio Hierarchy')
    // The page renders the exact waterfall/hierarchy titles from the dict.
    assert.match(page, /\{w\.waterfallTitle\}/)
    assert.match(page, /\{w\.hierarchyTitle\}/)
    assert.match(page, /\{w\.increasesTitle\}|title=\{w\.increasesTitle\}/)
    assert.match(page, /title=\{w\.decreasesTitle\}/)
  })

  test('Impact on Portfolio Value renders under its own label, never as a return figure', () => {
    assert.match(page, /\{w\.impactOnPortfolio\}/)
    assert.match(diverging, /\{w\.impactOnPortfolio\}/)
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
    for (const fn of ['deriveDrivers(', 'buildWaterfall(', 'rankWeeklyChanges(', 'buildHierarchyLevel(', 'buildFullChangesTable(']) {
      assert.ok(page.includes(fn), `the page must call ${fn} from the pure module`)
    }
    assert.match(page, /from '@\/lib\/familyPortfolio\/weeklyChanges'/)
  })

  test('the chart components never recalculate a financial value', () => {
    // Type-only module imports; no summing, no accumulation, no recomputation.
    assert.match(waterfall, /import type \{[^}]*\} from '@\/lib\/familyPortfolio\/weeklyChanges'/)
    for (const [rel, src] of [
      [WATERFALL, waterfall],
      [DIVERGING, diverging],
      [RECON, recon],
    ] as const) {
      const code = codeOf(src)
      assert.ok(!/\.reduce\(/.test(code), `${rel} must not aggregate values`)
      assert.ok(!/\+=/.test(code), `${rel} must not accumulate values`)
      assert.ok(!/currentValue\s*-\s*previousValue/.test(code), `${rel} must not recompute a change`)
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

  test('the hierarchy chart consumes the module level — parentage is never rebuilt from labels', () => {
    assert.match(page, /buildHierarchyLevel\(nodes, hierarchyDrivers, drillKey\)/)
    assert.ok(!/parent/i.test(codeOf(diverging)), 'DivergingBarChart must hold no parentage model of its own')
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

  test('a scope switch resets the cash toggle and the personal driver view', () => {
    assert.match(page, /setIncludeCash\(false\)/)
    assert.match(page, /setGrouping\('sociedad'\)/)
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
  test('the waterfall replaces the WHOLE chart while masked — before any bar exists', () => {
    const maskGate = waterfall.indexOf('if (masked)')
    const firstBar = waterfall.indexOf('<ul')
    assert.ok(maskGate >= 0 && firstBar >= 0 && maskGate < firstBar,
      'the masked return must precede all bar rendering')
    assert.match(waterfall, /PrivacyValue masked/)
  })

  test('the trend chart mounts only while unmasked — masked renders the privacy block instead', () => {
    const trendBlock = page.slice(page.indexOf('w.trendTitle'))
    const maskGate = trendBlock.indexOf('masked ? (')
    const chart = trendBlock.indexOf('<LineChart')
    assert.ok(maskGate >= 0 && chart >= 0 && maskGate < chart,
      'LineChart must sit in the unmasked arm of the privacy ternary')
    assert.match(trendBlock, /PrivacyValue masked/)
  })

  test('every raw formatUsd call in the page sits in a guarded context', () => {
    for (const line of page.split('\n')) {
      if (!line.includes('formatUsd(')) continue
      assert.ok(
        /formatValue=\{|valueFormatter=\{|value: formatUsd/.test(line),
        `unguarded amount formatter in page: ${line.trim()}`,
      )
    }
    // The two monetary hero minis are bound to the hero's own privacy state.
    assert.match(page, /value: formatUsd\(total\.currentValue\),\s*\n\s*sensitive: total\.currentValue != null/)
    assert.match(page, /value: formatUsd\(total\.previousValue\),\s*\n\s*sensitive: total\.previousValue != null/)
    assert.match(page, /privacyMasked=\{masked\}/)
  })

  test('the chart/status components render amounts only through MaskedAmount', () => {
    for (const [rel, src] of [
      [WATERFALL, waterfall],
      [DIVERGING, diverging],
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

  test('the waterfall card, hierarchy level, flow identity and status section all surface it', () => {
    const uses = page.match(/<ReconciliationStatus/g) ?? []
    assert.ok(uses.length >= 4, 'flow card, waterfall card, hierarchy level, and status section')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 10 · Hierarchy drill-down UI (§ 6g)
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · hierarchy drill-down', () => {
  test('breadcrumbs are a navigation landmark with a current-page marker and a back control', () => {
    assert.match(page, /<nav aria-label=\{w\.breadcrumbLabel\}/)
    assert.match(page, /aria-current="page"/)
    assert.match(page, /\{w\.backUp\}/)
    assert.match(page, /level\.breadcrumb\[level\.breadcrumb\.length - 2\]\.rowKey : null/)
  })

  test('bars extend from a drawn common zero axis — right for positive, left for negative', () => {
    assert.match(diverging, /left: '50%'/)
    assert.match(diverging, /negative \? `\$\{50 - half\}%` : '50%'/)
  })

  test('a drillable bar is a real button; unavailable children carry visible text, not a bar', () => {
    assert.match(diverging, /<button/)
    assert.match(diverging, /aria-label=\{`\$\{w\.drillInto\} \$\{bar\.label\}`\}/)
    assert.match(diverging, /\{w\.statusUnavailable\}/)
    assert.match(diverging, /bar\.available && bar\.value !== null/)
  })

  test('a new (scope, week) request resets the drill position', () => {
    assert.match(page, /setDrillKey\(null\)/)
    assert.match(page, /prevRequestKey !== requestKey/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 11 · Responsive and accessibility structure
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.8 · responsive & accessibility', () => {
  test('layout grids carry responsive prefixes; dense tables scroll inside their card', () => {
    assert.match(page, /grid-cols-1 lg:grid-cols-2/)
    assert.match(page, /grid-cols-1 lg:grid-cols-\[1\.4fr_1fr\]/)
    assert.match(page, /minWidth=\{860\}/)
    assert.match(page, /maxHeight=\{640\}/)
    assert.match(read(PAGE), /minWidth=\{560\}/)
  })

  test('the chart row grids collapse their label column below sm', () => {
    for (const src of [waterfall, diverging]) {
      assert.match(src, /grid-cols-\[minmax\(0,9rem\)_1fr_auto\] sm:grid-cols-\[minmax\(0,13rem\)_1fr_auto\]/)
    }
  })

  test('controls wrap; headings are semantic; charts are real-text lists', () => {
    assert.match(page, /flex-wrap/)
    assert.ok((page.match(/<h2 className="ui-label/g) ?? []).length >= 6)
    assert.match(waterfall, /role="list"/)
    assert.match(diverging, /role="list"/)
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
    assert.match(route, /pair\.code === 'week_not_found' \? 404 : 200/)
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

  test('Stage 9 stays blocked: no Alternatives API, page still a placeholder, no Alternatives import', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/api/family-portfolio/alternatives')),
      'no Stage-9 Alternatives API may exist')
    const alt = read('src/app/family-portfolio/alternatives/page.tsx')
    assert.match(alt, /kind="unavailable"/)
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
    assert.match(page, /\[w\.methodologyLevel, w\.methodologyPair, w\.methodologyImpact, w\.methodologyWaterfall, w\.methodologyCash\]/)
    // Rendered as list items in the flow of section 9 — not inside a title.
    assert.ok(!/title=\{w\.methodology/.test(page))
  })

  test('the methodology covers the documented distinctions in both languages', () => {
    assert.match(wEn.methodologyPair, /immediately preceding published week/)
    assert.match(wEn.methodologyImpact, /^Impact on Portfolio Value/)
    assert.match(wEn.methodologyWaterfall, /not added as bars/)
    assert.match(wEn.methodologyCash, /excluded from the ranked lists by default/)
    assert.match(wEs.methodologyPair, /semana publicada inmediatamente anterior/)
    assert.match(wEs.methodologyWaterfall, /no se agregan como barras/)
  })

  test('EN and ES weeklyChanges dictionaries carry identical key sets', () => {
    assert.deepEqual(Object.keys(wEn).sort(), Object.keys(wEs).sort())
  })

  test('no hardcoded user-facing English strings in the Stage-8 components', () => {
    // Every visible label flows through `t.fp.weeklyChanges` / shared keys;
    // literal JSX text is limited to punctuation and glyphs.
    for (const src of [waterfall, diverging, recon]) {
      assert.ok(!/>\s*[A-Z][a-z]+ [a-z]+/.test(codeOf(src).replace(/className="[^"]*"/g, '')),
        'component JSX must not embed English sentences')
    }
  })
})
