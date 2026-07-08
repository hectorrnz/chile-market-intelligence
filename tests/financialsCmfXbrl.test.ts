// Phase 8C.2 — CMF/XBRL automated financials ingestion tests.
//
// Covers the new pure modules end to end with NO live network:
//   - unzip.ts        (ZIP round-trip via in-memory archives, taxonomy-only
//                      rejection, path-traversal + size guards, instance pick)
//   - periodClassify  (target period build, context classification, current-
//                      period id selection — YTD vs annual vs comparative)
//   - conceptMap      (extended concepts + confidence, no fabricated EBITDA)
//   - validateFinancials (balance-sheet identity, chronology, warning codes)
//   - cmfXbrlProvider normalize (period-matched, current-context-only) against
//     the committed synthetic .xbrl fixture wrapped in an in-memory ZIP
//   - cron/status route + orchestrator hygiene (grep-based, no network)
//
// The ZIP fixtures are BUILT IN MEMORY here (deflateRaw) rather than committed
// as binaries — matching the "sanitized fixtures only, minimal content" rule.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

import { unzip, findXbrlInstance, isTaxonomyOnlyArchive, looksLikeZip, MAX_ZIP_BYTES } from '../src/lib/financials/xbrl/unzip.ts'
import { buildTargetPeriod, classifyContext, currentPeriodContextIds } from '../src/lib/financials/xbrl/periodClassify.ts'
import { mapConcept, XBRL_CONCEPT_MAP, KNOWN_UNMAPPED_CONCEPTS } from '../src/lib/financials/xbrl/conceptMap.ts'
import { validateNormalizedFinancials } from '../src/lib/financials/xbrl/validateFinancials.ts'
import { parseXbrlInstance } from '../src/lib/financials/xbrl/parseXbrl.ts'
import { cmfXbrlProvider, buildFilingRefs, candidateAnnualPeriods, countUnmappedPlainConcepts, instanceFromParsed } from '../src/lib/financials/providers/cmfXbrlProvider.ts'
import { CMF_ISSUER_MAP, UNMAPPED_TICKERS, getCmfIssuer, isCmfIssuerMapped, getMappedTickers } from '../src/lib/financials/cmfIssuerMap.ts'
import type { FinancialParsedFiling } from '../src/lib/financials/providers/types.ts'

const SAMPLE_XBRL = readFileSync(fileURLToPath(new URL('fixtures/cmf/sample_instance.xbrl', import.meta.url)), 'utf8')

// ── In-memory ZIP builder (deflate) — enough for the unzip reader ────────────
function makeZip(entries: { name: string; content: string }[]): Buffer {
  const localParts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const raw = Buffer.from(e.content, 'utf8')
    const comp = deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(8, 8) // method: deflate
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12) // time/date
    local.writeUInt32LE(0, 14) // crc (unverified by our reader)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len
    localParts.push(local, nameBuf, comp)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(0, 16)
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32) // extra/comment
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36) // disk/internal
    cd.writeUInt32LE(0, 38) // external attrs
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)
    offset += local.length + nameBuf.length + comp.length
  }
  const cdBuf = Buffer.concat(central)
  const localBuf = Buffer.concat(localParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(localBuf.length, 16)
  return Buffer.concat([localBuf, cdBuf, eocd])
}

