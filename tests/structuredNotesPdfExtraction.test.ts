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
import { extractStructuredNoteTerms, parseTermSheetDate, dedupeObservationsByDate } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import type { StructuredNoteObservation } from '../src/lib/structuredNotes/types.ts'
import { resolveUnderlyingSymbol, isUnderlyingSupported } from '../src/lib/structuredNotes/underlyingSymbolMap.ts'

const FIXTURE = fileURLToPath(new URL('fixtures/structured-notes/citi_sample_terms.txt', import.meta.url))
const text = readFileSync(FIXTURE, 'utf8')
const result = extractStructuredNoteTerms([text], { fileName: 'citi_sample_terms.txt' })
const n = result.note!

describe('date parsing (multi-format)', () => {
  it('parses "June 4, 2026" (US) → ISO', () => {
    assert.equal(parseTermSheetDate('June 4, 2026'), '2026-06-04')
  })
  it('parses "04 Sep 2026" (EU schedule) → ISO', () => {
    assert.equal(parseTermSheetDate('04 Sep 2026'), '2026-09-04')
  })
  it('parses "03/06/2026" (DD/MM/YYYY, day-first) → ISO', () => {
    assert.equal(parseTermSheetDate('03/06/2026'), '2026-06-03')
    assert.equal(parseTermSheetDate('12/06/2028'), '2028-06-12')
  })
  it('returns null for garbage', () => {
    assert.equal(parseTermSheetDate('not a date'), null)
  })
})

