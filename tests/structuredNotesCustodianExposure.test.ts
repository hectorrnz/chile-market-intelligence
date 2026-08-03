// Phase R7.1B — custodian exposure, notional semantics, and delete controls.
//
// Three defects, one suite:
//   1. Custody was modelled (a nullable `custodian` column has existed on
//      structured_note_allocations since 9A) but never capturable, never shown
//      and never aggregated.
//   2. The app asserted "Nevada's investment == the product's issue size":
//      `Math.abs(allocationTotal - issueSize) > 0.01` raised "Allocations do
//      not match the issue size" on the detail page and in the allocations
//      API. Those are different quantities — Nevada ordinarily owns a fraction
//      of an issuance — and the rule fired a false warning on real book data
//      (XS3164820824: USD 1,000,000 held against a USD 1,500,000 issuance).
//   3. Notes could only be deleted from the detail page.
//
// Numbered groups map 1:1 onto the R7.1B brief's section-R items 1-68.
// Fixtures are synthetic; no live provider, database, or private document.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  normalizeCustodianName,
  custodianKey,
  calculateCustodianExposure,
  calculateIssuerExposure,
  calculateEntityExposure,
  calculateNevadaInvestmentNotional,
  calculateAllocationTotal,
  nevadaInvestmentCurrency,
  classifyIssueSizePlausibility,
} from '../src/lib/structuredNotes/calculations.ts'
import { buildBookDashboard } from '../src/lib/structuredNotes/dashboard.ts'
import type { StructuredNote, StructuredNoteAllocation } from '../src/lib/structuredNotes/types.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Source with comments stripped — so prose about a pattern never satisfies a scan for it. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const DASH = read('src/app/structured-notes/page.tsx')
const DASH_CODE = code('src/app/structured-notes/page.tsx')
const DETAIL = read('src/app/structured-notes/[id]/page.tsx')
const DETAIL_CODE = code('src/app/structured-notes/[id]/page.tsx')
const ALLOC_ROUTE = read('src/app/api/structured-notes/[id]/allocations/route.ts')
const NOTE_ROUTE = read('src/app/api/structured-notes/[id]/route.ts')
const REPO = read('src/lib/db/repositories/structuredNotesRepository.ts')
const CALC = read('src/lib/structuredNotes/calculations.ts')
const I18N = read('src/lib/i18n.ts')
const MIGRATION = read('supabase/migrations/20260706000000_structured_notes_foundation.sql')
const PARSER_DIR = 'src/lib/structuredNotes/pdf/parsers'

function alloc(over: Partial<StructuredNoteAllocation> = {}): StructuredNoteAllocation {
  return { entityName: 'WATERMILL', custodian: null, notionalAmount: 100, currency: 'USD', active: true, ...over }
}
/**
 * R7.1B.1 — custody is a NOTE-level fact: all of a note's account allocations
 * are traded through the same custodian, so the fixture takes one custodian
 * per note, not one per allocation.
 */
function noteOf(custodian: string | null, allocations: StructuredNoteAllocation[], status: StructuredNote['status'] = 'active') {
  return { custodian, status, allocations }
}

// ── 1-12 · custodian model ───────────────────────────────────────────────────

