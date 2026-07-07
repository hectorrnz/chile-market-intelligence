// Phase 9C — BNP Paribas parser tests (ordinal dates, compressed-table underlyings).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractStructuredNoteTerms, parseTermSheetDate } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { detectIssuer } from '../src/lib/structuredNotes/pdf/parsers/index.ts'

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
    assert.equal(result.parserVersion, '9C.bnpParibas.1')
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
