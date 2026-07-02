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

  if (metadata.status === 'live-unavailable') {
    return { value: null, source: 'unavailable', fallbackReason: 'supabase_unavailable' }
  }

  if (data.length < 2) {
    if (metadata.status === 'persisted') {
      return { value: null, source: 'unavailable', fallbackReason: 'insufficient_supabase_history' }
    }
    return { value: null, source: 'static_fallback' }
  }

  const first = data[0].close
  const last = data[data.length - 1].close
  const value = first !== 0 ? safeNumber(((last / first) - 1) * 100) : null

  if (metadata.status === 'persisted') {
    return { value, source: 'persisted' }
  }

  const reason: CompareFallbackReason | undefined =
    metadata.status === 'hybrid-fallback'
      ? (metadata.fallbackReason?.toLowerCase().includes('insufficient') ? 'insufficient_supabase_history' : 'supabase_unavailable')
      : undefined
  return { value, source: 'static_fallback', fallbackReason: reason }
}

export function buildFundamentals(staticSnap: StaticStockSnapshot | undefined): CompareFundamentals {
  return {
    pe: safeNumber(staticSnap?.peFwd ?? staticSnap?.pe),
    psFwd: safeNumber(staticSnap?.psFwd),
    evEbitda: safeNumber(staticSnap?.evEbitda),
    opMargin: safeNumber(staticSnap?.opMargin),
    grossMargin: safeNumber(staticSnap?.grossMargin),
    roe: safeNumber(staticSnap?.roe),
    fcfYield: safeNumber(staticSnap?.fcfYield),
    pb: safeNumber(staticSnap?.pb),
    netDebtEbitda: safeNumber(staticSnap?.netDebtEbitda),
    dividendYield: safeNumber(staticSnap?.dividendYield),
    source: 'temporary_static',
    conversionPath: FUNDAMENTALS_CONVERSION_PATH,
  }
}
