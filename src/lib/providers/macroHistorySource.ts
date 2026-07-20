// Pure decision logic for resolveMacroHistory's persisted-vs-live choice.
// No I/O — safe to unit-test directly.
//
// Real bug found 2026-07-20: `isSufficientHistory`'s point-count + flat
// 6-month staleness gate accepted a persisted observation as "good enough"
// even when the live source already had a materially newer print — verified
// directly against FRED's own CSV endpoint (CPIAUCSL had a 2026-06-01 value
// while the persisted store, well within the 6-month window, was still
// serving 2026-05-01 for every timeframe). Point-count sufficiency answers
// "is there enough history to draw a chart"; it says nothing about whether a
// fresher print has since been published. This picks whichever source is
// genuinely more current, not just whichever clears its own bar first.

export interface MacroSourceCandidates {
  persistedOk: boolean
  /** ISO date of the persisted series' last point, or '' if unavailable. */
  persistedLatestDate: string
  liveOk: boolean
  /** ISO date of the live series' last point, or '' if unavailable. */
  liveLatestDate: string
}

/**
 * 'live' whenever live succeeded and is at least as fresh as persisted (or
 * persisted isn't usable at all); 'persisted' when persisted is usable and
 * live isn't fresher; 'none' when neither source produced usable data.
 */
export function pickFreshestMacroSource(c: MacroSourceCandidates): 'live' | 'persisted' | 'none' {
  if (c.liveOk && (!c.persistedOk || c.liveLatestDate > c.persistedLatestDate)) return 'live'
  if (c.persistedOk) return 'persisted'
  return 'none'
}
