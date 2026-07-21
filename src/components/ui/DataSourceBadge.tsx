'use client'

import { useLang } from '@/components/providers/LangProvider'
import type { DataSourceStatus } from '@/lib/providers/types'

/**
 * Compact source/status chip (Phase 4A). Subtle by design — a small dot + label
 * so a static fallback never looks like an error.
 *
 * Visible text is always the bare status word (e.g. "Live", never "Live BCCh")
 * — the specific source name belongs in the table's "Source: X as of ..."
 * footer, not the badge. `provider` still disambiguates which live provider
 * actually backs the data (BCCh vs FRED), but only surfaces via the hover
 * tooltip now, never in the always-visible label.
 */
const STATUS_KEY: Record<DataSourceStatus, 'static' | 'live' | 'hybridFallback' | 'liveUnavailable' | 'persisted'> = {
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

export function DataSourceBadge({
  status,
  provider = 'BCCh',
  className = '',
}: {
  status: DataSourceStatus
  /** Which live provider backs this data — shown only in the hover tooltip. */
  provider?: 'BCCh' | 'FRED' | 'Yahoo Finance'
  className?: string
}) {
  const { t } = useLang()
  const label = t.dataSource[STATUS_KEY[status]]
  const title = (status === 'live' || status === 'persisted') ? `${label} — ${provider}` : label
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-fg whitespace-nowrap ${className}`}
      title={title}
    >
      <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: DOT_COLOR[status] }} aria-hidden />
      {label}
    </span>
  )
}
