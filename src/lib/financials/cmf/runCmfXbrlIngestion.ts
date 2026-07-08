// Phase 8C.2 — CMF/XBRL financials ingestion orchestrator.
//
// Drives the verified two-step CMF chain end to end for a set of issuers and
// periods: discover → fetch → unzip → parse → normalize (period-matched) →
// validate → (optionally) write via the same source-agnostic repository upsert
// functions manual CSV uses. Automated XBRL rows carry source_type='xbrl'
// (priority 210) so they supersede manual_csv (100) for the same period.
//
// Design guarantees:
//   - Per-issuer isolation: one issuer's failure never aborts the batch (each
//     is wrapped in try/catch and reported with its own status).
//   - Never fabricates data: a missing/blocked/invalid filing is reported with
//     a status + sanitized reason, never a zero or a guess.
//   - Conservative default period set: ANNUAL (December) filings only, whose
//     period semantics are unambiguous. Interim (YTD) filings are supported by
//     the provider but not ingested by default (see docs).
//   - dryRun by default: nothing is written unless `write: true` AND a Supabase
//     admin client is available. The route/CLI decides.
//
// Server-only (the write path imports the admin client lazily). No secrets are
// ever echoed; errors are sanitized to bounded strings.

import { getEnabledTickers, getCmfIssuer } from '../cmfIssuerMap.ts'
import {
  cmfXbrlProvider,
  candidateAnnualPeriods,
  buildFilingRefs,
  countUnmappedPlainConcepts,
  instanceFromParsed,
} from '../providers/cmfXbrlProvider.ts'
import { validateNormalizedFinancials, type ValidationStatus, type FinancialsWarningCode } from '../xbrl/validateFinancials.ts'
import type { FinancialImportPayload } from '../csvFinancials.ts'

export type IssuerIngestStatus =
  | 'success'
  | 'partial_success'
  | 'no_filing_found'
  | 'not_configured'
  | 'xbrl_link_missing'
  | 'download_failed'
  | 'parse_failed'
  | 'validation_failed'
  | 'persistence_failed'

export type RunStatus = 'success' | 'partial_success' | 'failed' | 'skipped' | 'no_filing_found'

export interface PerFilingResult {
  ticker: string
  filingPeriodLabel: string
  fiscalYear: number | null
  fiscalPeriod: string | null
  periodNature: string | null
  status: 'ingested' | 'dry_run_ok' | 'no_filing' | 'error'
  validationStatus: ValidationStatus | null
  warningCodes: FinancialsWarningCode[]
  rawFactsSeen: number
  fieldsMapped: number
  fieldsUnmapped: number
  rowsWritten: number
  currency: string | null
  reason: string | null
}

export interface PerIssuerResult {
  ticker: string
  status: IssuerIngestStatus
  filings: PerFilingResult[]
}

export interface CmfXbrlIngestionSummary {
  status: RunStatus
  issuersAttempted: number
  issuersSucceeded: number
  issuersPartial: number
  issuersFailed: number
  filingsDiscovered: number
  filingsDownloaded: number
  filingsParsed: number
  normalizedFactsPersisted: number
  fieldsMapped: number
  fieldsUnmapped: number
  validationWarnings: number
  sourceTypes: string[]
  startedAt: string
  completedAt: string
  issuers: PerIssuerResult[]
  warnings: string[]
  errors: string[]
}

export interface RunCmfXbrlIngestionOptions {
  /** Tickers to ingest. Defaults to every mapped issuer. */
  tickers?: string[]
  /** How many recent annual periods per issuer. Default 1 (most recent completed FY). */
  annualPeriodsPerIssuer?: number
  /** When true, actually write to Supabase (admin client). Default false (dry run). */
  write?: boolean
  /** Ingestion run id to stamp on written rows. */
  ingestionRunId?: string | null
  /** Only accept filings whose validation is at least this good before writing. Default: skip only 'invalid'. */
  minValidationToWrite?: ValidationStatus
  /** Clock injection for tests. */
  now?: Date
}

function sanitize(msg: string): string {
  return msg
    .replace(/eyJ[A-Za-z0-9_.\-]{40,}/g, '***JWT***')
    .replace(/key=[A-Za-z0-9_.\-]{20,}/gi, 'key=***')
    .slice(0, 300)
}

const VALIDATION_RANK: Record<ValidationStatus, number> = { invalid: 0, review_required: 1, valid_with_warnings: 2, valid: 3 }

