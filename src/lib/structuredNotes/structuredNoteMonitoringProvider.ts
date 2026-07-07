// Phase 9D/9E — Structured Notes scheduled-monitoring market data wrapper.
//
// Server-only. Built on the Phase 9E provider-abstraction + fallback
// orchestrator (`marketData/resolveStructuredNoteQuotes.ts`), registered with
// Yahoo Finance as the sole active provider (see
// docs/structured_notes_market_data_sources.md — no secondary free provider
// passed discovery this phase). The orchestrator's fallback/disagreement
// logic runs unchanged and will activate automatically if a second provider
// is ever registered here.
//
// No Bloomberg, no paid vendor feed — every price returned here is a
// MONITORING ESTIMATE, never an official calculation-agent determination
// (see monitoring.ts's module doc and docs/structured_notes_design.md).

import { resolveStructuredNoteQuotes } from './marketData/resolveStructuredNoteQuotes.ts'
import { yahooStructuredNoteProvider } from './marketData/providers/yahooStructuredNoteProvider.ts'
import type { QuoteMetaEntry } from './monitoring.ts'

export const MONITORING_PRICE_PROVIDER = 'yahoo-finance'

export interface MonitoringPriceFetchResult {
  /** symbol -> price, only for symbols that resolved to a usable (non-reject) quote. */
  prices: Map<string, number>
  asOf: string | null
  provider: string
  requested: string[]
  succeeded: string[]
  failed: string[]
  warnings: string[]
  /** Per-symbol quote metadata (as-of, provider error, quality reasons) ready to pass straight into monitoring.ts's evaluate*Observation functions. */
  quoteMeta: Map<string, QuoteMetaEntry>
  providerSummary: Record<string, { requested: number; succeeded: number; failed: number }>
  unsupportedSymbols: string[]
  staleSymbols: string[]
  reviewRequiredSymbols: string[]
  fallbackProviderUsed: boolean
  providerDisagreement: boolean
}

/**
 * Fetches current levels for a set of already-resolved provider symbols in
 * one batched call, then runs every quote through the Phase 9E quote-quality
 * rules. Never throws — an unreachable provider or a bad symbol simply lands
 * that symbol in `failed`/`unsupportedSymbols`, so one bad underlying never
 * blocks the rest of the book.
 */
export async function fetchMonitoringPrices(symbols: string[]): Promise<MonitoringPriceFetchResult> {
  const requested = [...new Set(symbols.filter((s): s is string => !!s))]
  if (requested.length === 0) {
    return {
      prices: new Map(), asOf: null, provider: MONITORING_PRICE_PROVIDER, requested: [], succeeded: [], failed: [], warnings: [],
      quoteMeta: new Map(), providerSummary: {}, unsupportedSymbols: [], staleSymbols: [], reviewRequiredSymbols: [],
      fallbackProviderUsed: false, providerDisagreement: false,
    }
  }

  const referenceDate = new Date().toISOString()
  const result = await resolveStructuredNoteQuotes({
    symbols: requested,
    providers: [yahooStructuredNoteProvider],
    referenceDate,
  })

  const succeeded = result.quotes.filter((q) => q.status === 'success' && q.quality.level !== 'reject').map((q) => q.symbol)
  const failed = requested.filter((s) => !succeeded.includes(s))
  const asOf = result.quotes.find((q) => q.asOf)?.asOf ?? (succeeded.length > 0 ? referenceDate : null)

  const quoteMeta = new Map<string, QuoteMetaEntry>()
  for (const q of result.quotes) {
    quoteMeta.set(q.symbol, {
      asOf: q.asOf,
      supported: q.status !== 'unsupported',
      providerError: q.status === 'provider_error',
      qualityReasons: q.quality.reasons,
    })
  }

  const warnings = [...result.warnings]
  if (failed.length > 0) {
    warnings.push(`${failed.length} of ${requested.length} underlying symbol(s) returned no usable price from ${MONITORING_PRICE_PROVIDER}: ${failed.join(', ')}`)
  }
  if (succeeded.length === 0 && requested.length > 0) {
    warnings.push(`${MONITORING_PRICE_PROVIDER} returned no usable prices at all this run — every underlying will report unavailable, not a fabricated level.`)
  }

  return {
    prices: result.priceMap,
    asOf,
    provider: MONITORING_PRICE_PROVIDER,
    requested,
    succeeded,
    failed,
    warnings,
    quoteMeta,
    providerSummary: result.providerSummary,
    unsupportedSymbols: result.unsupportedSymbols,
    staleSymbols: result.staleSymbols,
    reviewRequiredSymbols: result.reviewRequiredSymbols,
    fallbackProviderUsed: result.fallbackProviderUsed,
    providerDisagreement: result.providerDisagreement,
  }
}
