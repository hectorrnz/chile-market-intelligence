'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { useEscape } from '@/lib/useEscape'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { useMarketData } from '@/components/providers/MarketDataProvider'
import { useGlobalRefresh } from '@/components/providers/useGlobalRefresh'
import { CompareChart } from '@/components/charts/CompareChart'
import { getAllCompanies } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { getStockSeriesByPeriod } from '@/lib/data/stockHistory'
import { totalAndAnnual, tfStart } from '@/lib/returns'
import { formatCLP, formatFx, changeColor } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'
import { fetchCompareData } from '@/lib/data/compareData'
import { fetchCompareHistory, type CompareHistorySeries } from '@/lib/data/compareHistory'
import type { CompareEntry, CompareFundamentalKey, ComparePerformanceMetric } from '@/lib/compare/compareTypes'
import type { StockPriceSnapshot, Company } from '@/types'

type CmpTf = '1M' | 'YTD' | '1Y' | '3Y' | '5Y'
type Period = 'D' | 'W' | 'M'
const TF: CmpTf[] = ['1M', 'YTD', '1Y', '3Y', '5Y']
// Institutional default palette — 6 distinct hues (no purple, no near-duplicates)
const PRESET = ['#004A64', '#1A6630', '#8B0E04', '#B07A12', '#0E7FB8', '#5B6770']
const SWATCHES = ['#004A64', '#7399C6', '#0E7FB8', '#1A6630', '#3DAA60', '#8B0E04', '#B07A12', '#5B6770', '#231F20', '#88CBDF']
const DATA_END = '2025-06-17'
const DATA_START = '2020-06-01'

const companies = getAllCompanies()
const snapshots = getAllSnapshots()
const snapMap = Object.fromEntries(snapshots.map(s => [s.ticker, s])) as Record<string, StockPriceSnapshot>
const compMap = Object.fromEntries(companies.map(c => [c.ticker, c])) as Record<string, Company>

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const fmtPct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)

