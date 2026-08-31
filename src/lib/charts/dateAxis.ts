// Chart date-axis formatting — PURE, and deliberately outside the component so
// it can be exercised behaviourally under a real timezone rather than only
// grepped for.
//
// THE RULE: a chart's x values are CALENDAR DATES ("2026-08-07", "2026-08"),
// not instants. `new Date("2026-08-07")` parses as UTC midnight, so the local
// getters return the PRIOR day in every negative UTC offset — a 7 August
// publication renders "6 Aug" for a viewer in Chile (UTC-4/-3), which is the
// entire client base of the Family Portfolio module. Every part shown on an
// axis or in a tooltip is therefore read straight off the string, and the span
// that selects the format is measured in whole UTC-anchored days so no DST
// transition can nudge it across a threshold.
//
// This is the same discipline `formatSourceDate` and `formatIsoDateLabel`
// already follow (see `formatters.ts`) — applied to the chart layer, which had
// been parsing its labels through `new Date()`.

// Relative `.ts` import, not the `@/` alias — this module is exercised directly
// under Node's native test runner (the standing convention for pure modules a
// test must load without the Next.js resolver).
import { calendarPartsOf, type CalendarParts } from '../formatters.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Calendar parts for a chart x value. A bare `YYYY-MM-DD`/`YYYY-MM` is read
 * off the string; anything else is a real instant and is converted in the
 * viewer's own timezone, which is the correct treatment for an instant. No
 * current caller passes one — every chart in this app plots calendar dates.
 */
function partsOf(value: string): CalendarParts {
  const parts = calendarPartsOf(value)
  if (parts) return parts
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return { year: 0, month: 1, day: 1 }
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** UTC-anchored epoch milliseconds for a chart x value — comparison only, never displayed. */
export function calendarTime(value: string): number {
  const { year, month, day } = partsOf(value)
  return Date.UTC(year, month - 1, day)
}

/** Whole days between two chart x values. Never fractional: both ends are UTC-anchored midnights. */
export function calendarSpanDays(from: string, to: string): number {
  return (calendarTime(to) - calendarTime(from)) / 86_400_000
}

/**
 * Axis tick label: `D Mon` for a span of at most a month, `Mon 'YY` beyond it.
 * Identical calendar semantics to `formatChartTooltipDate` — the two can never
 * disagree about which day a point is.
 */
export function formatAxisDate(value: string, spanDays: number): string {
  const { year, month, day } = partsOf(value)
  const mon = MONTHS[month - 1] ?? ''
  if (spanDays <= 31) return `${day} ${mon}`
  return `${mon} '${String(year).slice(2)}`
}

/** Tooltip label: `D Mon YYYY` within about a year, `Mon YYYY` beyond it. */
export function formatChartTooltipDate(value: string, spanDays: number): string {
  const { year, month, day } = partsOf(value)
  const mon = MONTHS[month - 1] ?? ''
  if (spanDays <= 400) return `${day} ${mon} ${year}`
  return `${mon} ${year}`
}
