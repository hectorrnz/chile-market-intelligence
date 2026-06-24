// Chilean locale formatting utilities — always use these, never inline toLocaleString()

/** Format a CLP number with Chilean convention (periods as thousands, comma as decimal). */
export function formatCLP(value: number, decimals = 0): string {
  return value.toLocaleString('es-CL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
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
