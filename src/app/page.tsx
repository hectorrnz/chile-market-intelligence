'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { StatusPill } from '@/components/ui/StatusPill'
import { AsOfBadge } from '@/components/ui/AsOfBadge'
import { DataSourceBadge } from '@/components/ui/DataSourceBadge'
import type { DataSourceStatus } from '@/lib/providers/types'
import { getAllCompanies } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { getAllIndicators, fetchMacroIndicators } from '@/lib/data/macro'
import { getChileanRates } from '@/lib/data/chileanRates'
import { getFxBySection } from '@/lib/data/fxRates'
import { getRecentHechos } from '@/lib/data/hechos'
import { getUpcomingEarnings, getRecentResults } from '@/lib/data/earnings'
import { getAllNews } from '@/lib/data/news'
import { getDocumentByRelatedId } from '@/lib/data/documents'
import { getSectorPerformance } from '@/lib/data/sectorPerformance'
import { getIndexPerformance } from '@/lib/data/indexPerformance'
import { formatMarketLastUpdated } from '@/lib/data/marketMeta'
import { fetchLiveSnapshot, formatLiveTimestamp, type LiveSnapshot } from '@/lib/data/marketLiveData'
import { fetchStockSnapshots, fetchSectorPerformance, fetchIndexPerformance } from '@/lib/data/marketData'
import type { StockSnapshot, SectorSnapshot, IndexSnapshot } from '@/lib/providers/market/types'
import { MarketRefreshButton } from '@/components/ui/MarketRefreshButton'
import { formatCLP, formatPct, formatMacroValue, formatMacroChange, formatFx, changeColor } from '@/lib/formatters'
import type { MacroIndicator, FxRate, ChileanRate } from '@/types'

const qualityVariant = {
  Clean: 'positive', Mixed: 'warning', Weak: 'negative', Pending: 'neutral',
} as const

const FX_SECTION_LABEL: Record<FxRate['section'], 'fxKeyFx' | 'fxUsdPer' | 'fxPerUsd' | 'fxYenPer'> = {
  'Key FX': 'fxKeyFx',
  '# USD per': 'fxUsdPer',
  '# of currency per USD': 'fxPerUsd',
  '# of Yen per': 'fxYenPer',
}

const CHILE_MACRO_IDS = ['tpm', 'ipc-anual', 'usdclp', 'imacec-anual', 'pib', 'desempleo']
const US_MACRO_IDS = ['fed-funds', 'us10y', 'us-cpi-anual', 'us-gdp', 'us-unemployment', 'dxy']

function MacroRow({ ind }: { ind: MacroIndicator }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-xs text-muted">{ind.shortName}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-xs ui-number text-foreground">{formatMacroValue(ind.value, ind.unit)}</span>
        {ind.changeLabel && (
          <span className={`text-xs ui-number ${ind.change != null ? changeColor(ind.change) : 'text-muted-fg'}`}>
            ({formatMacroChange(ind.changeLabel)})
          </span>
        )}
      </div>
    </div>
  )
}

/** Strong-contrast heat-map tile shading: extremes saturate, mid-range stays light. */
function sectorTileStyle(pct: number, maxAbs: number) {
  if (pct === 0 || maxAbs === 0) return {}
  const intensity = 14 + (Math.abs(pct) / maxAbs) * 40 // 14% … 54%
  const color = pct > 0 ? 'var(--positive)' : 'var(--negative)'
  return { backgroundColor: `color-mix(in oklab, ${color} ${intensity.toFixed(0)}%, var(--surface))` }
}

