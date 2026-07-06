// Phase 9A — Structured-note PDF term extraction tests.
//
// Runs the deterministic parser against a sanitized text fixture that
// reproduces the Citi CGMFL family field structure (no real/private document
// is committed — see docs/structured_notes_workbook_mapping.md). The parser
// takes already-extracted text, so no PDF binary or pdf.js dependency is
// needed here.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractStructuredNoteTerms, parseTermSheetDate } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { resolveUnderlyingSymbol, isUnderlyingSupported } from '../src/lib/structuredNotes/underlyingSymbolMap.ts'

const FIXTURE = fileURLToPath(new URL('fixtures/structured-notes/citi_sample_terms.txt', import.meta.url))
const text = readFileSync(FIXTURE, 'utf8')
const result = extractStructuredNoteTerms([text], { fileName: 'citi_sample_terms.txt' })
const n = result.note!

describe('date parsing', () => {
  it('parses "June 4, 2026" → ISO', () => {
    assert.equal(parseTermSheetDate('June 4, 2026'), '2026-06-04')
  })
  it('returns null for garbage', () => {
    assert.equal(parseTermSheetDate('not a date'), null)
  })
})

describe('Citi sample extraction — critical fields', () => {
  it('extraction succeeds with full confidence', () => {
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
    assert.equal(result.confidenceScore, 1)
  })
  it('extracts ISIN', () => assert.equal(n.isin, 'XS3180975347'))
  it('extracts issuer + display name', () => {
    assert.match(n.issuerName ?? '', /Citigroup Global Markets Funding/)
    assert.equal(n.issuerDisplayName, 'Citi')
  })
  it('extracts guarantor', () => assert.match(n.guarantorName ?? '', /Citigroup Global Markets Limited/))
  it('extracts trade/issue/final/maturity dates', () => {
    assert.equal(n.tradeDate, '2026-06-04')
    assert.equal(n.issueDate, '2026-06-11')
    assert.equal(n.finalValuationDate, '2028-06-05')
    assert.equal(n.maturityDate, '2028-06-12')
  })
  it('extracts issue size + currency + denomination', () => {
    assert.equal(n.issueSize, 1050000)
    assert.equal(n.currency, 'USD')
    assert.equal(n.denomination, 1000)
  })
  it('extracts coupon (periodic + annualized + frequency)', () => {
    assert.equal(n.couponRatePeriodic, 0.025375)
    assert.equal(n.couponRateAnnualized, 0.1015)
    assert.equal(n.couponFrequency, 'quarterly')
  })
  it('extracts barriers', () => {
    assert.equal(n.knockInBarrierPct, 0.65)
    assert.equal(n.couponBarrierPct, 0.65)
    assert.equal(n.autocallBarrierPct, 1)
  })
})

describe('Citi sample extraction — underlyings', () => {
  it('extracts two underlyings in order (RTY, SPX)', () => {
    assert.equal(n.underlyings.length, 2)
    assert.equal(n.underlyings[0].underlyingName, 'RTY Index')
    assert.equal(n.underlyings[1].underlyingName, 'SPX Index')
  })
  it('extracts initial/strike/barrier levels for RTY', () => {
    const rty = n.underlyings[0]
    assert.equal(rty.initialLevel, 2927)
    assert.equal(rty.strikeLevel, 2927)
    assert.equal(rty.knockInBarrierLevel, 1902.55)
    assert.equal(rty.couponBarrierLevel, 1902.55)
    assert.equal(rty.autocallBarrierLevel, 2927)
  })
  it('extracts levels for SPX', () => {
    const spx = n.underlyings[1]
    assert.equal(spx.initialLevel, 7576)
    assert.equal(spx.knockInBarrierLevel, 4924.4)
    assert.equal(spx.autocallBarrierLevel, 7576)
  })
  it('maps underlyings to verified Yahoo symbols (no Bloomberg)', () => {
    assert.equal(n.underlyings[0].yahooSymbol, '^RUT')
    assert.equal(n.underlyings[1].yahooSymbol, '^GSPC')
  })
})

describe('Citi sample extraction — schedule', () => {
  it('extracts 7 coupon + 7 autocall + 1 final observation', () => {
    assert.equal(n.observations.filter((o) => o.observationType === 'coupon').length, 7)
    assert.equal(n.observations.filter((o) => o.observationType === 'autocall').length, 7)
    assert.equal(n.observations.filter((o) => o.observationType === 'final').length, 1)
  })
  it('first coupon observation has valuation + payment dates', () => {
    const first = n.observations.find((o) => o.observationType === 'coupon' && o.observationNumber === 1)!
    assert.equal(first.valuationDate, '2026-09-04')
    assert.equal(first.paymentDate, '2026-09-14')
  })
})

describe('extraction integrity rules', () => {
  it('does not extract any allocation (internal-only, not in the PDF)', () => {
    assert.equal(n.allocations.length, 0)
  })
  it('never invents a coupon consensus/estimate field', () => {
    // The note shape has no consensus/estimate fields at all — structurally impossible to fabricate.
    assert.ok(!('consensus' in (n as object)))
  })
  it('produces no NaN in any numeric field', () => {
    for (const v of [n.issueSize, n.couponRatePeriodic, n.knockInBarrierPct]) {
      assert.ok(v === null || Number.isFinite(v))
    }
    for (const u of n.underlyings) {
      for (const v of [u.initialLevel, u.knockInBarrierLevel, u.couponBarrierLevel]) {
        assert.ok(v === null || Number.isFinite(v))
      }
    }
  })
  it('rejects when critical fields are missing (empty text → not ok)', () => {
    const bad = extractStructuredNoteTerms(['just some random text with no terms'])
    assert.equal(bad.ok, false)
    assert.ok(bad.errors.length > 0)
    assert.ok(bad.errors.some((e) => /ISIN/i.test(e)))
  })
})

describe('underlying symbol map (no Bloomberg, verified-only)', () => {
  it('resolves SPX/RTY Bloomberg tickers to Yahoo', () => {
    assert.equal(resolveUnderlyingSymbol('SPX Index')?.yahooSymbol, '^GSPC')
    assert.equal(resolveUnderlyingSymbol('RTY Index')?.yahooSymbol, '^RUT')
    assert.equal(resolveUnderlyingSymbol('SPY US Equity')?.yahooSymbol, 'SPY')
  })
  it('resolves by full name alias', () => {
    assert.equal(resolveUnderlyingSymbol('The Russell 2000 Index')?.yahooSymbol, '^RUT')
  })
  it('unmapped underlying is unsupported (price would be unavailable, not fake)', () => {
    assert.equal(resolveUnderlyingSymbol('SOME UNKNOWN Index'), null)
    assert.equal(isUnderlyingSupported('SOME UNKNOWN Index'), false)
  })
  it('an unverified symbol is not treated as supported', () => {
    assert.equal(isUnderlyingSupported('SX5E Index'), false) // present but verified:false
  })
})
