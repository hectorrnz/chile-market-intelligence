// Phase 4B — Live macro value/change transformations.
//
// PURE module (no imports, no I/O) so it is unit-tested directly and can be
// imported by Node scripts. Given a raw BCCh series (a list of dated values),
// derives the headline `value` and the `change` shown in the UI, honoring the
// indicator's transformation. The UI keeps its convention: value first, change
// second in one pair of parentheses — so `change` here is a plain number in the
// same unit as `value` (no bp/pp suffixes).

// 'level-diff' — the period-over-period ABSOLUTE change of a level series
// (curr − prev), in the series' own units. Added Phase 8D.3 to derive the
// headline Nonfarm Payrolls print ("+150K jobs") from FRED PAYEMS, which is a
// cumulative employment LEVEL in thousands of persons — never shown raw as the
// headline. Unlike 'mom' (a percentage change), this is a raw difference.
export type Transform = 'none' | 'yoy' | 'mom' | 'level-to-yoy' | 'bp-to-pct' | 'level-diff'

export interface SeriesPoint { date: string; value: number | null }
export interface Derived { value: number; change: number | null; asOf: string }

function round2(n: number): number { return Math.round(n * 100) / 100 }

function valued(points: SeriesPoint[]): { date: string; value: number }[] {
  return points
    .filter((p): p is { date: string; value: number } => p.value != null && Number.isFinite(p.value))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** % change of curr vs base, guarding a zero base. */
function pct(curr: number, base: number): number {
  if (base === 0) return 0
  return round2(((curr - base) / Math.abs(base)) * 100)
}

const DAY_MS = 86_400_000

/**
 * R13.R5F § 1B — how far the accepted year-ago base may sit from the TRUE
 * one-year-ago date.
 *
 * `yearAgo` picks the nearest available observation. Before this guard it
 * accepted that nearest point no matter how distant, so a series fetched
 * without enough leading context silently compared against a DIFFERENT
 * period and returned a plausible-looking wrong number. Found live: CPI y/y
 * for 2026-07-01 was persisted as 2.95 — that is 2026-07 measured against
 * 2025-08, because 2025-07 was outside the fetched window. The true figure is
 * 3.30 (332.813 / 322.169 − 1).
 *
 * 16 days is chosen to sit strictly BELOW the shortest calendar month (28),
 * so a monthly series can never substitute an adjacent month, while still
 * absorbing the real jitter a genuine base carries: weekend/holiday shifts on
 * daily series, month-end resampling (`monthEndSample`), and leap-year
 * roll-over (2026-02-29 − 1y lands on 2025-03-01 in JS).
 *
 * Correctness outranks completeness: outside the tolerance the metric is
 * unavailable (null) and the point is dropped, never estimated.
 */
export const YEAR_AGO_MAX_DRIFT_DAYS = 16

/**
 * Observation closest to one year before `arr[idx].date`, searching
 * `arr[0..idx]` — or null when nothing lands within
 * `YEAR_AGO_MAX_DRIFT_DAYS` of that date.
 */
function yearAgo(arr: { date: string; value: number }[], idx: number): { date: string; value: number } | null {
  const target = new Date(arr[idx].date)
  target.setFullYear(target.getFullYear() - 1)
  const t = target.getTime()
  let best: { date: string; value: number } | null = null
  let bestDiff = Infinity
  for (let i = 0; i <= idx; i++) {
    const diff = Math.abs(new Date(arr[i].date).getTime() - t)
    if (diff < bestDiff) { bestDiff = diff; best = arr[i] }
  }
  // A candidate beyond the tolerance is a different period, not a year-ago
  // base. Reject it rather than report a comparison nobody asked for.
  if (best === null || bestDiff > YEAR_AGO_MAX_DRIFT_DAYS * DAY_MS) return null
  return best
}

/** The displayed metric using observation `idx` as "current". */
function metricAt(arr: { date: string; value: number }[], idx: number, transform: Transform): number | null {
  const cur = arr[idx]
  switch (transform) {
    case 'none': return round2(cur.value)
    case 'bp-to-pct': return round2(cur.value / 100)
    case 'mom': {
      const prev = idx > 0 ? arr[idx - 1] : null
      return prev ? pct(cur.value, prev.value) : null
    }
    case 'level-diff': {
      const prev = idx > 0 ? arr[idx - 1] : null
      return prev ? round2(cur.value - prev.value) : null
    }
    case 'yoy':
    case 'level-to-yoy': {
      // `yearAgo` owns the tolerance policy (see YEAR_AGO_MAX_DRIFT_DAYS) and
      // returns null when no genuine year-ago base exists. The identity check
      // is unreachable through it today — a point is always ~365 days from its
      // own year-ago target — and is kept only so this branch stays correct if
      // that policy is ever loosened.
      const ya = yearAgo(arr, idx)
      if (!ya || ya.date === cur.date) return null
      return pct(cur.value, ya.value)
    }
  }
}

/**
 * Derive the headline value + change for an indicator from its raw series.
 * `change` is the difference between the transformed metric at the latest and
 * the previous observation (same unit as value). Returns null if no usable data.
 */
export function deriveValueChange(points: SeriesPoint[], transform: Transform): Derived | null {
  const arr = valued(points)
  if (arr.length === 0) return null
  const lastIdx = arr.length - 1
  const value = metricAt(arr, lastIdx, transform)
  if (value == null) return null
  const prevMetric = lastIdx > 0 ? metricAt(arr, lastIdx - 1, transform) : null
  const change = prevMetric == null ? null : round2(value - prevMetric)
  return { value: round2(value), change, asOf: arr[lastIdx].date }
}

/**
 * Downsamples a series published at a finer cadence than its declared
 * `frequency` down to one observation per calendar month — the LATEST
 * observation on or before each month's last available date. Added Phase
 * 8D.4 for FRED's DFEDTARU (Fed funds target range upper limit): FRED
 * publishes it daily, but it's a step function that only changes on FOMC
 * decision dates — resampling to month-end keeps its cadence/history
 * consistent with every other monthly US indicator instead of persisting
 * thousands of duplicate daily rows. Never invents a value — only ever
 * selects a real observation that was actually published.
 */
export function monthEndSample(points: SeriesPoint[]): SeriesPoint[] {
  const arr = valued(points)
  const byMonth = new Map<string, { date: string; value: number }>()
  for (const p of arr) {
    const monthKey = p.date.slice(0, 7) // YYYY-MM
    const existing = byMonth.get(monthKey)
    if (!existing || p.date > existing.date) byMonth.set(monthKey, p)
  }
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Transform an entire series for charting (each point carries the displayed
 * metric). Points with no derivable metric (e.g. early points lacking a
 * year-ago base for yoy) are dropped.
 */
export function transformSeries(points: SeriesPoint[], transform: Transform): { date: string; value: number }[] {
  const arr = valued(points)
  const out: { date: string; value: number }[] = []
  for (let i = 0; i < arr.length; i++) {
    const v = metricAt(arr, i, transform)
    if (v != null) out.push({ date: arr[i].date, value: v })
  }
  return out
}

// ─── Fetch horizon (R13.R5F § 1A) ─────────────────────────────────────────────
//
// A transform needs history BEFORE the oldest observation an ingestion run
// intends to persist. Both ingestion modules previously fetched a flat "one
// extra year from today" while their per-frequency STORE windows reach much
// further back (120 days monthly, 400 days quarterly) — so the oldest storable
// monthly point needed a base ~485 days back that was never fetched, and
// `yearAgo` substituted a neighbouring month. The horizon is now derived from
// the two quantities that actually determine it — the store window and the
// transform's own lookback — instead of a constant unrelated to either.
//
// These live here, beside the transforms whose requirements they express, so
// the shared ingestion modules and the standalone CLI scripts (which run under
// plain Node and cannot import framework code) can both use them.

/**
 * Nominal length of one observation period, by declared series frequency.
 * Deliberately generous — this only sizes a fetch window, and over-fetching
 * costs one wider bounded request while under-fetching corrupts a value.
 */
const PERIOD_DAYS: Record<string, number> = {
  daily: 7, weekly: 14, monthly: 31, quarterly: 92,
}

/**
 * Calendar slack added on top of the lookback: publication lag, month-end vs
 * first-of-month dating, and the leading gap before a sparse series' first
 * observation inside the fetched range.
 */
export const FETCH_CONTEXT_TOLERANCE_DAYS = 45

/** Days of history a transform needs before its oldest persisted observation. */
export function transformLookbackDays(transform: Transform, frequency?: string): number {
  switch (transform) {
    case 'yoy':
    case 'level-to-yoy':
      return 366  // a leap year, so the base is always inside the window
    case 'mom':
    case 'level-diff':
      return PERIOD_DAYS[frequency ?? 'monthly'] ?? PERIOD_DAYS.monthly
    case 'none':
    case 'bp-to-pct':
      return 0
  }
}

/**
 * The earliest date a FETCH must reach so every observation from
 * `storeWindowStart` onward can be transformed against a real prior
 * observation. For a lookback-free transform the store window is already
 * sufficient and the date is returned unchanged.
 */
export function requiredFetchStart(
  storeWindowStart: string,
  transform: Transform,
  frequency?: string,
): string {
  const lookback = transformLookbackDays(transform, frequency)
  if (lookback === 0) return storeWindowStart
  const d = new Date(storeWindowStart + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - (lookback + FETCH_CONTEXT_TOLERANCE_DAYS))
  return d.toISOString().slice(0, 10)
}

/** The earlier of two ISO dates — ISO-8601 sorts lexicographically. */
export function earliestIso(a: string, b: string): string {
  return a < b ? a : b
}
