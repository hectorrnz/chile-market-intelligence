// Phase 9E — Structured Notes quote-quality rules (pure, no network).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isQuoteStale,
  isQuotePriceValid,
  detectLargePriceMove,
  detectCurrencyMismatch,
  detectProviderDisagreement,
  classifyQuoteQuality,
  compareProviderQuotes,
  isMarketSettled,
  STALE_THRESHOLD_DASHBOARD_DAYS,
  STALE_THRESHOLD_OBSERVATION_DAYS,
  LARGE_PRICE_MOVE_WARNING_PCT,
  PROVIDER_DISAGREEMENT_WARNING_PCT,
  MIN_SETTLE_MINUTES_AFTER_CLOSE,
} from '../src/lib/structuredNotes/marketData/quoteQuality.ts'

describe('isQuoteStale', () => {
  it('treats a missing asOf as stale, never fresh', () => {
    assert.equal(isQuoteStale(null, '2027-01-01'), true)
    assert.equal(isQuoteStale(undefined, '2027-01-01'), true)
  })
  it('is fresh within the default dashboard threshold', () => {
    assert.equal(isQuoteStale('2027-01-01', '2027-01-02'), false)
  })
  it('is stale beyond the default dashboard threshold', () => {
    assert.equal(isQuoteStale('2027-01-01', '2027-01-10'), true)
  })
  it('respects a tighter due-observation threshold', () => {
    assert.equal(isQuoteStale('2027-01-01', '2027-01-03', STALE_THRESHOLD_OBSERVATION_DAYS), true)
    assert.equal(isQuoteStale('2027-01-01', '2027-01-01', STALE_THRESHOLD_OBSERVATION_DAYS), false)
  })
  it('treats an unparsable date as stale', () => {
    assert.equal(isQuoteStale('not-a-date', '2027-01-01'), true)
  })
  it('threshold constants are sane and documented', () => {
    assert.equal(STALE_THRESHOLD_DASHBOARD_DAYS, 3)
    assert.equal(STALE_THRESHOLD_OBSERVATION_DAYS, 1)
    assert.ok(STALE_THRESHOLD_OBSERVATION_DAYS < STALE_THRESHOLD_DASHBOARD_DAYS)
  })
})

describe('isQuotePriceValid', () => {
  it('accepts a finite positive price', () => {
    assert.equal(isQuotePriceValid(100), true)
  })
  it('rejects zero, negative, NaN, Infinity, null, undefined', () => {
    assert.equal(isQuotePriceValid(0), false)
    assert.equal(isQuotePriceValid(-5), false)
    assert.equal(isQuotePriceValid(NaN), false)
    assert.equal(isQuotePriceValid(Infinity), false)
    assert.equal(isQuotePriceValid(null), false)
    assert.equal(isQuotePriceValid(undefined), false)
  })
})

describe('detectLargePriceMove', () => {
  it('flags a move beyond the threshold', () => {
    const r = detectLargePriceMove(100, 120, 15)
    assert.equal(r.flagged, true)
    assert.equal(r.movePct, 20)
  })
  it('does not flag a move within the threshold', () => {
    const r = detectLargePriceMove(100, 105, 15)
    assert.equal(r.flagged, false)
  })
  it('flags a large downward move too (absolute value)', () => {
    const r = detectLargePriceMove(100, 80, 15)
    assert.equal(r.flagged, true)
    assert.equal(r.movePct, -20)
  })
  it('never fabricates a move when either price is missing/invalid', () => {
    assert.deepEqual(detectLargePriceMove(null, 100), { flagged: false, movePct: null })
    assert.deepEqual(detectLargePriceMove(100, null), { flagged: false, movePct: null })
    assert.deepEqual(detectLargePriceMove(100, -5), { flagged: false, movePct: null })
  })
  it('default threshold matches the documented 15% for major indices', () => {
    assert.equal(LARGE_PRICE_MOVE_WARNING_PCT, 15)
  })
})

describe('detectCurrencyMismatch', () => {
  it('flags a real mismatch', () => {
    assert.equal(detectCurrencyMismatch('EUR', 'USD'), true)
  })
  it('is case-insensitive', () => {
    assert.equal(detectCurrencyMismatch('usd', 'USD'), false)
  })
  it('does not flag when either currency is unknown', () => {
    assert.equal(detectCurrencyMismatch(null, 'USD'), false)
    assert.equal(detectCurrencyMismatch('USD', null), false)
  })
})

