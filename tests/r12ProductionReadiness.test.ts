// R12 — final production-readiness audit: contracts for every source repair.
//
// Behavioral where the repair is pure logic (liveOverlay coverage/coherence,
// dashboard KPI counts); structural source checks where the contract lives in
// page wiring (the repo's established pattern for page-level contracts).
//
// Run: npm test

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildStocks, buildIndices,
  stockOverlayCoverage, sectorOverlayCoverage, indexOverlayCoverage, overlayStatus,
  type YFQuote, type StaticIndex,
} from '../src/lib/market/liveOverlay.ts'
import { buildBookDashboard } from '../src/lib/structuredNotes/dashboard.ts'
import type { StructuredNote } from '../src/lib/structuredNotes/types.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ─── 1 · Per-instrument live gating — pure contract ──────────────────────────

describe('R12 · liveOverlay — coherent-row policy for stocks', () => {
  test('a quote missing its day change is FAILED, never a live 0.00%', () => {
    const quotes: YFQuote[] = [
      { symbol: 'SQM-B.SN', regularMarketPrice: 50000 }, // no change% → failed
      { symbol: 'CHILE.SN', regularMarketPrice: 190, regularMarketChangePercent: 1.2 },
    ]
    const { stocks, succeeded, failed } = buildStocks(quotes)
    assert.equal(stocks['SQM-B'], undefined, 'price-only quote must not produce a live row')
    assert.ok(stocks['CHILE'], 'complete quote overlays normally')
    assert.equal(succeeded, 1)
    assert.equal(failed, 24, 'the price-only quote counts among the failures')
  })

  test('a genuinely flat day (explicit 0 change) still overlays', () => {
    const { stocks } = buildStocks([
      { symbol: 'CHILE.SN', regularMarketPrice: 190, regularMarketChangePercent: 0 },
    ])
    assert.equal(stocks['CHILE']?.dayChangePct, 0)
  })
})

describe('R12 · liveOverlay — coherent-row policy + source flag for indices', () => {
  const base: StaticIndex[] = [
    { id: 'ipsa', value: 8000, dayChangePct: 0.5, ytdChangePct: 8.2 },
    { id: 'sp500', value: 6000, dayChangePct: -0.2, ytdChangePct: 9.3 },
  ]

  test('a complete quote overlays and is flagged source: live', () => {
    const out = buildIndices([{ symbol: '^GSPC', regularMarketPrice: 6100, regularMarketChangePercent: 0.4 }], base)
    const sp = out.find(i => i.id === 'sp500')!
    assert.equal(sp.source, 'live')
    assert.equal(sp.value, 6100)
  })

  test('a failed or price-only quote passes the committed row through as one coherent base unit', () => {
    const out = buildIndices([{ symbol: '^IPSA', regularMarketPrice: 8100 }], base) // no change% → hybrid banned
    const ipsa = out.find(i => i.id === 'ipsa')!
    assert.equal(ipsa.source, 'base')
    assert.equal(ipsa.value, 8000, 'the committed value stays — no fresh-price/stale-return hybrid row')
    assert.equal(ipsa.dayChangePct, 0.5)
    assert.equal(ipsa.ytdChangePct, 8.2)
    const sp = out.find(i => i.id === 'sp500')!
    assert.equal(sp.source, 'base', 'an absent quote is also a base row')
  })

  test('a zero/negative price is rejected as incoherent', () => {
    const out = buildIndices([{ symbol: '^GSPC', regularMarketPrice: 0, regularMarketChangePercent: 1 }], base)
    assert.equal(out.find(i => i.id === 'sp500')!.source, 'base')
  })
})

