'use client'

import { Sparkline, type SparklineTone } from './Sparkline'
import { ChangeIndicator } from './ChangeIndicator'

interface SparklineRowProps {
  label: string
  /** Pre-formatted display value (e.g. "4,42 USD/lb"). */
  value: string
  data: number[]
  tone?: SparklineTone
  changeValue?: number | null
  changeLabel?: string
  /** Required accessible summary for the sparkline itself. */
  summary: string
  className?: string
}

/**
 * A single market/portfolio/watchlist row pairing a label, an inline
 * sparkline, a value, and a change indicator — the compact row shape used in
 * the Fable macro/markets snapshot rows. Presentational only: no data
 * fetching happens here, and it never applies a per-row `backdrop-filter`.
 */
export function SparklineRow({ label, value, data, tone = 'neutral', changeValue, changeLabel, summary, className = '' }: SparklineRowProps) {
  return (
    <div className={`nv-row-hover flex items-center justify-between gap-3 py-1.5 px-1 ${className}`}>
      <span className="text-xs text-muted-fg truncate min-w-0">{label}</span>
      <Sparkline data={data} tone={tone} summary={summary} className="shrink-0" />
      <span className="ui-number text-sm text-foreground shrink-0">{value}</span>
      {changeValue !== undefined && <ChangeIndicator value={changeValue} label={changeLabel} className="shrink-0" />}
    </div>
  )
}
