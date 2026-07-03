'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { useEscape } from '@/lib/useEscape'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SourceNote } from '@/components/ui/SourceNote'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import { CompareChart } from '@/components/charts/CompareChart'
import { getAllCompanies } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { getStockSeriesByPeriod } from '@/lib/data/stockHistory'
import { totalAndAnnual, tfStart } from '@/lib/returns'
import { formatCLP, formatLargeCLP, formatFx, formatPct, changeColor } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'
import { fetchCompareData } from '@/lib/data/compareData'
import type { CompareEntry, CompareFundamentalKey, ComparePerformanceMetric } from '@/lib/compare/compareTypes'
import type { StockPriceSnapshot, Company } from '@/types'

type CmpTf = '1M' | 'YTD' | '1Y' | '3Y' | '5Y'
type Period = 'D' | 'W' | 'M'
const TF: CmpTf[] = ['1M', 'YTD', '1Y', '3Y', '5Y']
// Institutional default palette — 6 distinct hues (no purple, no near-duplicates)
const PRESET = ['#004A64', '#1A6630', '#8B0E04', '#B07A12', '#0E7FB8', '#5B6770']
const SWATCHES = ['#004A64', '#7399C6', '#0E7FB8', '#1A6630', '#3DAA60', '#8B0E04', '#B07A12', '#5B6770', '#231F20', '#88CBDF']
const BENCH_COLOR = 'var(--muted)'
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
  const [benchmark, setBenchmark] = usePersistentState<boolean>('cmi.compareBenchmark', false)
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
  }, [validTickerKey])
  const marketStatus = Object.values(compareData)[0]?.marketDataStatus ?? 'static'
  const perfCell = (m: ComparePerformanceMetric | undefined) => ({
    label: m?.value != null ? fmtPct(m.value) : '—',
    title: m && m.source !== 'persisted' ? (m.fallbackReason ?? m.source) : undefined,
    className: m?.value != null ? colored(m.value) : 'text-muted-fg',
  })

  const usingCustom = !!(cStart && cEnd)
  const end = usingCustom ? cEnd : DATA_END
  const start = usingCustom ? cStart : tfStart(end, tf)
  const seriesFor = (tk: string) =>
    getStockSeriesByPeriod(tk, period).filter(p => p.date >= start && p.date <= end).map(p => ({ date: p.date, value: p.price }))

  const rowData = valids.map(({ slot, ticker }) => {
    const data = seriesFor(ticker)
    const m = totalAndAnnual(data)
    return { slot, ticker, color: colorForSlot(slot), data, tr: m?.tr ?? null, annual: m?.annual ?? null }
  })
  const ipsaData = benchmark ? seriesFor('IPSA') : []
  const ipsaM = benchmark ? totalAndAnnual(ipsaData) : null

  const refIsBench = diffRef === 'bench' && benchmark && !!ipsaM
  let refTR: number | null = null
  let refSlot = -1
  if (refIsBench) refTR = ipsaM!.tr
  else {
    const slotIdx = diffRef === 'bench' ? -1 : parseInt(diffRef, 10)
    const ref = rowData.find(r => r.slot === slotIdx) ?? rowData[0]
    refTR = ref?.tr ?? null
    refSlot = ref?.slot ?? -1
  }

  const chartSeries = [
    ...rowData.filter(r => r.data.length >= 2).map(r => ({ ticker: r.ticker, color: r.color, data: r.data })),
    ...(benchmark && ipsaData.length >= 2 ? [{ ticker: 'IPSA', color: BENCH_COLOR, dashed: true, data: ipsaData }] : []),
  ]

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
  const fund: Row[] = [
    { label: t.company.kpis.lastPrice, dir: 0, get: e => num(e?.latestPrice), fmt: v => formatFx(v, v < 1000 ? 2 : 0) },
    { label: `${t.home.marketCap} (MM)`, dir: 0, get: e => num(e?.marketCapCLP), fmt: v => formatCLP(v) },
    { label: t.company.val.peFwd, key: 'pe', dir: -1, get: (e, s) => num(e?.fundamentals.pe ?? s?.peFwd), fmt: v => `${v}x` },
    { label: t.company.val.psFwd, key: 'psFwd', dir: -1, get: (e, s) => num(e?.fundamentals.psFwd ?? s?.psFwd), fmt: v => `${v}x` },
    { label: t.company.val.evEbitda, key: 'evEbitda', dir: -1, get: (e, s) => num(e?.fundamentals.evEbitda ?? s?.evEbitda), fmt: v => `${v}x` },
    { label: t.company.val.opMargin, key: 'opMargin', dir: 1, get: (e, s) => num(e?.fundamentals.opMargin ?? s?.opMargin), fmt: v => `${v}%` },
    { label: t.company.val.grossMargin, key: 'grossMargin', dir: 1, get: (e, s) => num(e?.fundamentals.grossMargin ?? s?.grossMargin), fmt: v => `${v}%` },
    { label: t.company.val.roe, key: 'roe', dir: 1, get: (e, s) => num(e?.fundamentals.roe ?? s?.roe), fmt: v => `${v}%` },
    { label: t.company.val.fcfYield, key: 'fcfYield', dir: 1, get: (e, s) => num(e?.fundamentals.fcfYield ?? s?.fcfYield), fmt: v => `${v}%` },
    { label: t.company.val.pb, key: 'pb', dir: -1, get: (e, s) => num(e?.fundamentals.pb ?? s?.pb), fmt: v => `${v}x` },
    { label: t.company.val.netDebtEbitda, key: 'netDebtEbitda', dir: -1, get: (e, s) => num(e?.fundamentals.netDebtEbitda ?? s?.netDebtEbitda), fmt: v => `${v}x` },
    { label: t.company.kpis.divYield, key: 'dividendYield', dir: 1, get: (e, s) => num(e?.fundamentals.dividendYield ?? s?.dividendYield), fmt: v => `${v}%` },
  ]
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
      <SectionHeader tag={t.compare.tag} title={t.compare.title} subtitle={t.compare.subtitle} asOf />

      <datalist id="cmp-tickers">
        {companies.map(c => <option key={c.ticker} value={c.ticker}>{c.shortName}</option>)}
      </datalist>

      {/* Market Data — persisted/live Supabase fields (Phase 8B) */}
      {valids.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-x-auto">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <span className="ui-label text-muted-fg">{t.compare.marketDataTitle}</span>
            <div className="flex items-center gap-2">
              <MarketDataSourceBadge status={marketStatus} />
              {compareMetaStatus?.latestSnapshotDate && (
                <span className="text-xs text-muted-fg ui-number">{t.common.asOf} {compareMetaStatus.latestSnapshotDate}</span>
              )}
            </div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left py-2 px-3 pl-4 ui-table-header text-muted-fg">{t.compare.security}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.stocks.cols.price}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.stocks.cols.dayChg}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perf1d}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perf5d}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perf1m}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perfYtd}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.compare.perf1y}</th>
                <th className="text-right py-2 px-2 ui-table-header text-muted-fg">{t.stocks.cols.marketCap}</th>
                <th className="text-left py-2 px-2 pr-4 ui-table-header text-muted-fg">{t.common.sector}</th>
              </tr>
            </thead>
            <tbody>
              {valids.map(({ ticker }) => {
                const entry = compareData[ticker]
                const p1d = perfCell(entry?.performance.oneDay)
                const p5d = perfCell(entry?.performance.fiveDay)
                const p1m = perfCell(entry?.performance.oneMonth)
                const pytd = perfCell(entry?.performance.ytd)
                const p1y = perfCell(entry?.performance.oneYear)
                return (
                  <tr key={ticker} className="border-b border-border last:border-0">
                    <td className="py-1.5 px-3 pl-4 font-mono text-primary">{ticker}</td>
                    <td className="py-1.5 px-2 text-right ui-number text-foreground">{entry?.latestPrice != null ? formatFx(entry.latestPrice, entry.latestPrice < 1000 ? 2 : 0) : '—'}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${entry?.dayChangePct != null ? colored(entry.dayChangePct) : 'text-muted-fg'}`}>{entry?.dayChangePct != null ? formatPct(entry.dayChangePct) : '—'}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${p1d.className}`} title={p1d.title}>{p1d.label}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${p5d.className}`} title={p5d.title}>{p5d.label}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${p1m.className}`} title={p1m.title}>{p1m.label}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${pytd.className}`} title={pytd.title}>{pytd.label}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${p1y.className}`} title={p1y.title}>{p1y.label}</td>
                    <td className="py-1.5 px-2 text-right ui-number text-foreground">{entry?.marketCapCLP != null ? formatLargeCLP(entry.marketCapCLP) : '—'}</td>
                    <td className="py-1.5 px-2 pr-4 text-muted-fg whitespace-nowrap">{entry?.sector ?? compMap[ticker]?.sector ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Top: returns (left) + fundamentals (right) */}
      <div className="grid grid-cols-12 gap-4 items-start">

        {/* Returns table */}
        <div className="col-span-12 xl:col-span-5 bg-surface border border-border rounded overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <span className="ui-label text-muted-fg">{t.compare.returnsTitle}</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={benchmark} onChange={e => setBenchmark(e.target.checked)} className="accent-[var(--primary)]" />
                <span className="text-foreground">{t.compare.addBenchmark}</span>
              </label>
              <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-1.5 h-6 px-2 rounded border border-border bg-surface-2 text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors">
                <span>⚙</span><span>{t.compare.settings}</span>
              </button>
            </div>
          </div>
          <table className="w-full text-xs">
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
                const isRef = !refIsBench && r && r.slot === refSlot
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
                    <td className={`py-1.5 px-2 text-right ui-number ${colored(r?.tr ?? null)}`}>{r ? fmtPct(r.tr) : ''}</td>
                    <td className={`py-1.5 px-2 text-right ui-number ${isRef ? 'text-muted-fg' : colored(diff)}`}>{isValid ? (isRef ? '--' : fmtPct(diff)) : ''}</td>
                    <td className={`py-1.5 px-2 pr-4 text-right ui-number ${colored(r?.annual ?? null)}`}>{r ? fmtPct(r.annual) : ''}</td>
                  </tr>
                )
              })}
              {benchmark && (
                <tr className="border-t-2 border-border-strong bg-surface-2">
                  <td className="py-1.5 pl-4 pr-1 text-muted-fg">★</td>
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: BENCH_COLOR }} />
                      <span className="font-mono text-foreground">IPSA</span>
                    </div>
                  </td>
                  <td className={`py-1.5 px-2 text-right ui-number ${colored(ipsaM?.tr ?? null)}`}>{fmtPct(ipsaM?.tr ?? null)}</td>
                  <td className="py-1.5 px-2 text-right ui-number text-muted-fg">{refIsBench ? '--' : fmtPct(ipsaM && refTR != null ? ipsaM.tr - refTR : null)}</td>
                  <td className={`py-1.5 px-2 pr-4 text-right ui-number ${colored(ipsaM?.annual ?? null)}`}>{fmtPct(ipsaM?.annual ?? null)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Fundamentals — centered data */}
        <div className="col-span-12 xl:col-span-7">
          {valids.length === 0 ? (
            <div className="bg-surface border border-border rounded p-10 text-center text-xs text-muted-fg">{t.compare.empty}</div>
          ) : (
            <div className="bg-surface border border-border rounded overflow-x-auto">
              <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="ui-label text-muted-fg">{t.compare.fundamentals}</span>
                  <span className="text-xs text-muted-fg" title={t.compare.fundamentalsNote}>({t.compare.fundamentalsNote})</span>
                </div>
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
          </div>

          <SourceNote>{t.compare.source}</SourceNote>
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
                  {benchmark && <option value="bench">IPSA (Benchmark)</option>}
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