describe('R12 · liveOverlay — coverage helpers drive the module badge', () => {
  const stocks = { 'SQM-B': { price: 1, dayChangePct: 0, marketCapCLP: null }, 'CHILE': { price: 2, dayChangePct: 1, marketCapCLP: null } }

  test('stockOverlayCoverage: full / partial / none over the DISPLAYED tickers', () => {
    assert.equal(stockOverlayCoverage(stocks, ['SQM-B', 'CHILE']), 'full')
    assert.equal(stockOverlayCoverage(stocks, ['SQM-B', 'COPEC']), 'partial')
    assert.equal(stockOverlayCoverage(stocks, ['COPEC']), 'none')
    assert.equal(stockOverlayCoverage(stocks, []), 'none')
    assert.equal(stockOverlayCoverage(undefined, ['SQM-B']), 'none')
  })

  test('one successful symbol cannot make another failed symbol read as live', () => {
    // The exact defect class: 24/25 succeeded — the module may not claim Live.
    assert.equal(overlayStatus(stockOverlayCoverage(stocks, ['SQM-B', 'COPEC']), 'persisted'), 'hybrid-fallback')
  })

  test('overlayStatus: full → live, partial → hybrid-fallback, none → the fallback word', () => {
    assert.equal(overlayStatus('full', 'persisted'), 'live')
    assert.equal(overlayStatus('partial', 'static'), 'hybrid-fallback')
    assert.equal(overlayStatus('none', 'persisted'), 'persisted')
    assert.equal(overlayStatus('none', 'static'), 'static')
  })

  test('sector coverage spans the full member lists, index coverage reads the source flags', () => {
    assert.equal(sectorOverlayCoverage(stocks, [{ sector: 'Mining / Lithium' }]), 'partial') // SQM-B live, CAP not
    assert.equal(indexOverlayCoverage([{ source: 'live' }, { source: 'base' }]), 'partial')
    assert.equal(indexOverlayCoverage([{ source: 'live' }]), 'full')
    assert.equal(indexOverlayCoverage([{ source: 'base' }]), 'none')
    assert.equal(indexOverlayCoverage([]), 'none')
  })
})

describe('R12 · per-instrument gating wired into every snapshot consumer', () => {
  test('Home derives watchlist/sector/index/portfolio badges from coverage, not snapshot presence', () => {
    const src = read('src/app/page.tsx')
    assert.match(src, /stockOverlayCoverage\(live\?\.stocks, watchlistTickers\)/)
    assert.match(src, /sectorOverlayCoverage\(live\?\.stocks, staticSectors\)/)
    assert.match(src, /indexOverlayCoverage\(live\?\.indices\)/)
    assert.match(src, /stockOverlayCoverage\(live\.stocks, \(pfDetail\?\.positions \?\? \[\]\)\.map\(p => p\.ticker\)\)/)
    // A base index row must not shadow a fresher persisted snapshot.
    assert.match(src, /if \(lv && lv\.source === 'live'\)/)
  })

  test('Portfolio and Stocks derive their badge from their own displayed tickers', () => {
    assert.match(read('src/app/portfolio/page.tsx'), /stockOverlayCoverage\(live\.stocks, \(detail\?\.positions \?\? \[\]\)\.map\(p => p\.ticker\)\)/)
    assert.match(read('src/app/stocks/page.tsx'), /stockOverlayCoverage\(live\?\.stocks, rows\.map\(r => r\.c\.ticker\)\)/)
  })

  test('the Company page keeps its per-ticker gate (R11) — unchanged', () => {
    assert.match(read('src/app/companies/[ticker]/page.tsx'), /const priceStatus: DataSourceStatus = lv \? 'live'/)
  })
})

// ─── 2 · Privacy — the Nevada notional never renders raw ─────────────────────

