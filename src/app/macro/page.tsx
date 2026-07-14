'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SourceNote } from '@/components/ui/SourceNote'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { useEscape } from '@/lib/useEscape'
import { getAllIndicators, fetchMacroIndicators } from '@/lib/data/macro'
import { getChileanRates } from '@/lib/data/chileanRates'
import { getYieldCurve } from '@/lib/data/yieldCurves'
import { getMacroHistoryForTimeframe, fetchMacroHistory } from '@/lib/data/macroHistory'
import { getSeriesByStaticId } from '@/config/macroSeries'
import { DataSourceBadge } from '@/components/ui/DataSourceBadge'
import { SourceStateBadge } from '@/components/ui/SourceStateBadge'
import { fetchUsForexTable } from '@/lib/data/frankfurterFx'
import type { UsForexTableResult } from '@/lib/providers/frankfurterFxProvider'
import type { DataSourceStatus } from '@/lib/providers/types'
import { changeColor, formatMacroValue, formatMacroChange, formatFx, formatPct } from '@/lib/formatters'
import { LineChart } from '@/components/charts/LineChart'
import { YieldCurveChart } from '@/components/charts/YieldCurveChart'
import type { MacroIndicator } from '@/types'

type Region = 'CL' | 'US'
type Timeframe = 1 | 3 | 5 | 10
const TIMEFRAMES: Timeframe[] = [1, 3, 5, 10]

const RATE_HIST: Record<string, string> = {
  'tpm-tna': 'tpm', btu10: 'btu10-ref',
  btp10: 'btp10', btu5: 'btu5', bcu5: 'bcu5',
  swap2y: 'swap2y', swap1y: 'swap1y', pdbc90: 'pdbc90',
}

interface Row {
  id: string; label: string; value: number; unit: string
  change?: number; changeLabel?: string; period: string; source: string
  implication?: string; histId?: string
}

