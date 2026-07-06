// Phase 6D — Transaction History and Cash Ledger Foundation tests.
// Tests pure helpers, structural invariants, and repository logic against an
// in-memory fake Supabase client — no live Supabase calls, no real Auth needed.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  calculateTransactionAmounts,
  calculateAverageCostAfterBuy,
  calculatePositionAfterSell,
  calculateRealizedPnl,
  rebuildPositionFromTransactions,
  buildCashLedgerEntriesForTransaction,
  calculateCashBalance,
  calculatePortfolioCashSummary,
} from '../src/lib/portfolio/transactions.ts'
import {
  addPortfolioTransaction,
  updatePortfolioTransaction,
  deletePortfolioTransaction,
  getCashBalance,
  addCashLedgerEntry,
} from '../src/lib/db/repositories/portfolioTransactionRepository.ts'

const ROOT = join(import.meta.dirname, '..')
const MIGRATION = join(ROOT, 'supabase/migrations/20260703000000_portfolio_transactions_cash_ledger.sql')
const MIDDLEWARE = join(ROOT, 'src/middleware.ts')

// ─── Migration: transactions + cash ledger tables ─────────────────────────────

describe('Phase 6D migration file', () => {
  it('migration file exists', () => {
    assert.ok(existsSync(MIGRATION), 'portfolio_transactions_cash_ledger.sql not found')
  })

  it('defines portfolio_transactions table', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(sql.includes('create table if not exists portfolio_transactions'), 'missing portfolio_transactions table')
  })

  it('defines portfolio_cash_ledger table', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(sql.includes('create table if not exists portfolio_cash_ledger'), 'missing portfolio_cash_ledger table')
  })

  it('portfolio_transactions.ticker references companies(ticker)', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(sql.includes('references companies(ticker)'), 'ticker must FK to companies(ticker)')
  })

  it('constrains transaction_type to buy/sell', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(sql.includes("check (transaction_type in ('buy', 'sell'))"), 'missing transaction_type check constraint')
  })

  it('constrains quantity > 0, price/fees/taxes >= 0', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(sql.includes('check (quantity > 0)'), 'missing quantity > 0 constraint')
    assert.ok(sql.includes('check (price >= 0)'), 'missing price >= 0 constraint')
    assert.ok(sql.includes('check (fees >= 0)'), 'missing fees >= 0 constraint')
    assert.ok(sql.includes('check (taxes >= 0)'), 'missing taxes >= 0 constraint')
  })

  it('constrains cash ledger entry_type to the documented set', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    for (const type of ['deposit', 'withdrawal', 'buy_cash_outflow', 'sell_cash_inflow', 'fee', 'tax', 'adjustment']) {
      assert.ok(sql.includes(`'${type}'`), `entry_type check must include '${type}'`)
    }
  })

  it('enables RLS on both tables', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(sql.includes('alter table portfolio_transactions enable row level security'))
    assert.ok(sql.includes('alter table portfolio_cash_ledger  enable row level security'))
  })

  it('RLS policies are user-scoped (auth.uid() = user_id) for all 4 CRUD ops per table', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const expectedPolicies = [
      'users_own_transactions_select', 'users_own_transactions_insert',
      'users_own_transactions_update', 'users_own_transactions_delete',
      'users_own_cash_ledger_select', 'users_own_cash_ledger_insert',
      'users_own_cash_ledger_update', 'users_own_cash_ledger_delete',
    ]
    for (const p of expectedPolicies) assert.ok(sql.includes(p), `missing RLS policy: ${p}`)
    const usingClauses = sql.match(/using \(auth\.uid\(\) = user_id\)/g) ?? []
    assert.ok(usingClauses.length >= 4, 'expected at least 4 "using (auth.uid() = user_id)" clauses')
  })

  it('enforces cross-table portfolio ownership via a trigger (RLS alone cannot check this)', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(sql.includes('check_portfolio_ownership'), 'missing cross-table ownership guard function')
    assert.ok(sql.includes('check_portfolio_transactions_ownership'), 'missing ownership trigger on portfolio_transactions')
    assert.ok(sql.includes('check_portfolio_cash_ledger_ownership'), 'missing ownership trigger on portfolio_cash_ledger')
  })

  it('user_id defaults to auth.uid() on both tables (defense in depth)', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const matches = sql.match(/user_id\s+uuid not null default auth\.uid\(\)/g) ?? []
    assert.equal(matches.length, 2)
  })

  it('is idempotent (if not exists / drop policy if exists)', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(sql.includes('if not exists'))
    assert.ok(sql.includes('drop policy if exists'))
  })

  it('does not add new columns to portfolio_positions (reuses its existing metadata column)', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    assert.ok(!/alter table portfolio_positions/i.test(sql), 'this migration must not touch portfolio_positions — see the compatibility comment')
  })
})

