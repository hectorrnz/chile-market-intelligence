// Phase 9E — Yahoo Finance provider, refactored into the StructuredNoteMarketDataProvider interface.
//
// Server-only. Reuses `fetchYahooPriceMap` (Phase 9A/9D, already proven in production) rather than
// re-instantiating the yahoo-finance2 client — this file only reshapes that existing, working call into
// the new common quote shape. External behavior is unchanged: same batched request, same per-symbol
// success/failure handling, same never-fabricate-a-price guarantee.
//
// Every quote from this provider is labeled `free_monitoring_estimate` — Yahoo's unofficial endpoint is
// never represented as an official calculation-agent determination.

import { fetchYahooPriceMap } from '../../structuredNoteMarketProvider.ts'
import type {
  StructuredNoteMarketDataProvider,
  StructuredNoteMarketDataProviderStatus,
  StructuredNoteMarketDataQuote,
  StructuredNoteMarketDataRequest,
  StructuredNoteMarketDataResult,
  StructuredNoteMarketDataStatus,
} from './types.ts'

export const YAHOO_PROVIDER_ID = 'yahoo-finance'
export const YAHOO_PROVIDER_NAME = 'Yahoo Finance'

interface RawYahooQuote {
  symbol: string
  price: number | null
  asOf: string | null
}

function buildQuote(raw: RawYahooQuote, requestedSymbol: string, status: StructuredNoteMarketDataStatus, warning: string | null = null): StructuredNoteMarketDataQuote {
  const priceOk = raw.price !== null && Number.isFinite(raw.price)
  return {
    symbol: requestedSymbol,
    requestedSymbol,
    sourceSymbol: raw.symbol,
    price: priceOk ? raw.price : null,
    asOf: priceOk ? raw.asOf : null,
    // The batched yahoo-finance2 quote() call used here does not request a
    // currency field; left null rather than guessed. A future enhancement
    // could request `.currency` from the quote response if a note ever needs
    // cross-currency validation.
    currency: null,
    provider: YAHOO_PROVIDER_ID,
    sourceType: 'free_monitoring_estimate',
    status,
    stale: false, // staleness is computed relative to evaluation time by quoteQuality.ts, not by the provider itself
    warning,
    metadata: {},
  }
}

let lastProviderError: string | null = null

export const yahooStructuredNoteProvider: StructuredNoteMarketDataProvider = {
  providerId: YAHOO_PROVIDER_ID,
  providerName: YAHOO_PROVIDER_NAME,
  sourceType: 'free_monitoring_estimate',

  // Yahoo's unofficial quote endpoint has no published symbol allow-list —
  // whether a symbol is actually verified/supported by THIS app is decided
  // by underlyingSymbolMap.ts, not the provider itself.
  supportsSymbol(symbol: string): boolean {
    return typeof symbol === 'string' && symbol.trim().length > 0
  },

  normalizeQuote(raw: unknown, requestedSymbol: string): StructuredNoteMarketDataQuote {
    const r = raw as Partial<RawYahooQuote> | null | undefined
    const price = typeof r?.price === 'number' && Number.isFinite(r.price) ? r.price : null
    return buildQuote({ symbol: r?.symbol ?? requestedSymbol, price, asOf: r?.asOf ?? null }, requestedSymbol, price !== null ? 'success' : 'not_found')
  },

  async fetchQuotes(request: StructuredNoteMarketDataRequest): Promise<StructuredNoteMarketDataResult> {
    const unique = [...new Set(request.symbols.filter((s): s is string => !!s))]
    if (unique.length === 0) {
      return { quotes: [], provider: YAHOO_PROVIDER_ID, requested: [], succeeded: [], failed: [], warnings: [], asOf: null }
    }

    try {
      const { prices, asOf } = await fetchYahooPriceMap(unique)
      lastProviderError = null
      const quotes = unique.map((sym) => {
        const price = prices.has(sym) ? prices.get(sym)! : null
        return buildQuote({ symbol: sym, price, asOf: price !== null ? asOf : null }, sym, price !== null ? 'success' : 'not_found')
      })
      const succeeded = quotes.filter((q) => q.status === 'success').map((q) => q.symbol)
      const failed = quotes.filter((q) => q.status !== 'success').map((q) => q.symbol)
      const warnings = failed.length > 0
        ? [`${YAHOO_PROVIDER_NAME}: ${failed.length} of ${unique.length} symbol(s) returned no price: ${failed.join(', ')}`]
        : []
      return { quotes, provider: YAHOO_PROVIDER_ID, requested: unique, succeeded, failed, warnings, asOf }
    } catch (e) {
      lastProviderError = e instanceof Error ? e.message.slice(0, 200) : 'unknown provider error'
      const quotes = unique.map((sym) => buildQuote({ symbol: sym, price: null, asOf: null }, sym, 'provider_error', `${YAHOO_PROVIDER_NAME} request failed`))
      return {
        quotes, provider: YAHOO_PROVIDER_ID, requested: unique, succeeded: [], failed: unique,
        warnings: [`${YAHOO_PROVIDER_NAME} request failed — every symbol reports unavailable, never a fabricated price`],
        asOf: null,
      }
    }
  },

  async getProviderStatus(): Promise<StructuredNoteMarketDataProviderStatus> {
    return { providerId: YAHOO_PROVIDER_ID, available: lastProviderError === null, lastError: lastProviderError }
  },
}
