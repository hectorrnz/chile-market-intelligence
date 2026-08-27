'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { formatChartValue } from '@/lib/formatters'
import { ChartTooltip } from '@/components/fable/chart/ChartTooltip'
import { formatTemplate } from '@/components/fable/chart/chartA11y'
import { calendarSpanDays, formatAxisDate, formatChartTooltipDate } from '@/lib/charts/dateAxis'

interface DataPoint {
  date: string
  value: number
}

export interface ChartMarker {
  date: string
  label: string
}

interface LineChartProps {
  data: DataPoint[]
  unit?: string
  height?: number
  valueFormatter?: (v: number) => string
  /** Optional second series drawn as a thin muted line (e.g. a benchmark). */
  compareData?: DataPoint[]
  compareLabel?: string
  primaryLabel?: string
  /** Optional event markers rendered on the x-axis baseline. */
  markers?: ChartMarker[]
}

export function LineChart({
  data, unit = '', height = 200, valueFormatter,
  compareData, compareLabel, primaryLabel, markers,
}: LineChartProps) {
  const { t } = useLang()
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

  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-fg" style={{ height }} role="status">
        {t.common.noData}
      </div>
    )
  }

  const ML = 56
  const MR = 18
  const MT = 14
  const MB = 28
  const H = height
  const chartW = Math.max(w - ML - MR, 10)
  const chartH = H - MT - MB

  const hasCompare = !!(compareData && compareData.length >= 2)
  const allValues = data.map(d => d.value).concat(hasCompare ? compareData!.map(d => d.value) : [])
  const minV = Math.min(...allValues)
  const maxV = Math.max(...allValues)
  const range = maxV - minV || Math.abs(maxV) || 1
  const padPct = 0.1
  const yMin = minV - range * padPct
  const yMax = maxV + range * padPct
  const yRange = yMax - yMin

  const toX = (i: number, n: number) => ML + (i / (n - 1)) * chartW
  const toY = (v: number) => MT + chartH - ((v - yMin) / yRange) * chartH

  const points = data.map((d, i) => ({ x: toX(i, data.length), y: toY(d.value) }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(MT + chartH).toFixed(1)} L${ML},${(MT + chartH).toFixed(1)} Z`

  const comparePath = hasCompare
    ? compareData!.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i, compareData!.length).toFixed(1)},${toY(d.value).toFixed(1)}`).join(' ')
    : ''

  const yTicks = 4
  const yStep = yRange / yTicks
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + i * yStep)

  const xTickCount = Math.min(data.length, 6)
  const xTickIndices = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i / (xTickCount - 1)) * (data.length - 1))
  )

  const formatY = (v: number) => {
    const abs = Math.abs(v)
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`
    if (abs >= 100) return v.toFixed(0)
    if (abs >= 10) return v.toFixed(1)
    return v.toFixed(2)
  }

  // Calendar-date semantics, shared by the axis and the tooltip so they can
  // never disagree, and immune to the viewer's timezone — a 2026-08-07
  // publication reads "7 Aug" everywhere (see `dateAxis.ts`).
  const spanDays = calendarSpanDays(data[0].date, data[data.length - 1].date)
  const formatX = (s: string) => formatAxisDate(s, spanDays)
  const formatTooltipDate = (s: string) => formatChartTooltipDate(s, spanDays)
  const fmtVal = (v: number) => (valueFormatter ? valueFormatter(v) : formatChartValue(v, unit))

  const isPositive = data[data.length - 1].value >= data[0].value
  // Chart lines use the Fable-designated chart palette (--chart-primary,
  // aliasing --nv-ch1) rather than the generic UI --accent token, so the
  // chart language stays retunable independently of the rest of the UI.
  const strokeColor = hasCompare ? 'var(--chart-primary)' : (isPositive ? 'var(--chart-positive)' : 'var(--chart-negative)')

  // Map markers to x positions within the visible range
  const lo = data[0].date, hi = data[data.length - 1].date
  const markerPts = (markers ?? [])
    .filter(m => m.date >= lo && m.date <= hi)
    .map(m => {
      let idx = data.findIndex(d => d.date >= m.date)
      if (idx < 0) idx = data.length - 1
      return { x: toX(idx, data.length), label: m.label }
    })

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const i = Math.round(((x - ML) / chartW) * (data.length - 1))
    setHover(Math.max(0, Math.min(data.length - 1, i)))
  }

  const hp = hover != null ? points[hover] : null
  const tipLeft = hp ? Math.max(60, Math.min(w - 60, hp.x)) : 0
  const baseline = MT + chartH

  // Accessible text alternative (design_principles §20 — a chart is never
  // "accessible" merely because its SVG carries a <title>). A short name goes
  // on aria-label; the fuller data summary — point count, date range, latest
  // value, and (when present) the compare-series value and marker count — is
  // exposed via aria-describedby so the real numbers are always available to
  // assistive tech, not just a decorative label.
  const descId = `${uid}-desc`
  let longSummary = formatTemplate(t.fable.chart.lineChartSummary, {
    count: String(data.length),
    from: formatTooltipDate(data[0].date),
    to: formatTooltipDate(data[data.length - 1].date),
    latest: fmtVal(data[data.length - 1].value),
  })
  if (hasCompare && compareData) {
    longSummary += ' ' + formatTemplate(t.fable.chart.compareSuffix, {
      label: compareLabel ?? t.fable.chart.comparisonSeries,
      value: fmtVal(compareData[compareData.length - 1].value),
    })
  }
  if (markerPts.length > 0) {
    longSummary += ' ' + formatTemplate(t.fable.chart.markersSuffix, { count: String(markerPts.length) })
  }

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      style={{ height: H, backgroundColor: 'var(--chart-bg)' }}
      role="img"
      aria-label={t.fable.chart.lineChart}
      aria-describedby={descId}
    >
      <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} aria-hidden="true">
        <title>{t.fable.chart.lineChart}</title>
        <defs>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.16" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.01" />
          </linearGradient>
          <clipPath id={`clip-${uid}`}><rect x={ML} y={MT} width={chartW} height={chartH} /></clipPath>
        </defs>

        {yTickVals.map((v, i) => {
          const y = toY(v)
          return (
            <g key={i}>
              <line x1={ML} y1={y} x2={ML + chartW} y2={y} stroke="var(--chart-grid)" strokeWidth="1" opacity="0.5" />
              <text x={ML - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="var(--fs-meta)" fill="var(--chart-axis)" fontFamily="var(--font-sans)">
                {formatY(v)}{unit}
              </text>
            </g>
          )
        })}

        {!hasCompare && <path d={areaPath} fill={`url(#area-${uid})`} clipPath={`url(#clip-${uid})`} />}

        {hasCompare && (
          <path d={comparePath} fill="none" stroke="var(--chart-comparison)" strokeWidth="1.25" strokeDasharray="4 3" opacity="0.8" clipPath={`url(#clip-${uid})`} />
        )}

        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#clip-${uid})`} />

        {xTickIndices.map(idx => {
          const x = toX(idx, data.length)
          return (
            <g key={idx}>
              <line x1={x} y1={baseline} x2={x} y2={baseline + 4} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={x} y={baseline + 16} textAnchor="middle" fontSize="var(--fs-meta)" fill="var(--chart-axis)" fontFamily="var(--font-sans)">
                {formatX(data[idx].date)}
              </text>
            </g>
          )
        })}

        {/* Event markers on the baseline */}
        {markerPts.map((m, i) => (
          <path
            key={i}
            d={`M${m.x.toFixed(1)},${(baseline - 7).toFixed(1)} L${(m.x - 4).toFixed(1)},${baseline.toFixed(1)} L${(m.x + 4).toFixed(1)},${baseline.toFixed(1)} Z`}
            fill="var(--chart-primary)"
          >
            <title>{m.label}</title>
          </path>
        ))}

        <rect x={ML} y={MT} width={chartW} height={chartH} fill="none" stroke="var(--chart-border)" strokeWidth="1" />

        {hp && (
          <g>
            <line x1={hp.x} y1={MT} x2={hp.x} y2={baseline} stroke="var(--chart-crosshair)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <circle cx={hp.x} cy={hp.y} r="3.5" fill={strokeColor} stroke="var(--chart-selected-point)" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {/* Legend when comparing two series */}
      {hasCompare && (
        <div className="pointer-events-none absolute top-1 right-2 flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: 'var(--chart-primary)' }} />{primaryLabel}</span>
          <span className="flex items-center gap-1 text-muted-fg"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: 'var(--chart-comparison)' }} />{compareLabel}</span>
        </div>
      )}

      {hover != null && hp && (
        <ChartTooltip left={tipLeft}>
          <div className="ui-number text-xs font-semibold">{fmtVal(data[hover].value)}</div>
          {hasCompare && compareData![hover] && (
            <div className="ui-number text-xs text-muted-fg">{compareLabel}: {fmtVal(compareData![hover].value)}</div>
          )}
          <div className="text-xs text-muted-fg">{formatTooltipDate(data[hover].date)}</div>
        </ChartTooltip>
      )}

      <p id={descId} className="sr-only">{longSummary}</p>
    </div>
  )
}
