'use client'

import { useLang } from '@/components/providers/LangProvider'
import type { DataSourceStatus } from '@/lib/providers/types'

const STATUS_KEY: Record<DataSourceStatus, keyof ReturnType<typeof useLang>['t']['cmfData']> = {
  static:           'static',
  live:             'live',
  'hybrid-fallback':'hybridFallback',
  'live-unavailable':'liveUnavailable',
}

const DOT_COLOR: Record<DataSourceStatus, string> = {
  static:            'var(--muted-fg)',
  live:              'var(--positive)',
  'hybrid-fallback': 'var(--accent)',
  'live-unavailable':'var(--warning)',
}

/**
 * Compact CMF data source chip (Phase 5A). Mirrors DataSourceBadge and
 * MarketDataSourceBadge but uses cmfData i18n keys so labels reference
 * CMF (Comisión para el Mercado Financiero), not BCCh or Brain Data.
 */
export function CmfDataSourceBadge({
  status,
  className = '',
}: {
  status: DataSourceStatus
  className?: string
}) {
  const { t } = useLang()
  const label = t.cmfData[STATUS_KEY[status]]
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
