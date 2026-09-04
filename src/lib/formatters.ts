// Chilean locale formatting utilities — always use these, never inline toLocaleString()

/** Format a CLP number with Chilean convention (periods as thousands, comma as decimal). */
export function formatCLP(value: number, decimals = 0): string {
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Compact, magnitude-adaptive rendering of a CLP amount stored in MILLIONS —
 * the scale every Charting fundamentals metric uses.
 *
 * A large issuer's revenue in millions is a 7-digit number (1.463.576 MM),
 * which is unreadable as a chart axis label and was being clipped by the axis
 * gutter. This converts back to the true amount and picks the largest unit
 * that keeps the number short, so an axis reads "1,46 B" / "153,3 MM" instead
 * of a wall of digits. Suffixes are the Chilean/Spanish short forms used for
 * currency magnitudes in this app: M (millón), MM (millardo/mil millones),
 * B (billón = 10^12) — NOT the English "B = billion", which would be a
 * factor-1000 misread for a Chilean audience.
 *
 * Returns e.g. "1,46 B" · "153,3 MM" · "45,2 M" · "820" (thousands of CLP and
 * below are shown in full, since they are already short).
 */
export function formatCompactMM(valueInMillions: number): string {
  if (!Number.isFinite(valueInMillions)) return '—'
  const raw = valueInMillions * 1_000_000
  const abs = Math.abs(raw)
  const sign = raw < 0 ? '-' : ''
  const scaled = (divisor: number, suffix: string) => {
    const n = abs / divisor
    // Two decimals below 10 keeps small magnitudes informative (1,46 B);
    // one decimal above keeps long ones short (153,3 MM).
    return `${sign}${formatCLP(n, n < 10 ? 2 : 1)} ${suffix}`
  }
  if (abs >= 1e12) return scaled(1e12, 'B')
  if (abs >= 1e9) return scaled(1e9, 'MM')
  if (abs >= 1e6) return scaled(1e6, 'M')
  return `${sign}${formatCLP(abs, 0)}`
}

/** Format a percentage with sign prefix: +3,2% or -1,5%. */
export function formatPercent(value: number, decimals = 1): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`
}

/** Short alias for formatPercent. */
export function formatPct(value: number, decimals = 1): string {
  return formatPercent(value, decimals)
}

/** Abbreviate large CLP numbers: M = millones, MM = miles de millones. */
export function formatMillionsCLP(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${formatCLP(value / 1_000_000, 1)} MM`
  return `${formatCLP(value / 1_000, 1)} M`
}

/** Compact large CLP — used in tables and KPI strips. */
export function formatLargeCLP(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MM`
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} M`
  return formatCLP(value)
}

/**
 * Generic chart-value formatter (Chilean locale, up to 2 decimals) — the
 * shared fallback the SVG chart components use when a caller does not supply
 * its own `valueFormatter`. Centralizes what used to be an inline
 * `toLocaleString` call inside `LineChart`; identical output.
 */
export function formatChartValue(value: number, unit = ''): string {
  return `${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}${unit}`
}

/** Format an FX/level value with a fixed number of decimals (Chilean locale). */
export function formatFx(value: number, decimals = 2): string {
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Standardized market-cap display: the stored value is already in millions of
 * CLP, so it is shown as the full millions figure with a single "MM CLP" suffix.
 * Avoids the "12.0 MM MM CLP" double-suffix bug.
 */
export function formatMarketCapMM(valueInMillions: number): string {
  return `${formatCLP(valueInMillions)} MM CLP`
}

function santiagoDateParts(d: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return { year: get('year'), month: get('month'), day: get('day') }
}

/**
 * Formats a YYYY-MM-DD (or ISO datetime) string for the standardized
 * "Source: X as of ..." table footnote convention — "HH:MM" (Chile local
 * time) for a timestamp from earlier today, "DD-MM" (Chile local date)
 * otherwise. Mirrors `formatNewsTimestamp`'s today/prior-day split.
 *
 * A bare date-only value (no time-of-day component, e.g. "2026-07-20") is
 * never run through `new Date()` — that parses as UTC midnight and can
 * render as the prior day once converted to a negative-UTC-offset timezone
 * like Chile's, and there is no real time-of-day to show for it anyway — it
 * always renders as DD-MM, read directly off the string. A full ISO
 * datetime (real instant, e.g. from `new Date().toISOString()`) is
 * genuinely convertible and is shown in Chile local time.
 */
export function formatSourceDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2})/.exec(isoDate)
  if (!m) {
    // No time-of-day component — date-only string, never a fabricated time.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
    if (!dateOnly) return isoDate
    const [, , mo, d] = dateOnly
    if (Number(mo) < 1 || Number(mo) > 12) return isoDate
    return `${d}-${mo}`
  }

  const dt = new Date(isoDate)
  if (isNaN(dt.getTime())) return isoDate

  const { year, month, day } = santiagoDateParts(dt)
  const today = santiagoDateParts(new Date())
  const isToday = year === today.year && month === today.month && day === today.day

  if (isToday) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(dt)
  }
  return `${day}-${month}`
}

