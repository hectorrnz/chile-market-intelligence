// Phase 8B — Compare page resolver. SERVER-ONLY (transitively imports Supabase
// repositories via marketProvider). Reuses the existing static/supabase/hybrid
// market-data orchestrator rather than re-implementing mode logic — see
// src/lib/providers/market/marketProvider.ts.
//
// Market fields (price, day change, market cap, currency, short-term
// performance) are wired to persisted/live data where available. Fundamentals
// (P/E, margins, etc.) remain temporary_static — no financials ingestion
// exists yet (Phase 8C) — and are always labeled as such, never as live.
//
// Pure/static-only logic (ticker validation, performance classification,
// fundamentals mapping) lives in compareStatic.ts, which has no transitive
// dependency on marketProvider.ts — see that file's header comment for why
// this split matters for unit-testability.

import { resolveStockSnapshots, resolveStockHistory } from '../providers/market/marketProvider.ts'
import type { StockTimeframe, MarketMode } from '../providers/market/types.ts'
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

    data.push({
      ticker,
      companyName: company.shortName ?? company.name,
      sector: company.sector,
      currency: snap?.currency ?? staticSnap?.currency ?? 'CLP',
      latestPrice: safeNumber(snap?.price ?? staticSnap?.price ?? null),
      dayChangePct: safeNumber(snap?.dayChangePct ?? staticSnap?.dayChangePct ?? null),
      marketCapCLP: safeNumber(snap?.marketCapCLP ?? company.marketCapCLP ?? null),
      latestSnapshotDate: snapshotsResp.metadata.latestSnapshotDate ?? null,
      latestSnapshotType: snapshotsResp.metadata.latestSnapshotType ?? null,
      marketDataSource: snap?.source ?? 'Static MVP sample',
      marketDataStatus: snapshotsResp.metadata.status,
      performance: await resolvePerformance(ticker),
      fundamentals: buildFundamentals(staticSnap),
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
