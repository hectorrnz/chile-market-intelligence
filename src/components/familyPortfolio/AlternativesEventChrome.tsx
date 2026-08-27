'use client'

// R13.R4A — the shared presentation chrome for an Alternatives event: its
// label, its colour chip, and the legend that explains both.
//
// SUPERSEDES `EventTimeline.tsx`. Through R13.9 the event history was a
// month-banded LIST, and that component owned the chip and label helpers. The
// Cash Flows view replaces the list with a real column table — date, event,
// investment, sociedad, currency, amount — which is what an LP cash-flow ledger
// is, and which aligns Cash Flows with Holdings instead of giving the module
// two different ways to render a row. Every element the list rendered survives
// in that table; only the layout changed.
//
// What is left is the chrome, and it lives here because THREE surfaces need it
// — the Dashboard's recent-activity strip, the Cash Flows ledger, and the
// event-type filter. Three inline copies of a chip is three chances for one of
// them to drift into a different colour or a different hollow rule.
//
// PRESENTATION ONLY. Events arrive already classified by the R13.4 parser
// (doc 03 § 3.4). Nothing here classifies, re-derives a colour, reads a
// resolved hex off a row, or infers a type from an amount's sign.
//
// NEVER MEANING BY COLOUR ALONE (doc 07 § 8): the chip is `aria-hidden` and the
// type is ALWAYS named in text beside it. Colours come from the `--alt-event-*`
// tokens (declared for both themes) through `eventPresentation.ts` — no hex
// here. `unclassified` renders the explicit needs-attention treatment: a hollow
// warning chip plus its own label, never one of the three semantic colours.

import type { Translation } from '@/lib/i18n'
import {
  altEventChipStyle,
  altEventColorVar,
  ALT_EVENT_TYPES,
} from '@/lib/familyPortfolio/alternatives/eventPresentation'

type AltT = Translation['fp']['alternatives']

/**
 * The source legend's own vocabulary for the three classified types
 * (doc 03 § 3.2), and NMI's own for the unclassified state.
 */
export function eventTypeLabel(eventType: string, t: AltT): string {
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
export function EventChip({ eventType }: { eventType: string }) {
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

/**
 * Chip plus label, the pairing every event row uses. `unclassified` also takes
 * the warning text treatment, so the actionable state reads as actionable
 * without depending on the chip's colour.
 */
export function EventTypeTag({ eventType, t }: { eventType: string; t: AltT }) {
  return (
    <span className="flex items-center gap-1.5">
      <EventChip eventType={eventType} />
      <span className={eventType === 'unclassified' ? 'text-warning font-medium' : undefined}>
        {eventTypeLabel(eventType, t)}
      </span>
    </span>
  )
}

/**
 * The three source types plus the explicit unclassified state, in legend order.
 *
 * `compact` (R13.R4A.1) drops the "Event legend" caption and tightens the
 * spacing, for a placement where the legend sits beside its own heading and
 * the caption would be a third label on one line. The owner's R13.R4A.1 review
 * cut the per-chart legends down to ONE per section — so nothing consumes
 * `compact` today; it stays because the entries themselves — chip, name,
 * order — are identical in both dresses, so a future dense placement can never
 * disagree with the full legend about what a colour means.
 */
export function EventLegend({ t, compact = false }: { t: AltT; compact?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center ${compact ? 'gap-x-2.5 gap-y-1' : 'gap-x-4 gap-y-1'}`}
      aria-label={t.legendTitle}
    >
      {!compact && <span className="ui-label text-muted-fg">{t.legendTitle}</span>}
      {ALT_EVENT_TYPES.map((type) => (
        <span
          key={type}
          className={`flex items-center gap-1.5 ${compact ? 'ui-meta text-muted-fg' : 'text-xs'}`}
        >
          <EventChip eventType={type} />
          {eventTypeLabel(type, t)}
        </span>
      ))}
    </div>
  )
}