// ─── Pure math: amounts, average cost, realized P&L ───────────────────────────

describe('Phase 6D transaction math', () => {
  it('calculateTransactionAmounts adds fees/taxes to a buy, subtracts from a sell', () => {
    const buy = calculateTransactionAmounts({ transactionType: 'buy', quantity: 10, price: 100, fees: 5, taxes: 2 })
    assert.equal(buy.grossAmount, 1000)
    assert.equal(buy.netAmount, 1007)

    const sell = calculateTransactionAmounts({ transactionType: 'sell', quantity: 10, price: 100, fees: 5, taxes: 2 })
    assert.equal(sell.grossAmount, 1000)
    assert.equal(sell.netAmount, 993)
  })

  it('calculateAverageCostAfterBuy computes a weighted average, including fees/taxes in cost basis', () => {
    // First buy: 10 @ 100 -> avg cost 100
    const first = calculateAverageCostAfterBuy(null, { quantity: 10, price: 100 })
    assert.equal(first.quantity, 10)
    assert.equal(first.averageCost, 100)

    // Second buy: 10 @ 200 -> blended avg cost (1000 + 2000) / 20 = 150
    const second = calculateAverageCostAfterBuy(first, { quantity: 10, price: 200 })
    assert.equal(second.quantity, 20)
    assert.equal(second.averageCost, 150)
  })

  it('calculateAverageCostAfterBuy folds fees/taxes into the cost basis', () => {
    const withFees = calculateAverageCostAfterBuy(null, { quantity: 10, price: 100, fees: 50, taxes: 50 })
    // (10*100 + 50 + 50) / 10 = 110
    assert.equal(withFees.averageCost, 110)
  })

  it('calculatePositionAfterSell decreases quantity but leaves average cost unchanged', () => {
    const after = calculatePositionAfterSell({ quantity: 20, averageCost: 150 }, { quantity: 8, price: 200 })
    assert.deepEqual(after, { quantity: 12, averageCost: 150 })
  })

  it('calculatePositionAfterSell returns null when selling more than held', () => {
    const after = calculatePositionAfterSell({ quantity: 5, averageCost: 100 }, { quantity: 10, price: 100 })
    assert.equal(after, null)
  })

  it('calculateRealizedPnl = net proceeds minus cost of shares sold at average cost', () => {
    // Sell 8 @ 200, avg cost 150, no fees: proceeds 1600, cost 1200 -> P&L 400
    const pnl = calculateRealizedPnl({ quantity: 20, averageCost: 150 }, { quantity: 8, price: 200 })
    assert.equal(pnl, 400)
  })

  it('calculateRealizedPnl subtracts fees/taxes from proceeds', () => {
    const pnl = calculateRealizedPnl({ quantity: 20, averageCost: 150 }, { quantity: 8, price: 200, fees: 10, taxes: 5 })
    assert.equal(pnl, 400 - 15)
  })

  it('calculateRealizedPnl returns null when there is no average cost to realize against', () => {
    const pnl = calculateRealizedPnl({ quantity: 5, averageCost: null }, { quantity: 5, price: 100 })
    assert.equal(pnl, null)
  })
})

