// Phase 6D — Transaction & cash-ledger math. Pure functions, no side effects,
// no imports from Next.js or Supabase — safe to unit-test directly.
//
// Weighted-average-cost method (the only method this phase supports — no
// FIFO/LIFO tax-lot selection yet): a buy blends into the existing average
// cost weighted by quantity; a sell reduces quantity only, leaving the
// average cost on the remaining shares unchanged, and realizes P&L against
// that average cost. CLP-first — no FX conversion; a transaction whose
// currency differs from the portfolio's is flagged, not converted, by the
// repository layer.

export type TransactionType = 'buy' | 'sell'

export interface TransactionInput {
  transactionType: TransactionType
  quantity: number
  price: number
  fees?: number
  taxes?: number
}

export interface TransactionAmounts {
  grossAmount: number
  /** Always positive — the magnitude of cash moved. Direction depends on transactionType. */
  netAmount: number
}

function safeNumber(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null
  return Number.isFinite(n) ? n : null
}

/** grossAmount = quantity × price. netAmount includes fees/taxes: added for a buy, subtracted for a sell. */
export function calculateTransactionAmounts(input: TransactionInput): TransactionAmounts {
  const fees = input.fees ?? 0
  const taxes = input.taxes ?? 0
  const grossAmount = input.quantity * input.price
  const netAmount =
    input.transactionType === 'buy'
      ? grossAmount + fees + taxes
      : grossAmount - fees - taxes
  return { grossAmount, netAmount: Math.max(0, netAmount) }
}

export interface PositionState {
  quantity: number
  averageCost: number | null
}

export interface BuyInput {
  quantity: number
  price: number
  fees?: number
  taxes?: number
}

/** Weighted-average cost after blending a buy into the existing position (fees/taxes are added to cost basis). */
export function calculateAverageCostAfterBuy(
  existing: PositionState | null,
  buy: BuyInput,
): PositionState {
  const existingQty = existing?.quantity ?? 0
  const existingCost = existing?.averageCost ?? 0
  const existingCostBasis = existingQty * existingCost

  const fees = buy.fees ?? 0
  const taxes = buy.taxes ?? 0
  const buyCostBasis = buy.quantity * buy.price + fees + taxes

  const newQuantity = existingQty + buy.quantity
  const newAverageCost = newQuantity > 0 ? (existingCostBasis + buyCostBasis) / newQuantity : null

  return { quantity: newQuantity, averageCost: newAverageCost }
}

export interface SellInput {
  quantity: number
  price: number
  fees?: number
  taxes?: number
}

/**
 * Quantity after a sell. Average cost is unaffected by a sell (weighted-average
 * method). Returns null when the sell quantity exceeds the held quantity —
 * callers must reject the sell rather than apply a negative position.
 */
export function calculatePositionAfterSell(
  existing: PositionState,
  sell: SellInput,
): PositionState | null {
  if (sell.quantity > existing.quantity) return null
  return { quantity: existing.quantity - sell.quantity, averageCost: existing.averageCost }
}

/**
 * Realized P&L for a sell = net proceeds (after fees/taxes) minus the cost of
 * the shares sold (at the existing average cost). Returns null when there is
 * no average cost to realize against (e.g. a sell against an unpriced lot).
 */
export function calculateRealizedPnl(existing: PositionState, sell: SellInput): number | null {
  const avgCost = safeNumber(existing.averageCost)
  if (avgCost === null) return null
  const fees = sell.fees ?? 0
  const taxes = sell.taxes ?? 0
  const proceeds = sell.quantity * sell.price - fees - taxes
  const costOfSold = sell.quantity * avgCost
  const pnl = proceeds - costOfSold
  return Number.isFinite(pnl) ? pnl : null
}

export interface TransactionRecord {
  /** Optional — when supplied, echoed back on the matching step so callers can
   *  write the recalculated realizedPnl back to that specific DB row. */
  id?: string
  transactionType: TransactionType
  tradeDate: string
  quantity: number
  price: number
  fees?: number
  taxes?: number
}

export interface RebuildStep {
  id?: string
  realizedPnl: number | null
  stateAfter: PositionState
}

export interface RebuildResult {
  ok: true
  quantity: number
  averageCost: number | null
  realizedPnlTotal: number
  /** Per-transaction result, in replay (chronological) order. */
  steps: RebuildStep[]
}

