// Phase 4C — Brain Data / Bolsa de Santiago market provider.
//
// SERVER-ONLY. This is a SHELL implementation — it returns ok:false with a clear
// reason until Phase 4C.1 completes:
//   1. Official Brain Data OpenAPI spec obtained.
//   2. Authentication method confirmed (API key vs OAuth2).
//   3. Endpoint paths confirmed against the securities master.
//   4. providerSymbol values confirmed in tickerMap.ts.
//
// Do NOT add real endpoint calls here until the above steps are done. The shell
// ensures the app architecture is in place and the static fallback is wired up,
// without any unauthenticated or guessed requests to Brain Data servers.

import type { MarketProvider, StockSnapshot, StockHistoryPoint, IndexSnapshot, SectorSnapshot, StockTimeframe } from './types.ts'
import type { ProviderResult } from '../types.ts'
import { isBrainDataConfigured } from '../../../config/marketDataProviders.ts'

const NOT_CONFIGURED = 'Brain Data credentials not configured'
const NOT_IMPLEMENTED = 'Brain Data endpoint mapping pending official API confirmation (Phase 4C.1)'

function unavailable<T>(reason: string): ProviderResult<T> {
  return { ok: false, reason }
}

export const brainDataProvider: MarketProvider = {
  name: 'brain-data',

  async getStockSnapshots(): Promise<ProviderResult<StockSnapshot[]>> {
    if (!isBrainDataConfigured()) return unavailable(NOT_CONFIGURED)
    // TODO (Phase 4C.1): confirm endpoint path from official Brain Data OpenAPI spec.
    // Then implement: fetch(`${base}/v?/prices/last?symbols=...`)
    return unavailable(NOT_IMPLEMENTED)
  },

  async getStockSnapshot(ticker: string): Promise<ProviderResult<StockSnapshot | null>> {
    void ticker
    if (!isBrainDataConfigured()) return unavailable(NOT_CONFIGURED)
    // TODO (Phase 4C.1): confirm single-ticker snapshot endpoint.
    return unavailable(NOT_IMPLEMENTED)
  },

  async getStockHistory(ticker: string, timeframe: StockTimeframe): Promise<ProviderResult<StockHistoryPoint[]>> {
    void ticker; void timeframe
    if (!isBrainDataConfigured()) return unavailable(NOT_CONFIGURED)
    // TODO (Phase 4C.1): confirm historical prices endpoint and date/frequency params.
    return unavailable(NOT_IMPLEMENTED)
  },

  async getIndices(): Promise<ProviderResult<IndexSnapshot[]>> {
    if (!isBrainDataConfigured()) return unavailable(NOT_CONFIGURED)
    // TODO (Phase 4C.1): confirm indices endpoint. IPSA is the primary Chilean index.
    return unavailable(NOT_IMPLEMENTED)
  },

  async getSectors(): Promise<ProviderResult<SectorSnapshot[]>> {
    if (!isBrainDataConfigured()) return unavailable(NOT_CONFIGURED)
    // TODO (Phase 4C.1): confirm whether Brain Data publishes sector aggregates or
    // whether they must be computed from constituent stock data.
    return unavailable(NOT_IMPLEMENTED)
  },
}