describe('R12 · SN exposure cards route every amount through PrivacyValue', () => {
  const LIST = read('src/app/structured-notes/page.tsx')
  const DETAIL = read('src/app/structured-notes/[id]/page.tsx')

  test('ExposureHeader, BarChart and Donut all take and honor `masked`', () => {
    assert.match(LIST, /function ExposureHeader\(\{ title, totalLabel, currency, total, masked \}/)
    assert.match(LIST, /function BarChart\(\{ data, currency, ofTotal, masked \}/)
    assert.match(LIST, /function Donut\(\{ data, currency, ofTotal, totalLabel, masked \}/)
    // All six call sites pass it.
    assert.equal((LIST.match(/masked=\{masked\}/g) ?? []).length >= 7, true, 'capsule + 3 headers + 2 bars + donut (and the per-note cell) all masked')
  })

  test('the donut center exposes no raw title while masked', () => {
    assert.match(LIST, /title=\{masked \? undefined : `\$\{currency\} \$\{fmtNum\(total\)\}`\}/)
  })

  test('the detail allocation summary masks the Nevada investment dd', () => {
    assert.match(DETAIL, /<PrivacyValue masked=\{masked\}>\{`\$\{nevadaInvestmentCurrency\(n\.allocations\) \?\? n\.currency\} \$\{fmtNum\(nevadaInvestment\)\}`\}<\/PrivacyValue>/)
  })

  test('neither delete confirmation embeds the notional in its description', () => {
    assert.ok(!/description=\{[^}]*nevadaInvestment/s.test(LIST.slice(LIST.indexOf('DestructiveConfirm'))), 'list delete dialog carries no amount')
    assert.ok(!DETAIL.includes('`${t.sn.nevadaInvestment}: ${nevadaInvestmentCurrency'), 'detail delete dialog carries no amount')
  })

  test('populated per-entity allocation inputs hide behind a reveal action while masked', () => {
    assert.match(DETAIL, /const hidden = masked && !revealed && value > 0/)
    assert.match(DETAIL, /title=\{t\.sn\.revealToEdit\}/)
    // Re-enabling Privacy Mode re-hides every row.
    assert.match(DETAIL, /if \(masked !== prevMasked\) \{ setPrevMasked\(masked\); setRevealed\(false\) \}/)
  })
})

// ─── 3 · SN dashboard KPI counts describe the live book ──────────────────────

describe('R12 · archived notes are excluded from the status KPI counts', () => {
  function note(over: Partial<StructuredNote> = {}): StructuredNote {
    return {
      isin: 'XS0000000001', productName: 'Note', issuerName: 'Citi', issuerDisplayName: 'Citi',
      guarantorName: null, structureType: 'worst_of_autocall', payoffType: null, currency: 'USD',
      issueSize: 1000000, denomination: 1000, issuePricePct: 1,
      tradeDate: '2026-06-04', issueDate: '2026-06-11', initialValuationDate: '2026-06-04',
      finalValuationDate: '2028-06-05', maturityDate: '2028-06-12', redemptionDate: '2028-06-12',
      couponFrequency: 'quarterly', couponRatePeriodic: 0.025, couponRateAnnualized: 0.1,
      memoryCoupon: true, principalProtection: false,
      knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1,
      status: 'active', sourceType: 'pdf_extraction', sourceName: null, sourceFileName: null, confidenceScore: 1, archivedAt: null,
      underlyings: [
        { underlyingOrder: 1, underlyingName: 'SPX Index', sourceTicker: 'SPX Index', bloombergTicker: 'SPX Index', yahooSymbol: '^GSPC', assetClass: 'index', initialLevel: 7576, strikeLevel: 7576, knockInBarrierLevel: 4924.4, couponBarrierLevel: 4924.4, autocallBarrierLevel: 7576, knockInBarrierPct: 0.65, couponBarrierPct: 0.65, autocallBarrierPct: 1 },
      ],
      observations: [],
      allocations: [{ entityName: 'WATERMILL', custodian: 'Santander', notionalAmount: 1000000, currency: 'USD', active: true }],
      ...over,
    }
  }

  test('an autocalled note does not inflate the Autocallable KPI', () => {
    // Both notes at/above the autocall barrier — but one is already called.
    const prices = new Map([['^GSPC', 7576]])
    const { summary } = buildBookDashboard(
      [note({ isin: 'A' }), note({ isin: 'B', status: 'autocalled' })],
      prices, null, '2027-01-01',
    )
    assert.equal(summary.autocallableNotes, 1, 'only the live note counts — the called one has its own KPI')
    assert.equal(summary.calledNotes, 1)
  })

  test('a matured note does not count as Unavailable', () => {
    const { summary } = buildBookDashboard(
      [note({ isin: 'A', status: 'matured' })],
      new Map(), null, '2027-01-01',
    )
    assert.equal(summary.unavailableNotes, 0)
    assert.equal(summary.calledNotes, 1)
  })
})

// ─── 4 · Error honesty — no raw backend text, no error-as-empty ──────────────

describe('R12 · SN extract/import never ship raw backend detail', () => {
  test('the extract route no longer interpolates the exception message', () => {
    const src = read('src/app/api/structured-notes/extract/route.ts')
    assert.ok(!src.includes('e.message'), 'the parser exception message stays on the server')
    assert.match(src, /\{ error: 'extraction_failed', reviewState: 'unsupported' \}/)
  })

  test('the import route no longer echoes the sanitized Postgres text', () => {
    const src = read('src/app/api/structured-notes/import/route.ts')
    assert.ok(!src.includes('detail: result.error'))
  })

  test('the client maps error CODES to localized copy and never renders `detail`', () => {
    const src = read('src/app/structured-notes/page.tsx')
    assert.ok(!src.includes('json.detail'), 'no response detail reaches the UI')
    assert.match(src, /unsupported_type: t\.sn\.onlyPdf/)
    assert.match(src, /no_text_layer: t\.sn\.scannedPdf/)
  })
})

describe('R12 · failed loads reach explicit error states, never confirmed-empty', () => {
  test('SN dashboard: load() and the mount fetch both check res.ok', () => {
    const src = read('src/app/structured-notes/page.tsx')
    assert.equal((src.match(/if \(!res\.ok\) \{ (setNotes\(\[\]\); )?setLoadFailed\(true\); return \}/g) ?? []).length, 2)
  })

  test('SN detail: a non-404 error body never becomes page data', () => {
    const src = read('src/app/structured-notes/[id]/page.tsx')
    assert.match(src, /if \(!res\.ok\) \{ setLoadFailed\(true\); return \}/)
    assert.match(src, /json\?\.note/)
  })

  test('Portfolio: all three detail calls flag loadError on failure, and loadDetail never rejects', () => {
    const src = read('src/app/portfolio/page.tsx')
    assert.equal((src.match(/\} else anyFailed = true/g) ?? []).length, 3)
    assert.match(src, /if \(anyFailed && !cancelled\.value\) setLoadError\(true\)/)
  })

  test('Home watchlist card: only a 401 means signed-out; other failures render an error row', () => {
    const src = read('src/app/page.tsx')
    assert.match(src, /if \(res\.status === 401\) setWatchlistAuthed\(false\); else setWatchlistError\(true\)/)
    assert.match(src, /\{watchlistError \? \(/)
  })

  test('Home news: a failed fetch reaches an explicit unavailable state, not eternal loading', () => {
    const src = read('src/app/page.tsx')
    assert.match(src, /else setNewsFailed\(true\)/)
    assert.match(src, /\{!newsResult && newsFailed && <AsyncState kind="error" \/>\}/)
  })

  test('Company valuation: a resolved null (route 200 + data:null) is a failure, not loading', () => {
    const src = read('src/app/companies/[ticker]/page.tsx')
    assert.match(src, /if \(res\) \{ setValuation\(res\); setValuationFailed\(false\) \}\s*\n\s*else setValuationFailed\(true\)/)
  })
})

// ─── 5 · Dialog contracts ────────────────────────────────────────────────────

describe('R12 · CommandPalette carries the full modal focus contract', () => {
  const src = read('src/components/ui/CommandPalette.tsx')

  test('Tab/Shift+Tab are contained inside the open palette', () => {
    assert.match(src, /if \(e\.key !== 'Tab'/)
    assert.match(src, /e\.shiftKey && document\.activeElement === first/)
  })

  test('focus is captured on open and restored on close', () => {
    assert.match(src, /triggerRef\.current = document\.activeElement/)
    assert.match(src, /wasOpenRef\.current && !open/)
  })
})

describe('R12 · Chart Builder settings dialog is the shared ModalShell', () => {
  const src = read('src/app/chart-builder/page.tsx')

  test('the hand-rolled dialog markup is gone', () => {
    assert.ok(!src.includes('role="dialog"'), 'no page-local dialog role — ModalShell owns it')
    assert.match(src, /<ModalShell\s*\n?\s*open=\{settingsOpen\}/)
  })

  test('the comparison ticker (B) disclosure names its actual source next to each footer', () => {
    assert.match(src, /const sourceB = overlay \? \(sourceStatusB === 'persisted' \? persistedB!\.source : t\.common\.staticSample\) : null/)
    assert.equal((src.match(/\{tickerB\}: \{sourceB\}/g) ?? []).length, 2, 'both the chart and table footers disclose B')
  })
})

describe('R12 · Portfolio destructive actions go through DestructiveConfirm', () => {
  const src = read('src/app/portfolio/page.tsx')

  test('both the position remove and the transaction delete are gated', () => {
    assert.equal((src.match(/<DestructiveConfirm/g) ?? []).length, 2)
    assert.match(src, /from '@\/components\/fable\/ModalShell'/)
  })

  test('both handlers check the response and surface a localized failure', () => {
    assert.match(src, /if \(!res\.ok\) \{ setRemoveError\(true\); return \}/)
    assert.match(src, /if \(!res\.ok\) \{ setDeleteError\(true\); return \}/)
    assert.match(src, /\{t\.portfolio\.removeError\}/)
  })

  test('neither confirmation description contains an amount', () => {
    assert.match(src, /description=\{`\$\{position\.ticker\} — \$\{position\.companyName\}`\}/)
    assert.ok(!/description=\{[^}]*formatCLP/s.test(src), 'no formatted amount in any dialog description')
  })
})

// ─── 6 · Refresh + calendar honesty ──────────────────────────────────────────

describe('R12 · UpdateDataButton states', () => {
  const src = read('src/components/ui/UpdateDataButton.tsx')

  test('a failed refresh has its own visible, localized, announced state', () => {
    assert.match(src, /'idle' \| 'loading' \| 'done' \| 'failed'/)
    assert.match(src, /t\.common\.updateFailed/)
    assert.match(src, /role="status" className="sr-only"/)
  })
})

describe('R12 · i18n — every new key exists in both dictionaries', () => {
  const i18n = read('src/lib/i18n.ts')
  for (const key of ['updateFailed:', 'newsHighImpact:', 'saveError:', 'removeError:', 'deleteTransaction:', 'onlyPdf:', 'fileTooLarge:', 'pdfUnreadable:', 'scannedPdf:', 'revealToEdit:']) {
    test(`${key.replace(':', '')} present in EN and ES`, () => {
      assert.ok((i18n.match(new RegExp(key)) ?? []).length >= 1)
      assert.ok(i18n.split(key).length >= 3, `${key} must appear at least twice (dict.en and dict.es)`)
    })
  }
})

describe('R12 · calendar and FX loading/failure states', () => {
  test('/macro/calendar: tri-state FRED gate and no future-dated as-of', () => {
    const src = read('src/app/macro/calendar/page.tsx')
    assert.match(src, /setFredState\(res && res\.ok \? 'ready' : 'error'\)/)
    assert.ok(!src.includes('events.reduce((max, e)'))
  })

  test('/macro: tri-state calendar embed + settled-aware FX depth', () => {
    const src = read('src/app/macro/page.tsx')
    assert.match(src, /setCalendarState\(res && res\.ok \? 'ready' : 'error'\)/)
    assert.match(src, /!usForexSettled && usForex === null \? 'loading'/)
  })

  test('Earnings: the refresh handler cannot strand the tables in loading', () => {
    const src = read('src/app/earnings/page.tsx')
    const block = src.slice(src.indexOf('const refreshEarnings'), src.indexOf('const refreshEarnings') + 700)
    assert.match(block, /finally \{\s*\n\s*setLoading\(false\)/)
  })
})

// ─── 7 · Fabricated-stale ratios removed from render sites ───────────────────

describe('R12 · frozen synthetic ratios no longer render under live labels', () => {
  test('Stocks: refreshMarketData.py provably never rewrites pe/dividendYield', () => {
    const py = read('scripts/refresh/refreshMarketData.py')
    const entryBlock = py.slice(py.indexOf("'price': p,"), py.indexOf("'price': p,") + 300)
    assert.ok(!entryBlock.includes("'pe'") && !entryBlock.includes("'dividendYield'"),
      'the refresh writes only price/day/ytd/lastUpdated/source — the ratio fields are frozen Phase-2D synthetics')
  })

  test('Stocks table renders neither frozen ratio column', () => {
    const src = read('src/app/stocks/page.tsx')
    assert.ok(!src.includes('s?.pe') && !src.includes('s?.dividendYield'))
  })

  test('Company valuation tiles carry no synthetic sector medians', () => {
    const src = read('src/app/companies/[ticker]/page.tsx')
    assert.ok(!src.includes('medStr'))
    assert.ok(!src.includes('getAllSnapshots()'))
  })
})

// ─── 8 · R12.1 — durable production-dependency security floors ───────────────
//
// R12.1 removed all 9 production advisories (5 high, 4 moderate) through the
// smallest supported updates: next 16.2.9 → 16.2.12 (stable 16.2 line only)
// plus seven documented exact-pin overrides. These floors are the enduring
// contract — a future dependency change that drops below any of them
// reintroduces a published vulnerability. Each override's advisory rationale,
// dependency path, and removal condition is recorded in
// docs/fable-integration/04-file-level-implementation-plan.md (Phase R12.1).

describe('R12.1 · production-dependency security floors', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = JSON.parse(read('package-lock.json'))

  // Semantic-version comparison — never lexical (10.3.1 > 10.20.0 lexically
  // but not semantically). A prerelease sorts below its release.
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v)
    assert.ok(m, `unparseable version: ${v}`)
    return { nums: [Number(m![1]), Number(m![2]), Number(m![3])], pre: m![4] ?? null }
  }
  const cmp = (a: string, b: string) => {
    const pa = parse(a), pb = parse(b)
    for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i]
    if (pa.pre && !pb.pre) return -1
    if (!pa.pre && pb.pre) return 1
    return 0
  }
  const gte = (v: string, floor: string) => cmp(v, floor) >= 0
  const lt = (v: string, ceil: string) => cmp(v, ceil) < 0

  const resolved = (name: string): string => {
    const entry = lock.packages[`node_modules/${name}`]
    assert.ok(entry?.version, `${name} missing from package-lock.json`)
    return entry.version
  }
  // Every lockfile resolution of a package, nested copies included — a floor
  // that only checks the hoisted copy would miss a vulnerable nested one
  // (exactly how next carried its own vulnerable postcss@8.4.31).
  const allResolved = (name: string): string[] =>
    Object.entries(lock.packages as Record<string, { version?: string }>)
      .filter(([k]) => k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`))
      .map(([, v]) => v.version!)

  test('next resolves >=16.2.12 <16.3.0, stable release only, pin and lockfile agreeing', () => {
    const v = resolved('next')
    assert.ok(gte(v, '16.2.12') && lt(v, '16.3.0'), `next ${v} outside [16.2.12, 16.3.0)`)
    assert.ok(!v.includes('-'), `next ${v} is a canary/preview/beta/rc — stable releases only`)
    assert.equal(pkg.dependencies.next, v, 'next stays exact-pinned in package.json, agreeing with the lockfile')
  })

  test('sharp: every resolution >= 0.35.0 (libvips CVE floor; one production copy expected)', () => {
    const vs = allResolved('sharp')
    assert.ok(vs.length >= 1, 'sharp must be present (Next image optimizer)')
    for (const v of vs) assert.ok(gte(v, '0.35.0'), `sharp ${v} below the patched 0.35.0 floor`)
    assert.equal(vs.length, 1, 'exactly one sharp resolution — a second copy would reintroduce the vulnerable nested install')
  })

  test('postcss: no resolution anywhere inside the vulnerable <=8.5.22 range', () => {
    const vs = allResolved('postcss')
    assert.ok(vs.length >= 1)
    for (const v of vs) assert.ok(gte(v, '8.5.23'), `postcss ${v} is inside the vulnerable <=8.5.22 range`)
  })

  test('yahoo/MCP transitive floors: fast-uri, ip-address, hono, @hono/node-server', () => {
    const floors: ReadonlyArray<readonly [string, string]> = [
      ['fast-uri', '3.1.5'],
      ['ip-address', '10.3.1'],
      ['hono', '4.12.34'],
      ['@hono/node-server', '2.0.5'],
    ]
    for (const [name, floor] of floors) {
      const vs = allResolved(name)
      assert.ok(vs.length >= 1, `${name} expected in the tree`)
      for (const v of vs) assert.ok(gte(v, floor), `${name} ${v} below its patched floor ${floor}`)
    }
  })

  test('yahoo-finance2 stays 3.15.3 — the audit-proposed 3.14.3 downgrade is forbidden', () => {
    assert.equal(resolved('yahoo-finance2'), '3.15.3')
  })

  test('no force-generated downgrade: the MCP SDK adopted 1.30.0+, whose own declared range ("^1.19.9 || ^2.0.5") officially supports @hono/node-server 2.x', () => {
    const v = resolved('@modelcontextprotocol/sdk')
    assert.ok(gte(v, '1.30.0') && lt(v, '2.0.0'), `@modelcontextprotocol/sdk ${v} outside [1.30.0, 2.0.0)`)
  })

  test('every override is an exact pin, resolves exactly, and has a governance record', () => {
    const doc = read('docs/fable-integration/04-file-level-implementation-plan.md')
    const overrides: Record<string, string> = pkg.overrides ?? {}
    assert.ok(Object.keys(overrides).length >= 1, 'the R12.1 overrides block must exist')
    for (const [name, spec] of Object.entries(overrides)) {
      assert.match(spec, /^\d+\.\d+\.\d+$/, `override ${name} must be an exact pin, not a range`)
      assert.equal(resolved(name), spec, `${name} lockfile resolution disagrees with its override`)
      assert.ok(doc.includes(`\`${name}\``), `override ${name} lacks a governance record in doc 04's Phase R12.1 section`)
    }
  })

  test('package.json and package-lock.json agree at the root', () => {
    const root = lock.packages['']
    assert.equal(lock.lockfileVersion, 3)
    assert.deepEqual(root.dependencies, pkg.dependencies)
    assert.deepEqual(root.devDependencies, pkg.devDependencies)
    assert.equal(root.version, pkg.version)
  })
})
