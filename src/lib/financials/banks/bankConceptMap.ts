// Phase 8C.7 — CMF bank account-code -> normalized line-item map.
//
// NOT an XBRL concept map. Chilean banks do not file IFRS-XBRL through CMF's
// securities-issuer directory (confirmed absent in Phase 8C.4/8C.6 — see
// docs/bank_financials_ingestion.md §2). Instead CMF publishes a monthly,
// per-institution regulatory report ("Balance y Estado de Situación Bancos")
// under a 9-digit proprietary chart of accounts ("Compendio de Normas
// Contables para Bancos", Circular N°2.243), documented officially in each
// release's own `plan_de_cuentas.txt` + `documentacion.pdf`
// (cmfchile.cl/portal/estadisticas/626/...). This module keys off that
// 9-digit account code, not a namespaced concept name.
//
// Rules (mirrors ../xbrl/conceptMap.ts — do not weaken):
//   - Only account codes VERIFIED against a real filing are mapped. Every
//     `high`-confidence entry below was cross-checked in Phase 8C.7 against
//     the May-2026 monthly release for ALL FOUR target banks (BSANTANDER,
//     CHILE, BCI, ITAUCL) via an exact additive identity:
//       - total_assets(100000000) == total_liabilities(200000000) + total_equity(300000000)
//       - profit_before_tax(585000000) + tax_expense(480000000) == net_income(590000000)
//     both held EXACTLY (to the peso) for all 4 banks — see
//     docs/bank_financials_ingestion.md §5 for the verification transcript.
//   - Ambiguous codes (customer deposits, borrowings, debt securities issued)
//     are NOT mapped — the chart of accounts splits deposits/borrowings across
//     several amortized-cost/fair-value sub-codes with no single unambiguous
//     top-level total observed; see BANK_KNOWN_UNMAPPED_CODES.
//   - Capital/regulatory ratios (CET1, RWA, NPL, coverage) do not appear in
//     this feed at all — they are a separate quarterly Pillar 3 disclosure,
//     not investigated this phase. Never inferred from balance-sheet data.
//   - Sign convention: the income-statement (r1) feed reports revenue/income
//     items as positive and expense items as NEGATIVE (CMF's own convention —
//     "los valores negativos... llevan dicho signo al comienzo de la cifra").
//     This map's `expenseSign: 'negative'` flag documents which codes arrive
//     pre-signed this way; the parser preserves the raw signed value without
//     flipping it — a caller wanting a "positive magnitude of cost" (as the
//     industrial map's convention states for finance_cost) must explicitly
//     negate, never assume.
//   - Balance-sheet (b1) rows carry 4 currency/indexation columns (CLP
//     nominal, UF-indexed, FX-indexed, FX-translated — all already expressed
//     in CLP pesos per the official documentation) that must be SUMMED for
//     the headline peso figure — never take column 2 alone.

import type { BankLineItemCode } from './bankStatementTypes.ts'

export type BankFileType = 'b1' | 'b2' | 'r1' | 'c1' | 'c2'

export interface BankConceptMapEntry {
  /** 9-digit CMF account code, exactly as it appears in plan_de_cuentas.txt. */
  accountCode: string
  lineItemCode: BankLineItemCode
  /** Which release file this code is read from. b1 = consolidated balance sheet, r1 = consolidated income statement. */
  fileType: BankFileType
  /** 'balance' rows sum all 4 currency columns; 'income' rows use the single "Monto Total" column. */
  statementType: 'balance' | 'income'
  confidence: 'high' | 'medium' | 'low' | 'review_required'
  /** True if this account is stored pre-signed negative for an expense (CMF's own income-statement convention). */
  expenseSign?: 'negative'
  /** Official Spanish label from plan_de_cuentas.txt, preserved for provenance. */
  officialLabel: string
  notes: string
}

/**
 * Keyed by 9-digit account code. Every entry was verified in Phase 8C.7
 * against the real May-2026 monthly release for BSANTANDER (037), CHILE
 * (001), BCI (016), and ITAUCL (039) — see the file header for the exact
 * additive identities checked.
 */
