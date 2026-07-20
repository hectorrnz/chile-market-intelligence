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
import type { StockTimeframe, MarketMode } from '../providers/market/types.ts'
import { getLatestFinancialMetrics, getLatestStatementItems, getEpsForValuation, toMillionsClp } from '../db/repositories/financialsRepository.ts'
import type { PersistedFundamentalsInput } from './compareStatic.ts'
import {
  COMPANY_BY_TICKER,
  SNAPSHOT_BY_TICKER,
  buildFundamentals,
  classifyPerformance,
  normalizeCompareTickers,
} from './compareStatic.ts'
import { safeNumber, type CompareEntry, type ComparePerformance, type CompareResolveResult } from './compareTypes.ts'

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

  const data: CompareEntry[] = []
  for (const ticker of validTickers) {
    const company = COMPANY_BY_TICKER.get(ticker)!
    const snap = snapMap[ticker]
    const staticSnap = SNAPSHOT_BY_TICKER.get(ticker)
    const latestPrice = safeNumber(snap?.price ?? staticSnap?.price ?? null)
    const marketCapCLP = safeNumber(snap?.marketCapCLP ?? company.marketCapCLP ?? null)

    const [metricsByCode, itemsByCode, eps] = await Promise.all([
      getLatestFinancialMetrics(ticker),
      getLatestStatementItems(ticker),
      // Never a single quarter's EPS treated as annual — see getEpsForValuation.
      getEpsForValuation(ticker),
    ])
    // financial_statement_items/financial_metrics store each source's own raw
    // scale (every live provider — Yahoo, CMF/XBRL, CMF bank — writes true raw
    // CLP; only the manual-CSV template convention is millions-scale).
    // marketCapCLP is always millions. A field named ...MM below is guaranteed
    // to already be in millions — normalize via toMillionsClp, once, here,
    // rather than assuming every source matches (see its doc comment for the
    // real bug this fixed: an unnormalized raw FCF value divided by a
    // millions-scale market cap produced FCF Yield in the millions of percent).
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
      // dividendsPaidMM/sharesOutMM feed a per-share ratio (dividendsPaid /
      // sharesOut) — both operands always come from the same source/period, so
      // whatever scale they're actually stored in cancels out. No conversion
      // needed (and none is safe to add without also converting the other).
      dividendsPaidMM: itemsByCode.get('dividends_paid')?.value ?? null,
      sharesOutMM: itemsByCode.get('shares_out')?.value ?? null,
    }

    data.push({
      ticker,
      companyName: company.shortName ?? company.name,
      sector: company.sector,
      currency: snap?.currency ?? staticSnap?.currency ?? 'CLP',
      latestPrice,
      dayChangePct: safeNumber(snap?.dayChangePct ?? staticSnap?.dayChangePct ?? null),
      marketCapCLP,
      latestSnapshotDate: snapshotsResp.metadata.latestSnapshotDate ?? null,
      latestSnapshotType: snapshotsResp.metadata.latestSnapshotType ?? null,
      marketDataSource: snap?.source ?? 'Static MVP sample',
      marketDataStatus: snapshotsResp.metadata.status,
      performance: await resolvePerformance(ticker),
      fundamentals: buildFundamentals(staticSnap, latestPrice, marketCapCLP, persisted),
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