// ─── rebuildPositionFromTransactions ───────────────────────────────────────────

describe('Phase 6D rebuildPositionFromTransactions', () => {
  it('replays buy -> buy -> sell into a correct final state', () => {
    const result = rebuildPositionFromTransactions([
      { id: 't1', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 10, price: 100 },
      { id: 't2', transactionType: 'buy', tradeDate: '2026-02-01', quantity: 10, price: 200 },
      { id: 't3', transactionType: 'sell', tradeDate: '2026-03-01', quantity: 8, price: 250 },
    ])
    assert.equal(result.ok, true)
    if (!result.ok) return
    // avg cost after both buys = 150; sell 8 @ 250 -> proceeds 2000, cost 1200 -> pnl 800
    assert.equal(result.quantity, 12)
    assert.equal(result.averageCost, 150)
    assert.equal(result.realizedPnlTotal, 800)
  })

  it('sorts transactions by tradeDate regardless of input order', () => {
    const result = rebuildPositionFromTransactions([
      { id: 't2', transactionType: 'sell', tradeDate: '2026-03-01', quantity: 5, price: 250 },
      { id: 't1', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 10, price: 100 },
    ])
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.quantity, 5)
  })

  it('rejects a history where a sell exceeds the held quantity', () => {
    const result = rebuildPositionFromTransactions([
      { transactionType: 'buy', tradeDate: '2026-01-01', quantity: 5, price: 100 },
      { transactionType: 'sell', tradeDate: '2026-02-01', quantity: 10, price: 100 },
    ])
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error, 'insufficient_quantity_in_history')
  })

  it('returns per-transaction realized P&L steps keyed by id (for writing back to DB rows)', () => {
    const result = rebuildPositionFromTransactions([
      { id: 'buy1', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 10, price: 100 },
      { id: 'sell1', transactionType: 'sell', tradeDate: '2026-02-01', quantity: 5, price: 150 },
    ])
    assert.equal(result.ok, true)
    if (!result.ok) return
    const buyStep = result.steps.find(s => s.id === 'buy1')
    const sellStep = result.steps.find(s => s.id === 'sell1')
    assert.equal(buyStep?.realizedPnl, null)
    assert.equal(sellStep?.realizedPnl, 250) // 5*(150-100)
  })
})

// ─── Cash ledger math ───────────────────────────────────────────────────────────

describe('Phase 6D cash ledger math', () => {
  it('buildCashLedgerEntriesForTransaction creates a negative outflow for a buy', () => {
    const amounts = calculateTransactionAmounts({ transactionType: 'buy', quantity: 10, price: 100, fees: 5 })
    const entries = buildCashLedgerEntriesForTransaction(
      { transactionType: 'buy', tradeDate: '2026-01-01', currency: 'CLP' }, amounts,
    )
    assert.equal(entries.length, 1)
    assert.equal(entries[0].entryType, 'buy_cash_outflow')
    assert.equal(entries[0].amount, -1005)
  })

  it('buildCashLedgerEntriesForTransaction creates a positive inflow for a sell', () => {
    const amounts = calculateTransactionAmounts({ transactionType: 'sell', quantity: 10, price: 100, fees: 5 })
    const entries = buildCashLedgerEntriesForTransaction(
      { transactionType: 'sell', tradeDate: '2026-01-01', currency: 'CLP' }, amounts,
    )
    assert.equal(entries[0].entryType, 'sell_cash_inflow')
    assert.equal(entries[0].amount, 995)
  })

  it('calculateCashBalance sums signed amounts (deposit +, withdrawal -)', () => {
    const balance = calculateCashBalance([
      { amount: 1_000_000 },
      { amount: -200_000 },
      { amount: -50_000 },
    ])
    assert.equal(balance, 750_000)
  })

  it('calculatePortfolioCashSummary breaks down totals by entry type', () => {
    const summary = calculatePortfolioCashSummary([
      { entryType: 'deposit', amount: 1_000_000 },
      { entryType: 'withdrawal', amount: -100_000 },
      { entryType: 'buy_cash_outflow', amount: -500_000 },
      { entryType: 'sell_cash_inflow', amount: 300_000 },
    ])
    assert.equal(summary.totalDeposits, 1_000_000)
    assert.equal(summary.totalWithdrawals, -100_000)
    assert.equal(summary.totalBuyOutflows, -500_000)
    assert.equal(summary.totalSellInflows, 300_000)
    assert.equal(summary.netCashBalance, 700_000)
  })
})

