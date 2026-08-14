'use client'

// R13.7 — dual-freshness disclosure (doc 06 § 5 element 21; doc 07 § 9).
//
// Portfolio and Alternatives publish on INDEPENDENT lifecycles with their own
// as-of dates (doc 05 § 6). Where both appear on one surface, the standing
// "one as-of per surface" rule forbids blending them into a single generic
// "updated" stamp — so this renders one labelled chip PER dataset, each with
// its own date, and an honest `—` when a dataset has never been published.
// Existing badges assume exactly one as-of, hence the dedicated component.

import { useLang } from '@/components/providers/LangProvider'
import { formatIsoDateLabel } from '@/lib/formatters'

interface FreshnessEntry {
  label: string
  /** The dataset's own as-of date (YYYY-MM-DD), or null when never published. */
  asOfDate: string | null
}

export function DualFreshnessBadge({ entries }: { entries: FreshnessEntry[] }) {
  const { t } = useLang()
  if (entries.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {entries.map((e) => (
        <span
          key={e.label}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs bg-surface-2 text-muted-fg"
        >
          <span className="ui-label">{e.label}</span>
          <span className="ui-number text-foreground">
            {e.asOfDate ? formatIsoDateLabel(e.asOfDate) : '—'}
          </span>
          <span className="sr-only">{e.asOfDate ? '' : t.fable.kpi.unavailable}</span>
        </span>
      ))}
    </div>
  )
}
