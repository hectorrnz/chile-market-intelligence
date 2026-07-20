// 2026-07-20, second round — a follow-up batch of six user-reported items on
// top of the same day's earlier fixes (MarketDataProvider, Compare
// fundamentals scale bugs, Comparative Returns wiring).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('1. Structured Notes — upload subtitle and monitoring disclaimer removed from the list page', () => {
  const src = read('src/app/structured-notes/page.tsx')
  const i18n = read('src/lib/i18n.ts')

  it('the SectionHeader no longer passes the "Upload a term sheet…" subtitle', () => {
    assert.ok(!src.includes('subtitle={t.sn.subtitle}'))
    assert.ok(!i18n.includes('Upload a term sheet — terms are extracted automatically'))
    assert.ok(!i18n.includes('Sube un term sheet — los términos se extraen automáticamente'))
  })

  it('the "Monitoring estimate — not an official calculation-agent determination" line is removed from the list page', () => {
    assert.ok(!src.includes('t.sn.monitoring.estimateDisclaimer'))
  })

  it('the detail page keeps its own disclaimer (not in scope — only the list page table footer was requested)', () => {
    const detailSrc = read('src/app/structured-notes/[id]/page.tsx')
    assert.ok(detailSrc.includes('t.sn.monitoring.estimateDisclaimer'))
  })
})

describe('2. MacroDataProvider — Home macro/rates/FX status survives navigation', () => {
  const providerPath = 'src/components/providers/MacroDataProvider.tsx'
  const provider = read(providerPath)
  const appShell = read('src/components/layout/AppShell.tsx')
  const homePage = read('src/app/page.tsx')

  it('exists and exposes useMacroData()', () => {
    assert.ok(existsSync(join(ROOT, providerPath)))
    assert.ok(provider.includes('export function MacroDataProvider'))
    assert.ok(provider.includes('export function useMacroData'))
  })

  it('is mounted once in AppShell, above the page content — survives route changes', () => {
    const providerIdx = appShell.indexOf('<MacroDataProvider>')
    const childrenIdx = appShell.indexOf('{children}')
    assert.ok(providerIdx >= 0 && childrenIdx > providerIdx, 'MacroDataProvider must wrap {children}')
  })

  it('CL and US statuses are tracked separately — never merged into one shared status', () => {
    assert.ok(provider.includes('clStatus'))
    assert.ok(provider.includes('usStatus'))
  })

  it('reuses an in-flight refresh rather than firing a duplicate fetch', () => {
    assert.ok(provider.includes('if (inFlight.current) return inFlight.current'))
  })

  it('Home page reads macro state from the shared context, not its own local useState', () => {
    assert.ok(homePage.includes('useMacroData()'))
    assert.ok(!homePage.includes("useState<Record<string, MacroIndicator>>({})"), 'must not hold its own liveIndicatorMap state')
    assert.ok(!homePage.includes("fetchMacroIndicators('CL', ac.signal)"), 'must not run its own mount-time macro fetch — the provider does that once')
  })
})

describe('3. Stocks — auto-sorts by Day Chg. (desc) after Update', () => {
  const src = read('src/app/stocks/page.tsx')

  // Third attempt at this. A one-shot flag on the provider could not work:
  // consuming it required the Stocks page to clear parent state during its own
  // render, which React forbids (updating a parent while rendering a child) —
  // so the sort silently never applied on a real client-side navigation. The
  // sort is now DERIVED from live data + a null-until-clicked userSort, which
  // also handles the case a flag structurally cannot: a refresh that happened
  // on another tab before Stocks was ever mounted.
  it('derives the sort instead of imperatively setting it', () => {
    assert.ok(src.includes('userSort'))
    assert.ok(src.includes("const sortKey: SortKey = userSort?.key ?? (live ? 'dayChangePct' : 'marketCapCLP')"))
    assert.ok(src.includes("const sortDir: 'asc' | 'desc' = userSort?.dir ?? 'desc'"))
  })

  it('never sets state on the provider during render — only on itself', () => {
    assert.ok(!src.includes('clearStocksSortFlag'), 'the cross-component render-phase update must be gone')
    const start = src.indexOf('if (refreshSeq !== seenSeq)')
    assert.ok(start >= 0, 'must use the render-time previous-value pattern on self-state')
    const body = src.slice(start, start + 160)
    assert.ok(body.includes('setSeenSeq(refreshSeq)'))
    assert.ok(body.includes('setUserSort(null)'), 'a fresh refresh drops any manual sort')
  })

  it('a refresh from ANY page leaves Stocks sorted by Day Chg. desc once live data is present', () => {
    // With userSort null (its state on mount, and after any refresh) and live
    // data on screen, the derived sortKey is dayChangePct/desc regardless of
    // which page triggered the refresh or whether Stocks was mounted for it.
    assert.ok(src.includes("live ? 'dayChangePct' : 'marketCapCLP'"))
  })
})