export default function MacroPage() {
  const { t } = useLang()
  const [region, setRegion] = usePersistentState<Region>('cmi.macroRegion', 'CL')
  const [selected, setSelected] = useState<Row | null>(null)
  const [timeframe, setTimeframe] = useState<Timeframe>(5)
  useEscape(!!selected, () => setSelected(null))

  // Region is driven by the sidebar Macro dropdown (Chile / US)
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d === 'CL' || d === 'US') { setRegion(d); setSelected(null) } }
    window.addEventListener('macro:region', h)
    return () => window.removeEventListener('macro:region', h)
  }, [setRegion])

  // Phase 4A: static-first, upgrade-if-live. Render static immediately, then
  // ask /api/macro whether live data is available and swap it in if so.
  //
  // Fetched per-region (not with region omitted) for two reasons: (1) each
  // region's own static fallback applies independently if only the other
  // region's live provider succeeds — a combined/omitted-region call could
  // silently drop an entire region's rows if only one provider responded;
  // (2) the header badge needs a per-region status (Chile → BCCh, US → FRED)
  // to avoid the "Live BCCh" label being shown for US/FRED-sourced data, a
  // real mislabeling bug found on this page and mirrored from the Home page's
  // already-correct per-region pattern.
  const [macroAll, setMacroAll] = useState<MacroIndicator[]>(() => getAllIndicators())
  const [clStatus, setClStatus] = useState<DataSourceStatus>('static')
  const [usStatus, setUsStatus] = useState<DataSourceStatus>('static')
  useEffect(() => {
    const ac = new AbortController()
    Promise.all([
      fetchMacroIndicators('CL', ac.signal),
      fetchMacroIndicators('US', ac.signal),
    ]).then(([clRes, usRes]) => {
      if (clRes) setClStatus(clRes.metadata.status)
      if (usRes) setUsStatus(usRes.metadata.status)
      const clData = clRes?.metadata.liveAvailable && clRes.data.length
        ? clRes.data
        : getAllIndicators().filter(i => !i.region || i.region === 'CL')
      const usData = usRes?.metadata.liveAvailable && usRes.data.length
        ? usRes.data
        : getAllIndicators().filter(i => i.region === 'US')
      setMacroAll([...clData, ...usData])
    })
    return () => ac.abort()
  }, [])
  const srcStatus = region === 'CL' ? clStatus : usStatus
  const srcProvider = region === 'CL' ? 'BCCh' : 'FRED'

  // Modal chart: try the live/hybrid history endpoint; fall back to static.
  // Live data is tagged with its (indicator:timeframe) key so a stale series is
  // never shown — avoids a synchronous setState reset inside the effect.
  const [liveHist, setLiveHist] = useState<{ key: string; data: { date: string; value: number }[] } | null>(null)
  const [histStatus, setHistStatus] = useState<DataSourceStatus>('static')
  useEffect(() => {
    const histId = selected?.histId
    if (!histId) return
    const key = `${histId}:${timeframe}`
    const ac = new AbortController()
    fetchMacroHistory(histId, `${timeframe}Y` as '1Y' | '3Y' | '5Y' | '10Y', ac.signal).then(res => {
      if (!res) return
      setHistStatus(res.metadata.status)
      // `liveAvailable` only means "freshly live-fetched this request" — the
      // Supabase-persisted branch of resolveMacroHistory deliberately sets it
      // false even though its data is real and current (a real bug: this gate
      // used to reject persisted history outright, silently falling back to
      // the static bundled JSON for every indicator's popup chart, even when
      // the API had just returned correct persisted data). Accept any
      // non-static status instead.
      const usable = res.metadata.status === 'live' || res.metadata.status === 'persisted'
      if (usable && res.data.length >= 2) setLiveHist({ key, data: res.data })
    })
    return () => ac.abort()
  }, [selected?.histId, timeframe])
  const histKey = selected?.histId ? `${selected.histId}:${timeframe}` : ''
  const liveChart = liveHist && liveHist.key === histKey ? liveHist.data : null

  // The popup chart's badge/footer must name the PROVIDER THAT ACTUALLY BACKS
  // this specific series, not a page-wide assumption — a Chile-rate row
  // (histId from RATE_HIST, e.g. 'tpm'/'btu10-ref') is always BCCh-sourced (or
  // static, never FRED), while a canonical indicator id (histId === i.id, e.g.
  // 'fed-funds'/'us10y') looks up its real sourceProvider from the registry.
  const chartProvider = selected?.histId && getSeriesByStaticId(selected.histId)?.sourceProvider === 'FRED'
    ? 'FRED' as const
    : 'BCCh' as const

  // FX Integrity Task — Macro / US forex table is Frankfurter (free, no key,
  // real 1D/YTD change), fetched lazily only when the US region is active and
  // cached server-side (see frankfurterFxProvider.ts). The Chile Macro-page FX
  // depth table was removed from production (it was a static/sample table with
  // no live/persisted backing) — Chile's verified live BCCh FX pairs (USD/CLP,
  // EUR/CLP) remain visible in the indicators table above (FX category).
  const [usForex, setUsForex] = useState<UsForexTableResult | null>(null)
  useEffect(() => {
    if (region !== 'US') return
    const ac = new AbortController()
    fetchUsForexTable(ac.signal).then(res => { if (res) setUsForex(res) })
    return () => ac.abort()
  }, [region])

  const catLabel: Record<string, string> = {
    Rates: t.macro.monetary, 'US Rates': t.macro.monetary,
    Inflation: t.macro.inflation, 'US Inflation': t.macro.inflation,
    FX: t.macro.fx, 'US FX': t.macro.fx,
    Activity: t.macro.activity, 'US Activity': t.macro.activity,
    Labor: t.macro.labor, 'US Labor': t.macro.labor,
    Commodities: t.macro.commodities, Crypto: t.macro.crypto,
  }

  const toRow = (i: MacroIndicator): Row => ({
    id: i.id, label: i.shortName, value: i.value, unit: i.unit, change: i.change,
    changeLabel: i.changeLabel, period: i.period, source: i.source, implication: i.marketImplication, histId: i.id,
  })
  const indicators = macroAll.filter(i => (region === 'CL' ? (!i.region || i.region === 'CL') : i.region === 'US'))
  const indByCat = (cats: string[]) =>
    cats.map(cat => ({ cat, rows: indicators.filter(i => i.category === cat).map(toRow) })).filter(g => g.rows.length > 0)

  const clRatesRows: Row[] = getChileanRates().map(r => ({
    id: r.id, label: r.name, value: r.value, unit: r.unit, change: r.change, changeLabel: r.changeLabel,
    period: 'Jun 2025', source: r.source, implication: r.fullName, histId: RATE_HIST[r.id],
  }))

  const groups = region === 'CL'
    ? [{ cat: 'Rates', rows: clRatesRows }, ...indByCat(['Inflation', 'FX', 'Activity', 'Commodities', 'Labor'])]
    : indByCat(['US Rates', 'US Inflation', 'US Activity', 'US Labor', 'US FX', 'Crypto'])

  const curve = getYieldCurve(region)

  const openRow = (r: Row) => { if (r.histId) { setSelected(r); setTimeframe(5) } }
  const historyData = selected?.histId
    ? getMacroHistoryForTimeframe(selected.histId, timeframe).map(p => ({ date: p.date, value: p.value }))
    : []

  return (
    <div className="w-full space-y-4">
      <SectionHeader
        tag={t.macro.tag}
        title={t.macro.title}
        subtitle={t.macro.subtitle}
        asOf
        actions={
          <div className="flex items-center gap-2.5">
            <DataSourceBadge status={srcStatus} provider={srcProvider} />
            <span className="text-xs px-2.5 py-1 rounded bg-surface-2 border border-border text-foreground font-medium">{region === 'CL' ? 'Chile' : 'US'}</span>
          </div>
        }
      />

      {/* Economic calendar pointer — the fabricated "today's releases" preview
          (synthetic forecast/actual/prior values, no BCCh/FRED/INE backing) was
          removed from production per the calendar-integrity fix. The real
          dates-only FRED release calendar lives on /macro/calendar. */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <span className="ui-label text-muted-fg">{t.macro.calToday}</span>
          <Link href="/macro/calendar" className="text-xs text-primary hover:underline">{t.macro.viewFull}</Link>
        </div>
      </div>

      {/* One indicators table with highlighted category bands */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg w-44">{t.macro.indicator}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg w-32">{t.macro.value}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg w-24">{t.macro.change}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg w-28">{t.macro.period}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg w-40">{t.macro.source}</th>
              <th className="text-left py-2.5 px-3 pr-4 ui-table-header text-muted-fg">{t.macro.implication}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ cat, rows }) => (
              <Fragment key={cat}>
                <tr>
                  <td colSpan={6} className="bg-surface-2 px-4 py-1.5" style={{ borderLeft: '3px solid var(--accent)' }}>
                    <span className="ui-label text-foreground">{catLabel[cat] ?? cat}</span>
                  </td>
                </tr>
                {rows.map(r => {
                  const isSel = selected?.id === r.id
                  return (
                    <tr key={r.id} onClick={() => openRow(r)}
                      className={`border-b border-border last:border-0 transition-colors ${r.histId ? 'cursor-pointer hover:bg-surface-2' : ''} ${isSel ? 'bg-surface-2' : ''}`}>
                      <td className="py-2.5 pl-4 pr-3 text-foreground">
                        {r.label}
                        {r.histId && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-accent align-middle" title="Chartable" />}
                      </td>
                      <td className="py-2.5 px-3 text-right ui-number text-foreground">{formatMacroValue(r.value, r.unit)}</td>
                      <td className={`py-2.5 px-3 text-right ui-number ${r.change != null ? changeColor(r.change) : 'text-muted-fg'}`}>{r.changeLabel ? formatMacroChange(r.changeLabel) : '—'}</td>
                      <td className="py-2.5 px-3 text-muted-fg whitespace-nowrap">{r.period}</td>
                      <td className="py-2.5 px-3 text-muted-fg"><span className="block truncate max-w-[180px]" title={r.source}>{r.source}</span></td>
                      <td className="py-2.5 px-3 pr-4 text-muted italic max-w-xs"><span className="block truncate" title={r.implication}>{r.implication ?? '—'}</span></td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border"><p className="text-xs text-muted-fg">{t.macro.clickToChart}</p></div>
      </div>

      {/* Fixed-income (yield curve) + FX depth */}
      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="bg-surface border border-border rounded p-4">
          <div className="ui-label text-muted-fg mb-1">{t.macro.yieldCurve}</div>
          <div className="text-xs text-muted-fg mb-3">{curve.label}</div>
          <YieldCurveChart
            tenors={curve.tenors}
            unit={curve.unit}
            series={[
              { label: t.macro.curveToday, color: 'var(--primary)', values: curve.today },
              { label: t.macro.curveWeek, color: 'var(--accent)', values: curve.weekAgo },
              { label: t.macro.curveYearEnd, color: 'var(--muted)', dashed: true, values: curve.yearEnd },
            ]}
            height={240}
          />
          <p className="text-xs text-muted-fg mt-2">{curve.source}</p>
        </div>

        {region === 'CL' ? (
          // The Chile Macro-page FX depth table (static/sample data, no
          // live/persisted backing) was removed from production per the FX
          // integrity fix — never show a static table as if it were live.
          // Chile's verified live BCCh FX pairs (USD/CLP, EUR/CLP) remain
          // visible in the indicators table above (FX category).
          <div className="bg-surface border border-border rounded p-4 flex items-center justify-center text-center">
            <p className="text-xs text-muted-fg max-w-xs">{t.macro.fxClDepthRemoved}</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2">
              <span className="ui-label text-muted-fg">{t.macro.fxDepth}</span>
              <SourceStateBadge sourceKey={usForex?.ok ? 'frankfurterLive' : 'frankfurterUnavailable'} />
            </div>
            {usForex?.ok && usForex.rows.length > 0 ? (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface-2">
                      <th className="text-left py-2 pl-4 pr-3 ui-table-header text-muted-fg">{t.macro.pair}</th>
                      <th className="text-right py-2 px-3 ui-table-header text-muted-fg">{t.home.last}</th>
                      <th className="text-right py-2 px-3 ui-table-header text-muted-fg">{t.home.dayChg}</th>
                      <th className="text-right py-2 px-3 pr-4 ui-table-header text-muted-fg">{t.home.ytd}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usForex.rows.map(r => (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="py-2 pl-4 pr-3 text-foreground">
                          {r.pair}
                          {r.derived && (
                            <span className="ml-1.5 text-muted-fg" title={t.macro.fxDerived}>†</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right ui-number text-foreground">{formatFx(r.value, r.decimals)}</td>
                        <td className={`py-2 px-3 text-right ui-number ${r.oneDayChangePct != null ? changeColor(r.oneDayChangePct) : 'text-muted-fg'}`} title={r.oneDayChangePct == null ? t.macro.fxChangeUnavailable : undefined}>
                          {r.oneDayChangePct != null ? formatPct(r.oneDayChangePct) : '—'}
                        </td>
                        <td className={`py-2 px-3 pr-4 text-right ui-number ${r.ytdChangePct != null ? changeColor(r.ytdChangePct) : 'text-muted-fg'}`} title={r.ytdChangePct == null ? t.macro.fxChangeUnavailable : undefined}>
                          {r.ytdChangePct != null ? formatPct(r.ytdChangePct) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 border-t border-border space-y-0.5">
                  <p className="text-xs text-muted-fg">{t.macro.fxUnofficial}</p>
                  <p className="text-xs text-muted-fg">
                    {t.macro.fxAsOf} {usForex.currentDate ?? '—'} · † {t.macro.fxDerived} · {usForex.providerAttribution}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-40 text-xs text-muted-fg">{t.macro.fxUnavailable}</div>
            )}
          </div>
        )}
      </div>

      <SourceNote>{t.common.mvpNote}</SourceNote>

      {/* Chart popup modal (monthly frequency) */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'color-mix(in oklab, var(--foreground) 40%, transparent)' }} onClick={() => setSelected(null)} role="dialog" aria-modal="true">
          <div className="bg-surface border border-border rounded shadow-lg w-full max-w-3xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="ui-label text-muted-fg mb-0.5">{selected.label}</div>
                <div className="flex items-baseline gap-1.5 mt-1.5">
                  <span className="text-sm ui-number text-foreground">{formatMacroValue(selected.value, selected.unit)}</span>
                  {selected.changeLabel && <span className={`text-xs ui-number ${selected.change != null ? changeColor(selected.change) : 'text-muted-fg'}`}>({formatMacroChange(selected.changeLabel)})</span>}
                  <span className="text-xs text-muted-fg ml-1">{selected.period}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {TIMEFRAMES.map(tf => (
                  <button key={tf} onClick={() => setTimeframe(tf)} className={`px-2.5 py-1 text-xs rounded transition-colors ${timeframe === tf ? 'bg-surface-2 text-foreground border border-border' : 'text-muted-fg hover:text-foreground'}`}>{tf}Y</button>
                ))}
                <button onClick={() => setSelected(null)} className="ml-2 text-sm text-muted-fg hover:text-foreground px-2 py-1" aria-label="Close chart">✕</button>
              </div>
            </div>
            {(liveChart ?? historyData).length >= 2 ? (
              <LineChart data={liveChart ?? historyData} unit={selected.unit === '%' ? '%' : ''} height={240} />
            ) : (
              <div className="flex items-center justify-center h-40 text-xs text-muted-fg border border-border rounded">{t.macro.noHistory}</div>
            )}
            <div className="flex items-center gap-2 mt-3">
              <DataSourceBadge status={histStatus} provider={chartProvider} />
              <span className="text-xs text-muted-fg">· {chartProvider === 'FRED' ? t.macro.chartSourceFred : t.macro.chartSourceBcch}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