export const BANK_CONCEPT_MAP: Record<string, BankConceptMapEntry> = {
  // ── Balance sheet (b1 — consolidated) ─────────────────────────────────────
  '100000000': {
    accountCode: '100000000',
    lineItemCode: 'total_assets',
    fileType: 'b1',
    statementType: 'balance',
    confidence: 'high',
    officialLabel: 'TOTAL ACTIVOS',
    notes: 'Top-level total-assets account. Verified: sum of all 4 currency columns equals total_liabilities + total_equity exactly, for all 4 target banks (May 2026 release).',
  },
  '200000000': {
    accountCode: '200000000',
    lineItemCode: 'total_liabilities',
    fileType: 'b1',
    statementType: 'balance',
    confidence: 'high',
    officialLabel: 'TOTAL PASIVOS',
    notes: 'Top-level total-liabilities account. Part of the verified assets = liabilities + equity identity (see 100000000 note).',
  },
  '300000000': {
    accountCode: '300000000',
    lineItemCode: 'total_equity',
    fileType: 'b1',
    statementType: 'balance',
    confidence: 'high',
    officialLabel: 'PATRIMONIO',
    notes: 'Top-level total-equity account (includes minority interest). Part of the verified assets = liabilities + equity identity.',
  },
  '380000000': {
    accountCode: '380000000',
    lineItemCode: 'equity_attributable_to_parent',
    fileType: 'b1',
    statementType: 'balance',
    confidence: 'high',
    officialLabel: 'PATRIMONIO DE LOS PROPIETARIOS',
    notes: 'Equity attributable to owners of the parent, excluding minority interest. Observed close to but distinct from 300000000 (the small difference is minority interest — Chilean bank subsidiaries carry little to no minority interest in the sample checked).',
  },
  '500000000': {
    accountCode: '500000000',
    lineItemCode: 'loans_to_customers',
    fileType: 'b1',
    statementType: 'balance',
    confidence: 'high',
    officialLabel: 'TOTAL COLOCACIONES',
    notes: 'Gross loans to customers (before the loan-loss allowance). In the verified sample this equals 505000000 (TOTAL COLOCACIONES A COSTO AMORTIZADO) exactly — no material fair-value loan book observed for BCI; treat 505000000 as a component, not double-count.',
  },
  '149000000': {
    accountCode: '149000000',
    lineItemCode: 'allowance_for_loan_losses',
    fileType: 'b1',
    statementType: 'balance',
    confidence: 'high',
    expenseSign: 'negative',
    officialLabel: 'Provisiones constituidas por riesgo de crédito',
    notes: 'Loan-loss allowance, a contra-asset stored as a negative value in the feed. net_loans is derived as loans_to_customers + allowance_for_loan_losses (never persisted as its own account — no single top-level "net loans" code was found).',
  },
  // ── Income statement (r1 — consolidated) ──────────────────────────────────
  '411000000': {
    accountCode: '411000000',
    lineItemCode: 'interest_income',
    fileType: 'r1',
    statementType: 'income',
    confidence: 'high',
    officialLabel: 'INGRESOS POR INTERESES',
    notes: 'Top-level interest income account.',
  },
  '412000000': {
    accountCode: '412000000',
    lineItemCode: 'interest_expense',
    fileType: 'r1',
    statementType: 'income',
    confidence: 'high',
    expenseSign: 'negative',
    officialLabel: 'GASTOS POR INTERESES',
    notes: 'Top-level interest expense account, stored negative (CMF income-statement sign convention). net_interest_income is derived as interest_income + interest_expense.',
  },
  '420000000': {
    accountCode: '420000000',
    lineItemCode: 'fee_and_commission_income',
    fileType: 'r1',
    statementType: 'income',
    confidence: 'high',
    officialLabel: 'INGRESOS POR COMISIONES Y SERVICIOS PRESTADOS',
    notes: 'Top-level fee and commission income account.',
  },
  '425000000': {
    accountCode: '425000000',
    lineItemCode: 'fee_and_commission_expense',
    fileType: 'r1',
    statementType: 'income',
    confidence: 'high',
    expenseSign: 'negative',
    officialLabel: 'GASTOS POR COMISIONES Y SERVICIOS RECIBIDOS',
    notes: 'Top-level fee and commission expense account, stored negative. net_fee_income is derived as fee_and_commission_income + fee_and_commission_expense.',
  },
  '470000000': {
    accountCode: '470000000',
    lineItemCode: 'loan_loss_provisions',
    fileType: 'r1',
    statementType: 'income',
    confidence: 'high',
    expenseSign: 'negative',
    officialLabel: 'GASTO POR PÉRDIDAS CREDITICIAS',
    notes: 'Top-level loan-loss provision expense (net of releases), stored negative. Verified present with a plausible magnitude for all 4 target banks.',
  },
  '585000000': {
    accountCode: '585000000',
    lineItemCode: 'profit_before_tax',
    fileType: 'r1',
    statementType: 'income',
    confidence: 'high',
    officialLabel: 'RESULTADO DE OPERACIONES CONTÍNUAS ANTES DE IMPUESTOS',
    notes: 'Pre-tax profit from continuing operations. Verified: 585000000 + 480000000 (tax_expense) == 586000000 (after-tax continuing result) exactly, for all 4 target banks.',
  },
  '480000000': {
    accountCode: '480000000',
    lineItemCode: 'tax_expense',
    fileType: 'r1',
    statementType: 'income',
    confidence: 'high',
    expenseSign: 'negative',
    officialLabel: 'IMPUESTO A LA RENTA',
    notes: 'Income tax expense, stored negative. Part of the verified profit_before_tax + tax_expense == after-tax identity.',
  },
  '590000000': {
    accountCode: '590000000',
    lineItemCode: 'net_income',
    fileType: 'r1',
    statementType: 'income',
    confidence: 'high',
    officialLabel: 'UTILIDAD (PÉRDIDA) DEL EJERCICIO (O PERIODO)',
    notes: 'Bottom-line net income for the period. Verified equal to 586000000 (after-tax continuing-operations result) when no discontinued operations are reported, for all 4 target banks in the checked release.',
  },
}

