// R6.2 — Economically correct short-term (1D / 5D) return math.
//
// PURE. No network, no Supabase, no Next.js — directly unit-testable.
//
// Why this module exists. Compare's 1D and 5D columns read +0.00% for every
// security. Diagnosis against the live provider (2026-07-31) showed the data,
// not the arithmetic, was the problem — in two compounding ways:
//
//  1. Yahoo's daily chart for Santiago (`.SN`) tickers emits CARRIED-FORWARD
//     FILLER BARS: 2026-07-20 … 2026-07-30 all repeated the 2026-07-17 close
//     with `volume: 0` (BSANTANDER 77, CHILE 188.5, FALABELLA 5835,
//     CENCOSUD 1995). Treating those as trading sessions makes "latest vs
//     previous bar" compare a filler against a filler — exactly 0.00%, for
//     every ticker, for both windows.
//  2. The chart request ended at `period2 = today`, which Yahoo treats as
//     EXCLUSIVE, so the genuine current session was never fetched at all.
//
// Meanwhile the QUOTE endpoint was healthy the whole time (marketState
// REGULAR, real day high/low and volume, e.g. CHILE 192.82 against a 196.8
// previous close = −2.02%). So the correct 1D basis is the quote's own
// price/previous-close pair — the same snapshot the Market Data price column
// already shows, which also guarantees the two can never disagree.
//
// Nothing here ever coerces missing data to zero: a genuine unchanged price
// returns 0, and anything unavailable returns null.

/** One daily observation. `volume` null means "not reported", which is NOT the same as 0. */
export interface DailyBar {
  date: string
  close: number | null
  volume?: number | null
}

/** The live quote basis for the latest price and the previous official close. */
export interface QuoteBasis {
  /** Latest price — intraday while the market is open, else the latest close. */
  price: number | null
  /** Previous official session close, as reported by the quote provider. */
  previousClose: number | null
  /** Observation date (YYYY-MM-DD) of `price`. */
  asOf: string | null
}

/** Why a short-term return could not be produced — diagnostics, never rendered as a value. */
export type ShortTermUnavailableReason =
  | 'no-quote'
  | 'no-previous-close'
  | 'insufficient-sessions'
  | 'invalid-base'

export interface ShortTermReturn {
  /** Percent change, or null when genuinely unavailable. Never a stand-in zero. */
  value: number | null
  /** Date of the numerator observation. */
  asOf: string | null
  /** Date of the denominator observation — the window's true start. */
  baseDate: string | null
  reason?: ShortTermUnavailableReason
}

const UNAVAILABLE = (reason: ShortTermUnavailableReason): ShortTermReturn => ({
  value: null, asOf: null, baseDate: null, reason,
})

function isFinitePositive(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0
}

function pctChange(latest: number, base: number): number | null {
  if (!Number.isFinite(latest) || !Number.isFinite(base) || base === 0) return null
  const v = (latest / base - 1) * 100
  return Number.isFinite(v) ? v : null
}

/**
 * Normalizes a raw daily series into genuine trading sessions:
 *   • drops non-finite / missing closes (invalid observations),
 *   • deduplicates by date deterministically (the LAST occurrence wins, so a
 *     revised print supersedes an earlier one for the same session),
 *   • sorts ascending by date, so "latest" is always the final element.
 */
