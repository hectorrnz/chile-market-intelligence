'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { useEscape } from '@/lib/useEscape'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SourceNote } from '@/components/ui/SourceNote'
import { FundamentalsChart, type FundSeries } from '@/components/charts/FundamentalsChart'
import { getAllCompanies } from '@/lib/data/companies'
import { getFundamentals, type FundamentalRecord } from '@/lib/data/fundamentals'
import { formatCLP } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'

type Cat = 'income' | 'cash' | 'balance' | 'returns'
type Agg = 'sum' | 'last' | 'margin' | 'yoy'
type Freq = 'Q' | 'TTM' | 'A'
interface Metric { key: keyof FundamentalRecord; cat: Cat; unit: string; type: 'bar' | 'line'; axis: 'left' | 'right'; agg: Agg }

const METRICS: Metric[] = [
  { key: 'revenue', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'ebitda', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'netIncome', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'grossProfit', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'operatingIncome', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'eps', cat: 'income', unit: 'CLP', type: 'line', axis: 'right', agg: 'sum' },
  { key: 'rdExpense', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'sgaExpense', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'sbcExpense', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'depAmort', cat: 'income', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'ebitdaMargin', cat: 'income', unit: '%', type: 'line', axis: 'right', agg: 'margin' },
  { key: 'revenueYoY', cat: 'income', unit: '%', type: 'line', axis: 'right', agg: 'yoy' },
  { key: 'netIncomeYoY', cat: 'income', unit: '%', type: 'line', axis: 'right', agg: 'yoy' },
  { key: 'fcf', cat: 'cash', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'ocf', cat: 'cash', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'capex', cat: 'cash', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'cash', cat: 'balance', unit: 'MM', type: 'bar', axis: 'left', agg: 'last' },
  { key: 'ltDebt', cat: 'balance', unit: 'MM', type: 'bar', axis: 'left', agg: 'last' },
  { key: 'sharesOut', cat: 'balance', unit: 'MM sh', type: 'line', axis: 'left', agg: 'last' },
  { key: 'dividendsPaid', cat: 'returns', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
  { key: 'buybacks', cat: 'returns', unit: 'MM', type: 'bar', axis: 'left', agg: 'sum' },
]
const metricBy = Object.fromEntries(METRICS.map(m => [m.key, m])) as Record<string, Metric>
const CATS: { cat: Cat; key: 'catIncome' | 'catCash' | 'catBalance' | 'catReturns' }[] = [
  { cat: 'income', key: 'catIncome' }, { cat: 'cash', key: 'catCash' }, { cat: 'balance', key: 'catBalance' }, { cat: 'returns', key: 'catReturns' },
]
const PALETTE = ['#004A64', '#B07A12', '#0E7FB8', '#1A6630', '#8B0E04', '#5B6770', '#7399C6', '#3DAA60']

const companies = getAllCompanies()
const compMap = Object.fromEntries(companies.map(c => [c.ticker, c]))
const qIdx = (p: string) => { const m = p.match(/Q(\d)\s+(\d{4})/); return m ? +m[2] * 4 + +m[1] : 0 }
const qShort = (p: string) => { const m = p.match(/Q(\d)\s+(\d{4})/); return m ? `Q${m[1]}'${m[2].slice(2)}` : p }
const yearOf = (p: string) => { const m = p.match(/Q\d\s+(\d{4})/); return m ? m[1] : '' }

const sumOrNull = (w: FundamentalRecord[], k: keyof FundamentalRecord) => {
  const xs = w.map(r => r[k]).filter((v): v is number => typeof v === 'number')
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null
}
function aggVal(w: FundamentalRecord[], m: Metric): number | null {
  if (m.agg === 'last') { const v = w[w.length - 1][m.key]; return typeof v === 'number' ? v : null }
  if (m.agg === 'margin') { const re = sumOrNull(w, 'revenue'), eb = sumOrNull(w, 'ebitda'); return re && eb != null ? Math.round((eb / re) * 1000) / 10 : null }
  if (m.agg === 'yoy') return null
  return sumOrNull(w, m.key)
}

/** Segmented toggle button (module-scope so its identity is stable across renders). */
function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-0.5 text-xs rounded transition-colors ${active ? 'bg-surface-2 text-foreground border border-border' : 'text-muted-fg hover:text-foreground'}`}>{children}</button>
  )
}

export default function ChartBuilderPage() {
  const { t } = useLang()
  const [ticker, setTicker] = usePersistentState<string>('cmi.gfTicker', 'FALABELLA')
  const [selected, setSelected] = usePersistentState<string[]>('cmi.gfMetrics', ['revenue', 'ebitda'])
  const [mode, setMode] = usePersistentState<'abs' | 'idx'>('cmi.gfMode', 'abs')
  const [freq, setFreq] = usePersistentState<Freq>('cmi.gfFreq', 'Q')
  const [chartType, setChartType] = usePersistentState<'auto' | 'lines' | 'bars'>('cmi.gfChartType', 'auto')
  const [legend, setLegend] = usePersistentState<boolean>('cmi.gfLegend', true)
  const [grid, setGrid] = usePersistentState<boolean>('cmi.gfGrid', true)
  const [tickerB, setTickerB] = usePersistentState<string>('cmi.gfTickerB', '')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [typed, setTyped] = useState(ticker)
  const [typedB, setTypedB] = useState(tickerB)
  useEscape(settingsOpen, () => setSettingsOpen(false))

  // Mirror the persisted ticker into the editable inputs (render-time, not effects).
  const [prevTicker, setPrevTicker] = useState(ticker)
  if (ticker !== prevTicker) { setPrevTicker(ticker); setTyped(ticker) }
  const [prevTickerB, setPrevTickerB] = useState(tickerB)
  if (tickerB !== prevTickerB) { setPrevTickerB(tickerB); setTypedB(tickerB) }

  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (typeof d === 'string') setTicker(d.toUpperCase()) }
    window.addEventListener('gf:ticker', h)
    return () => window.removeEventListener('gf:ticker', h)
  }, [setTicker])

  const colorOf = (key: string) => PALETTE[Math.max(0, selected.indexOf(key)) % PALETTE.length]
  const toggle = (key: string) => setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const recordsA = getFundamentals(ticker).slice().sort((a, b) => qIdx(a.period) - qIdx(b.period))
  const overlay = !!tickerB && !!compMap[tickerB] && tickerB !== ticker
  const recordsB = overlay ? getFundamentals(tickerB).slice().sort((a, b) => qIdx(a.period) - qIdx(b.period)) : []

  type Period = { label: string; rec?: FundamentalRecord; window?: FundamentalRecord[] }
  const buildPeriods = (recs: FundamentalRecord[]): Period[] => {
    if (freq === 'Q') return recs.map(r => ({ label: qShort(r.period), rec: r }))
    if (freq === 'TTM') {
      const out: Period[] = []
      for (let i = 3; i < recs.length; i++) out.push({ label: `${qShort(recs[i].period)} TTM`, window: recs.slice(i - 3, i + 1) })
      return out
    }
    const byYear = new Map<string, FundamentalRecord[]>()
    for (const r of recs) { const y = yearOf(r.period); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y)!.push(r) }
    return [...byYear.entries()].filter(([, w]) => w.length >= 4).sort((a, b) => a[0].localeCompare(b[0])).map(([y, w]) => ({ label: y, window: w.slice(-4) }))
  }

  const valueOf = (m: Metric, p: Period): number | null => {
    if (p.window) return aggVal(p.window, m)
    const v = p.rec![m.key]; return typeof v === 'number' ? v : null
  }

  const records = recordsA
  const periods = buildPeriods(recordsA)
  const periodsB = overlay ? buildPeriods(recordsB) : []
  const bByLabel = new Map(periodsB.map(p => [p.label, p]))
  const labels = periods.map(p => p.label)

  const chosen = selected.map(k => metricBy[k]).filter(Boolean) as Metric[]
  const ml = (k: string) => t.charting.m[k as keyof typeof t.charting.m]
  const series: FundSeries[] = []
  for (const m of chosen) {
    series.push({
      key: `${ticker}-${m.key}`, label: overlay ? `${ticker} ${ml(m.key)}` : ml(m.key), color: colorOf(m.key),
      type: m.type, axis: m.axis, unit: m.unit, values: periods.map(p => valueOf(m, p)),
    })
    if (overlay) {
      series.push({
        key: `${tickerB}-${m.key}`, label: `${tickerB} ${ml(m.key)}`, color: colorOf(m.key),
        type: m.type, axis: m.axis, unit: m.unit, dashed: true, faded: true,
        values: periods.map(p => { const bp = bByLabel.get(p.label); return bp ? valueOf(m, bp) : null }),
      })
    }
  }

  const fmtBar = (v: number) => `${formatCLP(v)} MM`
  const fmtLine = (v: number, unit: string) => (unit === 'CLP' ? `${formatCLP(v, 2)} CLP` : unit === 'MM sh' ? `${formatCLP(v)} MM sh` : `${v}${unit}`)
  const fmtCell = (m: Metric, v: number | null) => v == null ? '—' : m.unit === '%' ? `${v}%` : m.unit === 'CLP' ? formatCLP(v, 2) : formatCLP(v)

  const handleExport = () => {
    exportCSV(
      `fundamentals_${ticker}${overlay ? `_vs_${tickerB}` : ''}`,
      [t.charting.metrics, ...labels],
      chosen.map(m => [ml(m.key), ...periods.map(p => { const v = valueOf(m, p); return v == null ? '' : v })]),
    )
  }

  return (
    <div className="w-full space-y-4">
      <SectionHeader tag={t.charting.tag} title={t.charting.title} subtitle={t.charting.subtitle} asOf />

      <datalist id="gf-tickers">{companies.map(c => <option key={c.ticker} value={c.ticker}>{c.shortName}</option>)}</datalist>

      {/* Toolbar */}
      <div className="bg-surface border border-border rounded px-4 py-2.5 flex items-center gap-4 flex-wrap text-xs">
        <div className="flex items-center gap-2">
          <span className="ui-label text-muted-fg">{t.charting.company}</span>
          <input value={typed} list="gf-tickers" placeholder={t.charting.tickerPh} spellCheck={false}
            onChange={e => { const v = e.target.value.toUpperCase(); setTyped(v); if (compMap[v]) setTicker(v) }}
            className="h-7 w-28 bg-surface border border-border rounded px-2 font-mono text-primary outline-none focus:border-accent placeholder:font-sans placeholder:text-muted-fg" />
          <span className="text-muted-fg">vs</span>
          <input value={typedB} list="gf-tickers" placeholder="—" spellCheck={false}
            onChange={e => { const v = e.target.value.toUpperCase(); setTypedB(v); if (v === '') setTickerB(''); else if (compMap[v] && v !== ticker) setTickerB(v) }}
            className="h-7 w-28 bg-surface border border-border rounded px-2 font-mono text-primary outline-none focus:border-accent placeholder:font-sans placeholder:text-muted-fg" />
          {overlay && <span className="text-muted-fg hidden lg:inline">{t.charting.dashed} = {tickerB}</span>}
        </div>
        <span className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1"><Seg active={mode === 'abs'} onClick={() => setMode('abs')}>{t.charting.absolute}</Seg><Seg active={mode === 'idx'} onClick={() => setMode('idx')}>{t.charting.indexed}</Seg></div>
        <span className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1"><Seg active={freq === 'Q'} onClick={() => setFreq('Q')}>{t.charting.quarterly}</Seg><Seg active={freq === 'TTM'} onClick={() => setFreq('TTM')}>{t.charting.ttm}</Seg><Seg active={freq === 'A'} onClick={() => setFreq('A')}>{t.charting.annual}</Seg></div>
        <button onClick={() => setSettingsOpen(true)} className="ml-auto flex items-center gap-1.5 h-6 px-2 rounded border border-border bg-surface-2 text-muted-fg hover:text-foreground hover:border-accent transition-colors"><span>⚙</span><span>{t.charting.settings}</span></button>
      </div>

      {/* Selected chips */}
      {chosen.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {chosen.map(m => (
            <span key={m.key} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded text-xs text-primary-fg" style={{ backgroundColor: colorOf(m.key) }}>
              {t.charting.m[m.key as keyof typeof t.charting.m]}
              <button onClick={() => toggle(m.key)} className="px-1 opacity-80 hover:opacity-100" aria-label="Remove">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4 items-start">
        {/* Metric picker */}
        <div className="col-span-12 lg:col-span-3 bg-surface border border-border rounded p-3 max-h-[520px] overflow-y-auto">
          {CATS.map(({ cat, key }) => (
            <div key={cat} className="mb-3 last:mb-0">
              <div className="ui-label text-muted-fg px-1 mb-1">{t.charting[key]}</div>
              {METRICS.filter(m => m.cat === cat).map(m => {
                const on = selected.includes(m.key)
                return (
                  <button key={m.key} onClick={() => toggle(m.key)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${on ? 'bg-surface-2 text-foreground font-medium' : 'text-muted hover:bg-surface-2 hover:text-foreground'}`}>
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: on ? colorOf(m.key) : 'transparent', border: on ? 'none' : '1px solid var(--border)' }} />
                    {t.charting.m[m.key as keyof typeof t.charting.m]}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Chart */}
        <div className="col-span-12 lg:col-span-9 bg-surface border border-border rounded p-4">
          {labels.length === 0 || chosen.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-fg">{records.length === 0 ? t.charting.noData : t.charting.selectMetric}</div>
          ) : (
            <FundamentalsChart labels={labels} series={series} height={360} indexed={mode === 'idx'} chartType={chartType} showLegend={legend} showGrid={grid} fmtBar={fmtBar} fmtLine={fmtLine} />
          )}
          <p className="text-xs text-muted-fg mt-2">{t.charting.source}{mode === 'idx' ? ' · indexed = 100' : ''}{freq !== 'Q' ? ` · ${freq === 'TTM' ? 'TTM' : t.charting.annual}` : ''}</p>
        </div>
      </div>

      {/* Underlying data */}
      {labels.length > 0 && chosen.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-x-auto">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3">
            <span className="ui-label text-muted-fg">{t.charting.table}</span>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 h-6 px-2 rounded border border-border bg-surface text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
            >
              <span aria-hidden>⤓</span>{t.common.exportCsv}
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left py-2.5 px-3 pl-4 ui-table-header text-muted-fg sticky left-0 bg-surface-2 z-10">{t.charting.metrics}</th>
                {labels.map(l => <th key={l} className="text-center py-2.5 px-3 ui-table-header text-muted-fg whitespace-nowrap">{l}</th>)}
              </tr>
            </thead>
            <tbody>
              {chosen.map(m => (
                <tr key={m.key} className="border-b border-border last:border-0">
                  <td className="py-2 px-3 pl-4 sticky left-0 bg-surface z-10 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-muted"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: colorOf(m.key) }} />{t.charting.m[m.key as keyof typeof t.charting.m]}</span>
                  </td>
                  {periods.map((p, i) => <td key={i} className="py-2 px-3 text-center ui-number text-foreground">{fmtCell(m, valueOf(m, p))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SourceNote>{t.common.mvpNote}</SourceNote>

      {/* Settings modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center pt-[10vh] px-4" style={{ backgroundColor: 'color-mix(in oklab, var(--foreground) 40%, transparent)' }} onClick={() => setSettingsOpen(false)} role="dialog" aria-modal="true" aria-label={t.charting.settings}>
          <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="ui-label text-foreground">{t.charting.settings}</span>
              <button onClick={() => setSettingsOpen(false)} className="text-muted-fg hover:text-foreground text-sm px-1">✕</button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <label className="flex items-center justify-between gap-2">
                <span className="text-foreground">{t.charting.chartType}</span>
                <select value={chartType} onChange={e => setChartType(e.target.value as 'auto' | 'lines' | 'bars')} className="h-7 bg-surface border border-border rounded px-1.5 text-foreground outline-none focus:border-accent">
                  <option value="auto">{t.charting.auto}</option>
                  <option value="lines">{t.charting.lines}</option>
                  <option value="bars">{t.charting.barsType}</option>
                </select>
              </label>
              <label className="flex items-center justify-between"><span className="text-foreground">{t.charting.legend}</span><input type="checkbox" checked={legend} onChange={e => setLegend(e.target.checked)} className="accent-[var(--primary)]" /></label>
              <label className="flex items-center justify-between"><span className="text-foreground">{t.charting.gridlines}</span><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} className="accent-[var(--primary)]" /></label>
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end">
              <button onClick={() => setSettingsOpen(false)} className="text-xs px-3 py-1 rounded bg-primary text-primary-fg">{t.charting.done}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