describe('R7.1B §1-12 — custodian is a user-maintained portfolio fact', () => {
  it('1. custodian is ONE user-entered note-level field, with a registry built from real entries', () => {
    // A single field per note — the accounts of a note are traded together,
    // so custody is captured once, not repeated per allocation row.
    assert.match(DETAIL, /function CustodianField/)
    assert.match(DETAIL, /<CustodianField/)
    assert.match(DETAIL, /aria-label=\{t\.sn\.custodian\}/)
    assert.match(DETAIL, /list=\{listId\}/)
    // Exactly one custodian input exists on the page.
    assert.equal((DETAIL.match(/id="sn-custodian"/g) ?? []).length, 1)
    // It writes the NOTE, not an allocation.
    assert.match(DETAIL, /async function setCustodian[\s\S]{0,400}method: 'PATCH'[\s\S]{0,200}custodian: value\.trim\(\) \|\| null/)
    // Suggestions are the custodians users already recorded on their notes.
    assert.match(REPO, /export async function getKnownCustodians/)
    assert.match(REPO, /from\('structured_notes'\)\.select\('custodian'\)/)
    assert.match(ALLOC_ROUTE, /custodians: await getKnownCustodians\(client\)/)
  })

  it('1b. the allocation row carries an account and its notional only — no per-row custody', () => {
    const row = DETAIL.slice(DETAIL.indexOf('function EntityRow'), DETAIL.indexOf('function EntityRow') + 2000)
    assert.doesNotMatch(row, /custodian/i, 'custody is not an allocation-level field')
    // The allocations API neither accepts nor writes custody (its only
    // custodian-related surface is the read-only suggestion list).
    assert.doesNotMatch(ALLOC_ROUTE, /body\.custodian|custodian:/, 'the allocations API does not accept custody')
    assert.match(REPO, /R7\.1B\.1 — allocations carry an account and its notional ONLY/)
  })

  it('2. custodian is never extracted from a term sheet', () => {
    for (const f of ['citiHsbcParser', 'barclaysParser', 'bnpParibasParser', 'bbvaParser', 'creditAgricoleParser', 'santanderParser']) {
      const src = read(`${PARSER_DIR}/${f}.ts`)
      // Every parser sets custody explicitly to null: an extracted note can
      // never arrive carrying a guessed custodian…
      assert.match(src, /custodian: null,/, `${f} must leave custody unrecorded`)
      // …and none of them ever reads one out of the document.
      assert.doesNotMatch(src, /field\('custodian'|custodian\s*=|\/[^\n]*custod[^\n]*\/i/i, `${f} must not extract custody`)
    }
    for (const f of ['shared', 'index']) {
      assert.doesNotMatch(read(`${PARSER_DIR}/${f}.ts`), /custodian|custody/i, `${f} must not touch custody`)
    }
    assert.doesNotMatch(read('src/lib/structuredNotes/pdf/extractStructuredNoteTerms.ts'), /custodian/i)
    // The import path never writes it either — it stays null until a user acts.
    assert.match(REPO, /Custody is never part of an imported term sheet/)
    // The allocations note in the UI still states allocations are never from the PDF.
    assert.match(I18N, /allocationsNote: 'Internal portfolio data — never extracted from the PDF'/)
  })

  it('3-5. custodian is never inferred from issuer, dealer, or a clearing system', () => {
    // No default/fallback assignment anywhere in the write path or aggregation.
    for (const [name, src] of [['repository', code('src/lib/db/repositories/structuredNotesRepository.ts')], ['allocations route', code('src/app/api/structured-notes/[id]/allocations/route.ts')], ['calculations', code('src/lib/structuredNotes/calculations.ts')]] as const) {
      assert.doesNotMatch(src, /custodian\s*[:=]\s*[^,;)\n]*\b(issuer|dealer|distributor|entityName|entity_name|euroclear|clearstream|paying|calculation)\b/i, `${name} must not derive custodian`)
    }
    assert.doesNotMatch(DASH_CODE + DETAIL_CODE, /euroclear|clearstream/i, 'a clearing system is never labelled custodian')
    // Aggregation reads the note's own recorded custodian only.
    assert.match(CALC, /custodianKey\(n\.custodian\)/)
  })

  it('6. a note\'s accounts all sit at its ONE custodian — the whole position, undivided', () => {
    const exp = calculateCustodianExposure([
      noteOf('Custodian X', [alloc({ entityName: 'A', notionalAmount: 600 }), alloc({ entityName: 'B', notionalAmount: 400 })]),
    ])
    assert.equal(exp.length, 1, 'one note contributes to exactly one custodian')
    assert.equal(exp[0].custodian, 'Custodian X')
    assert.equal(exp[0].notional, 1000, 'all three accounts of the note roll up together')
    assert.equal(exp[0].noteCount, 1)
  })

  it('7. one custodian can hold several notes', () => {
    const exp = calculateCustodianExposure([
      noteOf('Custodian X', [alloc({ entityName: 'A', notionalAmount: 100 })]),
      noteOf('Custodian X', [alloc({ entityName: 'B', notionalAmount: 250 })]),
      noteOf('Custodian Y', [alloc({ entityName: 'C', notionalAmount: 70 })]),
    ])
    assert.equal(exp.length, 2)
    assert.equal(exp[0].notional, 350)
    assert.equal(exp[0].noteCount, 2)
  })

  it('8. a missing custodian stays null/unavailable — never invented', () => {
    assert.equal(normalizeCustodianName(null), null)
    assert.equal(normalizeCustodianName('   '), null)
    assert.equal(custodianKey(undefined), null)
    const exp = calculateCustodianExposure([noteOf(null, [alloc({ notionalAmount: 500 })])])
    assert.equal(exp.length, 1)
    assert.equal(exp[0].custodian, null)
    assert.equal(exp[0].notional, 500)
  })

  it('9. a note with no custodian recorded never blocks reading it', () => {
    const notes = [noteOf(null, [alloc({ notionalAmount: 700 })])]
    // Every aggregate still resolves, and the note keeps its full notional.
    assert.equal(calculateNevadaInvestmentNotional(notes[0].allocations), 700)
    assert.equal(calculateCustodianExposure(notes)[0].notional, 700)
    // The field is flagged for completion, not gated.
    assert.match(DETAIL, /borderColor: \(value \?\? ''\)\.trim\(\) === '' \? 'var\(--warning\)' : 'var\(--border\)'/)
    assert.match(DETAIL, /placeholder=\{t\.sn\.custodianUnavailable\}/)
  })

  it('10. custody is recorded on the note and is never defaulted from another field', () => {
    // The note PATCH is the only write path, and it only acts when the client
    // actually sent the key (an explicit null clears it).
    assert.match(NOTE_ROUTE, /Object\.prototype\.hasOwnProperty\.call\(body, 'custodian'\)/)
    assert.match(NOTE_ROUTE, /patch\.custodian = typeof body\.custodian === 'string' \? body\.custodian\.slice\(0, 120\) : null/)
    assert.match(REPO, /if \(patch\.custodian !== undefined\) dbPatch\.custodian = normalizeCustodianName\(patch\.custodian\)/)
    // The import path never sets it, so a new note starts unrecorded.
    assert.doesNotMatch(REPO.slice(REPO.indexOf('const noteInsert'), REPO.indexOf('const noteInsert') + 1200), /custodian:/)
  })

  it('11. normalization handles whitespace and casing without changing the stored name', () => {
    assert.equal(normalizeCustodianName('  Banco   de  Chile '), 'Banco de Chile')
    assert.equal(normalizeCustodianName('Banco de Chile'), 'Banco de Chile', 'user casing preserved')
    assert.equal(custodianKey('  BANCO DE CHILE '), custodianKey('banco de chile'))
    const exp = calculateCustodianExposure([
      noteOf('Banco de Chile', [alloc({ notionalAmount: 100 })]),
      noteOf('  banco   de chile  ', [alloc({ notionalAmount: 50 })]),
    ])
    assert.equal(exp.length, 1, 'the same institution merges')
    assert.equal(exp[0].notional, 150)
    assert.equal(exp[0].custodian, 'Banco de Chile', 'the first legal name entered is displayed')
  })

  it('12. genuinely distinct institutions are never merged by brand similarity', () => {
    const pairs: [string, string][] = [
      ['Banco de Chile', 'Banchile Corredores de Bolsa'],
      ['JPMorgan Chase Bank, N.A.', 'J.P. Morgan Securities LLC'],
    ]
    for (const [a, b] of pairs) {
      assert.notEqual(custodianKey(a), custodianKey(b), `${a} and ${b} must stay distinct`)
    }
    const exp = calculateCustodianExposure([
      noteOf('JPMorgan Chase Bank, N.A.', [alloc({ notionalAmount: 10 })]),
      noteOf('J.P. Morgan Securities LLC', [alloc({ notionalAmount: 20 })]),
    ])
    assert.equal(exp.length, 2)
    // Punctuation/legal suffixes are deliberately NOT stripped — that is what
    // would collapse two different legal entities into one.
    assert.doesNotMatch(CALC, /replace\(\/\[.,\]\/g/)
  })
})

// ── 13-27 · notional semantics ───────────────────────────────────────────────

describe('R7.1B §13-27 — issue size is product metadata, not Nevada exposure', () => {
  const usd = (nevada: number | null, issue: number | null) =>
    classifyIssueSizePlausibility({ nevadaInvestmentNotional: nevada, nevadaCurrency: 'USD', issueSize: issue, issueSizeCurrency: 'USD' })

  it('13-16. the two sizes may differ; below/equal/above never error', () => {
    assert.equal(usd(1_000_000, 1_500_000), 'below')
    assert.equal(usd(1_500_000, 1_500_000), 'equal')
    assert.equal(usd(1_500_000.005, 1_500_000), 'equal', 'rounding tolerance')
    assert.equal(usd(2_000_000, 1_500_000), 'review')
    // 'review' is the strongest possible outcome — nothing rejects.
    const outcomes = new Set(['not_comparable', 'below', 'equal', 'review'])
    for (const v of [usd(1, 2), usd(2, 1), usd(2, 2), usd(null, 2)]) assert.ok(outcomes.has(v))
    assert.doesNotMatch(code('src/app/api/structured-notes/[id]/allocations/route.ts'), /issueSize.*status: 4\d\d|invalid_issue_size/)
  })

  it('17-18. a missing value never invalidates and never falls back to the other', () => {
    assert.equal(usd(null, 1_500_000), 'not_comparable')
    assert.equal(usd(1_000_000, null), 'not_comparable')
    // Issue size is never used as a notional/exposure value. The ONLY place
    // calculations.ts may name it is the comparison classifier — every
    // notional/exposure function is scanned individually below.
    const calcCode = code('src/lib/structuredNotes/calculations.ts')
    for (const fn of ['calculateAllocationTotal', 'calculateNevadaInvestmentNotional', 'calculateCurrentNotional', 'calculateIssuerExposure', 'calculateEntityExposure', 'calculateCustodianExposure']) {
      const start = calcCode.indexOf(`export function ${fn}`)
      assert.ok(start > -1, `${fn} not found`)
      const body = calcCode.slice(start, calcCode.indexOf('\nexport ', start + 10))
      assert.doesNotMatch(body, /issueSize/, `${fn} must never read the issue size`)
    }
    assert.doesNotMatch(code('src/lib/structuredNotes/dashboard.ts'), /issueSize/)
    assert.doesNotMatch(DETAIL_CODE, /notionalAmount[^\n]*issueSize|issueSize[^\n]*\?\?\s*(alloc|notional)/i)
  })

  it('19. Nevada investment IS the sum of valid active account allocations', () => {
    const allocs = [
      alloc({ entityName: 'A', notionalAmount: 600 }),
      alloc({ entityName: 'B', notionalAmount: 400 }),
      alloc({ entityName: 'C', notionalAmount: 999, active: false }),
      alloc({ entityName: 'D', notionalAmount: Number.NaN }),
    ]
    assert.equal(calculateNevadaInvestmentNotional(allocs), 1000)
    // Exactly one implementation — no second authoritative total can drift.
    assert.equal(calculateNevadaInvestmentNotional(allocs), calculateAllocationTotal(allocs))
    assert.match(CALC, /export function calculateNevadaInvestmentNotional[\s\S]{0,300}return calculateAllocationTotal\(allocations\)/)
    // There is no stored note-level investment field to disagree with it.
    assert.doesNotMatch(read('src/lib/structuredNotes/types.ts'), /investmentSize|investmentNotional|nevadaInvestment/)
  })

  it('20-22. both exposure charts use the Nevada position basis, never issue size', () => {
    const notes = [noteOf('Custodian X', [alloc({ entityName: 'A', notionalAmount: 600 }), alloc({ entityName: 'B', notionalAmount: 400 })])]
    const withIssuer = notes.map((n) => ({ ...n, issuerDisplayName: 'Citi' }))
    assert.equal(calculateIssuerExposure(withIssuer)[0].notional, 1000)
    assert.equal(calculateCustodianExposure(notes).reduce((s, e) => s + e.notional, 0), 1000)
    // Neither aggregation function can even see issueSize (asserted in 17-18).
    assert.match(CALC, /export function calculateCustodianExposure/)
  })

  it('23. a currency mismatch prevents the comparison outright — never converted', () => {
    assert.equal(classifyIssueSizePlausibility({ nevadaInvestmentNotional: 1000, nevadaCurrency: 'CLP', issueSize: 1000, issueSizeCurrency: 'USD' }), 'not_comparable')
    assert.equal(classifyIssueSizePlausibility({ nevadaInvestmentNotional: 1000, nevadaCurrency: null, issueSize: 1000, issueSizeCurrency: 'USD' }), 'not_comparable')
    // Mixed-currency allocations have no single Nevada currency.
    assert.equal(nevadaInvestmentCurrency([alloc({ entityName: 'A', currency: 'USD' }), alloc({ entityName: 'B', currency: 'CLP' })]), null)
    assert.equal(nevadaInvestmentCurrency([alloc({ currency: 'usd' })]), 'USD')
    // No FX conversion exists in this module.
    assert.doesNotMatch(CALC, /fxRate|convertCurrency|exchangeRate/i)
  })

  it('24-25. an indicative issue size cannot trigger anything; above-issue is only the review warning', () => {
    assert.equal(classifyIssueSizePlausibility({ nevadaInvestmentNotional: 9e9, nevadaCurrency: 'USD', issueSize: 1, issueSizeCurrency: 'USD', issueSizeBasis: 'indicative' }), 'not_comparable')
    assert.equal(classifyIssueSizePlausibility({ nevadaInvestmentNotional: 9e9, nevadaCurrency: 'USD', issueSize: 1, issueSizeCurrency: 'USD', issueSizeBasis: 'final' }), 'review')
    // The UI renders that case as an advisory line, never a blocking error.
    assert.match(DETAIL, /issueSizeComparison === 'review'/)
    assert.match(DETAIL, /role="status">⚠ \{t\.sn\.allocationMismatch\}/)
    assert.doesNotMatch(DETAIL, /issueSizeComparison[^\n]*role="alert"/)
  })

  it('26. XS3164820824 (real book data) is valid with the two sizes different', () => {
    // USD 1,000,000 held across three accounts against a USD 1,500,000
    // issuance. The removed rule raised a warning here; the new one is silent.
    const allocs = [
      alloc({ entityName: 'WATERMILL', notionalAmount: 500_000 }),
      alloc({ entityName: 'DUBAI', notionalAmount: 300_000 }),
      alloc({ entityName: 'STATEN', notionalAmount: 200_000 }),
    ]
    const nevada = calculateNevadaInvestmentNotional(allocs)
    assert.equal(nevada, 1_000_000)
    assert.equal(usd(nevada, 1_500_000), 'below', 'owning part of an issuance is the normal case')
    // The old expression is gone from both surfaces that carried it.
    assert.doesNotMatch(DETAIL, /Math\.abs\(allocationTotal - n\.issueSize\) > 0\.01/)
    assert.doesNotMatch(ALLOC_ROUTE, /Math\.abs\(allocationTotal - issueSize\) > 0\.01/)
    assert.doesNotMatch(DETAIL_CODE, /const mismatch =/)
  })

  it('27. no value is overwritten to force the two sizes to agree', () => {
    // Nothing writes issue_size outside the extraction/import path, and the
    // allocations route never patches the note.
    assert.doesNotMatch(ALLOC_ROUTE, /issue_size|updateStructuredNote/)
    assert.doesNotMatch(code('src/lib/db/repositories/structuredNotesRepository.ts'), /issue_size:\s*(allocation|nevada|total)/i)
    // Allocations are written from the user's input only.
    assert.match(REPO, /notional_amount: alloc\.notionalAmount/)
  })
})

// ── 28-37 · custodian exposure ───────────────────────────────────────────────

describe('R7.1B §28-37 — Exposure by Custodian', () => {
  it('28. a note contributes its whole position to its own custodian, exactly once', () => {
    const exp = calculateCustodianExposure([
      noteOf('Custodian X', [alloc({ entityName: 'A', notionalAmount: 600 }), alloc({ entityName: 'B', notionalAmount: 400 })]),
      noteOf('Custodian Y', [alloc({ entityName: 'C', notionalAmount: 400 })]),
    ])
    assert.deepEqual(exp.map((e) => [e.custodian, e.notional]), [['Custodian X', 1000], ['Custodian Y', 400]])
    assert.equal(exp.reduce((s, e) => s + e.notional, 0), 1400, 'no position is counted twice')
  })

  it('29. custodian and issuer exposure share one denominator', () => {
    const notes = [
      { issuerDisplayName: 'Citi', ...noteOf('Custodian X', [alloc({ entityName: 'A', notionalAmount: 600 }), alloc({ entityName: 'B', notionalAmount: 400 })]) },
      { issuerDisplayName: 'BNP', ...noteOf(null, [alloc({ entityName: 'C', notionalAmount: 250 })]) },
    ]
    const issuerTotal = calculateIssuerExposure(notes).reduce((s, e) => s + e.notional, 0)
    const custodianTotal = calculateCustodianExposure(notes).reduce((s, e) => s + e.notional, 0)
    const entityTotal = calculateEntityExposure(notes).reduce((s, e) => s + e.notional, 0)
    assert.equal(custodianTotal, issuerTotal)
    assert.equal(custodianTotal, entityTotal)
    assert.equal(custodianTotal, 1250)
  })

  it('30-31. notes with no custodian stay in the chart AND the denominator', () => {
    const exp = calculateCustodianExposure([
      noteOf('Custodian X', [alloc({ entityName: 'A', notionalAmount: 600 })]),
      noteOf(null, [alloc({ entityName: 'B', notionalAmount: 400 })]),
    ])
    assert.equal(exp.reduce((s, e) => s + e.notional, 0), 1000)
    const unavailable = exp.find((e) => e.custodian === null)
    assert.equal(unavailable?.notional, 400)
    assert.equal(exp[exp.length - 1].custodian, null, 'unavailable sorts last, never above a real custodian')
    // It is labelled honestly, and never substituted with issuer/entity/broker.
    assert.match(DASH, /e\.custodian \?\? t\.sn\.custodianUnavailable/)
    const en = /custodianUnavailable: '([^']+)'/.exec(I18N)?.[1]
    assert.equal(en, 'Custodian unavailable')
  })

  it('32. a note is counted exactly once', () => {
    const exp = calculateCustodianExposure([noteOf('Custodian X', [alloc({ entityName: 'A', notionalAmount: 100 })])])
    assert.equal(exp.length, 1)
    assert.equal(exp[0].notional, 100)
    assert.equal(exp[0].noteCount, 1)
  })

  it('33. inactive allocations and archived notes are filtered exactly as issuer exposure filters them', () => {
    // An archived note contributes 0 through the shared calculateCurrentNotional
    // gate — identical treatment to issuer exposure.
    const archived = [{ issuerDisplayName: 'Citi', ...noteOf('Custodian X', [alloc({ notionalAmount: 500 })], 'autocalled') }]
    assert.equal(calculateCustodianExposure(archived)[0].notional, 0)
    assert.equal(calculateIssuerExposure(archived)[0].notional, 0, 'issuer exposure likewise contributes 0')
    const inactive = [noteOf('Custodian X', [alloc({ entityName: 'A', notionalAmount: 500, active: false })])]
    assert.equal(calculateCustodianExposure(inactive)[0].notional, 0)
    for (const st of ['matured', 'cancelled'] as const) {
      assert.equal(calculateCustodianExposure([noteOf('Custodian X', [alloc()], st)])[0].notional, 0)
    }
  })

  it('34. the currency basis is the issuer chart\'s basis — unconverted, with the same mixed-currency flag', () => {
    const { summary } = buildBookDashboard([], new Map(), null, '2027-01-01')
    assert.ok('custodianExposure' in summary)
    assert.ok('mixedCurrency' in summary)
    assert.match(read('src/lib/structuredNotes/dashboard.ts'), /custodianExposure: calculateCustodianExposure\(notes\.map\(\(n\) => \(\{ custodian: n\.custodian, status: n\.status, allocations: n\.allocations \}\)\)\)/)
    assert.doesNotMatch(CALC, /export function calculateCustodianExposure[\s\S]{0,2000}?convert/i)
  })

  it('35. the card reuses the existing Fable primitives — no new chart library', () => {
    assert.match(DASH, /title=\{t\.sn\.exposureByCustodian\}/)
    // Same ExposureHeader + BarChart the issuer card uses.
    const card = DASH.slice(DASH.indexOf('t.sn.exposureByCustodian') - 600, DASH.indexOf('t.sn.exposureByCustodian') + 900)
    assert.match(card, /<ExposureHeader/)
    assert.match(card, /<BarChart/)
    assert.match(card, /<GlassSurface variant="card"/)
    assert.doesNotMatch(DASH, /from 'recharts'|from 'chart\.js'|from 'd3'/)
  })

  it('36-37. R7.1A responsive behavior is intact and legend amounts cannot overflow', () => {
    // The donut card keeps its container-query stacking (R7.1A).
    assert.match(DASH, /<div className="@container">/)
    assert.match(DASH, /flex flex-col items-center gap-4 @lg:flex-row @lg:gap-6/)
    assert.match(DASH, /className="w-full text-xs space-y-0\.5 min-w-0 @lg:flex-1"/)
    // R7.1B.1 layout — the two ranked lists stack in a narrower left column
    // with the allocation donut beside them at lg+, and everything collapses
    // to one column below lg. Every column can shrink (min-w-0), so a long
    // label truncates inside its card instead of widening the page.
    assert.match(DASH, /grid grid-cols-1 lg:grid-cols-\[minmax\(0,5fr\)_minmax\(0,7fr\)\] items-start gap-3\.5 mb-3\.5/)
    assert.match(DASH, /<div className="flex flex-col gap-3\.5 min-w-0">/)
    const issuerIdx = DASH.indexOf('t.sn.exposureByIssuer')
    const custodianIdx = DASH.indexOf('t.sn.exposureByCustodian')
    const entityIdx = DASH.indexOf('t.sn.exposureByEntity')
    assert.ok(issuerIdx < custodianIdx, 'issuer sits above custodian in the left column')
    assert.ok(custodianIdx < entityIdx, 'the allocation chart follows both lists')
    // The old three-abreast wrap rule is gone.
    assert.doesNotMatch(DASH, /flex: '1 1 340px', minWidth: 'min\(100%, 300px\)'/)
    // BarChart rows: truncating label + its own value span (shared component,
    // so issuer and custodian behave identically).
    const bar = DASH.slice(DASH.indexOf('function BarChart'), DASH.indexOf('function Donut'))
    assert.match(bar, /truncate/)
    assert.match(bar, /whitespace-nowrap ui-number/)
  })
})

