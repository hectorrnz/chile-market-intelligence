// R13.R4A.5 — where a filter popover may sit, so it stays whole.
//
// PURE MODULE. No React, no DOM, no Next.js — the same discipline as
// `chartTooltipPosition.ts`, and for the same reason. R13.R4A.4 established it:
// the arithmetic that decides whether a reader sees a WHOLE floating panel is
// the part most worth testing directly, because its failure mode is silent — a
// panel that renders perfectly at the width the author happened to look at and
// runs off the screen at another. Buried inside a layout effect it can only be
// checked by rendering; extracted here it can be checked by assertion.
//
// THE PANEL IS LEFT-ANCHORED TO ITS TRIGGER, and that is the right default: a
// menu reads from the control it belongs to. It only moves when staying put
// would take it off the screen, and then only far enough. Two rules, in this
// order:
//
//   1 · The right edge must clear the viewport's right gutter. A control near
//       the right edge of a narrow screen — the Dashboard's per-card year
//       selector at 390px is the measured case — would otherwise push a 306px
//       panel some 170px past the edge and give the whole PAGE a horizontal
//       scrollbar, which this app never allows.
//
//   2 · …but never past the LEFT gutter. Shifting further would trade an
//       off-screen right edge for an off-screen left one, and the left one is
//       worse: the reader loses the checkmarks and the start of every label.
//
// THIS MODULE SETS NO WIDTH, deliberately. The panel's width is capped in CSS
// at `min(18rem, 100vw - 2rem)`, and that cap is strictly tighter than the
// gutters this module keeps: `100vw - 2rem` is 34px inside the viewport where
// the two gutters together take 32px, so a panel that satisfies the cap always
// fits between them and rule 1 can always be honoured. An inline width written
// here would not add safety — it would OVERRIDE the class cap (an inline style
// wins) and let the panel grow to the full gutter-to-gutter span, which was
// measured at 1408px on a 1440 viewport before this note existed. The narrower
// cap belongs in one place, and that place is the class.

/** Breathing room kept between the panel and each viewport edge. */
export const POPOVER_GUTTER_PX = 16

export interface PopoverClamp {
  /** The trigger wrapper's left edge, in viewport coordinates. */
  anchorLeft: number
  /** The panel's rendered width. */
  panelWidth: number
  /** The viewport's own width — `documentElement.clientWidth`, never `100vw`. */
  viewportWidth: number
}

/**
 * The panel's `left`, RELATIVE TO ITS ANCHOR: `0` leaves it flush with the
 * trigger, a negative value slides it back toward the left edge. Never
 * positive — a panel is never pushed further right than the control it opens
 * from.
 *
 * Non-finite input yields `0`, the flush default: an unmeasurable panel should
 * render where the markup already puts it, not at a computed nonsense offset.
 */
export function clampPopoverLeft({ anchorLeft, panelWidth, viewportWidth }: PopoverClamp): number {
  if (!Number.isFinite(anchorLeft) || !Number.isFinite(panelWidth) || !Number.isFinite(viewportWidth)) {
    return 0
  }
  // Rule 1 — how far it must slide left to clear the right gutter (≤ 0).
  const fit = viewportWidth - POPOVER_GUTTER_PX - panelWidth - anchorLeft
  // Rule 2 — the furthest left it may go before crossing the left gutter.
  const floor = POPOVER_GUTTER_PX - anchorLeft
  return Math.max(Math.min(0, fit), floor)
}
