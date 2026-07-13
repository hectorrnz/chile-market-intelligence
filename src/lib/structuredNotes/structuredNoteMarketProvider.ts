// Phase 9A — Structured-note underlying live prices via Yahoo Finance.
//
// Server-only. Replaces the workbook's Bloomberg `BDP` live-price mechanism
// with the same yahoo-finance2 provider already used by the market
// live-snapshot route. Handles missing/unsupported symbols cleanly: every
// underlying gets a price object, but an unmapped or failed symbol reports
// `price: null, source: 'unavailable'` — never a fabricated number.
//
// This module does NOT persist snapshots itself — it mirrors the app's live
// overlay pattern (compute-on-request). A future phase can add persistence to
// structured_note_price_snapshots via the repository.

import YahooFinance from 'yahoo-finance2'
import { resolveUnderlyingSymbol } from './underlyingSymbolMap.ts'
import type { StructuredNoteUnderlying, UnderlyingPrice } from './types.ts'

// yahoo-finance2 v3 requires explicit instantiation (matches live-snapshot route).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] })

const TIMEOUT_MS = 15_000

interface UnderlyingRef {
  underlyingOrder: number
  sourceTicker: string | null
  underlyingName: string
  yahooSymbol: string | null
}

/** Build the Yahoo symbol for an underlying from its stored yahoo_symbol, or by resolving its ticker/name. */
export function yahooSymbolForUnderlying(u: Pick<StructuredNoteUnderlying, 'yahooSymbol' | 'sourceTicker' | 'underlyingName'>): string | null {
  if (u.yahooSymbol) return u.yahooSymbol
  const entry = resolveUnderlyingSymbol(u.sourceTicker) ?? resolveUnderlyingSymbol(u.underlyingName)
  return entry?.yahooSymbol ?? null
}

/** Per-symbol exchange session metadata, used to confirm a quote reflects a genuinely settled close before it drives an automatic decision (see quoteQuality.ts's isMarketSettled). */
export interface YahooMarketMeta {
  marketState: string | null
  regularMarketTime: string | null
}

/** Normalizes yahoo-finance2's `regularMarketTime` (a Date, epoch seconds, or ISO string depending on call shape) into an ISO string. */
function normalizeRegularMarketTime(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'number') {
    // yahoo-finance2's raw (unparsed) shape reports epoch seconds, not milliseconds.
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

/**
 * Fetches current prices for a set of Yahoo symbols in ONE batch call. Used by
 * the dashboard so a whole book of notes costs a single Yahoo request. Returns
 * a map of symbol → price (only symbols that resolved to a finite quote), plus
 * a per-symbol market-session metadata map (marketState/regularMarketTime) so
 * callers that need to confirm a settled close (scheduled monitoring) can do
 * so without a second request. If Yahoo is unreachable the maps are empty and
 * callers report `unavailable`.
 */
export async function fetchYahooPriceMap(symbols: string[]): Promise<{ prices: Map<string, number>; asOf: string | null; marketMeta: Map<string, YahooMarketMeta> }> {
  const unique = [...new Set(symbols.filter((s): s is string => !!s))]
  const prices = new Map<string, number>()
  const marketMeta = new Map<string, YahooMarketMeta>()
  if (unique.length === 0) return { prices, asOf: null, marketMeta }
  try {
    const quotePromise = yf.quote(unique, {}, { validateResult: false })
    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await Promise.race([quotePromise, timeoutPromise])
    const quotes = Array.isArray(raw) ? raw : [raw]
    for (const q of quotes) {
      const sym = q?.symbol as string | undefined
      const px = q?.regularMarketPrice
      if (sym && typeof px === 'number' && Number.isFinite(px)) prices.set(sym, px)
      if (sym) {
        marketMeta.set(sym, {
          marketState: typeof q?.marketState === 'string' ? q.marketState : null,
          regularMarketTime: normalizeRegularMarketTime(q?.regularMarketTime),
        })
      }
    }
    return { prices, asOf: prices.size > 0 ? new Date().toISOString() : null, marketMeta }
  } catch {
    return { prices, asOf: null, marketMeta }
  }
}

/**
 * Fetches current prices for the given underlyings. Always returns one
 * UnderlyingPrice per input (never drops one). Unsupported/failed symbols are
 * marked `unavailable`. If Yahoo is unreachable entirely, every price is
 * `unavailable` — the caller shows "—", never a stale/fake value.
 */
export async function fetchUnderlyingPrices(underlyings: UnderlyingRef[]): Promise<UnderlyingPrice[]> {
  const withSymbols = underlyings.map((u) => ({
    ref: u,
    symbol: u.yahooSymbol ?? resolveUnderlyingSymbol(u.sourceTicker)?.yahooSymbol ?? resolveUnderlyingSymbol(u.underlyingName)?.yahooSymbol ?? null,
  }))

  const symbols = [...new Set(withSymbols.map((x) => x.symbol).filter((s): s is string => !!s))]

  const asOf = new Date().toISOString()
  const priceBySymbol = new Map<string, number>()

  if (symbols.length > 0) {
    try {
      const quotePromise = yf.quote(symbols, {}, { validateResult: false })
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await Promise.race([quotePromise, timeoutPromise])
      const quotes = Array.isArray(raw) ? raw : [raw]
      for (const q of quotes) {
        const sym = q?.symbol as string | undefined
        const px = q?.regularMarketPrice
        if (sym && typeof px === 'number' && Number.isFinite(px)) priceBySymbol.set(sym, px)
      }
    } catch {
      // Yahoo unreachable — leave priceBySymbol empty; everything falls to unavailable.
    }
  }

  return withSymbols.map(({ ref, symbol }): UnderlyingPrice => {
    const price = symbol ? priceBySymbol.get(symbol) ?? null : null
    return {
      underlyingOrder: ref.underlyingOrder,
      yahooSymbol: symbol,
      price: price !== null && Number.isFinite(price) ? price : null,
      source: price !== null ? 'yahoo-finance' : 'unavailable',
      sourceSymbol: symbol,
      asOf: price !== null ? asOf : null,
    }
  })
}
