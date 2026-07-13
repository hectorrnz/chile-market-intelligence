// Phase 9C — BNP Paribas parser tests (ordinal dates, compressed-table underlyings).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractStructuredNoteTerms, parseTermSheetDate } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { detectIssuer } from '../src/lib/structuredNotes/pdf/parsers/index.ts'
import { yearsBetweenIsoDates } from '../src/lib/structuredNotes/pdf/parsers/shared.ts'

const FIXTURE = fileURLToPath(new URL('fixtures/structured-notes/bnp_sample_terms.txt', import.meta.url))
const text = readFileSync(FIXTURE, 'utf8')
const result = extractStructuredNoteTerms([text], { fileName: 'bnp_sample_terms.txt' })
const n = result.note!

describe('BNP Paribas — issuer detection', () => {
  it('detects bnp_paribas from the joined text', () => {
    assert.equal(detectIssuer(text), 'bnp_paribas')
  })
})

describe('BNP Paribas — ordinal date parsing', () => {
  it('strips the ordinal suffix so "April 09th, 2025" parses like "April 9, 2025"', () => {
    assert.equal(parseTermSheetDate('April 09th, 2025'), '2025-04-09')
    assert.equal(parseTermSheetDate('January 1st, 2026'), '2026-01-01')
    assert.equal(parseTermSheetDate('July 22nd, 2027'), '2027-07-22')
    assert.equal(parseTermSheetDate('July 23rd, 2027'), '2027-07-23')
  })
  it('still parses non-ordinal formats unaffected (regression)', () => {
    assert.equal(parseTermSheetDate('June 4, 2026'), '2026-06-04')
    assert.equal(parseTermSheetDate('03/06/2026'), '2026-06-03')
  })
})

describe('BNP Paribas — critical fields', () => {
  it('extracts successfully with full confidence', () => {
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
    assert.equal(result.confidenceScore, 1)
    assert.equal(result.parserVersion, '9C.bnpParibas.2')
  })
  it('extracts ISIN (colon form: "ISIN: XS...")', () => assert.equal(n.isin, 'XS9999999992'))
  it('extracts issuer + display name + guarantor', () => {
    assert.match(n.issuerName ?? '', /BNP Paribas Issuance B\.V\./)
    assert.equal(n.issuerDisplayName, 'BNP Paribas')
    assert.match(n.guarantorName ?? '', /BNP Paribas/)
  })
  it('extracts ordinal trade/issue/final/maturity dates', () => {
    assert.equal(n.tradeDate, '2026-01-05')
    assert.equal(n.issueDate, '2026-01-12')
    assert.equal(n.finalValuationDate, '2027-07-05')
    assert.equal(n.maturityDate, '2027-07-15')
  })
  it('disambiguates "Redemption Valuation Date" (final) from "Redemption Date" (maturity) despite both wrapping mid-label in real documents', () => {
    assert.notEqual(n.finalValuationDate, n.maturityDate)
  })
  it('extracts denomination from "1 Certificate = USD 1,000" and issue amount', () => {
    assert.equal(n.issueSize, 1000000)
    assert.equal(n.denomination, 1000)
    assert.equal(n.currency, 'USD')
  })
  it('extracts coupon from "N x 3.00% x (1 + T)"', () => {
    assert.equal(n.couponRatePeriodic, 0.03)
    assert.equal(n.couponRateAnnualized, 0.12)
  })
})

describe('BNP Paribas — barriers (single 65% threshold serves both coupon and knock-in)', () => {
  it('extracts knock-in 65% and autocall 100% from the note-level clauses', () => {
    assert.equal(n.knockInBarrierPct, 0.65)
    assert.equal(n.autocallBarrierPct, 1)
    assert.equal(n.couponBarrierPct, 0.65)
  })
})

describe('BNP Paribas — underlyings (clean table row with absolute levels)', () => {
  it('extracts both underlyings with initial/knock-in/autocall/coupon-barrier levels directly from the table (no percentage computation needed)', () => {
    assert.equal(n.underlyings.length, 2)
    const rty = n.underlyings.find((u) => u.underlyingName === 'RTY Index')!
    assert.equal(rty.initialLevel, 2400)
    assert.equal(rty.knockInBarrierLevel, 1560)
    assert.equal(rty.autocallBarrierLevel, 2400)
    assert.equal(rty.yahooSymbol, '^RUT')
    const spx = n.underlyings.find((u) => u.underlyingName === 'SPX Index')!
    assert.equal(spx.initialLevel, 6000)
    assert.equal(spx.yahooSymbol, '^GSPC')
  })
})

