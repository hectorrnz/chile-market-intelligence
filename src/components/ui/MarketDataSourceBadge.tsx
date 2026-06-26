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
 * Compact market data source chip (Phase 4C). Mirrors DataSourceBadge styling
 * but uses marketData i18n keys so labels reference Bolsa de Santiago, not BCCh.
 */
export function MarketDataSourceBadge({
  status,
  className = '',
}: {
  status: DataSourceStatus
  className?: string
}) {
  const { t } = useLang()
  const label = t.marketData[STATUS_KEY[status]]
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-fg whitespace-nowrap ${className}`}
      title={label}
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
