// DEPRECATED (FX Integrity Task, superseded by frankfurterFxProvider.ts).
// NOT IMPORTED BY ANY PRODUCTION ROUTE OR PAGE. The Macro / US forex table now
// uses Frankfurter (free, no API key, real 1D/YTD change) instead of this
// CurrencyFreaks provider, which never had access to historical/change data
// on the plan tier used. Kept in the repo (not deleted) only in case a future
// need for CurrencyFreaks-specific data arises; `CURRENCYFREAKS_API_KEY`
// remains configured in Vercel but is no longer read by any production code
// path. See tests/currencyFreaksFx.test.ts's production-import guard and
// docs/macro_market_source_coverage.md §14 for the full deprecation record.
//
// FX Data Task — Macro / US forex table provider (CurrencyFreaks, unofficial
// third-party). SERVER-ONLY.
//
// Chile FX stays entirely separate and BCCh-official (see bcchMacroProvider.ts
// / macroSeries.ts's FX category, used by the Macro / Chile forex rows and the
// Home FX panel) — this module never touches that path.
//
// CurrencyFreaks' free-plan `/rates/latest` is USD-base only and appears to
// publish one snapshot per day (verified live 2026-07-14: `date` was a
// midnight-UTC timestamp with no intraday movement across repeated calls).
// There is no day-change/YTD field on this endpoint at any plan tier we use,
// so this module NEVER fabricates those figures — the UI must omit them.
//
// A short in-memory cache (module-scope, per server instance) keeps refresh
// conservative and well within the free-plan quota: at most one real
// CurrencyFreaks request per CACHE_TTL_MS window, regardless of how many
// times the Macro / US page is loaded. See docs/macro_market_source_coverage.md
// for the documented monthly-request estimate.

import { fetchCurrencyFreaksRates, isCurrencyFreaksConfigured, type CurrencyFreaksRates } from './currencyFreaksClient.ts'

export const CURRENCYFREAKS_SOURCE = 'CurrencyFreaks'
export const CURRENCYFREAKS_SOURCE_TYPE = 'unofficial_third_party_fx' as const

/** ISO codes requested from CurrencyFreaks — validated against the Macro / US table's needs. */
export const CURRENCYFREAKS_SYMBOLS = [
  'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'MXN', 'BRL', 'CNY', 'KRW', 'TWD',
] as const

export type UsForexDirection = 'direct' | 'inverted'

export interface UsForexRow {
  id: string
  pair: string
  last: number
  decimals: number
  /** 'direct' = USD-base rate used as-is (USD/XXX); 'inverted' = 1/rate (XXX/USD). */
  direction: UsForexDirection
  /** Never fabricated — omitted entirely (not zero) when the source has no such field. */
  dayChangePct: null
  ytdChangePct: null
}

export interface UsForexTableResult {
  ok: boolean
  configured: boolean
  source: string
  sourceType: typeof CURRENCYFREAKS_SOURCE_TYPE
  base: 'USD'
  asOf: string | null
  rows: UsForexRow[]
  reason?: string
}

// Direct pairs: USD/XXX = the raw USD-base rate.
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

// Inverted pairs: XXX/USD = 1 / the raw USD-base rate.
const INVERTED_PAIRS: { code: string; pair: string; decimals: number }[] = [
  { code: 'EUR', pair: 'EURUSD', decimals: 4 },
  { code: 'GBP', pair: 'GBPUSD', decimals: 4 },
  { code: 'AUD', pair: 'AUDUSD', decimals: 4 },
  { code: 'NZD', pair: 'NZDUSD', decimals: 4 },
]

/** Pure — builds direct + inverted USD-base rows from a raw rates map. Never fabricates a rate. */
export function buildUsForexRows(rates: Record<string, number>): UsForexRow[] {
  const rows: UsForexRow[] = []
  for (const { code, pair, decimals } of DIRECT_PAIRS) {
    const r = rates[code]
    if (r == null || !Number.isFinite(r) || r <= 0) continue
    rows.push({ id: pair.toLowerCase(), pair, last: r, decimals, direction: 'direct', dayChangePct: null, ytdChangePct: null })
  }
  for (const { code, pair, decimals } of INVERTED_PAIRS) {
    const r = rates[code]
    if (r == null || !Number.isFinite(r) || r <= 0) continue
    rows.push({ id: pair.toLowerCase(), pair, last: 1 / r, decimals, direction: 'inverted', dayChangePct: null, ytdChangePct: null })
  }
  return rows
}

// ── Conservative in-memory cache (module scope, per server instance) ────────

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours — the source only publishes daily anyway
let cached: { at: number; result: UsForexTableResult } | null = null

/**
 * Resolves the Macro / US forex table from CurrencyFreaks, cached server-side
 * for CACHE_TTL_MS so repeated page loads never trigger a fresh provider call.
 * Never throws; a missing key or provider failure returns a structured
 * `ok:false` result with `rows: []` — the caller shows an "unavailable" state,
 * never a fabricated table.
 */
export async function resolveUsForexTable(): Promise<UsForexTableResult> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result

  if (!isCurrencyFreaksConfigured()) {
    const result: UsForexTableResult = {
      ok: false,
      configured: false,
      source: CURRENCYFREAKS_SOURCE,
      sourceType: CURRENCYFREAKS_SOURCE_TYPE,
      base: 'USD',
      asOf: null,
      rows: [],
      reason: 'CURRENCYFREAKS_API_KEY not configured',
    }
    return result
  }

  const res = await fetchCurrencyFreaksRates([...CURRENCYFREAKS_SYMBOLS])
  // The pair methodology below (direct/inverted) assumes a USD base — verified
  // live (2026-07-14). If the provider ever reports a different base, fail
  // closed rather than silently mislabel every derived pair.
  const result: UsForexTableResult = res.ok && (res.data as CurrencyFreaksRates).base === 'USD'
    ? {
        ok: true,
        configured: true,
        source: CURRENCYFREAKS_SOURCE,
        sourceType: CURRENCYFREAKS_SOURCE_TYPE,
        base: 'USD',
        asOf: res.data.date,
        rows: buildUsForexRows(res.data.rates),
      }
    : {
        ok: false,
        configured: true,
        source: CURRENCYFREAKS_SOURCE,
        sourceType: CURRENCYFREAKS_SOURCE_TYPE,
        base: 'USD',
        asOf: null,
        rows: [],
        reason: res.ok ? 'CurrencyFreaks reported a non-USD base — pair methodology assumes USD' : res.reason,
      }

  // Only cache a successful fetch — a transient failure should retry on the
  // next request rather than being pinned as "unavailable" for 6 hours.
  if (result.ok) cached = { at: Date.now(), result }
  return result
}

/** Test-only: clears the module-scope cache between test cases. */
export function __resetUsForexCacheForTests(): void {
  cached = null
}
