// FX Integrity Task — Macro / US forex table provider (Frankfurter, free
// third-party reference — no API key). SERVER-ONLY.
//
// Replaces the prior CurrencyFreaks-backed table (currencyFreaksFxProvider.ts,
// kept in the repo but no longer imported by any production route — see that
// file's header). Chile FX stays entirely separate and BCCh-official — this
// module never touches it.

import {
  fetchFrankfurterTimeSeries,
  isFrankfurterConfigured,
  type FrankfurterRatePoint,
} from './frankfurterClient.ts'

export const FRANKFURTER_SOURCE = 'Frankfurter FX reference'
export const FRANKFURTER_SOURCE_TYPE = 'free_third_party_fx_reference' as const
export const FRANKFURTER_ATTRIBUTION =
  'Frankfurter — aggregated from central bank data sources (no single official rate)'

/** ISO codes requested from Frankfurter — validated against the Macro / US table's needs. */
export const FRANKFURTER_SYMBOLS = [
  'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'MXN', 'BRL', 'CNY', 'KRW', 'TWD',
] as const

export type UsForexDirection = 'direct' | 'inverted'

export interface UsForexRow {
  id: string
  pair: string
  decimals: number
  /** 'direct' = USD/XXX using the raw USD-base rate; 'inverted' = 1/rate (XXX/USD). */
  direction: UsForexDirection
  value: number
  /** Null (never 0) when the previous-day observation is unavailable — never fabricated. */
  oneDayChangePct: number | null
  /** Null (never 0) when the prior-year-end observation is unavailable — never fabricated. */
  ytdChangePct: number | null
  derived: boolean
  calculationMethod: 'direct_usd_base' | 'inverted_usd_base'
}

export interface UsForexTableResult {
  ok: boolean
  configured: boolean
  source: string
  sourceType: typeof FRANKFURTER_SOURCE_TYPE
  base: 'USD'
  providerAttribution: string
  /** The most recent date with an observation, across the recent lookback window. */
  currentDate: string | null
  /** The prior available date before currentDate — null if no second observation was found. */
  previousDate: string | null
  /** The last available date on/before the prior calendar year-end — null if none found. */
  ytdBaseDate: string | null
  rows: UsForexRow[]
  reason?: string
}

const DIRECT_PAIRS: { code: string; pair: string; decimals: number }[] = [
  { code: 'JPY', pair: 'USDJPY', decimals: 2 },
  { code: 'CHF', pair: 'USDCHF', decimals: 3 },
  { code: 'CAD', pair: 'USDCAD', decimals: 3 },
  { code: 'MXN', pair: 'USDMXN', decimals: 2 },
  { code: 'BRL', pair: 'USDBRL', decimals: 2 },
  { code: 'CNY', pair: 'USDCNY', decimals: 2 },
  { code: 'KRW', pair: 'USDKRW', decimals: 0 },
  { code: 'TWD', pair: 'USDTWD', decimals: 2 },
]

const INVERTED_PAIRS: { code: string; pair: string; decimals: number }[] = [
  { code: 'EUR', pair: 'EURUSD', decimals: 4 },
  { code: 'GBP', pair: 'GBPUSD', decimals: 4 },
  { code: 'AUD', pair: 'AUDUSD', decimals: 4 },
  { code: 'NZD', pair: 'NZDUSD', decimals: 4 },
]

// ── Pure helpers (exported for tests) ────────────────────────────────────────

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Groups flat rate points into a `date -> { code -> rate }` map. */
export function groupRatesByDate(points: FrankfurterRatePoint[]): Map<string, Record<string, number>> {
  const map = new Map<string, Record<string, number>>()
  for (const p of points) {
    const bucket = map.get(p.date) ?? {}
    bucket[p.quote] = p.rate
    map.set(p.date, bucket)
  }
  return map
}

/** The two most recent distinct dates present in a rates-by-date map, descending. */
export function latestTwoDates(byDate: Map<string, Record<string, number>>): { current: string | null; previous: string | null } {
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a))
  return { current: dates[0] ?? null, previous: dates[1] ?? null }
}

/** The most recent date on/before `cutoff` (inclusive) present in a rates-by-date map. */
export function latestDateOnOrBefore(byDate: Map<string, Record<string, number>>, cutoff: string): string | null {
  const dates = [...byDate.keys()].filter((d) => d <= cutoff).sort((a, b) => b.localeCompare(a))
  return dates[0] ?? null
}

/** % change of `current` vs `base`, or null if either snapshot is missing (never fabricated). */
export function pctChange(current: number | undefined, base: number | undefined): number | null {
  if (current == null || base == null || !Number.isFinite(current) || !Number.isFinite(base) || base === 0) return null
  return (current / base - 1) * 100
}

/**
 * Builds the direct + inverted USD-base rows for one snapshot set, given the
 * current/previous/ytd-base rates-by-currency-code maps (each may be
 * undefined/partial — a pair with no current rate is simply omitted).
 */
