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

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`fixtures/structured-notes/${name}`, import.meta.url)), 'utf8')
}

describe('issuer detection — never guesses between two issuers', () => {
  it('detects each of the four new issuers unambiguously', () => {
    assert.equal(detectIssuer(fixture('creditagricole_sample_terms.txt')), 'credit_agricole')
    assert.equal(detectIssuer(fixture('bnp_sample_terms.txt')), 'bnp_paribas')
    assert.equal(detectIssuer(fixture('barclays_sample_terms.txt')), 'barclays')
    assert.equal(detectIssuer(fixture('bbva_sample_terms.txt')), 'bbva')
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
    assert.equal(extractWithRouter([fixture('bnp_sample_terms.txt')]).result.parserVersion, '9C.bnpParibas.1')
    assert.equal(extractWithRouter([fixture('barclays_sample_terms.txt')]).result.parserVersion, '9C.barclays.1')
    assert.equal(extractWithRouter([fixture('bbva_sample_terms.txt')]).result.parserVersion, '9C.bbva.1')
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
