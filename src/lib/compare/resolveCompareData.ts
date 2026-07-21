// Phase 8B — Compare page resolver. SERVER-ONLY (transitively imports Supabase
// repositories via marketProvider). Reuses the existing static/supabase/hybrid
// market-data orchestrator rather than re-implementing mode logic — see
// src/lib/providers/market/marketProvider.ts.
//
// Market fields (price, day change, market cap, currency, short-term
// performance) are wired to persisted/live data where available. Fundamentals
// (P/E, margins, etc.) are upgraded field-by-field to 'derived' wherever
// persisted manual-CSV financials make a real calculation possible (Phase
// 8C) — otherwise they remain temporary_static, never labeled live.
//
// Pure/static-only logic (ticker validation, performance classification,
// fundamentals mapping) lives in compareStatic.ts, which has no transitive
// dependency on marketProvider.ts — see that file's header comment for why
// this split matters for unit-testability.

import { resolveStockSnapshots, resolveStockHistory } from '../providers/market/marketProvider.ts'
import { fetchYahooValuation, type YahooValuation } from '../providers/market/yahooRatiosProvider.ts'
import type { StockTimeframe, MarketMode, StockSnapshot } from '../providers/market/types.ts'
import { getLatestFinancialMetrics, getLatestStatementItems, getEpsForValuation, toMillionsClp } from '../db/repositories/financialsRepository.ts'
import type { PersistedFundamentalsInput, LiveFundamentalsInput, StaticCompany, StaticStockSnapshot } from './compareStatic.ts'
import {
  COMPANY_BY_TICKER,
  SNAPSHOT_BY_TICKER,
  buildFundamentals,
  classifyPerformance,
  normalizeCompareTickers,
} from './compareStatic.ts'
import { safeNumber, type CompareEntry, type CompareFundamentals, type ComparePerformance, type CompareResolveResult, type ValuationResult } from './compareTypes.ts'
import type { DataSourceStatus } from '../providers/types.ts'

export { normalizeCompareTickers } from './compareStatic.ts'

const PERFORMANCE_TIMEFRAMES: StockTimeframe[] = ['1D', '5D', '1M', 'YTD', '1Y']

async function resolvePerformance(ticker: string): Promise<ComparePerformance> {
  const [oneDay, fiveDay, oneMonth, ytd, oneYear] = await Promise.all(
    PERFORMANCE_TIMEFRAMES.map((tf) => resolveStockHistory(ticker, tf)),
  )
  return {
    oneDay: classifyPerformance(oneDay),
    fiveDay: classifyPerformance(fiveDay),
    oneMonth: classifyPerformance(oneMonth),
    ytd: classifyPerformance(ytd),
    oneYear: classifyPerformance(oneYear),
  }
}

interface TickerValuationCore {
  latestPrice: number | null
  marketCapCLP: number | null
  currency: string
  hasLiveValuation: boolean
  fundamentals: CompareFundamentals
}

/**
 * Builds the price/market-cap/fundamentals for ONE ticker from a live Yahoo
 * valuation (primary), a persisted Supabase snapshot + persisted financials
 * (fallback) and the static sample (last resort). Shared by both
 * resolveCompareData (per-row) and resolveValuation (company page) so the two
 * surfaces are guaranteed to compute identical figures.
 */
