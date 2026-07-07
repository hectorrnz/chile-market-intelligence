// Phase 9E — Structured Notes market-data provider abstraction.
//
// Pure type declarations only (no runtime imports) — safe to import anywhere.
// Every structured-note market-data provider (Yahoo today; a second free
// provider or an official/vendor source later) implements the same
// `StructuredNoteMarketDataProvider` interface so the orchestrator
// (`resolveStructuredNoteQuotes.ts`) never needs to change when a provider is
// added, removed, or replaced.
//
// POLICY: every quote this system produces is either a `free_monitoring_estimate`
// or a `proxy` (a substitute instrument standing in for an unavailable exact
// match) — never `official`. There is deliberately no "official" sourceType in
// this phase; adding a true official/calculation-agent feed is future work
// that would extend this union, not repurpose an existing value.

/** How a quote's source should be represented to the user — never claims to be official/calculation-agent data. */
export type StructuredNoteMarketDataSourceType = 'free_monitoring_estimate' | 'proxy' | 'unsupported'

/** Outcome of attempting to fetch one symbol from one provider. */
export type StructuredNoteMarketDataStatus =
  | 'success'
  | 'not_found'
  | 'unsupported'
  | 'stale'
  | 'provider_error'
  | 'validation_error'

export interface StructuredNoteMarketDataRequest {
  /** Provider-specific symbols to fetch (already resolved via underlyingSymbolMap). */
  symbols: string[]
}

export interface StructuredNoteMarketDataQuote {
  /** The symbol as looked up (matches one entry in the request). */
  symbol: string
  /** Same as `symbol` today; kept distinct in case a provider normalizes/rewrites it. */
  requestedSymbol: string
  /** The exact symbol string sent to the provider's API, if different from `symbol`. */
  sourceSymbol: string | null
  price: number | null
  asOf: string | null
  currency: string | null
  provider: string
  sourceType: StructuredNoteMarketDataSourceType
  status: StructuredNoteMarketDataStatus
  stale: boolean
  warning: string | null
  metadata: Record<string, unknown>
}

export interface StructuredNoteMarketDataResult {
  quotes: StructuredNoteMarketDataQuote[]
  provider: string
  requested: string[]
  succeeded: string[]
  failed: string[]
  warnings: string[]
  asOf: string | null
}

export interface StructuredNoteMarketDataProviderStatus {
  providerId: string
  available: boolean
  lastError: string | null
}

export interface StructuredNoteMarketDataError {
  providerId: string
  symbol: string | null
  message: string
}

export interface StructuredNoteMarketDataProvider {
  providerId: string
  providerName: string
  sourceType: StructuredNoteMarketDataSourceType
  /**
   * Whether this provider *could* be asked about a symbol at all — a
   * technical capability check, not an app-level "is this verified" gate
   * (that gate lives in `underlyingSymbolMap.ts` + the orchestrator). Most
   * free quote providers have no published symbol allow-list, so this is
   * typically permissive (non-empty string -> true).
   */
  supportsSymbol(symbol: string): boolean
  fetchQuotes(request: StructuredNoteMarketDataRequest): Promise<StructuredNoteMarketDataResult>
  /** Converts a provider's raw response shape into the common quote shape. Exposed for unit testing without a network call. */
  normalizeQuote(raw: unknown, requestedSymbol: string): StructuredNoteMarketDataQuote
  /** Optional lightweight health check (e.g. "did the last batch call succeed"). */
  getProviderStatus?(): Promise<StructuredNoteMarketDataProviderStatus>
}
