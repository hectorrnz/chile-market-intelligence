'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { useEscape } from '@/lib/useEscape'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { SourceStateBadge } from '@/components/ui/SourceStateBadge'
import { FundamentalsChart, type FundSeries } from '@/components/charts/FundamentalsChart'
import { TableCard } from '@/components/fable/TableCard'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { AsyncState } from '@/components/fable/AsyncState'
import { Reveal } from '@/components/fable/motion'
import { getAllCompanies } from '@/lib/data/companies'
import { getFundamentals, type FundamentalRecord } from '@/lib/data/fundamentals'
import { fetchFinancialStatements, type FinancialsSourceStatus, type FinancialsSourceType } from '@/lib/data/financialsData'
import type { SourceKey } from '@/lib/dataSourceRegistry'
import { formatCLP, formatCompactMM } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'

type Cat = 'income' | 'cash' | 'balance' | 'returns'
type Agg = 'sum' | 'last' | 'margin' | 'yoy'
// Quarterly was removed as a user-facing option: issuers that file a native
// annual (FY) report have their Q4 folded into that FY row rather than
// published as a discrete quarter, so a quarterly view rendered a visible gap
// at Q4 with the value sitting in a separate FY bar beside it. TTM and Annual
// both aggregate correctly across that mix. Quarterly records are still read
// from the source — they are what TTM's rolling window and Annual's 4-quarter
// sum are built from.
type Freq = 'TTM' | 'A'
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
// Periods come as either "Q# YYYY" (quarterly) or "FY YYYY" (annual — e.g.
// CMF/XBRL, which ingests annual filings only). All three helpers must
// recognize both shapes, or an annual-only ticker's records silently sort to
// index 0 / lose their year (see the CMF/XBRL Charting single-point issue).
const qIdx = (p: string) => {
  const q = p.match(/Q(\d)\s+(\d{4})/); if (q) return +q[2] * 4 + +q[1]
  const fy = p.match(/FY\s+(\d{4})/i); if (fy) return +fy[1] * 4 + 4 // sorts at year-end
  return 0
}
const qShort = (p: string) => {
  const q = p.match(/Q(\d)\s+(\d{4})/); if (q) return `Q${q[1]}'${q[2].slice(2)}`
  const fy = p.match(/FY\s+(\d{4})/i); if (fy) return `FY'${fy[1].slice(2)}`
  return p
}
const yearOf = (p: string) => {
  const q = p.match(/Q\d\s+(\d{4})/); if (q) return q[1]
  const fy = p.match(/FY\s+(\d{4})/i); if (fy) return fy[1]
  return ''
}
const isQuarterlyPeriod = (p: string) => /^Q\d/.test(p)
const isAnnualPeriod = (p: string) => /^FY/i.test(p)

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

