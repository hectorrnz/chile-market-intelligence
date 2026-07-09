// Phase 8C.7 — bank-specific CMF financials discovery + mapping tests.
// NO live network calls — the HTML-matching and file-parsing logic are pure
// functions tested against small, sanitized, fictional-value fixtures.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseBankAccountFile, findAccountRow, bankFileName } from '../src/lib/financials/banks/parseBankAccountFile.ts'
import { BANK_CONCEPT_MAP, mapBankConcept, mappedBankLineItems, BANK_KNOWN_UNMAPPED_CODES } from '../src/lib/financials/banks/bankConceptMap.ts'
import { BANK_LINE_ITEM_MODEL, CAPITAL_RATIO_FIELDS } from '../src/lib/financials/banks/bankStatementTypes.ts'
import { BANK_REGISTRY, getBankRegistryEntry, isBankTicker, getAllBankTickers } from '../src/lib/financials/banks/bankRegistry.ts'
import { validateBankFinancials } from '../src/lib/financials/banks/validateBankFinancials.ts'
import { buildBankCoverageSummary } from '../src/lib/financials/banks/bankCoverageStatus.ts'
import { findBankZipLinkInHtml, buildAnnualBankFilingRef, mapFileRows, SPANISH_MONTH_NAMES } from '../src/lib/financials/providers/cmfBankProvider.ts'

const SAMPLE_B1 = readFileSync(fileURLToPath(new URL('fixtures/cmf/sample_bank_b1.txt', import.meta.url)), 'utf8')
const SAMPLE_R1 = readFileSync(fileURLToPath(new URL('fixtures/cmf/sample_bank_r1.txt', import.meta.url)), 'utf8')

describe('parseBankAccountFile', () => {
  it('parses the header (bank code + name) and every account row', () => {
    const result = parseBankAccountFile(SAMPLE_B1)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.bankCode, '016')
    assert.equal(result.value.bankName, 'BANCO FICTICIO DE PRUEBA')
    assert.equal(result.value.rows.length, 8)
  })

  it('sums all 4 columns into `total` for a balance-sheet row', () => {
    const result = parseBankAccountFile(SAMPLE_B1)
    assert.equal(result.ok, true)
    if (!result.ok) return
    const assets = findAccountRow(result.value, '100000000')
    assert.ok(assets)
    assert.equal(assets!.columns.length, 4)
    assert.equal(assets!.total, 600 + 300 + 50 + 50)
  })

  it('preserves a negative sign (contra-asset allowance)', () => {
    const result = parseBankAccountFile(SAMPLE_B1)
    assert.equal(result.ok, true)
    if (!result.ok) return
    const allowance = findAccountRow(result.value, '149000000')
    assert.equal(allowance!.total, -40)
  })

  it('parses a single-column income-statement row correctly', () => {
    const result = parseBankAccountFile(SAMPLE_R1)
    assert.equal(result.ok, true)
    if (!result.ok) return
    const netIncome = findAccountRow(result.value, '590000000')
    assert.equal(netIncome!.columns.length, 1)
    assert.equal(netIncome!.total, 70)
  })

  it('returns null (never fabricates) for an account code not reported this period', () => {
    const result = parseBankAccountFile(SAMPLE_B1)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(findAccountRow(result.value, '210000000'), null)
  })

  it('rejects an empty file', () => {
    const result = parseBankAccountFile('')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'empty_file')
  })

  it('rejects a malformed header (not "<code>\\t<name>")', () => {
    const result = parseBankAccountFile('not a header at all\n100000000\t1')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'malformed_header')
  })

  it('rejects a row with a non-9-digit account code', () => {
    const result = parseBankAccountFile('016\tTEST BANK\n12345\t100')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'malformed_row')
  })

  it('rejects a row with a non-numeric amount instead of coercing to 0', () => {
    const result = parseBankAccountFile('016\tTEST BANK\n100000000\tN/A')
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'malformed_row')
    assert.match(result.error.reason, /non-numeric/)
  })

  it('bankFileName builds the official XXAAAAMMIFI.TXT convention', () => {
    assert.equal(bankFileName('b1', 2025, 12, '016'), 'b1202512016.txt')
    assert.equal(bankFileName('r1', 2026, 5, '037'), 'r1202605037.txt')
  })
})

