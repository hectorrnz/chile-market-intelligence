// Phase 8B — Compare data model.
//
// Types only (safe for client import). Every field on CompareEntry carries an
// explicit source classification — no field is silently "static" without a
// caller-visible label, per the no-static-terminal-state policy
// (see docs/data_source_status.md).

import type { DataSourceStatus } from '../providers/types'
import type { MarketMode } from '../providers/market/types'

/** Classification for a single field or metric within a Compare row. */
export type CompareFieldSource =
  | 'live'
  | 'persisted'
  | 'derived'
  | 'static_fallback'
  | 'temporary_static'
  | 'unavailable'

/** Explicit, enumerated reasons a field fell back — never a vague "static". */
export type CompareFallbackReason =
  | 'insufficient_supabase_history'
  | 'supabase_unavailable'
  | 'static_fundamental_pending_ingestion'
  | 'invalid_ticker'

export interface ComparePerformanceMetric {
  value: number | null
  source: CompareFieldSource
  fallbackReason?: CompareFallbackReason
}

export interface ComparePerformance {
  oneDay: ComparePerformanceMetric
  fiveDay: ComparePerformanceMetric
  oneMonth: ComparePerformanceMetric
  ytd: ComparePerformanceMetric
  oneYear: ComparePerformanceMetric
}

export type CompareFundamentalKey =
  | 'pe' | 'psFwd' | 'evEbitda' | 'opMargin' | 'grossMargin'
  | 'roe' | 'fcfYield' | 'pb' | 'netDebtEbitda' | 'dividendYield'

/**
 * Valuation/fundamental ratios. Phase 8C: fields derivable from persisted
 * manual-CSV financials (+ market price/cap) are upgraded to 'derived';
 * fields with no persisted equivalent (no equity/book-value or forward
 * estimates imported) remain 'temporary_static' — listed in `derivedFields`
 * so the UI can label each cell individually, never a blanket claim.
 */
export interface CompareFundamentals {
  pe: number | null
  psFwd: number | null
  evEbitda: number | null
  opMargin: number | null
  grossMargin: number | null
  roe: number | null
  fcfYield: number | null
  pb: number | null
  netDebtEbitda: number | null
  dividendYield: number | null
  /** Fields upgraded to 'derived' (persisted financials + market data). Any field not listed is 'temporary_static'. */
  derivedFields: CompareFundamentalKey[]
  conversionPath: string
}

export interface CompareEntry {
  ticker: string
  companyName: string
  sector: string
  currency: string
  latestPrice: number | null
  dayChangePct: number | null
  marketCapCLP: number | null
  latestSnapshotDate: string | null
  latestSnapshotType: string | null
  marketDataSource: string
  marketDataStatus: DataSourceStatus
  performance: ComparePerformance
  fundamentals: CompareFundamentals
}

export interface CompareResolveMeta {
  marketDataModeRequested: MarketMode
  marketDataModeUsed: MarketMode
  persistedAvailable: boolean
  staticFallbackUsed: boolean
  latestSnapshotDate: string | null
  invalidTickers: string[]
}

export interface CompareResolveResult {
  data: CompareEntry[]
  metadata: CompareResolveMeta
}

/**
 * Compact live-valuation payload for a single ticker — the company/stocks
 * detail page's Valuation table + KPIs read this. Same resolver/fundamentals
 * as Compare (so the two surfaces always agree) but without the multi-timeframe
 * performance history Compare needs.
 */
export interface ValuationResult {
  ticker: string
  companyName: string
  currency: string
  latestPrice: number | null
  /** Market cap in MILLIONS of the quote currency (platform-wide convention). */
  marketCapCLP: number | null
  /** Year-to-date price change %, from live/persisted history (null if unavailable). */
  ytdChangePct: number | null
  marketDataStatus: DataSourceStatus
  fundamentals: CompareFundamentals
}

/** Guards against NaN/Infinity ever reaching a CompareEntry field. */
export function safeNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}