async function buildTickerValuationCore(
  ticker: string,
  company: StaticCompany,
  val: YahooValuation | undefined,
  snap: StockSnapshot | undefined,
  staticSnap: StaticStockSnapshot | undefined,
): Promise<TickerValuationCore> {
  // Live Yahoo price/market cap take priority; persisted (Supabase) then static
  // are the resilience fallbacks. marketCapCLP is stored in MILLIONS
  // platform-wide (the fundamentals table divides by 1000 to show billions), so
  // Yahoo's raw-CLP market cap is converted here, once.
  const latestPrice = safeNumber(val?.price ?? snap?.price ?? staticSnap?.price ?? null)
  const marketCapCLP = safeNumber(
    val?.marketCap != null ? val.marketCap / 1_000_000 : (snap?.marketCapCLP ?? company.marketCapCLP ?? null),
  )
  const hasLiveValuation = val?.price != null
  const currency = val?.currency ?? snap?.currency ?? staticSnap?.currency ?? 'CLP'

  const [metricsByCode, itemsByCode, eps] = await Promise.all([
    getLatestFinancialMetrics(ticker),
    getLatestStatementItems(ticker),
    // Never a single quarter's EPS treated as annual — see getEpsForValuation.
    getEpsForValuation(ticker),
  ])
  // financial_statement_items/financial_metrics store each source's own raw
  // scale (every live provider — Yahoo, CMF/XBRL, CMF bank — writes true raw
  // CLP; only the manual-CSV template convention is millions-scale).
  // marketCapCLP is always millions. A field named ...MM below is guaranteed to
  // already be in millions — normalize via toMillionsClp, once, here (see its
  // doc comment for the real bug this fixed).
  const ebitdaItem = itemsByCode.get('ebitda')
  const fcfMetric = metricsByCode.get('fcf')
  const netDebtMetric = metricsByCode.get('net_debt')
  const persisted: PersistedFundamentalsInput = {
    opMarginPct: metricsByCode.get('op_margin')?.value ?? null,
    grossMarginPct: metricsByCode.get('gross_margin')?.value ?? null,
    netDebtEbitdaX: metricsByCode.get('net_debt_ebitda')?.value ?? null,
    epsClp: eps?.value ?? null,
    ebitdaMM: ebitdaItem?.value != null ? toMillionsClp(ebitdaItem.value, ebitdaItem) : null,
    netDebtMM: netDebtMetric?.value != null ? toMillionsClp(netDebtMetric.value, netDebtMetric) : null,
    fcfMM: fcfMetric?.value != null ? toMillionsClp(fcfMetric.value, fcfMetric) : null,
    // dividendsPaidMM/sharesOutMM feed a per-share ratio — both operands come
    // from the same source/period, so whatever scale they're stored in
    // cancels out (no conversion needed, and none is safe to add alone).
    dividendsPaidMM: itemsByCode.get('dividends_paid')?.value ?? null,
    sharesOutMM: itemsByCode.get('shares_out')?.value ?? null,
  }
  // Live Yahoo valuation — primary layer for every fundamentals field, from the
  // same snapshot as the price/market cap above.
  const live: LiveFundamentalsInput = {
    peFwd: val?.peFwd ?? null,
    psTtm: val?.psTtm ?? null,
    evEbitda: val?.evEbitda ?? null,
    opMargin: val?.opMargin ?? null,
    grossMargin: val?.grossMargin ?? null,
    roe: val?.roe ?? null,
    fcfYield: val?.fcfYield ?? null,
    pb: val?.pb ?? null,
    dividendYield: val?.dividendYield ?? null,
    netDebtEbitda: val?.netDebtEbitda ?? null,
  }

  return {
    latestPrice,
    marketCapCLP,
    currency,
    hasLiveValuation,
    fundamentals: buildFundamentals(staticSnap, latestPrice, marketCapCLP, persisted, live),
  }
}

/**
 * Live valuation for a single ticker — used by the company/stocks detail page's
 * Valuation table + KPIs. Same fundamentals logic as Compare, minus the
 * multi-timeframe performance history. Returns null for an unknown ticker.
 */