describe('bankConceptMap — account code -> normalized field', () => {
  it('every entry has high confidence backed by a verification note', () => {
    for (const entry of Object.values(BANK_CONCEPT_MAP)) {
      assert.equal(entry.confidence, 'high', `${entry.accountCode} should be high-confidence (only verified codes belong here)`)
      assert.ok(entry.notes.length > 20, `${entry.accountCode} notes should document its verification`)
    }
  })

  it('maps the verified top-level balance sheet codes', () => {
    assert.equal(mapBankConcept('100000000')?.lineItemCode, 'total_assets')
    assert.equal(mapBankConcept('200000000')?.lineItemCode, 'total_liabilities')
    assert.equal(mapBankConcept('300000000')?.lineItemCode, 'total_equity')
    assert.equal(mapBankConcept('380000000')?.lineItemCode, 'equity_attributable_to_parent')
    assert.equal(mapBankConcept('500000000')?.lineItemCode, 'loans_to_customers')
    assert.equal(mapBankConcept('149000000')?.lineItemCode, 'allowance_for_loan_losses')
  })

  it('maps the verified top-level income statement codes', () => {
    assert.equal(mapBankConcept('411000000')?.lineItemCode, 'interest_income')
    assert.equal(mapBankConcept('412000000')?.lineItemCode, 'interest_expense')
    assert.equal(mapBankConcept('420000000')?.lineItemCode, 'fee_and_commission_income')
    assert.equal(mapBankConcept('425000000')?.lineItemCode, 'fee_and_commission_expense')
    assert.equal(mapBankConcept('470000000')?.lineItemCode, 'loan_loss_provisions')
    assert.equal(mapBankConcept('480000000')?.lineItemCode, 'tax_expense')
    assert.equal(mapBankConcept('585000000')?.lineItemCode, 'profit_before_tax')
    assert.equal(mapBankConcept('590000000')?.lineItemCode, 'net_income')
  })

  it('marks every expense-type account with expenseSign: negative', () => {
    for (const code of ['412000000', '425000000', '470000000', '480000000']) {
      assert.equal(mapBankConcept(code)?.expenseSign, 'negative', `${code} should be flagged as a pre-signed-negative expense`)
    }
  })

  it('returns null for an unmapped account code (never guesses)', () => {
    assert.equal(mapBankConcept('241000000'), null)
    assert.equal(mapBankConcept('999999999'), null)
  })

  it('documents deposits/borrowings/capital-ratio gaps in BANK_KNOWN_UNMAPPED_CODES', () => {
    const keys = Object.keys(BANK_KNOWN_UNMAPPED_CODES)
    assert.ok(keys.some((k) => /deposit/i.test(BANK_KNOWN_UNMAPPED_CODES[k])))
    assert.ok(keys.some((k) => /CET1|RWA|NPL|coverage/i.test(BANK_KNOWN_UNMAPPED_CODES[k])))
  })

  it('mappedBankLineItems returns exactly 14 distinct fields (6 balance + 8 income)', () => {
    const fields = mappedBankLineItems()
    assert.equal(fields.length, 14)
    assert.ok(fields.includes('total_assets'))
    assert.ok(fields.includes('net_income'))
  })
})

describe('bankStatementTypes — normalized field model', () => {
  it('every capital-ratio field is declared in the full model', () => {
    for (const code of CAPITAL_RATIO_FIELDS) {
      assert.ok(BANK_LINE_ITEM_MODEL[code], `${code} should be declared in BANK_LINE_ITEM_MODEL`)
      assert.equal(BANK_LINE_ITEM_MODEL[code].section, 'capital')
    }
  })

  it('no capital-ratio field is currently mapped to an account code (never inferred)', () => {
    const mapped = new Set(mappedBankLineItems())
    for (const code of CAPITAL_RATIO_FIELDS) {
      assert.ok(!mapped.has(code), `${code} must stay unmapped until Pillar 3 disclosure is investigated`)
    }
  })

  it('every BANK_CONCEPT_MAP target line item exists in the full model', () => {
    for (const entry of Object.values(BANK_CONCEPT_MAP)) {
      assert.ok(BANK_LINE_ITEM_MODEL[entry.lineItemCode], `${entry.lineItemCode} missing from BANK_LINE_ITEM_MODEL`)
    }
  })
})

describe('bankRegistry — identity + discovery status', () => {
  it('has exactly the 4 app bank tickers, no more, no fewer', () => {
    assert.deepEqual(getAllBankTickers().sort(), ['BCI', 'BSANTANDER', 'CHILE', 'ITAUCL'])
  })

  it('never asserts a RUT (rut is always null — not independently re-verified this phase)', () => {
    for (const entry of Object.values(BANK_REGISTRY)) {
      assert.equal(entry.rut, null)
    }
  })

  it('every entry has a distinct, non-empty CMF bank code and marks isXbrl: false', () => {
    const codes = new Set<string>()
    for (const entry of Object.values(BANK_REGISTRY)) {
      assert.ok(/^\d{3}$/.test(entry.bankCode))
      assert.equal(entry.isXbrl, false)
      codes.add(entry.bankCode)
    }
    assert.equal(codes.size, 4)
  })

  it('isBankTicker is case-insensitive and rejects non-bank tickers', () => {
    assert.equal(isBankTicker('bci'), true)
    assert.equal(isBankTicker('BCI'), true)
    assert.equal(isBankTicker('SQM-B'), false)
  })

  it('getBankRegistryEntry returns null for a non-bank ticker', () => {
    assert.equal(getBankRegistryEntry('COPEC'), null)
  })

  it('discoveryStatus is bank_filing_path_discovered for every bank (real path found, not XBRL)', () => {
    for (const entry of Object.values(BANK_REGISTRY)) {
      assert.equal(entry.discoveryStatus, 'bank_filing_path_discovered')
    }
  })
})