describe('3b. MarketDataProvider — exposes a refresh sequence, not a consumable flag', () => {
  const src = read('src/components/providers/MarketDataProvider.tsx')

  it('increments refreshSeq on every successful refresh', () => {
    assert.ok(src.includes('setRefreshSeq((n) => n + 1)'))
  })

  it('exposes refreshSeq and no longer exposes a mutable sort flag', () => {
    assert.ok(src.includes('refreshSeq'))
    assert.ok(!src.includes('stocksNeedsSort'))
    assert.ok(!src.includes('clearStocksSortFlag'))
  })
})

describe('4. Global "Not investment advice" footer disclaimer removed', () => {
  it('the AppDisclaimer component file is deleted', () => {
    assert.ok(!existsSync(join(ROOT, 'src/components/ui/AppDisclaimer.tsx')))
  })

  it('AppShell no longer renders it', () => {
    const appShell = read('src/components/layout/AppShell.tsx')
    assert.ok(!appShell.includes('AppDisclaimer'))
  })

  it('no source file references AppDisclaimer', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (/\.(ts|tsx)$/.test(entry.name) && read(rel).includes('AppDisclaimer')) hits.push(rel)
      }
    }
    walk('src')
    assert.deepEqual(hits, [])
  })

  it('the disclaimer i18n key is removed (EN + ES)', () => {
    const i18n = read('src/lib/i18n.ts')
    assert.ok(!i18n.includes('Not investment advice · Data sourcing varies by module'))
    assert.ok(!i18n.includes('No constituye recomendación de inversión'))
  })
})

describe('5. Compare fundamentals — Market Cap shown in billions', () => {
  const src = read('src/app/compare/page.tsx')

  it('the Market Cap row label says (Bn) and divides the millions-CLP value by 1000', () => {
    assert.ok(src.includes('`${t.home.marketCap} (Bn)`'))
    assert.ok(src.includes('v / 1000'))
    assert.ok(!src.includes('`${t.home.marketCap} (MM)`'), 'the old (MM) label must be gone')
  })
})

describe('6. Cumulative Return chart — honest "still accumulating" note instead of a bare static label', () => {
  const resolver = read('src/lib/compare/resolveCompareHistory.ts')
  const clientHelper = read('src/lib/data/compareHistory.ts')
  const pageSrc = read('src/app/compare/page.tsx')
  const i18n = read('src/lib/i18n.ts')

  it('resolveCompareHistory exposes insufficientHistoryReason only when the series is genuinely still accumulating', () => {
    assert.ok(resolver.includes('insufficientHistoryReason'))
    assert.ok(resolver.includes('/insufficient/i.test(reason)'))
  })

  it('the client type mirrors the field', () => {
    assert.ok(clientHelper.includes('insufficientHistoryReason: string | null'))
  })

  it('compare/page.tsx surfaces an accumulating note under both the table and chart footers when applicable', () => {
    assert.ok(pageSrc.includes('historyAccumulating'))
    const noteCount = pageSrc.split('t.compare.historyAccumulating').length - 1
    assert.ok(noteCount >= 2, 'expected the note under both the Returns table footer and the chart footer')
  })

  it('the note never appears for a custom date range (which never uses persisted data)', () => {
    const line = pageSrc.split('\n').find(l => l.includes('const historyAccumulating ='))
    assert.ok(line?.includes('!usingCustom'))
  })

  it('i18n has the accumulating copy in EN + ES, distinct from the bare static-sample label', () => {
    assert.ok(i18n.includes('historyAccumulating:'))
    assert.ok(/accumulating/i.test(i18n))
    assert.ok(/acumulando/i.test(i18n))
  })
})
