// R13.7B2.2.1 § 2 — PRESENTATION helper for the normalized barrier gauge.
//
// PURE MODULE. No React, no i18n, no Supabase — directly testable under plain
// `node --test`. It decides WHICH marks share a tick on the 0–130
// percent-of-initial track; the component composes the visible label from the
// `kinds` this returns, so the language layer stays in the component.
//
// WHY THIS MODULE EXISTS
// ──────────────────────
// A note's contractual thresholds are expressed as fractions of each
// underlying's own initial level, and several of them can coincide. For the
// current book the coupon barrier and the knock-in barrier are both 65%, and
// the call level is 100% — i.e. the initial level itself. Drawing two
// indistinguishable ticks at 65 said nothing; drawing "Call level · Initial /
// call level" at 100 said the same thing twice. The owner's question — "are the
// call level and the coupon barrier the same?" — is exactly the confusion an
// unmerged or badly-labelled gauge produces. They are NOT the same: 100 vs 65.
//
// THE RULE
// ────────
// Marks whose normalized level rounds to the same hundredth collapse to ONE
// mark that remembers every kind sitting there. The surviving `kind` (which
// drives the tick colour and the gauge's proximity colouring) is the most
// severe one present: knock-in > coupon > autocall > strike. So the merged 65
// mark stays a knock-in for `proximityColor`, and the merged 100 mark reads as
// the call level.

export type GaugeMarkKind = 'knockIn' | 'coupon' | 'autocall' | 'strike' | 'other'

export interface GaugeMarkInput {
  kind: GaugeMarkKind
  /** Normalized level — percent of the underlying's own initial level (100 = initial). */
  level: number
}

export interface MergedGaugeMark {
  /** The most severe kind present at this level — drives colour and proximity. */
  kind: GaugeMarkKind
  level: number
  /** Every distinct kind that sits at this level, most severe first. */
  kinds: GaugeMarkKind[]
}

/** Severity order: a knock-in outranks a coupon barrier, which outranks the call level, which outranks the bare strike line. */
export const KIND_SEVERITY: Record<GaugeMarkKind, number> = {
  knockIn: 0,
  coupon: 1,
  autocall: 2,
  strike: 3,
  other: 4,
}

/** The level key: two marks share a tick when their levels agree to the hundredth. */
export function markLevelKey(level: number): number {
  return Math.round(level * 100) / 100
}

/**
 * Collapses coinciding marks to one entry per distinct normalized level,
 * sorted by level ascending. Never invents a level and never drops a kind —
 * every input kind appears in exactly one output `kinds` list.
 */
export function mergeCoincidingMarks(marks: GaugeMarkInput[]): MergedGaugeMark[] {
  const byLevel = new Map<number, MergedGaugeMark>()
  for (const m of marks) {
    if (!Number.isFinite(m.level)) continue
    const key = markLevelKey(m.level)
    const seen = byLevel.get(key)
    if (!seen) {
      byLevel.set(key, { kind: m.kind, level: key, kinds: [m.kind] })
      continue
    }
    if (!seen.kinds.includes(m.kind)) seen.kinds.push(m.kind)
    seen.kinds.sort((a, b) => KIND_SEVERITY[a] - KIND_SEVERITY[b])
    seen.kind = seen.kinds[0]
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level)
}

/**
 * True when the coupon barrier and the knock-in barrier share a tick — the
 * one genuine coincidence in the current book, and the one the owner asked to
 * be named as a single "Coupon / knock-in barrier" mark.
 */
export function isCouponKnockInMark(m: MergedGaugeMark): boolean {
  return m.kinds.includes('coupon') && m.kinds.includes('knockIn')
}

/**
 * True when the call level coincides with the initial level (autocall barrier
 * of 100%). The initial line then IS the call line and is named once as
 * "Initial / call level" — never as "Call level · Initial / call level".
 */
export function isInitialCallMark(m: MergedGaugeMark): boolean {
  return m.kinds.includes('strike') && m.kinds.includes('autocall')
}
