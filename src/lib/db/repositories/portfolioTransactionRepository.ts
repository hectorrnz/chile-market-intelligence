// Phase 6D — Portfolio transactions + cash ledger repository.
// Follows the exact pattern established in portfolioRepository.ts (Phase 6C):
// all operations are user-scoped via the session-bound client + RLS; we never
// accept or set a client-supplied user_id. Route handlers must pass a
// user-session client (getSupabaseUserClient()).
//
// Ownership of portfolio_id is additionally enforced at the DB layer by the
// check_portfolio_ownership() trigger (see the 6D migration) — a caller
// cannot point a transaction/ledger row at a portfolio owned by someone else.

import type { SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  Database,
  PortfolioTransactionRow as DbTransactionRow,
  PortfolioCashLedgerRow as DbCashRow,
} from '../../supabase/database.types.ts'
import {
  calculateTransactionAmounts,
  rebuildPositionFromTransactions,
  buildCashLedgerEntriesForTransaction,
  calculateCashBalance,
  calculatePortfolioCashSummary,
  type TransactionType,
  type TransactionRecord,
  type CashEntryType,
  type RebuildResult,
  type RebuildError,
} from '../../portfolio/transactions.ts'
import { getPositionSource } from './portfolioRepository.ts'

type Client = SupabaseClient<Database>

function loadCoveredTickers(): Set<string> {
  const jsonPath = fileURLToPath(new URL('../../../data/companies.json', import.meta.url))
  const companies = JSON.parse(readFileSync(jsonPath, 'utf8')) as { ticker: string }[]
  return new Set(companies.map((c) => c.ticker.toUpperCase()))
}
const VALID_TICKERS = loadCoveredTickers()

// ─── Repository-layer row types ────────────────────────────────────────────────