export async function resolveValuation(tickerInput: string): Promise<ValuationResult | null> {
  const ticker = tickerInput.trim().toUpperCase()
  const company = COMPANY_BY_TICKER.get(ticker)
  if (!company) return null

  const [snapshotsResp, valuationByTicker, ytdHistory] = await Promise.all([
    resolveStockSnapshots(),
    fetchYahooValuation([ticker]),
    resolveStockHistory(ticker, 'YTD'),
  ])
  const snap = snapshotsResp.data.find((s) => s.ticker === ticker)
  const staticSnap = SNAPSHOT_BY_TICKER.get(ticker)
  const val = valuationByTicker.get(ticker)
  const core = await buildTickerValuationCore(ticker, company, val, snap, staticSnap)
  // YTD is derived from live/persisted history (same classifier Compare uses),
  // so the KPI is live rather than the frozen static snapshot value.
  const ytdChangePct = classifyPerformance(ytdHistory).value

  return {
    ticker,
    companyName: company.shortName ?? company.name,
    currency: core.currency,
    latestPrice: core.latestPrice,
    marketCapCLP: core.marketCapCLP,
    ytdChangePct,
    marketDataStatus: (core.hasLiveValuation ? 'live' : snapshotsResp.metadata.status) as DataSourceStatus,
    fundamentals: core.fundamentals,
  }
}

export async function resolveCompareData(tickersInput: string[]): Promise<CompareResolveResult> {
  const { valid: validTickers, invalid: invalidTickers } = normalizeCompareTickers(tickersInput)

  if (validTickers.length === 0) {
    return {
      data: [],
      metadata: {
        marketDataModeRequested: 'static',
        marketDataModeUsed: 'static',
        persistedAvailable: false,
        staticFallbackUsed: false,
        latestSnapshotDate: null,
        invalidTickers,
      },
    }
  }

  const snapshotsResp = await resolveStockSnapshots()
  const snapMap = Object.fromEntries(snapshotsResp.data.map((s) => [s.ticker, s]))
  // One batched Yahoo call for the whole comparison — the SINGLE source of the
  // live price, market cap and every valuation ratio, so the Market Data price
  // and the Fundamentals "Last Price" can never disagree (the item-4 bug).
  // Never throws; a ticker that fails just leaves its cells null and falls back
  // to the persisted/static layers below.
  const valuationByTicker = await fetchYahooValuation(validTickers)

  const data: CompareEntry[] = []
  for (const ticker of validTickers) {
    const company = COMPANY_BY_TICKER.get(ticker)!
    const snap = snapMap[ticker]
    const staticSnap = SNAPSHOT_BY_TICKER.get(ticker)
    const val = valuationByTicker.get(ticker)
    const core = await buildTickerValuationCore(ticker, company, val, snap, staticSnap)

    data.push({
      ticker,
      companyName: company.shortName ?? company.name,
      sector: company.sector,
      currency: core.currency,
      latestPrice: core.latestPrice,
      dayChangePct: safeNumber(snap?.dayChangePct ?? staticSnap?.dayChangePct ?? null),
      marketCapCLP: core.marketCapCLP,
      latestSnapshotDate: snapshotsResp.metadata.latestSnapshotDate ?? null,
      latestSnapshotType: snapshotsResp.metadata.latestSnapshotType ?? null,
      marketDataSource: core.hasLiveValuation ? 'Yahoo Finance' : (snap?.source ?? 'Static MVP sample'),
      marketDataStatus: core.hasLiveValuation ? 'live' : snapshotsResp.metadata.status,
      performance: await resolvePerformance(ticker),
      fundamentals: core.fundamentals,
    })
  }

  return {
    data,
    metadata: {
      marketDataModeRequested: (snapshotsResp.metadata.marketDataModeRequested as MarketMode) ?? 'static',
      marketDataModeUsed: (snapshotsResp.metadata.marketDataModeUsed as MarketMode) ?? 'static',
      persistedAvailable: Boolean(snapshotsResp.metadata.persistedAvailable),
      staticFallbackUsed:
        snapshotsResp.metadata.dataModeUsed === 'static' && snapshotsResp.metadata.dataModeRequested !== 'static',
      latestSnapshotDate: snapshotsResp.metadata.latestSnapshotDate ?? null,
      invalidTickers,
    },
  }
}