/** True if `status` is at least as good as `min`. */
function meetsMinValidation(status: ValidationStatus, min: ValidationStatus): boolean {
  return VALIDATION_RANK[status] >= VALIDATION_RANK[min]
}

/**
 * Runs one issuer end to end over its requested periods. Never throws — any
 * exception is caught and returned as an `error`-status filing result.
 */
async function ingestIssuer(
  ticker: string,
  periods: { mm: string; aa: string }[],
  opts: Required<Pick<RunCmfXbrlIngestionOptions, 'write' | 'minValidationToWrite'>> & { ingestionRunId: string | null },
): Promise<PerIssuerResult> {
  if (!getCmfIssuer(ticker)) {
    return { ticker, status: 'not_configured', filings: [] }
  }

  const refs = buildFilingRefs(ticker, periods)
  const filings: PerFilingResult[] = []

  for (const ref of refs) {
    const base: PerFilingResult = {
      ticker,
      filingPeriodLabel: `${ref.fiscalPeriod ?? '?'}/${ref.fiscalYear ?? '?'}`,
      fiscalYear: ref.fiscalYear,
      fiscalPeriod: ref.fiscalPeriod,
      periodNature: null,
      status: 'error',
      validationStatus: null,
      warningCodes: [],
      rawFactsSeen: 0,
      fieldsMapped: 0,
      fieldsUnmapped: 0,
      rowsWritten: 0,
      currency: null,
      reason: null,
    }
    try {
      const raw = await cmfXbrlProvider.fetchFiling(ref)
      if (!raw.ok) {
        filings.push({ ...base, status: raw.error.code === 'not_found' ? 'no_filing' : 'error', reason: `${raw.error.code}: ${raw.error.reason}` })
        continue
      }
      const parsed = cmfXbrlProvider.parseFiling(raw.value)
      if (!parsed.ok) {
        filings.push({ ...base, status: 'error', reason: `parse: ${parsed.error.reason}` })
        continue
      }
      const instance = instanceFromParsed(parsed.value)
      const payloadResult = cmfXbrlProvider.normalizeToFinancialImportPayload(parsed.value)
      if (!payloadResult.ok) {
        filings.push({ ...base, status: 'error', reason: `normalize: ${payloadResult.error.reason}` })
        continue
      }
      const payload: FinancialImportPayload = payloadResult.value
      const period = payload.reportingPeriods[0] ?? null
      const unmapped = instance ? countUnmappedPlainConcepts(instance) : 0

      const validation = validateNormalizedFinancials({
        facts: payload.statementItems.map((i) => ({
          lineItemCode: i.lineItemCode,
          statementType: i.statementType,
          value: i.value,
          unit: i.unit,
          currency: period?.currency ?? null,
          mappingConfidence: (i.metadata?.mappingConfidence as string) ?? undefined,
          periodNature: (i.metadata?.periodNature as string) ?? undefined,
        })),
        currency: period?.currency ?? null,
        periodStartDate: period?.periodStartDate ?? null,
        periodEndDate: period?.periodEndDate ?? null,
        periodNature: period?.periodNature ?? null,
        unmappedConceptCount: unmapped,
      })

      const filingResult: PerFilingResult = {
        ...base,
        filingPeriodLabel: period?.filingPeriodLabel ?? base.filingPeriodLabel,
        periodNature: period?.periodNature ?? null,
        validationStatus: validation.status,
        warningCodes: validation.warnings.map((w) => w.code),
        rawFactsSeen: instance?.facts.length ?? 0,
        fieldsMapped: payload.statementItems.length,
        fieldsUnmapped: unmapped,
        currency: period?.currency ?? null,
        status: 'dry_run_ok',
        reason: null,
      }

      if (opts.write) {
        if (!meetsMinValidation(validation.status, opts.minValidationToWrite)) {
          filingResult.status = 'error'
          filingResult.reason = `held for review: validation=${validation.status} below required ${opts.minValidationToWrite}`
        } else {
          const writeResult = await cmfXbrlProvider.writeImport(payload, opts.ingestionRunId)
          if (!writeResult.ok) {
            filingResult.status = 'error'
            filingResult.reason = `persist: ${writeResult.error.reason}`
          } else {
            filingResult.status = 'ingested'
            filingResult.rowsWritten = writeResult.value.rowsInserted
          }
        }
      }
      filings.push(filingResult)
    } catch (e) {
      filings.push({ ...base, status: 'error', reason: sanitize(e instanceof Error ? e.message : 'unknown error') })
    }
  }

  // Derive an issuer-level status from its filings.
  const anyIngestedOrDry = filings.some((f) => f.status === 'ingested' || f.status === 'dry_run_ok')
  const allNoFiling = filings.length > 0 && filings.every((f) => f.status === 'no_filing')
  const anyError = filings.some((f) => f.status === 'error')
  let status: IssuerIngestStatus
  if (allNoFiling) status = 'no_filing_found'
  else if (anyIngestedOrDry && anyError) status = 'partial_success'
  else if (anyIngestedOrDry) status = 'success'
  else status = 'parse_failed'

  return { ticker, status, filings }
}