/**
 * R13.7B2.2 § 11 — the UNAMBIGUOUS full calendar date of an as-of value.
 *
 * `formatSourceDate` above is the platform-wide dense convention: `HH:MM` for a
 * timestamp from earlier today, `DD-MM` otherwise. That is right for a terminal
 * table refreshed many times a day, and it is a documented convention that this
 * function deliberately does NOT change.
 *
 * It is wrong for one specific case: a Structured Note's contractual levels,
 * where "28-08" gave the owner review no year and no month/day ordering — and
 * where the date is a fixed valuation date months in the past, not a refresh
 * time. Those surfaces opt in to this formatter instead.
 *
 * Renders the calendar date in the Chile timezone for a real timestamp (so an
 * evening UTC close does not print as the following day), and reads a date-only
 * string straight through without ever fabricating a time. ISO ordering is
 * deliberate: locale-independent and unambiguous in both EN and ES.
 */
export function formatSourceDateFull(isoDate: string): string {
  // A date-only string carries no time-of-day, so it is already the calendar
  // date — passing it through `new Date()` would introduce a timezone shift.
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate
  if (!/^\d{4}-\d{2}-\d{2}T/.test(isoDate)) return isoDate
  const dt = new Date(isoDate)
  if (isNaN(dt.getTime())) return isoDate
  const { year, month, day } = santiagoDateParts(dt)
  return year && month && day ? `${year}-${month}-${day}` : isoDate
}

// ─── R13.R5C.2 · THE PORTFOLIO ZERO-DISPLAY CONTRACT ─────────────────────────
//
// Two marks, one rule, applied to every user-visible figure in the Portfolio
// product:
//
//   ·  `-`  the value IS a number and that number is zero — "nothing here"
//   ·  `—`  no value could be established — unavailable, unreadable, unsupported
//
// This is PRESENTATION ONLY. Nothing below converts a zero to null, and no
// caller's arithmetic sees a mark: `formatUsd(0)` renders `-` while the 0 it was
// given goes on summing, reconciling and driving chart geometry exactly as
// before. A total of zero constituents still equals zero.
//
// WHY IT LIVES HERE. Every one of `formatUsd`, `formatRatioPct`,
// `formatWeightPct` and `formatCount` is called ONLY from the Portfolio module
// and the Overview's Portfolio card — verified across the whole of `src/`, and
// asserted by `tests/portfolioR5c2ZeroDisplay.test.ts`. The rest of the app
// formats money and percentages through `formatCLP` / `formatPct` /
// `formatPercent`, which are untouched, so no market-data convention outside
// Portfolio moves. Putting the rule in these four functions is therefore the
// whole contract, rather than a condition repeated at ~60 call sites.
//
// THE ONE EXCEPTION: A CHART SCALE IS NOT A VALUE. `formatUsdCompactM` and
// `formatUsdCompactUnit` are the axis forms and deliberately keep a numeric
// zero — a contributors chart whose baseline gridline is labelled `-` between
// `-2M` and `2M` is unreadable, and the mark would additionally be mistaken for
// the minus sign beside it. They call `usdDigits` directly for the same reason.
//
// The zero test is on the RENDERED precision (`roundsToZeroAt`), never the raw
// number: at two decimals `0` and `0,000004` are the same `0,00` on screen, and
// dashing one while printing the other would claim a distinction the reader
// cannot see.
//
// R13.R5C.3 — PRIVACY OUTRANKS BOTH MARKS, and that is deliberately NOT decided
// here. These are pure string functions with no notion of who is looking; the
// privacy gate belongs to the renderer, and `MaskedAmount` applies it FIRST, so
// a masked amount reads `•••••` whether the figure behind it is zero, negative
// or nine figures. `formatUsd(0)` returning `-` is therefore only ever what an
// UNMASKED reader sees. Never move a mark ahead of the mask at a call site:
// "there is nothing here" is itself a fact about the family's holdings.

