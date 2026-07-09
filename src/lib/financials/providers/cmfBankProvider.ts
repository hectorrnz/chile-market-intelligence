// Phase 8C.7 — CMF bank financials provider (discovery/dry-run only).
//
// Fetches CMF's official monthly "Balance y Estado de Situación Bancos" ZIP
// (see docs/bank_financials_ingestion.md), extracts one bank's b1
// (consolidated balance sheet) and r1 (consolidated income statement) files,
// parses them with the dependency-free parseBankAccountFile parser, maps the
// verified account codes in bankConceptMap.ts, and normalizes to the SAME
// FinancialImportPayload shape every other financials source uses — so if
// this is ever promoted to a production source, it calls the identical
// financialsRepository.ts upsert functions with source_type: 'cmf_bank'.
//
// NOT wired to any cron or default ingestion set. `writeImport` is
// intentionally NOT implemented — this module is discovery/dry-run only
// until a human reviews the mapping coverage and decides to promote it (see
// scripts/discover/bankFinancialsDiscovery.ts, which never writes).
//
// The monthly ZIP's page path is stable and official but this exact CSS/HTML
// article-listing structure (used to find the current month's download link)
// is NOT a published/versioned API — same caveat this app already applies to
// the non-bank CMF/XBRL entidad.php surface.

import { unzip } from '../xbrl/unzip.ts'
import { parseBankAccountFile, findAccountRow, bankFileName, type ParsedBankAccountFile } from '../banks/parseBankAccountFile.ts'
import { getBankRegistryEntry } from '../banks/bankRegistry.ts'
import { BANK_CONCEPT_MAP, mapBankConcept } from '../banks/bankConceptMap.ts'
import { validateBankFinancials, type BankValidationOutcome } from '../banks/validateBankFinancials.ts'
import type { FinancialImportPayload, ReportingPeriodImportRow, StatementItemImportRow } from '../csvFinancials.ts'

export const CMF_BANK_PROVIDER_ID = 'cmf-bank'
export const BANK_STATS_PAGE_URL = 'https://www.cmfchile.cl/portal/estadisticas/626/w4-propertyvalue-30250.html'

export interface BankFilingRef {
  ticker: string
  bankCode: string
  year: number
  month: number
  /** True only for the December (fiscal year-end) release — the annual-only scope this pipeline targets by default. */
  isAnnualPeriod: boolean
}

export interface BankDryRunResult {
  ticker: string
  bankCode: string
  bankName: string
  year: number
  month: number
  isAnnualPeriod: boolean
  mappedFieldCount: number
  totalConceptsInMap: number
  currency: 'CLP'
  validation: BankValidationOutcome
  payload: FinancialImportPayload
}

export type BankProviderErrorCode = 'ticker_not_a_bank' | 'network_error' | 'not_found' | 'parse_error'
export interface BankProviderError { code: BankProviderErrorCode; reason: string; nextAction: string }
export type BankProviderResult<T> = { ok: true; value: T } | { ok: false; error: BankProviderError }

/** Builds the most recently COMPLETED annual (December) filing ref for a bank ticker. */
export function buildAnnualBankFilingRef(ticker: string, fromYear = new Date().getFullYear() - 1): BankProviderResult<BankFilingRef> {
  const entry = getBankRegistryEntry(ticker)
  if (!entry) {
    return { ok: false, error: { code: 'ticker_not_a_bank', reason: `"${ticker}" is not in BANK_REGISTRY`, nextAction: 'Only BSANTANDER/CHILE/BCI/ITAUCL are registered bank tickers.' } }
  }
  return { ok: true, value: { ticker, bankCode: entry.bankCode, year: fromYear, month: 12, isAnnualPeriod: true } }
}

export const SPANISH_MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * Pure HTML matcher — no network. Real markup observed live: the download
 * link's month/year appears in its own `aria-label` attribute value
 * ("Descargar <Mes> <YYYY> (zip, ...)"), not in the anchor's visible text —
 * e.g. `href="articles-103192_recurso_1.zip?ts=..." ... aria-label="Descargar
 * Diciembre 2025 (zip, se abre en nueva ventana)"`. CMF's article URLs are
 * NOT predictable from year/month alone (each release gets an opaque
 * `articles-<id>_recurso_1.zip` id) — this matches the visible link exactly
 * as a human would locate it, never guessing an id. Exported separately from
 * the network fetch so it is unit-testable without a live CMF call.
 */
