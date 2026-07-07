// Phase 9D — Structured Notes scheduled-monitoring market data wrapper.
//
// Server-only. Built on top of the Phase 9A `fetchYahooPriceMap` (the same
// batched Yahoo Finance call the on-demand dashboard already uses) — this
// module adds the per-symbol success/failure accounting the monitoring cron
// needs to record an honest `partial_success` run rather than an
// all-or-nothing pass/fail.
//
// No Bloomberg, no paid vendor feed — Yahoo Finance (free, unofficial) is the
// only source, and every price returned here is a MONITORING ESTIMATE, never
// an official calculation-agent determination (see monitoring.ts's module doc
// and docs/structured_notes_design.md).

import { fetchYahooPriceMap } from './structuredNoteMarketProvider.ts'

export const MONITORING_PRICE_PROVIDER = 'yahoo-finance'

export interface MonitoringPriceFetchResult {
  /** symbol -> price, only for symbols Yahoo actually returned a finite quote for. */
  prices: Map<string, number>
  asOf: string | null
  provider: string
  requested: string[]
  succeeded: string[]
  failed: string[]
  warnings: string[]
}

/**
 * Fetches current levels for a set of already-resolved Yahoo symbols in one
 * batched call. Never throws — an unreachable provider or a bad symbol
 * simply lands that symbol in `failed`, so one bad underlying never blocks
 * the rest of the book (the caller records `partial_success`, not `failed`,
 * when `succeeded.length > 0`).
 */
export async function fetchMonitoringPrices(symbols: string[]): Promise<MonitoringPriceFetchResult> {
  const requested = [...new Set(symbols.filter((s): s is string => !!s))]
  if (requested.length === 0) {
    return { prices: new Map(), asOf: null, provider: MONITORING_PRICE_PROVIDER, requested: [], succeeded: [], failed: [], warnings: [] }
  }

  const { prices, asOf } = await fetchYahooPriceMap(requested)
  const succeeded = requested.filter((s) => prices.has(s))
  const failed = requested.filter((s) => !prices.has(s))
  const warnings: string[] = []
  if (failed.length > 0) {
    warnings.push(`${failed.length} of ${requested.length} underlying symbol(s) returned no price from ${MONITORING_PRICE_PROVIDER}: ${failed.join(', ')}`)
  }
  if (succeeded.length === 0 && requested.length > 0) {
    warnings.push(`${MONITORING_PRICE_PROVIDER} returned no prices at all this run — every underlying will report unavailable, not a fabricated level.`)
  }

  return { prices, asOf, provider: MONITORING_PRICE_PROVIDER, requested, succeeded, failed, warnings }
}
