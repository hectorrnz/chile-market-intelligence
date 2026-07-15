// Macro popup-chart frequency policy (shared by the static, persisted, and live
// history paths so all three agree on the sampling density for a given
// indicator + timeframe). Pure — no I/O, no env, no framework imports — so it is
// safe to import from the client page, the Supabase repository, and the
// server-side provider orchestrator alike.
//
// Policy (requested by the user):
//   • Market-priced series — non-central-bank rates, FX, commodities, crypto:
//       1Y → daily · 3Y → weekly · 5Y → weekly · 10Y → monthly
//   • Central-bank policy rates (TPM, Fed Funds), inflation, labor, and activity:
//       monthly at EVERY timeframe (these are published monthly-or-lower and, in
//       the CB-rate case, are step functions where a daily/weekly view is noise).

export type MacroFreq = 'daily' | 'weekly' | 'monthly'
export type MacroTimeframe = 1 | 3 | 5 | 10

/**
 * History ids read as monthly at every timeframe. Keyed by the *history id* the
 * popup passes (which for Chile-rate rows is the RATE_HIST-mapped id, e.g.
 * `tpm`/`btu10-ref`, not the table row id). Any id NOT listed here is treated as
 * a market-priced series and gets the higher-frequency market plan — this
 * correctly covers the Chile secondary-rate history ids (btp10, btu5,
 * swap1y, swap2y, pdbc90) which are non-central-bank rates.
 */
const MONTHLY_ALL_IDS: ReadonlySet<string> = new Set([
  // Central-bank policy rates (step functions).
  'tpm', 'tpm-tna', 'fed-funds',
  // Inflation.
  'ipc-mensual', 'ipc-anual', 'uf-diaria', 'us-cpi-mensual', 'us-cpi-anual',
  // Labor market.
  'desempleo', 'us-unemployment',
  // Economic activity (published monthly/quarterly — a daily/weekly view is not meaningful).
  'imacec-anual', 'credito', 'pib', 'us-gdp',
])

const MARKET_PLAN: Record<MacroTimeframe, MacroFreq> = { 1: 'daily', 3: 'weekly', 5: 'weekly', 10: 'monthly' }
const MONTHLY_PLAN: Record<MacroTimeframe, MacroFreq> = { 1: 'monthly', 3: 'monthly', 5: 'monthly', 10: 'monthly' }

/** The chart sampling frequency for a history id at a given timeframe. */
export function macroChartFrequency(histId: string, years: MacroTimeframe): MacroFreq {
  return MONTHLY_ALL_IDS.has(histId) ? MONTHLY_PLAN[years] : MARKET_PLAN[years]
}

/** Last observation per calendar month — preserves ascending sort. Never fabricates. */
export function downsampleMonthly<T extends { date: string; value: number }>(points: T[]): T[] {
  const map = new Map<string, T>()
  for (const p of points) map.set(p.date.slice(0, 7), p) // ascending → last wins
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Last observation per ISO week (Mon–Sun) — preserves ascending sort. Never fabricates. */
export function downsampleWeekly<T extends { date: string; value: number }>(points: T[]): T[] {
  const map = new Map<string, T>()
  for (const p of points) {
    const d = new Date(p.date + 'T00:00:00Z')
    const day = d.getUTCDay() // 0=Sun
    const mon = new Date(d)
    mon.setUTCDate(d.getUTCDate() - ((day + 6) % 7))
    map.set(mon.toISOString().slice(0, 10), p)
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Downsample a (daily-or-finer) point series to the chart-appropriate density
 * for this indicator + timeframe. Only ever drops points — every returned point
 * is a real input observation, so a value is never fabricated.
 */
export function applyMacroFrequency<T extends { date: string; value: number }>(
  points: T[],
  histId: string,
  years: MacroTimeframe,
): T[] {
  const freq = macroChartFrequency(histId, years)
  if (freq === 'daily') return points
  if (freq === 'weekly') return downsampleWeekly(points)
  return downsampleMonthly(points)
}