export function findBankZipLinkInHtml(html: string, year: number, month: number): string | null {
  const monthName = SPANISH_MONTH_NAMES[month - 1]
  const re = new RegExp(`href="(articles-\\d+_recurso_1\\.zip[^"]*)"[^>]*aria-label="Descargar\\s+${monthName}\\s+${year}\\b`, 'i')
  const m = re.exec(html)
  return m ? m[1] : null
}

/**
 * Discovers the ZIP download URL for a given year/month from the statistics
 * listing page (network call).
 */
export async function discoverBankZipUrl(year: number, month: number): Promise<BankProviderResult<string>> {
  const res = await fetch(BANK_STATS_PAGE_URL, { redirect: 'follow' })
  if (!res.ok) return { ok: false, error: { code: 'network_error', reason: `statistics page returned HTTP ${res.status}`, nextAction: 'Retry later.' } }
  const html = await res.text()
  const monthName = SPANISH_MONTH_NAMES[month - 1]
  const relative = findBankZipLinkInHtml(html, year, month)
  if (!relative) {
    return { ok: false, error: { code: 'not_found', reason: `no "${monthName} ${year}" release link found on the statistics page`, nextAction: 'The release may not be published yet, or the page markup changed — verify manually.' } }
  }
  return { ok: true, value: `https://www.cmfchile.cl/portal/estadisticas/626/${relative}` }
}

/** Fetches and unzips the monthly release, returning the raw text of one bank's b1 and r1 files. */
async function fetchBankFiles(ref: BankFilingRef): Promise<BankProviderResult<{ b1: string; r1: string }>> {
  const urlResult = await discoverBankZipUrl(ref.year, ref.month)
  if (!urlResult.ok) return urlResult

  const download = await fetch(urlResult.value, { redirect: 'follow' })
  if (!download.ok) return { ok: false, error: { code: 'network_error', reason: `ZIP download returned HTTP ${download.status}`, nextAction: 'Retry later.' } }
  const buf = Buffer.from(await download.arrayBuffer())
  const unzipped = unzip(buf)
  if (!unzipped.ok) return { ok: false, error: { code: 'parse_error', reason: `could not unzip: ${unzipped.error.code} — ${unzipped.error.reason}`, nextAction: 'Verify the download is a real ZIP.' } }

  const b1Name = bankFileName('b1', ref.year, ref.month, ref.bankCode)
  const r1Name = bankFileName('r1', ref.year, ref.month, ref.bankCode)
  const b1Entry = unzipped.entries.find((e) => e.name.endsWith(b1Name))
  const r1Entry = unzipped.entries.find((e) => e.name.endsWith(r1Name))
  if (!b1Entry || !r1Entry) {
    return { ok: false, error: { code: 'not_found', reason: `archive (${unzipped.entries.length} entries) is missing ${b1Name} or ${r1Name}`, nextAction: 'Verify the bank code and period are correct.' } }
  }
  return { ok: true, value: { b1: b1Entry.data.toString('utf8'), r1: r1Entry.data.toString('utf8') } }
}

