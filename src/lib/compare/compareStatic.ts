// Phase 8B — Static reference data + pure classification logic for Compare.
//
// Split out of resolveCompareData.ts so this file has NO transitive import of
// marketProvider.ts / staticMarketProvider.ts (which import '@/data/stocks',
// an alias Node's native test runner cannot resolve directly — same reason
// portfolioRepository.ts reads companies.json via fs instead of the
// '@/lib/data/companies' helper). Everything in this file is safely
// unit-testable with plain `node --test`.

import companiesJson from '../../data/companies.json' with { type: 'json' }
import stockPricesJson from '../../data/stockPrices.json' with { type: 'json' }
import type { StockHistoryResponse } from '../providers/market/types.ts'
import {
  safeNumber,
  type CompareFallbackReason,
  type CompareFundamentalKey,
  type CompareFundamentals,
  type ComparePerformanceMetric,
} from './compareTypes.ts'

export interface StaticCompany {
  ticker: string
  name: string
  shortName: string
  sector: string
  marketCapCLP?: number
}

export interface StaticStockSnapshot {
  ticker: string
  price?: number
  currency?: string
  dayChangePct?: number
  pe?: number
  peFwd?: number
  psFwd?: number
  evEbitda?: number
  opMargin?: number | null
  grossMargin?: number | null
  roe?: number
  fcfYield?: number
  pb?: number
  netDebtEbitda?: number | null
  dividendYield?: number
}

// R6.1 — the reference data is IMPORTED, never resolved to a filesystem path.
//
// This file previously did `fileURLToPath(new URL('<literal>', import.meta.url))`
// + readFileSync. That crashed BOTH Compare API routes with a 500 at MODULE
// IMPORT (before any provider ran, so the routes' own try/catch could not
// help), because a bundler is free to rewrite both halves of that expression:
//
//   • `new URL(...)` → webpack substitutes its own runtime shim whose
//     `protocol` is `''`. Node's `fileURLToPath` brand-checks by duck typing
//     (`href && protocol && auth === undefined && path === undefined`), so the
//     falsy protocol fails the guard — while the shim's prototype is
//     `URL.prototype`, so Node's error names it `URL`, producing the
//     self-contradictory `The "path" argument must be of type string or an
//     instance of URL. Received an instance of URL`.
//   • the JSON literal → webpack turns it into an ASSET MODULE whose value is
//     a public web path (`/_next/static/media/companies.<hash>.json`), not a
//     filesystem path. So even passing the string form (`.href`) only moves
//     the failure to `TypeError: Invalid URL`.
//
// A JSON import has no path to rewrite: every bundler (webpack and Turbopack,
// dev and build) inlines the data, Node's native test runner reads it directly
// via the `with { type: 'json' }` attribute, and Vercel's file tracer has
// nothing left to trace — which also permanently retires the ENOENT-on-Vercel
// hazard the old `new URL('<literal>', …)` comment existed to warn about.
// Identical values, identical shape, no filesystem access, no platform or
// runtime dependence.
export const STATIC_COMPANIES = companiesJson as StaticCompany[]
export const STATIC_SNAPSHOTS = stockPricesJson as StaticStockSnapshot[]
export const COMPANY_BY_TICKER = new Map(STATIC_COMPANIES.map((c) => [c.ticker.toUpperCase(), c]))
export const SNAPSHOT_BY_TICKER = new Map(STATIC_SNAPSHOTS.map((s) => [s.ticker.toUpperCase(), s]))

export const FUNDAMENTALS_CONVERSION_PATH = 'Phase 8C — financials/FECU/manual CSV ingestion'

/** Validates tickers against the covered universe and normalizes/dedupes them. */
export function normalizeCompareTickers(input: string[]): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>()
  const valid: string[] = []
  const invalid: string[] = []
  for (const raw of input) {
    const ticker = raw.trim().toUpperCase()
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    if (COMPANY_BY_TICKER.has(ticker)) valid.push(ticker)
    else invalid.push(ticker)
  }
  return { valid, invalid }
}

