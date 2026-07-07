// Phase 9E — Provider fallback + sanity-check orchestrator.
//
// Given an ordered list of providers (primary first) and a set of requested
// symbols, this queries EVERY registered provider that supports a symbol
// (not only on failure) and resolves one "best" quote per symbol — the
// first provider in list order that succeeded, i.e. the primary always wins
// over a fallback when both return a usable price. Querying every provider
// unconditionally does double duty: it fills gaps the primary missed
// (fallback) AND lets a second provider's price be cross-checked against the
// primary's for disagreement (sanity-check) — see quoteQuality.ts's
// compareProviderQuotes. Every quote is then run through the quote-quality
// rules before being surfaced.
//
// Runs with exactly one registered provider in production today (see
// docs/structured_notes_market_data_sources.md — no secondary free provider
// passed discovery this phase), so this costs exactly one provider call per
// symbol, same as before. The fallback/disagreement logic is fully
// implemented and exercised in tests against mocked second providers, so
// registering a real second provider later requires zero changes here.
//
// No Supabase import — pure orchestration over the provider interface,
// directly unit-testable with mocked providers (no live network calls).

import type {
  StructuredNoteMarketDataProvider,
  StructuredNoteMarketDataQuote,
  StructuredNoteMarketDataResult,
  StructuredNoteMarketDataSourceType,
  StructuredNoteMarketDataStatus,
} from './providers/types.ts'
import {
  classifyQuoteQuality,
  compareProviderQuotes,
  type QuoteQualityResult,
} from './quoteQuality.ts'

export interface ResolveStructuredNoteQuotesOptions {
  /** Provider-specific symbols to resolve (already mapped via underlyingSymbolMap). */
  symbols: string[]
  /** Ordered primary-first list of registered providers. Must have at least one entry. */
  providers: StructuredNoteMarketDataProvider[]
  /** Symbols known ahead of time to have no usable mapping (e.g. an unverified underlying) — never sent to any provider, always resolved as `unsupported`. */
  unsupportedSymbols?: string[]
  /** Calendar date/time used for staleness comparisons — normally "now" at monitoring-run time. */
  referenceDate: string
  /** Use the tighter staleness threshold for a symbol driving a DUE observation rather than a routine dashboard read. */
  isForDueObservation?: boolean
  /** Prior snapshot price per symbol, if available, for large-move detection. */
  previousPrices?: Map<string, number>
  /** Expected currency per symbol (from underlyingSymbolMap), for currency-mismatch detection. */
  expectedCurrencies?: Map<string, string>
}

export interface ResolvedStructuredNoteQuote {
  symbol: string
  price: number | null
  asOf: string | null
  provider: string | null
  sourceType: StructuredNoteMarketDataSourceType | null
  status: StructuredNoteMarketDataStatus
  quality: QuoteQualityResult
  fallbackUsed: boolean
  warning: string | null
}

export interface ProviderResolutionSummary {
  requested: number
  succeeded: number
  failed: number
}

export interface ResolveStructuredNoteQuotesResult {
  quotes: ResolvedStructuredNoteQuote[]
  /** Convenience map of symbol -> price, containing only quotes that passed quality classification as `ok` or `warning` (never a `reject`-level quote). */
  priceMap: Map<string, number>
  providerSummary: Record<string, ProviderResolutionSummary>
  unsupportedSymbols: string[]
  staleSymbols: string[]
  reviewRequiredSymbols: string[]
  fallbackProviderUsed: boolean
  providerDisagreement: boolean
  warnings: string[]
}

