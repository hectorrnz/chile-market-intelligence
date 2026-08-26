// R13.R4A.4 — where a chart tooltip is allowed to sit.
//
// Pure, and separate from the component, for one reason: this is the arithmetic
// that decides whether the reader sees the whole tooltip or a cut-off one, and
// arithmetic that matters is worth testing directly rather than inferring from
// a rendered page. No React, no DOM, no imports — `node --test` runs it as is.
//
// THE PROBLEM IT SOLVES. A tooltip centred on its column with no bound pushes
// half its width past the plot at the first and last column, where two separate
// boxes cut it off — the plot's own `overflow-x-auto` (a scroll container clips
// BOTH axes, not just the one it scrolls) and, inside a `TableCard`, that
// card's `overflow-hidden`. Estimating the width in order to nudge it back is
// how the cut-off comes back the moment the content changes, so the caller
// measures the rendered tooltip and clamps by the real figure.

/** Breathing room kept between the tooltip and the edge it stops against. */
export const TIP_EDGE_PX = 4

export interface TooltipClamp {
  /** The hovered column's centre, in the containing box's own coordinates. */
  center: number
  /** The box the tooltip must stay inside — the room it actually has. */
  boxWidth: number
  /** The tooltip's MEASURED width. 0 before the first measurement lands. */
  tipWidth: number
}

/**
 * The tooltip's `left`, given that it renders centred on that point
 * (`translateX(-50%)`).
 *
 * Both edges are held inside the box. When the box is narrower than the tooltip
 * itself the two bounds cross — no position satisfies both — and it centres
 * instead; `tooltipMaxWidth` then makes the text wrap to fit rather than run
 * out of the card. An unmeasured tooltip (width 0) still cannot leave the box:
 * the clamp degrades to the box's own bounds, never to a raw column centre.
 */
export function clampTooltipLeft({ center, boxWidth, tipWidth }: TooltipClamp): number {
  const half = tipWidth / 2
  const min = half + TIP_EDGE_PX
  const max = boxWidth - half - TIP_EDGE_PX
  if (min > max) return boxWidth / 2
  return Math.min(Math.max(center, min), max)
}

/**
 * The ceiling handed to the tooltip so it can never be wider than its box.
 * Never negative — a box too small to hold anything yields 0, which the caller
 * passes through unchanged rather than turning into a nonsense width.
 */
export function tooltipMaxWidth(boxWidth: number): number {
  return Math.max(0, boxWidth - 2 * TIP_EDGE_PX)
}