export default function ChartBuilderPage() {
  const { t } = useLang()
  const [ticker, setTicker] = usePersistentState<string>('cmi.gfTicker', 'FALABELLA')
  const [selected, setSelected] = usePersistentState<string[]>('cmi.gfMetrics', ['revenue', 'ebitda'])
  const [mode, setMode] = usePersistentState<'abs' | 'idx'>('cmi.gfMode', 'abs')
  // New storage key: the old 'cmi.gfFreq' may hold 'Q', which is no longer a
  // member of Freq — reusing the key would rehydrate a value the UI can no
  // longer render.
  const [freq, setFreq] = usePersistentState<Freq>('cmi.gfFreq2', 'TTM')
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

  // Phase 8C — persisted financials (manual CSV import) take precedence over
  // the static fundamentals.json fallback, per ticker. Falls back silently
  // (and is labeled honestly via the source badge) when nothing is imported.
  const [persistedA, setPersistedA] = useState<{ records: FundamentalRecord[]; status: FinancialsSourceStatus; sourceType?: FinancialsSourceType; source: string } | null>(null)
  const [persistedB, setPersistedB] = useState<{ records: FundamentalRecord[]; status: FinancialsSourceStatus } | null>(null)
  const overlay = !!tickerB && !!compMap[tickerB] && tickerB !== ticker

  useEffect(() => {
    let mounted = true
    fetchFinancialStatements(ticker).then(res => {
      if (mounted) setPersistedA({ records: res.records, status: res.status, sourceType: res.sourceType, source: res.source })
    }).catch(() => { if (mounted) setPersistedA(null) })
    return () => { mounted = false }
  }, [ticker])

  useEffect(() => {
    let mounted = true
    const run = async () => {
      if (!overlay) {
        if (mounted) setPersistedB(null)
        return
      }
      try {
        const res = await fetchFinancialStatements(tickerB)
        if (mounted) setPersistedB({ records: res.records, status: res.status })
      } catch {
        if (mounted) setPersistedB(null)
      }
    }
    run()
    return () => { mounted = false }
  }, [tickerB, overlay])

  const sourceStatusA: FinancialsSourceStatus = persistedA?.status === 'persisted' && persistedA.records.length > 0 ? 'persisted' : 'static_fallback'
  // Phase 8C.2 — pick the source badge by the dominant persisted source_type so
  // automated CMF/XBRL data reads "via CMF XBRL", manual CSV reads "via manual CSV".
  const financialsBadgeKey: SourceKey = sourceStatusA !== 'persisted'
    ? 'fundamentalsStatic'
    : persistedA?.sourceType === 'xbrl'
      ? 'financialsPersistedXbrl'
      : persistedA?.sourceType === 'cmf_fecu'
        ? 'financialsPersistedCmfFecu'
        : persistedA?.sourceType === 'cmf_bank'
          ? 'financialsPersistedCmfBank'
          : persistedA?.sourceType === 'yahoo_finance'
            ? 'financialsPersistedYahoo'
            : 'financialsPersisted'
  const baseRecordsA = sourceStatusA === 'persisted' ? persistedA!.records : getFundamentals(ticker)
  const recordsA = baseRecordsA.slice().sort((a, b) => qIdx(a.period) - qIdx(b.period))
  const baseRecordsB = overlay
    ? (persistedB?.status === 'persisted' && persistedB.records.length > 0 ? persistedB.records : getFundamentals(tickerB))
    : []
  const recordsB = overlay ? baseRecordsB.slice().sort((a, b) => qIdx(a.period) - qIdx(b.period)) : []

  // TTM needs 4+ consecutive quarterly points — an annual-only ticker (CMF/XBRL,
  // one FY row per year) can never build a rolling window, so the toggle is
  // disabled rather than silently rendering an empty chart.
  const canTTM = recordsA.filter(r => isQuarterlyPeriod(r.period)).length >= 4
  // The frequency actually rendered. Derived rather than corrected-by-setState
  // so an annual-only ticker can never momentarily render an empty TTM chart —
  // including on first mount, where a previous-value guard would see no change
  // and leave the unusable selection in place.
  const effFreq: Freq = freq === 'TTM' && !canTTM ? 'A' : freq

  type Period = { label: string; rec?: FundamentalRecord; window?: FundamentalRecord[] }
  const buildPeriods = (recs: FundamentalRecord[]): Period[] => {
    if (effFreq === 'TTM') {
      // QUARTERLY RECORDS ONLY. Several issuers publish both discrete
      // quarters and a native full-year FY row, and qIdx deliberately sorts
      // FY at year-end — i.e. right next to Q4 of the same year. Rolling a
      // 4-record window over the unfiltered list therefore summed a full year
      // together with individual quarters, producing a bogus decaying series
      // (4,59 B → 3,47 B → 2,34 B → 1,16 B for ITAUCL) and a nonsensical
      // "FY'25 TTM" point. Filtering to quarters makes every window a true
      // trailing four quarters. An annual-only ticker yields nothing here,
      // which is exactly what canTTM gates on.
      const quarters = recs.filter(r => isQuarterlyPeriod(r.period))
      const out: Period[] = []
      for (let i = 3; i < quarters.length; i++) {
        out.push({ label: `${qShort(quarters[i].period)} TTM`, window: quarters.slice(i - 3, i + 1) })
      }
      return out
    }
    // Annual: a year that already has a native FY (annual) filing is used
    // directly — CMF/XBRL ingests one FY row per year, so there's nothing to
    // sum. A year with only quarterly data still needs all 4 quarters summed.
    const byYear = new Map<string, FundamentalRecord[]>()
    for (const r of recs) { const y = yearOf(r.period); if (!y) continue; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y)!.push(r) }
    const out: Period[] = []
    for (const [y, group] of [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const fyRecord = group.find(r => isAnnualPeriod(r.period))
      if (fyRecord) { out.push({ label: y, rec: fyRecord }); continue }
      if (group.length >= 4) out.push({ label: y, window: group.slice(-4) })
    }
    return out
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

  // All amount metrics are in MILLIONS of CLP (see resolveFinancials'
  // normalization). formatCompactMM converts back to the true magnitude and
  // picks a readable unit, so a 7-digit millions figure renders as "1,46 B"
  // rather than "1.463.576" — applied identically to the axis, the tooltip and
  // the underlying-data table so the three can never disagree.
  const fmtBar = (v: number) => formatCompactMM(v)
  const fmtAxis = (v: number) => formatCompactMM(v)
  const fmtLine = (v: number, unit: string) =>
    unit === 'CLP' ? `${formatCLP(v, 2)} CLP`
    : unit === 'MM sh' ? `${formatCLP(v, 1)} MM sh`
    : `${formatCLP(v, 1)}${unit}`
  const fmtCell = (m: Metric, v: number | null) =>
    v == null ? '—'
    : m.unit === '%' ? `${formatCLP(v, 1)}%`
    : m.unit === 'CLP' ? formatCLP(v, 2)
    : m.unit === 'MM sh' ? `${formatCLP(v, 1)} MM sh`
    : formatCompactMM(v)

  const handleExport = () => {
    exportCSV(
      `fundamentals_${ticker}${overlay ? `_vs_${tickerB}` : ''}`,
      [t.charting.metrics, ...labels],
      chosen.map(m => [ml(m.key), ...periods.map(p => { const v = valueOf(m, p); return v == null ? '' : v })]),
    )
  }

  return (
    <div className="w-full space-y-4">
      <Reveal>
        <SectionHeader tag={t.charting.tag} title={t.charting.title} subtitle={t.charting.subtitle} />
      </Reveal>

      <datalist id="gf-tickers">{companies.map(c => <option key={c.ticker} value={c.ticker}>{c.shortName}</option>)}</datalist>

      {/* Toolbar */}
      <Reveal delayMs={70}>
        <div className="space-y-3">
          <GlassSurface variant="card" className="px-4 py-2.5 flex items-center gap-4 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <span className="ui-label text-muted-fg">{t.charting.company}</span>
              <input value={typed} list="gf-tickers" placeholder={t.charting.tickerPh} spellCheck={false}
                aria-label={t.charting.company}
                onChange={e => { const v = e.target.value.toUpperCase(); setTyped(v); if (compMap[v]) setTicker(v) }}
                className="h-7 w-28 rounded-full px-2.5 font-mono text-primary outline-none focus:border-accent placeholder:font-sans placeholder:text-muted-fg nv-transition"
                style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }} />
              <span className="text-muted-fg" aria-hidden="true">{t.charting.vs}</span>
              <input value={typedB} list="gf-tickers" placeholder="—" spellCheck={false}
                aria-label={t.charting.compareTicker}
                onChange={e => { const v = e.target.value.toUpperCase(); setTypedB(v); if (v === '') setTickerB(''); else if (compMap[v] && v !== ticker) setTickerB(v) }}
                className="h-7 w-28 rounded-full px-2.5 font-mono text-primary outline-none focus:border-accent placeholder:font-sans placeholder:text-muted-fg nv-transition"
                style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }} />
              {overlay && <span className="text-muted-fg hidden lg:inline">{t.charting.dashed} = {tickerB}</span>}
            </div>
            <span className="w-px h-4 bg-border" aria-hidden="true" />
            <SegmentedControl
              options={[
                { value: 'abs', label: t.charting.absolute },
                { value: 'idx', label: t.charting.indexed },
              ]}
              value={mode}
              onChange={setMode}
              ariaLabel={t.charting.modeLabel}
            />
            <span className="w-px h-4 bg-border" aria-hidden="true" />
            <span title={canTTM ? undefined : t.charting.ttmUnavailable}>
              <SegmentedControl
                options={[
                  { value: 'TTM', label: t.charting.ttm, disabled: !canTTM },
                  { value: 'A', label: t.charting.annual },
                ]}
                value={effFreq}
                onChange={setFreq}
                ariaLabel={t.charting.freqLabel}
              />
            </span>
            <SourceStateBadge sourceKey={financialsBadgeKey} className="ml-auto" />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs text-muted-fg hover:text-foreground nv-transition"
              style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
            >
              <span aria-hidden="true">⚙</span><span>{t.charting.settings}</span>
            </button>
          </GlassSurface>

          {/* Selected chips */}
          {chosen.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {chosen.map(m => (
                <span key={m.key} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-xs text-primary-fg" style={{ backgroundColor: colorOf(m.key) }}>
                  {t.charting.m[m.key as keyof typeof t.charting.m]}
                  <button
                    type="button"
                    onClick={() => toggle(m.key)}
                    className="px-1 opacity-80 hover:opacity-100"
                    aria-label={`${t.charting.removeMetric} ${t.charting.m[m.key as keyof typeof t.charting.m]}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </Reveal>

      <Reveal delayMs={130}>
        <div className="grid grid-cols-12 gap-4 items-start">
          {/* Metric picker */}
          <GlassSurface variant="card" className="col-span-12 lg:col-span-3 p-3 max-h-[520px] overflow-y-auto">
            {CATS.map(({ cat, key }) => (
              <div key={cat} className="mb-3 last:mb-0">
                <div className="ui-label text-muted-fg px-1 mb-1">{t.charting[key]}</div>
                {METRICS.filter(m => m.cat === cat).map(m => {
                  const on = selected.includes(m.key)
                  return (
                    <button key={m.key} type="button" onClick={() => toggle(m.key)} aria-pressed={on}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left nv-transition ${on ? 'bg-surface-2 text-foreground font-medium' : 'text-muted hover:bg-surface-2 hover:text-foreground'}`}>
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: on ? colorOf(m.key) : 'transparent', border: on ? 'none' : '1px solid var(--border)' }} />
                      {t.charting.m[m.key as keyof typeof t.charting.m]}
                    </button>
                  )
                })}
              </div>
            ))}
          </GlassSurface>

          {/* Chart */}
          <GlassSurface variant="card" className="col-span-12 lg:col-span-9 p-4">
            {labels.length === 0 || chosen.length === 0 ? (
              <AsyncState kind="empty" message={records.length === 0 ? t.charting.noData : t.charting.selectMetric} />
            ) : (
              <FundamentalsChart labels={labels} series={series} height={360} indexed={mode === 'idx'} chartType={chartType} showLegend={legend} showGrid={grid} fmtBar={fmtBar} fmtLine={fmtLine} fmtAxis={fmtAxis} />
            )}
            <p className="text-xs text-muted-fg mt-2">
              {[mode === 'idx' ? 'indexed = 100' : null, effFreq === 'TTM' ? 'TTM' : t.charting.annual]
                .filter(Boolean).join(' · ')}
            </p>
            <TableSourceFooter
              source={sourceStatusA === 'persisted' ? persistedA!.source : t.charting.source}
              className="mt-2"
            />
          </GlassSurface>
        </div>
      </Reveal>

      {/* Underlying data */}
      {labels.length > 0 && chosen.length > 0 && (
        <Reveal delayMs={190}>
          <TableCard
            title={t.charting.table}
            minWidth={640}
            controls={
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs text-muted-fg hover:text-foreground nv-transition"
                style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
              >
                <span aria-hidden>⤓</span>{t.common.exportCsv}
              </button>
            }
            footer={<TableSourceFooter source={sourceStatusA === 'persisted' ? persistedA!.source : t.charting.source} />}
          >
            <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.charting.table}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 px-3 pl-4 ui-table-header text-muted-fg sticky left-0 z-10 border-b border-border">{t.charting.metrics}</th>
                  {labels.map(l => <th key={l} scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-center py-2.5 px-3 ui-table-header text-muted-fg whitespace-nowrap border-b border-border">{l}</th>)}
                </tr>
              </thead>
              <tbody>
                {chosen.map(m => (
                  <tr key={m.key} className="border-b border-border last:border-0 nv-row-hover nv-transition">
                    <td style={{ backgroundColor: 'var(--surface-table)' }} className="py-2 px-3 pl-4 sticky left-0 z-10 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-muted"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: colorOf(m.key) }} />{t.charting.m[m.key as keyof typeof t.charting.m]}</span>
                    </td>
                    {periods.map((p, i) => <td key={i} className="py-2 px-3 text-center ui-number text-foreground">{fmtCell(m, valueOf(m, p))}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </Reveal>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <div
          className="no-print nv-scrim fixed inset-0 z-[90] flex items-start justify-center pt-[8vh] px-4"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            role="dialog" aria-modal="true" aria-label={t.charting.settings}
            className="nv-glass-overlay nv-pop w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ backgroundColor: 'var(--nv-hdrbg)', borderBottom: '1px solid var(--nv-line)' }}>
              <span className="ui-label text-foreground">{t.charting.settings}</span>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label={t.fable.panel.close} className="text-muted-fg hover:text-foreground text-sm px-1">✕</button>
            </div>
            <div className="p-4 space-y-3 text-xs">
              <label className="flex items-center justify-between gap-2">
                <span className="text-foreground">{t.charting.chartType}</span>
                <select
                  value={chartType} onChange={e => setChartType(e.target.value as 'auto' | 'lines' | 'bars')}
                  aria-label={t.charting.chartType}
                  className="h-7 rounded-full px-2.5 text-foreground outline-none focus:border-accent nv-transition"
                  style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
                >
                  <option value="auto">{t.charting.auto}</option>
                  <option value="lines">{t.charting.lines}</option>
                  <option value="bars">{t.charting.barsType}</option>
                </select>
              </label>
              <label className="flex items-center justify-between"><span className="text-foreground">{t.charting.legend}</span><input type="checkbox" checked={legend} onChange={e => setLegend(e.target.checked)} className="accent-[var(--primary)]" /></label>
              <label className="flex items-center justify-between"><span className="text-foreground">{t.charting.gridlines}</span><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} className="accent-[var(--primary)]" /></label>
            </div>
            <div className="px-4 py-3 flex justify-end" style={{ backgroundColor: 'var(--nv-hdrbg)', borderTop: '1px solid var(--nv-line)' }}>
              <button type="button" onClick={() => setSettingsOpen(false)} className="text-xs px-3 py-1.5 rounded-full bg-primary text-primary-fg">{t.charting.done}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
