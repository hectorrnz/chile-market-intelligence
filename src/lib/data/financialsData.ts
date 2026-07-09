// Phase 8C — Client-safe financials fetch helpers. Components call these to
// hit /api/financials/* — never the resolver or Supabase repository directly.

import type { FundamentalRecord } from './fundamentals'

export type FinancialsSourceStatus = 'persisted' | 'static_fallback'
export type FinancialsSourceType = 'xbrl' | 'cmf_fecu' | 'manual_csv' | 'yahoo_finance' | 'mixed' | 'none'

export interface StatementsResponse {
  ticker: string
  records: FundamentalRecord[]
  status: FinancialsSourceStatus
  source: string
  /** Dominant persisted source_type (Phase 8C.2) — drives the source badge. Absent on older responses → treat as manual_csv. */
  sourceType?: FinancialsSourceType
}

export async function fetchFinancialStatements(ticker: string): Promise<StatementsResponse> {
  const res = await fetch(`/api/financials/${encodeURIComponent(ticker)}/statements`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/financials/${ticker}/statements returned ${res.status}`)
  return res.json()
}

export interface EarningsEventOut {
  id: string
  ticker: string
  fiscalYear: number | null
  fiscalPeriod: string | null
  periodType: string | null
  reportDate: string | null
  eventDate: string | null
  status: string
  revenue: number | null
  ebitda: number | null
  netIncome: number | null
  eps: number | null
  currency: string | null
  sourceType: string
  sourceName: string | null
}

export interface EarningsResponse {
  events: EarningsEventOut[]
  tickersCovered: string[]
}

/** Fetches all persisted earnings events, or only a single ticker's when provided. */
export async function fetchEarningsEvents(ticker?: string): Promise<EarningsResponse> {
  const url = ticker ? `/api/earnings?ticker=${encodeURIComponent(ticker)}` : '/api/earnings'
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/earnings returned ${res.status}`)
  return res.json()
}

export interface FinancialsCoverageEntry {
  ticker: string
  reportingPeriodCount: number
  latestPeriodEnd: string | null
}

export async function fetchFinancialsCoverage(): Promise<{ coverage: FinancialsCoverageEntry[] }> {
  const res = await fetch('/api/financials/coverage', { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/financials/coverage returned ${res.status}`)
  return res.json()
}
