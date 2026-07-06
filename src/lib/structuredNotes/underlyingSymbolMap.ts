// Phase 9A — Structured-note underlying → Yahoo symbol mapping.
//
// The legacy workbook fetched live levels via Bloomberg `BDP(<ticker>, "LAST
// PRICE")` using Bloomberg-style tickers (e.g. "SPX Index", "RTY Index",
// "SPY US Equity"). The app must NOT use Bloomberg; it maps those tickers to
// Yahoo Finance symbols and reuses the existing yahoo-finance2 provider.
//
// POLICY: only include a mapping once the Yahoo symbol has been confirmed to
// return a quote through the existing live-snapshot path. An unmapped ticker
// yields an `unavailable` price — never a fabricated or guessed number.
//
// Pure module (no runtime imports) — safe to unit-test directly.

import type { AssetClass } from './types.ts'

export interface UnderlyingSymbolEntry {
  /** Normalized Bloomberg-style ticker as it appears on term sheets / the workbook. */
  bloombergTicker: string
  yahooSymbol: string
  assetClass: AssetClass
  displayName: string
  /** Whether the Yahoo symbol has been verified to return a live quote. */
  verified: boolean
  notes: string
}

// Keyed by an uppercased, whitespace-collapsed Bloomberg ticker.
export const UNDERLYING_SYMBOL_MAP: Record<string, UnderlyingSymbolEntry> = {
  'SPX INDEX': {
    bloombergTicker: 'SPX Index',
    yahooSymbol: '^GSPC',
    assetClass: 'index',
    displayName: 'S&P 500 Index',
    verified: true,
    notes: 'S&P 500 price index. Verified via Yahoo (^GSPC).',
  },
  'RTY INDEX': {
    bloombergTicker: 'RTY Index',
    yahooSymbol: '^RUT',
    assetClass: 'index',
    displayName: 'Russell 2000 Index',
    verified: true,
    notes: 'Russell 2000 price index. Verified via Yahoo (^RUT).',
  },
  'NDX INDEX': {
    bloombergTicker: 'NDX Index',
    yahooSymbol: '^NDX',
    assetClass: 'index',
    displayName: 'Nasdaq 100 Index',
    verified: true,
    notes: 'Nasdaq 100 price index. Verified via Yahoo (^NDX).',
  },
  'SX5E INDEX': {
    bloombergTicker: 'SX5E Index',
    yahooSymbol: '^STOXX50E',
    assetClass: 'index',
    displayName: 'EURO STOXX 50 Index',
    verified: false,
    notes: 'EURO STOXX 50. Yahoo ^STOXX50E is the common symbol but has NOT been verified in this app yet — treated as unsupported until confirmed.',
  },
  'SPY US EQUITY': {
    bloombergTicker: 'SPY US Equity',
    yahooSymbol: 'SPY',
    assetClass: 'etf',
    displayName: 'SPDR S&P 500 ETF Trust',
    verified: true,
    notes: 'SPY ETF. Verified via Yahoo (SPY).',
  },
  'IWM US EQUITY': {
    bloombergTicker: 'IWM US Equity',
    yahooSymbol: 'IWM',
    assetClass: 'etf',
    displayName: 'iShares Russell 2000 ETF',
    verified: true,
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

/** Resolves a Bloomberg-style ticker or underlying name to a verified Yahoo symbol entry, or null. */
export function resolveUnderlyingSymbol(raw: string | null | undefined): UnderlyingSymbolEntry | null {
  if (!raw) return null
  const key = normalize(raw)
  if (UNDERLYING_SYMBOL_MAP[key]) return UNDERLYING_SYMBOL_MAP[key]
  const alias = ALIASES[key]
  if (alias && UNDERLYING_SYMBOL_MAP[alias]) return UNDERLYING_SYMBOL_MAP[alias]
  return null
}

/** Whether an underlying ticker/name resolves to a *verified* Yahoo symbol. */
export function isUnderlyingSupported(raw: string | null | undefined): boolean {
  const entry = resolveUnderlyingSymbol(raw)
  return entry !== null && entry.verified
}