/** The value IS zero. */
export const ZERO_MARK = '-'
/** No value could be established. Never used for a zero. */
export const UNAVAILABLE_MARK = '—'

/** The grouped digits, with no zero rule — the axis forms and `formatUsd` share it. */
function usdDigits(value: number, decimals: number): string {
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * R13.6 — Family Portfolio USD amount: Chilean-convention grouping (periods as
 * thousands, comma as decimal), whole dollars by default, `—` for a value that
 * is genuinely unavailable. The currency itself is labelled by the surrounding
 * table ("Values in USD"), never appended per cell.
 *
 * R13.R5C.2 — a value that renders as zero renders `-` instead. See the
 * contract note above.
 */
export function formatUsd(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (roundsToZeroAt(value, decimals)) return ZERO_MARK
  return usdDigits(value, decimals)
}

/**
 * R13.R2F4 § 2 — a Family Portfolio USD amount at CHART-AXIS length: one
 * decimal and a millions suffix, `145.470.441` → `145,5M`.
 *
 * Why this exists rather than `formatUsd`: a printed y-axis label is read for
 * MAGNITUDE, not for the cent. Eleven grouped digits force a wide reserved
 * gutter (20mm of a 186mm measure before this change), crowd the plot, and
 * still give the reader nothing the shorter form does not. Every value on one
 * axis renders through this single function, so the three labels stay directly
 * comparable.
 *
 * Chilean convention throughout, exactly as every other figure in this app:
 * the comma IS the decimal separator (`145,5M`, not `145.5M`) — the units are
 * abbreviated, the locale is not.
 *
 * Below a million the abbreviation would destroy resolution (three ticks all
 * reading `0,3M`), so a small figure falls back to the plain grouped amount.
 * Unavailable stays `—`, never `0M`.
 */
export function formatUsdCompactM(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  // R13.R5C.2 — `usdDigits`, NOT `formatUsd`: this is the AXIS form, and a
  // scale annotation is not a value. A `-` where the baseline label belongs
  // would be read as a minus sign, not as zero.
  if (Math.abs(value) < 1_000_000) return usdDigits(value, 0)
  return `${usdDigits(value / 1_000_000, 1)}M`
}

/**
 * R13.R3C.2 — a Family Portfolio USD amount at CONTRIBUTION-CHART length: a
 * whole number and a magnitude suffix, `5.200.000` → `5M`, `-98.400` → `-98K`.
 *
 * Distinct from `formatUsdCompactM`, and both are kept. That one is the PRINT
 * axis's form: one decimal, always millions, so three stacked labels on a
 * portfolio-level axis stay directly comparable. This one is the SCREEN
 * contributors chart's: a component's change spans four orders of magnitude
 * across periods and subjects, so a fixed millions unit would print `0,1M` for
 * a real mover, and a decimal on a `2M` gridline is noise. Unit follows the
 * value; no decimals at either unit.
 *
 * Chilean convention as everywhere else — the grouping separator is the dot
 * (`1.234M`) and the units are abbreviated, not the locale.
 *
 * The unit is chosen from the value AFTER rounding, so `999.600` reads `1M`
 * rather than the `1.000K` a threshold-first test would produce. Unavailable
 * stays `—`, never `0`.
 */
export function formatUsdCompactUnit(value: number | null | undefined, unit?: CompactUnit): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  // Zero is zero at every magnitude. `0M` on the one gridline every bar is
  // anchored to would be noise at best and a scale claim at worst.
  if (value === 0) return '0'
  const abs = Math.abs(value)
  // Round half AWAY FROM ZERO, so -1,5M and +1,5M print the same magnitude —
  // `Math.round` breaks ties toward +∞ and would print -1M beside +2M.
  const round = (v: number) => Math.sign(v) * Math.round(Math.abs(v))
  const chosen: CompactUnit = unit ?? (abs >= 999_500 ? 'M' : abs >= 999.5 ? 'K' : 'ones')
  // R13.R5C.2 — `usdDigits` for the same reason as `formatUsdCompactM`, plus a
  // second one specific to this form: a real 400.000 forced to the `M` unit
  // rounds to 0, and `formatUsd` would turn that into `-M`.
  if (chosen === 'M') return `${usdDigits(round(value / 1_000_000), 0)}M`
  if (chosen === 'K') return `${usdDigits(round(value / 1_000), 0)}K`
  return usdDigits(round(value), 0)
}

export type CompactUnit = 'M' | 'K' | 'ones'

