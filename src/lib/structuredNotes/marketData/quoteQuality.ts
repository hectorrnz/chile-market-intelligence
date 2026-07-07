// Phase 9E — Structured Notes quote-quality rules (pure functions).
//
// A single place to decide whether a free-provider quote is trustworthy
// enough to drive an automatic observation outcome, or whether it must be
// flagged for human review. No network/Supabase imports — directly
// unit-testable under plain `node --test`.
//
// All thresholds are named constants so they can be tuned without touching
// call sites, and are deliberately conservative: this module's job is to
// widen the "flag for review" net, never to make monitoring data look more
// authoritative than it is.

/** A quote older than this many calendar days is stale for a routine dashboard read. */
export const STALE_THRESHOLD_DASHBOARD_DAYS = 3
/** A quote older than this many calendar days is stale for a DUE observation (coupon/autocall/final) — tighter, since a real decision rides on it. */
export const STALE_THRESHOLD_OBSERVATION_DAYS = 1
/** A single-day move larger than this (as a percent) on a major index/ETF underlying is flagged as an unusual-move warning, not auto-rejected. */
export const LARGE_PRICE_MOVE_WARNING_PCT = 15
/** Two providers quoting the same symbol more than this percent apart is flagged as a disagreement warning. */
export const PROVIDER_DISAGREEMENT_WARNING_PCT = 1

export type QuoteQualityLevel = 'ok' | 'warning' | 'reject'

export type QuoteQualityReason =
  | 'missing_price'
  | 'invalid_price'
  | 'stale_price'
  | 'unsupported_symbol'
  | 'provider_error'
  | 'large_price_move_warning'
  | 'currency_mismatch'
  | 'provider_disagreement'

export interface QuoteQualityResult {
  level: QuoteQualityLevel
  reasons: QuoteQualityReason[]
}

/** Whole calendar days between two ISO date/datetime strings (positive if `referenceDate` is after `asOf`). Returns null if either fails to parse. */
function daysBetween(asOf: string, referenceDate: string): number | null {
  const a = Date.parse(asOf)
  const b = Date.parse(referenceDate)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return (b - a) / 86_400_000
}

/** True if a quote's `asOf` is missing, unparsable, or older than `maxAgeDays` relative to `referenceDate`. A missing `asOf` is treated as stale, never as fresh. */
export function isQuoteStale(asOf: string | null | undefined, referenceDate: string, maxAgeDays: number = STALE_THRESHOLD_DASHBOARD_DAYS): boolean {
  if (!asOf) return true
  const age = daysBetween(asOf, referenceDate)
  if (age === null) return true
  return age > maxAgeDays
}

/** True only for a finite, strictly positive price. Zero, negative, NaN, Infinity, and null are all invalid — a real underlying index/ETF level is never zero or negative. */
export function isQuotePriceValid(price: number | null | undefined): boolean {
  return typeof price === 'number' && Number.isFinite(price) && price > 0
}

export interface PriceMoveCheck {
  flagged: boolean
  movePct: number | null
}

/** Flags a day-over-day move larger than `thresholdPct`. Returns `flagged: false, movePct: null` when either price is missing/invalid — an unusual move can't be assessed without both points, so it is never fabricated. */
export function detectLargePriceMove(
  previousPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  thresholdPct: number = LARGE_PRICE_MOVE_WARNING_PCT,
): PriceMoveCheck {
  if (!isQuotePriceValid(previousPrice) || !isQuotePriceValid(currentPrice)) return { flagged: false, movePct: null }
  const movePct = ((currentPrice! - previousPrice!) / previousPrice!) * 100
  return { flagged: Math.abs(movePct) > thresholdPct, movePct }
}

/** True when both currencies are known and differ. Unknown (null) currency on either side is not treated as a mismatch — there is nothing concrete to disagree about. */
export function detectCurrencyMismatch(quoteCurrency: string | null | undefined, expectedCurrency: string | null | undefined): boolean {
  if (!quoteCurrency || !expectedCurrency) return false
  return quoteCurrency.toUpperCase() !== expectedCurrency.toUpperCase()
}

export interface ProviderDisagreementCheck {
  flagged: boolean
  diffPct: number | null
}