// ─── In-memory fake Supabase client (repository integration tests) ────────────
//
// Covers exactly the query chains portfolioTransactionRepository.ts uses:
// select().eq().eq().order() [awaited directly], select().maybeSingle(),
// insert().select().single(), insert() [awaited directly], update().eq()
// [awaited directly], update().eq().select().single(), delete().eq(),
// delete().eq().eq(), upsert().

interface FakeRow { [key: string]: unknown }

function makeFakeClient() {
  const tables: Record<string, FakeRow[]> = {
    portfolio_transactions: [],
    portfolio_positions: [],
    portfolio_cash_ledger: [],
  }
  let seq = 1
  const genId = () => `fake-${seq++}`

  function from(table: string) {
    const rows = tables[table]

    function selectBuilder(filtered: FakeRow[]) {
      const builder = {
        eq(col: string, val: unknown) {
          return selectBuilder(filtered.filter((r) => r[col] === val))
        },
        order() { return builder },
        limit() { return builder },
        maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
        single: async () => ({ data: filtered[0] ?? null, error: filtered[0] ? null : { message: 'no rows' } }),
        then(resolve: (v: { data: FakeRow[]; error: null }) => void) {
          resolve({ data: filtered, error: null })
        },
      }
      return builder
    }

    return {
      select() { return selectBuilder(rows) },
      insert(obj: FakeRow) {
        const row: FakeRow = { id: genId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), fees: 0, taxes: 0, currency: 'CLP', realized_pnl: null, ...obj }
        rows.push(row)
        // PostgREST returns a snapshot at insert time, not a live reference —
        // a later UPDATE must not retroactively change what the caller already
        // received. Return a shallow copy so the fake client matches that.
        return {
          select() { return { single: async () => ({ data: { ...row }, error: null }) } },
          then(resolve: (v: { data: null; error: null }) => void) { resolve({ data: null, error: null }) },
        }
      },
      update(patch: FakeRow) {
        return {
          eq(col: string, val: unknown) {
            const matched = rows.filter((r) => r[col] === val)
            matched.forEach((r) => Object.assign(r, patch))
            return {
              select() { return { single: async () => ({ data: matched[0] ? { ...matched[0] } : null, error: matched[0] ? null : { message: 'not found' } }) } },
              then(resolve: (v: { error: null }) => void) { resolve({ error: null }) },
            }
          },
        }
      },
      delete() {
        return {
          eq(col: string, val: unknown) {
            return {
              eq(col2: string, val2: unknown) {
                const idx = rows.findIndex((r) => r[col] === val && r[col2] === val2)
                if (idx >= 0) rows.splice(idx, 1)
                return Promise.resolve({ error: null })
              },
              then(resolve: (v: { error: null }) => void) {
                const idx = rows.findIndex((r) => r[col] === val)
                if (idx >= 0) rows.splice(idx, 1)
                resolve({ error: null })
              },
            }
          },
        }
      },
      upsert(obj: FakeRow) {
        const idx = rows.findIndex((r) => r.portfolio_id === obj.portfolio_id && r.ticker === obj.ticker)
        if (idx >= 0) Object.assign(rows[idx], obj)
        else rows.push({ id: genId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...obj })
        return Promise.resolve({ error: null })
      },
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from, _tables: tables } as any
}