describe('BNP Paribas — schedule (ordinal-date rows)', () => {
  it('extracts one observation per valuation date plus a final observation', () => {
    assert.ok(n.observations.length >= 5)
    assert.equal(n.observations.filter((o) => o.observationType === 'final').length, 1)
    const dates = n.observations.map((o) => o.valuationDate)
    assert.equal(new Set(dates).size, dates.length)
  })
})

describe('BNP Paribas — hygiene', () => {
  it('produces no NaN/Infinity', () => {
    for (const v of [n.issueSize, n.couponRatePeriodic, n.knockInBarrierPct]) {
      assert.ok(v === null || Number.isFinite(v))
    }
  })
  it('returns review-required (not a crash, not a mis-parse) on an unrelated random document', () => {
    const bad = extractStructuredNoteTerms(['just some random text with no terms at all'])
    assert.equal(bad.ok, false)
    assert.ok(bad.errors.length > 0)
  })
})

// A second, structurally different BNP template — the zero-coupon
// "Autocallable Certificate Plus"/Catapult family — was found (real upload)
// to fail extraction under the original Phoenix Snowball-tuned regexes: no
// periodic coupon, a single-underlying row with the ticker inline in
// "(Bloomberg: XXX)" and barrier percentages inline in parens, plus a
// prose-only (not tabular) early-redemption date. Never crashed — surfaced as
// review-required, per the parser's safety design — but should now extract
// cleanly rather than requiring manual entry.
describe('BNP Paribas — Catapult/Certificate Plus template (zero-coupon, single underlying)', () => {
  const FIXTURE2 = fileURLToPath(new URL('fixtures/structured-notes/bnp_catapult_sample_terms.txt', import.meta.url))
  const text2 = readFileSync(FIXTURE2, 'utf8')
  const result2 = extractStructuredNoteTerms([text2], { fileName: 'bnp_catapult_sample_terms.txt' })
  const n2 = result2.note!

  it('detects bnp_paribas', () => {
    assert.equal(detectIssuer(text2), 'bnp_paribas')
  })

  it('extracts successfully with full confidence (previously flagged review-required)', () => {
    assert.equal(result2.ok, true)
    assert.deepEqual(result2.errors, [])
    assert.equal(result2.confidenceScore, 1)
  })

  it('extracts the single-underlying inline "(Bloomberg: XXX)" row with strike/kick-out levels', () => {
    assert.equal(n2.underlyings.length, 1)
    const u = n2.underlyings[0]
    assert.equal(u.initialLevel, 4800)
    assert.equal(u.strikeLevel, 4800)
    assert.equal(u.knockInBarrierLevel, 2880)
    assert.equal(u.yahooSymbol, '^GSPC')
  })

  it('treats the inline Kick-out Level as the note-level knock-in/coupon barrier (65%-style role)', () => {
    assert.equal(n2.knockInBarrierPct, 0.6)
    assert.equal(n2.couponBarrierPct, 0.6)
    assert.equal(n2.autocallBarrierPct, 1)
  })

  it('has no periodic coupon — reports the true annualized premium (multiplier minus the bundled 100% principal, annualized to the autocall date), never the raw redemption multiplier', () => {
    assert.equal(n2.couponRatePeriodic, null)
    // Regression for a real bug: "N x 112.00%" bundles 100% principal + 12%
    // premium — the old parser used 112% directly as the coupon (an
    // impossible >100% p.a. "coupon"), caught via a real uploaded document
    // that showed a 113.70% coupon on-screen. The premium is 12%, annualized
    // over trade date (2025-01-04) -> autocall observation (2026-01-06).
    const expectedYears = yearsBetweenIsoDates('2025-01-04', '2026-01-06')!
    const expected = 0.12 / expectedYears
    assert.ok(Math.abs(n2.couponRateAnnualized! - expected) < 1e-9)
    assert.ok(n2.couponRateAnnualized! > 0.1 && n2.couponRateAnnualized! < 0.15, 'annualized premium must be a plausible single-digit-to-teens rate, never >100%')
  })

  it('extracts the prose-only autocall observation date plus the final maturity observation (not silently dropped)', () => {
    assert.equal(n2.observations.length, 2)
    assert.equal(n2.observations[0].observationType, 'autocall')
    assert.equal(n2.observations[0].valuationDate, '2026-01-06')
    assert.equal(n2.observations[0].paymentDate, '2026-01-13')
    assert.equal(n2.observations[1].observationType, 'final')
    assert.equal(n2.observations[1].valuationDate, '2027-01-05')
  })

  it('does not regress the original Phoenix Snowball fixture (still confidence 1, still parserVersion 9C.bnpParibas.2)', () => {
    assert.equal(result.ok, true)
    assert.equal(result.confidenceScore, 1)
    assert.equal(result.parserVersion, '9C.bnpParibas.2')
  })
})
