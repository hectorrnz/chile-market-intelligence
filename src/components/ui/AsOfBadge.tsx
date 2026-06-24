'use client'

import { useLang } from '@/components/providers/LangProvider'
import { formatDate } from '@/lib/formatters'
import { DATA_AS_OF } from '@/lib/constants'

/**
 * Small "as of <date>" freshness chip. Sets the institutional-terminal tone and
 * pre-builds the slot for live per-source timestamps in Phase 4.
 */
export function AsOfBadge({ date = DATA_AS_OF, className = '' }: { date?: string; className?: string }) {
  const { t } = useLang()
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-muted-fg whitespace-nowrap ${className}`}
      title={`${t.common.asOf} ${formatDate(date)}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-positive inline-block shrink-0" aria-hidden />
      {t.common.asOf} <span className="ui-number">{formatDate(date)}</span>
    </span>
  )
}
