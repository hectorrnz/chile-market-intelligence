// Phase 9A/9E — Structured-note underlying → market-data provider symbol mapping.
//
// The legacy workbook fetched live levels via Bloomberg `BDP(<ticker>, "LAST
// PRICE")` using Bloomberg-style tickers (e.g. "SPX Index", "RTY Index",
// "SPY US Equity"). The app must NOT use Bloomberg; it maps those tickers to
// free market-data provider symbols (Yahoo Finance today — see
// docs/structured_notes_market_data_sources.md for the Phase 9E discovery
// that found no viable secondary free provider).
//
// POLICY: only include a mapping once a provider symbol has been confirmed to
// return a quote through the existing live-snapshot path. An unmapped ticker
// yields an `unavailable` price — never a fabricated or guessed number. Every
// entry's `sourceType` is `free_monitoring_estimate` or `proxy` — never
// "official"; this app has no calculation-agent or licensed index feed.
//
// Pure module (no runtime imports) — safe to unit-test directly.

import type { AssetClass } from './types.ts'

export type UnderlyingSourceType = 'free_monitoring_estimate' | 'proxy' | 'unsupported'
export type UnderlyingMappingConfidence = 'high' | 'medium' | 'low'

export interface UnderlyingProviderSymbols {
  /** Yahoo Finance symbol (yahoo-finance2 package) — the only active provider as of Phase 9E. */
  yahoo: string
  /** Reserved for a future second free provider. Always null today — see docs/structured_notes_market_data_sources.md (Stooq was investigated and rejected: blocked by a JS proof-of-work challenge, not a stable API). */
  stooq: string | null
}

export interface UnderlyingSymbolEntry {
  /** Normalized Bloomberg-style ticker as it appears on term sheets / the workbook. */
  bloombergTicker: string
  /** Internal canonical code (same as the map key, lower-cased for readability) — stable identifier independent of any one provider's symbol format. */
  normalizedCode: string
  /** @deprecated kept for backward compatibility with existing call sites (`.yahooSymbol`) — equals `providerSymbols.yahoo`. */
  yahooSymbol: string
  providerSymbols: UnderlyingProviderSymbols
  assetClass: AssetClass
  /** ISO 4217 currency the underlying's own level is quoted in (not the note's settlement currency). */
  currency: string
  displayName: string
  /** Whether this mapping has been confirmed to return a live quote. */
  verified: boolean
  /** ISO date the mapping was last confirmed against a live quote, or null if never verified. */
  verifiedAt: string | null
  /** How confident this mapping is: `high` = directly verified; `medium` = a proxy/substitute; `low` = unverified/best-guess. */
  confidence: UnderlyingMappingConfidence
  /** `free_monitoring_estimate` for a direct match, `proxy` for a substitute instrument, `unsupported` if no usable mapping exists. */
  sourceType: UnderlyingSourceType
  notes: string
}