describe('unzip — dependency-free ZIP reader', () => {
  it('round-trips a multi-entry deflate archive', () => {
    const zip = makeZip([
      { name: 'x.xbrl', content: SAMPLE_XBRL },
      { name: 'x.xsd', content: '<schema/>' },
      { name: 'x-definition.xml', content: '<def/>' },
    ])
    assert.equal(looksLikeZip(zip), true)
    const res = unzip(zip)
    assert.ok(res.ok)
    if (res.ok) {
      assert.equal(res.entries.length, 3)
      const inst = res.entries.find((e) => e.ext === 'xbrl')
      assert.equal(inst?.data.toString('utf8'), SAMPLE_XBRL)
    }
  })
  it('findXbrlInstance picks the .xbrl entry', () => {
    const zip = makeZip([{ name: 'a.xsd', content: '<s/>' }, { name: 'b.xbrl', content: SAMPLE_XBRL }])
    const res = unzip(zip)
    assert.ok(res.ok)
    if (res.ok) assert.equal(findXbrlInstance(res.entries)?.name, 'b.xbrl')
  })
  it('rejects a taxonomy-only archive (no .xbrl instance) — never treated as a filing', () => {
    const zip = makeZip([{ name: 'taxonomy.xsd', content: '<s/>' }, { name: 'labels.xml', content: '<l/>' }])
    const res = unzip(zip)
    assert.ok(res.ok)
    if (res.ok) {
      assert.equal(isTaxonomyOnlyArchive(res.entries), true)
      assert.equal(findXbrlInstance(res.entries), null)
    }
  })
  it('rejects a non-zip buffer', () => {
    const res = unzip(Buffer.from('not a zip at all'))
    assert.ok(!res.ok)
    if (!res.ok) assert.equal(res.error.code, 'not_a_zip')
  })
  it('rejects an oversized archive before parsing', () => {
    const big = Buffer.alloc(MAX_ZIP_BYTES + 1)
    big.writeUInt32LE(0x04034b50, 0)
    const res = unzip(big)
    assert.ok(!res.ok)
    if (!res.ok) assert.equal(res.error.code, 'too_large')
  })
  it('rejects an unsafe (path-traversal) entry name', () => {
    const zip = makeZip([{ name: '../../etc/passwd.xbrl', content: SAMPLE_XBRL }])
    const res = unzip(zip)
    assert.ok(!res.ok)
    if (!res.ok) assert.equal(res.error.code, 'unsafe_entry_name')
  })
  it('rejects an absolute-path entry name', () => {
    const zip = makeZip([{ name: '/evil.xbrl', content: 'x' }])
    const res = unzip(zip)
    assert.ok(!res.ok)
    if (!res.ok) assert.equal(res.error.code, 'unsafe_entry_name')
  })
})

describe('periodClassify — target period + context roles', () => {
  it('builds an annual target for mm=12', () => {
    const t = buildTargetPeriod('12', '2023')
    assert.equal(t?.fiscalPeriod, 'FY')
    assert.equal(t?.periodType, 'annual')
    assert.equal(t?.periodNature, 'annual')
    assert.equal(t?.periodEndDate, '2023-12-31')
    assert.equal(t?.periodStartDate, '2023-01-01')
  })
  it('builds a quarterly-discrete target for Q1 (mm=03) — YTD == discrete', () => {
    const t = buildTargetPeriod('03', '2024')
    assert.equal(t?.fiscalPeriod, 'Q1')
    assert.equal(t?.periodNature, 'quarterly_discrete')
    assert.equal(t?.periodEndDate, '2024-03-31')
  })
  it('builds a year_to_date target for Q2/Q3 (cumulative income), period_type stays quarterly for supersession', () => {
    const q2 = buildTargetPeriod('06', '2024')
    assert.equal(q2?.fiscalPeriod, 'Q2')
    assert.equal(q2?.periodType, 'quarterly') // matches manual-CSV vocabulary → supersession still groups them
    assert.equal(q2?.periodNature, 'year_to_date')
    assert.equal(q2?.periodEndDate, '2024-06-30')
  })
  it('rejects a non-quarter-end month', () => {
    assert.equal(buildTargetPeriod('07', '2024'), null)
  })
  it('classifies the current annual duration and current instant, excluding prior-year comparatives', () => {
    const target = buildTargetPeriod('12', '2023')!
    const currentDur = { id: 'p1_Duration', entityIdentifier: null, instant: null, startDate: '2023-01-01', endDate: '2023-12-31', dimensions: [] }
    const currentInst = { id: 'p1_Instant', entityIdentifier: null, instant: '2023-12-31', startDate: null, endDate: null, dimensions: [] }
    const priorDur = { id: 'p2_Duration', entityIdentifier: null, instant: null, startDate: '2022-01-01', endDate: '2022-12-31', dimensions: [] }
    const priorInst = { id: 'p2_Instant', entityIdentifier: null, instant: '2022-12-31', startDate: null, endDate: null, dimensions: [] }
    assert.equal(classifyContext(currentDur, target), 'current_duration')
    assert.equal(classifyContext(currentInst, target), 'current_instant')
    assert.equal(classifyContext(priorDur, target), 'comparative')
    assert.equal(classifyContext(priorInst, target), 'comparative')
  })
  it('classifies a discrete-quarter duration (ends on target end, starts later than Jan 1)', () => {
    const target = buildTargetPeriod('06', '2024')!
    const discrete = { id: 'p6', entityIdentifier: null, instant: null, startDate: '2024-04-01', endDate: '2024-06-30', dimensions: [] }
    assert.equal(classifyContext(discrete, target), 'current_discrete_quarter')
  })
  it('currentPeriodContextIds returns only the current duration + instant', () => {
    const target = buildTargetPeriod('12', '2023')!
    const contexts = [
      { id: 'dur', entityIdentifier: null, instant: null, startDate: '2023-01-01', endDate: '2023-12-31', dimensions: [] },
      { id: 'inst', entityIdentifier: null, instant: '2023-12-31', startDate: null, endDate: null, dimensions: [] },
      { id: 'prior', entityIdentifier: null, instant: null, startDate: '2022-01-01', endDate: '2022-12-31', dimensions: [] },
    ]
    const { durationIds, instantIds } = currentPeriodContextIds(contexts, target)
    assert.deepEqual([...durationIds], ['dur'])
    assert.deepEqual([...instantIds], ['inst'])
  })
})