export default function HomePage() {
  const { t } = useLang()

  const companies = getAllCompanies()
  const snapshots = getAllSnapshots()
  const allIndicators = getAllIndicators()
  const byId = (id: string) => allIndicators.find(i => i.id === id)
  const macroChile = CHILE_MACRO_IDS.map(byId).filter(Boolean) as MacroIndicator[]
  const macroUs = US_MACRO_IDS.map(byId).filter(Boolean) as MacroIndicator[]
  const fxGroups = getFxBySection()
  const recentHechos = getRecentHechos(8)
  const upcoming = getUpcomingEarnings().slice(0, 2)
  const recent = getRecentResults().slice(0, 2)
  const news = getAllNews()
  const staticSectors = getSectorPerformance()
  const staticIndices = getIndexPerformance()
  const marketUpdated = formatMarketLastUpdated()

  // Live market data state — null until user hits Refresh
  const [live, setLive] = useState<LiveSnapshot | null>(null)
  // Supabase-persisted baseline (auto-loaded on mount, below live overlay in priority)
  const [supaStockMap, setSupaStockMap] = useState<Record<string, StockSnapshot>>({})
  const [supaSectors, setSupaSectors] = useState<SectorSnapshot[] | null>(null)
  const [supaIdxMap, setSupaIdxMap] = useState<Record<string, IndexSnapshot>>({})

  useEffect(() => {
    let mounted = true
    Promise.all([
      fetchStockSnapshots().catch(() => null),
      fetchSectorPerformance().catch(() => null),
      fetchIndexPerformance().catch(() => null),
    ]).then(([stRes, secRes, idxRes]) => {
      if (!mounted) return
      if (stRes?.data.length) setSupaStockMap(Object.fromEntries(stRes.data.map(s => [s.ticker, s])))
      if (secRes?.data.length) setSupaSectors(secRes.data)
      if (idxRes?.data.length) setSupaIdxMap(Object.fromEntries(idxRes.data.map(i => [i.id, i])))
    })
    return () => { mounted = false }
  }, [])

  const doRefresh = useCallback(async () => {
    const data = await fetchLiveSnapshot()
    if (!data) throw new Error('unavailable')
    setLive(data)
  }, [])

  // Merge: static base → Supabase layer → live overlay (live always wins when present)
  const sectors = live?.sectors ?? supaSectors ?? staticSectors
  const indices = staticIndices.map(idx => {
    const lv = live?.indices.find(l => l.id === idx.id)
    if (lv) return { ...idx, value: lv.value, dayChangePct: lv.dayChangePct, ytdChangePct: lv.ytdChangePct }
    const si = supaIdxMap[idx.id]
    return si ? { ...idx, value: si.value, dayChangePct: si.dayChangePct, ytdChangePct: si.ytdChangePct } : idx
  })
  const liveTimestamp = live ? formatLiveTimestamp(live.lastUpdated) : marketUpdated
  const maxSectorAbs = Math.max(...sectors.map(s => Math.abs(s.dayChangePct)))

  const snapshotMap = Object.fromEntries(snapshots.map(s => [s.ticker, s]))
  const trackedRows = companies.slice(0, 8).map(c => ({ company: c, snap: snapshotMap[c.ticker] }))

  // Drag-to-reorder Chilean rates (persisted to localStorage)
  const rates = getChileanRates()
  const [order, setOrder] = usePersistentState<string[]>('cmi.ratesOrder', rates.map(r => r.id))
  const orderedIds = [
    ...order.filter(id => rates.some(r => r.id === id)),
    ...rates.filter(r => !order.includes(r.id)).map(r => r.id),
  ]
  const rateOrder = orderedIds.map(id => rates.find(r => r.id === id)!) as ChileanRate[]
  const dragFrom = useRef<number | null>(null)
  const onDrop = (to: number) => {
    const from = dragFrom.current
    dragFrom.current = null
    if (from == null || from === to) return
    const ids = rateOrder.map(r => r.id)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    setOrder(ids)
  }

  // Macro card drives the top region's height; tracked/FX and earnings/hechos
  // columns match it and scroll internally.
  const macroRef = useRef<HTMLDivElement>(null)
  const [macroH, setMacroH] = useState(0)
  useLayoutEffect(() => {
    const el = macroRef.current
    if (!el) return
    const update = () => setMacroH(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Phase 4A: subtle macro source/status badge. Status-only fetch (the Home
  // macro panel stays static for stability; the Macro page does the live swap).
  const [macroStatus, setMacroStatus] = useState<DataSourceStatus>('static')
  useEffect(() => {
    const ac = new AbortController()
    fetchMacroIndicators(undefined, ac.signal).then(res => { if (res) setMacroStatus(res.metadata.status) })
    return () => ac.abort()
  }, [])

  // Heat map drives the second region's height; rates & markets match it exactly.
  const heatRef = useRef<HTMLDivElement>(null)
  const [heatH, setHeatH] = useState(0)
  useLayoutEffect(() => {
    const el = heatRef.current
    if (!el) return
    const update = () => setHeatH(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])


  return (
    <div className="w-full space-y-4">

      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="ui-label text-muted-fg mb-1">{t.home.tag}</div>
          <h1 className="text-xl font-semibold text-foreground">{t.home.title}</h1>
          <p className="text-xs text-muted mt-0.5">{t.home.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <AsOfBadge />
          <StatusPill label={t.topbar.mvp} variant="warning" />
        </div>
      </div>

      {/* ── Top region: Macro · (Tracked stocks + FX) · (Earnings + Hechos) ── */}
      {/* Macro card (natural height) drives the region; the other columns match it and scroll. */}
      <div className="grid grid-cols-3 gap-4 items-start">

        {/* Column 1 — Macro Chile + US (one card, highlighted region bands) */}
        <div ref={macroRef} className="bg-surface border border-border rounded flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
            <span className="ui-label text-muted-fg">{t.home.macroTitle.split('·')[0].trim()}</span>
            <DataSourceBadge status={macroStatus} />
          </div>
          <div>
            <div className="px-4 py-1.5 bg-surface-2 border-y border-border" style={{ borderLeft: '2px solid var(--accent)' }}>
              <span className="ui-label text-foreground">Chile</span>
            </div>
            <div className="px-4">{macroChile.map(ind => <MacroRow key={ind.id} ind={ind} />)}</div>
            <div className="px-4 py-1.5 bg-surface-2 border-y border-border" style={{ borderLeft: '2px solid var(--primary)' }}>
              <span className="ui-label text-foreground">{t.home.macroUsTitle.split('·')[1]?.trim() ?? 'US'}</span>
            </div>
            <div className="px-4">{macroUs.map(ind => <MacroRow key={ind.id} ind={ind} />)}</div>
          </div>
          <div className="px-4 py-2 border-t border-border shrink-0">
            <p className="text-xs text-muted-fg">{t.home.macroSource}</p>
          </div>
        </div>

        {/* Column 2 — Tracked stocks (max 5, scroll) + FX (fill, scroll) */}
        <div className="flex flex-col gap-4 min-h-0" style={{ height: macroH || undefined }}>
          <div className="bg-surface border border-border rounded overflow-hidden shrink-0 flex flex-col">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="ui-label text-muted-fg">{t.home.trackedStocks}</span>
                <MarketRefreshButton onRefresh={doRefresh} />
                {liveTimestamp && (
                  <span className="text-xs text-muted-fg ui-number whitespace-nowrap">{liveTimestamp}</span>
                )}
              </div>
              <Link href="/stocks" className="text-xs text-primary hover:underline">{t.stocks.title} →</Link>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 190 }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-2 z-10">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pl-4 pr-3 ui-table-header text-muted-fg">{t.home.ticker}</th>
                    <th className="text-left py-2 px-3 ui-table-header text-muted-fg">{t.home.company}</th>
                    <th className="text-right py-2 px-3 ui-table-header text-muted-fg">{t.home.dayChg}</th>
                    <th className="text-right py-2 px-3 ui-table-header text-muted-fg">{t.home.ytd}</th>
                    <th className="text-right py-2 px-3 pr-4 ui-table-header text-muted-fg whitespace-nowrap">{t.home.marketCap} (MM)</th>
                  </tr>
                </thead>
                <tbody>
                  {trackedRows.map(({ company: c, snap: s }) => {
                    const ls = live?.stocks[c.ticker]
                    const ss = supaStockMap[c.ticker]
                    const dayPct = ls?.dayChangePct ?? ss?.dayChangePct ?? s?.dayChangePct
                    const ytdPct = s?.ytdChangePct
                    const mktCap = ls?.marketCapCLP ?? ss?.marketCapCLP ?? c.marketCapCLP
                    return (
                      <tr key={c.ticker} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                        <td className="py-1.5 pl-4 pr-3"><Link href={`/companies/${c.ticker}`} className="font-mono text-primary hover:underline">{c.ticker}</Link></td>
                        <td className="py-1.5 px-3 text-foreground truncate max-w-[110px]">{c.shortName}</td>
                        <td className={`py-1.5 px-3 text-right ui-number ${dayPct != null ? changeColor(dayPct) : 'text-muted-fg'}`}>{dayPct != null ? formatPct(dayPct) : '—'}</td>
                        <td className={`py-1.5 px-3 text-right ui-number ${ytdPct != null ? changeColor(ytdPct) : 'text-muted-fg'}`}>{ytdPct != null ? formatPct(ytdPct) : '—'}</td>
                        <td className="py-1.5 px-3 pr-4 text-right ui-number text-foreground">{mktCap ? formatCLP(mktCap) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* FX table */}
          <div className="bg-surface border border-border rounded overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="px-4 py-2.5 border-b border-border shrink-0">
              <span className="ui-label text-muted-fg">{t.home.fxTitle}</span>
            </div>
            <div className="grid grid-cols-[1fr_72px_64px_64px] gap-x-2 px-4 py-1.5 border-b border-border bg-surface-2 shrink-0">
              <span className="ui-table-header text-muted-fg" />
              <span className="ui-table-header text-muted-fg text-right">{t.home.last}</span>
              <span className="ui-table-header text-muted-fg text-right">{t.home.dayChg}</span>
              <span className="ui-table-header text-muted-fg text-right">{t.home.ytd}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {fxGroups.map(({ section, items }) => (
                <div key={section}>
                  <div className="px-4 py-1 bg-surface-2/60 border-b border-border">
                    <span className="ui-label text-muted-fg">{t.home[FX_SECTION_LABEL[section]]}</span>
                  </div>
                  {items.map(fx => (
                    <div key={fx.id} className="grid grid-cols-[1fr_72px_64px_64px] gap-x-2 px-4 py-1.5 border-b border-border last:border-0">
                      <span className="text-xs text-foreground">{fx.pair}</span>
                      <span className="text-xs ui-number text-foreground text-right">{formatFx(fx.last, fx.decimals ?? 2)}</span>
                      <span className={`text-xs ui-number text-right ${changeColor(fx.dayChangePct)}`}>{formatPct(fx.dayChangePct)}</span>
                      <span className={`text-xs ui-number text-right ${changeColor(fx.ytdChangePct)}`}>{formatPct(fx.ytdChangePct)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-border shrink-0">
              <p className="text-xs text-muted-fg">{t.home.fxSource}</p>
            </div>
          </div>
        </div>

        {/* Column 3 — Earnings + Hechos recent */}
        <div className="flex flex-col gap-4 min-h-0" style={{ height: macroH || undefined }}>
          <div className="bg-surface border border-border rounded p-4 shrink-0">
            <div className="ui-label text-muted-fg mb-2">{t.home.upcomingEarnings}</div>
            {upcoming.length > 0 && (
              <div className="mb-2">
                <div className="ui-label text-muted-fg mb-1">{t.home.upcoming}</div>
                {upcoming.map(e => (
                  <div key={e.id} className="grid grid-cols-3 items-center py-1 border-b border-border last:border-0">
                    <Link href={`/companies/${e.ticker}`} className="text-xs font-mono text-primary hover:underline">{e.ticker}</Link>
                    <span className="text-xs text-muted text-center">{e.period}</span>
                    <span className="text-xs ui-number text-muted-fg text-right">{e.reportDate}</span>
                  </div>
                ))}
              </div>
            )}
            {recent.length > 0 && (
              <div>
                <div className="ui-label text-muted-fg mb-1">{t.home.recentResults}</div>
                {recent.map(e => {
                  const doc = getDocumentByRelatedId(e.id)
                  return (
                    <div key={e.id} className="flex items-center gap-2 py-1 border-b border-border last:border-0">
                      <Link href={`/companies/${e.ticker}`} className="text-xs font-mono text-primary hover:underline">{e.ticker}</Link>
                      <span className="text-xs text-muted flex-1">{e.period}</span>
                      <StatusPill label={e.resultQuality} variant={qualityVariant[e.resultQuality]} />
                      {doc && <Link href={`/documents/${doc.id}`} className="text-xs text-muted-fg hover:text-primary transition-colors shrink-0" title={t.documents.viewSummary}>→</Link>}
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-muted-fg mt-2">{t.home.earningsSource}</p>
          </div>

          <div className="bg-surface border border-border rounded overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="px-4 py-2.5 border-b border-border shrink-0">
              <span className="ui-label text-muted-fg">{t.home.hechosFeed}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {recentHechos.map(h => {
                const doc = getDocumentByRelatedId(h.id)
                return (
                  <div key={h.id} className="px-4 py-2.5 border-b border-border last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs ui-number text-muted-fg">{h.date}</span>
                      <Link href={`/companies/${h.ticker}`} className="text-xs font-mono text-primary hover:underline">{h.ticker}</Link>
                      <StatusPill label={h.filingType} variant={h.filingType === 'HE' ? 'info' : 'neutral'} />
                      {doc && <Link href={`/documents/${doc.id}`} className="ml-auto text-xs text-muted-fg hover:text-primary transition-colors" title={t.documents.viewSummary}>→</Link>}
                    </div>
                    <p className="text-xs text-muted leading-snug line-clamp-2">{h.title}</p>
                  </div>
                )
              })}
            </div>
            <div className="px-4 py-2 border-t border-border shrink-0">
              <p className="text-xs text-muted-fg">{t.home.hechosSource}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Second region: Heat map (drives height) · Chilean rates · Markets ── */}
      <div className="grid grid-cols-3 gap-4 items-start">

        {/* Sector heat map — natural height (never scrolls), drives the row */}
        <div ref={heatRef} className="bg-surface border border-border rounded overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
            <span className="ui-label text-muted-fg">{t.home.sectorHeatMap}</span>
            <MarketRefreshButton onRefresh={doRefresh} />
          </div>
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2">
              {sectors.map((s, i) => {
                const isLastAlone = i === sectors.length - 1 && sectors.length % 3 === 1
                return (
                  <div
                    key={s.sector}
                    className={`border border-border rounded p-2 ${isLastAlone ? 'col-start-2' : ''}`}
                    style={sectorTileStyle(s.dayChangePct, maxSectorAbs)}
                  >
                    <div className="text-foreground leading-tight font-semibold" style={{ fontSize: '11px' }}>{s.sector}</div>
                    <div className="text-foreground font-bold ui-number" style={{ fontSize: '15px' }}>
                      {s.dayChangePct >= 0 ? '+' : ''}{s.dayChangePct.toFixed(2)}%
                    </div>
                    <div className="text-foreground ui-number" style={{ fontSize: '10px', opacity: 0.85 }}>
                      YTD {s.ytdChangePct > 0 ? '+' : ''}{s.ytdChangePct.toFixed(1)}%
                    </div>
                    <div className="text-foreground ui-number mt-1" style={{ fontSize: '10px' }}>
                      ▲ <span className="font-mono">{s.topContributor}</span> {s.topContributorPct >= 0 ? '+' : ''}{s.topContributorPct.toFixed(2)}%
                    </div>
                    <div className="text-foreground ui-number" style={{ fontSize: '10px' }}>
                      ▼ <span className="font-mono">{s.worstContributor}</span> {s.worstContributorPct >= 0 ? '+' : ''}{s.worstContributorPct.toFixed(2)}%
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="px-4 py-2 border-t border-border shrink-0 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-fg truncate">{t.home.sectorSource}</p>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-negative">−</span>
              <span className="inline-block rounded" style={{ width: 56, height: 8, background: 'linear-gradient(to right, var(--negative), var(--surface-2), var(--positive))' }} />
              <span className="text-xs text-positive">+</span>
            </div>
          </div>
        </div>

        {/* Chilean rates — drag to reorder, scrolls to match heat map height */}
        <div className="bg-surface border border-border rounded overflow-hidden flex flex-col" style={{ height: heatH || undefined }}>
          <div className="px-4 py-2.5 border-b border-border shrink-0">
            <span className="ui-label text-muted-fg">{t.home.chileanRates}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {rateOrder.map((r, i) => (
              <div
                key={r.id}
                draggable
                onDragStart={() => { dragFrom.current = i }}
                onDragOver={e => e.preventDefault()}
                onDrop={() => onDrop(i)}
                className="px-4 py-2.5 border-b border-border last:border-0 flex items-center gap-2 cursor-grab active:cursor-grabbing hover:bg-surface-2"
              >
                <span className="text-muted-fg select-none" title="Drag to reorder" style={{ fontSize: '11px' }}>⠿</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{r.name}</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm ui-number text-foreground">{formatMacroValue(r.value, r.unit)}</span>
                      {r.changeLabel && (
                        <span className={`text-xs ui-number ${r.change != null ? changeColor(r.change) : 'text-muted-fg'}`}>({formatMacroChange(r.changeLabel)})</span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-fg mt-0.5 truncate">{r.fullName}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-border shrink-0">
            <p className="text-xs text-muted-fg">{t.home.ratesSource}</p>
          </div>
        </div>

        {/* Markets — country on top, index below; scrolls to match heat map height */}
        <div className="bg-surface border border-border rounded overflow-hidden flex flex-col" style={{ height: heatH || undefined }}>
          <div className="px-4 py-2.5 border-b border-border shrink-0">
            <span className="ui-label text-muted-fg">{t.home.marketsTitle}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {indices.map(idx => {
              const isPos = idx.dayChangePct >= 0
              return (
                <div key={idx.id} className="px-4 py-2 flex items-center justify-between gap-2 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">{idx.country}</div>
                    <div className="text-xs text-muted-fg truncate">{idx.name}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs ui-number text-foreground">{idx.value.toLocaleString('es-CL')}</div>
                    <div className={`text-xs ui-number ${isPos ? 'text-positive' : 'text-negative'}`}>
                      {isPos ? '+' : ''}{idx.dayChangePct.toFixed(2)}%
                      <span className="text-muted-fg ml-1">({idx.ytdChangePct > 0 ? '+' : ''}{idx.ytdChangePct.toFixed(1)}% YTD)</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="px-4 py-2 border-t border-border shrink-0">
            <p className="text-xs text-muted-fg">{t.home.indexSource}</p>
          </div>
        </div>
      </div>

      {/* News — High-materiality red stripe, no tags */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <span className="ui-label text-muted-fg">{t.home.newsTitle}</span>
        </div>
        <div className="overflow-y-auto divide-y divide-border" style={{ maxHeight: '440px' }}>
          {news.map(item => {
            const isHigh = item.materiality === 'High'
            return (
              <div
                key={item.id}
                className="px-4 py-3.5"
                style={isHigh ? {
                  borderLeft: '3px solid var(--negative)',
                  backgroundColor: `color-mix(in oklab, var(--negative) 5%, var(--surface))`,
                } : { borderLeft: '3px solid transparent' }}
              >
                <p className={`text-xs leading-snug mb-1.5 ${isHigh ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>{item.headline}</p>
                <div className="flex items-center gap-1.5 text-xs text-muted-fg mb-2">
                  <span>{item.source}</span>
                  <span>·</span>
                  <span className="ui-number">{new Date(item.timestamp).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span>·</span>
                  <span>{item.category}</span>
                </div>
                <p className="text-xs text-muted leading-relaxed mb-2">{item.summary}</p>
                {(item.affectedTickers.length > 0 || item.affectedMacroVariables.length > 0) && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-muted-fg">{t.home.newsAffected}:</span>
                    {item.affectedTickers.map(ticker => (
                      <Link key={ticker} href={`/companies/${ticker}`} className="text-xs font-mono px-1.5 py-0.5 bg-surface-2 text-primary border border-border rounded hover:border-accent transition-colors">{ticker}</Link>
                    ))}
                    {item.affectedMacroVariables.map(v => (
                      <span key={v} className="text-xs px-1.5 py-0.5 bg-surface-2 text-muted border border-border rounded">{v}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="px-4 py-2.5 border-t border-border">
          <p className="text-xs text-muted-fg">{t.home.newsFutureNote}</p>
        </div>
      </div>

    </div>
  )
}
