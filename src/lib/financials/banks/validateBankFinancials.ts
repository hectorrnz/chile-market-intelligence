// Phase 8C.7 — data-quality validation for normalized bank financials.
// Mirrors ../xbrl/validateFinancials.ts's severity model and tolerance
// convention for consistency, adapted to the bank-specific field set.

export type BankValidationStatus = 'valid' | 'valid_with_warnings' | 'review_required' | 'invalid'

export type BankFinancialsWarningCode =
  | 'BALANCE_SHEET_IDENTITY_MISMATCH'
  | 'INCOME_STATEMENT_IDENTITY_MISMATCH'
  | 'NEGATIVE_LOANS_OR_ASSETS'
  | 'IMPLAUSIBLE_CAPITAL_RATIO'
  | 'PERIOD_NOT_ANNUAL'
  | 'CURRENCY_MISSING'
  | 'NON_FINITE_VALUE'
  | 'FEW_MAPPED_FIELDS'

export interface BankValidationWarning {
  code: BankFinancialsWarningCode
  detail: string
}

export interface BankValidationOutcome {
  status: BankValidationStatus
  warnings: BankValidationWarning[]
}

export interface BankNormalizedFact {
  lineItemCode: string
  value: number | null
}

export interface BankValidateInput {
  facts: BankNormalizedFact[]
  currency: string | null
  /** True only when this period is the December (fiscal year-end) release — the annual-only default this pipeline targets. */
  isAnnualPeriod: boolean
}

const IDENTITY_TOLERANCE = 0.01 // 1%

function firstValue(facts: BankNormalizedFact[], code: string): number | null {
  const f = facts.find((x) => x.lineItemCode === code)
  return f && typeof f.value === 'number' && Number.isFinite(f.value) ? f.value : null
}

export function validateBankFinancials(input: BankValidateInput): BankValidationOutcome {
  const warnings: BankValidationWarning[] = []
  let hardInvalid = false
  let reviewRequired = false

  for (const f of input.facts) {
    if (f.value !== null && !Number.isFinite(f.value)) {
      warnings.push({ code: 'NON_FINITE_VALUE', detail: `${f.lineItemCode} has a non-finite value` })
      hardInvalid = true
    }
  }

  if (!input.currency) {
    warnings.push({ code: 'CURRENCY_MISSING', detail: 'no currency determined (this feed is CLP-only per CMF regulatory convention)' })
    reviewRequired = true
  }

  if (!input.isAnnualPeriod) {
    warnings.push({ code: 'PERIOD_NOT_ANNUAL', detail: 'this period is not a December (fiscal year-end) release — annual-only is the default scope for this pipeline' })
    reviewRequired = true
  }

  const assets = firstValue(input.facts, 'total_assets')
  const liabilities = firstValue(input.facts, 'total_liabilities')
  const equity = firstValue(input.facts, 'total_equity')
  if (assets !== null && liabilities !== null && equity !== null) {
    const rhs = liabilities + equity
    const denom = Math.abs(assets) > 0 ? Math.abs(assets) : 1
    const relError = Math.abs(assets - rhs) / denom
    if (relError > IDENTITY_TOLERANCE) {
      warnings.push({ code: 'BALANCE_SHEET_IDENTITY_MISMATCH', detail: `total_assets (${assets}) != total_liabilities + total_equity (${rhs}); relative error ${(relError * 100).toFixed(2)}%` })
      reviewRequired = true
    }
  }

  const pretax = firstValue(input.facts, 'profit_before_tax')
  const tax = firstValue(input.facts, 'tax_expense')
  const net = firstValue(input.facts, 'net_income')
  if (pretax !== null && tax !== null && net !== null) {
    const rhs = pretax + tax
    const denom = Math.abs(net) > 0 ? Math.abs(net) : 1
    const relError = Math.abs(net - rhs) / denom
    if (relError > IDENTITY_TOLERANCE) {
      warnings.push({ code: 'INCOME_STATEMENT_IDENTITY_MISMATCH', detail: `net_income (${net}) != profit_before_tax + tax_expense (${rhs}); relative error ${(relError * 100).toFixed(2)}%` })
      reviewRequired = true
    }
  }

  const loans = firstValue(input.facts, 'loans_to_customers')
  if (loans !== null && loans < 0) {
    warnings.push({ code: 'NEGATIVE_LOANS_OR_ASSETS', detail: `loans_to_customers is negative (${loans}) — implausible for a gross loan balance` })
    reviewRequired = true
  }
  if (assets !== null && assets < 0) {
    warnings.push({ code: 'NEGATIVE_LOANS_OR_ASSETS', detail: `total_assets is negative (${assets})` })
    hardInvalid = true
  }

  // Capital ratios are never populated by this pipeline (see bankStatementTypes.ts
  // CAPITAL_RATIO_FIELDS), but if a future source ever supplies one, sanity-check
  // it stays a plausible percentage before trusting it.
  for (const code of ['cet1_ratio', 'tier1_ratio', 'total_capital_ratio', 'npl_ratio', 'coverage_ratio']) {
    const v = firstValue(input.facts, code)
    if (v !== null && (v < 0 || v > 100)) {
      warnings.push({ code: 'IMPLAUSIBLE_CAPITAL_RATIO', detail: `${code} = ${v} is outside a plausible 0-100% range` })
      reviewRequired = true
    }
  }

  if (input.facts.length < 5) {
    warnings.push({ code: 'FEW_MAPPED_FIELDS', detail: `only ${input.facts.length} field(s) mapped — the bank concept map is deliberately conservative (see bankConceptMap.ts BANK_KNOWN_UNMAPPED_CODES)` })
  }

  if (hardInvalid) return { status: 'invalid', warnings }
  if (reviewRequired) return { status: 'review_required', warnings }
  if (warnings.length > 0) return { status: 'valid_with_warnings', warnings }
  return { status: 'valid', warnings }
}
