'use client'

import { useLayoutEffect, useRef, useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { StatusPill } from '@/components/ui/StatusPill'
import { MaterialityBadge } from '@/components/ui/MaterialityBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { SourceNote } from '@/components/ui/SourceNote'
import { LineChart, type ChartMarker } from '@/components/charts/LineChart'
import { getCompanyByTicker, getAllCompanies } from '@/lib/data/companies'
import { getSnapshotByTicker, getAllSnapshots } from '@/lib/data/stocks'
import { getEarningsByTicker } from '@/lib/data/earnings'
import { getHechosByTicker } from '@/lib/data/hechos'
import { fetchLiveNews, type NewsFetchResponse } from '@/lib/data/newsLive'
import { getNewsSourceCode, getNewsSourceColor } from '@/lib/news/sourceCodes'
import { getStockHistoryForTimeframe } from '@/lib/data/stockHistory'
import { formatCLP, formatPct, formatFx, formatMillionsCLP, formatEPS, formatNetDebt, formatMarketCapMM, changeColor, formatNewsTimestamp } from '@/lib/formatters'
import type { EarningsRelease, StockPriceSnapshot } from '@/types'
import { fetchLiveSnapshot, formatLiveTimestamp, type LiveSnapshot } from '@/lib/data/marketLiveData'
import { fetchStockSnapshot } from '@/lib/data/marketData'
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

const qualityVariant: Record<EarningsRelease['resultQuality'], 'positive' | 'warning' | 'negative' | 'neutral'> = {
  Clean: 'positive', Mixed: 'warning', Weak: 'negative', Pending: 'neutral',
}

export default function CompanyDetailPage() {
  const { ticker } = useParams<{ ticker: string }>()
  const { t } = useLang()
  const sym = (ticker ?? '').toUpperCase()
  const [chartTimeframe, setChartTimeframe] = usePersistentState<StockTimeframe>('cmi.chartTimeframe', '1Y')
  const [relative, setRelative] = usePersistentState<boolean>('cmi.chartRelative', false)
  const [live, setLive] = useState<LiveSnapshot | null>(null)
  // Supabase-persisted baseline (auto-loaded on mount, below live overlay in priority)
  const [supaSnap, setSupaSnap] = useState<StockSnapshot | null>(null)
  const [newsResult, setNewsResult] = useState<NewsFetchResponse | null>(null)

  useEffect(() => {
    if (!sym) return
    let mounted = true
    fetchStockSnapshot(sym).then(res => {
      if (mounted && res.data) setSupaSnap(res.data)
    }).catch(() => {})
    fetchLiveNews().then(res => {
      if (mounted && res) setNewsResult(res)
    }).catch(() => {})
    return () => { mounted = false }
  }, [sym])

  const doRefresh = useCallback(async () => {
    const [data, newsRes] = await Promise.all([fetchLiveSnapshot(), fetchLiveNews()])
    if (newsRes) setNewsResult(newsRes)
    if (!data) throw new Error('unavailable')
    setLive(data)
  }, [])

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
  const earnings = [...getEarningsByTicker(sym)]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    .slice(0, 6)
  const hechos   = getHechosByTicker(sym).slice(0, 6)
  const news     = (newsResult?.data ?? []).filter(n => n.affectedTickers.includes(sym)).slice(0, 4)
  const stockHistory = getStockHistoryForTimeframe(sym, chartTimeframe)
    .map(p => ({ date: p.date, value: p.price }))

  const periodChange = stockHistory.length >= 2
    ? ((stockHistory[stockHistory.length - 1].value - stockHistory[0].value) / stockHistory[0].value) * 100
    : null
  const lastPrice = stockHistory.length ? stockHistory[stockHistory.length - 1].value : snap?.price ?? null

  // Benchmark (IPSA) + rebased series for relative-performance mode
  const ipsaHistory = getStockHistoryForTimeframe('IPSA', chartTimeframe).map(p => ({ date: p.date, value: p.price }))
  const rebase = (arr: { date: string; value: number }[]) => {
    const base = arr[0]?.value || 1
    return arr.map(p => ({ date: p.date, value: (p.value / base) * 100 }))
  }
  const chartData = relative ? rebase(stockHistory) : stockHistory
  const compareData = relative && ipsaHistory.length >= 2 ? rebase(ipsaHistory) : undefined

  // Event markers: earnings + filings overlaid on the price line
  const markers: ChartMarker[] = [
    ...getEarningsByTicker(sym).filter(e => e.resultQuality !== 'Pending')
      .map(e => ({ date: e.reportDate, label: `${e.period} earnings`, kind: 'earnings' as const })),
    ...getHechosByTicker(sym).map(h => ({ date: h.date, label: `${h.filingType}: ${h.title}`, kind: 'filing' as const })),
  ]

  // Valuation context: sector medians
  const sectorOf = Object.fromEntries(getAllCompanies().map(c => [c.ticker, c.sector]))
  const peers = getAllSnapshots().filter(s => sectorOf[s.ticker] === company?.sector)
  const medStr = (key: keyof StockPriceSnapshot, suffix: string) => {
    const m = median(peers.map(p => p[key]).filter((n): n is number => typeof n === 'number'))
    return m != null ? `med ${Math.round(m * 10) / 10}${suffix}` : ''
  }

  const xMult = (n: number | null | undefined) => (n != null ? `${n}x` : '—')
  const pctVal = (n: number | null | undefined) => (n != null ? `${n}%` : '—')
  const valMetrics = [
    { label: t.company.val.peFwd,         val: xMult(snap?.peFwd),         med: medStr('peFwd', 'x') },
    { label: t.company.val.psFwd,         val: xMult(snap?.psFwd),         med: medStr('psFwd', 'x') },
    { label: t.company.val.evEbitda,      val: xMult(snap?.evEbitda),      med: medStr('evEbitda', 'x') },
    { label: t.company.val.opMargin,      val: pctVal(snap?.opMargin),     med: medStr('opMargin', '%') },
    { label: t.company.val.grossMargin,   val: pctVal(snap?.grossMargin),  med: medStr('grossMargin', '%') },
    { label: t.company.val.roe,           val: pctVal(snap?.roe),          med: medStr('roe', '%') },
    { label: t.company.val.fcfYield,      val: pctVal(snap?.fcfYield),     med: medStr('fcfYield', '%') },
    { label: t.company.val.pb,            val: xMult(snap?.pb),            med: medStr('pb', 'x') },
    { label: t.company.val.netDebtEbitda, val: xMult(snap?.netDebtEbitda), med: medStr('netDebtEbitda', 'x') },
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
  const livePrice  = lv?.price        ?? supaSnap?.price        ?? snap?.price
  const liveDayPct = lv?.dayChangePct ?? supaSnap?.dayChangePct ?? snap?.dayChangePct
  const liveTimestamp = live ? formatLiveTimestamp(live.lastUpdated) : null
  const priceStatus: DataSourceStatus = live ? 'live' : supaSnap ? 'persisted' : 'static'

  const kpis = [
    { label: t.company.kpis.lastPrice, value: livePrice != null ? formatCLP(livePrice) : '—',       unit: 'CLP', color: '' },
    { label: t.company.kpis.dayChg,   value: liveDayPct != null ? formatPct(liveDayPct) : '—',       unit: '',    color: liveDayPct != null ? changeColor(liveDayPct) : '' },
    { label: t.company.kpis.ytd,      value: snap ? formatPct(snap.ytdChangePct) : '—',              unit: '',    color: snap ? changeColor(snap.ytdChangePct) : '' },
    { label: t.company.kpis.marketCap,value: company.marketCapCLP ? formatMarketCapMM(company.marketCapCLP) : '—', unit: '', color: '' },
    { label: t.company.kpis.pe,       value: snap?.pe != null ? `${snap.pe}` : '—',                  unit: 'x',   color: '' },
    { label: t.company.kpis.divYield, value: snap?.dividendYield != null ? `${snap.dividendYield}` : '—', unit: '%', color: '' },
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
            <div className="flex items-center gap-1.5">
              <MarketDataSourceBadge status={priceStatus} />
              {liveTimestamp && (
                <span className="text-xs text-muted-fg ui-number whitespace-nowrap">{liveTimestamp}</span>
              )}
            </div>
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
      <div className="grid grid-cols-6 gap-3">
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

      {/* Business summary */}
      {company.businessSummary && (
        <div className="bg-surface border border-border rounded p-4">
          <div className="ui-label text-muted-fg mb-2">{t.company.businessSummary}</div>
          <p className="text-xs text-muted leading-relaxed">{company.businessSummary}</p>
        </div>
      )}

      {/* Business model / revenue drivers / risks — shown if available */}
      {(company.businessModel || company.keyRevenueDrivers || company.keyRisks) && (
        <div className="grid grid-cols-3 gap-4">
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
            <button
              onClick={() => setRelative(r => !r)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors mr-1 ${
                relative ? 'bg-surface-2 text-foreground border-border' : 'text-muted-fg border-transparent hover:text-foreground'
              }`}
              title="Relative to IPSA (rebased to 100)"
            >
              vs IPSA
            </button>
            <span className="w-px h-4 bg-border mr-1" />
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
            valueFormatter={relative ? (v) => v.toFixed(1) : priceFmt}
            compareData={compareData}
            compareLabel="IPSA"
            primaryLabel={sym}
            markers={markers}
          />
        ) : (
          <div className="h-36 flex items-center justify-center border border-border rounded">
            <span className="text-xs text-muted-fg">{t.common.noData}</span>
          </div>
        )}
        <div className="flex items-center justify-between mt-2 gap-3 flex-wrap">
          <p className="text-xs text-muted-fg">{t.company.stockChartSource}</p>
          <div className="flex items-center gap-3 text-xs text-muted-fg">
            <span className="flex items-center gap-1"><span style={{ color: 'var(--primary)' }}>▲</span>earnings</span>
            <span className="flex items-center gap-1"><span style={{ color: 'var(--warning)' }}>▲</span>filing</span>
          </div>
        </div>
      </div>

      {/* Recent results · Valuation · Filings — Valuation drives height, others scroll to match */}
      <div className="grid grid-cols-3 gap-4 items-start">

        {/* Recent results — shows ~3 rows, scroll for the rest */}
        <div className="bg-surface border border-border rounded flex flex-col overflow-hidden" style={{ height: valH || undefined }}>
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
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.period}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.revenue}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.ebitda}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.income}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.eps}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.netDebt}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.earnings.resultQuality}</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map(e => (
                    <tr key={e.id} className="border-b border-border last:border-0">
                      <td className="py-2 px-2 text-center text-muted-fg whitespace-nowrap">{e.period}</td>
                      <td className="py-2 px-2 text-center ui-number text-foreground">{e.revenue != null ? formatMillionsCLP(e.revenue) : '—'}</td>
                      <td className="py-2 px-2 text-center ui-number text-foreground">{e.ebitda != null ? formatMillionsCLP(e.ebitda) : '—'}</td>
                      <td className={`py-2 px-2 text-center ui-number ${e.netIncome != null && e.netIncome < 0 ? 'text-negative' : 'text-foreground'}`}>{e.netIncome != null ? formatMillionsCLP(e.netIncome) : '—'}</td>
                      <td className={`py-2 px-2 text-center ui-number ${e.eps != null && e.eps < 0 ? 'text-negative' : 'text-foreground'}`}>{formatEPS(e.eps)}</td>
                      <td className="py-2 px-2 text-center ui-number text-foreground">{formatNetDebt(e.netDebt)}</td>
                      <td className="py-2 px-2 text-center"><StatusPill label={e.resultQuality} variant={qualityVariant[e.resultQuality]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-3 text-xs text-muted-fg">{t.company.noData}</p>
          )}
          <div className="px-4 py-2 border-t border-border shrink-0">
            <p className="text-xs text-muted-fg">{t.company.earningsFootnote}</p>
          </div>
        </div>

        {/* Valuation — 3x3 metric grid (natural height, drives the row, no scroll) */}
        <div ref={valRef} className="bg-surface border border-border rounded flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border shrink-0">
            <span className="ui-label text-muted-fg">{t.company.valuation}</span>
          </div>
          <div className="p-2">
            <div className="grid grid-cols-3 gap-2">
              {valMetrics.map(({ label, val, med }) => (
                <div key={label} className="border border-border rounded flex flex-col items-center justify-center text-center px-1 py-1.5">
                  <div className="ui-label text-muted-fg mb-0.5" style={{ fontSize: '9px' }}>{label}</div>
                  <div className="text-sm ui-number text-foreground">{val}</div>
                  {med && <div className="ui-number text-muted-fg" style={{ fontSize: '9px' }}>{med}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Filings — centered columns, scroll */}
        <div className="bg-surface border border-border rounded flex flex-col overflow-hidden" style={{ height: valH || undefined }}>
          <div className="px-4 py-2.5 border-b border-border shrink-0">
            <span className="ui-label text-muted-fg">{t.company.relatedHechos}</span>
          </div>
          {hechos.length > 0 ? (
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.date}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.type}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.hechos.cols.materiality}</th>
                    <th className="text-center py-2 px-2 ui-table-header text-muted-fg">{t.company.cols.desc}</th>
                  </tr>
                </thead>
                <tbody>
                  {hechos.map(h => (
                    <tr key={h.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                      <td className="py-2 px-2 text-center ui-number text-muted-fg whitespace-nowrap">{h.date}</td>
                      <td className="py-2 px-2 text-center"><StatusPill label={h.filingType} variant={h.filingType === 'HE' ? 'info' : 'neutral'} /></td>
                      <td className="py-2 px-2 text-center"><MaterialityBadge materiality={h.materiality} /></td>
                      <td className="py-2 px-2 text-center max-w-[160px]"><span className="block truncate text-foreground" title={h.title}>{h.title}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-3 text-xs text-muted-fg">{t.common.noData}</p>
          )}
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

      <SourceNote>{t.common.mvpNote}</SourceNote>
    </div>
  )
}