export function buildUsForexRows(
  currentRates: Record<string, number>,
  previousRates: Record<string, number> | undefined,
  ytdBaseRates: Record<string, number> | undefined,
): UsForexRow[] {
  const rows: UsForexRow[] = []

  for (const { code, pair, decimals } of DIRECT_PAIRS) {
    const cur = currentRates[code]
    if (cur == null || !Number.isFinite(cur) || cur <= 0) continue
    rows.push({
      id: pair.toLowerCase(),
      pair,
      decimals,
      direction: 'direct',
      value: cur,
      oneDayChangePct: pctChange(cur, previousRates?.[code]),
      ytdChangePct: pctChange(cur, ytdBaseRates?.[code]),
      derived: false,
      calculationMethod: 'direct_usd_base',
    })
  }

  for (const { code, pair, decimals } of INVERTED_PAIRS) {
    const cur = currentRates[code]
    if (cur == null || !Number.isFinite(cur) || cur <= 0) continue
    const prev = previousRates?.[code]
    const ytdBase = ytdBaseRates?.[code]
    // Invert each snapshot first, THEN compute the % change — never derive the
    // inverted change from the raw USD-base quote's own change.
    const curInv = 1 / cur
    const prevInv = prev != null && prev > 0 ? 1 / prev : undefined
    const ytdInv = ytdBase != null && ytdBase > 0 ? 1 / ytdBase : undefined
    rows.push({
      id: pair.toLowerCase(),
      pair,
      decimals,
      direction: 'inverted',
      value: curInv,
      oneDayChangePct: pctChange(curInv, prevInv),
      ytdChangePct: pctChange(curInv, ytdInv),
      derived: true,
      calculationMethod: 'inverted_usd_base',
    })
  }

  return rows
}

// ── Conservative in-memory cache (module scope, per server instance) ────────

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
let cached: { at: number; result: UsForexTableResult } | null = null

/**
 * Resolves the Macro / US forex table from Frankfurter, cached server-side for
 * CACHE_TTL_MS. Two bounded Frankfurter calls per refresh: a short recent
 * window (to find the latest and previous available dates — tolerant of any
 * provider gap, weekend or holiday) and a short window around the prior
 * calendar year-end (to find the YTD base date). Never fabricates a missing
 * snapshot — a pair whose previous/YTD-base observation isn't found in its
 * bounded window simply reports that change as `null`.
 */
export async function resolveUsForexTable(): Promise<UsForexTableResult> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result

  if (!isFrankfurterConfigured()) {
    // Frankfurter needs no key — this path only exists for interface parity
    // with other providers and should never actually trigger.
    return {
      ok: false,
      configured: false,
      source: FRANKFURTER_SOURCE,
      sourceType: FRANKFURTER_SOURCE_TYPE,
      base: 'USD',
      providerAttribution: FRANKFURTER_ATTRIBUTION,
      currentDate: null,
      previousDate: null,
      ytdBaseDate: null,
      rows: [],
      reason: 'Frankfurter not available',
    }
  }

  const now = new Date()
  const recentFrom = new Date(now)
  recentFrom.setUTCDate(recentFrom.getUTCDate() - 10)
  const priorYear = now.getUTCFullYear() - 1
  const ytdWindowFrom = `${priorYear}-12-20`
  const ytdWindowTo = `${priorYear}-12-31`

  const [recentRes, ytdRes] = await Promise.all([
    fetchFrankfurterTimeSeries('USD', [...FRANKFURTER_SYMBOLS], isoDate(recentFrom), isoDate(now)),
    fetchFrankfurterTimeSeries('USD', [...FRANKFURTER_SYMBOLS], ytdWindowFrom, ytdWindowTo),
  ])

  if (!recentRes.ok) {
    return {
      ok: false,
      configured: true,
      source: FRANKFURTER_SOURCE,
      sourceType: FRANKFURTER_SOURCE_TYPE,
      base: 'USD',
      providerAttribution: FRANKFURTER_ATTRIBUTION,
      currentDate: null,
      previousDate: null,
      ytdBaseDate: null,
      rows: [],
      reason: recentRes.reason,
    }
  }

  const byDate = groupRatesByDate(recentRes.data)
  const { current, previous } = latestTwoDates(byDate)
  if (!current) {
    return {
      ok: false,
      configured: true,
      source: FRANKFURTER_SOURCE,
      sourceType: FRANKFURTER_SOURCE_TYPE,
      base: 'USD',
      providerAttribution: FRANKFURTER_ATTRIBUTION,
      currentDate: null,
      previousDate: null,
      ytdBaseDate: null,
      rows: [],
      reason: 'No current-date observation found in the recent window',
    }
  }

  const ytdByDate = ytdRes.ok ? groupRatesByDate(ytdRes.data) : new Map<string, Record<string, number>>()
  const ytdBaseDate = ytdRes.ok ? latestDateOnOrBefore(ytdByDate, ytdWindowTo) : null

  const currentRates = byDate.get(current) ?? {}
  const previousRates = previous ? byDate.get(previous) : undefined
  const ytdBaseRates = ytdBaseDate ? ytdByDate.get(ytdBaseDate) : undefined

  const result: UsForexTableResult = {
    ok: true,
    configured: true,
    source: FRANKFURTER_SOURCE,
    sourceType: FRANKFURTER_SOURCE_TYPE,
    base: 'USD',
    providerAttribution: FRANKFURTER_ATTRIBUTION,
    currentDate: current,
    previousDate: previous,
    ytdBaseDate,
    rows: buildUsForexRows(currentRates, previousRates, ytdBaseRates),
  }

  cached = { at: Date.now(), result }
  return result
}

/** Test-only: clears the module-scope cache between test cases. */
export function __resetUsForexCacheForTests(): void {
  cached = null
}