describe('validateBankFinancials', () => {
  const baseFacts = [
    { lineItemCode: 'total_assets', value: 1000 },
    { lineItemCode: 'total_liabilities', value: 650 },
    { lineItemCode: 'total_equity', value: 350 },
    { lineItemCode: 'profit_before_tax', value: 90 },
    { lineItemCode: 'tax_expense', value: -20 },
    { lineItemCode: 'net_income', value: 70 },
  ]

  it('returns valid for a clean, identity-consistent annual filing', () => {
    const result = validateBankFinancials({ facts: baseFacts, currency: 'CLP', isAnnualPeriod: true })
    assert.equal(result.status, 'valid')
    assert.equal(result.warnings.length, 0)
  })

  it('flags a balance-sheet identity mismatch as review_required', () => {
    const facts = baseFacts.map((f) => (f.lineItemCode === 'total_equity' ? { ...f, value: 100 } : f))
    const result = validateBankFinancials({ facts, currency: 'CLP', isAnnualPeriod: true })
    assert.equal(result.status, 'review_required')
    assert.ok(result.warnings.some((w) => w.code === 'BALANCE_SHEET_IDENTITY_MISMATCH'))
  })

  it('flags an income-statement identity mismatch (pretax + tax != net)', () => {
    const facts = baseFacts.map((f) => (f.lineItemCode === 'net_income' ? { ...f, value: 999 } : f))
    const result = validateBankFinancials({ facts, currency: 'CLP', isAnnualPeriod: true })
    assert.equal(result.status, 'review_required')
    assert.ok(result.warnings.some((w) => w.code === 'INCOME_STATEMENT_IDENTITY_MISMATCH'))
  })

  it('flags a non-annual period as review_required (annual-only scope)', () => {
    const result = validateBankFinancials({ facts: baseFacts, currency: 'CLP', isAnnualPeriod: false })
    assert.equal(result.status, 'review_required')
    assert.ok(result.warnings.some((w) => w.code === 'PERIOD_NOT_ANNUAL'))
  })

  it('flags missing currency', () => {
    const result = validateBankFinancials({ facts: baseFacts, currency: null, isAnnualPeriod: true })
    assert.ok(result.warnings.some((w) => w.code === 'CURRENCY_MISSING'))
  })

  it('flags negative loans as implausible', () => {
    const facts = [...baseFacts, { lineItemCode: 'loans_to_customers', value: -5 }]
    const result = validateBankFinancials({ facts, currency: 'CLP', isAnnualPeriod: true })
    assert.ok(result.warnings.some((w) => w.code === 'NEGATIVE_LOANS_OR_ASSETS'))
  })

  it('treats negative total_assets as hard invalid', () => {
    const facts = baseFacts.map((f) => (f.lineItemCode === 'total_assets' ? { ...f, value: -1 } : f))
    const result = validateBankFinancials({ facts, currency: 'CLP', isAnnualPeriod: true })
    assert.equal(result.status, 'invalid')
  })

  it('flags a capital ratio outside 0-100% as implausible', () => {
    const facts = [...baseFacts, { lineItemCode: 'cet1_ratio', value: 250 }]
    const result = validateBankFinancials({ facts, currency: 'CLP', isAnnualPeriod: true })
    assert.ok(result.warnings.some((w) => w.code === 'IMPLAUSIBLE_CAPITAL_RATIO'))
  })

  it('treats a non-finite value as hard invalid, never silently coerced', () => {
    const facts = [...baseFacts, { lineItemCode: 'net_loans', value: Number.POSITIVE_INFINITY }]
    const result = validateBankFinancials({ facts, currency: 'CLP', isAnnualPeriod: true })
    assert.equal(result.status, 'invalid')
    assert.ok(result.warnings.some((w) => w.code === 'NON_FINITE_VALUE'))
  })

  it('warns when very few fields are mapped', () => {
    const result = validateBankFinancials({ facts: [{ lineItemCode: 'total_assets', value: 1 }], currency: 'CLP', isAnnualPeriod: true })
    assert.ok(result.warnings.some((w) => w.code === 'FEW_MAPPED_FIELDS'))
  })
})