/** Compares two providers' prices for the same underlying. Returns `flagged: false, diffPct: null` if either price is missing/invalid. */
export function detectProviderDisagreement(
  priceA: number | null | undefined,
  priceB: number | null | undefined,
  thresholdPct: number = PROVIDER_DISAGREEMENT_WARNING_PCT,
): ProviderDisagreementCheck {
  if (!isQuotePriceValid(priceA) || !isQuotePriceValid(priceB)) return { flagged: false, diffPct: null }
  const diffPct = (Math.abs(priceA! - priceB!) / priceA!) * 100
  return { flagged: diffPct > thresholdPct, diffPct }
}

export interface ClassifyQuoteQualityInput {
  price: number | null | undefined
  asOf: string | null | undefined
  referenceDate: string
  supported: boolean
  providerError: boolean
  /** Use the tighter observation threshold when this quote will drive a due coupon/autocall/final observation. */
  isForDueObservation?: boolean
  previousPrice?: number | null
  quoteCurrency?: string | null
  expectedCurrency?: string | null
}

/**
 * Rolls up every quote-quality check into one level + reason list.
 *   - `reject`: the quote cannot be used at all (missing/invalid price, unsupported symbol, or a provider error).
 *   - `warning`: usable but flagged (stale, large move, currency mismatch) — caller should still mark reviewRequired for a due observation.
 *   - `ok`: no issues detected.
 * This function never decides policy (whether to block an autocall, etc.) — it only classifies; callers (monitoring.ts) decide what to do with the classification.
 */
export function classifyQuoteQuality(input: ClassifyQuoteQualityInput): QuoteQualityResult {
  const reasons: QuoteQualityReason[] = []

  if (!input.supported) reasons.push('unsupported_symbol')
  if (input.providerError) reasons.push('provider_error')
  if (input.price === null || input.price === undefined) reasons.push('missing_price')
  else if (!isQuotePriceValid(input.price)) reasons.push('invalid_price')

  const hasRejectReason = reasons.length > 0
  if (!hasRejectReason) {
    const maxAge = input.isForDueObservation ? STALE_THRESHOLD_OBSERVATION_DAYS : STALE_THRESHOLD_DASHBOARD_DAYS
    if (isQuoteStale(input.asOf, input.referenceDate, maxAge)) reasons.push('stale_price')

    const move = detectLargePriceMove(input.previousPrice ?? null, input.price)
    if (move.flagged) reasons.push('large_price_move_warning')

    if (detectCurrencyMismatch(input.quoteCurrency ?? null, input.expectedCurrency ?? null)) reasons.push('currency_mismatch')
  }

  if (reasons.some((r) => r === 'missing_price' || r === 'invalid_price' || r === 'unsupported_symbol' || r === 'provider_error')) {
    return { level: 'reject', reasons }
  }
  if (reasons.length > 0) return { level: 'warning', reasons }
  return { level: 'ok', reasons: [] }
}

export interface ProviderQuoteForComparison {
  provider: string
  price: number | null
}

export interface ProviderQuoteComparison {
  disagreement: boolean
  maxDiffPct: number | null
  pairs: Array<{ providerA: string; providerB: string; diffPct: number | null; flagged: boolean }>
}

/**
 * Compares every pair of provider quotes for the same underlying (today this
 * runs with at most one registered provider — see
 * docs/structured_notes_market_data_sources.md — so `pairs` is empty and
 * `disagreement` is always false in production until a second provider is
 * registered; the logic is fully implemented and tested against mocked
 * multi-provider input so it activates with zero changes later).
 */
export function compareProviderQuotes(
  quotes: ProviderQuoteForComparison[],
  thresholdPct: number = PROVIDER_DISAGREEMENT_WARNING_PCT,
): ProviderQuoteComparison {
  const pairs: ProviderQuoteComparison['pairs'] = []
  let maxDiffPct: number | null = null

  for (let i = 0; i < quotes.length; i++) {
    for (let j = i + 1; j < quotes.length; j++) {
      const a = quotes[i]
      const b = quotes[j]
      const check = detectProviderDisagreement(a.price, b.price, thresholdPct)
      pairs.push({ providerA: a.provider, providerB: b.provider, diffPct: check.diffPct, flagged: check.flagged })
      if (check.diffPct !== null && (maxDiffPct === null || check.diffPct > maxDiffPct)) maxDiffPct = check.diffPct
    }
  }

  return { disagreement: pairs.some((p) => p.flagged), maxDiffPct, pairs }
}