/**
 * R13.R3C.2 — the ONE unit a whole axis should be read in, chosen from its
 * gridline interval.
 *
 * A per-value unit is right for a lone figure and wrong for a column of them.
 * Measured on the real book: an axis stepping by 500.000 produced the ticks
 * `-500K · 0 · 500K · 1M · 2M` — the last two are 1.000.000 and 1.500.000, so
 * a reader sees the interval double at the top of the scale when it has not
 * changed at all. Rounding to whole units is the owner's rule; a uniform unit
 * is what makes that rule safe on an axis.
 *
 * The unit comes from the STEP, not from the largest value, because every tick
 * is a multiple of the step — so no tick can round to zero in the chosen unit.
 */
export function compactUnitForStep(step: number): CompactUnit {
  if (!Number.isFinite(step) || step <= 0) return 'ones'
  if (step >= 1_000_000) return 'M'
  if (step >= 1_000) return 'K'
  return 'ones'
}

/**
 * R13.7 — an UNSIGNED percentage from a ratio (0.423 → "42,3%"), for
 * allocation weights where a "+" sign would misread as a change figure.
 * Unavailable stays an em dash, never 0%.
 */
export function formatWeightPct(weight: number | null | undefined, decimals = 1): string {
  if (weight === null || weight === undefined || !Number.isFinite(weight)) return '—'
  // R13.R5C.2 — the Portfolio zero contract. A slice with no weight, or an
  // IRR of exactly zero, reads `-`; the ratio itself is untouched and still
  // drives the arc, the bar width and every sum.
  if (roundsToZeroAt(weight * 100, decimals)) return ZERO_MARK
  return `${(weight * 100).toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`
}

/**
 * R13.7 — a SIGNED percentage from a RATIO (0.0123 → "+1,23%"), for
 * source-provided returns and benchmark variations stored as ratios.
 * Unavailable stays an em dash, never 0%.
 */
export function formatRatioPct(ratio: number | null | undefined, decimals = 2): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—'
  // R13.R5C.2 — the Portfolio zero contract, now applied to EVERY percentage in
  // the module rather than the change columns alone. This supersedes the
  // R13.R3C.4 carve-out that kept a headline `0,00%`: the owner's rule is that
  // a zero is a zero wherever it is shown. The ratio still drives colour,
  // ordering and arithmetic unchanged.
  if (roundsToZeroAt(ratio * 100, decimals)) return ZERO_MARK
  return formatPercent(ratio * 100, decimals)
}

/**
 * Does this figure PRINT as zero at the precision it will be rendered with?
 *
 * The test is on the rendered form, not on the raw number, because that is the
 * only thing a reader can see: at two decimals `0` and `0,000004` are the same
 * `0,00%`, and a rule that dashed one while printing the other would draw a
 * distinction the column cannot show.
 */
export function roundsToZeroAt(value: number, decimals: number): boolean {
  const factor = Math.pow(10, Math.max(0, Math.min(12, Math.trunc(decimals))))
  // `Math.round(-0.4)` is `-0`, and `-0 === 0`, so a small negative is caught.
  return Math.round(value * factor) === 0
}

/**
 * R13.R3C.4 — a WEEKLY CHANGE percentage, with a no-movement dash.
 *
 * A weekly-changes table lists every hierarchy row in published order, and most
 * of them do not move in a given week. Rendered as `0,00%` those rows are a
 * column of identical noise that buries the handful that did move; rendered as
 * `-` they read as "nothing here", which is exactly what they are.
 *
 * The dash is driven by `roundsToZeroAt`, so it covers both a true zero and a
 * figure too small to show at this precision — the two are indistinguishable on
 * screen, and printing one as a number and the other as a dash would claim a
 * difference the reader cannot verify. The underlying amount is untouched and
 * still rendered in the row's own value column.
 *
 * Unavailable keeps the em dash `formatRatioPct` already returns, so "did not
 * move" and "could not be compared" stay two visibly different marks.
 *
 * R13.R5C.2 — CONVERGED WITH `formatRatioPct`, which now carries the same rule
 * for every percentage in the Portfolio product. This is deliberately kept as a
 * delegating alias rather than deleted: its call sites and its tests read as
 * "the change column's percentage", which is still what they are, and one
 * implementation is what stops the two drifting into different ideas of zero.
 * The carve-out this function's original note described — a headline rate
 * keeping `0,00%` — is gone at the owner's direction.
 */
export function formatChangePct(ratio: number | null | undefined, decimals = 2): string {
  return formatRatioPct(ratio, decimals)
}

