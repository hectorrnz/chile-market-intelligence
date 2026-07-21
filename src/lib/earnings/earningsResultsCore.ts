// Pure quarterly-earnings math — NO network, NO alias imports, NO JSON loads,
// so it runs directly under Node's native test runner (see the project rule in
// CLAUDE.md's News Module section about `@/` value imports in testable modules).
//
// The network/orchestration half lives in resolveEarningsResults.ts.

/** The subset of a Yahoo `fundamentalsTimeSeries` row this module consumes. */
export interface QuarterRow {
  date: string | Date
  totalRevenue?: number | null
  EBITDA?: number | null
  netIncome?: number | null
  dilutedEPS?: number | null
  basicEPS?: number | null
  [key: string]: unknown
}

export interface EarningsResultRow {
  ticker: string
  companyName: string
  /** e.g. "Q1 2026". */
  period: string
  /** Period end date, YYYY-MM-DD. */
  periodEnd: string
  /** Reporting currency of the figures (Yahoo reports some Chilean issuers in USD). */
  currency: string
  /** All amounts in MILLIONS of `currency`. */
  revenue: number | null
  revenueYoY: number | null
  ebitda: number | null
  ebitdaYoY: number | null
  netIncome: number | null
  netIncomeYoY: number | null
  /** Per-share, in `currency` (not millions). */
  eps: number | null
  /** True for the four bank tickers — EBITDA is not a bank metric. */
  isBank: boolean
}

/**
 * Banks report net interest income, not EBITDA. NIM (net interest margin) is
 * deliberately NOT derived: it needs net interest income over average earning
 * assets, which no free source available to this project publishes per quarter.
 * Showing an approximation as a reported figure would violate the no-fabrication
 * rule, so bank EBITDA/NIM stay empty and render as "—".
 */
export const BANK_TICKERS = new Set(['BSANTANDER', 'CHILE', 'BCI', 'ITAUCL'])

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round1 = (v: number) => Math.round(v * 10) / 10

/** Raw currency units → millions, rounded to 1dp. */
export function toMillions(v: number | null): number | null {
  return v == null ? null : round1(v / 1_000_000)
}

/**
 * Percent change vs the same quarter a year earlier. Returns null for a
 * non-positive base — a YoY off a zero or negative figure is not meaningful and
 * would render as a misleading swing.
 */
export function yoyPct(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null || prior <= 0) return null
  const pct = (current / prior - 1) * 100
  return Number.isFinite(pct) ? round1(pct) : null
}

export function isoOf(d: string | Date): string | null {
  const dt = d instanceof Date ? d : new Date(d)
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

/** Calendar quarter label for a period-end date, e.g. "2026-03-31" → "Q1 2026". */
export function quarterLabel(endIso: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(endIso)
  if (!m) return null
  const year = Number(m[1])
  const q = Math.ceil(Number(m[2]) / 3)
  if (q < 1 || q > 4) return null
  return `Q${q} ${year}`
}

/**
 * Rolling window of the `maxQuarters` most recently reported quarters for one
 * ticker. Always derived from the sorted period list, so a newly reported
 * quarter enters and the oldest drops off automatically — never a hand-kept list.
 */
export function buildResultRows(
  ticker: string,
  companyName: string,
  currency: string,
  quarterly: QuarterRow[],
  maxQuarters = 2,
): EarningsResultRow[] {
  const upper = ticker.toUpperCase()
  const isBank = BANK_TICKERS.has(upper)

  // Newest-first. A row with no usable period end is dropped, never guessed at.
  const sorted = quarterly
    .map((r) => ({ row: r, end: isoOf(r.date) }))
    .filter((x): x is { row: QuarterRow; end: string } => x.end != null)
    .sort((a, b) => b.end.localeCompare(a.end))

  const byEnd = new Map(sorted.map((x) => [x.end, x.row]))

  const out: EarningsResultRow[] = []
  for (const { row, end } of sorted) {
    if (out.length >= maxQuarters) break
    const revenue = finite(row.totalRevenue)
    const netIncome = finite(row.netIncome)
    // A period with neither top line nor bottom line isn't a reported quarter.
    if (revenue == null && netIncome == null) continue

    const period = quarterLabel(end)
    if (!period) continue

    // Same quarter one year earlier, matched on the exact period-end date, so a
    // gap in Yahoo's history can never silently shift the comparison basis to an
    // adjacent (sequential) quarter and mislabel it "YoY".
    const [y, m, d] = end.split('-')
    const prior = byEnd.get(`${Number(y) - 1}-${m}-${d}`) ?? null

    out.push({
      ticker: upper,
      companyName,
      period,
      periodEnd: end,
      currency,
      revenue: toMillions(revenue),
      revenueYoY: yoyPct(revenue, prior ? finite(prior.totalRevenue) : null),
      // Never shown for a bank, even if Yahoo happens to return a number.
      ebitda: isBank ? null : toMillions(finite(row.EBITDA)),
      ebitdaYoY: isBank ? null : yoyPct(finite(row.EBITDA), prior ? finite(prior.EBITDA) : null),
      netIncome: toMillions(netIncome),
      netIncomeYoY: yoyPct(netIncome, prior ? finite(prior.netIncome) : null),
      eps: finite(row.dilutedEPS) ?? finite(row.basicEPS),
      isBank,
    })
  }
  return out
}
