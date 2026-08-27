// R13.R2 §§ 16-21 — period selection over the real Portfolio Evolution history.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, and —
// deliberately — NO CLOCK. Every boundary is computed from the SERIES' OWN
// latest observation, never from `Date.now()`: a viewer opening the page months
// after the last upload must still see the last real week as the endpoint,
// not an empty range ending today (§ 19: "no viewer-current-date endpoint
// assumption"). That also keeps this module directly unit-testable.
//
// THE OBSERVATIONS ARE THE TRUTH. A period selects a WINDOW over points that
// already exist; it never creates one. There is no interpolation, no synthetic
// weekend or month-end value, no carry-forward, and no resampling. A period
// whose boundary falls inside a genuine source gap simply starts at the first
// real observation after it, and a period containing one observation is
// reported honestly as such rather than padded to look continuous.
//
// § 18 IS ENFORCED BY VOCABULARY. The 102-week series are portfolio VALUE
// LEVELS, so the only percentage this module computes is named
// `valueChangeRatio` and is documented as a value change. Nothing here is
// called a return, and nothing here is flow-adjusted — an investment return
// over a period with contributions and withdrawals is a different number, and
// it comes from the separately validated performance series, not from levels.

export interface EvolutionObservation {
  /** ISO `YYYY-MM-DD` — the source column's own header date. */
  date: string
  value: number
  /**
   * The week's published net flow, CARRIED THROUGH UNTOUCHED for the caller's
   * flow adjustment (R13.R2 pass 4 § 2). This module never reads it: a period
   * selects a window over levels, and the adjustment that consumes this field
   * lives in `flowAdjustedEvolution.ts`, after the window is chosen.
   */
  flow?: number | null
}

/**
 * The broker-style ranges (§ 19). `6M` is deliberately absent: the spec allows
 * it only on a demonstrated product need, and five ranges already cover the
 * two-year record without crowding the control.
 */
export const EVOLUTION_PERIODS = ['1M', '3M', 'YTD', '1Y', 'ALL'] as const

export type EvolutionPeriod = (typeof EVOLUTION_PERIODS)[number]