describe('conceptMap — extended, confidence-tagged, no fabrication', () => {
  it('maps core income/balance/cash concepts at high confidence', () => {
    assert.equal(mapConcept('ifrs-full:Revenue')?.lineItemCode, 'revenue')
    assert.equal(mapConcept('ifrs-full:Revenue')?.confidence, 'high')
    assert.equal(mapConcept('ifrs-full:Assets')?.lineItemCode, 'total_assets')
    assert.equal(mapConcept('ifrs-full:CashFlowsFromUsedInInvestingActivities')?.lineItemCode, 'cash_flow_from_investing')
  })
  it('maps parent-attributable net income distinctly from total net income', () => {
    assert.equal(mapConcept('ifrs-full:ProfitLoss')?.lineItemCode, 'net_income')
    assert.equal(mapConcept('ifrs-full:ProfitLossAttributableToOwnersOfParent')?.lineItemCode, 'net_income_attributable_to_parent')
  })
  it('never maps any concept to a fabricated ebitda line item', () => {
    for (const entry of Object.values(XBRL_CONCEPT_MAP)) assert.notEqual(entry.lineItemCode, 'ebitda')
  })
  it('leaves an ambiguous note-only concept unmapped', () => {
    assert.equal(mapConcept('ifrs-full:AccountingProfit'), null)
  })
  it('every entry carries an explicit confidence', () => {
    for (const [concept, entry] of Object.entries(XBRL_CONCEPT_MAP)) {
      assert.ok(['high', 'medium', 'low', 'review_required'].includes(entry.confidence), `${concept} has an invalid confidence`)
    }
  })
})

