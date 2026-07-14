'use client'

import { useLang } from '@/components/providers/LangProvider'
import { formatSourceDate } from '@/lib/formatters'

/**
 * Standardized table footnote: "Source: {source} as of {Mon/DD/YY}". Every
 * table on the platform should render its source line through this component
 * rather than a hand-written string, so the wording never drifts table to
 * table. `asOf` is optional — omit it for a table with no single as-of date
 * (renders "Source: {source}" only).
 */
export function TableSourceFooter({
  source,
  asOf,
  className = '',
}: {
  source: string
  asOf?: string | null
  className?: string
}) {
  const { t } = useLang()
  return (
    <p className={`text-xs text-muted-fg ${className}`}>
      {t.common.source}: {source}
      {asOf ? ` ${t.common.asOf} ${formatSourceDate(asOf)}` : ''}
    </p>
  )
}