describe('Phase 6D repository — full add/update/delete flow against a fake DB', () => {
  it('adding two buys then a sell updates portfolio_positions to the reconciled quantity/average cost', async () => {
    const client = makeFakeClient()
    const portfolioId = 'pf-1'

    const buy1 = await addPortfolioTransaction(client, portfolioId, {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 10, price: 100,
    })
    assert.equal(buy1.ok, true)

    const buy2 = await addPortfolioTransaction(client, portfolioId, {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-02-01', quantity: 10, price: 200,
    })
    assert.equal(buy2.ok, true)

    const position = client._tables.portfolio_positions.find((p: FakeRow) => p.ticker === 'SQM-B')
    assert.equal(position?.quantity, 20)
    assert.equal(position?.average_cost, 150)
    assert.equal((position?.metadata as Record<string, unknown>)?.positionSource, 'transactions')

    const sell = await addPortfolioTransaction(client, portfolioId, {
      ticker: 'SQM-B', transactionType: 'sell', tradeDate: '2026-03-01', quantity: 8, price: 250,
    })
    assert.equal(sell.ok, true)
    assert.equal(sell.transaction?.realizedPnl, 800) // 8 * (250 - 150)

    const positionAfterSell = client._tables.portfolio_positions.find((p: FakeRow) => p.ticker === 'SQM-B')
    assert.equal(positionAfterSell?.quantity, 12)
    assert.equal(positionAfterSell?.average_cost, 150)

    // Cash ledger reflects two outflows (buys) and one inflow (sell).
    const cashRows = client._tables.portfolio_cash_ledger
    assert.equal(cashRows.filter((r: FakeRow) => r.entry_type === 'buy_cash_outflow').length, 2)
    assert.equal(cashRows.filter((r: FakeRow) => r.entry_type === 'sell_cash_inflow').length, 1)
  })

  it('rejects a sell larger than the currently held (transaction-derived) quantity', async () => {
    const client = makeFakeClient()
    await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'BSANTANDER', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 5, price: 50,
    })
    const oversell = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'BSANTANDER', transactionType: 'sell', tradeDate: '2026-01-02', quantity: 10, price: 60,
    })
    assert.equal(oversell.ok, false)
    assert.equal(oversell.error, 'insufficient_quantity')
  })

  it('rejects zero/negative quantity and negative price before touching the DB', async () => {
    const client = makeFakeClient()
    const zeroQty = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 0, price: 100,
    })
    assert.equal(zeroQty.error, 'invalid_quantity')

    const negPrice = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 5, price: -1,
    })
    assert.equal(negPrice.error, 'invalid_price')

    const negFees = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 5, price: 100, fees: -1,
    })
    assert.equal(negFees.error, 'invalid_fees')
  })

  it('rejects a ticker outside the covered universe', async () => {
    const client = makeFakeClient()
    const result = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'NOTREAL', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 1, price: 1,
    })
    assert.equal(result.error, 'invalid_ticker')
  })

  it('blocks the first transaction for a ticker that already has a manual position', async () => {
    const client = makeFakeClient()
    // Simulate a pre-existing manual position (as portfolioRepository.addPosition would create).
    client._tables.portfolio_positions.push({
      id: 'manual-1', portfolio_id: 'pf-1', ticker: 'SQM-B', quantity: 5, average_cost: 90,
      metadata: { positionSource: 'manual' },
    })
    const result = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 5, price: 100,
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'manual_position_conflict')
  })

  it('treats a pre-6D position with no metadata.positionSource as manual (backward compatible)', async () => {
    const client = makeFakeClient()
    client._tables.portfolio_positions.push({
      id: 'legacy-1', portfolio_id: 'pf-1', ticker: 'CHILE', quantity: 5, average_cost: 40, metadata: {},
    })
    const result = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'CHILE', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 5, price: 45,
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'manual_position_conflict')
  })

  it('updatePortfolioTransaction recalculates realized P&L when an earlier buy price changes', async () => {
    const client = makeFakeClient()
    await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 10, price: 100,
    })
    const sell = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'sell', tradeDate: '2026-02-01', quantity: 4, price: 150,
    })
    assert.equal(sell.transaction?.realizedPnl, 200) // 4*(150-100)

    const buyRow = client._tables.portfolio_transactions.find((r: FakeRow) => r.transaction_type === 'buy')
    const updated = await updatePortfolioTransaction(client, buyRow!.id as string, { price: 120 })
    assert.equal(updated.ok, true)

    const sellRow = client._tables.portfolio_transactions.find((r: FakeRow) => r.transaction_type === 'sell')
    assert.equal(sellRow?.realized_pnl, 120) // 4*(150-120), recalculated

    const position = client._tables.portfolio_positions.find((p: FakeRow) => p.ticker === 'SQM-B')
    assert.equal(position?.average_cost, 120)
  })

  it('deletePortfolioTransaction rejects deleting a buy that would leave a later sell oversold', async () => {
    const client = makeFakeClient()
    await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 10, price: 100,
    })
    await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'sell', tradeDate: '2026-02-01', quantity: 8, price: 150,
    })
    const buyRow = client._tables.portfolio_transactions.find((r: FakeRow) => r.transaction_type === 'buy')

    const result = await deletePortfolioTransaction(client, buyRow!.id as string)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'insufficient_quantity')
    // The buy row must still exist — the delete must not have gone through.
    assert.ok(client._tables.portfolio_transactions.some((r: FakeRow) => r.id === buyRow!.id))
  })

  it('deletePortfolioTransaction succeeds and reconciles the position when history stays valid', async () => {
    const client = makeFakeClient()
    await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-01-01', quantity: 10, price: 100,
    })
    const buy2 = await addPortfolioTransaction(client, 'pf-1', {
      ticker: 'SQM-B', transactionType: 'buy', tradeDate: '2026-02-01', quantity: 10, price: 200,
    })

    const del = await deletePortfolioTransaction(client, buy2.transaction!.id)
    assert.equal(del.ok, true)

    const position = client._tables.portfolio_positions.find((p: FakeRow) => p.ticker === 'SQM-B')
    assert.equal(position?.quantity, 10)
    assert.equal(position?.average_cost, 100)
  })
})

