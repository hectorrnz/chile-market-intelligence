'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'

export interface FundSeries {
  key: string
  label: string
  color: string
  type: 'bar' | 'line'
  axis: 'left' | 'right'
  unit: string
  values: (number | null)[]
  dashed?: boolean
  faded?: boolean
}

interface FundamentalsChartProps {
  labels: string[]
  series: FundSeries[]
  height?: number
  indexed?: boolean
  chartType?: 'auto' | 'lines' | 'bars'
  showLegend?: boolean
  showGrid?: boolean
  fmtBar?: (v: number) => string
  fmtLine?: (v: number, unit: string) => string
}

const num = (xs: (number | null)[]) => xs.filter((v): v is number => v != null)
function abbrev(v: number) {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return v.toFixed(a >= 10 ? 0 : 1)
}

export function FundamentalsChart({
  labels, series, height = 340, indexed = false, chartType = 'auto', showLegend = true, showGrid = true, fmtBar, fmtLine,
}: FundamentalsChartProps) {
  const uid = useId().replace(/:/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setW(el.clientWidth || 800)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = labels.length
  if (n < 1 || series.length === 0) {
    return <div className="flex items-center justify-center text-xs text-muted-fg" style={{ height }}>Select a company and at least one metric.</div>
  }

  // Indexed mode: rebase each series to 100 from its first available point.
  const view = indexed
    ? series.map(s => { const base = s.values.find(v => v != null) ?? null; return { ...s, values: base ? s.values.map(v => (v == null ? null : (v / base) * 100)) : s.values.map(() => null) } })
    : series

  const asBar = (s: FundSeries) => !indexed && s.axis === 'left' && (chartType === 'bars' || (chartType === 'auto' && s.type === 'bar'))
  const leftSeries = view.filter(s => indexed || s.axis === 'left')
  const rightSeries = indexed ? [] : view.filter(s => s.axis === 'right')
  const barSeries = view.filter(asBar)
  const useDual = leftSeries.length > 0 && rightSeries.length > 0
  const hasRight = useDual

  const ML = 56
  const MR = hasRight ? 50 : 18
  const MT = 14, MB = 28
  const H = height
  const chartW = Math.max(w - ML - MR, 10)
  const chartH = H - MT - MB

  // Left axis is the primary axis. If only right-axis metrics are selected they share it.
  const leftPool = leftSeries.length ? leftSeries : rightSeries
  const leftRaw = leftPool.flatMap(s => num(s.values))
  const lExtra = indexed ? [100] : barSeries.length ? [0] : []
  const lPool = leftRaw.concat(lExtra)
  let lMin = lPool.length ? Math.min(...lPool) : 0
  let lMaxR = lPool.length ? Math.max(...lPool) : 1
  if (!isFinite(lMin)) lMin = 0
  if (!isFinite(lMaxR)) lMaxR = 1
  if (lMin === lMaxR) lMaxR = lMin + 1
  const lPad = (lMaxR - lMin) * 0.08 || 1
  const lMax = lMaxR + lPad
  const lRange = (lMax - lMin) || 1

  const rightRaw = useDual ? rightSeries.flatMap(s => num(s.values)) : []
  const rMinR = rightRaw.length ? Math.min(...rightRaw) : 0
  let rMaxR = rightRaw.length ? Math.max(...rightRaw) : 1
  if (rMinR === rMaxR) rMaxR = rMinR + 1
  const rPad = (rMaxR - rMinR) * 0.12 || 1
  const rMin = rMinR - rPad, rMax = rMaxR + rPad
  const rRange = (rMax - rMin) || 1

  const slotW = chartW / n
  const slotCenter = (i: number) => ML + (i + 0.5) * slotW
  const toYLeft = (v: number) => MT + chartH - ((v - lMin) / lRange) * chartH
  const toYRight = (v: number) => MT + chartH - ((v - rMin) / rRange) * chartH
  const baseY = indexed ? toYLeft(100) : toYLeft(0)

  const groupW = slotW * 0.66
  const barW = barSeries.length ? groupW / barSeries.length : 0

  const yTicks = 4
  const lTickVals = Array.from({ length: yTicks + 1 }, (_, i) => lMin + (i / yTicks) * lRange)
  const rTickVals = Array.from({ length: yTicks + 1 }, (_, i) => rMin + (i / yTicks) * rRange)

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect(); if (!rect) return
    const i = Math.floor((e.clientX - rect.left - ML) / slotW)
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const tipLeft = hover != null ? Math.max(80, Math.min(w - 80, slotCenter(hover))) : 0

  const lineSeries = view.filter(s => !asBar(s))

  return (
    <div className="w-full">
      <div ref={wrapRef} className="relative w-full" style={{ height: H }}>
        <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs><clipPath id={`clip-${uid}`}><rect x={ML} y={MT} width={chartW} height={chartH} /></clipPath></defs>

          {lTickVals.map((v, i) => {
            const y = toYLeft(v)
            return (
              <g key={i}>
                {showGrid && <line x1={ML} y1={y} x2={ML + chartW} y2={y} stroke="var(--border)" strokeWidth="1" opacity="0.4" />}
                <text x={ML - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">{indexed ? v.toFixed(0) : abbrev(v)}</text>
              </g>
            )
          })}
          {hasRight && rTickVals.map((v, i) => (
            <text key={i} x={ML + chartW + 6} y={toYRight(v)} textAnchor="start" dominantBaseline="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">{v.toFixed(1)}</text>
          ))}

          <line x1={ML} y1={baseY} x2={ML + chartW} y2={baseY} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray={indexed ? '4 3' : undefined} />

          {hover != null && <rect x={ML + hover * slotW} y={MT} width={slotW} height={chartH} fill="var(--surface-2)" opacity="0.5" />}

          {barSeries.map((s, bi) => (
            <g key={s.key} clipPath={`url(#clip-${uid})`}>
              {s.values.map((v, i) => {
                if (v == null) return null
                const x = slotCenter(i) - groupW / 2 + bi * barW
                const y = toYLeft(Math.max(v, 0))
                const h = Math.abs(toYLeft(v) - baseY)
                return <rect key={i} x={x + 1} y={y} width={Math.max(barW - 2, 1)} height={Math.max(h, 0.5)} fill={s.color} opacity={s.faded ? 0.45 : 0.9} />
              })}
            </g>
          ))}

          {lineSeries.map(s => {
            const yOf = (v: number) => (indexed || !useDual || s.axis === 'left' ? toYLeft(v) : toYRight(v))
            const pts = s.values.map((v, i) => (v == null ? null : `${slotCenter(i).toFixed(1)},${yOf(v).toFixed(1)}`)).filter(Boolean) as string[]
            return (
              <g key={s.key} clipPath={`url(#clip-${uid})`}>
                <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 3' : undefined} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, i) => v == null ? null : <circle key={i} cx={slotCenter(i)} cy={yOf(v)} r="2.5" fill={s.color} />)}
              </g>
            )
          })}

          {labels.map((q, i) => (
            <text key={q + i} x={slotCenter(i)} y={MT + chartH + 16} textAnchor="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">{q}</text>
          ))}

          <rect x={ML} y={MT} width={chartW} height={chartH} fill="none" stroke="var(--border)" strokeWidth="1" />
        </svg>

        {hover != null && (
          <div className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 shadow-md" style={{ left: tipLeft, top: 2, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
            <div className="text-xs font-semibold text-foreground mb-0.5">{labels[hover]}</div>
            {series.map(s => {
              const raw = s.values[hover]
              const iv = indexed ? view.find(v => v.key === s.key)?.values[hover] ?? null : null
              return (
                <div key={s.key} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}</span>
                  <span className="ui-number text-foreground">
                    {raw == null ? '—' : indexed ? `${iv!.toFixed(1)} (${s.type === 'bar' ? (fmtBar ? fmtBar(raw) : abbrev(raw)) : (fmtLine ? fmtLine(raw, s.unit) : `${raw}${s.unit}`)})` : s.type === 'bar' ? (fmtBar ? fmtBar(raw) : abbrev(raw)) : (fmtLine ? fmtLine(raw, s.unit) : `${raw}${s.unit}`)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showLegend && (
        <div className="flex items-center gap-4 flex-wrap mt-2">
          {series.map(s => {
            const isBarSeries = asBar(s)
            return (
              <div key={s.key} className="flex items-center gap-1.5 text-xs">
                {isBarSeries ? (
                  <span className="inline-block w-3 h-2.5 rounded-sm" style={{ backgroundColor: s.color, opacity: s.faded ? 0.5 : 1 }} />
                ) : s.dashed ? (
                  <svg width="18" height="10" viewBox="0 0 18 10" style={{ flexShrink: 0 }}>
                    <line x1="0" y1="5" x2="18" y2="5" stroke={s.color} strokeWidth="2" strokeDasharray="4 2" />
                  </svg>
                ) : (
                  <svg width="18" height="10" viewBox="0 0 18 10" style={{ flexShrink: 0 }}>
                    <line x1="0" y1="5" x2="18" y2="5" stroke={s.color} strokeWidth="2" />
                  </svg>
                )}
                <span className="text-muted-fg">{s.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