describe('conceptMap — Phase 8C.3 debt/shares additions (verified via additive identity in real filings)', () => {
  it('maps the debt trio to distinct line items, all high confidence', () => {
    assert.equal(mapConcept('ifrs-full:Borrowings')?.lineItemCode, 'total_debt')
    assert.equal(mapConcept('ifrs-full:LongtermBorrowings')?.lineItemCode, 'long_term_debt')
    assert.equal(mapConcept('ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings')?.lineItemCode, 'short_term_debt')
    for (const c of ['ifrs-full:Borrowings', 'ifrs-full:LongtermBorrowings', 'ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings']) {
      assert.equal(mapConcept(c)?.confidence, 'high')
    }
  })
  it('maps shares outstanding at high confidence', () => {
    assert.equal(mapConcept('ifrs-full:NumberOfSharesOutstanding')?.lineItemCode, 'shares_outstanding')
    assert.equal(mapConcept('ifrs-full:NumberOfSharesOutstanding')?.confidence, 'high')
  })
  it('maps the capex/dividends concept variants actually used by real Chilean filers, at high confidence', () => {
    assert.equal(mapConcept('ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities')?.lineItemCode, 'capex')
    assert.equal(mapConcept('ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities')?.confidence, 'high')
    assert.equal(mapConcept('ifrs-full:DividendsPaidClassifiedAsFinancingActivities')?.lineItemCode, 'dividends_paid')
    assert.equal(mapConcept('ifrs-full:DividendsPaidClassifiedAsFinancingActivities')?.confidence, 'high')
  })
  it('never maps NetDebt to total_debt — a distinct metric, verified NOT equal to gross Borrowings in a real filing', () => {
    assert.equal(mapConcept('ifrs-full:NetDebt'), null)
    assert.ok('ifrs-full:NetDebt' in KNOWN_UNMAPPED_CONCEPTS)
  })
  it('never maps the narrower/inconsistent current-debt sub-concepts (double-count/understate risk)', () => {
    assert.equal(mapConcept('ifrs-full:ShorttermBorrowings'), null)
    assert.equal(mapConcept('ifrs-full:CurrentPortionOfLongtermBorrowings'), null)
    assert.ok('ifrs-full:ShorttermBorrowings' in KNOWN_UNMAPPED_CONCEPTS)
    assert.ok('ifrs-full:CurrentPortionOfLongtermBorrowings' in KNOWN_UNMAPPED_CONCEPTS)
  })
})

describe('validateFinancials — quality checks', () => {
  const okFacts = [
    { lineItemCode: 'total_assets', statementType: 'balance', value: 100, unit: 'USD', currency: 'USD' },
    { lineItemCode: 'total_liabilities', statementType: 'balance', value: 60, unit: 'USD', currency: 'USD' },
    { lineItemCode: 'equity', statementType: 'balance', value: 40, unit: 'USD', currency: 'USD' },
  ]
  it('passes a clean annual filing whose balance-sheet identity holds', () => {
    const r = validateNormalizedFinancials({ facts: okFacts, currency: 'USD', periodStartDate: '2023-01-01', periodEndDate: '2023-12-31', periodNature: 'annual', unmappedConceptCount: 0 })
    assert.equal(r.status, 'valid')
  })
  it('flags a balance-sheet identity mismatch as review_required', () => {
    const bad = [{ ...okFacts[0], value: 100 }, { ...okFacts[1], value: 60 }, { ...okFacts[2], value: 10 }]
    const r = validateNormalizedFinancials({ facts: bad, currency: 'USD', periodStartDate: '2023-01-01', periodEndDate: '2023-12-31', periodNature: 'annual', unmappedConceptCount: 0 })
    assert.equal(r.status, 'review_required')
    assert.ok(r.warnings.some((w) => w.code === 'BALANCE_SHEET_IDENTITY_MISMATCH'))
  })
  it('flags a non-finite value as invalid', () => {
    const r = validateNormalizedFinancials({ facts: [{ lineItemCode: 'revenue', statementType: 'income', value: Infinity, unit: 'USD', currency: 'USD' }], currency: 'USD', periodStartDate: '2023-01-01', periodEndDate: '2023-12-31', periodNature: 'annual', unmappedConceptCount: 0 })
    assert.equal(r.status, 'invalid')
    assert.ok(r.warnings.some((w) => w.code === 'NON_FINITE_VALUE'))
  })
  it('flags reversed period chronology as invalid', () => {
    const r = validateNormalizedFinancials({ facts: okFacts, currency: 'USD', periodStartDate: '2023-12-31', periodEndDate: '2023-01-01', periodNature: 'annual', unmappedConceptCount: 0 })
    assert.equal(r.status, 'invalid')
    assert.ok(r.warnings.some((w) => w.code === 'PERIOD_CHRONOLOGY_INVALID'))
  })
  it('flags a missing currency as review_required', () => {
    const r = validateNormalizedFinancials({ facts: okFacts, currency: null, periodStartDate: '2023-01-01', periodEndDate: '2023-12-31', periodNature: 'annual', unmappedConceptCount: 0 })
    assert.equal(r.status, 'review_required')
    assert.ok(r.warnings.some((w) => w.code === 'CURRENCY_MISSING'))
  })
  it('emits DERIVED_QUARTER_VALUE for a year-to-date period', () => {
    const r = validateNormalizedFinancials({ facts: okFacts, currency: 'USD', periodStartDate: '2024-01-01', periodEndDate: '2024-06-30', periodNature: 'year_to_date', unmappedConceptCount: 0 })
    assert.ok(r.warnings.some((w) => w.code === 'DERIVED_QUARTER_VALUE'))
  })
  it('emits UNMAPPED_CONCEPTS when raw concepts went unmapped (preserved as a signal)', () => {
    const r = validateNormalizedFinancials({ facts: okFacts, currency: 'USD', periodStartDate: '2023-01-01', periodEndDate: '2023-12-31', periodNature: 'annual', unmappedConceptCount: 42 })
    assert.ok(r.warnings.some((w) => w.code === 'UNMAPPED_CONCEPTS'))
  })
})