describe('Phase 6D cash ledger repository', () => {
  it('addCashLedgerEntry normalizes deposit to positive and withdrawal to negative', async () => {
    const client = makeFakeClient()
    const deposit = await addCashLedgerEntry(client, 'pf-1', { entryType: 'deposit', amount: 500_000, ledgerDate: '2026-01-01' })
    assert.equal(deposit.entry?.amount, 500_000)

    const withdrawal = await addCashLedgerEntry(client, 'pf-1', { entryType: 'withdrawal', amount: 100_000, ledgerDate: '2026-01-02' })
    assert.equal(withdrawal.entry?.amount, -100_000)

    const balance = await getCashBalance(client, 'pf-1')
    assert.equal(balance, 400_000)
  })

  it('addCashLedgerEntry rejects a zero amount', async () => {
    const client = makeFakeClient()
    const result = await addCashLedgerEntry(client, 'pf-1', { entryType: 'deposit', amount: 0, ledgerDate: '2026-01-01' })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid_amount')
  })

  it('addCashLedgerEntry rejects an invalid entry type', async () => {
    const client = makeFakeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await addCashLedgerEntry(client, 'pf-1', { entryType: 'not_a_type' as any, amount: 100, ledgerDate: '2026-01-01' })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid_entry_type')
  })
})

