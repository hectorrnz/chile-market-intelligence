// Phase 9C — Crédit Agricole parser tests.
//
// Runs against a small sanitized fixture reproducing the real term sheet's
// field structure (fictional ISIN/values) — see docs/structured_notes_workbook_mapping.md.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractStructuredNoteTerms } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { detectIssuer } from '../src/lib/structuredNotes/pdf/parsers/index.ts'

const FIXTURE = fileURLToPath(new URL('fixtures/structured-notes/creditagricole_sample_terms.txt', import.meta.url))
const text = readFileSync(FIXTURE, 'utf8')
const result = extractStructuredNoteTerms([text], { fileName: 'creditagricole_sample_terms.txt' })
const n = result.note!

describe('Crédit Agricole — issuer detection', () => {
  it('detects credit_agricole from the joined text', () => {
    assert.equal(detectIssuer(text), 'credit_agricole')
  })
})

describe('Crédit Agricole — critical fields', () => {
  it('extracts successfully with full confidence', () => {
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
    assert.equal(result.confidenceScore, 1)
    assert.equal(result.parserVersion, '9C.creditAgricole.1')
  })
  it('extracts ISIN (from "ISIN Code :" label)', () => assert.equal(n.isin, 'XS9999999991'))
  it('extracts issuer + display name + guarantor', () => {
    assert.match(n.issuerName ?? '', /Crédit Agricole CIB Financial Solutions/)
    assert.equal(n.issuerDisplayName, 'Crédit Agricole')
    assert.match(n.guarantorName ?? '', /Crédit Agricole Corporate and Investment Bank/)
  })
  it('extracts trade/issue/final/maturity dates (DD/MM/YYYY)', () => {
    assert.equal(n.tradeDate, '2026-02-01')
    assert.equal(n.issueDate, '2026-02-08')
    assert.equal(n.finalValuationDate, '2027-02-01')
    assert.equal(n.maturityDate, '2027-02-08')
  })
  it('extracts currency/issue size/denomination', () => {
    assert.equal(n.currency, 'USD')
    assert.equal(n.issueSize, 1000000)
    assert.equal(n.denomination, 1000)
  })
  it('extracts coupon (periodic from schedule Fixed Rate, annualized derived)', () => {
    assert.ok(Math.abs((n.couponRatePeriodic ?? 0) - 0.02925) < 1e-9)
    assert.ok(Math.abs((n.couponRateAnnualized ?? 0) - 0.117) < 1e-9)
    assert.equal(n.couponFrequency, 'quarterly')
  })
})

describe('Crédit Agricole — barrier label mapping (Interest/Early Redemption/Final Redemption)', () => {
  it('maps Interest Barrier -> couponBarrierPct and Early Redemption Barrier -> autocallBarrierPct', () => {
    assert.equal(n.couponBarrierPct, 0.65)
    assert.equal(n.autocallBarrierPct, 1)
  })
  it('maps Final Redemption Barrier -> knockInBarrierPct, confirmed by the payoff wording (not assumed)', () => {
    assert.equal(n.knockInBarrierPct, 0.65)
    const knockInField = result.fields.find((f) => f.fieldPath === 'knockInBarrierPct')!
    assert.equal(knockInField.confidence, 'high')
    assert.equal(knockInField.warning, null)
  })
  it('would mark knock-in equivalence as only medium-confidence if the payoff wording did not confirm it', () => {
    // Same fixture but with the confirming payoff sentence removed.
    const withoutConfirmation = text.replace(/Favourable Scenario If the Performance[^\n]*\n/, '')
    const r2 = extractStructuredNoteTerms([withoutConfirmation], { fileName: 'x' })
    const knockInField2 = r2.fields.find((f) => f.fieldPath === 'knockInBarrierPct')!
    assert.equal(knockInField2.confidence, 'medium')
    assert.match(knockInField2.warning ?? '', /not confirmed by payoff wording/)
  })
})

describe('Crédit Agricole — underlyings', () => {
  it('extracts both underlyings with initial levels and Yahoo symbols', () => {
    assert.equal(n.underlyings.length, 2)
    const spx = n.underlyings.find((u) => u.underlyingName === 'SPX Index')!
    const rty = n.underlyings.find((u) => u.underlyingName === 'RTY Index')!
    assert.equal(spx.initialLevel, 6000)
    assert.equal(spx.yahooSymbol, '^GSPC')
    assert.equal(rty.initialLevel, 2400)
    assert.equal(rty.yahooSymbol, '^RUT')
  })
  it('extracts absolute barrier levels from the Indicative Barrier Level(s) table, matched positionally', () => {
    const spx = n.underlyings.find((u) => u.underlyingName === 'SPX Index')!
    assert.equal(spx.knockInBarrierLevel, 3900)
    assert.equal(spx.autocallBarrierLevel, 6000)
  })
})

describe('Crédit Agricole — schedule (one row per valuation date, no double count)', () => {
  it('extracts 4 quarterly observations, folding the early-redemption barrier into each row', () => {
    assert.equal(n.observations.length, 4)
    assert.ok(n.observations.every((o) => o.autocallBarrierPct === 1))
    const dates = n.observations.map((o) => o.valuationDate)
    assert.equal(new Set(dates).size, dates.length)
  })
})

describe('Crédit Agricole — hygiene', () => {
  it('produces no NaN/Infinity in any numeric field', () => {
    for (const v of [n.issueSize, n.couponRatePeriodic, n.knockInBarrierPct]) {
      assert.ok(v === null || Number.isFinite(v))
    }
    for (const u of n.underlyings) {
      for (const v of [u.initialLevel, u.knockInBarrierLevel, u.autocallBarrierLevel]) {
        assert.ok(v === null || Number.isFinite(v))
      }
    }
  })
  it('never extracts an allocation (internal-only, not in the PDF)', () => {
    assert.equal(n.allocations.length, 0)
  })
})
