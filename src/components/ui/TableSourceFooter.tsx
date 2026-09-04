'use client'

import { useLang } from '@/components/providers/LangProvider'
import { formatSourceDate, formatSourceDateFull } from '@/lib/formatters'

/**
 * Standardized table footnote: "Source: {source} as of {…}". Every table on the
 * platform should render its source line through this component rather than a
 * hand-written string, so the wording never drifts table to table. `asOf` is
 * optional — omit it for a table with no single as-of date (renders
 * "Source: {source}" only).
 *
 * `asOfFormat` defaults to `'short'`, the documented platform convention
 * (`HH:MM` for earlier today, `DD-MM` otherwise). R13.7B2.2 § 11 adds an opt-in
 * `'full'` for surfaces where the as-of is a fixed CONTRACTUAL date rather than
 * a refresh time — a structured note's valuation-date levels — because "28-08"
 * gave the owner review no year and no unambiguous field order. No existing
 * caller changes behaviour by omitting the prop.
 */
export function TableSourceFooter({
  source,
  asOf,
  asOfFormat = 'short',
  className = '',
}: {
  source: string
  asOf?: string | null
  asOfFormat?: 'short' | 'full'
  className?: string
}) {
  const { t } = useLang()
  const fmt = asOfFormat === 'full' ? formatSourceDateFull : formatSourceDate
  return (
    <p className={`text-xs text-muted-fg ${className}`}>
      {t.common.source}: {source}
      {asOf ? ` ${t.common.asOf} ${fmt(asOf)}` : ''}
    </p>
  )
}
