'use client'

import { useLang } from '@/components/providers/LangProvider'
import type { DataSourceStatus } from '@/lib/providers/types'

/**
 * Compact source/status chip (Phase 4A). Subtle by design — a small dot + label
 * so a static fallback never looks like an error. Mirrors AsOfBadge styling.
 */
const STATUS_KEY: Record<DataSourceStatus, 'static' | 'live' | 'hybridFallback' | 'liveUnavailable'> = {
  static: 'static',
  live: 'live',
  'hybrid-fallback': 'hybridFallback',
  'live-unavailable': 'liveUnavailable',
}

const DOT_COLOR: Record<DataSourceStatus, string> = {
  static: 'var(--muted-fg)',
  live: 'var(--positive)',
  'hybrid-fallback': 'var(--accent)',
  'live-unavailable': 'var(--warning)',
}

export function DataSourceBadge({ status, className = '' }: { status: DataSourceStatus; className?: string }) {
  const { t } = useLang()
  const label = t.dataSource[STATUS_KEY[status]]
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
