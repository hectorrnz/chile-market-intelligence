// Santander parser tests (Autocallable Memory Coupon Phoenix Index Basket).
//
// Added after a real uploaded Santander term sheet failed to extract (never
// crashed — the router's generic fallback correctly flagged it
// review-required, per the parser's safety design, since Santander had no
// dedicated parser). This is the first dedicated Santander parser.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractStructuredNoteTerms } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { detectIssuer } from '../src/lib/structuredNotes/pdf/parsers/index.ts'

const FIXTURE = fileURLToPath(new URL('fixtures/structured-notes/santander_sample_terms.txt', import.meta.url))
const text = readFileSync(FIXTURE, 'utf8')
const result = extractStructuredNoteTerms([text], { fileName: 'santander_sample_terms.txt' })
const n = result.note!

describe('Santander — issuer detection', () => {
  it('detects santander from the joined text', () => {
    assert.equal(detectIssuer(text), 'santander')
  })
  it('does not collide with any other issuer keyword', () => {
    assert.notEqual(detectIssuer(text), 'bnp_paribas')
    assert.notEqual(detectIssuer(text), 'barclays')
  })
})

describe('Santander — critical fields', () => {
  it('extracts successfully with full confidence (previously review-required — no dedicated parser existed)', () => {
    assert.equal(result.ok, true)
    assert.deepEqual(result.errors, [])
    assert.equal(result.confidenceScore, 1)
    assert.equal(result.parserVersion, '9F.santander.1')
  })
  it('extracts ISIN via the "ISIN Code" label alias', () => assert.equal(n.isin, 'XS1111111111'))
  it('extracts issuer + display name + guarantor', () => {
    assert.match(n.issuerName ?? '', /Santander International Products/)
    assert.equal(n.issuerDisplayName, 'Santander')
    assert.match(n.guarantorName ?? '', /Banco Santander/)
  })
  it('extracts trade/issue/maturity/final-observation dates', () => {
    assert.equal(n.tradeDate, '2025-01-01')
    assert.equal(n.issueDate, '2025-01-08')
    assert.equal(n.maturityDate, '2027-01-08')
    assert.equal(n.finalValuationDate, '2027-01-01')
  })
  it('extracts issue size, denomination, currency', () => {
    assert.equal(n.issueSize, 2000000)
    assert.equal(n.denomination, 1000)
    assert.equal(n.currency, 'USD')
  })
  it('extracts periodic coupon rate ("Rate means 1.75%"), never matching inside "SumRate means..."', () => {
    assert.equal(n.couponRatePeriodic, 0.0175)
    assert.equal(n.couponRateAnnualized, 0.07)
  })
})

describe('Santander — barriers (Coupon/AER/Redemption "means N%" clauses)', () => {
  it('extracts coupon barrier, AER (autocall) level, and redemption (knock-in) barrier', () => {
    assert.equal(n.couponBarrierPct, 0.6)
    assert.equal(n.autocallBarrierPct, 1)
    assert.equal(n.knockInBarrierPct, 0.6)
  })
})

describe('Santander — underlyings (single Initial Level per row, wraps across physical lines)', () => {
  it('extracts both underlyings despite the row wrapping across 3 physical lines', () => {
    assert.equal(n.underlyings.length, 2)
    const spx = n.underlyings.find((u) => u.underlyingName === 'SPX Index')!
    assert.equal(spx.initialLevel, 4800.5)
    assert.equal(spx.yahooSymbol, '^GSPC')
    const rty = n.underlyings.find((u) => u.underlyingName === 'RTY Index')!
    assert.equal(rty.initialLevel, 2000.25)
    assert.equal(rty.yahooSymbol, '^RUT')
  })
})

describe('Santander — schedule (two separate numbered vertical lists, zipped by position)', () => {
  it('extracts 8 observations: 7 coupon + 1 final, correctly ordered', () => {
    assert.equal(n.observations.length, 8)
    assert.equal(n.observations.filter((o) => o.observationType === 'coupon').length, 7)
    assert.equal(n.observations.filter((o) => o.observationType === 'final').length, 1)
    assert.equal(n.observations[n.observations.length - 1].observationType, 'final')
  })
  it('zips Observation Date and Interest Payment Date lists by position (n=1 valuation -> n=1 payment)', () => {
    assert.equal(n.observations[0].valuationDate, '2025-04-01')
    assert.equal(n.observations[0].paymentDate, '2025-04-08')
    assert.equal(n.observations[6].valuationDate, '2026-10-01')
    assert.equal(n.observations[6].paymentDate, '2026-10-08')
  })
  it('the final observation matches Final Observation Date, not the last coupon slot', () => {
    const final = n.observations[n.observations.length - 1]
    assert.equal(final.valuationDate, '2027-01-01')
    assert.equal(final.paymentDate, '2027-01-08')
  })
  it('produces no duplicate valuation dates', () => {
    const dates = n.observations.map((o) => o.valuationDate)
    assert.equal(new Set(dates).size, dates.length)
  })
})

describe('Santander — hygiene', () => {
  it('produces no NaN/Infinity', () => {
    for (const v of [n.issueSize, n.couponRatePeriodic, n.knockInBarrierPct, n.couponRateAnnualized]) {
      assert.ok(v === null || Number.isFinite(v))
    }
  })
  it('never mistakes a prose mention of a label for the actual data line (regression for labelDateJoined)', () => {
    // "Final Observation Date" appears once in explanatory prose with no
    // adjacent date, and again as the real data line further down.
    assert.equal(n.finalValuationDate, '2027-01-01')
  })
})