export interface PortfolioTransactionRecord {
  id: string
  portfolioId: string
  ticker: string
  transactionType: TransactionType
  tradeDate: string
  settlementDate: string | null
  quantity: number
  price: number
  grossAmount: number | null
  fees: number
  taxes: number
  netAmount: number | null
  currency: string
  realizedPnl: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

function mapTransaction(r: DbTransactionRow): PortfolioTransactionRecord {
  return {
    id: r.id,
    portfolioId: r.portfolio_id,
    ticker: r.ticker,
    transactionType: r.transaction_type as TransactionType,
    tradeDate: r.trade_date,
    settlementDate: r.settlement_date ?? null,
    quantity: Number(r.quantity),
    price: Number(r.price),
    grossAmount: r.gross_amount === null ? null : Number(r.gross_amount),
    fees: Number(r.fees),
    taxes: Number(r.taxes),
    netAmount: r.net_amount === null ? null : Number(r.net_amount),
    currency: r.currency,
    realizedPnl: r.realized_pnl === null ? null : Number(r.realized_pnl),
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const TX_SELECT =
  'id, portfolio_id, ticker, transaction_type, trade_date, settlement_date, quantity, price, gross_amount, fees, taxes, net_amount, currency, realized_pnl, notes, created_at, updated_at'

export interface CashLedgerRecord {
  id: string
  portfolioId: string
  transactionId: string | null
  ledgerDate: string
  currency: string
  entryType: CashEntryType
  amount: number
  description: string | null
  createdAt: string
}

function mapCashEntry(r: DbCashRow): CashLedgerRecord {
  return {
    id: r.id,
    portfolioId: r.portfolio_id,
    transactionId: r.transaction_id ?? null,
    ledgerDate: r.ledger_date,
    currency: r.currency,
    entryType: r.entry_type as CashEntryType,
    amount: Number(r.amount),
    description: r.description ?? null,
    createdAt: r.created_at,
  }
}

const CASH_SELECT =
  'id, portfolio_id, transaction_id, ledger_date, currency, entry_type, amount, description, created_at'

export type TransactionMutationError =
  | 'invalid_ticker'
  | 'invalid_transaction_type'
  | 'invalid_quantity'
  | 'invalid_price'
  | 'invalid_fees'
  | 'invalid_taxes'
  | 'invalid_trade_date'
  | 'manual_position_conflict'
  | 'insufficient_quantity'
  | 'not_found'
  | 'insert_failed'
  | 'update_failed'
  | 'delete_failed'

// ─── Input validation (pure — no DB access) ───────────────────────────────────

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

export interface AddTransactionInput {
  ticker: string
  transactionType: TransactionType
  tradeDate: string
  quantity: number
  price: number
  fees?: number
  taxes?: number
  currency?: string
  notes?: string | null
}

function validateTransactionFields(input: {
  transactionType?: string
  tradeDate?: string
  quantity?: number
  price?: number
  fees?: number
  taxes?: number
}): TransactionMutationError | null {
  if (input.transactionType !== undefined && input.transactionType !== 'buy' && input.transactionType !== 'sell') {
    return 'invalid_transaction_type'
  }
  if (input.quantity !== undefined && (!Number.isFinite(input.quantity) || input.quantity <= 0)) {
    return 'invalid_quantity'
  }
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) {
    return 'invalid_price'
  }
  if (input.fees !== undefined && (!Number.isFinite(input.fees) || input.fees < 0)) {
    return 'invalid_fees'
  }
  if (input.taxes !== undefined && (!Number.isFinite(input.taxes) || input.taxes < 0)) {
    return 'invalid_taxes'
  }
  if (input.tradeDate !== undefined && !isValidDateString(input.tradeDate)) {
    return 'invalid_trade_date'
  }
  return null
}

// ─── Internal fetch/reconcile helpers ─────────────────────────────────────────

async function fetchExistingPositionRow(
  client: Client, portfolioId: string, ticker: string,
): Promise<{ id: string; metadata: unknown } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_positions')
    .select('id, metadata')
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .maybeSingle()
  if (res.error || !res.data) return null
  return res.data
}

async function fetchTickerTransactions(
  client: Client, portfolioId: string, ticker: string,
): Promise<PortfolioTransactionRecord[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_transactions')
    .select(TX_SELECT)
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
    .order('trade_date', { ascending: true })
  const data = res.data as DbTransactionRow[] | null
  if (res.error || !data) return []
  return data.map(mapTransaction)
}

function toRecords(transactions: PortfolioTransactionRecord[]): TransactionRecord[] {
  return transactions.map((t) => ({
    id: t.id,
    transactionType: t.transactionType,
    tradeDate: t.tradeDate,
    quantity: t.quantity,
    price: t.price,
    fees: t.fees,
    taxes: t.taxes,
  }))
}

async function upsertPositionFromRebuild(
  client: Client, portfolioId: string, ticker: string, currency: string,
  rebuild: { quantity: number; averageCost: number | null },
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client as any)
    .from('portfolio_positions')
    .upsert(
      {
        portfolio_id: portfolioId,
        ticker,
        quantity: rebuild.quantity,
        average_cost: rebuild.averageCost,
        cost_currency: currency,
        metadata: { positionSource: 'transactions', lastReconciledAt: new Date().toISOString() },
      },
      { onConflict: 'portfolio_id,ticker' },
    )
}

/** Re-derives quantity/average cost/realized P&L for a ticker from its full transaction history, and writes the result back to portfolio_transactions.realized_pnl + portfolio_positions. */
async function reconcileTickerFromTransactions(
  client: Client, portfolioId: string, ticker: string, currency: string,
): Promise<RebuildResult | RebuildError> {
  const transactions = await fetchTickerTransactions(client, portfolioId, ticker)
  const rebuild = rebuildPositionFromTransactions(toRecords(transactions))
  if (!rebuild.ok) return rebuild

  for (const step of rebuild.steps) {
    if (!step.id) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any)
      .from('portfolio_transactions')
      .update({ realized_pnl: step.realizedPnl })
      .eq('id', step.id)
  }

  await upsertPositionFromRebuild(client, portfolioId, ticker, currency, rebuild)
  return rebuild
}

// ─── Transactions: list / add / update / delete ───────────────────────────────

