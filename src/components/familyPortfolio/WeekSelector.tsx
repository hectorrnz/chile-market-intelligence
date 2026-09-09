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
//
// ── DATES ONLY (post-R13.8) ────────────────────────────────────────────────
//
// The option carried a "· Rev. N" suffix on any revised week. Revision is
// PUBLICATION BOOKKEEPING: R13.8's restatement pass lifted seven weeks to a new
// revision at once, so an ordinary reader picking a date was suddenly reading
// "31-07-2026 · Rev. 4" and being asked to care which internal revision of a
// week they were looking at. They cannot choose otherwise in any case — the API
// serves the CURRENT revision of each date and no superseded one is reachable
// from here — so the suffix offered a distinction without a choice.
//
// The identity is not lost, only unlabelled here: `revision` still travels on
// every week, the page headers and the provenance footnote beside the source
// still print it, and the administrator's own audit surfaces still show the
// full revision chain.

import { useId } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { formatIsoDateLabel } from '@/lib/formatters'
import type { FamilyPortfolioWeek } from '@/lib/data/familyPortfolio'

interface WeekSelectorProps {
  weeks: FamilyPortfolioWeek[]
  value: string
  onChange: (asOfDate: string) => void
  disabled?: boolean
  /** Overrides the default "week" label — the Weekly Changes compare controls
   *  reuse this control as the FROM and TO endpoints, which need their own
   *  names. */
  label?: string
}

export function WeekSelector({
  weeks,
  value,
  onChange,
  disabled,
  label,
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
        // A disabled control must still be READ, not just seen to be off: the
        // dates it holds are the comparison the page is showing. So it dims and
        // takes the not-allowed cursor, and stops there — no muted foreground
        // on top, which would put the one figure that matters below AA.
        className="bg-surface border border-border rounded-[13px] px-2.5 py-1.5 text-xs text-foreground ui-number disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {weeks.map((w) => (
          <option key={w.asOfDate} value={w.asOfDate}>
            {formatIsoDateLabel(w.asOfDate)}
          </option>
        ))}
      </select>
    </label>
  )
}
