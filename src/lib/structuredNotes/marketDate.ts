// R13.7 — market/trading-date arithmetic for contractual observations.
//
// PURE MODULE. No I/O, no Supabase, no provider imports — directly testable
// under plain `node --test`.
//
// WHY THIS EXISTS (R13.7 § 10)
// ────────────────────────────
// A contractual valuation date is a date **at the exchange**, not a UTC
// instant. Deriving it with `new Date(ts).toISOString().slice(0,10)` is only
// accidentally correct: it works for a US daily bar stamped 13:30Z (09:30
// America/New_York) and breaks the moment a provider stamps a bar at, say,
// 20:00 America/New_York — which is 01:00Z the FOLLOWING day, silently
// relabelling a Friday close as Saturday and making it unmatchable to the
// contract's valuation date.
//
// Measured live against Yahoo (2026-09-02) for ^GSPC and ^RUT: bars are
// stamped 13:30:00Z with `gmtoffset: -14400` and `exchangeTimezoneName:
// America/New_York`, so UTC and exchange dates agree TODAY. That is a
// property of the current feed, not a guarantee, so every conversion in this
// subsystem goes through `toMarketDate()` rather than relying on it.

/** IANA timezone of the exchange an observation settles against. */
export type ExchangeTimezone = string

/** The default for the current book: every underlying in production is a US index (SPX/RTY). */
export const DEFAULT_EXCHANGE_TIMEZONE: ExchangeTimezone = 'America/New_York'

/**
 * The exchange-local calendar date (YYYY-MM-DD) of an instant.
 *
 * Uses `en-CA` because it formats as ISO `YYYY-MM-DD` natively, avoiding
 * manual part reassembly. Returns null for an unparseable input rather than a
 * fabricated date.
 */
export function toMarketDate(instant: string | number | Date | null | undefined, timeZone: ExchangeTimezone = DEFAULT_EXCHANGE_TIMEZONE): string | null {
  if (instant === null || instant === undefined || instant === '') return null
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return null
  }
}

/** True when a string is a well-formed ISO calendar date. Rejects `2026-13-01` and `2026-02-31`. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** Calendar-date comparison on ISO strings. Lexicographic order is chronological for `YYYY-MM-DD`, so no Date objects (and no timezone) are involved. */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Whole calendar days from `from` to `to` (negative when `to` precedes `from`). Null on malformed input. */
export function daysBetweenIso(from: string, to: string): number | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return null
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(to + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 86_400_000)
}

/** Adds (or subtracts) whole calendar days to an ISO date. Null on malformed input. */
export function addIsoDays(date: string, days: number): string | null {
  if (!isIsoDate(date) || !Number.isFinite(days)) return null
  const t = Date.parse(date + 'T00:00:00Z')
  if (Number.isNaN(t)) return null
  return new Date(t + Math.trunc(days) * 86_400_000).toISOString().slice(0, 10)
}

/** Saturday/Sunday in exchange-local terms. Weekday numbering is taken from the UTC-midnight instant, which is timezone-independent for a bare calendar date. */
export function isWeekend(date: string): boolean {
  if (!isIsoDate(date)) return false
  const day = new Date(date + 'T00:00:00Z').getUTCDay()
  return day === 0 || day === 6
}

/**
 * The trading session immediately BEFORE `date`.
 *
 * R13.7 § 19 requires the T-1 warning to fire on the prior *trading session*,
 * never on calendar D-1 — a Monday valuation date must warn on the preceding
 * Friday. Weekends are skipped structurally; market holidays are skipped only
 * when supplied, because this app has no exchange holiday calendar and
 * INVENTING one would be worse than omitting it. A holiday that is not
 * supplied degrades safely: the warning job simply finds no fresh close for
 * that session and defers rather than firing on stale data (see
 * `resolveValuationClose`).
 *
 * `holidays` is a set of ISO dates that are NOT trading sessions.
 */
export function previousTradingDay(date: string, holidays: ReadonlySet<string> = new Set()): string | null {
  if (!isIsoDate(date)) return null
  let cursor = addIsoDays(date, -1)
  // A generous bound: no real market closes for more than ~10 consecutive days.
  for (let i = 0; i < 14 && cursor !== null; i++) {
    if (!isWeekend(cursor) && !holidays.has(cursor)) return cursor
    cursor = addIsoDays(cursor, -1)
  }
  return null
}

/** True when `date` is a plausible trading session (not a weekend, not a supplied holiday). Never asserts an exchange actually opened — only that it structurally could have. */
export function isTradingDay(date: string, holidays: ReadonlySet<string> = new Set()): boolean {
  return isIsoDate(date) && !isWeekend(date) && !holidays.has(date)
}

/** Regular-session close, exchange-local. 16:00 for the US equity/index venues every underlying in the current book trades on. */
export const US_EQUITY_CLOSE_HOUR = 16

/**
 * Minutes to wait after the closing bell before a printed level may be treated
 * as a settled CLOSE rather than a late intraday tick.
 */
export const SETTLE_BUFFER_MINUTES = 15

/**
 * R13.7 § 25 — has `marketDate`'s regular session ended, with the settle buffer
 * elapsed, as of `now`?
 *
 * WHY THIS CANNOT BE LEFT TO THE CRON SCHEDULE
 * ────────────────────────────────────────────
 * Vercel Cron has no timezone, so a fixed UTC time drifts an hour against
 * America/New_York across DST: a slot chosen to sit 15 minutes after the EDT
 * close lands 45 minutes BEFORE the EST close. A provider queried mid-session
 * still returns a bar for today — carrying the CURRENT level, not a close — so
 * nothing downstream would notice. Guarding on the schedule alone would mean
 * evaluating a contractual condition against an intraday tick for roughly four
 * months of the year.
 *
 * A past date is always settled. A future date never is.
 */
export function hasSessionSettled(
  now: Date,
  marketDate: string,
  timeZone: ExchangeTimezone = DEFAULT_EXCHANGE_TIMEZONE,
  closeHour: number = US_EQUITY_CLOSE_HOUR,
  bufferMinutes: number = SETTLE_BUFFER_MINUTES,
): boolean {
  if (!isIsoDate(marketDate)) return false
  const today = toMarketDate(now, timeZone)
  if (today === null) return false
  if (marketDate < today) return true
  if (marketDate > today) return false

  // Same exchange-local day: compare against the close plus the buffer.
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  } catch {
    return false
  }
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  return hour * 60 + minute >= closeHour * 60 + bufferMinutes
}
