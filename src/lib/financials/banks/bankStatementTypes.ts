// Phase 8C.7 — bank-specific normalized financial statement field model.
//
// Chilean banks report under CMF's separate banking-supervision track (the
// former SBIF), using a bank-specific accounting chart ("Compendio de Normas
// Contables para Bancos", Circular N°2.243) — net interest income, loan-loss
// provisions, regulatory capital — not revenue/EBITDA/gross profit. This is a
// DISTINCT model from the industrial LineItemCode union in
// ../xbrl/conceptMap.ts and must never be conflated with it (a bank's
// "interest income" is not "revenue"; "loans to customers" is not "current
// assets"; "customer deposits" is not "current liabilities").
//
// Fields with no confirmed source stay absent from a payload — never zero,
// never inferred. See bankConceptMap.ts for which of these are currently
// mapped from a verified account code vs. left unmapped/deferred.

export type BankLineItemCode =
  // ── Income statement ──────────────────────────────────────────────────────
  | 'net_interest_income'
  | 'interest_income'
  | 'interest_expense'
  | 'fee_and_commission_income'
  | 'fee_and_commission_expense'
  | 'net_fee_income'
  | 'trading_income'
  | 'other_operating_income'
  | 'operating_expenses'
  | 'pre_provision_profit'
  | 'loan_loss_provisions'
  | 'profit_before_tax'
  | 'tax_expense'
  | 'net_income'
  | 'net_income_attributable_to_parent'
  | 'eps_basic'
  | 'eps_diluted'
  // ── Balance sheet ─────────────────────────────────────────────────────────
  | 'cash_and_due_from_banks'
  | 'financial_assets'
  | 'loans_to_customers'
  | 'allowance_for_loan_losses'
  | 'net_loans'
  | 'total_assets'
  | 'customer_deposits'
  | 'borrowings'
  | 'debt_securities_issued'
  | 'total_liabilities'
  | 'total_equity'
  | 'equity_attributable_to_parent'
  | 'minority_interest'
  // ── Capital and risk metrics (only if reported — never inferred) ─────────
  | 'cet1_capital'
  | 'tier1_capital'
  | 'total_capital'
  | 'risk_weighted_assets'
  | 'cet1_ratio'
  | 'tier1_ratio'
  | 'total_capital_ratio'
  | 'npl_ratio'
  | 'coverage_ratio'
  | 'cost_of_risk'
  | 'roa'
  | 'roe'

export type BankStatementSection = 'income' | 'balance' | 'capital'

/** Same confidence vocabulary as the industrial concept map, for consistency. */
export type BankMappingConfidence = 'high' | 'medium' | 'low' | 'review_required'

export interface BankLineItemMeta {
  code: BankLineItemCode
  section: BankStatementSection
  /** True for fields this pipeline has never confirmed a source for (capital ratios — a separate Pillar 3 publication this phase did not ingest). */
  neverFabricate: true
}