// Keyed by an uppercased, whitespace-collapsed Bloomberg ticker.
export const UNDERLYING_SYMBOL_MAP: Record<string, UnderlyingSymbolEntry> = {
  'SPX INDEX': {
    bloombergTicker: 'SPX Index',
    normalizedCode: 'spx-index',
    yahooSymbol: '^GSPC',
    providerSymbols: { yahoo: '^GSPC', stooq: null },
    assetClass: 'index',
    currency: 'USD',
    displayName: 'S&P 500 Index',
    verified: true,
    verifiedAt: '2026-07-07',
    confidence: 'high',
    sourceType: 'free_monitoring_estimate',
    notes: 'S&P 500 price index. Verified via Yahoo (^GSPC); live in production since Phase 9A, confirmed again in Phase 9D/9E monitoring runs.',
  },
  'RTY INDEX': {
    bloombergTicker: 'RTY Index',
    normalizedCode: 'rty-index',
    yahooSymbol: '^RUT',
    providerSymbols: { yahoo: '^RUT', stooq: null },
    assetClass: 'index',
    currency: 'USD',
    displayName: 'Russell 2000 Index',
    verified: true,
    verifiedAt: '2026-07-07',
    confidence: 'high',
    sourceType: 'free_monitoring_estimate',
    notes: 'Russell 2000 price index. Verified via Yahoo (^RUT); live in production since Phase 9A, confirmed again in Phase 9D/9E monitoring runs.',
  },
  'NDX INDEX': {
    bloombergTicker: 'NDX Index',
    normalizedCode: 'ndx-index',
    yahooSymbol: '^NDX',
    providerSymbols: { yahoo: '^NDX', stooq: null },
    assetClass: 'index',
    currency: 'USD',
    displayName: 'Nasdaq 100 Index',
    verified: true,
    verifiedAt: '2026-07-01',
    confidence: 'high',
    sourceType: 'free_monitoring_estimate',
    notes: 'Nasdaq 100 price index. Verified via Yahoo (^NDX). Not yet used by any real note in the book — kept ready.',
  },
  'SX5E INDEX': {
    bloombergTicker: 'SX5E Index',
    normalizedCode: 'sx5e-index',
    yahooSymbol: '^STOXX50E',
    providerSymbols: { yahoo: '^STOXX50E', stooq: null },
    assetClass: 'index',
    currency: 'EUR',
    displayName: 'EURO STOXX 50 Index',
    verified: false,
    verifiedAt: null,
    confidence: 'low',
    sourceType: 'unsupported',
    notes: 'EURO STOXX 50. Yahoo ^STOXX50E is the commonly-cited symbol but has NOT been confirmed against a live quote in this app (no real note has required it yet) — treated as unsupported until verified.',
  },
  'SPY US EQUITY': {
    bloombergTicker: 'SPY US Equity',
    normalizedCode: 'spy-us-equity',
    yahooSymbol: 'SPY',
    providerSymbols: { yahoo: 'SPY', stooq: null },
    assetClass: 'etf',
    currency: 'USD',
    displayName: 'SPDR S&P 500 ETF Trust',
    verified: true,
    verifiedAt: '2026-07-01',
    confidence: 'high',
    sourceType: 'free_monitoring_estimate',
    notes: 'SPY ETF. Verified via Yahoo (SPY).',
  },
  'IWM US EQUITY': {
    bloombergTicker: 'IWM US Equity',
    normalizedCode: 'iwm-us-equity',
    yahooSymbol: 'IWM',
    providerSymbols: { yahoo: 'IWM', stooq: null },
    assetClass: 'etf',
    currency: 'USD',
    displayName: 'iShares Russell 2000 ETF',
    verified: true,
    verifiedAt: '2026-07-01',
    confidence: 'high',
    sourceType: 'free_monitoring_estimate',
    notes: 'IWM ETF. Verified via Yahoo (IWM).',
  },
}

/**
 * Aliases so a term sheet that names the underlying by its full name or short
 * code still resolves. Values must be a key of UNDERLYING_SYMBOL_MAP.
 */
const ALIASES: Record<string, string> = {
  SPX: 'SPX INDEX',
  'S&P 500': 'SPX INDEX',
  'S&P 500 INDEX': 'SPX INDEX',
  'THE S&P 500 INDEX': 'SPX INDEX',
  RTY: 'RTY INDEX',
  'RUSSELL 2000': 'RTY INDEX',
  'RUSSELL 2000 INDEX': 'RTY INDEX',
  'THE RUSSELL 2000 INDEX': 'RTY INDEX',
  NDX: 'NDX INDEX',
  'NASDAQ 100': 'NDX INDEX',
  SX5E: 'SX5E INDEX',
  'EURO STOXX 50': 'SX5E INDEX',
  SPY: 'SPY US EQUITY',
  IWM: 'IWM US EQUITY',
}

function normalize(raw: string): string {
  return raw
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** Resolves a Bloomberg-style ticker or underlying name to a symbol-mapping entry, or null if there is no mapping at all. */
export function resolveUnderlyingSymbol(raw: string | null | undefined): UnderlyingSymbolEntry | null {
  if (!raw) return null
  const key = normalize(raw)
  if (UNDERLYING_SYMBOL_MAP[key]) return UNDERLYING_SYMBOL_MAP[key]
  const alias = ALIASES[key]
  if (alias && UNDERLYING_SYMBOL_MAP[alias]) return UNDERLYING_SYMBOL_MAP[alias]
  return null
}

/** Whether an underlying ticker/name resolves to a *verified* provider symbol. */
export function isUnderlyingSupported(raw: string | null | undefined): boolean {
  const entry = resolveUnderlyingSymbol(raw)
  return entry !== null && entry.verified
}