describe('detectProviderDisagreement', () => {
  it('flags a disagreement beyond the threshold', () => {
    const r = detectProviderDisagreement(100, 102, PROVIDER_DISAGREEMENT_WARNING_PCT)
    assert.equal(r.flagged, true)
  })
  it('does not flag agreement within the threshold', () => {
    const r = detectProviderDisagreement(100, 100.5, PROVIDER_DISAGREEMENT_WARNING_PCT)
    assert.equal(r.flagged, false)
  })
  it('never fabricates a diff when either price is missing/invalid', () => {
    assert.deepEqual(detectProviderDisagreement(null, 100), { flagged: false, diffPct: null })
  })
})

describe('classifyQuoteQuality', () => {
  const referenceDate = '2027-01-01'
  it('rejects a missing price', () => {
    const r = classifyQuoteQuality({ price: null, asOf: null, referenceDate, supported: true, providerError: false })
    assert.equal(r.level, 'reject')
    assert.ok(r.reasons.includes('missing_price'))
  })
  it('rejects an unsupported symbol even if a price happens to be present', () => {
    const r = classifyQuoteQuality({ price: 100, asOf: referenceDate, referenceDate, supported: false, providerError: false })
    assert.equal(r.level, 'reject')
    assert.ok(r.reasons.includes('unsupported_symbol'))
  })
  it('rejects on a provider error', () => {
    const r = classifyQuoteQuality({ price: null, asOf: null, referenceDate, supported: true, providerError: true })
    assert.equal(r.level, 'reject')
    assert.ok(r.reasons.includes('provider_error'))
  })
  it('rejects an invalid (non-positive) price', () => {
    const r = classifyQuoteQuality({ price: -1, asOf: referenceDate, referenceDate, supported: true, providerError: false })
    assert.equal(r.level, 'reject')
    assert.ok(r.reasons.includes('invalid_price'))
  })
  it('warns (not rejects) on a stale but otherwise valid quote', () => {
    const r = classifyQuoteQuality({ price: 100, asOf: '2026-12-01', referenceDate, supported: true, providerError: false })
    assert.equal(r.level, 'warning')
    assert.ok(r.reasons.includes('stale_price'))
  })
  it('warns on a large price move', () => {
    const r = classifyQuoteQuality({ price: 130, asOf: referenceDate, referenceDate, supported: true, providerError: false, previousPrice: 100 })
    assert.equal(r.level, 'warning')
    assert.ok(r.reasons.includes('large_price_move_warning'))
  })
  it('warns on a currency mismatch', () => {
    const r = classifyQuoteQuality({ price: 100, asOf: referenceDate, referenceDate, supported: true, providerError: false, quoteCurrency: 'EUR', expectedCurrency: 'USD' })
    assert.equal(r.level, 'warning')
    assert.ok(r.reasons.includes('currency_mismatch'))
  })
  it('is ok with no issues', () => {
    const r = classifyQuoteQuality({ price: 100, asOf: referenceDate, referenceDate, supported: true, providerError: false })
    assert.equal(r.level, 'ok')
    assert.deepEqual(r.reasons, [])
  })
  it('uses the tighter observation threshold when isForDueObservation is true', () => {
    const asOf = '2026-12-30' // 2 days before referenceDate
    const dashboard = classifyQuoteQuality({ price: 100, asOf, referenceDate, supported: true, providerError: false })
    const observation = classifyQuoteQuality({ price: 100, asOf, referenceDate, supported: true, providerError: false, isForDueObservation: true })
    assert.equal(dashboard.level, 'ok') // within 3-day dashboard threshold
    assert.equal(observation.level, 'warning') // beyond the 1-day observation threshold
  })
})