export function classifyPerformance(resp: StockHistoryResponse): ComparePerformanceMetric {
  const { data, metadata } = resp
  // A live Yahoo Finance historical fetch (see yahooHistoryProvider.ts) is
  // just as real as a Supabase-persisted snapshot series — both are genuine
  // fetched data, not static fallback. Treat them identically here so a
  // successful live fetch is never mislabeled as static_fallback.
  const isFetched = metadata.status === 'live' || metadata.status === 'persisted'

  if (metadata.status === 'live-unavailable') {
    return { value: null, source: 'unavailable', fallbackReason: 'supabase_unavailable' }
  }

  if (data.length < 2) {
    if (isFetched) {
      return { value: null, source: 'unavailable', fallbackReason: 'insufficient_supabase_history' }
    }
    return { value: null, source: 'static_fallback' }
  }

  const first = data[0].close
  const last = data[data.length - 1].close
  const value = first !== 0 ? safeNumber(((last / first) - 1) * 100) : null

  if (isFetched) {
    return { value, source: 'persisted' }
  }

  const reason: CompareFallbackReason | undefined =
    metadata.status === 'hybrid-fallback'
      ? (metadata.fallbackReason?.toLowerCase().includes('insufficient') ? 'insufficient_supabase_history' : 'supabase_unavailable')
      : undefined
  return { value, source: 'static_fallback', fallbackReason: reason }
}

/** Persisted financials + market data available to derive Compare fundamentals (Phase 8C). */
export interface PersistedFundamentalsInput {
  opMarginPct?: number | null
  grossMarginPct?: number | null
  netDebtEbitdaX?: number | null
  epsClp?: number | null
  ebitdaMM?: number | null
  netDebtMM?: number | null
  fcfMM?: number | null
  dividendsPaidMM?: number | null
  sharesOutMM?: number | null
  /** Live, currency-corrected valuation ratios from Yahoo quoteSummary — the
   *  only source for these three (no persisted financials carry book value or
   *  a sales-per-share figure). See yahooRatiosProvider.ts. */
  pbLive?: number | null
  roeLivePct?: number | null
  psTtmLive?: number | null
}

/**
 * Full live valuation from Yahoo (see fetchYahooValuation). When present it is
 * the PRIMARY source for every fundamentals field — the same Yahoo snapshot the
 * price/market-cap come from, so the whole row is internally consistent. A null
 * field just falls through to the persisted/static layers below it.
 */
export interface LiveFundamentalsInput {
  peFwd?: number | null
  psTtm?: number | null
  evEbitda?: number | null
  opMargin?: number | null
  grossMargin?: number | null
  roe?: number | null
  fcfYield?: number | null
  pb?: number | null
  dividendYield?: number | null
  netDebtEbitda?: number | null
}

/**
 * Builds Compare's fundamentals row. Starts from the static snapshot, then
 * upgrades individual fields to 'derived' wherever persisted financials (+
 * market price/cap) make a real calculation possible — never a blanket
 * static claim, per the no-static-terminal-state policy. Fields with no
 * persisted equivalent (psFwd/roe/pb — no forward estimates or book value
 * imported) remain temporary_static.
 */
