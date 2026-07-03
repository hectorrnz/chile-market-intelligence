// Phase 8C.1 — CMF/XBRL provider discovery layer tests.
//
// src/lib/financials/xbrl/parseXbrl.ts, conceptMap.ts, cmfIssuerMap.ts, and
// providers/{types,cmfXbrlProvider}.ts have zero transitive Supabase/'@/*'
// imports at module-load time (financialsRepository.ts is only reached via a
// dynamic `await import()` inside writeImport, never executed here) — so all
// of them are safe to import directly under plain `node --test`, mirroring
// tests/financialsIngest.test.ts's established pattern. No live CMF network
// call is made anywhere in this file.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  parseXbrlInstance,
  plainFacts,
  isPlainContext,
  findContext,
  findUnit,
  factNumericValue,
} from '../src/lib/financials/xbrl/parseXbrl.ts'
import { mapConcept, XBRL_CONCEPT_MAP, KNOWN_UNMAPPED_CONCEPTS } from '../src/lib/financials/xbrl/conceptMap.ts'
import { CMF_ISSUER_MAP, UNMAPPED_TICKERS, getCmfIssuer, isCmfIssuerMapped } from '../src/lib/financials/cmfIssuerMap.ts'
import { cmfXbrlProvider, extractXbrlDownloadUrl, candidateRecentPeriods } from '../src/lib/financials/providers/cmfXbrlProvider.ts'
import { VALID_SOURCE_TYPES } from '../src/lib/financials/csvFinancials.ts'

const FIXTURE_XBRL = fileURLToPath(new URL('fixtures/cmf/sample_instance.xbrl', import.meta.url))
const FIXTURE_ENTIDAD_HTML = fileURLToPath(new URL('fixtures/cmf/sample_entidad_page.html', import.meta.url))
const DISCOVERY_DOC = fileURLToPath(new URL('../docs/cmf_xbrl_provider_discovery.md', import.meta.url))
const CLI_SCRIPT = fileURLToPath(new URL('../scripts/discover/cmfXbrlFinancials.ts', import.meta.url))
const CLAUDE_MD = fileURLToPath(new URL('../CLAUDE.md', import.meta.url))

const sampleXml = readFileSync(FIXTURE_XBRL, 'utf8')
const sampleEntidadHtml = readFileSync(FIXTURE_ENTIDAD_HTML, 'utf8')

describe('parseXbrlInstance', () => {
  it('parses contexts, units, and facts from a real-structured fixture', () => {
    const instance = parseXbrlInstance(sampleXml)
    assert.ok(instance.contexts.length >= 3)
    assert.ok(instance.units.length >= 2)
    assert.ok(instance.facts.length >= 10)
  })

  it('extracts entity identifier and period from a duration context', () => {
    const instance = parseXbrlInstance(sampleXml)
    const anual = findContext(instance, 'Anual')
    assert.ok(anual)
    assert.equal(anual?.entityIdentifier, '11111111-1')
    assert.equal(anual?.startDate, '2024-01-01')
    assert.equal(anual?.endDate, '2024-12-31')
  })

  it('extracts an instant context correctly', () => {
    const instance = parseXbrlInstance(sampleXml)
    const cierre = findContext(instance, 'Cierre')
    assert.equal(cierre?.instant, '2024-12-31')
  })

  it('flags a dimensional context as non-plain', () => {
    const instance = parseXbrlInstance(sampleXml)
    const dimensional = instance.contexts.find((c) => c.dimensions.length > 0)
    assert.ok(dimensional)
    assert.equal(isPlainContext(dimensional!), false)
  })

  it('flags a non-dimensional context as plain', () => {
    const instance = parseXbrlInstance(sampleXml)
    const anual = findContext(instance, 'Anual')
    assert.ok(anual)
    assert.equal(isPlainContext(anual!), true)
  })

  it('resolves unit measures correctly (CLP, shares)', () => {
    const instance = parseXbrlInstance(sampleXml)
    assert.equal(findUnit(instance, 'CLP')?.measure, 'CLP')
    assert.equal(findUnit(instance, 'shares')?.measure, 'shares')
    assert.equal(findUnit(instance, null), null)
  })

  it('parses a numeric fact value without invoking NaN', () => {
    const instance = parseXbrlInstance(sampleXml)
    const revenueFact = instance.facts.find((f) => f.concept === 'ifrs-full:Revenue' && f.contextRef === 'Anual')
    assert.ok(revenueFact)
    assert.equal(factNumericValue(revenueFact!), 1000000000)
  })

  it('returns null (never NaN) for an unparsable value', () => {
    const fake = { concept: 'x', contextRef: 'y', unitRef: null, decimals: null, rawValue: 'not-a-number' }
    const v = factNumericValue(fake)
    assert.equal(v, null)
    assert.notEqual(Number.isNaN(v), true)
  })
})

