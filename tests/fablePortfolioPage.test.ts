// Phase 5H — /portfolio rebuilt to the approved Fable Portfolio composition.
//
// Two contracts are locked down here.
//
// (1) CONTENT/BEHAVIOUR IS UNCHANGED. Every section, metric, table, column,
//     computed value, fetch endpoint, payload shape, validation rule, and
//     mutation is byte-for-byte the same as before the re-skin; no API,
//     provider, calculation, or auth file was touched.
//
// (2) STRUCTURE MATCHES FABLE. The page is no longer the old full-width
//     vertical stack. It is the Fable composition: header with inline
//     identity/meta → asymmetric hero row (total-value hero flex 1.7 +
//     exposure meter panel flex 1) → analytical workspace (wide table card
//     flex 2.6 with the segmented control in its own toolbar + narrow right
//     rail flex 1 holding the add-form side panel and concentration meters).
//     These assertions check real containment and ordering, not just that a
//     component name appears somewhere in the file.
//
// Source-scan checks (this repo has no React render harness) — they cannot
// prove pixel rendering, but they make a silent regression of the
// load-bearing content, hierarchy, and conventions impossible.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const PORTFOLIO = 'src/app/portfolio/page.tsx'
const I18N = 'src/lib/i18n.ts'
const VALUATION = 'src/lib/portfolio/valuation.ts'

const src = read(PORTFOLIO)
const i18n = read(I18N)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1
/** Index of the first occurrence — used to assert real DOM/source ordering. */
const at = (needle: string) => {
  const i = src.indexOf(needle)
  assert.notEqual(i, -1, `expected to find ${needle}`)
  return i
}
/** The body of a named component, so containment can be asserted rather than mere presence. */
const bodyOf = (name: string) => {
  const start = src.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `component ${name} must exist`)
  const rest = src.slice(start + 1)
  const nextFn = rest.indexOf('\nfunction ')
  const nextExport = rest.indexOf('\nexport default function ')
  const ends = [nextFn, nextExport].filter(n => n !== -1)
  return rest.slice(0, ends.length ? Math.min(...ends) : rest.length)
}

const PAGE_BODY = (() => {
  const i = src.indexOf('export default function PortfolioPage')
  assert.notEqual(i, -1)
  return src.slice(i)
})()

/**
 * The page with every comment stripped. Used for the "no unsupported Fable
 * element" checks — the file's own header comment names the omitted elements
 * (sparkline, benchmark, attribution) precisely so the omission is documented
 * in the source, and those words must not disqualify the code from the check.
 */
