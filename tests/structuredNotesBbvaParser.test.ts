// Phase 9C — BBVA parser tests (clause-based extraction, draft-document conservatism).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractStructuredNoteTerms } from '../src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'
import { detectIssuer } from '../src/lib/structuredNotes/pdf/parsers/index.ts'
import { classifyReviewState } from '../src/lib/structuredNotes/pdf/parsers/shared.ts'

const FIXTURE = fileURLToPath(new URL('fixtures/structured-notes/bbva_sample_terms.txt', import.meta.url))
const text = readFileSync(FIXTURE, 'utf8')
const result = extractStructuredNoteTerms([text], { fileName: 'bbva_sample_terms.txt' })
const n = result.note!

describe('BBVA — issuer detection', () => {
  it('detects bbva from the joined text', () => {
    assert.equal(detectIssuer(text), 'bbva')
  })
})

describe('BBVA — clause-based extraction', () => {
  it('extracts issuer + guarantor from the cover clauses', () => {
    assert.match(n.issuerName ?? '', /BBVA GLOBAL MARKETS/)
    assert.equal(n.issuerDisplayName, 'BBVA')
    assert.match(n.guarantorName ?? '', /BANCO BILBAO VIZCAYA ARGENTARIA/)
  })
  it('extracts trade/issue/maturity dates from numbered clauses', () => {
    assert.equal(n.tradeDate, '2026-01-05')
    assert.equal(n.issueDate, '2026-01-12')
    assert.equal(n.maturityDate, '2028-01-13')
  })
  it('extracts currency/issue size from "Issue of Series NNNNN CCY amount"', () => {
    assert.equal(n.currency, 'USD')
    assert.equal(n.issueSize, 1000000)
  })
  it('extracts coupon from \'"Rate (i)" means X%.\'', () => {
    assert.ok(Math.abs((n.couponRatePeriodic ?? 0) - 0.0224) < 1e-9)
  })
  it('extracts underlyings from the Reference Item(s) basket table', () => {
    assert.equal(n.underlyings.length, 2)
    const spx = n.underlyings.find((u) => u.underlyingName === 'SPX Index')!
    assert.equal(spx.initialLevel, 6000)
    assert.equal(spx.yahooSymbol, '^GSPC')
  })
  it('disambiguates the coupon-barrier clause ("equal to or greater than") from the autocall clause ("greater than or equal to")', () => {
    assert.equal(n.couponBarrierPct, 0.65)
    assert.equal(n.autocallBarrierPct, 1)
  })
  it('barrier fields are marked medium/low confidence with a review warning — clause-inferred, not a labeled table', () => {
    const barrierField = result.fields.find((f) => f.fieldPath === 'couponBarrierPct')!
    assert.notEqual(barrierField.confidence, 'high')
    assert.match(barrierField.warning ?? '', /review/i)
  })
})

describe('BBVA — draft/preliminary document conservatism', () => {
  it('always reports ok:false when the "Subject to completion" marker is present, however cleanly fields extracted', () => {
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => /draft\/preliminary pricing supplement/.test(e)))
    assert.ok(result.warnings.some((w) => /draft pricing supplement/.test(w)))
  })
  it('classifyReviewState never returns "ready" for a draft document', () => {
    const state = classifyReviewState(result.ok, result.confidenceScore, result.fieldsLowConfidence)
    assert.equal(state, 'review_required')
  })
  it('a non-draft version of the same fixture no longer trips the draft-specific error (proves the conservatism is specifically about the draft marker, not a general parser bug)', () => {
    const nonDraft = text.replace(/^DRAFT FOR DISCUSSION PURPOSES[^\n]*\n/, '')
    const r2 = extractStructuredNoteTerms([nonDraft], { fileName: 'x' })
    assert.ok(!r2.errors.some((e) => /draft\/preliminary pricing supplement/.test(e)))
    assert.ok(!r2.warnings.some((w) => /draft pricing supplement/.test(w)))
  })
})

describe('BBVA — hygiene', () => {
  it('produces no NaN/Infinity', () => {
    for (const v of [n.issueSize, n.couponRatePeriodic, n.knockInBarrierPct]) {
      assert.ok(v === null || Number.isFinite(v))
    }
  })
  it('never fabricates an underlying when the basket table is missing entirely', () => {
    const noTable = text.replace(/8\. Reference Item\(s\)[\s\S]*?PROVISIONS RELATING TO INTEREST PAYABLE/, 'PROVISIONS RELATING TO INTEREST PAYABLE')
    const r2 = extractStructuredNoteTerms([noTable], { fileName: 'x' })
    assert.equal(r2.note?.underlyings.length, 0)
    assert.equal(r2.ok, false)
  })
})