describe('cmfXbrlProvider.normalize — period-matched, current-context-only (against the synthetic fixture)', () => {
  const instance = parseXbrlInstance(SAMPLE_XBRL)
  const parsed: FinancialParsedFiling = {
    ref: { ticker: 'SQM-B', sourceType: 'xbrl', locator: 'https://example/entidad', fiscalYear: 2024, fiscalPeriod: 'FY', periodType: 'annual', description: 'test' },
    facts: { instance: instance as unknown as Record<string, unknown> },
    warnings: [],
  }

  it('produces one row per line item on the current period (annual duration + year-end instant)', () => {
    const res = cmfXbrlProvider.normalizeToFinancialImportPayload(parsed)
    assert.ok(res.ok)
    if (!res.ok) return
    const codes = res.value.statementItems.map((i) => i.lineItemCode).sort()
    assert.ok(codes.includes('revenue'))
    assert.ok(codes.includes('total_assets'))
    assert.ok(codes.includes('ocf'))
    // exactly one revenue (the segment-dimensional Revenue is excluded by plainFacts)
    assert.equal(res.value.statementItems.filter((i) => i.lineItemCode === 'revenue').length, 1)
    // reporting period carries honest annual metadata
    const p = res.value.reportingPeriods[0]
    assert.equal(p.periodNature, 'annual')
    assert.equal(p.periodType, 'annual')
    assert.equal(p.periodEndDate, '2024-12-31')
    assert.equal(p.periodStartDate, '2024-01-01')
    assert.equal(p.sourceType, 'xbrl')
  })
  it('attaches raw XBRL provenance (source concept, context, confidence) into each row metadata', () => {
    const res = cmfXbrlProvider.normalizeToFinancialImportPayload(parsed)
    assert.ok(res.ok)
    if (!res.ok) return
    const rev = res.value.statementItems.find((i) => i.lineItemCode === 'revenue')!
    assert.equal(rev.metadata?.sourceConcept, 'ifrs-full:Revenue')
    assert.equal(rev.metadata?.mappingConfidence, 'high')
    assert.equal(rev.metadata?.contextRef, 'Anual')
  })
  it('balance items carry the instant context, income items carry the duration context', () => {
    const res = cmfXbrlProvider.normalizeToFinancialImportPayload(parsed)
    assert.ok(res.ok)
    if (!res.ok) return
    const assets = res.value.statementItems.find((i) => i.lineItemCode === 'total_assets')!
    assert.equal(assets.metadata?.periodNature, 'instant')
    assert.equal(assets.metadata?.contextRef, 'Cierre')
    const rev = res.value.statementItems.find((i) => i.lineItemCode === 'revenue')!
    assert.equal(rev.metadata?.periodNature, 'annual')
  })
  it('never fabricates a value — a missing concept simply is not present (not zero)', () => {
    const res = cmfXbrlProvider.normalizeToFinancialImportPayload(parsed)
    assert.ok(res.ok)
    if (!res.ok) return
    // capex/dividends are not in the synthetic fixture → absent, not present-as-zero
    assert.equal(res.value.statementItems.find((i) => i.lineItemCode === 'capex'), undefined)
    assert.equal(res.value.statementItems.find((i) => i.lineItemCode === 'dividends_paid'), undefined)
  })
  it('countUnmappedPlainConcepts counts the note-only concept (AccountingProfit) as unmapped, never dropped silently', () => {
    const inst = instanceFromParsed(parsed)!
    assert.ok(countUnmappedPlainConcepts(inst) >= 1)
  })
})

