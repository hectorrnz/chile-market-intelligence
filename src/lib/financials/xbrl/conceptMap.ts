// Phase 8C.1 — conservative XBRL concept -> internal line-item mapping.
//
// Only maps IFRS-full concepts that were actually observed in real CMF
// filings inspected during discovery (Ripley Chile 2023, Empresas Copec
// 2023 — see docs/cmf_xbrl_provider_discovery.md). Deliberately does NOT
// attempt to be an exhaustive IFRS taxonomy dictionary — every entry here
// was seen in a real filing, not guessed from the taxonomy schema alone.
//
// Rules (do not weaken):
//   - Conservative only: an ambiguous concept is left unmapped rather than
//     guessed onto the nearest line item.
//   - Never computes EBITDA here — EBITDA stays a derived metric computed
//     (only when the inputs are actually present) by
//     csvFinancials.ts's deriveFinancialMetrics, which this provider reuses
//     unchanged after normalization.
//   - Never forces a bank-specific concept onto an industrial line item or
//     vice versa — bankOnly/industrialOnly concepts are marked so a future
//     caller can choose to skip fields that don't apply to a given filer.
//   - Concepts with no entry here are NOT dropped — the raw fact list is
//     always preserved by the provider's parseFiling/normalize step so a
//     future mapping pass can improve coverage without re-fetching.

export type LineItemCode =
  | 'revenue'
  | 'cost_of_sales'
  | 'gross_profit'
  | 'operating_income'
  | 'finance_income'
  | 'finance_cost'
  | 'profit_before_tax'
  | 'tax_expense'
  | 'net_income'
  | 'net_income_attributable_to_parent'
  | 'eps'
  | 'eps_diluted'
  | 'total_assets'
  | 'current_assets'
  | 'total_liabilities'
  | 'current_liabilities'
  | 'equity'
  | 'equity_attributable_to_parent'
  | 'minority_interest'
  | 'cash'
  | 'ocf'
  | 'cash_flow_from_investing'
  | 'cash_flow_from_financing'
  | 'capex'
  | 'dividends_paid'
  | 'net_change_in_cash'

/**
 * How confident we are that a concept maps to the given line item:
 *   high            — standard IFRS Foundation concept, unambiguous, observed
 *                     (or a direct, universally-used IFRS concept name).
 *   medium          — standard concept but with a caveat (e.g. sign convention,
 *                     or not directly observed in the two sample filings yet).
 *   low             — plausible but should be reviewed before feeding a headline metric.
 *   review_required — must not feed a primary UI metric without human review.
 */
export type MappingConfidence = 'high' | 'medium' | 'low' | 'review_required'

export interface ConceptMapEntry {
  lineItemCode: LineItemCode
  /** 'income' | 'balance' | 'cash' — matches StatementType in csvFinancials.ts. */
  statementType: 'income' | 'balance' | 'cash'
  /** Confidence this explicit concept→line-item mapping is correct. */
  confidence: MappingConfidence
  /** If true, this concept only makes sense for bank/financial filers. */
  bankOnly?: boolean
  /** If true, this concept only makes sense for non-bank (industrial) filers. */
  industrialOnly?: boolean
  notes: string
}

/**
 * Keyed by full concept name (namespace prefix + local name) exactly as it
 * appears in a real instance document, e.g. "ifrs-full:Revenue". Prefixes
 * are taxonomy-year-specific in principle (CMF publishes a new `cl-ci`
 * namespace URI each year) but the `ifrs-full` prefix and concept names
 * themselves are stable IFRS Foundation vocabulary across years, which is
 * what this map keys off.
 */