describe('plainFacts — dimensional deduplication', () => {
  it('excludes facts on dimensional (segment) contexts', () => {
    const instance = parseXbrlInstance(sampleXml)
    const plain = plainFacts(instance)
    const revenueFacts = plain.filter((f) => f.concept === 'ifrs-full:Revenue')
    // Only the plain-context Revenue fact should survive — the segment breakdown must be excluded.
    assert.equal(revenueFacts.length, 1)
    assert.equal(revenueFacts[0].contextRef, 'Anual')
  })

  it('still includes all non-dimensional concepts (assets, cash, EPS, etc.)', () => {
    const instance = parseXbrlInstance(sampleXml)
    const plain = plainFacts(instance)
    const concepts = new Set(plain.map((f) => f.concept))
    assert.ok(concepts.has('ifrs-full:Assets'))
    assert.ok(concepts.has('ifrs-full:CashAndCashEquivalents'))
    assert.ok(concepts.has('ifrs-full:BasicEarningsLossPerShare'))
  })
})

describe('conceptMap — conservative mapping', () => {
  it('maps known, verified IFRS concepts to internal line items', () => {
    assert.equal(mapConcept('ifrs-full:Revenue')?.lineItemCode, 'revenue')
    assert.equal(mapConcept('ifrs-full:ProfitLoss')?.lineItemCode, 'net_income')
    assert.equal(mapConcept('ifrs-full:Assets')?.lineItemCode, 'total_assets')
    assert.equal(mapConcept('ifrs-full:BasicEarningsLossPerShare')?.lineItemCode, 'eps')
  })

  it('does not map an ambiguous/note-only concept (AccountingProfit)', () => {
    assert.equal(mapConcept('ifrs-full:AccountingProfit'), null)
  })

  it('never maps any concept to a fabricated "ebitda" line item', () => {
    const mappedCodes = Object.values(XBRL_CONCEPT_MAP).map((e) => e.lineItemCode)
    assert.ok(!mappedCodes.includes('ebitda' as never))
  })

  it('does not map an unrecognized concept name', () => {
    assert.equal(mapConcept('ifrs-full:SomeConceptNeverObserved'), null)
  })

  it('documents every rejected concept with a reason (no silent guessing)', () => {
    for (const [concept, reason] of Object.entries(KNOWN_UNMAPPED_CONCEPTS)) {
      assert.ok(concept.startsWith('ifrs-full:'))
      assert.ok(reason.length > 10)
    }
  })
})

describe('cmfIssuerMap — verified-only mapping', () => {
  it('every mapped entry has an explicit RUT, sourceUrl, and verifiedAt', () => {
    for (const [ticker, entry] of Object.entries(CMF_ISSUER_MAP)) {
      assert.equal(entry.ticker, ticker)
      assert.ok(/^\d+$/.test(entry.rut), `${ticker} RUT must be numeric-only (sin dígito verificador)`)
      assert.ok(entry.sourceUrl.startsWith('https://www.cmfchile.cl/'), `${ticker} sourceUrl must be a real cmfchile.cl URL`)
      assert.ok(entry.verifiedAt.length > 0)
    }
  })

  it('exposes the two tickers verified in this phase', () => {
    assert.ok(isCmfIssuerMapped('SQM-B'))
    assert.ok(isCmfIssuerMapped('COPEC'))
  })

  it('leaves BSANTANDER unmapped with a documented reason (RUT could not be confirmed)', () => {
    assert.equal(isCmfIssuerMapped('BSANTANDER'), false)
    assert.ok(UNMAPPED_TICKERS.BSANTANDER)
    assert.ok(UNMAPPED_TICKERS.BSANTANDER.length > 20)
  })

  it('getCmfIssuer returns null for an unmapped ticker (never a guessed fallback)', () => {
    assert.equal(getCmfIssuer('BSANTANDER'), null)
    assert.equal(getCmfIssuer('NOT-A-REAL-TICKER'), null)
  })
})

describe('extractXbrlDownloadUrl', () => {
  it('picks the XBRL link (not the PDF or Análisis Razonado links) from a real-structured page', () => {
    const url = extractXbrlDownloadUrl(sampleEntidadHtml)
    assert.ok(url)
    assert.ok(url!.includes('auth=ZmFrZWF1dGg3ODk='))
    assert.ok(url!.startsWith('https://www.cmfchile.cl/institucional/'))
  })

  it('returns null when no XBRL link is present', () => {
    assert.equal(extractXbrlDownloadUrl('<html><body>no filings here</body></html>'), null)
  })
})