export async function getPortfolioTransactions(
  client: Client,
  portfolioId: string,
  options?: { ticker?: string; limit?: number },
): Promise<PortfolioTransactionRecord[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (client as any)
    .from('portfolio_transactions')
    .select(TX_SELECT)
    .eq('portfolio_id', portfolioId)
    .order('trade_date', { ascending: false })

  if (options?.ticker) query = query.eq('ticker', options.ticker.toUpperCase())
  if (options?.limit) query = query.limit(options.limit)

  const res = await query
  const data = res.data as DbTransactionRow[] | null
  if (res.error || !data) return []
  return data.map(mapTransaction)
}

export async function addPortfolioTransaction(
  client: Client,
  portfolioId: string,
  input: AddTransactionInput,
): Promise<{ ok: boolean; error?: TransactionMutationError; transaction?: PortfolioTransactionRecord }> {
  const ticker = input.ticker.trim().toUpperCase()
  if (!ticker || !VALID_TICKERS.has(ticker)) return { ok: false, error: 'invalid_ticker' }

  const fieldError = validateTransactionFields(input)
  if (fieldError) return { ok: false, error: fieldError }

  const currency = input.currency?.trim() || 'CLP'

  // Block the first transaction for a ticker that already has a manual position.
  const existingPositionRow = await fetchExistingPositionRow(client, portfolioId, ticker)
  const existingTransactions = await fetchTickerTransactions(client, portfolioId, ticker)
  if (
    existingPositionRow &&
    existingTransactions.length === 0 &&
    getPositionSource(existingPositionRow.metadata) === 'manual'
  ) {
    return { ok: false, error: 'manual_position_conflict' }
  }

  // Pre-validate feasibility (e.g. selling more than held) before writing anything.
  const candidate: TransactionRecord = {
    transactionType: input.transactionType,
    tradeDate: input.tradeDate,
    quantity: input.quantity,
    price: input.price,
    fees: input.fees ?? 0,
    taxes: input.taxes ?? 0,
  }
  const preCheck = rebuildPositionFromTransactions([...toRecords(existingTransactions), candidate])
  if (!preCheck.ok) return { ok: false, error: 'insufficient_quantity' }

  const amounts = calculateTransactionAmounts(candidate)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertRes = await (client as any)
    .from('portfolio_transactions')
    .insert({
      portfolio_id: portfolioId,
      ticker,
      transaction_type: input.transactionType,
      trade_date: input.tradeDate,
      quantity: input.quantity,
      price: input.price,
      gross_amount: amounts.grossAmount,
      fees: input.fees ?? 0,
      taxes: input.taxes ?? 0,
      net_amount: amounts.netAmount,
      currency,
      notes: input.notes?.trim() || null,
    })
    .select(TX_SELECT)
    .single()

  if (insertRes.error) return { ok: false, error: 'insert_failed' }
  const txRow = insertRes.data as DbTransactionRow

  const cashDrafts = buildCashLedgerEntriesForTransaction(
    { transactionType: input.transactionType, tradeDate: input.tradeDate, currency },
    amounts,
  )
  for (const draft of cashDrafts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).from('portfolio_cash_ledger').insert({
      portfolio_id: portfolioId,
      transaction_id: txRow.id,
      ledger_date: draft.ledgerDate,
      currency: draft.currency,
      entry_type: draft.entryType,
      amount: draft.amount,
    })
  }

  const rebuild = await reconcileTickerFromTransactions(client, portfolioId, ticker, currency)
  const mapped = mapTransaction(txRow)
  if (rebuild.ok) {
    // The insert above always writes realized_pnl as null; reconcile just
    // recalculated and persisted the real value — reflect it in the response
    // too, so callers never see a stale/incorrect realizedPnl for a sell.
    const step = rebuild.steps.find((s) => s.id === txRow.id)
    if (step) mapped.realizedPnl = step.realizedPnl
  }

  return { ok: true, transaction: mapped }
}

export interface UpdateTransactionInput {
  tradeDate?: string
  quantity?: number
  price?: number
  fees?: number
  taxes?: number
  notes?: string | null
}