export interface RebuildError {
  ok: false
  error: 'insufficient_quantity_in_history'
}

/**
 * Replays a ticker's transactions (oldest first) to derive the current
 * quantity, weighted-average cost, and cumulative realized P&L. Transactions
 * are sorted by tradeDate defensively — callers may pass them in any order.
 * Returns a `steps` array (one entry per input transaction, in replay order)
 * so callers can persist the recalculated realizedPnl back to each row —
 * useful after editing or deleting a transaction earlier in the history.
 */
export function rebuildPositionFromTransactions(
  transactions: TransactionRecord[],
): RebuildResult | RebuildError {
  const sorted = [...transactions].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))

  let state: PositionState = { quantity: 0, averageCost: null }
  let realizedPnlTotal = 0
  const steps: RebuildStep[] = []

  for (const tx of sorted) {
    if (tx.transactionType === 'buy') {
      state = calculateAverageCostAfterBuy(state, tx)
      steps.push({ id: tx.id, realizedPnl: null, stateAfter: state })
    } else {
      const pnl = calculateRealizedPnl(state, tx)
      const after = calculatePositionAfterSell(state, tx)
      if (after === null) return { ok: false, error: 'insufficient_quantity_in_history' }
      realizedPnlTotal += pnl ?? 0
      state = after
      steps.push({ id: tx.id, realizedPnl: pnl, stateAfter: state })
    }
  }

  return { ok: true, quantity: state.quantity, averageCost: state.averageCost, realizedPnlTotal, steps }
}

export type CashEntryType =
  | 'deposit' | 'withdrawal' | 'buy_cash_outflow' | 'sell_cash_inflow' | 'fee' | 'tax' | 'adjustment'

export interface CashLedgerEntryDraft {
  entryType: CashEntryType
  /** Signed: positive = cash in, negative = cash out. */
  amount: number
  currency: string
  ledgerDate: string
  description?: string
}

/**
 * Builds the cash-ledger entry for a buy/sell transaction. A buy is a single
 * cash outflow (gross + fees + taxes, negative); a sell is a single cash
 * inflow (gross − fees − taxes, positive). Fees/taxes stay visible on the
 * transaction record itself rather than being split into separate ledger
 * rows — kept simple for this phase.
 */
export function buildCashLedgerEntriesForTransaction(tx: {
  transactionType: TransactionType
  tradeDate: string
  currency: string
}, amounts: TransactionAmounts): CashLedgerEntryDraft[] {
  if (tx.transactionType === 'buy') {
    return [{
      entryType: 'buy_cash_outflow',
      amount: -amounts.netAmount,
      currency: tx.currency,
      ledgerDate: tx.tradeDate,
    }]
  }
  return [{
    entryType: 'sell_cash_inflow',
    amount: amounts.netAmount,
    currency: tx.currency,
    ledgerDate: tx.tradeDate,
  }]
}

/** Sum of signed cash-ledger amounts. Guarded against non-finite input rows. */
export function calculateCashBalance(entries: { amount: number }[]): number {
  return entries.reduce((sum, e) => {
    const amt = safeNumber(e.amount)
    return sum + (amt ?? 0)
  }, 0)
}

export interface CashSummary {
  totalDeposits: number
  totalWithdrawals: number
  totalBuyOutflows: number
  totalSellInflows: number
  totalFees: number
  totalTaxes: number
  totalAdjustments: number
  netCashBalance: number
}

/** Breaks cash-ledger entries down by type and returns the net balance. */
export function calculatePortfolioCashSummary(
  entries: { entryType: CashEntryType; amount: number }[],
): CashSummary {
  const sumBy = (type: CashEntryType) =>
    entries.filter((e) => e.entryType === type).reduce((s, e) => s + (safeNumber(e.amount) ?? 0), 0)

  return {
    totalDeposits: sumBy('deposit'),
    totalWithdrawals: sumBy('withdrawal'),
    totalBuyOutflows: sumBy('buy_cash_outflow'),
    totalSellInflows: sumBy('sell_cash_inflow'),
    totalFees: sumBy('fee'),
    totalTaxes: sumBy('tax'),
    totalAdjustments: sumBy('adjustment'),
    netCashBalance: calculateCashBalance(entries),
  }
}
