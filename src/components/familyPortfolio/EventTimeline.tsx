'use client'

// R13.9 — the Alternatives event-history timeline (doc 07 §§ 7.4, 9).
//
// PRESENTATION ONLY. Events arrive already classified by the R13.4 parser and
// already ordered/grouped by the pure `buildTimeline` — this component never
// classifies, never sorts financially, and never infers a type from a sign.
//
// NEVER MEANING BY COLOUR ALONE (doc 07 § 8): every event carries its type as
// TEXT beside its colour chip. The chip colours are the `--alt-event-*` tokens
// (both themes) consumed through `eventPresentation.ts` — no hex here. An
// `unclassified` event renders the explicit needs-attention treatment: hollow
// warning chip plus its own label, never one of the three semantic colours.
//
// PRIVACY: every amount renders through `MaskedAmount` — this module is the
// most sensitive in the app, and a masked page must leave no raw amount in
// the DOM, including inside accessibility labels.

import type { Translation } from '@/lib/i18n'
import { formatIsoDateLabel } from '@/lib/formatters'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import {
  altEventChipStyle,
  altEventColorVar,
} from '@/lib/familyPortfolio/alternatives/eventPresentation'
import { currencyLabel, type TimelineMonth } from '@/lib/familyPortfolio/alternativesView'

interface EventTimelineProps {
  months: TimelineMonth[]
  masked: boolean
  t: Translation['fp']['alternatives']
}

/** `YYYY-MM` → `MM-YYYY`, read directly off the string — never `new Date()`. */
function monthBandLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  return m ? `${m[2]}-${m[1]}` : month
}

export function eventTypeLabel(
  eventType: string,
  t: Translation['fp']['alternatives'],
): string {
  switch (eventType) {
    case 'aporte':
      return t.eventAporte
    case 'dividendo':
      return t.eventDividendo
    case 'distribucion':
      return t.eventDistribucion
    default:
      return t.eventUnclassified
  }
}

/** The colour chip. Purely decorative — the type is always named in text. */
function EventChip({ eventType }: { eventType: string }) {
  const color = altEventColorVar(eventType)
  const hollow = altEventChipStyle(eventType) === 'hollow'
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 w-2.5 h-2.5 rounded-full"
      style={
        hollow
          ? { border: `2px solid ${color}`, backgroundColor: 'transparent' }
          : { backgroundColor: color }
      }
    />
  )
}

export function EventTimeline({ months, masked, t }: EventTimelineProps) {
  if (months.length === 0) {
    return <p className="text-xs text-muted-fg py-6 text-center">{t.timelineEmpty}</p>
  }
  return (
    <ol className="flex flex-col">
      {months.map((m) => (
        <li key={m.month}>
          <p className="ui-label text-muted-fg bg-surface-2 rounded px-3 py-1.5 mt-2 first:mt-0">
            {monthBandLabel(m.month)}
          </p>
          <ol className="flex flex-col">
            {m.events.map((e, i) => (
              <li
                key={`${e.eventDate}-${e.investmentName ?? 'unknown'}-${i}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-border px-3 py-1.5 text-xs"
              >
                <span className="flex items-center gap-1.5 shrink-0 w-32">
                  <EventChip eventType={e.eventType} />
                  <span
                    className={e.eventType === 'unclassified' ? 'text-warning font-medium' : 'text-muted-fg'}
                  >
                    {eventTypeLabel(e.eventType, t)}
                  </span>
                </span>
                <span className="ui-number text-muted-fg shrink-0">
                  {formatIsoDateLabel(e.eventDate)}
                </span>
                <span className="min-w-0 flex-1 truncate" title={e.investmentName ?? undefined}>
                  {e.investmentName ?? t.unknownInvestment}
                  {e.sociedad !== null && (
                    <span className="text-muted-fg"> · {e.sociedad}</span>
                  )}
                </span>
                <span className="ui-number whitespace-nowrap">
                  <MaskedAmount value={e.amount} masked={masked} signed />
                  <span className="text-muted-fg"> {currencyLabel(e.currency)}</span>
                </span>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}
