'use client'

// R13.6 — historical published-week selector (doc 07 §§ 7.2, 9).
//
// A native, labelled `<select>` — deliberately not a `SegmentedControl`, which
// "does not scale" to ~100 dated options (doc 07 § 9), and not a custom
// dropdown, which would re-implement keyboard and screen-reader behaviour the
// platform control already has. Options are the CURRENT published weeks the
// API returned, newest first; the label is the week's own as-of date, read
// straight off the string (never through `new Date()`, which would shift a
// date-only value across Chile's UTC offset).

import { useId } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { formatIsoDateLabel } from '@/lib/formatters'
import type { FamilyPortfolioWeek } from '@/lib/data/familyPortfolio'

interface WeekSelectorProps {
  weeks: FamilyPortfolioWeek[]
  value: string
  onChange: (asOfDate: string) => void
  disabled?: boolean
  /** Overrides the default "week" label — R13.R1.1 § 13 reuses this control as
   *  the custom range's FROM endpoint, which needs its own name. */
  label?: string
  /**
   * An extra option ABOVE the weeks. The § 13 range selector uses it for the
   * weekly default, so choosing a range and returning to weekly are the same
   * one control rather than a mode switch the user has to find first.
   */
  leadingOption?: { value: string; label: string }
}

export function WeekSelector({
  weeks,
  value,
  onChange,
  disabled,
  label,
  leadingOption,
}: WeekSelectorProps) {
  const { t } = useLang()
  const id = useId()
  if (weeks.length === 0) return null
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-muted-fg">
      <span className="ui-label">{label ?? t.fp.portfolio.weekSelector}</span>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface border border-border rounded-[13px] px-2.5 py-1.5 text-xs text-foreground ui-number"
      >
        {leadingOption && (
          <option key="__leading" value={leadingOption.value}>
            {leadingOption.label}
          </option>
        )}
        {weeks.map((w) => (
          <option key={w.asOfDate} value={w.asOfDate}>
            {formatIsoDateLabel(w.asOfDate)}
            {w.revision > 1 ? ` · ${t.fp.portfolio.revisionShort} ${w.revision}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
