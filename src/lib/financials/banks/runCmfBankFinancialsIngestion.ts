// Phase 8C.8 — CMF bank financials ingestion orchestrator.
//
// Drives the bank chain end to end for a set of bank tickers and annual
// periods: discover ZIP -> fetch -> unzip -> parse -> map -> validate ->
// (optionally) write via the same source-agnostic repository upsert
// functions the non-bank CMF/XBRL provider uses. Persisted rows carry
// source_type='cmf_bank' (priority 180) so they supersede yahoo_finance (80)
// for the same fiscal year and mapped field, while leaving Yahoo's
// quarterly/TTM/earlier-year/unmapped-field data untouched.
//
// Design guarantees (mirrors runCmfXbrlIngestion.ts):
//   - Per-bank isolation: one bank's failure never aborts the batch.
//   - Never fabricates data: a missing/unparseable/invalid release is
//     reported with a status + sanitized reason, never a zero or a guess.
//   - Conservative default: the most recently completed annual (December)
//     release only.
//   - write is false by default: nothing is written unless the caller passes
//     write: true AND validation clears the configured minimum.
//   - A bank whose validation is below the minimum, or whose payload maps
//     fewer than the expected field count, is marked deferred_unmapped or
//     validation_failed and is NEVER partially written as if it succeeded —
//     it stays on the Yahoo fallback for that period.

import { getAllBankTickers, getBankRegistryEntry } from './bankRegistry.ts'
import { dryRunBankFinancials, writeImport, type BankDryRunResult } from '../providers/cmfBankProvider.ts'
import type { BankValidationStatus, BankFinancialsWarningCode } from './validateBankFinancials.ts'

export type BankIngestStatus =
  | 'success'
  | 'partial_success'
  | 'source_unavailable'
  | 'parse_failed'
  | 'mapping_failed'
  | 'validation_failed'
  | 'persistence_failed'
  | 'deferred_unmapped'

export type RunStatus = 'success' | 'partial_success' | 'failed' | 'skipped'

export interface PerBankResult {
  ticker: string
  bankCode: string | null
  bankName: string | null
  fiscalYear: number | null
  status: BankIngestStatus
  validationStatus: BankValidationStatus | null
  warningCodes: BankFinancialsWarningCode[]
  fieldsMapped: number
  fieldsExpected: number
  rowsWritten: number
  currency: string | null
  reason: string | null
}

export interface CmfBankIngestionSummary {
  status: RunStatus
  banksAttempted: number
  banksSucceeded: number
  banksPartial: number
  banksFailed: number
  banksDeferred: number
  normalizedFactsPersisted: number
  fieldsMapped: number
  startedAt: string
  completedAt: string
  banks: PerBankResult[]
  sourceTypes: string[]
  warnings: string[]
  errors: string[]
}

export interface RunCmfBankFinancialsIngestionOptions {
  /** Bank tickers to ingest. Defaults to all 4 registered bank tickers. */
  tickers?: string[]
  /** Fiscal year of the annual (December) release to target. Defaults to the most recently completed FY. */
  fiscalYear?: number
  /** When true, actually write to Supabase. Default false (dry run). */
  write?: boolean
  ingestionRunId?: string | null
  /** Only accept a bank's payload for writing if validation is at least this good. Default: 'valid_with_warnings' — never write a review_required or invalid bank filing. */
  minValidationToWrite?: BankValidationStatus
  /** Minimum mapped-field count required to consider a bank's payload complete enough to write (guards against a silently-degraded partial parse). Default 10 (of the 14 currently mapped). */
  minFieldsToWrite?: number
  now?: Date
}

const VALIDATION_RANK: Record<BankValidationStatus, number> = { invalid: 0, review_required: 1, valid_with_warnings: 2, valid: 3 }

function meetsMinValidation(status: BankValidationStatus, min: BankValidationStatus): boolean {
  return VALIDATION_RANK[status] >= VALIDATION_RANK[min]
}

function sanitize(msg: string): string {
  return msg.replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***').replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***').slice(0, 300)
}