export function isEvolutionPeriod(value: unknown): value is EvolutionPeriod {
  return typeof value === 'string' && (EVOLUTION_PERIODS as readonly string[]).includes(value)
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

interface Ymd {
  y: number
  m: number
  d: number
}

function parseIso(iso: string): Ymd | null {
  const m = ISO_DATE.exec(iso)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return { y, m: mo, d }
}

function formatIso({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Days in a Gregorian month — the clamp target when a month is shorter. */
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * Calendar-month arithmetic with END-OF-MONTH CLAMPING: 31 Jul minus one month
 * is 30 Jun, not an invalid 31 Jun that would silently roll into July and make
 * a "1M" window a few days long. Weeks land on any weekday, so this is reached
 * routinely.
 */
export function shiftIsoMonths(iso: string, months: number): string | null {
  const p = parseIso(iso)
  if (p === null) return null
  const zeroBased = p.y * 12 + (p.m - 1) + months
  const y = Math.floor(zeroBased / 12)
  const m = (zeroBased % 12 + 12) % 12 + 1
  return formatIso({ y, m, d: Math.min(p.d, daysInMonth(y, m)) })
}

/**
 * The logical period start for a range ending at `endpoint`. Null means "no
 * lower bound" (ALL). ISO date strings compare correctly as strings, so the
 * boundary is applied by plain lexicographic comparison — no timezone, no
 * clock, no drift.
 */
export function periodBoundary(endpoint: string, period: EvolutionPeriod): string | null {
  const p = parseIso(endpoint)
  if (p === null) return null
  switch (period) {
    case 'ALL':
      return null
    // YTD is the calendar year of the ENDPOINT, not of the viewer's today.
    case 'YTD':
      return formatIso({ y: p.y, m: 1, d: 1 })
    case '1M':
      return shiftIsoMonths(endpoint, -1)
    case '3M':
      return shiftIsoMonths(endpoint, -3)
    case '1Y':
      return shiftIsoMonths(endpoint, -12)
  }
}

export interface EvolutionRange {
  period: EvolutionPeriod
  /** The observations inside the window, ascending. Never synthesised. */
  points: EvolutionObservation[]
  /** The window's first REAL observation date, or null when empty. */
  startDate: string | null
  /** The window's last REAL observation date, or null when empty. */
  endDate: string | null
  /**
   * The computed logical boundary, retained for disclosure: when it is EARLIER
   * than `startDate` the source simply has no observation there, and the
   * surface can say so instead of implying the period began on the boundary.
   * Null for ALL.
   */
  boundary: string | null
  /**
   * True when the requested period is longer than the record — the window was
   * clipped by the start of the history, not by the source missing weeks.
   */
  truncatedByHistory: boolean
}

function sortAscending(points: readonly EvolutionObservation[]): EvolutionObservation[] {
  return [...points]
    .filter((p) => typeof p.date === 'string' && ISO_DATE.test(p.date) && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * THE range selector (§ 19). The endpoint is the series' own latest
 * observation; the window is every real observation on or after the boundary.
 *
 * `endpointOverride` exists for one legitimate case only — Compare mode, where
 * both series must share one endpoint so the two lines cannot be drawn to
 * different last weeks. It is never a way to pick an arbitrary end date, and a
 * value later than the series' own last observation cannot invent a point.
 */
export function selectEvolutionRange(
  points: readonly EvolutionObservation[],
  period: EvolutionPeriod,
  endpointOverride?: string | null,
): EvolutionRange {
  const ordered = sortAscending(points)
  if (ordered.length === 0) {
    return { period, points: [], startDate: null, endDate: null, boundary: null, truncatedByHistory: false }
  }

  const seriesEnd = ordered[ordered.length - 1].date
  const endpoint =
    typeof endpointOverride === 'string' && ISO_DATE.test(endpointOverride)
      ? endpointOverride
      : seriesEnd

  const boundary = periodBoundary(endpoint, period)
  // First ACTUAL observation on/after the boundary — never the boundary itself,
  // and never a value interpolated onto it.
  const within = ordered.filter((p) => (boundary === null || p.date >= boundary) && p.date <= endpoint)

  return {
    period,
    points: within,
    startDate: within.length > 0 ? within[0].date : null,
    endDate: within.length > 0 ? within[within.length - 1].date : null,
    boundary,
    // The history begins after the boundary — the range is as long as the
    // record allows, which is a different statement from "weeks are missing".
    truncatedByHistory: boundary !== null && ordered[0].date > boundary,
  }
}

export interface ValueChange {
  /** Closing level minus opening level, in the series' own currency. */
  absolute: number | null
  /**
   * The same change as a ratio of the OPENING LEVEL. § 18: this is a VALUE
   * CHANGE, not an investment return — over a period with contributions or
   * withdrawals the two are different numbers, and only the flow-adjusted
   * performance series answers the second question.
   */
  ratio: number | null
  openingDate: string | null
  closingDate: string | null
}

const EMPTY_CHANGE: ValueChange = {
  absolute: null,
  ratio: null,
  openingDate: null,
  closingDate: null,
}

/**
 * Change in portfolio VALUE across a window. Requires two distinct real
 * observations: a single-observation window has nothing to compare against and
 * reports null rather than 0, which would read as "flat" (doc 02 § 9's rule —
 * unavailable is never zero).
 */
export function valueChange(points: readonly EvolutionObservation[]): ValueChange {
  const ordered = sortAscending(points)
  if (ordered.length < 2) {
    return ordered.length === 1
      ? { ...EMPTY_CHANGE, openingDate: ordered[0].date, closingDate: ordered[0].date }
      : EMPTY_CHANGE
  }
  const open = ordered[0]
  const close = ordered[ordered.length - 1]
  const absolute = close.value - open.value
  return {
    absolute: Number.isFinite(absolute) ? absolute : null,
    // A non-positive opening level cannot carry a meaningful percentage; null,
    // never a sign-flipped or infinite ratio.
    ratio: open.value > 0 && Number.isFinite(absolute) ? absolute / open.value : null,
    openingDate: open.date,
    closingDate: close.date,
  }
}

/** The observation exactly at `date`, for crosshair readout. Never the nearest. */
export function observationAt(
  points: readonly EvolutionObservation[],
  date: string,
): EvolutionObservation | null {
  return points.find((p) => p.date === date) ?? null
}

/**
 * The shared endpoint for Compare mode: the LATEST date both series actually
 * reach, so neither line is drawn past its own record. Null when either series
 * is empty.
 */
export function sharedEndpoint(
  a: readonly EvolutionObservation[],
  b: readonly EvolutionObservation[],
): string | null {
  const ea = sortAscending(a).at(-1)?.date ?? null
  const eb = sortAscending(b).at(-1)?.date ?? null
  if (ea === null || eb === null) return null
  return ea < eb ? ea : eb
}