describe('candidateAnnualPeriods + buildFilingRefs', () => {
  it('returns December year-ends starting from the last completed fiscal year', () => {
    const periods = candidateAnnualPeriods(3, new Date('2026-07-08'))
    assert.deepEqual(periods, [{ mm: '12', aa: '2025' }, { mm: '12', aa: '2024' }, { mm: '12', aa: '2023' }])
  })
  it('buildFilingRefs returns [] for an unmapped ticker (never guesses)', () => {
    assert.deepEqual(buildFilingRefs('NOT-A-TICKER', [{ mm: '12', aa: '2024' }]), [])
  })
  it('buildFilingRefs constructs xbrl-sourced refs for a mapped ticker', () => {
    const refs = buildFilingRefs('COPEC', [{ mm: '12', aa: '2024' }])
    assert.equal(refs.length, 1)
    assert.equal(refs[0].sourceType, 'xbrl')
    assert.equal(refs[0].fiscalPeriod, 'FY')
    assert.ok(refs[0].locator.includes('rut=90690000'))
  })
})

describe('cmfIssuerMap — Phase 8C.3 issuer coverage expansion', () => {
  it('SQM-B and COPEC remain mapped, unchanged in ticker/RUT', () => {
    assert.equal(getCmfIssuer('SQM-B')?.rut, '93007000')
    assert.equal(getCmfIssuer('COPEC')?.rut, '90690000')
  })
  it('ENELCHILE, CMPC, CENCOSUD are newly mapped with verified RUTs', () => {
    assert.equal(getCmfIssuer('ENELCHILE')?.rut, '76536353')
    assert.equal(getCmfIssuer('CMPC')?.rut, '90222000')
    assert.equal(getCmfIssuer('CENCOSUD')?.rut, '93834000')
  })
  it('getMappedTickers includes all 5 enabled issuers', () => {
    const mapped = getMappedTickers()
    for (const t of ['SQM-B', 'COPEC', 'ENELCHILE', 'CMPC', 'CENCOSUD']) assert.ok(mapped.includes(t), `${t} should be mapped`)
    assert.equal(mapped.length, 5)
  })
  it('every mapped entry has an explicit RUT, sourceUrl, verifiedAt, and (Phase 8C.3) verificationStatus/verificationMethod', () => {
    for (const [ticker, entry] of Object.entries(CMF_ISSUER_MAP)) {
      assert.ok(entry.rut, `${ticker} missing rut`)
      assert.ok(entry.sourceUrl, `${ticker} missing sourceUrl`)
      assert.ok(entry.verifiedAt, `${ticker} missing verifiedAt`)
      assert.equal(entry.verificationStatus, 'verified')
      assert.ok(entry.verificationMethod && entry.verificationMethod.length > 0, `${ticker} missing verificationMethod`)
    }
  })
  it('BSANTANDER and CHILE (both banks) remain unmapped, with documented reasons referencing both registry groups checked', () => {
    assert.equal(isCmfIssuerMapped('BSANTANDER'), false)
    assert.equal(isCmfIssuerMapped('CHILE'), false)
    assert.equal(getCmfIssuer('BSANTANDER'), null)
    assert.equal(getCmfIssuer('CHILE'), null)
    assert.ok('BSANTANDER' in UNMAPPED_TICKERS)
    assert.ok('CHILE' in UNMAPPED_TICKERS)
    assert.match(UNMAPPED_TICKERS.BSANTANDER, /RVEMI/)
    assert.match(UNMAPPED_TICKERS.BSANTANDER, /RGEIN/)
    assert.match(UNMAPPED_TICKERS.CHILE, /Banco de Chile/i)
  })
  it('never guesses a RUT — an unmapped ticker\'s buildFilingRefs is empty and getCmfIssuer is null', () => {
    for (const ticker of ['BSANTANDER', 'CHILE']) {
      assert.equal(getCmfIssuer(ticker), null)
      assert.deepEqual(buildFilingRefs(ticker, [{ mm: '12', aa: '2025' }]), [])
    }
  })
})

