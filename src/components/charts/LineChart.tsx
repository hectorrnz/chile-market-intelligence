'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'

interface DataPoint {
  date: string
  value: number
}

export interface ChartMarker {
  date: string
  label: string
  kind?: 'earnings' | 'filing'
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseDate(s: string): Date {
  return new Date(s.length === 7 ? `${s}-01` : s)
}

export function LineChart({
  data, unit = '', height = 200, valueFormatter,
  compareData, compareLabel, primaryLabel, markers,
}: LineChartProps) {
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
      <div className="flex items-center justify-center text-xs text-muted-fg" style={{ height }}>
        No data available
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

  const first = parseDate(data[0].date)
  const last = parseDate(data[data.length - 1].date)
  const spanDays = (last.getTime() - first.getTime()) / 86_400_000

  const formatX = (s: string) => {
    const d = parseDate(s)
    const mon = MONTHS[d.getMonth()]
    const yy = String(d.getFullYear()).slice(2)
    if (spanDays <= 31) return `${d.getDate()} ${mon}`
    return `${mon} '${yy}`
  }
  const formatTooltipDate = (s: string) => {
    const d = parseDate(s)
    const mon = MONTHS[d.getMonth()]
    if (spanDays <= 400) return `${d.getDate()} ${mon} ${d.getFullYear()}`
    return `${mon} ${d.getFullYear()}`
  }
  const fmtVal = (v: number) =>
    valueFormatter ? valueFormatter(v) : `${v.toLocaleString('es-CL', { maximumFractionDigits: 2 })}${unit}`

  const isPositive = data[data.length - 1].value >= data[0].value
  const strokeColor = hasCompare ? 'var(--accent)' : (isPositive ? 'var(--positive)' : 'var(--negative)')

  // Map markers to x positions within the visible range
  const lo = data[0].date, hi = data[data.length - 1].date
  const markerPts = (markers ?? [])
    .filter(m => m.date >= lo && m.date <= hi)
    .map(m => {
      let idx = data.findIndex(d => d.date >= m.date)
      if (idx < 0) idx = data.length - 1
      return { x: toX(idx, data.length), label: m.label, kind: m.kind ?? 'filing' }
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

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: H }}>
      <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
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
              <line x1={ML} y1={y} x2={ML + chartW} y2={y} stroke="var(--border)" strokeWidth="1" opacity="0.5" />
              <text x={ML - 8} y={y} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">
                {formatY(v)}{unit}
              </text>
            </g>
          )
        })}

        {!hasCompare && <path d={areaPath} fill={`url(#area-${uid})`} clipPath={`url(#clip-${uid})`} />}

        {hasCompare && (
          <path d={comparePath} fill="none" stroke="var(--muted-fg)" strokeWidth="1.25" strokeDasharray="4 3" opacity="0.8" clipPath={`url(#clip-${uid})`} />
        )}

        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#clip-${uid})`} />

        {xTickIndices.map(idx => {
          const x = toX(idx, data.length)
          return (
            <g key={idx}>
              <line x1={x} y1={baseline} x2={x} y2={baseline + 4} stroke="var(--border)" strokeWidth="1" />
              <text x={x} y={baseline + 16} textAnchor="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">
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
            fill={m.kind === 'earnings' ? 'var(--primary)' : 'var(--warning)'}
          >
            <title>{m.label}</title>
          </path>
        ))}

        <rect x={ML} y={MT} width={chartW} height={chartH} fill="none" stroke="var(--border)" strokeWidth="1" />

        {hp && (
          <g>
            <line x1={hp.x} y1={MT} x2={hp.x} y2={baseline} stroke="var(--muted-fg)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            <circle cx={hp.x} cy={hp.y} r="3.5" fill={strokeColor} stroke="var(--surface)" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {/* Legend when comparing two series */}
      {hasCompare && (
        <div className="pointer-events-none absolute top-1 right-2 flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: 'var(--accent)' }} />{primaryLabel}</span>
          <span className="flex items-center gap-1 text-muted-fg"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: 'var(--muted-fg)' }} />{compareLabel}</span>
        </div>
      )}

      {hover != null && hp && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 shadow-md"
          style={{ left: tipLeft, top: 2, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}
        >
          <div className="ui-number text-xs font-semibold text-foreground">{fmtVal(data[hover].value)}</div>
          {hasCompare && compareData![hover] && (
            <div className="ui-number text-xs text-muted-fg">{compareLabel}: {fmtVal(compareData![hover].value)}</div>
          )}
          <div className="text-xs text-muted-fg">{formatTooltipDate(data[hover].date)}</div>
        </div>
      )}
    </div>
  )
}
