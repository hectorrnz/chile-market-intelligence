'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'

interface CurveSeries {
  label: string
  color: string
  dashed?: boolean
  values: number[]
}

interface YieldCurveChartProps {
  tenors: string[]
  series: CurveSeries[]
  unit?: string
  height?: number
}

/** Yield-curve chart: categorical x-axis (tenors), absolute y-values (yields). */
export function YieldCurveChart({ tenors, series, unit = '%', height = 240 }: YieldCurveChartProps) {
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

  const n = tenors.length
  if (n < 2) return <div className="text-xs text-muted-fg" style={{ height }}>No data</div>

  const ML = 44, MR = 14, MT = 14, MB = 26
  const H = height
  const chartW = Math.max(w - ML - MR, 10)
  const chartH = H - MT - MB

  const all = series.flatMap(s => s.values)
  const minV = Math.min(...all), maxV = Math.max(...all)
  const range = maxV - minV || 1
  const yMin = minV - range * 0.12, yMax = maxV + range * 0.12
  const yRange = yMax - yMin

  const toX = (i: number) => ML + (i / (n - 1)) * chartW
  const toY = (v: number) => MT + chartH - ((v - yMin) / yRange) * chartH

  const yTicks = 4
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (i / yTicks) * yRange)

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect(); if (!rect) return
    const x = e.clientX - rect.left
    const i = Math.round(((x - ML) / chartW) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const hx = hover != null ? toX(hover) : 0
  const tipLeft = Math.max(70, Math.min(w - 70, hx))

  return (
    <div className="w-full">
      <div ref={wrapRef} className="relative w-full" style={{ height: H }}>
        <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs><clipPath id={`clip-${uid}`}><rect x={ML} y={MT} width={chartW} height={chartH} /></clipPath></defs>

          {yTickVals.map((v, i) => {
            const y = toY(v)
            return (
              <g key={i}>
                <line x1={ML} y1={y} x2={ML + chartW} y2={y} stroke="var(--border)" strokeWidth="1" opacity="0.4" />
                <text x={ML - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">{v.toFixed(1)}{unit}</text>
              </g>
            )
          })}

          {series.map(s => (
            <path key={s.label} d={s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')}
              fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? '5 3' : undefined} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#clip-${uid})`} />
          ))}

          {tenors.map((tn, i) => (
            <text key={tn} x={toX(i)} y={MT + chartH + 16} textAnchor="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">{tn}</text>
          ))}

          <rect x={ML} y={MT} width={chartW} height={chartH} fill="none" stroke="var(--border)" strokeWidth="1" />

          {hover != null && (
            <g>
              <line x1={hx} y1={MT} x2={hx} y2={MT + chartH} stroke="var(--muted-fg)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
              {series.map(s => <circle key={s.label} cx={hx} cy={toY(s.values[hover])} r="3" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />)}
            </g>
          )}
        </svg>

        {hover != null && (
          <div className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 shadow-md" style={{ left: tipLeft, top: 2, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
            <div className="text-xs font-semibold text-foreground mb-0.5">{tenors[hover]}</div>
            {series.map(s => (
              <div key={s.label} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />{s.label}</span>
                <span className="ui-number text-foreground">{s.values[hover].toFixed(2)}{unit}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap mt-2">
        {series.map(s => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className="inline-block w-3" style={{ height: 2, backgroundColor: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
            <span className="text-muted-fg">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