/** Full target field model — not all fields are mapped yet (see bankConceptMap.ts). Declaring the full model up front documents intent even for fields with no current source. */
export const BANK_LINE_ITEM_MODEL: Record<BankLineItemCode, BankLineItemMeta> = {
  net_interest_income: { code: 'net_interest_income', section: 'income', neverFabricate: true },
  interest_income: { code: 'interest_income', section: 'income', neverFabricate: true },
  interest_expense: { code: 'interest_expense', section: 'income', neverFabricate: true },
  fee_and_commission_income: { code: 'fee_and_commission_income', section: 'income', neverFabricate: true },
  fee_and_commission_expense: { code: 'fee_and_commission_expense', section: 'income', neverFabricate: true },
  net_fee_income: { code: 'net_fee_income', section: 'income', neverFabricate: true },
  trading_income: { code: 'trading_income', section: 'income', neverFabricate: true },
  other_operating_income: { code: 'other_operating_income', section: 'income', neverFabricate: true },
  operating_expenses: { code: 'operating_expenses', section: 'income', neverFabricate: true },
  pre_provision_profit: { code: 'pre_provision_profit', section: 'income', neverFabricate: true },
  loan_loss_provisions: { code: 'loan_loss_provisions', section: 'income', neverFabricate: true },
  profit_before_tax: { code: 'profit_before_tax', section: 'income', neverFabricate: true },
  tax_expense: { code: 'tax_expense', section: 'income', neverFabricate: true },
  net_income: { code: 'net_income', section: 'income', neverFabricate: true },
  net_income_attributable_to_parent: { code: 'net_income_attributable_to_parent', section: 'income', neverFabricate: true },
  eps_basic: { code: 'eps_basic', section: 'income', neverFabricate: true },
  eps_diluted: { code: 'eps_diluted', section: 'income', neverFabricate: true },
  cash_and_due_from_banks: { code: 'cash_and_due_from_banks', section: 'balance', neverFabricate: true },
  financial_assets: { code: 'financial_assets', section: 'balance', neverFabricate: true },
  loans_to_customers: { code: 'loans_to_customers', section: 'balance', neverFabricate: true },
  allowance_for_loan_losses: { code: 'allowance_for_loan_losses', section: 'balance', neverFabricate: true },
  net_loans: { code: 'net_loans', section: 'balance', neverFabricate: true },
  total_assets: { code: 'total_assets', section: 'balance', neverFabricate: true },
  customer_deposits: { code: 'customer_deposits', section: 'balance', neverFabricate: true },
  borrowings: { code: 'borrowings', section: 'balance', neverFabricate: true },
  debt_securities_issued: { code: 'debt_securities_issued', section: 'balance', neverFabricate: true },
  total_liabilities: { code: 'total_liabilities', section: 'balance', neverFabricate: true },
  total_equity: { code: 'total_equity', section: 'balance', neverFabricate: true },
  equity_attributable_to_parent: { code: 'equity_attributable_to_parent', section: 'balance', neverFabricate: true },
  minority_interest: { code: 'minority_interest', section: 'balance', neverFabricate: true },
  cet1_capital: { code: 'cet1_capital', section: 'capital', neverFabricate: true },
  tier1_capital: { code: 'tier1_capital', section: 'capital', neverFabricate: true },
  total_capital: { code: 'total_capital', section: 'capital', neverFabricate: true },
  risk_weighted_assets: { code: 'risk_weighted_assets', section: 'capital', neverFabricate: true },
  cet1_ratio: { code: 'cet1_ratio', section: 'capital', neverFabricate: true },
  tier1_ratio: { code: 'tier1_ratio', section: 'capital', neverFabricate: true },
  total_capital_ratio: { code: 'total_capital_ratio', section: 'capital', neverFabricate: true },
  npl_ratio: { code: 'npl_ratio', section: 'capital', neverFabricate: true },
  coverage_ratio: { code: 'coverage_ratio', section: 'capital', neverFabricate: true },
  cost_of_risk: { code: 'cost_of_risk', section: 'capital', neverFabricate: true },
  roa: { code: 'roa', section: 'capital', neverFabricate: true },
  roe: { code: 'roe', section: 'capital', neverFabricate: true },
}

/**
 * Capital/risk ratios are NEVER computed by this pipeline — they require
 * regulatory Risk-Weighted-Assets figures published separately by CMF under
 * its quarterly "Divulgación de Pilar 3 de Basilea" disclosure (not the
 * monthly Balance y Estado de Situación feed this phase ingests). Until that
 * separate source is investigated and verified, every field in this list
 * stays structurally absent from any bank payload — never inferred from
 * balance-sheet figures alone.
 */
export const CAPITAL_RATIO_FIELDS: BankLineItemCode[] = [
  'cet1_capital', 'tier1_capital', 'total_capital', 'risk_weighted_assets',
  'cet1_ratio', 'tier1_ratio', 'total_capital_ratio', 'npl_ratio', 'coverage_ratio', 'cost_of_risk', 'roa', 'roe',
]