export const XBRL_CONCEPT_MAP: Record<string, ConceptMapEntry> = {
  // ── Income statement ──────────────────────────────────────────────────────
  'ifrs-full:Revenue': {
    lineItemCode: 'revenue',
    statementType: 'income',
    confidence: 'high',
    notes: 'Standard IFRS revenue concept. Observed in both Ripley and Copec filings.',
  },
  'ifrs-full:CostOfSales': {
    lineItemCode: 'cost_of_sales',
    statementType: 'income',
    confidence: 'high',
    notes: 'Standard IFRS cost of sales concept. Reported as a positive magnitude of cost in IFRS filings.',
  },
  'ifrs-full:GrossProfit': {
    lineItemCode: 'gross_profit',
    statementType: 'income',
    confidence: 'high',
    notes: 'Standard IFRS gross profit concept.',
  },
  'ifrs-full:ProfitLossFromOperatingActivities': {
    lineItemCode: 'operating_income',
    statementType: 'income',
    confidence: 'high',
    notes: 'Standard IFRS operating profit/loss concept. Observed in Copec.',
  },
  'ifrs-full:FinanceIncome': {
    lineItemCode: 'finance_income',
    statementType: 'income',
    confidence: 'medium',
    notes: 'Standard IFRS finance income concept. Not directly confirmed in the two sample filings — standard concept name, medium confidence until observed against a real fact.',
  },
  'ifrs-full:FinanceCosts': {
    lineItemCode: 'finance_cost',
    statementType: 'income',
    confidence: 'medium',
    notes: 'Standard IFRS finance costs concept. Reported as a positive magnitude of cost. Medium confidence until observed.',
  },
  'ifrs-full:ProfitLossBeforeTax': {
    lineItemCode: 'profit_before_tax',
    statementType: 'income',
    confidence: 'high',
    notes: 'Standard IFRS pre-tax profit concept (distinct from ifrs-full:AccountingProfit, which is a tax-reconciliation-note figure — see KNOWN_UNMAPPED_CONCEPTS).',
  },
  'ifrs-full:IncomeTaxExpenseContinuingOperations': {
    lineItemCode: 'tax_expense',
    statementType: 'income',
    confidence: 'medium',
    notes: 'Standard IFRS income tax expense (continuing operations). Sign convention varies by filer — medium confidence.',
  },
  'ifrs-full:ProfitLoss': {
    lineItemCode: 'net_income',
    statementType: 'income',
    confidence: 'high',
    notes: 'Standard IFRS net profit/loss concept. Observed as the consolidated bottom line in both filings inspected. This is total profit incl. minority interest; ProfitLossAttributableToOwnersOfParent is the parent-only figure.',
  },
  'ifrs-full:ProfitLossAttributableToOwnersOfParent': {
    lineItemCode: 'net_income_attributable_to_parent',
    statementType: 'income',
    confidence: 'high',
    notes: 'Standard IFRS net income attributable to owners of the parent (excludes minority interest).',
  },
  'ifrs-full:BasicEarningsLossPerShare': {
    lineItemCode: 'eps',
    statementType: 'income',
    confidence: 'high',
    notes: 'Standard IFRS basic EPS concept. Observed in both filings; unit was a per-share ratio, not a share count.',
  },
  'ifrs-full:DilutedEarningsLossPerShare': {
    lineItemCode: 'eps_diluted',
    statementType: 'income',
    confidence: 'medium',
    notes: 'Standard IFRS diluted EPS concept. Not directly observed in the samples; medium confidence.',
  },
  // ── Balance sheet ─────────────────────────────────────────────────────────
  'ifrs-full:Assets': {
    lineItemCode: 'total_assets',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS total assets concept. NOTE: also appears heavily on segment-dimensional contexts in real filings — only the plain (non-dimensional) context value should be used for the consolidated figure (see parseXbrl.ts plainFacts()).',
  },
  'ifrs-full:CurrentAssets': {
    lineItemCode: 'current_assets',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS total current assets concept.',
  },
  'ifrs-full:Liabilities': {
    lineItemCode: 'total_liabilities',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS total liabilities concept.',
  },
  'ifrs-full:CurrentLiabilities': {
    lineItemCode: 'current_liabilities',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS total current liabilities concept.',
  },
  'ifrs-full:Equity': {
    lineItemCode: 'equity',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS total equity concept (incl. minority interest).',
  },
  'ifrs-full:EquityAttributableToOwnersOfParent': {
    lineItemCode: 'equity_attributable_to_parent',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS equity attributable to owners of the parent.',
  },
  'ifrs-full:NoncontrollingInterests': {
    lineItemCode: 'minority_interest',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS non-controlling (minority) interests concept.',
  },
  'ifrs-full:CashAndCashEquivalents': {
    lineItemCode: 'cash',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS cash and cash equivalents concept. Observed in the Ripley filing.',
  },
  // ── Cash flow ─────────────────────────────────────────────────────────────
  'ifrs-full:CashFlowsFromUsedInOperatingActivities': {
    lineItemCode: 'ocf',
    statementType: 'cash',
    confidence: 'high',
    notes: 'Standard IFRS operating cash flow concept. Observed in Ripley and Copec.',
  },
  'ifrs-full:CashFlowsFromUsedInInvestingActivities': {
    lineItemCode: 'cash_flow_from_investing',
    statementType: 'cash',
    confidence: 'high',
    notes: 'Standard IFRS investing cash flow concept.',
  },
  'ifrs-full:CashFlowsFromUsedInFinancingActivities': {
    lineItemCode: 'cash_flow_from_financing',
    statementType: 'cash',
    confidence: 'high',
    notes: 'Standard IFRS financing cash flow concept.',
  },
  'ifrs-full:IncreaseDecreaseInCashAndCashEquivalents': {
    lineItemCode: 'net_change_in_cash',
    statementType: 'cash',
    confidence: 'medium',
    notes: 'Standard IFRS net change in cash concept (before FX effect variants exist; this is the headline). Medium confidence until observed.',
  },
  'ifrs-full:PaymentsToAcquirePropertyPlantAndEquipment': {
    lineItemCode: 'capex',
    statementType: 'cash',
    confidence: 'medium',
    notes: 'Standard IFRS capex (PP&E purchases) concept. Not directly observed in the two filings inspected this phase — standard IFRS concept for this line item; verify against a real fact before relying on it.',
  },
  'ifrs-full:DividendsPaid': {
    lineItemCode: 'dividends_paid',
    statementType: 'cash',
    confidence: 'medium',
    notes: 'Standard IFRS dividends-paid concept. Not directly observed in the two filings inspected this phase — no dividend fact was seen in either sample, so this stays medium confidence until a real fact is observed.',
  },
}

export function mapConcept(concept: string): ConceptMapEntry | null {
  return XBRL_CONCEPT_MAP[concept] ?? null
}

/** Concept names actually observed in real filings during discovery but deliberately left unmapped (ambiguous or filer-specific). Documented so a future pass knows what was seen and rejected, rather than never having been considered. */
export const KNOWN_UNMAPPED_CONCEPTS: Record<string, string> = {
  'ifrs-full:CashAndCashEquivalentsIfDifferentFromStatementOfFinancialPosition':
    'A cash-flow-statement reconciliation variant distinct from the balance-sheet cash figure — mapping it to the same "cash" line item as ifrs-full:CashAndCashEquivalents would conflate two different concepts.',
  'ifrs-full:RevenueFromSaleOfGoodsRelatedPartyTransactions':
    'A related-party-transactions note disclosure, not the consolidated revenue figure — mapping it to "revenue" would double-count or substitute the wrong number.',
  'ifrs-full:AccountingProfit':
    'A tax-reconciliation-note concept (pre-tax profit used in the effective-tax-rate reconciliation table), not the consolidated net income figure.',
  'ifrs-full:AssetsLessCurrentLiabilities':
    'A working-capital subtotal, not total assets — mapping it to "total_assets" would understate the real figure.',
}
