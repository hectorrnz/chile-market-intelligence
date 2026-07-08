// Phase 8C.1/8C.3 — conservative XBRL concept -> internal line-item mapping.
//
// Only maps IFRS-full concepts that were actually observed in real CMF
// filings inspected during discovery (Ripley Chile 2023, Empresas Copec 2023
// — see docs/cmf_xbrl_provider_discovery.md) or during Phase 8C.3's issuer
// expansion (SQM-B, COPEC, ENELCHILE, CMPC, CENCOSUD FY2025). Deliberately
// does NOT attempt to be an exhaustive IFRS taxonomy dictionary — every entry
// here was seen in a real filing, not guessed from the taxonomy schema alone.
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
  | 'short_term_debt'
  | 'long_term_debt'
  | 'total_debt'
  | 'shares_outstanding'
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
  // Debt concepts (Phase 8C.3) — verified via an exact additive identity in
  // real filings: for both CMPC and CENCOSUD's FY2025 current-period instant,
  // LongtermBorrowings + CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings
  // == Borrowings, to the dollar/peso. This is what makes all three safe to map
  // — they are consistently additive, not filer-specific coincidences.
  'ifrs-full:Borrowings': {
    lineItemCode: 'total_debt',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS total borrowings concept. Observed in real CMPC/CENCOSUD FY2025 filings; verified equal to LongtermBorrowings + CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings exactly. Distinct from ifrs-full:NetDebt (debt minus cash — verified NOT equal to Borrowings in a real filing) — never conflate the two.',
  },
  'ifrs-full:LongtermBorrowings': {
    lineItemCode: 'long_term_debt',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS non-current borrowings concept. Observed in real CMPC/CENCOSUD FY2025 filings; see ifrs-full:Borrowings note for the verified additive identity.',
  },
  'ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings': {
    lineItemCode: 'short_term_debt',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS current borrowings concept (includes the current portion of non-current borrowings). Observed in real CMPC/CENCOSUD FY2025 filings; see ifrs-full:Borrowings note for the verified additive identity. Deliberately preferred over the narrower ifrs-full:CurrentPortionOfLongtermBorrowings and the filer-inconsistent ifrs-full:ShorttermBorrowings — see KNOWN_UNMAPPED_CONCEPTS for why those are excluded.',
  },
  'ifrs-full:NumberOfSharesOutstanding': {
    lineItemCode: 'shares_outstanding',
    statementType: 'balance',
    confidence: 'high',
    notes: 'Standard IFRS shares-outstanding count concept (unit: shares, not a monetary value). Observed in real ENELCHILE/CMPC/CENCOSUD FY2025 filings on the current-period instant context.',
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
    notes: 'Standard IFRS capex (PP&E purchases) concept. Not directly observed in any of the 5 real filings inspected across 8C.1-8C.3 — every real Chilean filer seen so far (ENELCHILE/CMPC/CENCOSUD FY2025) instead tags capex as ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities (below). Kept as a fallback for a future filer that might use this alternate standard name; verify against a real fact before relying on it.',
  },
  'ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities': {
    lineItemCode: 'capex',
    statementType: 'cash',
    confidence: 'high',
    notes: 'The capex concept actually used by real Chilean filers observed in Phase 8C.3 (ENELCHILE/CMPC/CENCOSUD FY2025, all present on the correct current-year investing-activities duration context).',
  },
  'ifrs-full:DividendsPaid': {
    lineItemCode: 'dividends_paid',
    statementType: 'cash',
    confidence: 'medium',
    notes: 'Standard IFRS dividends-paid concept. Not directly observed in any of the 5 real filings inspected across 8C.1-8C.3 — every real Chilean filer seen so far (ENELCHILE/CMPC/CENCOSUD FY2025) instead tags dividends as ifrs-full:DividendsPaidClassifiedAsFinancingActivities (below). Kept as a fallback for a future filer that might use this alternate standard name.',
  },
  'ifrs-full:DividendsPaidClassifiedAsFinancingActivities': {
    lineItemCode: 'dividends_paid',
    statementType: 'cash',
    confidence: 'high',
    notes: 'The dividends-paid concept actually used by real Chilean filers observed in Phase 8C.3 (ENELCHILE/CMPC/CENCOSUD FY2025, all present on the correct current-year financing-activities duration context).',
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
  'ifrs-full:NetDebt':
    'Debt net of cash, a distinct metric from gross total_debt — verified in a real CMPC FY2025 filing to NOT equal ifrs-full:Borrowings (NetDebt was ~4.5x the gross borrowings figure, reflecting a different scope/definition). Mapping it to "total_debt" would silently misrepresent net debt as gross debt.',
  'ifrs-full:ShorttermBorrowings':
    'A short-term-debt candidate, but observed to be filer-inconsistent: in a real CMPC filing it was present for the prior year but ABSENT from the current-year context entirely, and where present did not always equal ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings (which is mapped instead — the fuller, IFRS-standard-named concept that was verified additive with LongtermBorrowings in every case observed).',
  'ifrs-full:CurrentPortionOfLongtermBorrowings':
    'A narrower sub-component of current debt — verified in a real CMPC filing to sometimes equal, and sometimes NOT equal (prior-year: 90,357,000 vs. 392,601,000), ifrs-full:CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings (which is mapped instead, since it is the more complete concept and the one verified additive with LongtermBorrowings). Mapping this narrower concept to "short_term_debt" risks understating it.',
}