describe('candidateRecentPeriods', () => {
  it('returns quarter-end mm/aa pairs, most recent first, going backward', () => {
    const periods = candidateRecentPeriods(4, new Date('2026-07-03'))
    assert.equal(periods.length, 4)
    assert.deepEqual(periods[0], { mm: '06', aa: '2026' })
    assert.deepEqual(periods[1], { mm: '03', aa: '2026' })
    assert.deepEqual(periods[2], { mm: '12', aa: '2025' })
    assert.deepEqual(periods[3], { mm: '09', aa: '2025' })
  })
})

describe('cmfXbrlProvider — provider contract', () => {
  it('has sourceType "xbrl", which is a valid source_type', () => {
    assert.equal(cmfXbrlProvider.sourceType, 'xbrl')
    assert.ok((VALID_SOURCE_TYPES as readonly string[]).includes('xbrl'))
  })

  it('discoverFilings returns a structured blocked result for an unmapped ticker', async () => {
    const result = await cmfXbrlProvider.discoverFilings('BSANTANDER')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'issuer_not_mapped')
      assert.ok(result.error.reason.length > 0)
      assert.ok(result.error.nextAction.length > 0)
    }
  })

  it('discoverFilings returns candidate filing refs for a mapped ticker (no network call)', async () => {
    const result = await cmfXbrlProvider.discoverFilings('COPEC')
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.ok(result.value.length > 0)
      assert.equal(result.value[0].ticker, 'COPEC')
      assert.equal(result.value[0].sourceType, 'xbrl')
      assert.ok(result.value[0].locator.includes('rut=90690000'))
    }
  })

  it('parseFiling rejects raw content with 0 contexts/facts', () => {
    const result = cmfXbrlProvider.parseFiling({
      ref: { ticker: 'COPEC', sourceType: 'xbrl', locator: 'x', fiscalYear: 2024, fiscalPeriod: 'FY', periodType: 'annual', description: 'x' },
      raw: '<html>not xbrl</html>',
      fetchedAt: new Date().toISOString(),
      sourceFile: null,
      sourceUrl: null,
    })
    assert.equal(result.ok, false)
  })

  it('parseFiling accepts the real-structured fixture', () => {
    const result = cmfXbrlProvider.parseFiling({
      ref: { ticker: 'COPEC', sourceType: 'xbrl', locator: 'x', fiscalYear: 2024, fiscalPeriod: 'FY', periodType: 'annual', description: 'x' },
      raw: sampleXml,
      fetchedAt: new Date().toISOString(),
      sourceFile: 'sample_instance.xbrl',
      sourceUrl: 'https://www.cmfchile.cl/x',
    })
    assert.equal(result.ok, true)
  })

  it('normalizeToFinancialImportPayload produces only mapped, non-fabricated statement items', () => {
    const parsed = cmfXbrlProvider.parseFiling({
      ref: { ticker: 'COPEC', sourceType: 'xbrl', locator: 'https://www.cmfchile.cl/x', fiscalYear: 2024, fiscalPeriod: 'FY', periodType: 'annual', description: 'x' },
      raw: sampleXml,
      fetchedAt: new Date().toISOString(),
      sourceFile: 'sample_instance.xbrl',
      sourceUrl: 'https://www.cmfchile.cl/x',
    })
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const payloadResult = cmfXbrlProvider.normalizeToFinancialImportPayload(parsed.value)
    assert.equal(payloadResult.ok, true)
    if (!payloadResult.ok) return
    const payload = payloadResult.value

    // No fabricated EBITDA line item.
    assert.ok(!payload.statementItems.some((i) => i.lineItemCode === 'ebitda'))
    // No fabricated dividends (fixture has no dividend fact).
    assert.ok(!payload.statementItems.some((i) => i.lineItemCode === 'dividends_paid'))
    // No consensus/estimates fields exist on this payload shape at all — metrics/earnings are always empty from this provider.
    assert.deepEqual(payload.metrics, [])
    assert.deepEqual(payload.earningsEvents, [])
    // Every item is tagged with the real source type and carries provenance.
    for (const item of payload.statementItems) {
      assert.equal(item.sourceType, 'xbrl')
      assert.ok(item.sourceUrl)
      assert.ok(item.sourceFile)
      assert.equal(item.sourceFile?.includes('/'), false)
    }
    // Real mapped values are present.
    assert.ok(payload.statementItems.some((i) => i.lineItemCode === 'revenue' && i.value === 1000000000))
    assert.ok(payload.reportingPeriods.length === 1)
    assert.equal(payload.reportingPeriods[0].sourceType, 'xbrl')
  })

  it('dryRunImport reports valid=true for a payload with no errors', () => {
    const dryRun = cmfXbrlProvider.dryRunImport({ reportingPeriods: [], statementItems: [], metrics: [], earningsEvents: [], errors: [] })
    assert.equal(dryRun.valid, true)
  })

  it('dryRunImport reports valid=false when errors are present', () => {
    const dryRun = cmfXbrlProvider.dryRunImport({ reportingPeriods: [], statementItems: [], metrics: [], earningsEvents: [], errors: [{ line: 1, reason: 'x' }] })
    assert.equal(dryRun.valid, false)
    assert.equal(dryRun.errorCount, 1)
  })
})

