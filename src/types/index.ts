// Core entity types — Phase 2C enriched
// Source of truth for all data shapes. JSON files must match these interfaces.

export interface Company {
  ticker: string
  name: string
  legalName: string
  shortName: string
  sector: string
  industry: string
  exchange: string
  currency: string
  country: string
  marketCapCLP?: number
  marketCapUSD?: number
  description?: string
  businessSummary?: string
  businessModel?: string
  keyRevenueDrivers?: string[]
  keyRisks?: string[]
  sourceForBusinessDescription?: string
  sourceStatus?: 'static_mvp' | 'cmf_future' | 'ir_future'
  website?: string
  cmfId?: string
  irUrl?: string
  active: boolean
  isTracked: boolean
  updatedAt: string
}

export interface StockPriceSnapshot {
  ticker: string
  price: number
  currency: string
  dayChangePct: number
  weekChangePct?: number
  monthChangePct?: number
  ytdChangePct: number
  volume?: number
  avgVolume30d?: number
  marketCapCLP?: number
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
  lastUpdated: string
  source: string
}

export interface MacroIndicator {
  id: string
  name: string
  shortName: string
  category: 'Inflation' | 'Rates' | 'FX' | 'Activity' | 'Commodities' | 'Labor' | 'US Rates' | 'US Inflation' | 'US FX' | 'US Activity' | 'US Labor' | 'US Risk Assets' | 'Crypto'
  region?: 'CL' | 'US' | 'GLOBAL'
  value: number
  unit: string
  change?: number
  changeLabel?: string
  period: string
  source: string
  lastUpdated: string
  importance: 'high' | 'medium' | 'low'
  marketImplication?: string
}

export interface MacroHistoryPoint {
  indicatorId: string
  date: string    // YYYY-MM (quarterly) or YYYY-MM-DD (daily/weekly)
  value: number
  type?: 'quarterly' | 'weekly' | 'daily'
}

export interface StockHistoryPoint {
  ticker: string
  date: string    // YYYY-MM for monthly/quarterly, YYYY-MM-DD for daily/weekly
  price: number
  type: 'quarterly' | 'monthly' | 'weekly' | 'daily' | 'intraday'
}

export interface SectorPerformance {
  sector: string
  dayChangePct: number
  ytdChangePct: number
  numberOfStocks: number
  topContributor: string
  topContributorPct: number
  worstContributor: string
  worstContributorPct: number
  lastUpdated: string
}

export interface ChileanRate {
  id: string
  name: string       // short display label, e.g. "BTU 10"
  fullName: string   // longer description
  value: number      // yield / rate in %
  unit: string       // usually "%"
  change?: number
  changeLabel?: string
  source: string
}

export interface FxRate {
  id: string
  pair: string       // display label, e.g. "EURUSD"
  section: 'Key FX' | '# USD per' | '# of currency per USD' | '# of Yen per'
  last: number
  dayChangePct: number
  ytdChangePct: number
  decimals?: number  // display precision for `last`
  source: string
}

export interface IndexPerformance {
  id: string
  name: string
  country: string
  region: string
  value: number
  currency: string
  dayChangePct: number
  ytdChangePct: number
  date: string
  source: string
}

export interface EarningsRelease {
  id: string
  ticker: string
  companyName: string
  period: string
  reportDate: string
  revenue?: number
  ebitda?: number
  netIncome?: number
  eps?: number
  netDebt?: number
  fcf?: number
  revenueYoY?: number
  ebitdaYoY?: number
  netIncomeYoY?: number
  ebitdaMargin?: number
  marginChange?: number
  /** Sell-side consensus estimates (static MVP sample). Used for beat/miss. */
  consensusRevenue?: number
  consensusEbitda?: number
  consensusEps?: number
  resultQuality: 'Clean' | 'Mixed' | 'Weak' | 'Pending'
  summary?: string
  keyDriver?: string
  watchItem?: string
  source: string
}

// Phase — Source-backed News module. Every NewsItem is a real, fetched article
// (or an official disclosure listing) — never a fabricated/sample row. See
// src/lib/providers/news/ for the provider architecture and
// docs/data_source_status.md for the per-source implementation record.
export type NewsCategory = 'Macro' | 'Company' | 'Regulation' | 'Earnings' | 'Market'
export type NewsImpactLevel = 'Low' | 'Medium' | 'High'
/** 'official' = CMF, BCCh, or another government/regulatory body. Every other source is 'media'. */
export type NewsSourceType = 'official' | 'media'

export interface NewsItem {
  id: string
  headline: string
  /** Source-provided description/excerpt. Null (never a fabricated placeholder string) when unavailable. */
  summary: string | null
  /** Display name of the outlet, e.g. "Diario Financiero" — never a vendor name we have no relationship with. */
  source: string
  sourceType: NewsSourceType
  /** Direct link to the original article/disclosure. Always non-empty for a real item. */
  sourceUrl: string
  /** ISO timestamp as reported by the source. */
  publishedAt: string
  /** ISO timestamp of when this app fetched the item. */
  fetchedAt: string
  category: NewsCategory
  impactLevel: NewsImpactLevel
  /** Short, deterministic explanation of why impactLevel was assigned — never vague sentiment. */
  impactReason: string
  affectedTickers: string[]
  affectedAssets: string[]
  affectedTags: string[]
  language: 'es' | 'en'
}

/**
 * DocumentRecord — internal abstraction for source documents.
 * Does not store PDFs. localStatus tracks where we are in the sync pipeline.
 * Phase 5+ will populate synced documents from CMF/company sources.
 */
export interface DocumentRecord {
  id: string
  type: 'earnings_release' | 'financial_statement' | 'news_source'
  ticker: string
  companyName: string
  title: string
  date: string
  source: string
  sourceUrl: string
  localStatus: 'external_only' | 'placeholder' | 'synced_future'
  summary: string
  aiSummary: string
  keyPoints: string[]
  relatedRecordId: string
  fileType: 'pdf' | 'html' | 'xbrl' | 'press_release' | 'unknown'
}