describe('HSBC sample extraction (EU template)', () => {
  const hsbcText = readFileSync(fileURLToPath(new URL('fixtures/structured-notes/hsbc_sample_terms.txt', import.meta.url)), 'utf8')
  const hr = extractStructuredNoteTerms([hsbcText], { fileName: 'hsbc_sample_terms.txt' })
  const hn = hr.note!
  it('extracts full-confidence despite a different template than Citi', () => {
    assert.equal(hr.ok, true)
    assert.equal(hr.confidenceScore, 1)
  })
  it('extracts ISIN, issuer, DD/MM/YYYY dates', () => {
    assert.equal(hn.isin, 'XS3376583269')
    assert.equal(hn.issuerDisplayName, 'HSBC')
    assert.equal(hn.tradeDate, '2026-06-03')
    assert.equal(hn.maturityDate, '2028-06-12')
  })
  it('extracts coupon + barriers + issue size', () => {
    assert.equal(hn.couponRatePeriodic, 0.025125)
    assert.equal(hn.couponRateAnnualized, 0.1005)
    assert.equal(hn.knockInBarrierPct, 0.65)
    assert.equal(hn.autocallBarrierPct, 1)
    assert.equal(hn.issueSize, 1005000)
  })
  it('extracts both underlyings with 3-column levels + Yahoo symbols', () => {
    assert.equal(hn.underlyings.length, 2)
    const spx = hn.underlyings.find((u) => u.underlyingName === 'SPX Index')!
    assert.equal(spx.initialLevel, 7560.9)
    assert.equal(spx.knockInBarrierLevel, 4914.585)
    assert.equal(spx.yahooSymbol, '^GSPC')
    assert.equal(hn.underlyings.find((u) => u.underlyingName === 'RTY Index')!.yahooSymbol, '^RUT')
  })
  // R13.7 — INVERTED. This test previously asserted 0 autocall observations
  // ("folded into the coupon row"), which is the defect itself: the coupon test
  // (65% barrier) and the autocall test (100% call level) are contractually
  // DISTINCT, and folding them into one coupon-typed row meant the call level
  // was never evaluated anywhere downstream. Same boundary, guarded from the
  // correct side.
  it('emits coupon AND autocall as distinct contractual tests on the same dates', () => {
    assert.equal(hn.observations.filter((o) => o.observationType === 'coupon').length, 7)
    assert.equal(hn.observations.filter((o) => o.observationType === 'autocall').length, 7)
    assert.equal(hn.observations.filter((o) => o.observationType === 'final').length, 1)
    // The two schedules share their valuation dates — that is exactly why the
    // old date-only key silently destroyed one of them.
    const couponDates = hn.observations.filter((o) => o.observationType === 'coupon').map((o) => o.valuationDate)
    const autocallDates = hn.observations.filter((o) => o.observationType === 'autocall').map((o) => o.valuationDate)
    assert.deepEqual(autocallDates, couponDates)
    // No duplicate of the SAME test on the same date (a real extraction artifact).
    const keys = hn.observations.map((o) => `${o.valuationDate}::${o.observationType}`)
    assert.equal(new Set(keys).size, keys.length)
    // Every autocall row carries the call level and no coupon level.
    for (const o of hn.observations.filter((x) => x.observationType === 'autocall')) {
      assert.equal(o.autocallBarrierPct, 1)
      assert.equal(o.couponBarrierPct, null)
    }
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

describe('Citi sample extraction — schedule (distinct contractual tests per date)', () => {
  // R13.7 — INVERTED, same reasoning as the HSBC block above. The term sheet
  // prints "Contingent Coupon Valuation Date" and, under its own "Mandatory
  // Early Redemption" heading, "Autocall Valuation Date". Both must survive.
  it('extracts 7 coupon + 7 autocall + 1 final observation', () => {
    assert.equal(n.observations.filter((o) => o.observationType === 'coupon').length, 7)
    assert.equal(n.observations.filter((o) => o.observationType === 'autocall').length, 7)
    assert.equal(n.observations.filter((o) => o.observationType === 'final').length, 1)
    const keys = n.observations.map((o) => `${o.valuationDate}::${o.observationType}`)
    assert.equal(new Set(keys).size, keys.length) // no same-test duplicate
  })
  it('the final valuation date carries no autocall test (maturity is not an early redemption)', () => {
    const finalDate = n.observations.find((o) => o.observationType === 'final')!.valuationDate
    assert.equal(n.observations.filter((o) => o.observationType === 'autocall' && o.valuationDate === finalDate).length, 0)
  })
  it('first coupon observation has valuation + payment dates', () => {
    const first = n.observations.find((o) => o.observationType === 'coupon' && o.observationNumber === 1)!
    assert.equal(first.valuationDate, '2026-09-04')
    assert.equal(first.paymentDate, '2026-09-14')
  })
})

describe('dedupeObservationsByDate (R13.7 — preserves distinct contractual tests)', () => {
  const sameDate: StructuredNoteObservation[] = [
    { observationNumber: 1, observationType: 'coupon', valuationDate: '2026-09-04', paymentDate: '2026-09-14', redemptionDate: null, couponDuePct: 0.025, autocallBarrierPct: null, couponBarrierPct: 0.65, status: 'scheduled' },
    { observationNumber: 1, observationType: 'autocall', valuationDate: '2026-09-04', paymentDate: null, redemptionDate: '2026-09-14', couponDuePct: null, autocallBarrierPct: 1, couponBarrierPct: null, status: 'scheduled' },
    { observationNumber: 2, observationType: 'final', valuationDate: '2028-06-05', paymentDate: '2028-06-12', redemptionDate: '2028-06-12', couponDuePct: 0.025, autocallBarrierPct: 1, couponBarrierPct: 0.65, status: 'scheduled' },
  ]

  // R13.7 — INVERTED. The previous assertion (3→2, autocall merged away, the
  // surviving row "not autocall") is the root cause in test form: it required
  // the function to destroy the 100% call test whenever it shared a date with
  // the 65% coupon test. Sharing a date makes two contractual conditions
  // simultaneous, not identical.
  it('keeps a same-date coupon and autocall as two separate contractual tests', () => {
    const deduped = dedupeObservationsByDate(sameDate)
    assert.equal(deduped.length, 3)
    const coupon = deduped.find((o) => o.valuationDate === '2026-09-04' && o.observationType === 'coupon')!
    const autocall = deduped.find((o) => o.valuationDate === '2026-09-04' && o.observationType === 'autocall')!
    assert.ok(coupon && autocall)
    assert.equal(coupon.couponBarrierPct, 0.65)
    assert.equal(autocall.autocallBarrierPct, 1)
    // The two tests never bleed into each other.
    assert.equal(autocall.couponBarrierPct, null)
  })

  it('still collapses a TRUE duplicate — the same test twice on the same date', () => {
    const withDuplicate = [...sameDate, { ...sameDate[0], paymentDate: null, couponDuePct: null }]
    const deduped = dedupeObservationsByDate(withDuplicate)
    assert.equal(deduped.length, 3)
    // Gap-filling only: the present value wins over the duplicate's null.
    const coupon = deduped.find((o) => o.valuationDate === '2026-09-04' && o.observationType === 'coupon')!
    assert.equal(coupon.paymentDate, '2026-09-14')
    assert.equal(coupon.couponDuePct, 0.025)
  })

  it('renumbers per observation type (the persistence uniqueness key)', () => {
    const deduped = dedupeObservationsByDate(sameDate)
    assert.equal(deduped.find((o) => o.observationType === 'coupon')!.observationNumber, 1)
    assert.equal(deduped.find((o) => o.observationType === 'autocall')!.observationNumber, 1)
    assert.equal(deduped.find((o) => o.observationType === 'final')!.observationNumber, 1)
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
  it('Phase 9E — a verified entry carries provider symbols, currency, confidence, sourceType, and a verifiedAt date, while preserving the original yahooSymbol field 7 call sites depend on', () => {
    const spx = resolveUnderlyingSymbol('SPX Index')
    assert.equal(spx?.yahooSymbol, '^GSPC') // backward-compatible field, still present
    assert.equal(spx?.providerSymbols.yahoo, '^GSPC')
    assert.equal(spx?.providerSymbols.stooq, null) // no secondary provider passed discovery this phase
    assert.equal(spx?.currency, 'USD')
    assert.equal(spx?.confidence, 'high')
    assert.equal(spx?.sourceType, 'free_monitoring_estimate')
    assert.ok(spx?.verifiedAt)
  })
  it('Phase 9E — an unverified entry is explicitly unsupported (never proxy or free_monitoring_estimate) and confidence is low', () => {
    const sx5e = resolveUnderlyingSymbol('SX5E Index')
    assert.equal(sx5e?.sourceType, 'unsupported')
    assert.equal(sx5e?.confidence, 'low')
    assert.equal(sx5e?.verifiedAt, null)
  })
  it('Phase 9E — normalizedCode is a stable slug independent of any provider symbol format', () => {
    assert.equal(resolveUnderlyingSymbol('SPX Index')?.normalizedCode, 'spx-index')
    assert.equal(resolveUnderlyingSymbol('RTY Index')?.normalizedCode, 'rty-index')
  })
})
