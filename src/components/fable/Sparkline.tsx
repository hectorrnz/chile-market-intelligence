'use client'

export type SparklineTone = 'positive' | 'negative' | 'neutral'

const TONE_VAR: Record<SparklineTone, string> = {
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  neutral: 'var(--muted-fg)',
}

interface SparklineProps {
  /** Plain numeric series — oldest first. No fetching here; the caller supplies real data. */
  data: number[]
  tone?: SparklineTone
  width?: number
  height?: number
  className?: string
  /** Required accessible text summary — the trend is never conveyed by shape or color alone. */
  summary: string
}

/**
 * Minimal inline SVG sparkline (no chart library). Static by construction —
 * there is nothing to animate, so it is reduced-motion-safe with no extra
 * handling, and it never carries a `backdrop-filter` (safe to use per-row in
 * a dense table per design_principles §7.2 rule 4).
 */
export function Sparkline({ data, tone = 'neutral', width = 64, height = 20, className = '', summary }: SparklineProps) {
  const values = data.filter((v) => Number.isFinite(v))

  if (values.length < 2) {
    return (
      <span className={`inline-block text-xs text-muted-fg ${className}`} role="img" aria-label={summary}>
        —
      </span>
    )
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || Math.abs(max) || 1
  const toX = (i: number) => (i / (values.length - 1)) * width
  const toY = (v: number) => height - ((v - min) / range) * height
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} role="img" aria-label={summary}>
      <path
        d={path}
        fill="none"
        stroke={TONE_VAR[tone]}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