/** Maps a parsed file's rows through BANK_CONCEPT_MAP for the given statementType, summing all columns (balance) or taking the total (income). Caller fills in ticker/fiscalYear. */
export function mapFileRows(parsed: ParsedBankAccountFile, statementType: 'balance' | 'income', ticker: string, fiscalYear: number): StatementItemImportRow[] {
  const out: StatementItemImportRow[] = []
  const seen = new Set<string>()
  for (const entry of Object.values(BANK_CONCEPT_MAP)) {
    if (entry.statementType !== statementType) continue
    if (seen.has(entry.lineItemCode)) continue
    const row = findAccountRow(parsed, entry.accountCode)
    if (!row) continue // not reported this period — never fabricated as zero
    seen.add(entry.lineItemCode)
    out.push({
      ticker,
      fiscalYear,
      fiscalPeriod: 'FY',
      periodType: 'annual',
      statementType,
      lineItemCode: entry.lineItemCode,
      lineItemName: entry.lineItemCode,
      value: row.total,
      unit: 'CLP',
      scale: 'units',
      sourceType: 'cmf_bank',
      sourceName: 'CMF Balance y Estado de Situación Bancos (Compendio de Normas Contables para Bancos)',
      sourceUrl: BANK_STATS_PAGE_URL,
      sourceFile: null,
      sourceAsOf: new Date().toISOString(),
      metadata: {
        accountCode: entry.accountCode,
        officialLabel: entry.officialLabel,
        mappingConfidence: entry.confidence,
        expenseSign: entry.expenseSign ?? null,
        rawColumns: row.columns,
      },
    })
  }
  return out
}

/**
 * Runs the full discover -> fetch -> parse -> map -> validate chain for one
 * bank ticker and produces a dry-run diagnostic result. NEVER writes to the
 * database — there is no writeImport path in this module. Mirrors the shape
 * of cmfXbrlProvider's dryRunImport but bank-specific.
 */
export async function dryRunBankFinancials(ticker: string, fromYear?: number): Promise<BankProviderResult<BankDryRunResult>> {
  const refResult = buildAnnualBankFilingRef(ticker, fromYear)
  if (!refResult.ok) return refResult
  const ref = refResult.value
  const entry = getBankRegistryEntry(ticker)!

  const filesResult = await fetchBankFiles(ref)
  if (!filesResult.ok) return filesResult

  const b1Parsed = parseBankAccountFile(filesResult.value.b1)
  if (!b1Parsed.ok) return { ok: false, error: { code: 'parse_error', reason: `balance sheet: ${b1Parsed.error.reason}`, nextAction: 'Inspect the raw file manually.' } }
  const r1Parsed = parseBankAccountFile(filesResult.value.r1)
  if (!r1Parsed.ok) return { ok: false, error: { code: 'parse_error', reason: `income statement: ${r1Parsed.error.reason}`, nextAction: 'Inspect the raw file manually.' } }

  const balanceItems = mapFileRows(b1Parsed.value, 'balance', ticker, ref.year)
  const incomeItems = mapFileRows(r1Parsed.value, 'income', ticker, ref.year)
  const statementItems = [...balanceItems, ...incomeItems]

  const validation = validateBankFinancials({
    facts: statementItems.map((f) => ({ lineItemCode: f.lineItemCode, value: f.value })),
    currency: 'CLP',
    isAnnualPeriod: ref.isAnnualPeriod,
  })

  const reportingPeriod: ReportingPeriodImportRow = {
    ticker,
    fiscalYear: ref.year,
    fiscalPeriod: 'FY',
    periodType: 'annual',
    periodEndDate: `${ref.year}-12-31`,
    reportDate: null,
    currency: 'CLP',
    sourceType: 'cmf_bank',
    sourceName: 'CMF Balance y Estado de Situación Bancos',
    sourceUrl: BANK_STATS_PAGE_URL,
    sourceFile: null,
    sourceAsOf: new Date().toISOString(),
    periodNature: 'annual',
    filingPeriodLabel: `${String(ref.month).padStart(2, '0')}/${ref.year}`,
  }

  const payload: FinancialImportPayload = {
    reportingPeriods: [reportingPeriod],
    statementItems,
    metrics: [],
    earningsEvents: [],
    errors: [],
  }

  return {
    ok: true,
    value: {
      ticker,
      bankCode: entry.bankCode,
      bankName: b1Parsed.value.bankName,
      year: ref.year,
      month: ref.month,
      isAnnualPeriod: ref.isAnnualPeriod,
      mappedFieldCount: statementItems.length,
      totalConceptsInMap: Object.keys(BANK_CONCEPT_MAP).length,
      currency: 'CLP',
      validation,
      payload,
    },
  }
}

export { mapBankConcept }