/** Runs one bank end to end. Never throws — any exception is caught and returned as a failed-status result. */
async function ingestBank(
  ticker: string,
  opts: { fiscalYear?: number; write: boolean; minValidationToWrite: BankValidationStatus; minFieldsToWrite: number; ingestionRunId: string | null },
): Promise<PerBankResult> {
  const entry = getBankRegistryEntry(ticker)
  const base: PerBankResult = {
    ticker,
    bankCode: entry?.bankCode ?? null,
    bankName: null,
    fiscalYear: opts.fiscalYear ?? null,
    status: 'source_unavailable',
    validationStatus: null,
    warningCodes: [],
    fieldsMapped: 0,
    fieldsExpected: 0,
    rowsWritten: 0,
    currency: null,
    reason: null,
  }

  if (!entry) {
    return { ...base, status: 'source_unavailable', reason: `"${ticker}" is not a registered bank ticker` }
  }

  let result: Awaited<ReturnType<typeof dryRunBankFinancials>>
  try {
    result = await dryRunBankFinancials(ticker, opts.fiscalYear)
  } catch (e) {
    return { ...base, status: 'source_unavailable', reason: sanitize(e instanceof Error ? e.message : 'unknown error') }
  }

  if (!result.ok) {
    const status: BankIngestStatus = result.error.code === 'parse_error' ? 'parse_failed' : 'source_unavailable'
    return { ...base, status, reason: `${result.error.code}: ${result.error.reason}` }
  }

  const dry: BankDryRunResult = result.value
  const withData: PerBankResult = {
    ...base,
    bankName: dry.bankName,
    fiscalYear: dry.year,
    validationStatus: dry.validation.status,
    warningCodes: dry.validation.warnings.map((w) => w.code),
    fieldsMapped: dry.mappedFieldCount,
    fieldsExpected: dry.totalConceptsInMap,
    currency: dry.currency,
  }

  if (dry.mappedFieldCount === 0) {
    return { ...withData, status: 'mapping_failed', reason: 'no account codes matched the concept map for this release' }
  }
  if (dry.mappedFieldCount < opts.minFieldsToWrite) {
    return { ...withData, status: 'deferred_unmapped', reason: `only ${dry.mappedFieldCount}/${dry.totalConceptsInMap} fields mapped — below the ${opts.minFieldsToWrite}-field minimum to write; deferred to Yahoo fallback` }
  }
  if (!meetsMinValidation(dry.validation.status, opts.minValidationToWrite)) {
    return { ...withData, status: 'validation_failed', reason: `validation=${dry.validation.status} below required ${opts.minValidationToWrite} — deferred to Yahoo fallback` }
  }

  if (!opts.write) {
    return { ...withData, status: dry.mappedFieldCount === dry.totalConceptsInMap ? 'success' : 'partial_success' }
  }

  try {
    const writeResult = await writeImport(dry.payload, opts.ingestionRunId)
    if (!writeResult.ok) {
      return { ...withData, status: 'persistence_failed', reason: `persist: ${writeResult.error.reason}` }
    }
    return {
      ...withData,
      status: dry.mappedFieldCount === dry.totalConceptsInMap ? 'success' : 'partial_success',
      rowsWritten: writeResult.value.rowsInserted,
    }
  } catch (e) {
    return { ...withData, status: 'persistence_failed', reason: sanitize(e instanceof Error ? e.message : 'unknown error') }
  }
}

/**
 * Runs CMF bank financials ingestion across the requested bank tickers.
 * Defaults to all 4 registered banks and the most recently completed annual
 * (December) release. Pure orchestration over the provider — no direct
 * network/DB code here beyond the provider/repository calls it already makes.
 */
export async function runCmfBankFinancialsIngestion(options: RunCmfBankFinancialsIngestionOptions = {}): Promise<CmfBankIngestionSummary> {
  const startedAt = (options.now ?? new Date()).toISOString()
  const tickers = (options.tickers && options.tickers.length > 0 ? options.tickers : getAllBankTickers()).map((t) => t.toUpperCase())
  const write = options.write ?? false
  const minValidationToWrite = options.minValidationToWrite ?? 'valid_with_warnings'
  const minFieldsToWrite = options.minFieldsToWrite ?? 10
  const ingestionRunId = options.ingestionRunId ?? null

  const banks: PerBankResult[] = []
  const errors: string[] = []

  for (const ticker of tickers) {
    try {
      const result = await ingestBank(ticker, { fiscalYear: options.fiscalYear, write, minValidationToWrite, minFieldsToWrite, ingestionRunId })
      banks.push(result)
    } catch (e) {
      errors.push(`${ticker}: ${sanitize(e instanceof Error ? e.message : 'unknown error')}`)
      banks.push({
        ticker, bankCode: null, bankName: null, fiscalYear: null, status: 'source_unavailable',
        validationStatus: null, warningCodes: [], fieldsMapped: 0, fieldsExpected: 0, rowsWritten: 0, currency: null,
        reason: 'unexpected orchestrator error',
      })
    }
  }

  const banksSucceeded = banks.filter((b) => b.status === 'success').length
  const banksPartial = banks.filter((b) => b.status === 'partial_success').length
  const banksDeferred = banks.filter((b) => b.status === 'deferred_unmapped').length
  const banksFailed = banks.filter((b) => !['success', 'partial_success', 'deferred_unmapped'].includes(b.status)).length
  const normalizedFactsPersisted = banks.reduce((n, b) => n + b.rowsWritten, 0)
  const fieldsMapped = banks.reduce((n, b) => n + b.fieldsMapped, 0)

  let status: RunStatus
  if (banks.length === 0) status = 'skipped'
  else if (banksSucceeded > 0 && (banksPartial > 0 || banksFailed > 0 || banksDeferred > 0)) status = 'partial_success'
  else if (banksSucceeded > 0) status = 'success'
  else if (banksPartial > 0) status = 'partial_success'
  else status = 'failed'

  return {
    status,
    banksAttempted: banks.length,
    banksSucceeded,
    banksPartial,
    banksFailed,
    banksDeferred,
    normalizedFactsPersisted,
    fieldsMapped,
    startedAt,
    completedAt: (options.now ?? new Date()).toISOString(),
    banks,
    sourceTypes: ['cmf_bank'],
    warnings: [],
    errors,
  }
}