describe('cmfBankProvider — pure helpers (no network)', () => {
  it('findBankZipLinkInHtml matches the real aria-label markup shape', () => {
    const html = `<a href="articles-103192_recurso_1.zip?ts=1769784263" class="card-img stretched-link" target="_blank" rel="noopener" aria-label="Descargar Diciembre 2025 (zip, se abre en nueva ventana)">`
    const link = findBankZipLinkInHtml(html, 2025, 12)
    assert.equal(link, 'articles-103192_recurso_1.zip?ts=1769784263')
  })

  it('findBankZipLinkInHtml returns null when no matching month/year link exists', () => {
    const html = `<a href="articles-1_recurso_1.zip" aria-label="Descargar Enero 2020 (zip, ...)">`
    assert.equal(findBankZipLinkInHtml(html, 2025, 12), null)
  })

  it('findBankZipLinkInHtml is case-insensitive on the month name', () => {
    const html = `<a href="articles-2_recurso_1.zip" aria-label="Descargar diciembre 2025 (zip, ...)">`
    assert.equal(findBankZipLinkInHtml(html, 2025, 12), 'articles-2_recurso_1.zip')
  })

  it('SPANISH_MONTH_NAMES has all 12 months in order', () => {
    assert.equal(SPANISH_MONTH_NAMES.length, 12)
    assert.equal(SPANISH_MONTH_NAMES[0], 'enero')
    assert.equal(SPANISH_MONTH_NAMES[11], 'diciembre')
  })

  it('buildAnnualBankFilingRef targets December, isAnnualPeriod true, for a real bank ticker', () => {
    const result = buildAnnualBankFilingRef('BCI', 2025)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.value.month, 12)
    assert.equal(result.value.isAnnualPeriod, true)
    assert.equal(result.value.bankCode, '016')
  })

  it('buildAnnualBankFilingRef fails closed for a non-bank ticker', () => {
    const result = buildAnnualBankFilingRef('COPEC', 2025)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error.code, 'ticker_not_a_bank')
  })

  it('mapFileRows maps only the entries present in a real parsed file, using verified account codes', () => {
    const parsed = parseBankAccountFile(SAMPLE_B1)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const rows = mapFileRows(parsed.value, 'balance', 'BCI', 2025)
    const byCode = new Map(rows.map((r) => [r.lineItemCode, r.value]))
    assert.equal(byCode.get('total_assets'), 1000)
    assert.equal(byCode.get('total_liabilities'), 650)
    assert.equal(byCode.get('total_equity'), 350)
    assert.equal(byCode.get('allowance_for_loan_losses'), -40)
    for (const r of rows) {
      assert.equal(r.ticker, 'BCI')
      assert.equal(r.fiscalYear, 2025)
      assert.equal(r.sourceType, 'cmf_bank')
      assert.equal(r.unit, 'CLP')
    }
  })

  it('mapFileRows never produces a row for an account not present in the file', () => {
    const parsed = parseBankAccountFile(SAMPLE_B1)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const rows = mapFileRows(parsed.value, 'income', 'BCI', 2025) // this fixture is a balance-sheet file — no income codes present
    assert.equal(rows.length, 0)
  })

  it('mapFileRows preserves raw provenance metadata (account code, official label, confidence)', () => {
    const parsed = parseBankAccountFile(SAMPLE_R1)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    const rows = mapFileRows(parsed.value, 'income', 'BCI', 2025)
    const netIncomeRow = rows.find((r) => r.lineItemCode === 'net_income')
    assert.ok(netIncomeRow)
    assert.equal((netIncomeRow!.metadata as Record<string, unknown>).accountCode, '590000000')
    assert.equal((netIncomeRow!.metadata as Record<string, unknown>).mappingConfidence, 'high')
  })
})

describe('bankCoverageStatus — status endpoint diagnostics', () => {
  it('reports all 4 banks, 14 mapped codes, production not enabled, Yahoo fallback active', () => {
    const summary = buildBankCoverageSummary()
    assert.equal(summary.totalBanks, 4)
    assert.equal(summary.totalMappedAccountCodes, 14)
    assert.equal(summary.bankTickers.sort().join(','), 'BCI,BSANTANDER,CHILE,ITAUCL')
    for (const e of summary.entries) {
      assert.equal(e.productionIngestion, 'not_enabled')
      assert.equal(e.yahooFallback, 'active')
      assert.equal(e.isXbrl, false)
    }
  })

  it('lists every capital-ratio field as deferred, never fabricated', () => {
    const summary = buildBankCoverageSummary()
    assert.equal(summary.capitalRatioFieldsDeferred.length, CAPITAL_RATIO_FIELDS.length)
  })
})