export function buildFundamentals(
  staticSnap: StaticStockSnapshot | undefined,
  latestPrice?: number | null,
  marketCapCLP?: number | null,
  persisted?: PersistedFundamentalsInput,
  live?: LiveFundamentalsInput,
): CompareFundamentals {
  const derivedFields: CompareFundamentalKey[] = []

  let opMargin = safeNumber(staticSnap?.opMargin)
  if (persisted?.opMarginPct != null) { opMargin = safeNumber(persisted.opMarginPct); derivedFields.push('opMargin') }

  let grossMargin = safeNumber(staticSnap?.grossMargin)
  if (persisted?.grossMarginPct != null) { grossMargin = safeNumber(persisted.grossMarginPct); derivedFields.push('grossMargin') }

  let netDebtEbitda = safeNumber(staticSnap?.netDebtEbitda)
  if (persisted?.netDebtEbitdaX != null) { netDebtEbitda = safeNumber(persisted.netDebtEbitdaX); derivedFields.push('netDebtEbitda') }

  let pe = safeNumber(staticSnap?.peFwd ?? staticSnap?.pe)
  if (persisted?.epsClp != null && persisted.epsClp !== 0 && latestPrice != null) {
    const v = safeNumber(latestPrice / persisted.epsClp)
    if (v !== null) { pe = v; derivedFields.push('pe') }
  }

  let evEbitda = safeNumber(staticSnap?.evEbitda)
  if (persisted?.netDebtMM != null && persisted?.ebitdaMM != null && persisted.ebitdaMM !== 0 && marketCapCLP != null) {
    const v = safeNumber((marketCapCLP + persisted.netDebtMM) / persisted.ebitdaMM)
    if (v !== null) { evEbitda = v; derivedFields.push('evEbitda') }
  }

  let fcfYield = safeNumber(staticSnap?.fcfYield)
  if (persisted?.fcfMM != null && marketCapCLP != null && marketCapCLP !== 0) {
    const v = safeNumber((persisted.fcfMM / marketCapCLP) * 100)
    if (v !== null) { fcfYield = v; derivedFields.push('fcfYield') }
  }

  let dividendYield = safeNumber(staticSnap?.dividendYield)
  if (persisted?.dividendsPaidMM != null && persisted?.sharesOutMM != null && persisted.sharesOutMM !== 0 && latestPrice != null && latestPrice !== 0) {
    const perShare = persisted.dividendsPaidMM / persisted.sharesOutMM
    const v = safeNumber((perShare / latestPrice) * 100)
    if (v !== null) { dividendYield = v; derivedFields.push('dividendYield') }
  }

  // P/S, ROE and P/B come from Yahoo or not at all. They deliberately do NOT
  // fall back to the static sample snapshot: that sample is fabricated demo
  // data, and silently showing it under a live-looking table is exactly the
  // no-static-terminal-state violation this wiring exists to remove. A null
  // renders as an honest "—".
  //
  // Note psFwd is populated from a TRAILING figure — Yahoo exposes no forward
  // sales estimate and this project ingests no analyst estimates, so the UI
  // label must read TTM. The field keeps its original name only to avoid
  // churning the CompareFundamentals shape and its consumers.
  let psTtm = safeNumber(persisted?.psTtmLive ?? null)
  if (psTtm !== null) derivedFields.push('psFwd')

  let roe = safeNumber(persisted?.roeLivePct ?? null)
  if (roe !== null) derivedFields.push('roe')

  let pb = safeNumber(persisted?.pbLive ?? null)
  if (pb !== null) derivedFields.push('pb')

  // Live Yahoo valuation is the PRIMARY layer — it shares the same snapshot as
  // the price/market cap, so every field is internally consistent. When a live
  // field is present it overrides the persisted/static value computed above and
  // is marked as a live/derived cell (so the UI shows the "•" and names Yahoo
  // as the source). A null live field leaves the fallback layers untouched.
  const applyLive = (key: CompareFundamentalKey, current: number | null, liveVal: number | null | undefined): number | null => {
    const v = safeNumber(liveVal)
    if (v === null) return current
    if (!derivedFields.includes(key)) derivedFields.push(key)
    return v
  }
  pe = applyLive('pe', pe, live?.peFwd)
  psTtm = applyLive('psFwd', psTtm, live?.psTtm)
  evEbitda = applyLive('evEbitda', evEbitda, live?.evEbitda)
  opMargin = applyLive('opMargin', opMargin, live?.opMargin)
  grossMargin = applyLive('grossMargin', grossMargin, live?.grossMargin)
  roe = applyLive('roe', roe, live?.roe)
  fcfYield = applyLive('fcfYield', fcfYield, live?.fcfYield)
  pb = applyLive('pb', pb, live?.pb)
  netDebtEbitda = applyLive('netDebtEbitda', netDebtEbitda, live?.netDebtEbitda)
  dividendYield = applyLive('dividendYield', dividendYield, live?.dividendYield)

  return {
    pe,
    psFwd: psTtm,
    evEbitda,
    opMargin,
    grossMargin,
    roe,
    fcfYield,
    pb,
    netDebtEbitda,
    dividendYield,
    derivedFields,
    conversionPath: FUNDAMENTALS_CONVERSION_PATH,
  }
}
