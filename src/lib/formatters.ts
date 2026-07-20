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

/**
 * Surprise of an actual figure vs. consensus estimate, in percent.
 * Returns null when either input is missing or consensus is zero.
 */
export function surprisePct(
  actual: number | null | undefined,
  consensus: number | null | undefined,
): number | null {
  if (actual == null || consensus == null || consensus === 0) return null
  return (actual / consensus - 1) * 100
}