export async function updatePortfolioTransaction(
  client: Client,
  transactionId: string,
  input: UpdateTransactionInput,
): Promise<{ ok: boolean; error?: TransactionMutationError; transaction?: PortfolioTransactionRecord }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingRes = await (client as any)
    .from('portfolio_transactions')
    .select(TX_SELECT)
    .eq('id', transactionId)
    .maybeSingle()
  if (existingRes.error || !existingRes.data) return { ok: false, error: 'not_found' }
  const existing = mapTransaction(existingRes.data as DbTransactionRow)

  const fieldError = validateTransactionFields(input)
  if (fieldError) return { ok: false, error: fieldError }

  const merged: TransactionRecord = {
    id: transactionId,
    transactionType: existing.transactionType,
    tradeDate: input.tradeDate ?? existing.tradeDate,
    quantity: input.quantity ?? existing.quantity,
    price: input.price ?? existing.price,
    fees: input.fees ?? existing.fees,
    taxes: input.taxes ?? existing.taxes,
  }

  const others = (await fetchTickerTransactions(client, existing.portfolioId, existing.ticker))
    .filter((t) => t.id !== transactionId)

  const preCheck = rebuildPositionFromTransactions([...toRecords(others), merged])
  if (!preCheck.ok) return { ok: false, error: 'insufficient_quantity' }

  const amounts = calculateTransactionAmounts(merged)
  const patch: Record<string, unknown> = { gross_amount: amounts.grossAmount, net_amount: amounts.netAmount }
  if (input.tradeDate !== undefined) patch.trade_date = input.tradeDate
  if (input.quantity !== undefined) patch.quantity = input.quantity
  if (input.price !== undefined) patch.price = input.price
  if (input.fees !== undefined) patch.fees = input.fees
  if (input.taxes !== undefined) patch.taxes = input.taxes
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateRes = await (client as any)
    .from('portfolio_transactions')
    .update(patch)
    .eq('id', transactionId)
    .select(TX_SELECT)
    .single()

  if (updateRes.error) return { ok: false, error: 'update_failed' }

  const rebuild = await reconcileTickerFromTransactions(client, existing.portfolioId, existing.ticker, existing.currency)
  const mapped = mapTransaction(updateRes.data as DbTransactionRow)
  if (rebuild.ok) {
    const step = rebuild.steps.find((s) => s.id === transactionId)
    if (step) mapped.realizedPnl = step.realizedPnl
  }

  return { ok: true, transaction: mapped }
}

export async function deletePortfolioTransaction(
  client: Client,
  transactionId: string,
): Promise<{ ok: boolean; error?: TransactionMutationError }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingRes = await (client as any)
    .from('portfolio_transactions')
    .select(TX_SELECT)
    .eq('id', transactionId)
    .maybeSingle()
  if (existingRes.error || !existingRes.data) return { ok: false, error: 'not_found' }
  const existing = mapTransaction(existingRes.data as DbTransactionRow)

  // Deleting an earlier buy can make a later sell in the same history
  // infeasible (oversell). Pre-check the remaining history before deleting
  // anything, so we never leave an impossible transaction history behind.
  const others = (await fetchTickerTransactions(client, existing.portfolioId, existing.ticker))
    .filter((t) => t.id !== transactionId)
  const preCheck = rebuildPositionFromTransactions(toRecords(others))
  if (!preCheck.ok) return { ok: false, error: 'insufficient_quantity' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delRes = await (client as any).from('portfolio_transactions').delete().eq('id', transactionId)
  if (delRes.error) return { ok: false, error: 'delete_failed' }

  await reconcileTickerFromTransactions(client, existing.portfolioId, existing.ticker, existing.currency)

  return { ok: true }
}

/** Rebuilds portfolio_positions for every ticker that has transaction history in this portfolio. */
export async function rebuildPortfolioPositionsFromTransactions(
  client: Client,
  portfolioId: string,
): Promise<{ ok: boolean; tickers: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_transactions')
    .select('ticker, currency')
    .eq('portfolio_id', portfolioId)

  const rows = (res.data ?? []) as { ticker: string; currency: string }[]
  const byTicker = new Map<string, string>()
  for (const r of rows) byTicker.set(r.ticker, r.currency)

  for (const [ticker, currency] of byTicker) {
    await reconcileTickerFromTransactions(client, portfolioId, ticker, currency)
  }

  return { ok: true, tickers: [...byTicker.keys()] }
}

