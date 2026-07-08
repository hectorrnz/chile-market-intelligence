// Phase 8C.2 — data-quality validation for normalized CMF/XBRL financials.
//
// Runs after a filing is parsed and normalized, before (and independently of)
// persistence. Produces a validation status + structured warning codes so the
// orchestrator can decide whether a filing is clean, warn-worthy, or must be
// held for review — never silently trusting or silently dropping data.
//
// Pure module (no I/O) — directly unit-testable.

export type ValidationStatus = 'valid' | 'valid_with_warnings' | 'review_required' | 'invalid'

export type FinancialsWarningCode =
  | 'BALANCE_SHEET_IDENTITY_MISMATCH'
  | 'PERIOD_TYPE_UNKNOWN'
  | 'CONTEXT_AMBIGUOUS'
  | 'UNIT_MISSING'
  | 'CURRENCY_MISSING'
  | 'SCALE_CHANGE_WARNING'
  | 'DUPLICATE_FACTS'
  | 'LOW_CONFIDENCE_MAPPING'
  | 'UNMAPPED_CONCEPTS'
  | 'DERIVED_QUARTER_VALUE'
  | 'CONSOLIDATED_CONTEXT_UNCLEAR'
  | 'RESTATEMENT_DETECTED'
  | 'SOURCE_SUPERSEDED'
  | 'NON_FINITE_VALUE'
  | 'PERIOD_CHRONOLOGY_INVALID'

export interface ValidationWarning {
  code: FinancialsWarningCode
  detail: string
}

export interface ValidationOutcome {
  status: ValidationStatus
  warnings: ValidationWarning[]
}

/** One normalized line item, as the validator sees it (a thin subset of StatementItemImportRow). */
export interface NormalizedFactForValidation {
  lineItemCode: string
  statementType: string
  value: number | null
  unit: string
  currency: string | null
  mappingConfidence?: string
  periodNature?: string
}

export interface ValidateInput {
  facts: NormalizedFactForValidation[]
  currency: string | null
  periodStartDate: string | null
  periodEndDate: string | null
  periodNature: string | null
  /** Count of raw plain-context concepts that had no mapping (for the UNMAPPED_CONCEPTS signal). */
  unmappedConceptCount: number
}

const BALANCE_SHEET_IDENTITY_TOLERANCE = 0.01 // 1% — accounting/rounding tolerance

function firstValue(facts: NormalizedFactForValidation[], code: string): number | null {
  const f = facts.find((x) => x.lineItemCode === code)
  return f && typeof f.value === 'number' && Number.isFinite(f.value) ? f.value : null
}

/**
 * Validates a normalized filing. Order of severity:
 *   invalid          — a non-finite numeric value, or an impossible period.
 *   review_required  — a balance-sheet identity mismatch, an unknown period
 *                      type, or a missing currency (a headline metric could be
 *                      mis-scaled/mis-attributed).
 *   valid_with_warnings — softer signals (missing unit on a line, low-confidence
 *                      mapping present, YTD-derived figure, unmapped concepts).
 *   valid            — no issues.
 */
export function validateNormalizedFinancials(input: ValidateInput): ValidationOutcome {
  const warnings: ValidationWarning[] = []
  let hardInvalid = false
  let reviewRequired = false

  // ── value validity ────────────────────────────────────────────────────────
  for (const f of input.facts) {
    if (f.value !== null && !Number.isFinite(f.value)) {
      warnings.push({ code: 'NON_FINITE_VALUE', detail: `${f.lineItemCode} has a non-finite value` })
      hardInvalid = true
    }
  }

  // ── period chronology ───────────────────────────────────────────────────────
  if (input.periodStartDate && input.periodEndDate) {
    if (input.periodStartDate > input.periodEndDate) {
      warnings.push({ code: 'PERIOD_CHRONOLOGY_INVALID', detail: `period_start ${input.periodStartDate} is after period_end ${input.periodEndDate}` })
      hardInvalid = true
    }
  }
  if (!input.periodNature || input.periodNature === 'unknown') {
    warnings.push({ code: 'PERIOD_TYPE_UNKNOWN', detail: 'period nature could not be classified' })
    reviewRequired = true
  }

  // ── currency ────────────────────────────────────────────────────────────────
  if (!input.currency) {
    warnings.push({ code: 'CURRENCY_MISSING', detail: 'no currency could be determined from any fact unit' })
    reviewRequired = true
  }

  // ── unit presence per line ──────────────────────────────────────────────────
  const monetaryMissingUnit = input.facts.filter((f) => f.lineItemCode !== 'eps' && f.lineItemCode !== 'eps_diluted' && (!f.unit || f.unit === 'unknown'))
  if (monetaryMissingUnit.length > 0) {
    warnings.push({ code: 'UNIT_MISSING', detail: `${monetaryMissingUnit.length} monetary line item(s) have no resolved unit` })
  }

  // ── balance-sheet identity: assets ≈ liabilities + equity ───────────────────
  const assets = firstValue(input.facts, 'total_assets')
  const liabilities = firstValue(input.facts, 'total_liabilities')
  const equity = firstValue(input.facts, 'equity')
  if (assets !== null && liabilities !== null && equity !== null) {
    const rhs = liabilities + equity
    const denom = Math.abs(assets) > 0 ? Math.abs(assets) : 1
    const relError = Math.abs(assets - rhs) / denom
    if (relError > BALANCE_SHEET_IDENTITY_TOLERANCE) {
      warnings.push({
        code: 'BALANCE_SHEET_IDENTITY_MISMATCH',
        detail: `total_assets (${assets}) != total_liabilities + equity (${rhs}); relative error ${(relError * 100).toFixed(2)}%`,
      })
      reviewRequired = true
    }
  }

  // ── mapping confidence ──────────────────────────────────────────────────────
  const lowConfidence = input.facts.filter((f) => f.mappingConfidence === 'low' || f.mappingConfidence === 'review_required')
  if (lowConfidence.length > 0) {
    warnings.push({ code: 'LOW_CONFIDENCE_MAPPING', detail: `${lowConfidence.length} line item(s) have low/review-required mapping confidence` })
  }

  // ── unmapped concepts ────────────────────────────────────────────────────────
  if (input.unmappedConceptCount > 0) {
    warnings.push({ code: 'UNMAPPED_CONCEPTS', detail: `${input.unmappedConceptCount} plain-context concept(s) were not mapped to a normalized line item (preserved in diagnostics, never fabricated)` })
  }

  // ── YTD-derived figure ───────────────────────────────────────────────────────
  if (input.periodNature === 'year_to_date') {
    warnings.push({ code: 'DERIVED_QUARTER_VALUE', detail: 'income/cash figures are cumulative year-to-date, not a discrete quarter — labeled accordingly, not comparable to a 3-month quarter' })
  }

  if (hardInvalid) return { status: 'invalid', warnings }
  if (reviewRequired) return { status: 'review_required', warnings }
  if (warnings.length > 0) return { status: 'valid_with_warnings', warnings }
  return { status: 'valid', warnings }
}
