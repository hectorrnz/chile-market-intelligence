// Yahoo-backed macro indicator mapping — PURE, client-safe.
//
// Two US macro indicators exist in neither FRED nor BCCh, so before this map
// they had no live source at all and sat frozen on their static
// macroIndicators.json values (stamped 2025-06-17), with `bitcoin` additionally
// attributed to "CoinMarketCap" — a vendor this project has no relationship
// with. FRED carries no crypto series, and its dollar index (DTWEXBGS) is the
// Fed's BROAD trade-weighted index, a different index from ICE's DXY — showing
// it under a "DXY" label would misattribute the number.
//
// Lives in config/ (not lib/providers/) precisely so client components — the
// Macro page, which must label the popup chart's source correctly — can import
// it without pulling in the server-only provider. The provider
// (lib/providers/yahooMacroProvider.ts) reads this same map.

/** Static macro-indicator id → Yahoo Finance symbol. Both are US-region. */
export const YAHOO_MACRO_SYMBOLS: Record<string, string> = {
  bitcoin: 'BTC-USD',
  // ICE US Dollar Index — the actual DXY, not the Fed's broad trade-weighted index.
  dxy: 'DX-Y.NYB',
}

export function isYahooMacroIndicator(indicatorId: string): boolean {
  return indicatorId in YAHOO_MACRO_SYMBOLS
}
