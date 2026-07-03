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
  | 'gross_profit'
  | 'operating_income'
  | 'net_income'
  | 'eps'
  | 'total_assets'
  | 'total_liabilities'
  | 'equity'
  | 'cash'
  | 'ocf'
  | 'capex'
  | 'dividends_paid'

export interface ConceptMapEntry {
  lineItemCode: LineItemCode
  /** 'income' | 'balance' | 'cash' — matches StatementType in csvFinancials.ts. */
  statementType: 'income' | 'balance' | 'cash'
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
  'ifrs-full:Revenue': {
    lineItemCode: 'revenue',
    statementType: 'income',
    notes: 'Standard IFRS revenue concept. Observed in both Ripley and Copec filings.',
  },
  'ifrs-full:GrossProfit': {
    lineItemCode: 'gross_profit',
    statementType: 'income',
    notes: 'Standard IFRS gross profit concept.',
  },
  'ifrs-full:ProfitLossFromOperatingActivities': {
    lineItemCode: 'operating_income',
    statementType: 'income',
    notes: 'Standard IFRS operating profit/loss concept.',
  },
  'ifrs-full:ProfitLoss': {
    lineItemCode: 'net_income',
    statementType: 'income',
    notes: 'Standard IFRS net profit/loss concept. Observed as the consolidated bottom line in both filings inspected.',
  },
  'ifrs-full:BasicEarningsLossPerShare': {
    lineItemCode: 'eps',
    statementType: 'income',
    notes: 'Standard IFRS basic EPS concept. Observed in both filings; unit was "shares" in both (per-share ratio, not a share count).',
  },
  'ifrs-full:Assets': {
    lineItemCode: 'total_assets',
    statementType: 'balance',
    notes: 'Standard IFRS total assets concept. NOTE: also appears heavily on segment-dimensional contexts in real filings — only the plain (non-dimensional) context value should be used for the consolidated figure (see parseXbrl.ts plainFacts()).',
  },
  'ifrs-full:Liabilities': {
    lineItemCode: 'total_liabilities',
    statementType: 'balance',
    notes: 'Standard IFRS total liabilities concept.',
  },
  'ifrs-full:Equity': {
    lineItemCode: 'equity',
    statementType: 'balance',
    notes: 'Standard IFRS total equity concept.',
  },
  'ifrs-full:CashAndCashEquivalents': {
    lineItemCode: 'cash',
    statementType: 'balance',
    notes: 'Standard IFRS cash and cash equivalents concept. Observed in the Ripley filing.',
  },
  'ifrs-full:CashFlowsFromUsedInOperatingActivities': {
    lineItemCode: 'ocf',
    statementType: 'cash',
    notes: 'Standard IFRS operating cash flow concept. Observed in the Ripley filing.',
  },
  'ifrs-full:PaymentsToAcquirePropertyPlantAndEquipment': {
    lineItemCode: 'capex',
    statementType: 'cash',
    notes: 'Standard IFRS capex (PP&E purchases) concept. Not directly observed in the two filings inspected this phase — included because it is the standard IFRS concept for this line item; verify against a real fact before relying on it.',
  },
  'ifrs-full:DividendsPaid': {
    lineItemCode: 'dividends_paid',
    statementType: 'cash',
    notes: 'Standard IFRS dividends-paid concept. Not directly observed in the two filings inspected this phase (present only "if present" per the phase brief) — no dividend fact was seen in either sample, so this stays unverified until a real fact is observed.',
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
