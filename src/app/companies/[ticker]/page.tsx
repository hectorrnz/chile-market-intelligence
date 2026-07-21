'use client'

import { useLayoutEffect, useRef, useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { LineChart, type ChartMarker } from '@/components/charts/LineChart'
import { getCompanyByTicker, getAllCompanies } from '@/lib/data/companies'
import { getSnapshotByTicker, getAllSnapshots } from '@/lib/data/stocks'
import { fetchEarningsResults, type EarningsResultsPayload } from '@/lib/data/earningsResults'
import { fetchEarningsCalendar, type EarningsCalendarResult } from '@/lib/data/earningsCalendar'
import { fetchLiveNews, type NewsFetchResponse } from '@/lib/data/newsLive'
import { getNewsSourceCode, getNewsSourceColor } from '@/lib/news/sourceCodes'
import { getStockHistoryForTimeframe } from '@/lib/data/stockHistory'
import { formatCLP, formatPct, formatFx, formatMarketCapMM, changeColor, formatNewsTimestamp } from '@/lib/formatters'
import type { StockPriceSnapshot } from '@/types'
import { useMarketData } from '@/components/providers/MarketDataProvider'
import { useGlobalRefresh } from '@/components/providers/useGlobalRefresh'
import { fetchStockSnapshot, fetchStockHistory } from '@/lib/data/marketData'
import { fetchValuation } from '@/lib/data/valuation'
import type { ValuationResult, CompareFundamentalKey } from '@/lib/compare/compareTypes'
import type { StockSnapshot } from '@/lib/providers/market/types'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import type { DataSourceStatus } from '@/lib/providers/types'

const median = (xs: number[]): number | null => {
  const v = xs.filter(n => n != null).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

type StockTimeframe = '1D' | '5D' | '1M' | 'MTD' | 'YTD' | '1Y' | '3Y' | '5Y'

const priceFmt = (v: number) => `${formatFx(v, v < 1000 ? 2 : 0)} CLP`
const STOCK_TIMEFRAMES: StockTimeframe[] = ['1D', '5D', '1M', 'MTD', 'YTD', '1Y', '3Y', '5Y']

// Measured-height pinning via CSS var + `lg:h-(--pin-h)` — only binds while the
// 2-column row is active; stacked cards below lg keep natural height.
const pinH = (px: number): React.CSSProperties | undefined =>
  px ? ({ ['--pin-h' as string]: `${px}px` } as React.CSSProperties) : undefined

/** Millions of the row's own reporting currency (same helper as the Earnings tab). */
const fmtMM = (v: number | null): string =>
  v == null ? '—' : v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** EPS in the row's reporting currency; 4dp below 1.0 (USD reporters with huge share counts). */
const fmtEps = (v: number | null): string => {
  if (v == null) return '—'
  const d = Math.abs(v) < 1 ? 4 : 2
  return v.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function CompanyDetailPage() {
  const { ticker } = useParams<{ ticker: string }>()
  const { t } = useLang()
  const sym = (ticker ?? '').toUpperCase()
  const [chartTimeframe, setChartTimeframe] = usePersistentState<StockTimeframe>('cmi.chartTimeframe', '1Y')
  // Live market snapshot is shared platform-wide (see MarketDataProvider) — Update
  // on any tab refreshes it, and it survives navigating away from this page.
  const { live } = useMarketData()
  // One Update refreshes every live domain, on every tab — see useGlobalRefresh.
  const refresh = useGlobalRefresh()
  // Supabase-persisted baseline (auto-loaded on mount, below live overlay in priority)
  const [supaSnap, setSupaSnap] = useState<StockSnapshot | null>(null)
  // Live valuation (price, market cap, P/E, P/S, margins, ROE, …) from Yahoo —
  // same resolver Compare uses, so the two agree. Drives the Valuation table +
  // the P/E / Div Yield / Market Cap / YTD KPIs for EVERY ticker.
  const [valuation, setValuation] = useState<ValuationResult | null>(null)
  const [newsResult, setNewsResult] = useState<NewsFetchResponse | null>(null)
  // Real reported quarterly financials (same live Yahoo resolver the Earnings
  // tab uses) + the CMF earnings calendar (real EEFF report dates, for the
  // chart's earnings markers). Replaces the fabricated static earnings.json
  // rows and their editorial Clean/Mixed/Weak "Quality" pills — the exact
  // machinery the Earnings-tab rewrite removed as fabricated.
  const [earningsResults, setEarningsResults] = useState<EarningsResultsPayload | null>(null)
  const [earningsCal, setEarningsCal] = useState<EarningsCalendarResult | null>(null)
  // Real historical price data (live Yahoo Finance fetch, Supabase-persisted
  // accumulation as fallback — see resolveStockHistory in marketProvider.ts),
  // keyed by ticker so both the primary series and the IPSA benchmark can be
  // held at once. Falls back to the static quarterly series (below) only when
  // neither the live nor persisted tier came back with enough points for the
  // selected timeframe.
  type ChartHistoryEntry = { points: { date: string; value: number }[]; status: 'live' | 'persisted'; asOf: string | null }
  // Partial<Record<...>> (not a bare Record) so indexed access is correctly
  // typed 'ChartHistoryEntry | undefined' — a bare Record would tell
  // TypeScript every key is always present, collapsing `liveStockHistory?.status
  // ?? 'static'` to just 'live' | 'persisted' (the 'static' fallback treated
  // as unreachable) and breaking the chartStatus !== 'static' check below.
  const [chartHistory, setChartHistory] = useState<Partial<Record<string, ChartHistoryEntry>>>({})

  useEffect(() => {
    if (!sym) return
    let mounted = true
    fetchStockSnapshot(sym).then(res => {
      if (mounted && res.data) setSupaSnap(res.data)
    }).catch(() => {})
    fetchLiveNews().then(res => {
      if (mounted && res) setNewsResult(res)
    }).catch(() => {})
    fetchEarningsResults(false).then(res => {
      if (mounted && res) setEarningsResults(res)
    }).catch(() => {})
    fetchEarningsCalendar().then(res => {
      if (mounted && res) setEarningsCal(res)
    }).catch(() => {})
    return () => { mounted = false }
  }, [sym])

  // Live valuation — re-fetched when the shared snapshot refreshes (an Update on
  // any tab) so the Valuation table + KPIs stay current for every ticker.
  useEffect(() => {
    if (!sym) return
    let mounted = true
    fetchValuation(sym).then(res => { if (mounted) setValuation(res) }).catch(() => {})
    return () => { mounted = false }
  }, [sym, live?.lastUpdated])

  useEffect(() => {
    if (!sym) return
    let mounted = true
    fetchStockHistory(sym, chartTimeframe)
      .then(res => {
        if (!mounted) return
        const fetched = res.metadata.status === 'live' || res.metadata.status === 'persisted'
        setChartHistory(prev => {
          const next = { ...prev }
          if (fetched && res.data.length >= 2) {
            next[sym] = {
              points: res.data.map(p => ({ date: p.date, value: p.close })),
              status: res.metadata.status as 'live' | 'persisted',
              asOf: res.metadata.lastUpdated || null,
            }
          } else {
            delete next[sym]
          }
          return next
        })
      })
      .catch(() => {})
    return () => { mounted = false }
    // live?.lastUpdated: keep the chart current when Update is clicked anywhere.
  }, [sym, chartTimeframe, live?.lastUpdated])

  const doRefresh = useCallback(async () => {
    const [, newsRes, resultsRes] = await Promise.all([
      refresh(),
      fetchLiveNews().catch(() => null),
      // force=true skips the resolver's 6h cache — same as the Earnings tab's Update.
      fetchEarningsResults(true).catch(() => null),
    ])
    if (newsRes) setNewsResult(newsRes)
    if (resultsRes) setEarningsResults(resultsRes)
  }, [refresh])

  // Valuation card (natural height) drives the Results · Valuation · Filings row;
  // the other two cards match it and scroll (replaces the old fixed 300px).
  const valRef = useRef<HTMLDivElement>(null)
  const [valH, setValH] = useState(0)
  useLayoutEffect(() => {
    const el = valRef.current
    if (!el) return
    const update = () => setValH(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const company  = getCompanyByTicker(sym)
  const snap     = getSnapshotByTicker(sym)
  // Live rows only (rolling two most recent reported quarters, same data as the
  // Earnings tab). An unavailable fetch leaves the card honestly empty/loading —
  // never the fabricated static sample.
  const earnings = earningsResults?.status === 'live'
    ? earningsResults.rows.filter(r => r.ticker === sym)
    : []
  const news     = (newsResult?.data ?? []).filter(n => n.affectedTickers.includes(sym)).slice(0, 4)
  const liveStockHistory = chartHistory[sym]
  const stockHistory = liveStockHistory && liveStockHistory.points.length >= 2
    ? liveStockHistory.points
    : getStockHistoryForTimeframe(sym, chartTimeframe).map(p => ({ date: p.date, value: p.price }))
  const chartStatus: 'live' | 'persisted' | 'static' = liveStockHistory?.status ?? 'static'

  const periodChange = stockHistory.length >= 2
    ? ((stockHistory[stockHistory.length - 1].value - stockHistory[0].value) / stockHistory[0].value) * 100
    : null
  const lastPrice = stockHistory.length ? stockHistory[stockHistory.length - 1].value : snap?.price ?? null
  const chartData = stockHistory

  // Event markers: REAL CMF EEFF report dates for this ticker (past only),
  // replacing the fabricated static earnings.json dates. Tickers absent from
  // the CMF calendar (BSANTANDER, ITAUCL) honestly get no markers.
  const todayIso = new Date().toISOString().slice(0, 10)
  const markers: ChartMarker[] = earningsCal?.status === 'live'
    ? earningsCal.events
        .filter(e => e.ticker === sym && e.reportDate <= todayIso)
        .map(e => ({ date: e.reportDate, label: `${e.period} EEFF` }))
    : []

  // Valuation context: sector medians
  const sectorOf = Object.fromEntries(getAllCompanies().map(c => [c.ticker, c.sector]))
  const peers = getAllSnapshots().filter(s => sectorOf[s.ticker] === company?.sector)
  const medStr = (key: keyof StockPriceSnapshot, suffix: string) => {
    const m = median(peers.map(p => p[key]).filter((n): n is number => typeof n === 'number'))
    return m != null ? `med ${Math.round(m * 10) / 10}${suffix}` : ''
  }

  const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10)
  const xMult = (n: number | null | undefined) => { const v = r1(n); return v != null ? `${v}x` : '—' }
  const pctVal = (n: number | null | undefined) => { const v = r1(n); return v != null ? `${v}%` : '—' }
  // Live Yahoo valuation ONLY. `lf` returns a field's value solely when it's a
  // real live/persisted figure (in derivedFields) — never the fabricated static
  // snapshot layer buildFundamentals falls back to — so a field Yahoo can't
  // provide for this ticker (EV/EBITDA, gross margin, FCF for a bank) honestly
  // shows "—". Same figures as the Compare tab. Works for every ticker.
  const vf = valuation?.fundamentals
  const lf = (key: CompareFundamentalKey): number | null =>
    vf && vf.derivedFields.includes(key) ? (vf[key] ?? null) : null
  const valMetrics = [
    { label: t.company.val.peFwd,         val: xMult(lf('pe')),            med: medStr('peFwd', 'x') },
    { label: t.company.val.psFwd,         val: xMult(lf('psFwd')),         med: medStr('psFwd', 'x') },
    { label: t.company.val.evEbitda,      val: xMult(lf('evEbitda')),      med: medStr('evEbitda', 'x') },
    { label: t.company.val.opMargin,      val: pctVal(lf('opMargin')),     med: medStr('opMargin', '%') },
    { label: t.company.val.grossMargin,   val: pctVal(lf('grossMargin')),  med: medStr('grossMargin', '%') },
    { label: t.company.val.roe,           val: pctVal(lf('roe')),          med: medStr('roe', '%') },
    { label: t.company.val.fcfYield,      val: pctVal(lf('fcfYield')),     med: medStr('fcfYield', '%') },
    { label: t.company.val.pb,            val: xMult(lf('pb')),            med: medStr('pb', 'x') },
    { label: t.company.val.netDebtEbitda, val: xMult(lf('netDebtEbitda')), med: medStr('netDebtEbitda', 'x') },
  ]

  if (!company) {
    return (
      <div className="w-full">
        <div className="text-xs text-muted-fg mb-4 flex items-center gap-1.5">
          <Link href="/stocks" className="hover:text-foreground transition-colors">{t.company.breadcrumb}</Link>
          <span>/</span>
          <span className="font-mono text-primary">{sym}</span>
        </div>
        <EmptyState message={t.company.noData} />
      </div>
    )
  }

  const lv = live?.stocks[sym]
  const livePrice  = lv?.price        ?? valuation?.latestPrice ?? supaSnap?.price        ?? snap?.price
  const liveDayPct = lv?.dayChangePct ?? supaSnap?.dayChangePct ?? snap?.dayChangePct
  const priceStatus: DataSourceStatus = live ? 'live' : (valuation?.marketDataStatus ?? (supaSnap ? 'persisted' : 'static'))
  const priceAsOf = live ? live.lastUpdated : (supaSnap?.lastUpdated ?? null)

  // Live valuation drives the YTD / Market Cap / P/E / Div Yield KPIs — live
  // only (no static snapshot), so nothing here is frozen sample data. They show
  // "—" for the brief moment before the live fetch resolves, then populate.
  const ytdVal = valuation?.ytdChangePct ?? null
  const mktCapVal = valuation?.marketCapCLP ?? null
  const peVal = lf('pe')
  const divVal = lf('dividendYield')
  const kpis = [
    { label: t.company.kpis.lastPrice, value: livePrice != null ? formatCLP(livePrice) : '—',       unit: 'CLP', color: '' },
    { label: t.company.kpis.dayChg,   value: liveDayPct != null ? formatPct(liveDayPct) : '—',       unit: '',    color: liveDayPct != null ? changeColor(liveDayPct) : '' },
    { label: t.company.kpis.ytd,      value: ytdVal != null ? formatPct(ytdVal) : '—',               unit: '',    color: ytdVal != null ? changeColor(ytdVal) : '' },
    { label: t.company.kpis.marketCap,value: mktCapVal != null ? formatMarketCapMM(mktCapVal) : '—', unit: '', color: '' },
    { label: t.company.kpis.pe,       value: peVal != null ? `${peVal}` : '—',                       unit: 'x',   color: '' },
    { label: t.company.kpis.divYield, value: divVal != null ? `${divVal}` : '—',                     unit: '%', color: '' },
  ]

  return (
    <div className="w-full space-y-4">

      {/* Breadcrumb */}
      <div className="text-xs text-muted-fg flex items-center gap-1.5">
        <Link href="/stocks" className="hover:text-foreground transition-colors">{t.company.breadcrumb}</Link>
        <span>/</span>
        <span className="font-mono text-primary">{sym}</span>
      </div>

      <SectionHeader
        tag={sym}
        title={company.name}
        subtitle={`${company.sector} · ${company.industry} · ${company.exchange}`}
        actions={
          <>
            <UpdateDataButton onRefresh={doRefresh} />
            <MarketDataSourceBadge status={priceStatus} />
            <button
              onClick={() => window.print()}
              className="no-print flex items-center gap-1.5 h-7 px-2.5 rounded border border-border bg-surface text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
            >
              <span aria-hidden>⎙</span>{t.common.print}
            </button>
            <Link
              href="/watchlist"
              className="flex items-center gap-1.5 h-7 px-2.5 rounded border border-border bg-surface text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
            >
              {t.company.watchlistPill}
            </Link>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map(({ label, value, unit, color }) => (
          <div key={label} className="bg-surface border border-border rounded p-3">
            <div className="text-xs text-muted mb-1 leading-tight">{label}</div>
            <div className={`text-sm ui-number ${color || 'text-foreground'}`}>
              {value}
              {unit && <span className="text-xs text-muted-fg ml-1">{unit}</span>}
            </div>
          </div>
        ))}
      </div>
      <TableSourceFooter source={t.stocks.footer} asOf={priceAsOf} className="-mt-2" />

      {/* Business summary */}
      {company.businessSummary && (
        <div className="bg-surface border border-border rounded p-4">
          <div className="ui-label text-muted-fg mb-2">{t.company.businessSummary}</div>
          <p className="text-xs text-muted leading-relaxed">{company.businessSummary}</p>
        </div>
      )}

      {/* Business model / revenue drivers / risks — shown if available */}
      {(company.businessModel || company.keyRevenueDrivers || company.keyRisks) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {company.businessModel && (
            <div className="bg-surface border border-border rounded p-4">
              <div className="ui-label text-muted-fg mb-2">{t.company.businessModel}</div>
              <p className="text-xs text-muted leading-relaxed">{company.businessModel}</p>
            </div>
          )}
          {company.keyRevenueDrivers && company.keyRevenueDrivers.length > 0 && (
            <div className="bg-surface border border-border rounded p-4">
              <div className="ui-label text-muted-fg mb-2">{t.company.keyRevenueDrivers}</div>
              <ul className="space-y-1">
                {company.keyRevenueDrivers.map((d, i) => (
                  <li key={i} className="text-xs text-muted leading-snug flex gap-1.5">
                    <span className="text-muted-fg shrink-0">·</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {company.keyRisks && company.keyRisks.length > 0 && (
            <div className="bg-surface border border-border rounded p-4">
              <div className="ui-label text-muted-fg mb-2">{t.company.keyRisks}</div>
              <ul className="space-y-1">
                {company.keyRisks.map((r, i) => (
                  <li key={i} className="text-xs text-muted leading-snug flex gap-1.5">
                    <span className="text-negative shrink-0">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Price chart */}
      <div className="bg-surface border border-border rounded p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="ui-label text-muted-fg mb-1">{t.company.priceHistory} — {sym}</div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-xl ui-number font-semibold text-foreground">
                {lastPrice != null ? formatFx(lastPrice, lastPrice < 1000 ? 2 : 0) : '—'}
                <span className="text-xs text-muted-fg ml-1">CLP</span>
              </span>
              {periodChange != null && (
                <span className={`text-sm ui-number ${changeColor(periodChange)}`}>
                  {formatPct(periodChange)}
                  <span className="text-xs text-muted-fg ml-1">{chartTimeframe}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {STOCK_TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setChartTimeframe(tf)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  chartTimeframe === tf
                    ? 'bg-surface-2 text-foreground border border-border'
                    : 'text-muted-fg hover:text-foreground'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        {stockHistory.length >= 2 ? (
          <LineChart
            data={chartData}
            unit=""
            height={240}
            valueFormatter={priceFmt}
            primaryLabel={sym}
            markers={markers}
          />
        ) : (
          <div className="h-36 flex items-center justify-center border border-border rounded">
            <span className="text-xs text-muted-fg">{t.common.noData}</span>
          </div>
        )}
        <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
          <TableSourceFooter
            source={chartStatus !== 'static' ? t.stocks.footer : t.company.stockChartSource}
            asOf={liveStockHistory?.asOf ?? null}
          />
          {markers.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-fg">
              <span className="flex items-center gap-1"><span style={{ color: 'var(--primary)' }}>▲</span>EEFF</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent results · Valuation — Valuation drives height, Results scrolls to match */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* Recent results — shows ~3 rows, scroll for the rest */}
        <div className="bg-surface border border-border rounded flex flex-col overflow-hidden lg:h-(--pin-h)" style={pinH(valH)}>
          <div className="px-4 py-2.5 border-b border-border shrink-0 flex items-center justify-between gap-2">
            <span className="ui-label text-muted-fg">{t.company.earnings}</span>
            <Link
              href="/chart-builder"
              onClick={() => { try { localStorage.setItem('cmi.gfTicker', JSON.stringify(sym)) } catch {} ; window.dispatchEvent(new CustomEvent('gf:ticker', { detail: sym })) }}
              className="text-xs text-primary hover:underline whitespace-nowrap"
            >
              {t.charting.open}
            </Link>
          </div>
          {earnings.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-xs min-w-[520px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.cols.period}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.currency}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.cols.revenue}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.cols.revenueYoy}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.cols.ebitda}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.cols.netIncome}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.cols.netIncomeYoy}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.cols.eps}</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map(e => (
                    <tr key={`${e.ticker}-${e.periodEnd}`} className="border-b border-border last:border-0">
                      <td className="py-2 px-2 text-center text-muted-fg whitespace-nowrap">{e.period}</td>
                      <td className="py-2 px-2 text-center text-muted-fg">{e.currency}</td>
                      <td className="py-2 px-2 text-center ui-number text-foreground">{fmtMM(e.revenue)}</td>
                      <td className={`py-2 px-2 text-center ui-number ${e.revenueYoY != null ? changeColor(e.revenueYoY) : 'text-muted-fg'}`}>{e.revenueYoY != null ? formatPct(e.revenueYoY) : '—'}</td>
                      <td className="py-2 px-2 text-center ui-number text-foreground" title={e.isBank ? t.earnings.bankNoEbitda : undefined}>{fmtMM(e.ebitda)}</td>
                      <td className={`py-2 px-2 text-center ui-number ${e.netIncome != null && e.netIncome < 0 ? 'text-negative' : 'text-foreground'}`}>{fmtMM(e.netIncome)}</td>
                      <td className={`py-2 px-2 text-center ui-number ${e.netIncomeYoY != null ? changeColor(e.netIncomeYoY) : 'text-muted-fg'}`}>{e.netIncomeYoY != null ? formatPct(e.netIncomeYoY) : '—'}</td>
                      <td className={`py-2 px-2 text-center ui-number ${e.eps != null && e.eps < 0 ? 'text-negative' : 'text-foreground'}`}>{fmtEps(e.eps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-3 text-xs text-muted-fg">{earningsResults === null ? t.common.loading : t.company.noData}</p>
          )}
          <div className="px-4 py-2 border-t border-border shrink-0">
            <TableSourceFooter source={t.stocks.footer} asOf={earningsResults?.status === 'live' ? (earningsResults.asOf ?? null) : null} />
            <p className="text-xs text-muted-fg">{t.earnings.amountsNote}</p>
          </div>
        </div>

        {/* Valuation — 3x3 metric grid (natural height, drives the row, no scroll) */}
        <div ref={valRef} className="bg-surface border border-border rounded flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border shrink-0">
            <span className="ui-label text-muted-fg">{t.company.valuation}</span>
          </div>
          <div className="p-2">
            {valuation === null ? (
              <div className="py-8 text-center text-xs text-muted-fg">{t.common.loading}</div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {valMetrics.map(({ label, val, med }) => (
                  <div key={label} className="border border-border rounded flex flex-col items-center justify-center text-center px-1 py-1.5">
                    <div className="ui-label text-muted-fg mb-0.5" style={{ fontSize: '9px' }}>{label}</div>
                    <div className="text-sm ui-number text-foreground">{val}</div>
                    {med && <div className="ui-number text-muted-fg" style={{ fontSize: '9px' }}>{med}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="px-4 py-2 border-t border-border shrink-0">
            <TableSourceFooter source={t.stocks.footer} />
          </div>
        </div>
      </div>

      {/* Recent news */}
      {news.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-2">
            <span className="ui-label text-muted-fg">{t.company.recentNews}</span>
          </div>
          <div className="divide-y divide-border">
            {news.map(item => {
              const isHigh = item.impactLevel === 'High'
              return (
                <div key={item.id} className="py-1.5">
                  <div
                    className={`flex items-start justify-between gap-3 px-4 ${isHigh ? 'py-1' : ''}`}
                    style={isHigh ? { backgroundColor: 'var(--negative)' } : undefined}
                  >
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline min-w-0">
                      <p className="text-xs leading-snug font-medium" style={isHigh ? { color: '#fff' } : undefined}>{item.headline}</p>
                    </a>
                    <span className="flex items-center gap-1.5 shrink-0 whitespace-nowrap pt-px">
                      <span className="ui-number text-[10px] font-mono font-semibold" title={item.source} style={isHigh ? { color: '#fff' } : { color: getNewsSourceColor(item.source) }}>{getNewsSourceCode(item.source)}</span>
                      <span className="ui-number text-xs" style={isHigh ? { color: '#fff' } : { color: 'var(--muted-fg)' }}>{formatNewsTimestamp(item.publishedAt)}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
