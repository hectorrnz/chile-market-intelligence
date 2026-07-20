// Phase 8B — Static reference data + pure classification logic for Compare.
//
// Split out of resolveCompareData.ts so this file has NO transitive import of
// marketProvider.ts / staticMarketProvider.ts (which import '@/data/stocks',
// an alias Node's native test runner cannot resolve directly — same reason
// portfolioRepository.ts reads companies.json via fs instead of the
// '@/lib/data/companies' helper). Everything in this file is safely
// unit-testable with plain `node --test`.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

// The `new URL('literal', import.meta.url)` argument must be a string
// literal, not a variable — Vercel's build-time file tracer (@vercel/nft)
// only detects this pattern statically when it can see the literal path
// directly in the call, matching portfolioRepository.ts's proven pattern.
// A generic loadJson(path) helper silently breaks tracing (ENOENT at
// runtime on Vercel, works fine locally) since the path becomes a runtime
// value instead of an analyzable literal — caught via Preview validation.
const companiesPath = fileURLToPath(new URL('../../data/companies.json', import.meta.url))
const stockPricesPath = fileURLToPath(new URL('../../data/stockPrices.json', import.meta.url))
export const STATIC_COMPANIES = JSON.parse(readFileSync(companiesPath, 'utf8')) as StaticCompany[]
export const STATIC_SNAPSHOTS = JSON.parse(readFileSync(stockPricesPath, 'utf8')) as StaticStockSnapshot[]
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
  const psTtm = safeNumber(persisted?.psTtmLive ?? null)
  if (psTtm !== null) derivedFields.push('psFwd')

  const roe = safeNumber(persisted?.roeLivePct ?? null)
  if (roe !== null) derivedFields.push('roe')

  const pb = safeNumber(persisted?.pbLive ?? null)
  if (pb !== null) derivedFields.push('pb')

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