// ─── Middleware, routes, regression ────────────────────────────────────────────

describe('Phase 6D API routes', () => {
  const routes = [
    'src/app/api/portfolios/[id]/transactions/route.ts',
    'src/app/api/portfolios/[id]/transactions/[transactionId]/route.ts',
    'src/app/api/portfolios/[id]/cash/route.ts',
  ]

  for (const r of routes) {
    it(`${r} exists`, () => {
      assert.ok(existsSync(join(ROOT, r)), `${r} not found`)
    })
  }

  it('routes require an authenticated user client and handle the unconfigured case (never a crash)', () => {
    for (const r of routes) {
      const src = readFileSync(join(ROOT, r), 'utf8')
      assert.ok(src.includes('getSupabaseUserClient'), `${r} must use getSupabaseUserClient`)
      assert.ok(src.includes('Not configured'), `${r} must handle the unconfigured case`)
    }
  })

  it('no route or repository file references the service-role key', () => {
    const files = [
      ...routes,
      'src/lib/db/repositories/portfolioTransactionRepository.ts',
    ]
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), 'utf8')
      assert.ok(!src.includes('service_role'), `${f} must not use service_role key`)
      assert.ok(!src.includes('SUPABASE_SERVICE_ROLE'), `${f} must not reference SUPABASE_SERVICE_ROLE`)
    }
  })

  it('portfolio repository never sets user_id explicitly in transaction/cash insert or update payloads', () => {
    const src = readFileSync(join(ROOT, 'src/lib/db/repositories/portfolioTransactionRepository.ts'), 'utf8')
    assert.ok(!/insert\(\{[^}]*user_id\s*:/.test(src), 'insert() must never set user_id explicitly')
    assert.ok(!/update\(\{[^}]*user_id\s*:/.test(src), 'update() must never set user_id explicitly')
  })
})

describe('Phase 6D middleware — no scope expansion beyond existing protected routes', () => {
  it('still protects /watchlist, /portfolio and their APIs only', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    const pagesMatch = src.match(/const PROTECTED_PAGES\s*=\s*(\[[^\]]*\])/)
    const apiMatch = src.match(/const PROTECTED_API\s*=\s*(\[[^\]]*\])/)
    assert.ok(pagesMatch && apiMatch)
    const pages = JSON.parse(pagesMatch![1].replace(/'/g, '"'))
    const apis = JSON.parse(apiMatch![1].replace(/'/g, '"'))
    // Pre-9A routes still protected; Phase 9A adds structured-notes (no other creep).
    assert.ok(pages.includes('/portfolio') && pages.includes('/watchlist'))
    assert.deepEqual(pages.sort(), ['/portfolio', '/structured-notes', '/watchlist'])
    assert.deepEqual(apis.sort(), ['/api/portfolios', '/api/structured-notes', '/api/watchlists'])
  })

  it('cron routes remain unblocked', () => {
    const src = readFileSync(MIDDLEWARE, 'utf8')
    assert.ok(src.includes('/api/cron'))
  })
})

describe('Phase 6D regression checks', () => {
  it('watchlist and portfolio position API routes still exist', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/api/watchlists/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/portfolios/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/portfolios/[id]/positions/route.ts')))
  })

  it('core migration still has all 11 original tables', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/20260625000000_create_market_intelligence_core.sql'), 'utf8')
    const tables = ['data_sources', 'companies', 'macro_indicators', 'macro_observations',
      'stock_snapshots', 'stock_ohlcv', 'index_snapshots', 'sector_performance',
      'cmf_filings', 'documents', 'ingestion_runs']
    for (const t of tables) assert.ok(sql.includes(t), `core migration missing table: ${t}`)
  })

  it('portfolio_foundation (6C) migration is untouched by this phase', () => {
    assert.ok(existsSync(join(ROOT, 'supabase/migrations/20260702000000_portfolio_foundation.sql')))
  })
})