// ─── Cash ledger ────────────────────────────────────────────────────────────────

export type ManualCashEntryType = 'deposit' | 'withdrawal' | 'adjustment'

export interface AddCashEntryInput {
  entryType: ManualCashEntryType
  /** Entered as a positive magnitude for deposit/withdrawal; signed for adjustment. */
  amount: number
  ledgerDate: string
  currency?: string
  description?: string | null
}

export type CashMutationError = 'invalid_entry_type' | 'invalid_amount' | 'invalid_date' | 'insert_failed'

export async function getCashLedger(
  client: Client,
  portfolioId: string,
  options?: { limit?: number },
): Promise<CashLedgerRecord[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (client as any)
    .from('portfolio_cash_ledger')
    .select(CASH_SELECT)
    .eq('portfolio_id', portfolioId)
    .order('ledger_date', { ascending: false })

  if (options?.limit) query = query.limit(options.limit)

  const res = await query
  const data = res.data as DbCashRow[] | null
  if (res.error || !data) return []
  return data.map(mapCashEntry)
}

export async function addCashLedgerEntry(
  client: Client,
  portfolioId: string,
  input: AddCashEntryInput,
): Promise<{ ok: boolean; error?: CashMutationError; entry?: CashLedgerRecord }> {
  if (!['deposit', 'withdrawal', 'adjustment'].includes(input.entryType)) {
    return { ok: false, error: 'invalid_entry_type' }
  }
  if (!Number.isFinite(input.amount) || input.amount === 0) {
    return { ok: false, error: 'invalid_amount' }
  }
  if (!isValidDateString(input.ledgerDate)) {
    return { ok: false, error: 'invalid_date' }
  }

  // Sign convention: deposit is always a positive inflow, withdrawal always a
  // negative outflow (the user enters a plain positive magnitude for both);
  // adjustment keeps whatever signed value the user entered (a correction can
  // go either way).
  const signedAmount =
    input.entryType === 'withdrawal' ? -Math.abs(input.amount) :
    input.entryType === 'deposit' ? Math.abs(input.amount) :
    input.amount

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_cash_ledger')
    .insert({
      portfolio_id: portfolioId,
      ledger_date: input.ledgerDate,
      currency: input.currency?.trim() || 'CLP',
      entry_type: input.entryType,
      amount: signedAmount,
      description: input.description?.trim() || null,
    })
    .select(CASH_SELECT)
    .single()

  if (res.error) return { ok: false, error: 'insert_failed' }
  const data = res.data as DbCashRow | null
  if (!data) return { ok: false, error: 'insert_failed' }
  return { ok: true, entry: mapCashEntry(data) }
}

export async function getCashBalance(client: Client, portfolioId: string): Promise<number> {
  const entries = await getCashLedger(client, portfolioId)
  return calculateCashBalance(entries)
}

export async function getPortfolioCashSummary(client: Client, portfolioId: string) {
  const entries = await getCashLedger(client, portfolioId)
  return calculatePortfolioCashSummary(entries)
}

export interface RealizedPnlSummary {
  totalRealizedPnl: number
  byTicker: { ticker: string; realizedPnl: number }[]
}

export async function getRealizedPnlSummary(
  client: Client,
  portfolioId: string,
): Promise<RealizedPnlSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('portfolio_transactions')
    .select('ticker, realized_pnl')
    .eq('portfolio_id', portfolioId)

  const rows = (res.data ?? []) as { ticker: string; realized_pnl: number | null }[]
  const byTickerMap = new Map<string, number>()
  let total = 0
  for (const r of rows) {
    const pnl = r.realized_pnl === null ? null : Number(r.realized_pnl)
    if (pnl === null || !Number.isFinite(pnl)) continue
    total += pnl
    byTickerMap.set(r.ticker, (byTickerMap.get(r.ticker) ?? 0) + pnl)
  }

  return {
    totalRealizedPnl: total,
    byTicker: [...byTickerMap.entries()].map(([ticker, realizedPnl]) => ({ ticker, realizedPnl })),
  }
}
