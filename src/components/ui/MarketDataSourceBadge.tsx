'use client'

import { useLang } from '@/components/providers/LangProvider'
import type { DataSourceStatus } from '@/lib/providers/types'

const STATUS_KEY: Record<DataSourceStatus, keyof ReturnType<typeof useLang>['t']['marketData']> = {
  static: 'static',
  live: 'live',
  'hybrid-fallback': 'hybridFallback',
  'live-unavailable': 'liveUnavailable',
  persisted: 'persisted',
}

const DOT_COLOR: Record<DataSourceStatus, string> = {
  static: 'var(--muted-fg)',
  live: 'var(--positive)',
  'hybrid-fallback': 'var(--accent)',
  'live-unavailable': 'var(--warning)',
  persisted: 'var(--accent)',
}

/**
 * Compact market data source chip (Phase 4C). Mirrors DataSourceBadge styling.
 * Visible text is always the bare status word (e.g. "Live", never "Live —
 * Yahoo Finance") — the source name belongs in the table's "Source: X as of
 * ..." footer, not the badge; it still surfaces via the hover tooltip.
 *
 * R11: `provider` used to be hardcoded to Yahoo Finance, which made the tooltip
 * lie on the one consumer whose data is not Yahoo's (the Earnings tab's CMF
 * report-date calendar read "Live — Yahoo Finance" above a CMF footer). It is
 * now a prop defaulting to Yahoo Finance, exactly as DataSourceBadge already
 * models the same idea — every existing call site is unaffected.
 */
export function MarketDataSourceBadge({
  status,
  provider = 'Yahoo Finance',
  className = '',
}: {
  status: DataSourceStatus
  /** Which source actually backs this data — shown only in the hover tooltip. */
  provider?: 'Yahoo Finance' | 'CMF'
  className?: string
}) {
  const { t } = useLang()
  const label = t.marketData[STATUS_KEY[status]]
  const title = (status === 'live' || status === 'persisted') ? `${label} — ${provider}` : label
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-fg whitespace-nowrap ${className}`}
      title={title}
    >
      <span
        className="w-1.5 h-1.5 rounded-full inline-block shrink-0"
        style={{ backgroundColor: DOT_COLOR[status] }}
        aria-hidden
      />
      {label}
    </span>
  )
}