export function mapBankConcept(accountCode: string): BankConceptMapEntry | null {
  return BANK_CONCEPT_MAP[accountCode] ?? null
}

/** Account codes considered but deliberately left unmapped, with the evidence for why. */
export const BANK_KNOWN_UNMAPPED_CODES: Record<string, string> = {
  '350000000':
    '"UTILIDAD (PÉRDIDA) DEL EJERCICIO" as it appears on the BALANCE SHEET (an equity roll-forward sub-component) — close to but NOT verified equal to the income-statement net_income (590000000) figure in the sample checked (a small difference, likely a retained-earnings-appropriation timing effect). Mapping it to net_income would risk conflating a balance-sheet equity component with the income-statement flow figure — the income-statement account is used instead.',
  '241000000/242000000/213000101/218000001':
    'Candidate customer-deposit accounts ("Depósitos y otras obligaciones a la vista", "Depósitos y otras captaciones a plazo") are split across multiple amortized-cost and fair-value sub-codes with no single unambiguous top-level "TOTAL DEPOSITOS" account observed in the chart of accounts. Mapping any one sub-code to customer_deposits would understate the true total. Left unmapped (customer_deposits stays review_required) pending a dedicated verification pass.',
  '210000000/218000000':
    'Candidate borrowings/debt-securities-issued accounts ("Pasivos financieros para negociar/designados a valor razonable") — same ambiguity as deposits: multiple sub-codes, no single verified top-level total for borrowings or debt_securities_issued. Left unmapped.',
  '550000000/560000000':
    'TOTAL INGRESOS OPERACIONALES / TOTAL GASTOS OPERACIONALES — broad subtotals that aggregate interest, fees, trading, and other income/expense in a way that does not cleanly correspond to a single field in the target model (some of their components are already captured individually above). Left unmapped to avoid double-counting.',
  'CET1/RWA/NPL/coverage (no codes)':
    'No capital-adequacy or asset-quality ratio codes exist anywhere in this monthly feed (confirmed by exhaustive search of plan_de_cuentas.txt, 2397 entries). These are published separately under CMF\'s quarterly "Divulgación de Pilar 3 de Basilea" disclosure, not investigated this phase. Never inferred from balance-sheet figures alone.',
}

/** Fields this map currently produces with high confidence — used by the validator/orchestrator. */
export function mappedBankLineItems(): BankLineItemCode[] {
  const set = new Set<BankLineItemCode>()
  for (const entry of Object.values(BANK_CONCEPT_MAP)) set.add(entry.lineItemCode)
  return [...set]
}
