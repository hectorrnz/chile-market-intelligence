// Phase 9C — Barclays parser tests (mixed Bloomberg/Refinitiv ticker cell).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractStructuredNoteTerms } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { detectIssuer } from '../src/lib/structuredNotes/pdf/parsers/index.ts'
import { parseMixedTickerCell } from '../src/lib/structuredNotes/pdf/parsers/shared.ts'

const FIXTURE = fileURLToPath(new URL('fixtures/structured-notes/barclays_sample_terms.txt', import.meta.url))
const text = readFileSync(FIXTURE, 'utf8')
const result = extractStructuredNoteTerms([text], { fileName: 'barclays_sample_terms.txt' })
const n = result.note!

describe('Barclays — issuer detection', () => {
  it('detects barclays from the joined text', () => {
    assert.equal(detectIssuer(text), 'barclays')
  })
})

describe('Barclays — mixed Bloomberg/Refinitiv ticker cell parsing', () => {
  it('parseMixedTickerCell prefers the Bloomberg code and keeps Refinitiv as separate metadata', () => {
    const parsed = parseMixedTickerCell('S&P 500 Index (Bloomberg Screen: SPX Index; Refinitiv Screen: .SPX)')
    assert.equal(parsed.bloombergTicker, 'SPX')
    assert.equal(parsed.refinitivCode, '.SPX')
    assert.equal(parsed.name, 'S&P 500 Index')
  })
  it('the extracted underlying uses the Bloomberg ticker as sourceTicker/bloombergTicker, never the Refinitiv code', () => {
    const tickers = n.underlyings.map((u) => u.sourceTicker)
    assert.ok(tickers.includes('SPX Index'))
    assert.ok(tickers.includes('RTY Index'))
    for (const u of n.underlyings) {
      assert.ok(!/^\./.test(u.sourceTicker ?? '')) // never a Refinitiv-style ".XXX" code
    }
  })
  it('preserves the Refinitiv codes in a metadata-only field, not used for market-data mapping', () => {
    const refField = result.fields.find((f) => f.fieldPath === 'underlyings.refinitivCodes')!
    assert.match(String(refField.value), /SPX|RUT/)
    assert.match(refField.sourceSection ?? '', /metadata only/)
  })
})

describe('Barclays — critical fields', () => {
  it('extracts successfully with full confidence', () => {
    assert.equal(result.ok, true)
    assert.equal(result.errors.length, 0)
    assert.equal(result.confidenceScore, 1)
    assert.equal(result.parserVersion, '9C.barclays.1')
  })
  it('extracts ISIN, issuer, no separate guarantor (Barclays issues in its own name)', () => {
    assert.equal(n.isin, 'XS9999999993')
    assert.match(n.issuerName ?? '', /Barclays Bank PLC/)
    assert.equal(n.issuerDisplayName, 'Barclays')
    assert.equal(n.guarantorName, null)
  })
  it('extracts clean "D Month YYYY" dates (no ordinal, day-first)', () => {
    assert.equal(n.tradeDate, '2026-01-05')
    assert.equal(n.issueDate, '2026-01-12')
    assert.equal(n.finalValuationDate, '2028-01-06')
    assert.equal(n.maturityDate, '2028-01-13')
  })
  it('extracts currency/issue size/denomination', () => {
    assert.equal(n.currency, 'USD')
    assert.equal(n.issueSize, 1025000)
    assert.equal(n.denomination, 1000)
  })
  it('extracts coupon from the Interest Rate(s) schedule column', () => {
    assert.equal(n.couponRatePeriodic, 0.0275)
    assert.equal(n.couponRateAnnualized, 0.11)
  })
  it('extracts barriers from the Knock-in/Interest/Autocall Barrier column labels', () => {
    assert.equal(n.knockInBarrierPct, 0.65)
    assert.equal(n.couponBarrierPct, 0.65)
    assert.equal(n.autocallBarrierPct, 1)
  })
})

describe('Barclays — underlyings', () => {
  it('extracts both underlyings with initial/strike/barrier levels', () => {
    assert.equal(n.underlyings.length, 2)
    const spx = n.underlyings.find((u) => u.underlyingName === 'SPX Index')!
    assert.equal(spx.initialLevel, 6000)
    assert.equal(spx.knockInBarrierLevel, 3900)
    assert.equal(spx.yahooSymbol, '^GSPC')
  })
})

describe('Barclays — schedule', () => {
  it('extracts one observation per interest valuation date plus a final observation', () => {
    assert.ok(n.observations.length >= 4)
    assert.equal(n.observations.filter((o) => o.observationType === 'final').length, 1)
  })
})

describe('Barclays — hygiene', () => {
  it('produces no NaN/Infinity', () => {
    for (const v of [n.issueSize, n.couponRatePeriodic, n.knockInBarrierPct]) {
      assert.ok(v === null || Number.isFinite(v))
    }
  })
})
