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

/** Observation closest to one year before `isoDate`, searching `arr[0..idx]`. */
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
      const ya = yearAgo(arr, idx)
      // require a meaningfully-distant base (~>= 6 months) to avoid a bogus yoy
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