export default function ComparePage() {
  const { t } = useLang()
  const [slots, setSlots] = usePersistentState<string[]>('cmi.compareSlots', ['BSANTANDER', 'SQM-B', 'FALABELLA', '', '', ''])
  const [colors, setColors] = usePersistentState<string[]>('cmi.compareColors', [...PRESET])
  const [diffRef, setDiffRef] = usePersistentState<string>('cmi.compareDiffRef', '0')
  // No IPSA benchmark: Yahoo Finance serves quote/metadata for ^IPSA but
  // returns ZERO historical chart bars for it under every symbol variant
  // tried (^IPSA, ^SPIPSA, IPSA.SN, ^SPCLXIPSA), and the persisted
  // stock_snapshots universe only ever covers the 25 tracked equities. The
  // static IPSA series that used to back this was sample data, so the toggle
  // was removed rather than left as a fabricated benchmark line.
  const [tf, setTf] = usePersistentState<CmpTf>('cmi.compareTf', '1Y')
  const [period, setPeriod] = usePersistentState<Period>('cmi.comparePeriod', 'W')
  const [cStart, setCStart] = usePersistentState<string>('cmi.compareStart', '')
  const [cEnd, setCEnd] = usePersistentState<string>('cmi.compareEnd', '')
  const [showLegend, setShowLegend] = usePersistentState<boolean>('cmi.compareLegend', true)
  const [showGrid, setShowGrid] = usePersistentState<boolean>('cmi.compareGrid', true)
  const [lineW, setLineW] = usePersistentState<number>('cmi.compareLineW', 1.75)
  const [highlight, setHighlight] = usePersistentState<boolean>('cmi.compareHighlight', true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEscape(settingsOpen, () => setSettingsOpen(false))

  const s6 = [...slots, '', '', '', '', '', ''].slice(0, 6)
  const c6 = [...colors, ...PRESET].slice(0, 6)
  const norm = (v: string) => v.trim().toUpperCase()
  const colorForSlot = (i: number) => c6[i] || PRESET[i]

  const seen = new Set<string>()
  const valids: { slot: number; ticker: string }[] = []
  s6.forEach((v, i) => { const tk = norm(v); if (tk && compMap[tk] && !seen.has(tk)) { seen.add(tk); valids.push({ slot: i, ticker: tk }) } })

  // Update Data — Compare's /api/compare fetch is now the SINGLE source for the
  // Market Data table AND the Fundamentals table (price, market cap and every
  // ratio come from one live Yahoo snapshot server-side), so the two can never
  // disagree (the item-4 bug was two different price fetches feeding the two
  // tables). `live` is the shared platform-wide snapshot (see
  // MarketDataProvider); we don't overlay it on a table anymore, but we DO
  // re-fetch /api/compare whenever it changes so clicking Update on ANY tab
  // refreshes Compare too. `compareRefreshSeq` bumps on this page's own Update.
  const { live } = useMarketData()
  const refreshShared = useGlobalRefresh()
  const [compareRefreshSeq, setCompareRefreshSeq] = useState(0)
  const doRefresh = async () => {
    await refreshShared()
    setCompareRefreshSeq(n => n + 1)
  }

  // Phase 8B — market fields (price, day change, market cap, short-term
  // performance) wired to persisted/live Supabase data via /api/compare.
  // Historical returns + fundamentals below remain static (see compare.source).
  const [compareData, setCompareData] = useState<Record<string, CompareEntry>>({})
  const [compareMetaStatus, setCompareMetaStatus] = useState<{ latestSnapshotDate: string | null } | null>(null)
  const validTickerKey = valids.map(v => v.ticker).join(',')
  useEffect(() => {
    let mounted = true
    const tickers = validTickerKey ? validTickerKey.split(',') : []
    const run = async () => {
      if (tickers.length === 0) {
        if (mounted) { setCompareData({}); setCompareMetaStatus(null) }
        return
      }
      try {
        const res = await fetchCompareData(tickers)
        if (!mounted) return
        setCompareData(Object.fromEntries(res.data.map(e => [e.ticker, e])))
        setCompareMetaStatus({ latestSnapshotDate: res.metadata.latestSnapshotDate })
      } catch { /* keep previous data on transient fetch failure */ }
    }
    run()
    return () => { mounted = false }
    // live?.lastUpdated: re-fetch /api/compare whenever the shared snapshot
    // refreshes (an Update clicked on any tab), so Compare stays in sync
    // without a divergent client-side overlay.
  }, [validTickerKey, compareRefreshSeq, live?.lastUpdated])
  // /api/compare reports 'live' per entry when its Yahoo valuation succeeded —
  // both tables read that same resolved data, so the badge matches what's shown.
  const marketStatus: 'live' | 'persisted' | 'static' | 'hybrid-fallback' | 'live-unavailable' =
    (Object.values(compareData)[0]?.marketDataStatus as 'live' | 'persisted' | 'static' | 'hybrid-fallback' | 'live-unavailable') ?? 'static'
  const perfCell = (m: ComparePerformanceMetric | undefined) => ({
    label: m?.value != null ? fmtPct(m.value) : '—',
    title: m && m.source !== 'persisted' ? (m.fallbackReason ?? m.source) : undefined,
    className: m?.value != null ? colored(m.value) : 'text-muted-fg',
  })

  const usingCustom = !!(cStart && cEnd)
  const end = usingCustom ? cEnd : DATA_END
  const start = usingCustom ? cStart : tfStart(end, tf)

  // 2026-07-20 — real historical returns (live Yahoo Finance fetch, with
  // Supabase-persisted-accumulation and static as resilience fallbacks — see
  // resolveCompareHistory.ts) where the selected timeframe is genuinely
  // covered. A custom date range keeps the static path (this history is only
  // ever queried for the 5 standard TF buttons); Period (Weekly/Monthly) also
  // stays on the static path when live/persisted data is used, since the
  // fetched series is daily and downsampling it isn't wired up yet.
  const [persistedHistory, setPersistedHistory] = useState<Record<string, CompareHistorySeries>>({})
  useEffect(() => {
    // Stale persistedHistory from a prior selection is harmless to leave in
    // place here — seriesFor/sourceFor both gate on `!usingCustom` before
    // ever reading it, so it's simply never consulted while true, and the
    // next non-custom fetch below overwrites it once relevant again.
    if (usingCustom || validTickerKey === '') return
    let mounted = true
    fetchCompareHistory(validTickerKey.split(','), tf)
      .then(res => { if (mounted) setPersistedHistory(Object.fromEntries(res.series.map(s => [s.ticker, s]))) })
      .catch(() => { if (mounted) setPersistedHistory({}) })
    return () => { mounted = false }
  }, [validTickerKey, tf, usingCustom, compareRefreshSeq])

  const isFetched = (s: CompareHistorySeries | undefined) => s?.status === 'live' || s?.status === 'persisted'
  const seriesFor = (tk: string) => {
    const fetched = persistedHistory[tk]
    if (!usingCustom && isFetched(fetched) && fetched!.points.length >= 2) return fetched!.points
    return getStockSeriesByPeriod(tk, period).filter(p => p.date >= start && p.date <= end).map(p => ({ date: p.date, value: p.price }))
  }
  const sourceFor = (tk: string): 'live' | 'persisted' | 'static' => {
    if (usingCustom) return 'static'
    const status = persistedHistory[tk]?.status
    return status === 'live' || status === 'persisted' ? status : 'static'
  }

  const rowData = valids.map(({ slot, ticker }) => {
    const data = seriesFor(ticker)
    const m = totalAndAnnual(data)
    return { slot, ticker, color: colorForSlot(slot), data, tr: m?.tr ?? null, annual: m?.annual ?? null, source: sourceFor(ticker) }
  })
  const returnsStatus: 'live' | 'persisted' | 'static' =
    rowData.some(r => r.source === 'live') ? 'live'
    : rowData.some(r => r.source === 'persisted') ? 'persisted'
    : 'static'
  const returnsAsOf = rowData
    .map(r => persistedHistory[r.ticker]?.asOfDate)
    .filter((d): d is string => !!d)
    .reduce((max, d) => (!max || d > max ? d : max), '') || null
  // History was genuinely attempted for this timeframe but doesn't cover it
  // yet (as opposed to never having been attempted at all) — say so rather
  // than leave a bare "Static sample" that reads as permanent.
  const historyAccumulating = !usingCustom && returnsStatus === 'static'
    && valids.some(({ ticker }) => persistedHistory[ticker]?.insufficientHistoryReason)

  const slotIdx = parseInt(diffRef, 10)
  const ref = rowData.find(r => r.slot === slotIdx) ?? rowData[0]
  const refTR: number | null = ref?.tr ?? null
  const refSlot = ref?.slot ?? -1

  const chartSeries = rowData
    .filter(r => r.data.length >= 2)
    .map(r => ({ ticker: r.ticker, color: r.color, data: r.data }))

  const setSlot = (i: number, v: string) => { const next = [...s6]; next[i] = v.toUpperCase().slice(0, 12); setSlots(next) }
  const setColor = (i: number, c: string) => { const next = [...c6]; next[i] = c; setColors(next) }
  const resetDefaults = () => { setColors([...PRESET]); setDiffRef('0'); setShowLegend(true); setShowGrid(true); setLineW(1.75); setHighlight(true) }
  const colored = (v: number | null) => (v == null ? 'text-muted-fg' : changeColor(v))

  const handleExportFund = () => {
    exportCSV(
      'compare_fundamentals',
      [t.compare.metric, ...valids.map(v => v.ticker)],
      fund.map(row => [
        row.label,
        ...valids.map(({ ticker }) => {
          const v = row.get(compareData[ticker], snapMap[ticker], compMap[ticker])
          return v != null ? row.fmt(v) : ''
        }),
      ]),
    )
  }

  // Phase 8C — reads persisted/derived fundamentals from the resolver
  // (compareData[ticker].fundamentals) where available; falls back to the
  // static snapshot only for fields with no persisted equivalent yet.
  // 'key' matches CompareFundamentalKey so derivedFields can be checked.
  type Row = {
    label: string
    key?: CompareFundamentalKey
    dir: -1 | 0 | 1
    get: (e?: CompareEntry, s?: StockPriceSnapshot, c?: Company) => number | null
    fmt: (v: number) => string
  }
  // Defensive rounding at display time — a derived ratio (persisted financials
  // ÷ live price/market cap) is a raw float with many decimals; never render
  // one unrounded, regardless of which upstream field happened to already be
  // clean. 1 decimal for both "x" multiples and "%" throughout this table.
  const fmtX = (v: number) => `${v.toFixed(1)}x`
  const fmtPctCell = (v: number) => `${v.toFixed(1)}%`
  const fund: Row[] = [
    { label: t.company.kpis.lastPrice, dir: 0, get: e => num(e?.latestPrice), fmt: v => formatFx(v, v < 1000 ? 2 : 0) },
    { label: `${t.home.marketCap} (Bn)`, dir: 0, get: e => { const v = num(e?.marketCapCLP); return v != null ? v / 1000 : null }, fmt: v => formatCLP(v, 1) },
    // Every fundamentals cell reads ONLY the resolved (live Yahoo) value — no
    // static snapshot fallback anywhere. The static figures are fabricated
    // sample data; an honest "—" is correct when Yahoo has nothing for a ticker
    // (e.g. EV/EBITDA, gross margin or FCF for a bank).
    { label: t.company.val.peFwd, key: 'pe', dir: -1, get: e => num(e?.fundamentals.pe), fmt: fmtX },
    { label: t.compare.psTtm, key: 'psFwd', dir: -1, get: e => num(e?.fundamentals.psFwd), fmt: fmtX },
    { label: t.company.val.evEbitda, key: 'evEbitda', dir: -1, get: e => num(e?.fundamentals.evEbitda), fmt: fmtX },
    { label: t.company.val.opMargin, key: 'opMargin', dir: 1, get: e => num(e?.fundamentals.opMargin), fmt: fmtPctCell },
    { label: t.company.val.grossMargin, key: 'grossMargin', dir: 1, get: e => num(e?.fundamentals.grossMargin), fmt: fmtPctCell },
    { label: t.company.val.roe, key: 'roe', dir: 1, get: e => num(e?.fundamentals.roe), fmt: fmtPctCell },
    { label: t.company.val.fcfYield, key: 'fcfYield', dir: 1, get: e => num(e?.fundamentals.fcfYield), fmt: fmtPctCell },
    { label: t.company.val.pb, key: 'pb', dir: -1, get: e => num(e?.fundamentals.pb), fmt: fmtX },
    { label: t.company.val.netDebtEbitda, key: 'netDebtEbitda', dir: -1, get: e => num(e?.fundamentals.netDebtEbitda), fmt: fmtX },
    { label: t.company.kpis.divYield, key: 'dividendYield', dir: 1, get: e => num(e?.fundamentals.dividendYield), fmt: fmtPctCell },
  ]
  // Whether ANY shown ticker has at least one field derived from persisted
  // financials — drives the fundamentals footer's source name.
  const hasDerivedFundamentals = valids.some(
    ({ ticker }) => (compareData[ticker]?.fundamentals.derivedFields.length ?? 0) > 0,
  )

  const cellStyle = (row: Row, value: number | null, values: (number | null)[]) => {
    if (!highlight || row.dir === 0 || value == null) return {}
    const nums = values.filter((v): v is number => v != null)
    if (nums.length < 2) return {}
    const best = row.dir === 1 ? Math.max(...nums) : Math.min(...nums)
    const worst = row.dir === 1 ? Math.min(...nums) : Math.max(...nums)
    if (value === best) return { backgroundColor: 'color-mix(in oklab, var(--positive) 16%, var(--surface))' }
    if (value === worst) return { backgroundColor: 'color-mix(in oklab, var(--negative) 14%, var(--surface))' }
    return {}
  }

  return (
    <div className="w-full space-y-4">
      <SectionHeader tag={t.compare.tag} title={t.compare.title} subtitle={t.compare.subtitle} actions={<UpdateDataButton onRefresh={doRefresh} />} />

      <datalist id="cmp-tickers">
        {companies.map(c => <option key={c.ticker} value={c.ticker}>{c.shortName}</option>)}
      </datalist>

      {/* Market Data — persisted/live Supabase fields (Phase 8B) */}
      {valids.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-x-auto">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <span className="ui-label text-muted-fg">{t.compare.marketDataTitle}</span>
            <MarketDataSourceBadge status={marketStatus} />
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left py-2 px-3 pl-4 ui-table-header text-muted-fg">{t.compare.security}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.stocks.cols.price}</th>
                {/* Day Chg. removed — it duplicated 1D (both are the 1-day
                    change; 1D is the one wired to a real computed return,
                    see resolveCompareData.ts's classifyPerformance). */}
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perf1d}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perf5d}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perf1m}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perfYtd}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perf1y}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{`${t.home.marketCap} (Bn)`}</th>
                <th className="text-left py-2 px-2 pr-4 ui-table-header text-muted-fg">{t.common.sector}</th>
              </tr>
            </thead>
            <tbody>
              {valids.map(({ ticker }) => {
                const entry = compareData[ticker]
                // Price + market cap come from /api/compare's live Yahoo
                // valuation — the SAME resolved entry the Fundamentals table
                // reads, so the two tables always agree (item-4 fix).
                const price = entry?.latestPrice
                const marketCapCLP = entry?.marketCapCLP
                const p1d = perfCell(entry?.performance.oneDay)
                const p5d = perfCell(entry?.performance.fiveDay)
                const p1m = perfCell(entry?.performance.oneMonth)
                const pytd = perfCell(entry?.performance.ytd)
                const p1y = perfCell(entry?.performance.oneYear)
                return (
                  <tr key={ticker} className="border-b border-border last:border-0">
                    <td className="py-1.5 px-3 pl-4 font-mono text-primary">{ticker}</td>
                    <td className="py-1.5 px-2 text-right ui-number text-foreground">{price != null ? formatFx(price, price < 1000 ? 2 : 0) : '—'}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${p1d.className}`} title={p1d.title}>{p1d.label}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${p5d.className}`} title={p5d.title}>{p5d.label}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${p1m.className}`} title={p1m.title}>{p1m.label}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${pytd.className}`} title={pytd.title}>{pytd.label}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${p1y.className}`} title={p1y.title}>{p1y.label}</td>
                    {/* Same billions treatment as the Fundamentals table's
                        "Mkt Cap (Bn)" row — the two sit on one screen and
                        previously disagreed (4.5 MM here vs 4.499,9 there for
                        the identical figure). */}
                    <td className="py-1.5 px-2 text-right ui-number text-foreground">{marketCapCLP != null ? formatCLP(marketCapCLP / 1000, 1) : '—'}</td>
                    <td className="py-1.5 px-2 pr-4 text-muted-fg whitespace-nowrap">{entry?.sector ?? compMap[ticker]?.sector ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border">
            <TableSourceFooter source={t.compare.marketSource} asOf={compareMetaStatus?.latestSnapshotDate ?? null} />
          </div>
        </div>
      )}

      {/* Top: returns (left) + fundamentals (right) */}
      <div className="grid grid-cols-12 gap-4 items-start">

        {/* Returns table */}
        <div className="col-span-12 xl:col-span-5 bg-surface border border-border rounded overflow-x-auto">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="ui-label text-muted-fg">{t.compare.returnsTitle}</span>
              {!usingCustom && <MarketDataSourceBadge status={returnsStatus} />}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-1.5 h-6 px-2 rounded border border-border bg-surface-2 text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors">
                <span>⚙</span><span>{t.compare.settings}</span>
              </button>
            </div>
          </div>
          <table className="w-full text-xs min-w-[440px]">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left py-2 pl-4 pr-1 ui-table-header text-muted-fg w-6">#</th>
                <th className="text-left py-2 px-2 ui-table-header text-muted-fg">{t.compare.security}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.totalReturn}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.difference}</th>
                <th className="text-right py-2 px-2 pr-4 ui-table-header text-muted-fg">{t.compare.annualized}</th>
              </tr>
            </thead>
            <tbody>
              {s6.map((val, i) => {
                const isValid = valids.some(v => v.slot === i)
                const r = isValid ? rowData.find(x => x.slot === i) : undefined
                const isRef = r && r.slot === refSlot
                const diff = r && r.tr != null && refTR != null && !isRef ? r.tr - refTR : null
                return (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-1.5 pl-4 pr-1 text-muted-fg ui-number">{i + 1}</td>
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: isValid ? colorForSlot(i) : 'transparent', border: isValid ? 'none' : '1px solid var(--border)' }} />
                        <input value={val} onChange={e => setSlot(i, e.target.value)} list="cmp-tickers" placeholder={t.compare.addTicker} spellCheck={false}
                          className="bg-transparent outline-none font-mono text-primary placeholder:text-muted-fg placeholder:font-sans w-28 border-b border-transparent focus:border-accent" />
                      </div>
                    </td>
                    <td className={`py-1.5 px-2 text-right ui-number ${colored(r?.tr ?? null)}`} title={r?.source === 'live' || r?.source === 'persisted' ? t.compare.marketSource : undefined}>{r ? fmtPct(r.tr) : ''}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${isRef ? 'text-muted-fg' : colored(diff)}`}>{isValid ? (isRef ? '--' : fmtPct(diff)) : ''}</td>
                    <td className={`py-1.5 px-2 pr-4 text-right ui-number ${colored(r?.annual ?? null)}`}>{r ? fmtPct(r.annual) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border">
            <TableSourceFooter source={returnsStatus !== 'static' ? t.compare.marketSource : t.compare.source} asOf={returnsAsOf} />
            {historyAccumulating && <p className="text-xs text-muted-fg mt-0.5">{t.compare.historyAccumulating}</p>}
          </div>
        </div>

        {/* Fundamentals — centered data */}
        <div className="col-span-12 xl:col-span-7">
          {valids.length === 0 ? (
            <div className="bg-surface border border-border rounded p-10 text-center text-xs text-muted-fg">{t.compare.empty}</div>
          ) : (
            <div className="bg-surface border border-border rounded overflow-x-auto">
              <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                <span className="ui-label text-muted-fg">{t.compare.fundamentals}</span>
                <button
                  onClick={handleExportFund}
                  className="flex items-center gap-1.5 h-6 px-2 rounded border border-border bg-surface text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
                >
                  <span aria-hidden>⤓</span>{t.common.exportCsv}
                </button>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-left py-2.5 px-3 pl-4 ui-table-header text-muted-fg sticky left-0 bg-surface-2 z-10">{t.compare.metric}</th>
                    {valids.map(({ slot, ticker }) => (
                      <th key={ticker} className="text-center py-2.5 px-3 ui-table-header text-muted-fg whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: colorForSlot(slot) }} />
                          <span className="font-mono text-primary">{ticker}</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fund.map(row => {
                    const values = valids.map(({ ticker }) => row.get(compareData[ticker], snapMap[ticker], compMap[ticker]))
                    return (
                      <tr key={row.label} className="border-b border-border last:border-0">
                        <td className="py-2 px-3 pl-4 text-muted sticky left-0 bg-surface z-10 whitespace-nowrap">{row.label}</td>
                        {values.map((v, i) => {
                          const isDerived = !!row.key && !!compareData[valids[i].ticker]?.fundamentals.derivedFields.includes(row.key)
                          return (
                            <td key={valids[i].ticker} className="py-2 px-3 text-center ui-number text-foreground" style={cellStyle(row, v, values)}>
                              {v != null ? row.fmt(v) : '—'}
                              {isDerived && <span className="ml-1 text-accent" title={t.compare.derivedFieldTitle}>•</span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2 border-t border-border">
                <TableSourceFooter source={marketStatus === 'live' ? t.compare.marketSource : (hasDerivedFundamentals ? t.compare.fundamentalsSource : t.common.staticSample)} />
              </div>
            </div>
          )}
        </div>
      </div>

      {valids.length > 0 && (
        <>
          {/* Control bar */}
          <div className="bg-surface border border-border rounded px-4 py-2.5 flex items-center gap-4 flex-wrap text-xs">
            <div className="flex items-center gap-1">
              {TF.map(x => (
                <button key={x} onClick={() => { setTf(x); setCStart(''); setCEnd('') }}
                  className={`px-2 py-0.5 rounded transition-colors ${!usingCustom && tf === x ? 'bg-surface-2 text-foreground border border-border' : 'text-muted-fg hover:text-foreground'}`}>
                  {x}
                </button>
              ))}
            </div>
            <span className="w-px h-4 bg-border" />
            <label className="flex items-center gap-1.5">
              <span className="text-muted-fg">{t.compare.period}:</span>
              <select value={period} onChange={e => setPeriod(e.target.value as Period)} className="h-6 bg-surface border border-border rounded px-1.5 text-foreground outline-none focus:border-accent">
                <option value="D">{t.compare.daily}</option>
                <option value="W">{t.compare.weekly}</option>
                <option value="M">{t.compare.monthly}</option>
              </select>
            </label>
            <span className="w-px h-4 bg-border" />
            <div className="flex items-center gap-2">
              <span className="text-muted-fg">{t.compare.range}:</span>
              <input type="date" value={cStart} min={DATA_START} max={DATA_END} onChange={e => setCStart(e.target.value)} className="h-6 bg-surface border border-border rounded px-1.5 text-foreground outline-none focus:border-accent" />
              <span className="text-muted-fg">–</span>
              <input type="date" value={cEnd} min={DATA_START} max={DATA_END} onChange={e => setCEnd(e.target.value)} className="h-6 bg-surface border border-border rounded px-1.5 text-foreground outline-none focus:border-accent" />
              {usingCustom && <button onClick={() => { setCStart(''); setCEnd('') }} className="text-muted-fg hover:text-foreground px-1" title="Clear range">×</button>}
            </div>
            <span className="w-px h-4 bg-border" />
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={showLegend} onChange={e => setShowLegend(e.target.checked)} className="accent-[var(--primary)]" />
              <span className="text-foreground">{t.compare.legendLabel}</span>
            </label>
          </div>

          {/* Chart */}
          <div className="bg-surface border border-border rounded p-4">
            <div className="ui-label text-muted-fg mb-3">{t.compare.perfTitle}</div>
            <CompareChart series={chartSeries} height={340} showGrid={showGrid} lineWidth={lineW} legend={showLegend} />
            <TableSourceFooter source={returnsStatus !== 'static' ? t.compare.marketSource : t.compare.source} asOf={returnsAsOf} className="mt-2" />
            {historyAccumulating && <p className="text-xs text-muted-fg mt-0.5">{t.compare.historyAccumulating}</p>}
          </div>
        </>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[8vh] px-4" style={{ backgroundColor: 'color-mix(in oklab, var(--foreground) 40%, transparent)' }} onClick={() => setSettingsOpen(false)} role="dialog" aria-modal="true" aria-label={t.compare.settings}>
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
              <span className="ui-label text-foreground">{t.compare.settings}</span>
              <button onClick={() => setSettingsOpen(false)} className="text-muted-fg hover:text-foreground text-sm px-1">✕</button>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <div className="ui-label text-muted-fg mb-2">{t.compare.diffRef}</div>
                <select value={diffRef} onChange={e => setDiffRef(e.target.value)} className="w-full h-8 bg-surface border border-border rounded px-2 text-xs text-foreground outline-none focus:border-accent">
                  {[0, 1, 2, 3, 4, 5].map(i => {
                    const tk = norm(s6[i]); const valid = !!compMap[tk] && valids.some(v => v.slot === i)
                    return <option key={i} value={String(i)} disabled={!valid}>{`${t.compare.security} ${i + 1}${valid ? ` · ${tk}` : ''}`}</option>
                  })}
                </select>
              </div>
              <div>
                <div className="ui-label text-muted-fg mb-2">{t.compare.seriesColors}</div>
                <div className="space-y-2">
                  {[0, 1, 2, 3, 4, 5].map(i => {
                    const tk = norm(s6[i]); const valid = !!compMap[tk]
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-muted-fg w-20 shrink-0">{valid ? tk : `${t.compare.security} ${i + 1}`}</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {SWATCHES.map(sw => (
                            <button key={sw} onClick={() => setColor(i, sw)} title={sw} className="w-5 h-5 rounded border" style={{ backgroundColor: sw, borderColor: c6[i].toLowerCase() === sw.toLowerCase() ? 'var(--foreground)' : 'var(--border)' }} />
                          ))}
                          <label className="w-5 h-5 rounded border border-border overflow-hidden relative cursor-pointer" title={t.compare.customColor}>
                            <input type="color" value={c6[i].startsWith('#') ? c6[i] : '#004A64'} onChange={e => setColor(i, e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] text-muted-fg">+</span>
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <div className="ui-label text-muted-fg mb-2">{t.compare.chartOpts}</div>
                <div className="space-y-2 text-xs">
                  <label className="flex items-center justify-between"><span className="text-foreground">{t.compare.showLegend}</span><input type="checkbox" checked={showLegend} onChange={e => setShowLegend(e.target.checked)} className="accent-[var(--primary)]" /></label>
                  <label className="flex items-center justify-between"><span className="text-foreground">{t.compare.gridlines}</span><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} className="accent-[var(--primary)]" /></label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-foreground">{t.compare.thickness}</span>
                    <select value={String(lineW)} onChange={e => setLineW(parseFloat(e.target.value))} className="h-7 bg-surface border border-border rounded px-1.5 text-foreground outline-none focus:border-accent">
                      <option value="1.25">{t.compare.thin}</option>
                      <option value="1.75">{t.compare.medium}</option>
                      <option value="2.5">{t.compare.thick}</option>
                    </select>
                  </label>
                </div>
              </div>
              <div>
                <div className="ui-label text-muted-fg mb-2">{t.compare.tableOpts}</div>
                <label className="flex items-center justify-between text-xs"><span className="text-foreground">{t.compare.highlight}</span><input type="checkbox" checked={highlight} onChange={e => setHighlight(e.target.checked)} className="accent-[var(--primary)]" /></label>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-border flex items-center justify-between sticky bottom-0 bg-surface">
              <button onClick={resetDefaults} className="text-xs text-muted-fg hover:text-foreground">{t.compare.reset}</button>
              <button onClick={() => setSettingsOpen(false)} className="text-xs px-3 py-1 rounded bg-primary text-primary-fg">{t.compare.done}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