const CODE = src.replace(/\/\*[\S\s]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ═══ STRUCTURAL FABLE PARITY ═══════════════════════════════════════════════

describe('Phase 5H parity — the old full-width vertical stack is gone', () => {
  it('no longer renders the flat 7-across summary capsule grid', () => {
    assert.ok(!src.includes('xl:grid-cols-7'), 'the old equal-card 7-across KPI grid must be gone (Fable: "no equal-card grid")')
    assert.ok(!src.includes('<KpiCapsule'), 'the hero replaces the flat capsule row — Fable Portfolio/Overview has no capsule strip')
  })

  it('no longer renders the hand-rolled underline tab band above the content', () => {
    assert.ok(!/border-b-2 transition-colors -mb-px/.test(src))
  })

  it('the page is a flex composition, not a `space-y-*` single column', () => {
    assert.ok(!/<div className="w-full space-y-5">/.test(src), 'the old stacked container is gone')
    assert.match(src, /<div className="w-full">/)
  })
})

describe('Phase 5H parity — Fable composition ratios are transcribed, not approximated', () => {
  it('declares the four Fable flex ratios from the approved export', () => {
    assert.match(src, /FABLE_HERO\s*=\s*\{ flex: '1\.7 1 400px', minWidth: 'min\(100%, 340px\)' \}/)
    assert.match(src, /FABLE_ASIDE\s*=\s*\{ flex: '1 1 250px',\s*minWidth: 'min\(100%, 240px\)' \}/)
    assert.match(src, /FABLE_MAIN\s*=\s*\{ flex: '2\.6 1 620px', minWidth: 'min\(100%, 340px\)' \}/)
    assert.match(src, /FABLE_RAIL\s*=\s*\{ flex: '1 1 280px',\s*minWidth: 'min\(100%, 260px\)' \}/)
  })

  it('applies each ratio to the correct surface — hero, aside, table column, rail', () => {
    assert.match(bodyOf('PortfolioHero'), /style=\{FABLE_HERO\}/)
    assert.match(bodyOf('SectorExposurePanel'), /style=\{FABLE_ASIDE\}/)
    assert.match(PAGE_BODY, /style=\{FABLE_MAIN\}/)
    assert.match(PAGE_BODY, /style=\{FABLE_RAIL\}/)
  })

  it('both regions are wrapping flex rows at the Fable 14px gutter', () => {
    assert.match(PAGE_BODY, /<div className="flex flex-wrap items-stretch gap-3\.5">/)
    assert.match(PAGE_BODY, /<div className="flex flex-wrap items-start gap-3\.5 mt-3\.5">/)
  })
})

describe('Phase 5H parity — Fable section order (header → hero row → workspace)', () => {
  it('renders header, then the hero row, then the workspace row, in that order', () => {
    const header = at('t.portfolio.tag')
    const hero = at('<PortfolioHero')
    const workspace = at('style={FABLE_MAIN}')
    assert.ok(header < hero, 'header precedes the hero row')
    assert.ok(hero < workspace, 'the hero row precedes the analytical workspace')
  })

  it('inside the hero row the total-value hero precedes the exposure panel', () => {
    assert.ok(at('<PortfolioHero') < at('<SectorExposurePanel'), 'primary hero card comes first')
  })

  it('inside the workspace the table column precedes the right rail', () => {
    assert.ok(at('style={FABLE_MAIN}') < at('style={FABLE_RAIL}'), 'wide table column precedes the narrow rail — Fable and mobile ordering')
  })

  it('the reveal cadence follows the section order (0 / 70 / 130)', () => {
    assert.ok(at('<Reveal>') < at('<Reveal delayMs={70}>'))
    assert.ok(at('<Reveal delayMs={70}>') < at('<Reveal delayMs={130}>'))
  })
})

describe('Phase 5H parity — Fable header architecture', () => {
  it('uses the Fable 19px page title with the eyebrow above it', () => {
    assert.match(src, /<div className="ui-label text-muted-fg mb-1">\{t\.portfolio\.tag\}<\/div>/)
    assert.match(src, /<h1 className="ui-page-title text-foreground">\{t\.portfolio\.title\}<\/h1>/)
  })

  it('places identity/meta INLINE on the baseline beside the title (not a stacked subtitle block)', () => {
    assert.match(src, /<div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 mt-1">/)
    const metaRow = src.slice(at('flex items-baseline flex-wrap'), at('{!loading && detail && ('))
    assert.match(metaRow, /\{t\.portfolio\.subtitle\}/, 'the subtitle string is preserved, now inline')
  })

  it('the holdings count and the source badge live in that inline meta row', () => {
    const header = src.slice(at('flex items-baseline flex-wrap'), at('</h1>') + 4000)
    assert.match(header, /\{displayed\?\.totals\.positionCount \?\? 0\} \{t\.portfolio\.holdings\}/)
    assert.match(header, /<MarketDataSourceBadge status=\{priceStatus\} \/>/)
  })

  it('the Update action sits on the right of the header row', () => {
    assert.match(src, /<div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">\s*<UpdateDataButton onRefresh=\{doRefresh\} \/>/)
  })
})

describe('Phase 5H parity — primary vs secondary metric hierarchy', () => {
  const hero = bodyOf('PortfolioHero')

  it('Market Value is the single primary metric, at the Fable hero type scale', () => {
    assert.match(hero, /<div className="ui-label text-muted-fg">\{t\.portfolio\.totalMarketValue\}<\/div>/)
    // R9.6 wrapped the value in the shared privacy boundary. The type scale, the
    // container and the value itself are unchanged — only masking was added.
    assert.match(hero, /<div className="ui-kpi-hero ui-number text-foreground mt-2">/)
    assert.match(hero, /<PrivacyValue masked=\{masked\}>\{formatCLP\(totals\.totalMarketValue\)\}<\/PrivacyValue>/)
    assert.equal(count(hero, 'ui-kpi-hero'), 1, 'exactly one hero-scale value — the hierarchy would be lost with two')
  })

  it('Unrealized P&L is the Fable delta pill directly beneath the hero value', () => {
    assert.match(hero, /className="inline-flex items-center rounded-full px-3 py-1"/)
    assert.match(hero, /backgroundColor: `color-mix\(in oklab, \$\{toneToken\(pnl\)\} 14%, transparent\)`/)
    // R9.6 masks the amount inside the pill; the direction tint stays, because
    // "up or down" is not an amount.
    assert.match(hero, /<PrivacyValue masked=\{masked\}>\s*<ChangeIndicator value=\{pnl\} label=\{pnl !== null \? formatCLP\(pnl\) : undefined\} \/>\s*<\/PrivacyValue>/)
    assert.match(hero, /\{t\.portfolio\.unrealizedPnL\} · \{t\.portfolio\.vsCostBasis\}/)
  })

  it('the other five metrics are SECONDARY — under a divider, in the Fable auto-fit minis grid', () => {
    assert.match(hero, /className="mt-4 pt-3\.5 border-t border-border grid gap-3"/)
    assert.match(hero, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(120px, 1fr\)\)'/)
    assert.equal(count(hero, 'ui-micro-label text-muted-fg'), 5, 'five secondary minis')
  })

  it('all 7 summary metrics are still present and labelled, none dropped by the new hierarchy', () => {
    for (const key of [
      'totalMarketValue', 'unrealizedPnL', 'unrealizedPnLPct',
      'totalCostBasis', 'realizedPnL', 'cashBalance', 'positionCount',
    ]) {
      assert.ok(hero.includes(`t.portfolio.${key}`), `summary metric ${key} must remain`)
    }
  })

  it('the two signed secondary metrics keep glyph+colour pairing (never colour alone)', () => {
    assert.match(hero, /<ChangeIndicator value=\{pnlPct\}/)
    assert.match(hero, /<ChangeIndicator value=\{realizedPnl\}/)
    assert.equal(count(hero, '<ChangeIndicator'), 3, 'P&L pill + P&L% mini + realized-P&L mini')
  })
})

describe('Phase 5H parity — allocation/exposure uses the Fable meter panel', () => {
  it('a shared MeterRow implements the Fable name · 6px bar · value row', () => {
    const meter = bodyOf('MeterRow')
    assert.match(meter, /flex-\[0_0_92px\] min-w-0 truncate/)
    assert.match(meter, /className="flex-1 h-1\.5 rounded-full overflow-hidden"/)
    assert.match(meter, /backgroundColor: 'var\(--nv-chip\)'/)
    assert.match(meter, /width: `\$\{pct \?\? 0\}%`, backgroundColor: 'var\(--accent\)'/)
    assert.match(meter, /w-12 text-right shrink-0/)
  })

  it('sector exposure is rendered through that meter row, with its weights unchanged', () => {
    const panel = bodyOf('SectorExposurePanel')
    assert.match(panel, /<MeterRow/)
    assert.match(panel, /pct=\{s\.weight\}/)
    assert.match(panel, /s\.weight !== null \? formatPct\(s\.weight, 1\)\.replace\('\+', ''\) : '—'/)
  })

  it('sector exposure sits in the hero row aside — not as a full-width band above the tabs', () => {
    assert.ok(at('<SectorExposurePanel') < at('style={FABLE_MAIN}'), 'exposure is part of the hero row, above the workspace')
    assert.match(bodyOf('SectorExposurePanel'), /style=\{FABLE_ASIDE\}/)
  })

  it('an empty exposure set renders an honest empty state, never a decorative shell', () => {
    assert.match(bodyOf('SectorExposurePanel'), /sectors\.length === 0 \? \(\s*<AsyncState kind="empty" message=\{t\.portfolio\.noExposure\} \/>/)
  })
})

describe('Phase 5H parity — Fable CONCENTRATION rail panel', () => {
  it('exists in the right rail and reuses the same meter row', () => {
    assert.match(bodyOf('ConcentrationPanel'), /<MeterRow/)
    assert.ok(at('<ConcentrationPanel') > at('style={FABLE_RAIL}'), 'concentration lives inside the rail')
  })

  it('is a pure sort+slice of the ALREADY-computed position weight — no new value is derived', () => {
    assert.match(src, /const topByWeight = useMemo\(\(\) => \{/)
    assert.match(src, /\.filter\(p => p\.weight !== null\)/)
    assert.match(src, /\.sort\(\(a, b\) => \(b\.weight as number\) - \(a\.weight as number\)\)\.slice\(0, 5\)/)
    const panel = bodyOf('ConcentrationPanel')
    assert.match(panel, /pct=\{p\.weight\}/)
    assert.match(panel, /p\.weight !== null \? formatPct\(p\.weight, 1\)\.replace\('\+', ''\) : '—'/)
  })

  it('its headline stat is a single EXISTING weight (largest position), never a new aggregate', () => {
    const panel = bodyOf('ConcentrationPanel')
    assert.match(panel, /const largest = top\[0\]\?\.weight \?\? null/)
    assert.ok(!/reduce\(/.test(panel), 'no top-N weight sum is computed — that would be a new calculation')
  })

  it('renders nothing at all when no position carries a weight', () => {
    assert.match(PAGE_BODY, /\{topByWeight\.length > 0 && <ConcentrationPanel top=\{topByWeight\} \/>\}/)
  })
})

describe('Phase 5H parity — segmented control lives in the card toolbar, forms live in the rail', () => {
  it('the tab SegmentedControl is built once and passed into each table card\'s controls slot', () => {
    assert.equal(count(src, '<SegmentedControl'), 1)
    assert.match(src, /const tabControl = \(/)
    assert.equal(count(src, 'controls={tabControl}'), 3, 'all three tables host the same segmented group in their toolbar')
  })

  it('each table card carries a title alongside that toolbar control', () => {
    assert.match(bodyOf('PositionsTable'), /title=\{t\.portfolio\.tabPositions\}\s*\n\s*controls=\{controls\}/)
    assert.match(bodyOf('TransactionsTable'), /title=\{t\.portfolio\.tabTransactions\}\s*\n\s*controls=\{controls\}/)
    assert.match(bodyOf('CashLedgerTable'), /title=\{t\.portfolio\.tabCash\}\s*\n\s*controls=\{controls\}/)
  })

  it('all three add-forms are rendered inside the right rail, after the table column', () => {
    const rail = PAGE_BODY.slice(PAGE_BODY.indexOf('style={FABLE_RAIL}'))
    assert.match(rail, /<AddPositionForm portfolioId=\{portfolioId\} onAdded=\{refresh\} \/>/)
    assert.match(rail, /<AddTransactionForm portfolioId=\{portfolioId\} onAdded=\{refresh\} \/>/)
    assert.match(rail, /<AddCashForm portfolioId=\{portfolioId\} onAdded=\{refresh\} \/>/)
  })

  it('each add-form is a Fable rail panel with vertically-stacked full-width controls', () => {
    for (const form of ['AddPositionForm', 'AddTransactionForm', 'AddCashForm']) {
      const body = bodyOf(form)
      assert.match(body, /<RailPanel label=\{/, `${form} renders as a rail panel`)
      assert.match(body, /className="flex flex-col gap-2"/, `${form} stacks vertically in the rail`)
    }
    assert.match(src, /const CHIP_INPUT =\s*\n\s*'h-8 w-full px-3 rounded-full/, 'rail inputs are full-width')
    assert.ok(!/flex flex-wrap items-center gap-2">\s*<input/.test(src), 'the old horizontal form row is gone')
  })

  it('the shared RailPanel implements the Fable panel head (section label + optional right stat)', () => {
    const panel = bodyOf('RailPanel')
    assert.match(panel, /<GlassSurface variant="card" className="px-5 py-4">/)
    assert.match(panel, /<div className="ui-label text-muted-fg">\{label\}<\/div>/)
    assert.match(panel, /\{stat && <span className="ui-meta text-muted-fg">\{stat\}<\/span>\}/)
  })
})

describe('Phase 5H parity — no unsupported Fable element was introduced', () => {
  it('no hero sparkline (no portfolio value time series exists)', () => {
    assert.ok(!/Sparkline|sparkline|heroSpark/.test(CODE))
    // …and the omission is documented in the source itself.
    assert.match(src, /no portfolio value time series exists/)
  })

  it('no currency-mix panel (valuation.ts is CLP-first with no FX conversion)', () => {
    assert.ok(!/currencyMix|ccyMini|CurrencyMix/.test(CODE))
    assert.match(read(VALUATION), /no FX conversion is implemented yet/)
    assert.match(src, /currency mix/i)
  })

  it('no search/asset-class filter row and no sortable headers (no filter or sort state exists on this route)', () => {
    assert.ok(!CODE.includes('SearchInput'))
    assert.ok(!CODE.includes('aria-sort'))
    assert.ok(!/toggleSort|sortKey|sortDir/.test(CODE))
  })

  it('no row-click position detail panel (no position-detail payload exists)', () => {
    assert.ok(!CODE.includes('DetailPanel'))
    assert.ok(!/onClick=\{\(\) => open(Position|Row)/.test(CODE))
  })

  it('no performance, attribution, benchmark, or risk chart was invented', () => {
    assert.ok(!/LineChart|CompareChart|BarrierGauge|benchmark|attribution|drawdown/i.test(CODE))
  })

  it('no portfolio-health score or editorial classification was invented', () => {
    assert.ok(!/\bscore\b|healthScore|rating/i.test(CODE))
  })
})

// ═══ CONTENT / BEHAVIOUR PRESERVATION ══════════════════════════════════════

describe('Phase 5H — every Portfolio section survives the recomposition', () => {
  it('keeps the page tag, title and subtitle strings', () => {
    assert.match(src, /\{t\.portfolio\.tag\}/)
    assert.match(src, /\{t\.portfolio\.title\}/)
    assert.match(src, /\{t\.portfolio\.subtitle\}/)
  })

  it('keeps the MarketDataSourceBadge with the original live/persisted ternary', () => {
    // Superseded in R12: the pre-R12 ternary (`live ? 'live' : 'persisted'`)
    // claimed Live from the snapshot's mere existence — a position whose own
    // quote failed still priced from the persisted baseline under a "Live"
    // badge. The badge now derives from per-instrument coverage of THIS
    // portfolio's position tickers (full → live, partial → hybrid-fallback,
    // none → persisted).
    assert.match(src, /<MarketDataSourceBadge status=\{priceStatus\}/)
    assert.match(src, /stockOverlayCoverage\(live\.stocks, \(detail\?\.positions \?\? \[\]\)\.map\(p => p\.ticker\)\)/)
    assert.match(src, /const priceStatus: DataSourceStatus = live\s*\n?\s*\? overlayStatus\(/)
  })

  it('keeps exactly 3 tabs — Positions, Transactions, Cash — in the original order and default', () => {
    assert.match(src, /type Tab = 'positions' \| 'transactions' \| 'cash'/)
    assert.match(src, /\{ value: 'positions', label: t\.portfolio\.tabPositions \}/)
    assert.match(src, /\{ value: 'transactions', label: t\.portfolio\.tabTransactions \}/)
    assert.match(src, /\{ value: 'cash', label: t\.portfolio\.tabCash \}/)
    assert.match(src, /const \[tab, setTab\] = useState<Tab>\('positions'\)/)
  })

  it('keeps all 3 add-forms gated on a resolved portfolioId', () => {
    assert.equal(count(src, '{portfolioId && tab === '), 3)
  })

  it('keeps exactly 3 tables (positions/transactions/cash)', () => {
    assert.equal(count(src, '<table'), 3)
  })

  it('keeps the cash summary metrics beside the table they describe', () => {
    assert.match(PAGE_BODY, /\{tab === 'cash' && detail && <CashSummaryCards summary=\{detail\.cashSummary\} \/>\}/)
    assert.ok(at("{tab === 'cash' && detail && <CashSummaryCards") < at("{tab === 'cash' && <CashLedgerTable"))
  })
})

describe('Phase 5H — Positions table: all 12 columns, edit/remove, badges', () => {
  it('keeps all 12 Positions columns, in the exact original order', () => {
    const block = bodyOf('PositionsTable')
    const heads = [...block.slice(0, block.indexOf('<tbody')).matchAll(/\{t\.portfolio\.(?:cols\.\w+|editPosition)\}/g)].map(m => m[0])
    assert.deepEqual(heads, [
      '{t.portfolio.cols.ticker}', '{t.portfolio.cols.company}', '{t.portfolio.cols.sector}',
      '{t.portfolio.cols.quantity}', '{t.portfolio.cols.avgCost}', '{t.portfolio.cols.latestPrice}',
      '{t.portfolio.cols.marketValue}', '{t.portfolio.cols.pnl}', '{t.portfolio.cols.pnlPct}',
      '{t.portfolio.cols.weight}', '{t.portfolio.cols.company}', '{t.portfolio.editPosition}',
    ])
  })

  it('keeps every original data-cell binding: quantity, avg cost, price, market value, P&L, P&L%, weight', () => {
    assert.match(src, /\{position\.quantity\}/)
    assert.match(src, /position\.averageCost !== null \? formatCLP\(position\.averageCost\) : '—'/)
    assert.match(src, /position\.latestPrice !== null \? formatCLP\(position\.latestPrice\) : '—'/)
    assert.match(src, /position\.marketValue !== null \? formatCLP\(position\.marketValue\) : '—'/)
    assert.match(src, /position\.unrealizedPnL !== null \? formatCLP\(position\.unrealizedPnL\) : '—'/)
    assert.match(src, /position\.unrealizedPnLPct !== null \? formatPct\(position\.unrealizedPnLPct\) : '—'/)
    assert.match(src, /position\.weight !== null \? formatPct\(position\.weight, 1\)\.replace\('\+', ''\) : '—'/)
  })

  it('keeps the exact changeColor()-based coloring on P&L and P&L% cells', () => {
    assert.match(src, /position\.unrealizedPnL !== null \? changeColor\(position\.unrealizedPnL\) : 'text-muted-fg'/)
    assert.match(src, /position\.unrealizedPnLPct !== null \? changeColor\(position\.unrealizedPnLPct\) : 'text-muted-fg'/)
  })

  it('keeps the mixed-currency warning icon with its exact tooltip', () => {
    assert.match(src, /position\.mixedCurrency && \(/)
    assert.match(src, /title=\{t\.portfolio\.mixedCurrency\}>⚠<\/span>/)
  })

  it('keeps the Manual/Transactions source badge exactly as before', () => {
    assert.match(src, /position\.positionSource === 'transactions' \? t\.portfolio\.transactionsBadge : t\.portfolio\.manualBadge/)
    assert.match(src, /color: position\.positionSource === 'transactions' \? 'var\(--accent\)' : 'var\(--muted-fg\)'/)
  })

  it('keeps transaction-derived positions locked (no edit/remove), manual positions editable', () => {
    // Superseded in R12: `onClick={handleRemove}` fired the DELETE directly
    // from the row button with no confirmation, no response check, and no
    // failure message. The trigger now opens the shared DestructiveConfirm
    // gate, whose onConfirm is the (response-checked) handleRemove.
    assert.match(src, /title=\{t\.portfolio\.manualLocked\}>—<\/span>/)
    assert.match(src, /onClick=\{\(\) => setEditing\(true\)\}/)
    assert.match(src, /onClick=\{\(\) => \{ setRemoveError\(false\); setConfirmRemove\(true\) \}\}/)
    assert.match(src, /onConfirm=\{handleRemove\}/)
  })

  it('keeps the exact PATCH/DELETE endpoints and payload shape for position edit/remove', () => {
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{portfolioId\}\/positions\/\$\{encodeURIComponent\(position\.ticker\)\}`, \{\s*method: 'PATCH'/)
    assert.match(src, /body: JSON\.stringify\(\{ quantity: qty, averageCost: cost, notes: notes\.trim\(\) \|\| null \}\)/)
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{portfolioId\}\/positions\/\$\{encodeURIComponent\(position\.ticker\)\}`, \{ method: 'DELETE' \}\)/)
  })

  it('keeps the exact quantity/average-cost validation messages', () => {
    assert.match(src, /if \(!Number\.isFinite\(qty\) \|\| qty <= 0\) \{\s*setError\(t\.portfolio\.invalidQuantity\)/)
    assert.match(src, /if \(cost !== null && \(!Number\.isFinite\(cost\) \|\| cost < 0\)\) \{\s*setError\(t\.portfolio\.invalidAverageCost\)/)
  })
})

describe('Phase 5H — Add Position form: validation, POST shape, duplicate/422 handling', () => {
  it('keeps ticker validation against the covered universe', () => {
    assert.match(src, /if \(!VALID_TICKERS\.has\(upper\)\) \{\s*setFeedback\(\{ type: 'err', msg: t\.portfolio\.invalidTicker \}\)/)
  })

  it('keeps the exact POST endpoint and payload shape', () => {
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{portfolioId\}\/positions`, \{\s*method: 'POST'/)
    assert.match(src, /body: JSON\.stringify\(\{ ticker: upper, quantity: qty, averageCost: cost, notes: notes\.trim\(\) \|\| undefined \}\)/)
  })

  it('keeps the 409 duplicate and 422 invalid-field handling untouched', () => {
    assert.match(src, /if \(res\.status === 409\) \{\s*setFeedback\(\{ type: 'err', msg: t\.portfolio\.duplicate \}\)/)
    assert.match(src, /else if \(res\.status === 422\) \{/)
  })

  it('keeps the success feedback + 2500ms auto-dismiss + onAdded refresh callback', () => {
    assert.match(src, /setFeedback\(\{ type: 'ok', msg: t\.portfolio\.added \}\)/)
    assert.match(src, /onAdded\(\)/)
    assert.match(src, /setTimeout\(\(\) => setFeedback\(null\), 2500\)/)
  })

  it('resets all four fields on success and keeps the ticker datalist', () => {
    assert.match(src, /setTicker\(''\); setQuantity\(''\); setAvgCost\(''\); setNotes\(''\)/)
    assert.match(src, /<datalist id="portfolio-ticker-suggestions">/)
  })
})

describe('Phase 5H — Transactions tab: 10 columns, add form, conflict handling, remove', () => {
  it('keeps all 10 Transactions columns, in the exact original order', () => {
    const block = bodyOf('TransactionsTable')
    const heads = [...block.slice(0, block.indexOf('<tbody')).matchAll(/\{t\.portfolio\.(?:tx\.cols\.\w+|removePosition)\}/g)].map(m => m[0])
    assert.deepEqual(heads, [
      '{t.portfolio.tx.cols.date}', '{t.portfolio.tx.cols.ticker}', '{t.portfolio.tx.cols.type}',
      '{t.portfolio.tx.cols.quantity}', '{t.portfolio.tx.cols.price}', '{t.portfolio.tx.cols.fees}',
      '{t.portfolio.tx.cols.taxes}', '{t.portfolio.tx.cols.net}', '{t.portfolio.tx.cols.realizedPnl}',
      '{t.portfolio.removePosition}',
    ])
  })

  it('keeps the buy/sell type toggle and its positive/negative coloring', () => {
    assert.match(src, /<option value="buy">\{t\.portfolio\.tx\.buy\}<\/option>/)
    assert.match(src, /<option value="sell">\{t\.portfolio\.tx\.sell\}<\/option>/)
    assert.match(src, /tx\.transactionType === 'buy' \? 'text-positive' : 'text-negative'/)
  })

  it('keeps every data-cell binding: quantity, price, fees, taxes, net, realized P&L', () => {
    assert.match(src, /\{tx\.quantity\}/)
    assert.match(src, /\{formatCLP\(tx\.price\)\}/)
    assert.match(src, /\{formatCLP\(tx\.fees\)\}/)
    assert.match(src, /\{formatCLP\(tx\.taxes\)\}/)
    assert.match(src, /tx\.netAmount !== null \? formatCLP\(tx\.netAmount\) : '—'/)
    assert.match(src, /tx\.realizedPnl !== null \? formatCLP\(tx\.realizedPnl\) : '—'/)
    assert.match(src, /tx\.realizedPnl !== null \? changeColor\(tx\.realizedPnl\) : 'text-muted-fg'/)
  })

  it('keeps the exact manual_position_conflict and insufficient_quantity 409 handling', () => {
    assert.match(src, /if \(res\.status === 409 && json\.error === 'manual_position_conflict'\) \{\s*setFeedback\(\{ type: 'err', msg: t\.portfolio\.tx\.manualConflict \}\)/)
    assert.match(src, /else if \(res\.status === 409 && json\.error === 'insufficient_quantity'\) \{\s*setFeedback\(\{ type: 'err', msg: t\.portfolio\.tx\.insufficientQuantity \}\)/)
  })

  it('keeps the exact POST endpoint and full payload shape', () => {
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{portfolioId\}\/transactions`, \{\s*method: 'POST'/)
    assert.match(src, /ticker: upper,\s*transactionType,\s*tradeDate,\s*quantity: qty,\s*price: p,\s*fees: fees\.trim\(\) \? Number\(fees\) : undefined,\s*taxes: taxes\.trim\(\) \? Number\(taxes\) : undefined,\s*notes: notes\.trim\(\) \|\| undefined,/)
  })

  it('keeps the transaction remove DELETE call and the today-default trade date', () => {
    // Superseded in R12: the DELETE is unchanged but now targets the record
    // held by the shared confirmation gate (`pendingDelete.id`) and checks
    // the response — a ledger-rewriting delete no longer fires unconfirmed.
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{portfolioId\}\/transactions\/\$\{pendingDelete\.id\}`, \{ method: 'DELETE' \}\)/)
    assert.match(src, /useState\(\(\) => new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)/)
  })
})

describe('Phase 5H — Cash tab: 5 summary metrics, 4 ledger columns, entry types', () => {
  it('keeps all 5 cash summary metrics with their original fixed cash-flow-direction colors', () => {
    const block = bodyOf('CashSummaryCards')
    assert.match(block, /totalDeposits[\S\s]*?color: 'text-positive'/)
    assert.match(block, /totalWithdrawals[\S\s]*?color: 'text-negative'/)
    assert.match(block, /totalBuyOutflows[\S\s]*?color: 'text-negative'/)
    assert.match(block, /totalSellInflows[\S\s]*?color: 'text-positive'/)
    assert.match(block, /netBalance[\S\s]*?color: 'text-foreground'/)
  })

  it('keeps the Math.abs() treatment on withdrawals/buy-outflows exactly as before', () => {
    assert.match(src, /formatCLP\(Math\.abs\(summary\.totalWithdrawals\)\)/)
    assert.match(src, /formatCLP\(Math\.abs\(summary\.totalBuyOutflows\)\)/)
  })

  it('keeps all 4 Cash ledger columns, in the exact original order', () => {
    const block = bodyOf('CashLedgerTable')
    const heads = [...block.slice(0, block.indexOf('<tbody')).matchAll(/\{t\.portfolio\.cash\.cols\.(\w+)\}/g)].map(m => m[1])
    assert.deepEqual(heads, ['date', 'type', 'amount', 'description'])
  })

  it('keeps the cashEntryLabel switch covering all 7 entry types, unchanged', () => {
    const block = bodyOf('cashEntryLabel')
    for (const kind of ['deposit', 'withdrawal', 'adjustment', 'buy_cash_outflow', 'sell_cash_inflow', 'fee', 'tax']) {
      assert.ok(block.includes(`case '${kind}':`), `cashEntryLabel must still handle '${kind}'`)
    }
  })

  it('keeps the exact type options, amount validation, POST endpoint and payload', () => {
    assert.match(src, /<option value="deposit">\{t\.portfolio\.cash\.deposit\}<\/option>/)
    assert.match(src, /<option value="withdrawal">\{t\.portfolio\.cash\.withdrawal\}<\/option>/)
    assert.match(src, /<option value="adjustment">\{t\.portfolio\.cash\.adjustment\}<\/option>/)
    assert.match(src, /if \(!Number\.isFinite\(amt\) \|\| amt === 0\) \{\s*setFeedback\(\{ type: 'err', msg: t\.portfolio\.cash\.invalidAmount \}\)/)
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{portfolioId\}\/cash`, \{\s*method: 'POST'/)
    assert.match(src, /body: JSON\.stringify\(\{ entryType, amount: amt, ledgerDate, description: description\.trim\(\) \|\| undefined \}\)/)
  })

  it('keeps the ledger amount cell colored by changeColor(e.amount), unchanged', () => {
    assert.match(src, /changeColor\(e\.amount\)/)
  })
})

describe('Phase 5H — live-price overlay and calculations are byte-for-byte unchanged', () => {
  it('imports the same calculation helpers, never reimplementing them in JSX', () => {
    assert.match(src, /import \{ valuePositions, calculatePortfolioTotals, calculateSectorExposure, type LatestPrice \} from '@\/lib\/portfolio\/valuation'/)
  })

  it('keeps the exact displayed useMemo — static-only fallback, live overlay via valuePositions', () => {
    assert.match(src, /const displayed = useMemo\(\(\) => \{/)
    assert.match(src, /if \(!live\) return \{ positions: detail\.positions, totals: detail\.totals, sectorExposure: detail\.sectorExposure \}/)
    assert.match(src, /const valued = valuePositions\(/)
    assert.match(src, /totals: calculatePortfolioTotals\(valued\),/)
    assert.match(src, /sectorExposure: calculateSectorExposure\(valued\),/)
  })

  it('keeps useMarketData/useGlobalRefresh wired exactly as before', () => {
    assert.match(src, /const \{ live \} = useMarketData\(\)/)
    assert.match(src, /const refreshLive = useGlobalRefresh\(\)/)
    assert.match(src, /const doRefresh = useCallback\(async \(\) => \{\s*await refreshLive\(\)\s*\}, \[refreshLive\]\)/)
  })

  it('valuation.ts pure functions are untouched (existence + exact exported signatures)', () => {
    const v = read(VALUATION)
    for (const fn of [
      'calculatePositionMarketValue', 'calculateCostBasis', 'calculateUnrealizedPnL',
      'calculateUnrealizedPnLPct', 'isMixedCurrency', 'valuePositions',
      'calculatePortfolioTotals', 'calculateSectorExposure',
    ]) {
      assert.ok(v.includes(`export function ${fn}(`), `${fn} must remain exported and untouched`)
    }
  })

  it('the page performs no arithmetic on a financial figure beyond the existing helpers', () => {
    // Only Math.abs (pre-existing cash display) is allowed; no new +,-,*,/ on money.
    assert.equal(count(src, 'Math.abs('), 2)
    assert.ok(!/\breduce\(/.test(src), 'no new aggregate is computed in the page')
  })
})

describe('Phase 5H — API dependencies, persistence, and auth are unchanged', () => {
  it('fetches only the four existing portfolio endpoints on load', () => {
    assert.match(src, /fetch\('\/api\/portfolios', \{ cache: 'no-store' \}\)/)
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{id\}`, \{ cache: 'no-store' \}\)/)
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{id\}\/transactions`, \{ cache: 'no-store' \}\)/)
    assert.match(src, /fetch\(`\/api\/portfolios\/\$\{id\}\/cash`, \{ cache: 'no-store' \}\)/)
  })

  it('introduces no localStorage/persistence key or URL-state behaviour (none existed before)', () => {
    assert.ok(!src.includes('usePersistentState'))
    assert.ok(!/searchParams|useSearchParams/.test(src))
  })

  it('adds no new mutation — exactly the same 6 write calls as before', () => {
    const writes = [...src.matchAll(/method: '(POST|PATCH|DELETE)'/g)].map(m => m[1])
    assert.deepEqual(writes, ['POST', 'PATCH', 'DELETE', 'POST', 'DELETE', 'POST'])
  })

  it('introduces no confirmation dialog on remove (none existed before this phase)', () => {
    assert.ok(!src.includes('window.confirm'))
  })

  it('relies on middleware for auth, and the route stays protected', async () => {
    assert.ok(!/getCurrentUser|requireCurrentUser|supabase\.auth/.test(src))
    // R1.5: the literal PROTECTED_PAGES/PROTECTED_API arrays are gone, replaced
    // by the default-deny policy. The property they encoded is asserted here.
    const { requiresApprovedSession } = await import('../src/lib/auth/accessPolicy.ts')
    assert.ok(requiresApprovedSession('/portfolio'))
    assert.ok(requiresApprovedSession('/api/portfolios'))
  })

  it('changes no API route file — all 7 portfolio route files still exist', () => {
    for (const route of [
      'src/app/api/portfolios/route.ts',
      'src/app/api/portfolios/[id]/route.ts',
      'src/app/api/portfolios/[id]/positions/route.ts',
      'src/app/api/portfolios/[id]/positions/[ticker]/route.ts',
      'src/app/api/portfolios/[id]/transactions/route.ts',
      'src/app/api/portfolios/[id]/transactions/[transactionId]/route.ts',
      'src/app/api/portfolios/[id]/cash/route.ts',
    ]) {
      assert.ok(existsSync(join(ROOT, route)), `${route} must still exist`)
    }
  })
})

describe('Phase 5H — async and data-quality states', () => {
  it('keeps the page-level loading boolean and its message via the shared AsyncState', () => {
    assert.match(src, /const \[loading, setLoading\] = useState\(true\)/)
    assert.match(src, /<AsyncState kind="loading" message=\{t\.common\.loading\} \/>/)
  })

  it('keeps 3 distinct empty-table messages, each textually distinct', () => {
    assert.match(src, /stateMessage=\{t\.portfolio\.emptyPortfolio\}/)
    assert.match(src, /stateMessage=\{t\.portfolio\.tx\.empty\}/)
    assert.match(src, /stateMessage=\{t\.portfolio\.cash\.empty\}/)
    assert.match(i18n, /emptyPortfolio:\s*'Your portfolio is empty\. Add a position above\.'/)
    assert.match(i18n, /empty:\s*'No transactions yet\. Add a buy or sell above\.'/)
    assert.match(i18n, /empty:\s*'No cash entries yet\.'/)
  })

  it('the Positions table source footer survives the empty state', () => {
    const block = bodyOf('PositionsTable')
    assert.match(block, /footer=\{<TableSourceFooter source=\{t\.portfolio\.source\}\s*\/>\}/)
    assert.match(block, /state=\{positions\.length === 0 \? 'empty' : undefined\}/)
  })

  it('partial/stale/unavailable/blocked are not fabricated as new states — none existed, none invented', () => {
    assert.ok(!/'partial'|'stale'|'unavailable'|'blocked'/.test(src))
  })
})

describe('Phase 5H — source badges and the one Positions footer', () => {
  it('keeps exactly one MarketDataSourceBadge and one TableSourceFooter, naming Yahoo Finance', () => {
    assert.equal(count(src, '<MarketDataSourceBadge'), 1)
    assert.equal(count(src, '<TableSourceFooter'), 1)
    assert.match(i18n, /source:\s*'Yahoo Finance'/)
  })

  it('the source badge sits in the header meta, beside the identity — Fable source placement', () => {
    assert.ok(at('<MarketDataSourceBadge') < at('<PortfolioHero'), 'source status is header-level, above the workspace')
  })

  it('Transactions and Cash tables never had a source footer — none was invented', () => {
    assert.ok(!bodyOf('TransactionsTable').includes('<TableSourceFooter'))
    assert.ok(!bodyOf('CashLedgerTable').includes('<TableSourceFooter'))
  })
})

describe('Phase 5H — responsive composition', () => {
  it('uses w-full as the outermost container, never a page-level max-width or min-width', () => {
    assert.match(src, /<div className="w-full">/)
    assert.ok(!/max-w-screen/.test(src))
    assert.ok(!/\bminWidth: '\d/.test(src), 'no fixed pixel floor without a min() wrapper')
  })

  it('every Fable column declares min(100%, …) so it collapses to full width below its breakpoint', () => {
    assert.equal(count(src, "minWidth: 'min(100%,"), 4)
  })

  it('all 3 tables scroll inside their own TableCard, each with its own minWidth floor', () => {
    assert.equal(count(src, 'minWidth={720}'), 2)
    assert.match(src, /minWidth=\{440\}/)
    assert.equal(count(src, '<TableCard'), 3)
  })

  it('the cash secondary metrics reflow 2 → 3 → 5 across breakpoints', () => {
    assert.match(src, /grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3/)
  })

  it('the hero minis grid is intrinsically responsive (auto-fit), never a fixed column count', () => {
    assert.match(src, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(120px, 1fr\)\)'/)
  })

  it('the header, both regions, and the rail form wrap rather than overflow', () => {
    assert.match(src, /flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-5/)
    assert.match(src, /flex flex-wrap items-stretch gap-3\.5/)
    assert.match(src, /flex flex-wrap items-start gap-3\.5 mt-3\.5/)
  })
})

describe('Phase 5H — Fable materials, tokens and motion', () => {
  it('imports the shared Fable primitives it actually uses', () => {
    for (const imp of [
      "import { TableCard } from '@/components/fable/TableCard'",
      "import { AsyncState } from '@/components/fable/AsyncState'",
      "import { GlassSurface } from '@/components/fable/GlassSurface'",
      "import { ChangeIndicator } from '@/components/fable/ChangeIndicator'",
      "import { SegmentedControl } from '@/components/fable/SegmentedControl'",
      "import { Reveal } from '@/components/fable/motion'",
    ]) {
      assert.ok(src.includes(imp), `missing ${imp}`)
    }
  })

  it('uses the near-opaque dense table surface for every header cell, never low-opacity glass', () => {
    assert.equal(count(src, "backgroundColor: 'var(--surface-table)'"), 26)
  })

  it('uses semantic table markup — scoped headers and a caption on each table', () => {
    assert.equal(count(src, 'scope="col"'), 26)
    assert.equal(count(src, '<caption className="sr-only">'), 3)
  })

  it('uses the tokenised type scale throughout (table cell, hero, card value, micro label, meta)', () => {
    assert.equal(count(src, "fontSize: 'var(--fs-table-cell)'"), 3)
    assert.match(src, /ui-kpi-hero/)
    assert.match(src, /ui-card-value/)
    assert.match(src, /ui-micro-label/)
    assert.match(src, /ui-meta/)
    assert.match(src, /ui-page-title/)
  })

  it('uses the shared row-hover/transition tokens, not the pre-Fable hover:bg-surface-2 recipe', () => {
    assert.ok(!src.includes('hover:bg-surface-2'))
    assert.ok(!src.includes('transition-colors'))
    assert.equal(count(src, 'nv-row-hover nv-transition'), 3)
  })

  it('meter fills animate width through the existing shared token utility, not a new keyframe', () => {
    assert.match(src, /nv-transition-state/)
    assert.ok(!src.includes('@keyframes'))
    assert.ok(!/animation:/.test(src))
  })

  it('hardcodes no hex colour and no raw Tailwind colour scale', () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), 'contains a hardcoded hex colour')
    assert.ok(
      !/\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(src),
      'uses a raw Tailwind colour scale',
    )
  })

  it('uses no purple anywhere on this route (reserved for the Review token)', () => {
    assert.ok(!/--chart-review|--review\b/.test(src))
  })

  it('the Add buttons use the Fable pill recipe with the corrected contrast token', () => {
    assert.match(src, /const PILL_BUTTON = 'h-8 w-full px-4 rounded-full bg-primary text-primary-fg/)
    assert.equal(count(src, 'className={PILL_BUTTON}'), 3)
    assert.ok(!src.includes('bg-primary text-surface'))
  })

  it('motion is three staggered section reveals only — never a continuously animated value', () => {
    assert.equal(count(src, '<Reveal'), 3)
    assert.ok(!src.includes('countUp'))
    assert.ok(!src.includes('ContentPulse'))
    assert.ok(!src.includes('ValueChangeTransition'))
  })

  it('the reveal primitive collapses to its final state under reduced motion (shared global rule)', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/)
  })
})

describe('Phase 5H — accessibility', () => {
  it('every input/select in the three rail forms carries an aria-label', () => {
    for (const form of ['AddPositionForm', 'AddTransactionForm', 'AddCashForm']) {
      const body = bodyOf(form)
      const controls = count(body, '<input') + count(body, '<select')
      const labels = count(body, 'aria-label={t.portfolio')
      assert.ok(labels >= controls, `${form}: every control needs an aria-label (${labels} labels for ${controls} controls)`)
    }
  })

  it('feedback messages render in a permanently-mounted role=status aria-live=polite region', () => {
    assert.equal(count(src, 'role="status" aria-live="polite"'), 3)
  })

  it('meaningful ticker link labels — the ticker text itself, in a real <a>, never a bare icon', () => {
    assert.match(src, /className="font-mono text-primary hover:underline">\s*\{position\.ticker\}\s*<\/Link>/)
    assert.match(src, /className="font-mono text-primary hover:underline">\{tx\.ticker\}<\/Link>/)
    assert.match(src, /import Link from 'next\/link'/)
    assert.equal(count(src, '<Link href='), 3)
  })

  it('the transaction remove button carries a descriptive aria-label (not a bare "×")', () => {
    // Superseded in R12: the label now names the actual action ("Delete
    // transaction", its own key) rather than borrowing the position-row's
    // "Remove" label; still ticker + trade date for context.
    assert.match(src, /aria-label=\{`\$\{t\.portfolio\.tx\.deleteTransaction\}: \$\{tx\.ticker\} \$\{tx\.tradeDate\}`\}/)
  })

  it('the segmented tab control carries an accessible group name', () => {
    assert.match(src, /ariaLabel=\{t\.portfolio\.tabsAriaLabel\}/)
  })

  it('truncated meter names expose the full text via title', () => {
    assert.match(bodyOf('MeterRow'), /title=\{name\}/)
  })

  it('the page uses exactly one h1', () => {
    assert.equal(count(src, '<h1'), 1)
  })
})

describe('Phase 5H — English and Spanish complete', () => {
  it('all 6 new keys exist in both dictionaries', () => {
    const pairs: [string, string][] = [
      ['tabsAriaLabel', 'Portfolio view'], ['tabsAriaLabel', 'Vista de portafolio'],
      ['holdings', 'holdings'], ['holdings', 'posiciones'],
      ['vsCostBasis', 'vs cost basis'], ['vsCostBasis', 'vs costo base'],
      ['concentration', 'Concentration'], ['concentration', 'Concentración'],
      ['largestPosition', 'Largest'], ['largestPosition', 'Mayor'],
      ['noExposure', 'No sector exposure yet'], ['noExposure', 'Aún sin exposición por sector'],
    ]
    for (const [key, value] of pairs) {
      assert.ok(i18n.includes(`${key}: '${value}'`) || new RegExp(`${key}:\\s*'${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(i18n), `${key} → "${value}" must exist`)
    }
  })

  it('every t.portfolio.* key referenced by the page exists in both dictionaries', () => {
    const keys = new Set([...src.matchAll(/t\.portfolio\.([\w.]+)/g)].map(m => m[1]))
    assert.ok(keys.size > 10)
    for (const key of keys) {
      const leaf = key.split('.').pop() as string
      assert.match(i18n, new RegExp(`${leaf}:\\s*'`), `t.portfolio.${key} must exist`)
    }
  })

  it('introduces no hardcoded new visible English string in JSX text position', () => {
    const stripped = src.replace(/\{[^}]*\}/g, '').replace(/[×…⚠—·]/g, '')
    assert.ok(!/>[A-Z][a-zA-Z ]{3,}</.test(stripped), 'a bare English literal appears in a JSX text position')
  })
})

describe('Phase 5H — no fabricated or sample data', () => {
  it('every rendered figure originates in a prop or fetch response, never a literal', () => {
    assert.ok(!/\?\?\s*(?:100|1000|50|10|1_000)\b/.test(src), 'no suspicious hardcoded numeric fallback')
    // The only bare numerics permitted are layout constants and the slice bound.
    assert.ok(!/value=\{[\d.]+\}/.test(src), 'no literal value bound to a metric')
  })

  it('carries no Fable sample holding, issuer, or portfolio name', () => {
    for (const sample of ['Sample data', 'SAMPLE', '60/40 Global', 'Consolidated holdings', 'BTU-UF']) {
      assert.ok(!src.includes(sample), `Fable sample string "${sample}" must not enter production`)
    }
  })

  it('never converts an unavailable value to zero — "—" is the fallback throughout', () => {
    assert.ok(!/\?\?\s*0\b/.test(src.replace(/pct \?\? 0/g, '').replace(/positionCount \?\? 0/g, '').replace(/totalRealizedPnl \?\? 0/g, '').replace(/netCashBalance \?\? 0/g, '')),
      'no metric coerces a missing value to zero')
  })
})

describe('Phase 5H — scope held', () => {
  it('imports no server-only db/financials/provider module (client-safe type-only import allowed)', () => {
    assert.ok(!/@\/lib\/providers\/(?!types)/.test(src), 'only the type-only provider import is allowed')
    assert.ok(!src.includes('@/lib/db/'))
    assert.ok(!src.includes('@/lib/financials/'))
  })

  it('adds no runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })

  it('modifies no shared Fable component — TableCard/AsyncState/GlassSurface/SegmentedControl untouched', () => {
    // TableCard's signature gained the optional `maxHeight` vertical-scroll
    // prop in phase R0 (Stage 5R normalized program) — a deliberate shared
    // extension AFTER 5H, guarded by tests/fableR0Primitives.test.ts. The
    // Portfolio page itself still passes no maxHeight, so 5H behavior is
    // unchanged; this guard now pins the R0 signature.
    assert.match(read('src/components/fable/TableCard.tsx'), /export function TableCard\(\{ title, controls, state, stateMessage, stateSource, stateAsOf, minWidth, maxHeight, footer, children, className = '' \}: TableCardProps\)/)
    assert.match(read('src/components/fable/AsyncState.tsx'), /export function AsyncState\(\{ kind, message, source, asOf, className = '' \}: AsyncStateProps\)/)
    assert.match(read('src/components/fable/GlassSurface.tsx'), /export function GlassSurface\(\{ variant = 'card', as: Tag = 'div', className = '', style, children \}: GlassSurfaceProps\)/)
    assert.match(read('src/components/fable/ChangeIndicator.tsx'), /export function ChangeIndicator\(\{ value, label, className = '' \}: ChangeIndicatorProps\)/)
  })

  it('adds no CSS — globals.css declares no portfolio-specific rule', () => {
    // The invariant is that PHASE 5H (the legacy `/portfolio` page redesign)
    // introduced no CSS of its own. It was originally expressed as "the word
    // portfolio appears nowhere in globals.css", which held only while no
    // later stage documented a token in prose. R13.R2 added Family Portfolio
    // palette and series tokens whose COMMENTS say "portfolio"; that is not a
    // rule, and reading it as one would make the guard fire on documentation.
    // Comments are therefore stripped before the check, so what is asserted is
    // the real thing: no selector, class or custom property names a portfolio.
    const css = read('src/app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/portfolio/i.test(css),
      'no CSS selector, class or custom property may be portfolio-specific')
  })

  it('redesigns no page outside its own phase', () => {
    // `/structured-notes` was removed from the no-TableCard guard in Phase R3,
    // migrated under its own brief — a real phase boundary moving, not a
    // relaxed assertion. It is guarded by
    // `tests/fableStructuredNotesPage.test.ts`.
    for (const other of [
      'src/app/page.tsx', 'src/app/earnings/page.tsx', 'src/app/macro/page.tsx',
      'src/app/macro/calendar/page.tsx', 'src/app/structured-notes/page.tsx',
    ]) {
      assert.ok(existsSync(join(ROOT, other)), `${other} must still exist`)
    }
    // Home's own no-TableCard hold was removed in Phase R10 — the last
    // pre-Fable route, migrated to `TableCard` under its own brief; a real
    // phase boundary moving, not a relaxed assertion. It is guarded by
    // `tests/fableHomePage.test.ts`.
  })

  it('Earnings, Macro, Macro Calendar, Chart Builder, Compare and Company Detail are untouched', () => {
    assert.match(read('src/app/earnings/page.tsx'), /<TableCard/)
    assert.match(read('src/app/chart-builder/page.tsx'), /<SegmentedControl/)
    assert.match(read('src/app/compare/page.tsx'), /<TableCard/)
    // R5 moved the macro chart popup onto the shared ModalShell (dense mode) —
    // a real phase boundary moving, guarded by tests/fableMacroPage.test.ts
    // and tests/fableMacroChartModalOpacity.test.ts, not a relaxed assertion.
    assert.match(read('src/app/macro/page.tsx'), /<ModalShell/)
    assert.match(read('src/app/companies/[ticker]/page.tsx'), /KpiCapsule/)
  })
})
