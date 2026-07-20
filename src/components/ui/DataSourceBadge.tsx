'use client'

import { useLang } from '@/components/providers/LangProvider'
import type { DataSourceStatus } from '@/lib/providers/types'

/**
 * Compact source/status chip (Phase 4A). Subtle by design — a small dot + label
 * so a static fallback never looks like an error.
 *
 * `provider` disambiguates which live provider actually backs the data —
 * without it, `live`/`persisted` defaulted to BCCh-flavored wording
 * ("Live BCCh") even when the underlying series was FRED-sourced (US macro),
 * a real mislabeling bug found in the US Macro page/popup charts and the
 * Home page's US Macro band. Only `live`/`persisted` need a provider variant;
 * static/hybrid-fallback/live-unavailable are already provider-agnostic.
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
  /** Which live provider backs this data — selects "Live BCCh" vs "Live FRED" wording. */
  provider?: 'BCCh' | 'FRED'
  className?: string
}) {
  const { t } = useLang()
  const key = provider === 'FRED' && status === 'live' ? 'liveFred'
    : provider === 'FRED' && status === 'persisted' ? 'persistedFred'
    : STATUS_KEY[status]
  const label = t.dataSource[key]
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-fg whitespace-nowrap ${className}`}
      title={label}
    >
      <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: DOT_COLOR[status] }} aria-hidden />
      {label}
    </span>
  )
}