// ── 38-60 · delete controls ──────────────────────────────────────────────────

describe('R7.1B §38-60 — note deletion from both surfaces', () => {
  it('38. the dashboard table has a far-right Actions column', () => {
    const headRow = DASH.slice(DASH.indexOf('<thead>'), DASH.indexOf('</thead>'))
    const lastHeader = headRow.lastIndexOf('<th')
    assert.ok(headRow.slice(lastHeader).includes('t.sn.colActions'), 'Actions is the LAST header cell')
    // The fixed-column system accounts for it (R3 density contract).
    assert.match(DASH, /56,\s*\/\/ R7\.1B actions/)
    const cols = /const COLS: number\[\] = \[([\s\S]*?)\n  \]/.exec(DASH)?.[1] ?? ''
    const entries = cols.split('\n').map((l) => l.trim()).filter((l) => l.includes(','))
    assert.equal(entries.length, 13, `COLS must enumerate every column (found ${entries.length})`)
    assert.ok(entries[entries.length - 1].startsWith('56,'), 'the actions column is last in the column system')
  })

  it('39-40. each row has an accessible trash button that cannot navigate', () => {
    const anchor = DASH.indexOf('aria-label={`${t.sn.delete}')
    const cell = DASH.slice(anchor - 500, anchor + 700)
    assert.match(cell, /type="button"/)
    assert.match(cell, /title=\{t\.sn\.delete\}/)
    assert.match(cell, /aria-label=\{`\$\{t\.sn\.delete\}: \$\{n\.productName \|\| n\.isin \|\| ''\}`\}/)
    assert.match(cell, /w-8 h-8/, 'touch target')
    assert.match(cell, /aria-hidden="true"/, 'the icon itself is decorative')
    // The row handler skips interactive elements, so the trash never routes.
    assert.match(DASH, /if \(\(e\.target as HTMLElement\)\.closest\('a, button, input, label'\)\) return/)
    // It opens the dialog; it does not delete.
    assert.match(cell, /setPendingDelete\(n\)/)
    assert.doesNotMatch(cell, /fetch\(|method: 'DELETE'/)
  })

  it('41-42. both surfaces delete through the same shared destructive confirmation', () => {
    for (const [name, src] of [['dashboard', DASH], ['detail', DETAIL]] as const) {
      assert.match(src, /import \{ DestructiveConfirm \} from '@\/components\/fable\/ModalShell'/, `${name} uses the shared dialog`)
      assert.match(src, /<DestructiveConfirm/, `${name} renders it`)
      assert.match(src, /method: 'DELETE'/, `${name} calls the same contract`)
      assert.match(src, /\/api\/structured-notes\/\$\{[^}]+\}`, \{ method: 'DELETE' \}/, `${name} hits the same endpoint`)
    }
    // The confirmation identifies the real record on both surfaces.
    for (const src of [DASH, DETAIL]) {
      assert.match(src, /t\.sn\.nevadaInvestment\}: /)
      assert.match(src, /\.filter\(Boolean\)\.join\(' · '\)/)
    }
  })

  it('43-46. cancel/Escape never mutate; confirm fires exactly once', () => {
    const shell = read('src/components/fable/ModalShell.tsx')
    assert.match(shell, /const firedRef = useRef\(false\)/)
    assert.match(shell, /if \(pending \|\| firedRef\.current\) return/)
    assert.match(shell, /firedRef\.current = true\s*\n\s*onConfirm\(\)/)
    // Cancel/Escape route to onCancel, which only closes the dialog.
    assert.match(shell, /useEscape\(open && canDismiss, onClose\)/)
    assert.match(DASH, /onCancel=\{\(\) => setPendingDelete\(null\)\}/)
    assert.match(DETAIL, /onCancel=\{\(\) => setConfirmingDelete\(false\)\}/)
    // Pending locks the dialog and the confirm button.
    assert.match(shell, /dismissDisabled=\{pending\}/)
    assert.match(DASH, /pending=\{deleting\}/)
    assert.match(DETAIL, /pending=\{deleting\}/)
  })

  it('47-50. success removes the row / redirects, and both exposure aggregates recompute', () => {
    // Dashboard: closes the dialog and reloads the book (server recomputes
    // issuer AND custodian exposure in the same summary payload).
    assert.match(DASH, /setPendingDelete\(null\)\s*\n\s*await load\(\)/)
    assert.match(read('src/lib/structuredNotes/dashboard.ts'), /issuerExposure: calculateIssuerExposure/)
    assert.match(read('src/lib/structuredNotes/dashboard.ts'), /custodianExposure: calculateCustodianExposure/)
    assert.match(DASH, /setSummary\(json\.summary \?\? null\)/)
    // Detail: redirects to the canonical dashboard route on success only.
    assert.match(DETAIL, /if \(!res\.ok\) \{ setDeleteFailed\(true\); return \}\s*\n\s*router\.push\('\/structured-notes'\)/)
  })

  it('51. a failed deletion preserves the row and the page, and permits retry', () => {
    assert.match(DASH, /catch \{\s*\n\s*setDeleteFailed\(true\)/)
    assert.match(DETAIL, /catch \{\s*\n\s*setDeleteFailed\(true\)/)
    // The dashboard keeps `pendingDelete` set on failure (dialog stays open,
    // row untouched) — it is only cleared on success or cancel.
    const fn = DASH.slice(DASH.indexOf('async function confirmDeleteNote'), DASH.indexOf('async function handleFile'))
    assert.ok(!/setPendingDelete\(null\)/.test(fn.slice(0, fn.indexOf('if (!res.ok)'))), 'nothing is cleared before the response')
    assert.match(fn, /if \(!res\.ok\) \{ setDeleteFailed\(true\); return \}/)
    for (const src of [DASH, DETAIL]) assert.match(src, /\{t\.sn\.deleteError\}/)
  })

  it('52-53. unauthenticated and unapproved deletion is rejected before the handler', () => {
    const policy = read('src/lib/auth/accessPolicy.ts')
    // Default-deny: /api/* not on the public list is private_api (JSON 401).
    assert.match(policy, /if \(matchesAny\(pathname, PUBLIC_API_PATHS\)\) return 'public_api'\s*\n\s*return 'private_api'/)
    const publicList = /export const PUBLIC_API_PATHS = \[([\s\S]*?)\]/.exec(policy)?.[1] ?? ''
    assert.ok(!publicList.includes('structured-notes'), 'the module is never public')
    // The handler additionally runs on the RLS-scoped user client.
    assert.match(NOTE_ROUTE, /getSupabaseUserClient\(\)/)
    assert.doesNotMatch(NOTE_ROUTE, /getSupabaseAdminClient|SERVICE_ROLE/)
  })

  it('54. an unknown note returns a controlled not-found', () => {
    assert.match(REPO, /if \(existing\.data == null\) return 'not_found'/)
    assert.match(NOTE_ROUTE, /if \(result === 'not_found'\) return NextResponse\.json\(\{ error: 'not_found' \}, \{ status: 404 \}\)/)
    assert.match(NOTE_ROUTE, /if \(!id \|\| typeof id !== 'string'\) return NextResponse\.json\(\{ error: 'invalid_id' \}, \{ status: 400 \}\)/)
  })

  it('55-58. dependent records follow the documented contract; nothing shared or orphaned', () => {
    // Every note-scoped child cascades — no orphaned allocation is possible.
    for (const child of [
      'structured_note_underlyings', 'structured_note_observations',
      'structured_note_allocations', 'structured_note_price_snapshots',
    ]) {
      const block = MIGRATION.slice(MIGRATION.indexOf(`create table if not exists ${child}`), MIGRATION.indexOf(`create table if not exists ${child}`) + 900)
      assert.match(block, /note_id\s+uuid not null references structured_notes\(id\) on delete cascade/, `${child} must cascade`)
    }
    // The extraction audit trail is preserved but detached.
    assert.match(MIGRATION, /extracted_note_id\s+uuid references structured_notes\(id\) on delete set null/)
    // Monitoring runs are book-level (shared) — no note FK at all.
    const monitoring = read('supabase/migrations/20260709000000_structured_notes_monitoring.sql')
    const monBlock = monitoring.slice(monitoring.indexOf('create table if not exists structured_note_monitoring_runs'))
    assert.doesNotMatch(monBlock.slice(0, 800), /note_id\s+uuid not null references structured_notes/)
    // The repository documents each category rather than relying on it silently.
    assert.match(REPO, /delete with note/)
    assert.match(REPO, /preserve but detach/)
    assert.match(REPO, /preserve, shared/)
    // Custodians and entities are text attributes, not shared records that
    // could be deleted; the module owns no document store.
    assert.doesNotMatch(MIGRATION, /create table if not exists (custodians|structured_note_documents)/)
  })

  it('59. no stack trace, SQL, or path is exposed by any delete response', () => {
    const responses = [...NOTE_ROUTE.matchAll(/NextResponse\.json\(([^;]*?)\)/g)].map((m) => m[1])
    for (const r of responses) {
      assert.doesNotMatch(r, /error\.message|err\.message|stack|\.details|process\.env|supabase|from\(/i, `leaky response: ${r}`)
    }
    assert.match(NOTE_ROUTE, /\{ error: 'delete_failed' \}/)
    assert.doesNotMatch(REPO, /console\.(log|error)/)
  })

  it('60. no native alert, confirm, or prompt is introduced', () => {
    for (const src of [DASH, DETAIL, ALLOC_ROUTE, NOTE_ROUTE, REPO, read('src/components/fable/ModalShell.tsx')]) {
      assert.doesNotMatch(src, /window\.(alert|confirm|prompt)\(/)
    }
  })
})

// ── 61-68 · regression ───────────────────────────────────────────────────────

describe('R7.1B §61-68 — regression', () => {
  it('61. the settlement/lifecycle gate is unchanged', () => {
    // Archived statuses and the current-notional rule are untouched.
    assert.match(read('src/lib/structuredNotes/types.ts'), /ARCHIVED_STATUSES/)
    assert.match(CALC, /if \(note\.status === 'autocalled' \|\| note\.status === 'matured' \|\| note\.status === 'cancelled'\) return 0/)
    assert.match(DASH, /const isArchived = \(n: StructuredNote\) => ARCHIVED_STATUSES\.includes\(n\.status\)/)
    assert.match(DASH, /status: called \? 'autocalled' : 'active'/)
  })

  it('62. the issuer exposure card is unchanged', () => {
    assert.match(DASH, /title=\{t\.sn\.exposureByIssuer\}/)
    assert.match(DASH, /data=\{summary\.issuerExposure\.map\(\(e\) => \(\{ label: e\.issuer, value: e\.notional \}\)\)\}/)
    assert.match(CALC, /export function calculateIssuerExposure/)
    // Its own math still runs off currentNotional.
    assert.match(CALC, /const notional = calculateCurrentNotional\(n, n\.allocations\)/)
  })

  it('63-64. the R7.1A mobile shell and overlay opacity are untouched', () => {
    const topbar = read('src/components/layout/TopBar.tsx')
    assert.match(topbar, /<div className="flex items-center gap-2\.5 shrink-0">/)
    assert.doesNotMatch(topbar, /\babsolute\b|\bfixed\b|\bz-\[/)
    const css = read('src/app/globals.css')
    assert.match(css, /background: var\(--nv-overlay-fill\)/)
    for (const decl of [...css.matchAll(/--nv-overlay-fill:[^;]+;/g)].map((m) => m[0])) {
      for (const a of [...decl.matchAll(/rgba\([^)]*?,\s*(\.\d+)\)/g)].map((m) => Number(m[1]))) {
        assert.ok(a >= 0.92, `overlay alpha ${a} must stay >= .92`)
      }
    }
    assert.match(read('src/components/layout/MobileNavDrawer.tsx'), /\{t\.auth\.signedInAs\}/)
  })

  it('65. EN and ES labels are complete and distinct for every new key', () => {
    for (const key of [
      'exposureByCustodian', 'custodianUnavailable', 'custodianHelp',
      'totalIssuanceSize', 'totalIssuanceSizeHelp', 'nevadaInvestment',
      'nevadaInvestmentHelp', 'accountNotional', 'accountNotionalHelp', 'accountAllocations',
      'colActions', 'saveError', 'custodian',
    ]) {
      const vals = [...I18N.matchAll(new RegExp(`${key}: '([^']+)'`, 'g'))].map((m) => m[1])
      assert.equal(vals.length, 2, `${key} must exist in EN and ES (found ${vals.length})`)
      assert.notEqual(vals[0], vals[1], `${key} must be translated, not duplicated`)
    }
    // The reworded warning no longer claims the two sizes must match.
    const warn = [...I18N.matchAll(/allocationMismatch: '([^']+)'/g)].map((m) => m[1])
    assert.equal(warn.length, 2)
    assert.doesNotMatch(warn[0], /do not match/i)
    assert.match(warn[0], /exceeds/i)
  })

  it('66. new UI is token-driven in both themes — no hardcoded colors', () => {
    const custodianCard = DASH.slice(DASH.indexOf('t.sn.exposureByCustodian') - 400, DASH.indexOf('t.sn.exposureByCustodian') + 800)
    const trashCell = DASH.slice(DASH.indexOf('aria-label={`${t.sn.delete}') - 400, DASH.indexOf('aria-label={`${t.sn.delete}') + 800)
    const allocRow = DETAIL.slice(DETAIL.indexOf('function EntityRow'), DETAIL.indexOf('function EntityRow') + 3000)
    const custodianField = DETAIL.slice(DETAIL.indexOf('function CustodianField'), DETAIL.indexOf('function EntityRow'))
    for (const [name, block] of [['custodian card', custodianCard], ['trash cell', trashCell], ['allocation row', allocRow], ['custodian field', custodianField]] as const) {
      assert.doesNotMatch(block, /#[0-9a-fA-F]{6}\b/, `${name} must not hardcode a color`)
      assert.doesNotMatch(block, /\b(bg|text|border)-(gray|slate|zinc|emerald|red|blue)-\d{2,3}\b/, `${name} must not use a raw scale`)
    }
    assert.match(trashCell, /color: 'var\(--negative\)'/)
    // An unrecorded custodian is flagged with the warning token, not a hex.
    assert.match(custodianField, /var\(--warning\)/)
  })

  it('67. no unrelated route is redesigned', () => {
    // Only the two structured-notes surfaces changed among app pages.
    assert.match(DASH, /export default function StructuredNotesPage/)
    assert.match(DETAIL, /export default function StructuredNoteDetailPage/)
    // The custodian/delete work introduces no cross-module import.
    for (const src of [DASH_CODE, DETAIL_CODE]) {
      assert.doesNotMatch(src, /@\/app\/(compare|macro|stocks|portfolio|watchlist)/)
    }
  })

  it('68. no mock portfolio data is introduced', () => {
    for (const [name, src] of [['dashboard', DASH_CODE], ['detail', DETAIL_CODE], ['calculations', code('src/lib/structuredNotes/calculations.ts')], ['repository', code('src/lib/db/repositories/structuredNotesRepository.ts')]] as const) {
      assert.doesNotMatch(src, /sampleCustodian|MOCK_|FAKE_|demoNote|placeholderNotional/i, `${name} must not carry fixtures`)
    }
    // The custodian suggestion list comes from stored notes, never a shipped roster.
    assert.match(REPO, /from\('structured_notes'\)\.select\('custodian'\)/)
    assert.doesNotMatch(REPO, /const (KNOWN|DEFAULT)_CUSTODIANS/)
  })
})
