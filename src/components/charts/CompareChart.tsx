'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'

interface Series {
  ticker: string
  color: string
  dashed?: boolean
  data: { date: string; value: number }[]
}

interface CompareChartProps {
  series: Series[]
  height?: number
  showGrid?: boolean
  lineWidth?: number
  legend?: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function parseDate(s: string): Date { return new Date(s.length === 7 ? `${s}-01` : s) }

/** Cumulative % return chart (each series rebased to 0% from its first point) — COMP-style. */
export function CompareChart({ series, height = 300, showGrid = true, lineWidth = 1.75, legend = false }: CompareChartProps) {
  const uid = useId().replace(/:/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(800)
  const [hover, setHover] = useState<number | null>(null)
  const [hi, setHi] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setW(el.clientWidth || 800)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const live = series.filter(s => s.data.length >= 2)
  if (live.length === 0) {
    return <div className="flex items-center justify-center text-xs text-muted-fg" style={{ height }}>No data</div>
  }

  const n = Math.min(...live.map(s => s.data.length))
  const ret = live.map(s => {
    const slice = s.data.slice(-n)
    const base = slice[0].value || 1
    return { ticker: s.ticker, color: s.color, dashed: s.dashed, pts: slice.map(p => ({ date: p.date, value: (p.value / base - 1) * 100 })) }
  })
  const dates = ret[0].pts.map(p => p.date)

  const ML = 50, MR = 16, MT = 14, MB = 26
  const H = height
  const chartW = Math.max(w - ML - MR, 10)
  const chartH = H - MT - MB

  const all = ret.flatMap(s => s.pts.map(p => p.value)).concat([0])
  const minV = Math.min(...all), maxV = Math.max(...all)
  const range = maxV - minV || 1
  const yMin = minV - range * 0.08, yMax = maxV + range * 0.08
  const yRange = yMax - yMin

  const toX = (i: number) => ML + (i / (n - 1)) * chartW
  const toY = (v: number) => MT + chartH - ((v - yMin) / yRange) * chartH

  const yTicks = 4
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (i / yTicks) * yRange)
  const xTickCount = Math.min(n, 6)
  const xTickIdx = Array.from({ length: xTickCount }, (_, i) => Math.round((i / (xTickCount - 1)) * (n - 1)))

  const first = parseDate(dates[0]), last = parseDate(dates[n - 1])
  const spanDays = (last.getTime() - first.getTime()) / 86_400_000
  const fmtX = (s: string) => {
    const d = parseDate(s); const mon = MONTHS[d.getMonth()]; const yy = String(d.getFullYear()).slice(2)
    return spanDays <= 31 ? `${d.getDate()} ${mon}` : `${mon} '${yy}`
  }

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect(); if (!rect) return
    const x = e.clientX - rect.left
    const i = Math.round(((x - ML) / chartW) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }

  const hx = hover != null ? toX(hover) : 0
  const tipLeft = Math.max(70, Math.min(w - 70, hx))
  const zeroY = toY(0)

  return (
    <div className="w-full">
    <div ref={wrapRef} className="relative w-full" style={{ height: H }}>
      <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs><clipPath id={`clip-${uid}`}><rect x={ML} y={MT} width={chartW} height={chartH} /></clipPath></defs>

        {yTickVals.map((v, i) => {
          const y = toY(v)
          return (
            <g key={i}>
              {showGrid && <line x1={ML} y1={y} x2={ML + chartW} y2={y} stroke="var(--border)" strokeWidth="1" opacity="0.4" />}
              <text x={ML - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">
                {v > 0 ? '+' : ''}{v.toFixed(0)}%
              </text>
            </g>
          )
        })}

        {/* 0% baseline */}
        <line x1={ML} y1={zeroY} x2={ML + chartW} y2={zeroY} stroke="var(--muted-fg)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />

        {ret.map(s => (
          <path key={s.ticker} d={s.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ')}
            fill="none" stroke={s.color}
            strokeWidth={hi === s.ticker ? lineWidth + 1.75 : lineWidth}
            opacity={hi && hi !== s.ticker ? 0.3 : 1}
            strokeDasharray={s.dashed ? '5 3' : undefined} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#clip-${uid})`} />
        ))}

        {xTickIdx.map(i => (
          <g key={i}>
            <line x1={toX(i)} y1={MT + chartH} x2={toX(i)} y2={MT + chartH + 4} stroke="var(--border)" strokeWidth="1" />
            <text x={toX(i)} y={MT + chartH + 16} textAnchor="middle" fontSize="11" fill="var(--muted-fg)" fontFamily="var(--font-sans)">{fmtX(dates[i])}</text>
          </g>
        ))}

        <rect x={ML} y={MT} width={chartW} height={chartH} fill="none" stroke="var(--border)" strokeWidth="1" />

        {hover != null && (
          <g>
            <line x1={hx} y1={MT} x2={hx} y2={MT + chartH} stroke="var(--muted-fg)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
            {ret.map(s => <circle key={s.ticker} cx={hx} cy={toY(s.pts[hover].value)} r="3" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />)}
          </g>
        )}
      </svg>

      {hover != null && (
        <div className="pointer-events-none absolute z-10 rounded border border-border bg-surface px-2 py-1 shadow-md" style={{ left: tipLeft, top: 2, transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
          {ret.map(s => {
            const v = s.pts[hover].value
            return (
              <div key={s.ticker} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} /><span className="font-mono text-foreground">{s.ticker}</span></span>
                <span className={`ui-number ${v >= 0 ? 'text-positive' : 'text-negative'}`}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>
              </div>
            )
          })}
          <div className="text-xs text-muted-fg mt-0.5">{dates[hover]}</div>
        </div>
      )}
    </div>

    {legend && (
      <div className="flex items-center gap-4 flex-wrap mt-2">
        {ret.map(s => {
          const last = s.pts[s.pts.length - 1].value
          const active = hi === s.ticker
          return (
            <button
              key={s.ticker}
              onClick={() => setHi(active ? null : s.ticker)}
              title="Click to highlight"
              className={`flex items-center gap-1.5 text-xs rounded px-1 transition-opacity ${hi && !active ? 'opacity-50' : ''}`}
            >
              <span className="inline-block w-3" style={{ height: active ? 3 : 2, backgroundColor: s.color }} />
              <span className={`font-mono text-foreground ${active ? 'font-bold' : ''}`}>{s.ticker}</span>
              <span className={`ui-number ${last >= 0 ? 'text-positive' : 'text-negative'}`}>{last >= 0 ? '+' : ''}{last.toFixed(2)}%</span>
            </button>
          )
        })}
      </div>
    )}
    </div>
  )
}