export async function resolveStructuredNoteQuotes(options: ResolveStructuredNoteQuotesOptions): Promise<ResolveStructuredNoteQuotesResult> {
  const { referenceDate } = options
  const requestedAll = [...new Set(options.symbols.filter((s) => !!s))]
  // With no provider registered at all, every symbol is unsupported — never silently fabricated.
  const unsupported = new Set(options.providers.length === 0 ? requestedAll : (options.unsupportedSymbols ?? []))
  const providers = options.providers
  const toFetch = requestedAll.filter((s) => !unsupported.has(s))

  const warnings: string[] = []
  if (providers.length === 0 && requestedAll.length > 0) {
    warnings.push('No structured-note market-data provider is registered — every symbol reports unsupported.')
  }
  const providerSummary: Record<string, ProviderResolutionSummary> = {}
  // symbol -> best quote found so far (first provider IN LIST ORDER that returned `success` wins — the primary is always preferred over a fallback when both succeed)
  const bestBySymbol = new Map<string, { quote: StructuredNoteMarketDataQuote; providerIndex: number }>()
  const allQuotesBySymbol = new Map<string, StructuredNoteMarketDataQuote[]>()
  let fallbackProviderUsed = false

  // Every registered provider is queried for every symbol it supports — not
  // "only on failure". This does double duty as (a) fallback: a later
  // provider can fill a gap the primary missed, and (b) a sanity-check: if
  // two providers both succeed on the same symbol, their prices are compared
  // for disagreement (see allQuotesBySymbol below). With exactly one
  // registered provider (production today), this costs nothing extra; it
  // only starts doing real cross-checking once a second provider exists.
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]
    const attemptable = toFetch.filter((s) => provider.supportsSymbol(s))
    if (attemptable.length === 0) continue

    // A provider that throws (rather than resolving its own errors into
    // `provider_error` quotes, as yahooStructuredNoteProvider always does)
    // must never take down the rest of the batch — every well-behaved
    // provider in this app already catches internally, but the orchestrator
    // defends against a future/third-party provider that doesn't.
    let res: StructuredNoteMarketDataResult
    try {
      res = await provider.fetchQuotes({ symbols: attemptable })
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 200) : 'unknown provider error'
      res = {
        quotes: attemptable.map((s) => ({
          symbol: s, requestedSymbol: s, sourceSymbol: null, price: null, asOf: null, currency: null,
          provider: provider.providerId, sourceType: provider.sourceType, status: 'provider_error', stale: false,
          warning: `${provider.providerName} threw an unexpected error`, metadata: {},
        })),
        provider: provider.providerId, requested: attemptable, succeeded: [], failed: attemptable,
        warnings: [`${provider.providerName} threw an unexpected error: ${message}`], asOf: null,
      }
    }
    providerSummary[provider.providerId] = {
      requested: res.requested.length,
      succeeded: res.succeeded.length,
      failed: res.failed.length,
    }
    warnings.push(...res.warnings)

    for (const q of res.quotes) {
      const list = allQuotesBySymbol.get(q.symbol) ?? []
      list.push(q)
      allQuotesBySymbol.set(q.symbol, list)

      const existing = bestBySymbol.get(q.symbol)
      if (q.status === 'success' && (!existing || existing.quote.status !== 'success')) {
        if (i > 0) fallbackProviderUsed = true
        bestBySymbol.set(q.symbol, { quote: q, providerIndex: i })
      } else if (!existing) {
        // keep the first failed attempt for diagnostics until/unless a later provider succeeds
        bestBySymbol.set(q.symbol, { quote: q, providerIndex: i })
      }
    }
  }

  const quotes: ResolvedStructuredNoteQuote[] = []
  const staleSymbols: string[] = []
  const reviewRequiredSymbols: string[] = []
  const priceMap = new Map<string, number>()

  for (const symbol of requestedAll) {
    if (unsupported.has(symbol)) {
      quotes.push({
        symbol,
        price: null,
        asOf: null,
        provider: null,
        sourceType: 'unsupported',
        status: 'unsupported',
        quality: { level: 'reject', reasons: ['unsupported_symbol'] },
        fallbackUsed: false,
        warning: 'Underlying symbol is not verified/supported — see underlyingSymbolMap.ts.',
      })
      continue
    }

    const best = bestBySymbol.get(symbol)
    const providerError = best?.quote.status === 'provider_error'
    const supported = best?.quote.status !== 'unsupported'

    const quality = classifyQuoteQuality({
      price: best?.quote.price ?? null,
      asOf: best?.quote.asOf ?? null,
      referenceDate,
      supported,
      providerError,
      isForDueObservation: options.isForDueObservation,
      previousPrice: options.previousPrices?.get(symbol) ?? null,
      quoteCurrency: best?.quote.currency ?? null,
      expectedCurrency: options.expectedCurrencies?.get(symbol) ?? null,
    })

    if (quality.reasons.includes('stale_price')) staleSymbols.push(symbol)
    if (quality.level !== 'ok') reviewRequiredSymbols.push(symbol)
    if (quality.level !== 'reject' && best?.quote.price !== null && best?.quote.price !== undefined) {
      priceMap.set(symbol, best.quote.price)
    }

    quotes.push({
      symbol,
      price: best?.quote.price ?? null,
      asOf: best?.quote.asOf ?? null,
      provider: best?.quote.provider ?? null,
      sourceType: best?.quote.sourceType ?? null,
      status: best?.quote.status ?? 'not_found',
      quality,
      fallbackUsed: (best?.providerIndex ?? 0) > 0,
      warning: best?.quote.warning ?? null,
    })
  }

  // Cross-provider disagreement is evaluated per symbol across every attempt recorded this run.
  let providerDisagreement = false
  for (const [, list] of allQuotesBySymbol) {
    const comparable = list.filter((q) => q.status === 'success').map((q) => ({ provider: q.provider, price: q.price as number }))
    if (comparable.length > 1) {
      const cmp = compareProviderQuotes(comparable)
      if (cmp.disagreement) providerDisagreement = true
    }
  }

  return {
    quotes,
    priceMap,
    providerSummary,
    unsupportedSymbols: requestedAll.filter((s) => unsupported.has(s)),
    staleSymbols,
    reviewRequiredSymbols,
    fallbackProviderUsed,
    providerDisagreement,
    warnings,
  }
}