// ── Route + repository hygiene (grep-based, no network) ──────────────────────
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}
const CRON_ROUTE = read('../src/app/api/cron/financials/cmf-xbrl/route.ts')
const STATUS_ROUTE = read('../src/app/api/financials/cmf-xbrl/status/route.ts')
const REPO = read('../src/lib/db/repositories/financialsRepository.ts')

describe('cron route — auth + safety', () => {
  it('requires a Bearer CRON_SECRET and 401s on mismatch', () => {
    assert.ok(CRON_ROUTE.includes('CRON_SECRET'))
    assert.ok(CRON_ROUTE.includes('Bearer ${secret}'))
    assert.ok(CRON_ROUTE.includes('status: 401'))
  })
  it('uses the service-role admin client and sanitizes errors', () => {
    assert.ok(CRON_ROUTE.includes('getSupabaseAdminClient'))
    assert.ok(CRON_ROUTE.includes('***JWT***'))
  })
  it('never returns raw XBRL and labels the source as official CMF filing data', () => {
    assert.ok(!/statementItems\.map|\.raw\b/.test(CRON_ROUTE))
    assert.ok(/CMF XBRL|Estados Financieros/i.test(CRON_ROUTE))
  })
})

describe('status route — public read-only diagnostics', () => {
  it('exposes coverage + mapped/unmapped issuers, no admin client, no secrets', () => {
    assert.ok(STATUS_ROUTE.includes('getSourceTypeCoverage'))
    assert.ok(!STATUS_ROUTE.includes('getSupabaseAdminClient'))
    assert.ok(!STATUS_ROUTE.includes('CRON_SECRET'))
  })
  it('(Phase 8C.3) surfaces enabledIssuers with verification detail and notConfiguredIssuers', () => {
    assert.ok(STATUS_ROUTE.includes('enabledIssuers'))
    assert.ok(STATUS_ROUTE.includes('notConfiguredIssuers'))
    assert.ok(STATUS_ROUTE.includes('verificationStatus'))
  })
})

describe('repository — no-migration, metadata jsonb, supersession-preserving', () => {
  it('no new migration file is introduced this phase (honest-period metadata reuses the existing jsonb column)', () => {
    // 8C.2 stores period metadata in company_reporting_periods.metadata (already
    // present since 8C) — mirroring the 9D/9E approach. No 20260710* migration.
    let exists = true
    try { read('../supabase/migrations/20260710000000_cmf_xbrl_financials_ingestion.sql') } catch { exists = false }
    assert.equal(exists, false)
  })
  it('keeps xbrl at higher source_priority than manual_csv (supersession direction)', () => {
    assert.ok(/xbrl:\s*210/.test(REPO))
    assert.ok(/manual_csv:\s*100/.test(REPO))
  })
  it('writes honest-period metadata into the existing metadata jsonb column, only for rows that carry it', () => {
    assert.ok(REPO.includes('periodNature'))
    assert.ok(REPO.includes('filingPeriodLabel'))
    assert.ok(REPO.includes('metadata:'))
  })
})