/**
 * R13.R5C.2 — a Portfolio CARDINALITY standing in a value position: the number
 * of holdings behind a subtotal, the number of rows a coverage figure was
 * calculated from.
 *
 * It takes the same two marks as every other figure in the module, so a count
 * of nothing reads `-` beside amounts that read `-` for the same reason.
 *
 * NOT for a cardinality inside a sentence ("calculated from 34 of 36 rows",
 * "· 3 events"). There the number is a word in a clause, `-` would not be read
 * as zero, and the sentence would break; those sites are audited and either
 * guarded so zero cannot appear or read correctly as `0`.
 */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (Math.round(value) === 0) return ZERO_MARK
  return usdDigits(Math.round(value), 0)
}

export interface CalendarParts {
  year: number
  month: number
  day: number
}

/**
 * The calendar parts of a bare `YYYY-MM-DD` (or `YYYY-MM`, which resolves to
 * the first of the month) string, read DIRECTLY off the string.
 *
 * Same rule as `formatSourceDate`/`formatIsoDateLabel`, extracted so a caller
 * that needs the individual parts (a chart axis, a tooltip) can obey it too:
 * `new Date("2026-08-07")` is an *instant* at UTC midnight, so the local
 * getters (`getDate()`, `getMonth()`) return the PRIOR day in every negative
 * UTC offset — 6 August in Chile. A publication date is a calendar date, not
 * an instant; no viewer's timezone may shift it.
 *
 * Returns null for anything that is not a bare calendar date, so the caller
 * decides what to do with a real instant rather than being handed a guess.
 */
export function calendarPartsOf(value: string): CalendarParts | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = m[3] === undefined ? 1 : Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/**
 * R13.6 — a DATE-ONLY ISO string ("2026-08-13") as `DD-MM-YYYY`, read directly
 * off the string. Same rule as `formatSourceDate`: a date-only value is never
 * run through `new Date()`, which parses it as UTC midnight and can render the
 * prior day in Chile's negative-UTC-offset timezone. Used for published-week
 * labels, where the year matters across a multi-year selector.
 */
export function formatIsoDateLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) return isoDate
  const [, y, mo, d] = m
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return isoDate
  return `${d}-${mo}-${y}`
}

/** Format ISO date string as DD MMM YYYY (es-CL short month). */
export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Format ISO datetime string as DD MMM HH:MM (es-CL). */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Bloomberg/NH-terminal style timestamp for the News module: today's items
 * show only the time (HH:MM); older items show DD/MM. Compares against the
 * reader's local calendar day, not a 24h rolling window, so "today" matches
 * what a reader expects regardless of what time of day they load the page.
 */
export function formatNewsTimestamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (isToday) {
    return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

/** Returns a semantic Tailwind text color class based on numeric direction. */
export function changeColor(value: number): string {
  if (value > 0) return 'text-positive'
  if (value < 0) return 'text-negative'
  return 'text-muted-fg'
}

/**
 * Format a macro indicator value with its unit.
 * Produces clean display like "5,00%", "CLP 934,5", "USD 4,42/lb".
 */
export function formatMacroValue(value: number, unit: string): string {
  const loc = (n: number, min = 0, max = 2) =>
    n.toLocaleString('es-CL', { minimumFractionDigits: min, maximumFractionDigits: max })

  switch (unit) {
    case '%':
      return `${loc(value, 2, 2)}%`
    case 'CLP':
      return `CLP ${loc(value, 1, 1)}`
    case 'USD/lb':
      return `USD ${loc(value, 2, 2)}/lb`
    case 'USD/t':
      return `USD ${loc(value, 0, 0)}/t`
    case 'USD/bbl':
      return `USD ${loc(value, 1, 1)}/bbl`
    default:
      return `${loc(value)} ${unit}`
  }
}

/**
 * Return a pre-formatted macro changeLabel for display.
 * The changeLabel in macroIndicators.json is already sign-normalized ("+0.25%", "-3.2", etc.).
 * Parentheses (if wanted) are added by the caller — never here, to avoid double "(( ))".
 */
export function formatMacroChange(changeLabel: string | null | undefined): string {
  if (!changeLabel) return '—'
  return changeLabel
}

/** Format a Net Debt figure in MM CLP, or "—" when not applicable (e.g. banks). */
export function formatNetDebt(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value < 0) return `(${formatMillionsCLP(Math.abs(value))})` // net cash shown in parens
  return formatMillionsCLP(value)
}

/** Format earnings per share in CLP (2 decimals). */
export function formatEPS(value: number | null | undefined): string {
  if (value == null) return '—'
  return formatCLP(value, 2)
}