export function normalizeDailyBars(bars: DailyBar[]): DailyBar[] {
  const byDate = new Map<string, DailyBar>()
  for (const b of bars) {
    if (!b || typeof b.date !== 'string' || b.date.length === 0) continue
    if (typeof b.close !== 'number' || !Number.isFinite(b.close)) continue
    byDate.set(b.date, b)
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * Removes carried-forward filler bars — a provider placeholder for a session
 * in which nothing traded, recognisable by BOTH an explicit zero volume AND a
 * close identical to the previous retained session.
 *
 * Deliberately conservative on two axes, so real data is never discarded:
 *   • `volume: null` ("not reported") is NOT treated as zero.
 *   • A zero-volume bar whose close MOVED is kept — that is a real change
 *     (e.g. an adjustment), not a carried-forward repeat.
 * The first bar is always kept: with no predecessor it cannot be shown to be
 * a repeat.
 */
export function stripNonTradingFillers(bars: DailyBar[]): DailyBar[] {
  const out: DailyBar[] = []
  for (const b of bars) {
    const prev = out[out.length - 1]
    const isFiller = prev != null && b.volume === 0 && b.close === prev.close
    if (!isFiller) out.push(b)
  }
  return out
}

/**
 * Builds the coherent session series the return math runs on: normalized,
 * filler-stripped history, with the live quote merged in as the latest
 * observation.
 *
 * The quote supersedes a same-dated bar (an intraday price is fresher than
 * that day's provisional bar) and appends when it is newer than every bar —
 * which is how a genuine current session reaches the calculation even when the
 * chart endpoint has not published it yet.
 */
export function buildSessionSeries(bars: DailyBar[], quote?: QuoteBasis | null): DailyBar[] {
  const sessions = stripNonTradingFillers(normalizeDailyBars(bars))
  if (!quote || !isFinitePositive(quote.price) || !quote.asOf) return sessions
  const last = sessions[sessions.length - 1]
  if (last && last.date === quote.asOf) {
    sessions[sessions.length - 1] = { date: quote.asOf, close: quote.price, volume: last.volume }
  } else if (!last || quote.asOf > last.date) {
    sessions.push({ date: quote.asOf, close: quote.price, volume: null })
  }
  return sessions
}

/**
 * 1D return = latest valid price / previous trading-session close − 1.
 *
 * The quote's own `previousClose` is authoritative when present: it is the
 * provider's official prior-session close, taken from the same snapshot as the
 * price, and it stays correct even when the chart's recent bars are filler
 * (verified live: CHILE quoted a 196.8 previous close that matched NO chart
 * bar). Only when the quote cannot supply the pair does this fall back to the
 * two most recent genuine sessions.
 *
 * Never calendar-day arithmetic, so weekends and holidays cannot manufacture a
 * zero; fewer than two valid observations yields null, never 0.
 */
export function oneDayReturn(quote: QuoteBasis | null | undefined, bars: DailyBar[]): ShortTermReturn {
  if (quote && isFinitePositive(quote.price) && isFinitePositive(quote.previousClose)) {
    const value = pctChange(quote.price, quote.previousClose)
    if (value === null) return UNAVAILABLE('invalid-base')
    const sessions = buildSessionSeries(bars, quote)
    const prior = sessions.length >= 2 ? sessions[sessions.length - 2].date : null
    return { value, asOf: quote.asOf, baseDate: prior }
  }

  const sessions = buildSessionSeries(bars, quote)
  if (sessions.length < 2) return UNAVAILABLE(sessions.length === 0 ? 'no-quote' : 'insufficient-sessions')
  const latest = sessions[sessions.length - 1]
  const previous = sessions[sessions.length - 2]
  const value = pctChange(latest.close as number, previous.close as number)
  if (value === null) return UNAVAILABLE('invalid-base')
  return { value, asOf: latest.date, baseDate: previous.date }
}

/** Number of trading sessions the 5D window looks back. */
export const FIVE_SESSION_LOOKBACK = 5

/**
 * 5D return = latest valid price / close five TRADING SESSIONS earlier − 1.
 *
 * Sessions are counted, never calendar days, so a weekend, holiday, or a run
 * of non-trading filler days cannot shrink the window or fabricate a zero.
 * Fewer than six valid observations yields null rather than silently
 * substituting a shorter window.
 */
export function fiveDayReturn(quote: QuoteBasis | null | undefined, bars: DailyBar[]): ShortTermReturn {
  const sessions = buildSessionSeries(bars, quote)
  if (sessions.length < FIVE_SESSION_LOOKBACK + 1) return UNAVAILABLE('insufficient-sessions')
  const latest = sessions[sessions.length - 1]
  const base = sessions[sessions.length - 1 - FIVE_SESSION_LOOKBACK]
  const value = pctChange(latest.close as number, base.close as number)
  if (value === null) return UNAVAILABLE('invalid-base')
  return { value, asOf: latest.date, baseDate: base.date }
}
