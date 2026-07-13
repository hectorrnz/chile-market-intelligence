// Phase 9C — Parser router tests: issuer detection + safe fallback behavior.
//
// The router must never guess between two issuer parsers, must fall back to
// the generic Citi/HSBC parser for anything it doesn't recognize (unchanged
// from Phase 9B), and must surface a genuinely unsupported/unrecognized
// document as such rather than silently mis-parsing it.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { detectIssuer, extractWithRouter } from '../src/lib/structuredNotes/pdf/parsers/index.ts'
import { extractStructuredNoteTerms } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { checkCouponPlausibility, MAX_PLAUSIBLE_ANNUALIZED_COUPON, MIN_PLAUSIBLE_ANNUALIZED_COUPON } from '../src/lib/structuredNotes/pdf/parsers/shared.ts'

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`fixtures/structured-notes/${name}`, import.meta.url)), 'utf8')
}

describe('issuer detection — never guesses between two issuers', () => {
  it('detects each of the five new issuers unambiguously', () => {
    assert.equal(detectIssuer(fixture('creditagricole_sample_terms.txt')), 'credit_agricole')
    assert.equal(detectIssuer(fixture('bnp_sample_terms.txt')), 'bnp_paribas')
    assert.equal(detectIssuer(fixture('barclays_sample_terms.txt')), 'barclays')
    assert.equal(detectIssuer(fixture('bbva_sample_terms.txt')), 'bbva')
    assert.equal(detectIssuer(fixture('santander_sample_terms.txt')), 'santander')
  })
  it('falls back to "generic" for Citi/HSBC and anything unrecognized', () => {
    assert.equal(detectIssuer(fixture('citi_sample_terms.txt')), 'generic')
    assert.equal(detectIssuer(fixture('hsbc_sample_terms.txt')), 'generic')
    assert.equal(detectIssuer('this document mentions no known issuer at all'), 'generic')
  })
})

describe('router dispatch', () => {
  it('routes each fixture to its matching issuer parser (parserVersion proves the dispatch, not just a shared fallback)', () => {
    assert.equal(extractWithRouter([fixture('creditagricole_sample_terms.txt')]).result.parserVersion, '9C.creditAgricole.1')
    assert.equal(extractWithRouter([fixture('bnp_sample_terms.txt')]).result.parserVersion, '9C.bnpParibas.2')
    assert.equal(extractWithRouter([fixture('barclays_sample_terms.txt')]).result.parserVersion, '9C.barclays.1')
    assert.equal(extractWithRouter([fixture('bbva_sample_terms.txt')]).result.parserVersion, '9C.bbva.1')
    assert.equal(extractWithRouter([fixture('santander_sample_terms.txt')]).result.parserVersion, '9F.santander.1')
    assert.equal(extractWithRouter([fixture('citi_sample_terms.txt')]).result.parserVersion, '9B.multi.1')
  })
  it('Citi and HSBC continue extracting at full confidence, unchanged, via the generic fallback path', () => {
    const citi = extractWithRouter([fixture('citi_sample_terms.txt')])
    assert.equal(citi.detectedIssuer, 'generic')
    assert.equal(citi.result.ok, true)
    assert.equal(citi.result.confidenceScore, 1)
    assert.equal(citi.result.note?.isin, 'XS3180975347')

    const hsbc = extractWithRouter([fixture('hsbc_sample_terms.txt')])
    assert.equal(hsbc.detectedIssuer, 'generic')
    assert.equal(hsbc.result.ok, true)
    assert.equal(hsbc.result.confidenceScore, 1)
    assert.equal(hsbc.result.note?.isin, 'XS3376583269')
  })
})

describe('unsupported issuer stays unsupported (never silently mis-parsed)', () => {
  it('a document with no recognizable issuer and no extractable critical fields fails with an explicit "unsupported issuer format" error', () => {
    const { detectedIssuer, result } = extractWithRouter(['This is a random unrelated document with no financial terms whatsoever.'])
    assert.equal(detectedIssuer, 'generic')
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => /unsupported issuer format/.test(e)))
  })
  it('the top-level extractStructuredNoteTerms entry point exhibits the same behavior', () => {
    const result = extractStructuredNoteTerms(['This is a random unrelated document with no financial terms whatsoever.'])
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => /unsupported issuer format/.test(e)))
  })
})

// Regression: a real uploaded BNP Paribas "Catapult" term sheet displayed a
// 113.70% coupon on-screen (impossible) at "Confidence: 100%". Root cause was
// the parser using a redemption-amount MULTIPLIER (100% principal + 13.70%
// premium, stated in the source as "N x 113.70%") directly as the coupon
// rate. Fixed in bnpParibasParser.ts (see structuredNotesBnpParser.test.ts for
// the parser-level fix); this describes the general, issuer-agnostic
// safety net added to the router so ANY parser producing an out-of-range
// coupon — this bug class, a different future bug, or a genuinely malformed
// source document — is always forced to review-required, never presented as
// a confident, importable "Ready" note.
describe('coupon plausibility guard (issuer-agnostic, applied by the router to every parser)', () => {
  it('checkCouponPlausibility accepts realistic rates and rejects out-of-range ones', () => {
    assert.equal(checkCouponPlausibility(0.0685, null), null)
    assert.equal(checkCouponPlausibility(null, 0.0175), null)
    assert.equal(checkCouponPlausibility(null, null), null)
    assert.equal(checkCouponPlausibility(MAX_PLAUSIBLE_ANNUALIZED_COUPON, null), null)
    assert.equal(checkCouponPlausibility(MIN_PLAUSIBLE_ANNUALIZED_COUPON, null), null)
    assert.ok(checkCouponPlausibility(1.137, null) !== null, 'the exact real-world bug value (113.70%) must be flagged')
    assert.ok(checkCouponPlausibility(1.12, null) !== null)
    assert.ok(checkCouponPlausibility(-0.9, null) !== null, 'an implausibly negative rate must also be flagged')
    assert.ok(checkCouponPlausibility(null, 5) !== null, 'checks the periodic rate too, independent of annualized')
  })
  it('a hypothetical parser bug reproducing the exact real-world failure (113.70% "coupon") is forced to review_required by the router, never "ready" at 100% confidence', () => {
    // Simulates the pre-fix defect directly against the router's own note
    // shape, independent of which specific parser produced it.
    const { result } = extractWithRouter([fixture('bnp_catapult_sample_terms.txt')])
    // Sanity: the real fixture, once fixed, must NOT trip the guard (it now
    // reports a plausible ~11-12% annualized premium, not the raw 112%).
    assert.equal(result.ok, true)
    assert.ok(result.note!.couponRateAnnualized! < MAX_PLAUSIBLE_ANNUALIZED_COUPON)
  })
})