describe('supersession — xbrl outranks manual_csv (repository-level, verified by priority ordering)', () => {
  it('financialsRepository.ts DEFAULT_SOURCE_PRIORITY ranks xbrl above manual_csv', () => {
    const repoSrc = readFileSync(fileURLToPath(new URL('../src/lib/db/repositories/financialsRepository.ts', import.meta.url)), 'utf8')
    const xbrlMatch = /xbrl:\s*(\d+)/.exec(repoSrc)
    const manualMatch = /manual_csv:\s*(\d+)/.exec(repoSrc)
    assert.ok(xbrlMatch && manualMatch)
    assert.ok(Number(xbrlMatch![1]) > Number(manualMatch![1]), 'xbrl source_priority must outrank manual_csv so an automated import supersedes an interim-bridge CSV row for the same period')
  })

  it('the repository never hardcodes source_priority for a specific source_type at the call site (it is always derived via priorityFor)', () => {
    const repoSrc = readFileSync(fileURLToPath(new URL('../src/lib/db/repositories/financialsRepository.ts', import.meta.url)), 'utf8')
    assert.ok(repoSrc.includes('priorityFor(r.sourceType)'))
  })
})

describe('discovery output hygiene', () => {
  it('the CLI script never logs raw fetched HTML/XBRL content, only summaries/errors', () => {
    const src = readFileSync(CLI_SCRIPT, 'utf8')
    assert.ok(!src.includes('console.log(rawResult'))
    assert.ok(!/console\.log\([^)]*\.raw\)/.test(src))
  })

  it('the CLI script never references a raw Supabase key/secret literal', () => {
    const src = readFileSync(CLI_SCRIPT, 'utf8')
    assert.ok(!/eyJ[A-Za-z0-9_.-]{20,}/.test(src))
    assert.ok(!src.includes('SUPABASE_SERVICE_ROLE_KEY ='))
  })

  it('the CLI script defaults to discovery mode with no writes', () => {
    const src = readFileSync(CLI_SCRIPT, 'utf8')
    assert.ok(src.includes("mode: 'discover'"))
    assert.ok(src.includes('--write'))
  })
})

describe('documentation — discovery result is recorded', () => {
  it('docs/cmf_xbrl_provider_discovery.md exists and states the feasibility verdict precisely', () => {
    const doc = readFileSync(DISCOVERY_DOC, 'utf8')
    assert.ok(doc.includes('feasible_with_mapping'))
    assert.ok(doc.toLowerCase().includes('captcha'))
    assert.ok(doc.includes('90690000')) // COPEC RUT, the verified end-to-end proof
  })

  it('the doc explicitly distinguishes taxonomy availability from filing availability', () => {
    const doc = readFileSync(DISCOVERY_DOC, 'utf8')
    assert.ok(doc.toLowerCase().includes('by itself prove'))
  })

  it('CLAUDE.md documents this phase (8C.1)', () => {
    const claudeMd = readFileSync(CLAUDE_MD, 'utf8')
    assert.ok(claudeMd.includes('8C.1'))
  })
})

describe('source labels — distinguish manual CSV / CMF-FECU / XBRL / blocked', () => {
  it('registry has distinct labels for each automated-source state, none implying manual CSV is final', async () => {
    const { SOURCE_REGISTRY } = await import('../src/lib/dataSourceRegistry.ts')
    assert.ok(SOURCE_REGISTRY.financialsPersisted.labelEn.toLowerCase().includes('interim bridge'))
    assert.ok(SOURCE_REGISTRY.financialsPersistedCmfFecu.labelEn.includes('CMF/FECU'))
    assert.ok(SOURCE_REGISTRY.financialsPersistedXbrl.labelEn.includes('XBRL'))
    assert.equal(SOURCE_REGISTRY.automatedFinancialsBlocked.state, 'blocked')
  })
})

describe('regression — manual CSV source types untouched', () => {
  it('VALID_SOURCE_TYPES still includes both manual_csv and xbrl', () => {
    assert.ok((VALID_SOURCE_TYPES as readonly string[]).includes('manual_csv'))
    assert.ok((VALID_SOURCE_TYPES as readonly string[]).includes('xbrl'))
  })
})