describe('isMarketSettled', () => {
  const referenceDate = '2027-01-01T21:30:00.000Z'
  it('treats no signal at all as settled (no false positives from missing data)', () => {
    assert.equal(isMarketSettled(null, null, referenceDate), true)
    assert.equal(isMarketSettled(undefined, undefined, referenceDate), true)
  })
  it('is not settled while the market state is still live', () => {
    assert.equal(isMarketSettled('REGULAR', null, referenceDate), false)
    assert.equal(isMarketSettled('PRE', null, referenceDate), false)
    assert.equal(isMarketSettled('POST', null, referenceDate), false)
  })
  it('trusts an explicit CLOSED state with no timestamp to check against', () => {
    assert.equal(isMarketSettled('CLOSED', null, referenceDate), true)
  })
  it('is not settled when CLOSED but the close print is too recent', () => {
    const closeTime = '2027-01-01T21:15:00.000Z' // 15 minutes before referenceDate
    assert.equal(isMarketSettled('CLOSED', closeTime, referenceDate), false)
  })
  it('is settled when CLOSED and the close print is old enough', () => {
    const closeTime = '2027-01-01T21:00:00.000Z' // 30 minutes before referenceDate
    assert.equal(isMarketSettled('CLOSED', closeTime, referenceDate), true)
  })
  it('respects a custom settle-buffer', () => {
    const closeTime = '2027-01-01T21:20:00.000Z' // 10 minutes before referenceDate
    assert.equal(isMarketSettled('CLOSED', closeTime, referenceDate, 5), true)
    assert.equal(isMarketSettled('CLOSED', closeTime, referenceDate, 15), false)
  })
  it('never rejects on an unparsable timestamp', () => {
    assert.equal(isMarketSettled('CLOSED', 'not-a-date', referenceDate), true)
  })
  it('default buffer matches the documented 30 minutes', () => {
    assert.equal(MIN_SETTLE_MINUTES_AFTER_CLOSE, 30)
  })
})

describe('classifyQuoteQuality — market settlement (due observations only)', () => {
  const referenceDate = '2027-01-01T21:30:00.000Z'
  it('does not check settlement for a routine (non-due-observation) read', () => {
    const r = classifyQuoteQuality({ price: 100, asOf: referenceDate, referenceDate, supported: true, providerError: false, marketState: 'REGULAR' })
    assert.equal(r.level, 'ok')
    assert.ok(!r.reasons.includes('market_not_settled'))
  })
  it('warns (not rejects) a due-observation quote taken while the market is still live', () => {
    const r = classifyQuoteQuality({ price: 100, asOf: referenceDate, referenceDate, supported: true, providerError: false, isForDueObservation: true, marketState: 'REGULAR' })
    assert.equal(r.level, 'warning')
    assert.ok(r.reasons.includes('market_not_settled'))
  })
  it('warns a due-observation quote whose close print is too fresh', () => {
    const closeTime = '2027-01-01T21:20:00.000Z' // 10 min before referenceDate
    const r = classifyQuoteQuality({ price: 100, asOf: referenceDate, referenceDate, supported: true, providerError: false, isForDueObservation: true, marketState: 'CLOSED', regularMarketTime: closeTime })
    assert.ok(r.reasons.includes('market_not_settled'))
  })
  it('is ok for a due-observation quote confirmed CLOSED and settled', () => {
    const closeTime = '2027-01-01T21:00:00.000Z' // 30 min before referenceDate
    const r = classifyQuoteQuality({ price: 100, asOf: referenceDate, referenceDate, supported: true, providerError: false, isForDueObservation: true, marketState: 'CLOSED', regularMarketTime: closeTime })
    assert.equal(r.level, 'ok')
    assert.ok(!r.reasons.includes('market_not_settled'))
  })
})

describe('compareProviderQuotes', () => {
  it('reports no disagreement with a single provider quote', () => {
    const r = compareProviderQuotes([{ provider: 'yahoo-finance', price: 100 }])
    assert.equal(r.disagreement, false)
    assert.deepEqual(r.pairs, [])
  })
  it('flags disagreement between two providers beyond the threshold', () => {
    const r = compareProviderQuotes([{ provider: 'yahoo-finance', price: 100 }, { provider: 'mock-secondary', price: 105 }])
    assert.equal(r.disagreement, true)
    assert.equal(r.pairs.length, 1)
    assert.ok(r.maxDiffPct !== null && r.maxDiffPct > 1)
  })
  it('does not flag agreement between two providers', () => {
    const r = compareProviderQuotes([{ provider: 'yahoo-finance', price: 100 }, { provider: 'mock-secondary', price: 100.2 }])
    assert.equal(r.disagreement, false)
  })
  it('never fabricates a comparison when a provider price is missing', () => {
    const r = compareProviderQuotes([{ provider: 'yahoo-finance', price: null }, { provider: 'mock-secondary', price: 100 }])
    assert.equal(r.disagreement, false)
    assert.equal(r.pairs[0].diffPct, null)
  })
})