/**
 * Runs CMF/XBRL ingestion across the requested issuers and periods. Pure
 * orchestration over the provider — no direct network/DB code here beyond the
 * provider/repository calls the provider already makes.
 */
export async function runCmfXbrlIngestion(options: RunCmfXbrlIngestionOptions = {}): Promise<CmfXbrlIngestionSummary> {
  const startedAt = (options.now ?? new Date()).toISOString()
  // Default ingestion set is ENABLED issuers only. eligible_verified issuers
  // are never written by a default run — they must be targeted explicitly by
  // ticker (dry-run) until promoted to 'enabled'.
  const tickers = (options.tickers && options.tickers.length > 0 ? options.tickers : getEnabledTickers()).map((t) => t.toUpperCase())
  const annualPeriods = candidateAnnualPeriods(options.annualPeriodsPerIssuer ?? 1, options.now ?? new Date())
  const write = options.write ?? false
  const minValidationToWrite = options.minValidationToWrite ?? 'review_required' // by default, write anything that isn't hard-invalid; 'review_required' rows are written but flagged
  const ingestionRunId = options.ingestionRunId ?? null

  const issuers: PerIssuerResult[] = []
  const warnings: string[] = []
  const errors: string[] = []

  for (const ticker of tickers) {
    try {
      const result = await ingestIssuer(ticker, annualPeriods, { write, minValidationToWrite, ingestionRunId })
      issuers.push(result)
    } catch (e) {
      errors.push(`${ticker}: ${sanitize(e instanceof Error ? e.message : 'unknown error')}`)
      issuers.push({ ticker, status: 'parse_failed', filings: [] })
    }
  }

  // Aggregate.
  const allFilings = issuers.flatMap((i) => i.filings)
  const issuersSucceeded = issuers.filter((i) => i.status === 'success').length
  const issuersPartial = issuers.filter((i) => i.status === 'partial_success').length
  const issuersFailed = issuers.filter((i) => i.status !== 'success' && i.status !== 'partial_success' && i.status !== 'no_filing_found').length
  const normalizedFactsPersisted = allFilings.reduce((n, f) => n + f.rowsWritten, 0)
  const fieldsMapped = allFilings.reduce((n, f) => n + f.fieldsMapped, 0)
  const fieldsUnmapped = allFilings.reduce((n, f) => n + f.fieldsUnmapped, 0)
  const validationWarnings = allFilings.reduce((n, f) => n + f.warningCodes.length, 0)
  const filingsDownloaded = allFilings.filter((f) => f.status !== 'no_filing' && f.status !== 'error').length
  const filingsParsed = filingsDownloaded

  let status: RunStatus
  if (issuers.length === 0) status = 'skipped'
  else if (allFilings.length > 0 && allFilings.every((f) => f.status === 'no_filing')) status = 'no_filing_found'
  else if (issuersSucceeded > 0 && (issuersPartial > 0 || issuersFailed > 0)) status = 'partial_success'
  else if (issuersSucceeded > 0) status = 'success'
  else if (issuersPartial > 0) status = 'partial_success'
  else status = 'failed'

  return {
    status,
    issuersAttempted: issuers.length,
    issuersSucceeded,
    issuersPartial,
    issuersFailed,
    filingsDiscovered: allFilings.length,
    filingsDownloaded,
    filingsParsed,
    normalizedFactsPersisted,
    fieldsMapped,
    fieldsUnmapped,
    validationWarnings,
    sourceTypes: ['xbrl'],
    startedAt,
    completedAt: (options.now ?? new Date()).toISOString(),
    issuers,
    warnings,
    errors,
  }
}
