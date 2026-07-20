'use client'

// Phase 6C/6D — Authenticated personal portfolio page.
// Middleware guarantees this page is only reachable by signed-in users.
// Pricing comes from the latest Supabase market snapshot (no live Yahoo overlay
// in this phase). No FX conversion, dividends, or performance attribution yet.
//
// Phase 6D adds Transactions + Cash tabs. Positions derived from a transaction
// history (positionSource: 'transactions') are read-only in the Positions tab —
// edit/remove there is reserved for manual positions, to avoid a manual edit
// silently diverging from the reconciled transaction-derived state.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import { getAllCompanies } from '@/lib/data/companies'
import { formatCLP, formatPct, changeColor } from '@/lib/formatters'
import { fetchLiveSnapshot, type LiveSnapshot } from '@/lib/data/marketLiveData'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { valuePositions, calculatePortfolioTotals, calculateSectorExposure, type LatestPrice } from '@/lib/portfolio/valuation'
import type { DataSourceStatus } from '@/lib/providers/types'

const ALL_COMPANIES = getAllCompanies()
const VALID_TICKERS = new Set(ALL_COMPANIES.map(c => c.ticker.toUpperCase()))

type PositionSource = 'manual' | 'transactions'

interface PositionOut {
  id: string
  portfolioId: string
  ticker: string
  quantity: number
  averageCost: number | null
  costCurrency: string
  notes: string | null
  companyName: string
  sector: string | null
  latestPrice: number | null
  marketValue: number | null
  costBasis: number | null
  unrealizedPnL: number | null
  unrealizedPnLPct: number | null
  weight: number | null
  mixedCurrency: boolean
  positionSource: PositionSource
}

interface Totals {
  totalMarketValue: number
  totalCostBasis: number
  totalUnrealizedPnL: number | null
  totalUnrealizedPnLPct: number | null
  positionCount: number
  pricedPositionCount: number
}

interface SectorExposureOut {
  sector: string
  marketValue: number
  weight: number | null
  positionCount: number
}

interface CashSummary {
  totalDeposits: number
  totalWithdrawals: number
  totalBuyOutflows: number
  totalSellInflows: number
  totalFees: number
  totalTaxes: number
  totalAdjustments: number
  netCashBalance: number
}

interface RealizedPnlSummary {
  totalRealizedPnl: number
  byTicker: { ticker: string; realizedPnl: number }[]
}

interface PortfolioDetail {
  positions: PositionOut[]
  totals: Totals
  sectorExposure: SectorExposureOut[]
  cashSummary: CashSummary
  realizedPnl: RealizedPnlSummary
}

type TransactionType = 'buy' | 'sell'

interface TransactionOut {
  id: string
  portfolioId: string
  ticker: string
  transactionType: TransactionType
  tradeDate: string
  quantity: number
  price: number
  fees: number
  taxes: number
  netAmount: number | null
  currency: string
  realizedPnl: number | null
  notes: string | null
}

type CashEntryType = 'deposit' | 'withdrawal' | 'buy_cash_outflow' | 'sell_cash_inflow' | 'fee' | 'tax' | 'adjustment'

interface CashEntryOut {
  id: string
  ledgerDate: string
  currency: string
  entryType: CashEntryType
  amount: number
  description: string | null
}

// ─── Add-position form ────────────────────────────────────────────────────────

function AddPositionForm({
  portfolioId,
  onAdded,
}: {
  portfolioId: string
  onAdded: () => void
}) {
  const { t } = useLang()
  const [ticker, setTicker]     = useState('')
  const [quantity, setQuantity] = useState('')
  const [avgCost, setAvgCost]   = useState('')
  const [notes, setNotes]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const upper = ticker.trim().toUpperCase()
    if (!upper) return

    if (!VALID_TICKERS.has(upper)) {
      setFeedback({ type: 'err', msg: t.portfolio.invalidTicker })
      return
    }
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback({ type: 'err', msg: t.portfolio.invalidQuantity })
      return
    }
    const cost = avgCost.trim() ? Number(avgCost) : null
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      setFeedback({ type: 'err', msg: t.portfolio.invalidAverageCost })
      return
    }

    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: upper, quantity: qty, averageCost: cost, notes: notes.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))

      if (res.status === 409) {
        setFeedback({ type: 'err', msg: t.portfolio.duplicate })
      } else if (res.status === 422) {
        setFeedback({ type: 'err', msg: json.error === 'invalid_quantity' ? t.portfolio.invalidQuantity : t.portfolio.invalidAverageCost })
      } else if (!res.ok) {
        setFeedback({ type: 'err', msg: json.error ?? 'Error' })
      } else {
        setTicker(''); setQuantity(''); setAvgCost(''); setNotes('')
        setFeedback({ type: 'ok', msg: t.portfolio.added })
        onAdded()
        setTimeout(() => setFeedback(null), 2500)
      }
    } catch {
      setFeedback({ type: 'err', msg: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        list="portfolio-ticker-suggestions"
        value={ticker}
        onChange={e => setTicker(e.target.value.toUpperCase())}
        placeholder={t.portfolio.tickerPlaceholder}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-28"
        autoComplete="off"
        spellCheck={false}
      />
      <datalist id="portfolio-ticker-suggestions">
        {ALL_COMPANIES.map(c => (
          <option key={c.ticker} value={c.ticker}>{c.shortName}</option>
        ))}
      </datalist>

      <input
        type="number"
        min="0"
        step="any"
        value={quantity}
        onChange={e => setQuantity(e.target.value)}
        placeholder={t.portfolio.quantityLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs ui-number text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-24"
      />

      <input
        type="number"
        min="0"
        step="any"
        value={avgCost}
        onChange={e => setAvgCost(e.target.value)}
        placeholder={t.portfolio.averageCostLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs ui-number text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-32"
      />

      <input
        type="text"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={t.portfolio.notesLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-36"
      />

      <button
        type="submit"
        disabled={loading || !ticker.trim() || !quantity.trim()}
        className="h-8 px-3 rounded bg-primary text-surface text-xs font-medium disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--primary)' }}
      >
        {loading ? '…' : t.portfolio.addPosition}
      </button>

      {feedback && (
        <span className={`text-xs ${feedback.type === 'ok' ? 'text-positive' : 'text-negative'}`}>
          {feedback.msg}
        </span>
      )}
    </form>
  )
}

// ─── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({
  totals,
  realizedPnl,
  cashBalance,
}: {
  totals: Totals
  realizedPnl: number
  cashBalance: number
}) {
  const { t } = useLang()
  const pnl = totals.totalUnrealizedPnL
  const pnlPct = totals.totalUnrealizedPnLPct

  const cards = [
    { label: t.portfolio.totalMarketValue, value: formatCLP(totals.totalMarketValue), color: 'text-foreground' },
    { label: t.portfolio.totalCostBasis, value: formatCLP(totals.totalCostBasis), color: 'text-foreground' },
    { label: t.portfolio.unrealizedPnL, value: pnl !== null ? formatCLP(pnl) : '—', color: pnl !== null ? changeColor(pnl) : 'text-muted-fg' },
    { label: t.portfolio.unrealizedPnLPct, value: pnlPct !== null ? formatPct(pnlPct) : '—', color: pnlPct !== null ? changeColor(pnlPct) : 'text-muted-fg' },
    { label: t.portfolio.realizedPnL, value: formatCLP(realizedPnl), color: changeColor(realizedPnl) },
    { label: t.portfolio.cashBalance, value: formatCLP(cashBalance), color: 'text-foreground' },
    { label: t.portfolio.positionCount, value: String(totals.positionCount), color: 'text-foreground' },
  ]

  return (
    <div className="grid grid-cols-7 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-surface border border-border rounded px-4 py-3">
          <div className="ui-label text-muted-fg mb-1">{c.label}</div>
          <div className={`ui-number text-lg font-semibold ${c.color}`}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Sector exposure ────────────────────────────────────────────────────────────

function SectorExposureList({ sectors }: { sectors: SectorExposureOut[] }) {
  const { t } = useLang()
  if (sectors.length === 0) return null
  return (
    <div className="bg-surface border border-border rounded px-4 py-3">
      <div className="ui-label text-muted-fg mb-2">{t.portfolio.sectorExposure}</div>
      <div className="space-y-1.5">
        {sectors.map((s) => (
          <div key={s.sector} className="flex items-center gap-3 text-xs">
            <span className="w-32 shrink-0 text-foreground truncate">{s.sector}</span>
            <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${s.weight ?? 0}%`, backgroundColor: 'var(--accent)' }}
              />
            </div>
            <span className="ui-number text-muted-fg w-14 text-right shrink-0">
              {s.weight !== null ? formatPct(s.weight, 1).replace('+', '') : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Positions table (with inline edit) ────────────────────────────────────────

function PositionRow({
  position,
  portfolioId,
  onChanged,
}: {
  position: PositionOut
  portfolioId: string
  onChanged: () => void
}) {
  const { t } = useLang()
  const [editing, setEditing] = useState(false)
  const [quantity, setQuantity] = useState(String(position.quantity))
  const [avgCost, setAvgCost] = useState(position.averageCost !== null ? String(position.averageCost) : '')
  const [notes, setNotes] = useState(position.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setError(t.portfolio.invalidQuantity)
      return
    }
    const cost = avgCost.trim() ? Number(avgCost) : null
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      setError(t.portfolio.invalidAverageCost)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/positions/${encodeURIComponent(position.ticker)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty, averageCost: cost, notes: notes.trim() || null }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error === 'invalid_quantity' ? t.portfolio.invalidQuantity : json.error === 'invalid_average_cost' ? t.portfolio.invalidAverageCost : 'Error')
        return
      }
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await fetch(`/api/portfolios/${portfolioId}/positions/${encodeURIComponent(position.ticker)}`, { method: 'DELETE' })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <tr className="border-b border-border last:border-0 bg-surface-2">
        <td className="py-2 pl-4 pr-3">
          <Link href={`/companies/${position.ticker}`} className="font-mono text-primary hover:underline">
            {position.ticker}
          </Link>
        </td>
        <td className="py-2 px-3 text-foreground">{position.companyName}</td>
        <td className="py-2 px-3 text-muted-fg">{position.sector ?? '—'}</td>
        <td className="py-2 px-3 text-right">
          <input
            type="number" min="0" step="any" value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="h-7 w-20 px-2 rounded border border-border bg-surface text-xs ui-number text-right focus:outline-none focus:border-accent"
          />
        </td>
        <td className="py-2 px-3 text-right">
          <input
            type="number" min="0" step="any" value={avgCost}
            onChange={e => setAvgCost(e.target.value)}
            className="h-7 w-24 px-2 rounded border border-border bg-surface text-xs ui-number text-right focus:outline-none focus:border-accent"
          />
        </td>
        <td className="py-2 px-3 text-right ui-number text-foreground">{position.latestPrice !== null ? formatCLP(position.latestPrice) : '—'}</td>
        <td className="py-2 px-3 text-left" colSpan={3}>
          <input
            type="text" value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={t.portfolio.notesLabel}
            className="h-7 w-full px-2 rounded border border-border bg-surface text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
          />
        </td>
        <td className="py-2 px-3 text-right ui-number text-negative" colSpan={2}>{error}</td>
        <td className="py-2 px-3 pr-4 text-right whitespace-nowrap">
          <button onClick={handleSave} disabled={busy} className="text-primary hover:underline text-xs mr-2 disabled:opacity-40">{t.portfolio.saveEdit}</button>
          <button onClick={() => setEditing(false)} disabled={busy} className="text-muted-fg hover:text-foreground text-xs disabled:opacity-40">{t.portfolio.cancelEdit}</button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
      <td className="py-2.5 pl-4 pr-3">
        <Link href={`/companies/${position.ticker}`} className="font-mono text-primary hover:underline">
          {position.ticker}
        </Link>
        {position.mixedCurrency && (
          <span className="ml-1.5 text-warning" title={t.portfolio.mixedCurrency}>⚠</span>
        )}
      </td>
      <td className="py-2.5 px-3 text-foreground">{position.companyName}</td>
      <td className="py-2.5 px-3 text-muted-fg">{position.sector ?? '—'}</td>
      <td className="py-2.5 px-3 text-right ui-number text-foreground">{position.quantity}</td>
      <td className="py-2.5 px-3 text-right ui-number text-foreground">{position.averageCost !== null ? formatCLP(position.averageCost) : '—'}</td>
      <td className="py-2.5 px-3 text-right ui-number text-foreground">{position.latestPrice !== null ? formatCLP(position.latestPrice) : '—'}</td>
      <td className="py-2.5 px-3 text-right ui-number text-foreground">{position.marketValue !== null ? formatCLP(position.marketValue) : '—'}</td>
      <td className={`py-2.5 px-3 text-right ui-number ${position.unrealizedPnL !== null ? changeColor(position.unrealizedPnL) : 'text-muted-fg'}`}>
        {position.unrealizedPnL !== null ? formatCLP(position.unrealizedPnL) : '—'}
      </td>
      <td className={`py-2.5 px-3 text-right ui-number ${position.unrealizedPnLPct !== null ? changeColor(position.unrealizedPnLPct) : 'text-muted-fg'}`}>
        {position.unrealizedPnLPct !== null ? formatPct(position.unrealizedPnLPct) : '—'}
      </td>
      <td className="py-2.5 px-3 text-right ui-number text-muted-fg">{position.weight !== null ? formatPct(position.weight, 1).replace('+', '') : '—'}</td>
      <td className="py-2.5 px-3 text-center">
        <span
          className="ui-label px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: 'var(--surface-2)',
            color: position.positionSource === 'transactions' ? 'var(--accent)' : 'var(--muted-fg)',
          }}
        >
          {position.positionSource === 'transactions' ? t.portfolio.transactionsBadge : t.portfolio.manualBadge}
        </span>
      </td>
      <td className="py-2.5 px-3 pr-4 text-right whitespace-nowrap">
        {position.positionSource === 'transactions' ? (
          <span className="text-muted-fg text-xs" title={t.portfolio.manualLocked}>—</span>
        ) : (
          <>
            <button onClick={() => setEditing(true)} disabled={busy} className="text-muted-fg hover:text-foreground text-xs mr-2 disabled:opacity-40">{t.portfolio.editPosition}</button>
            <button onClick={handleRemove} disabled={busy} className="text-muted-fg hover:text-negative text-xs disabled:opacity-40" title={t.portfolio.removePosition}>×</button>
          </>
        )}
      </td>
    </tr>
  )
}

function PositionsTable({
  positions,
  portfolioId,
  onChanged,
}: {
  positions: PositionOut[]
  portfolioId: string
  onChanged: () => void
}) {
  const { t } = useLang()

  if (positions.length === 0) {
    return (
      <div className="bg-surface border border-border rounded px-5 py-8 text-center">
        <p className="text-xs text-muted-fg">{t.portfolio.emptyPortfolio}</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.portfolio.cols.ticker}</th>
            <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.company}</th>
            <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.sector}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.quantity}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.avgCost}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.latestPrice}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.marketValue}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.pnl}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.pnlPct}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cols.weight}</th>
            <th className="text-center py-2.5 px-3 ui-table-header text-muted-fg"></th>
            <th className="text-right py-2.5 pr-4 px-3 ui-table-header text-muted-fg"></th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => (
            <PositionRow key={p.id} position={p} portfolioId={portfolioId} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
      <div className="px-4 py-2 border-t border-border bg-surface">
        <TableSourceFooter source={t.portfolio.source} />
      </div>
    </div>
  )
}

// ─── Transactions: add form ─────────────────────────────────────────────────────

function AddTransactionForm({
  portfolioId,
  onAdded,
}: {
  portfolioId: string
  onAdded: () => void
}) {
  const { t } = useLang()
  const [ticker, setTicker] = useState('')
  const [transactionType, setTransactionType] = useState<TransactionType>('buy')
  const [tradeDate, setTradeDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [fees, setFees] = useState('')
  const [taxes, setTaxes] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const upper = ticker.trim().toUpperCase()
    if (!upper) return
    if (!VALID_TICKERS.has(upper)) {
      setFeedback({ type: 'err', msg: t.portfolio.invalidTicker })
      return
    }
    const qty = Number(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      setFeedback({ type: 'err', msg: t.portfolio.tx.invalidQuantity })
      return
    }
    const p = Number(price)
    if (!Number.isFinite(p) || p < 0) {
      setFeedback({ type: 'err', msg: t.portfolio.tx.invalidPrice })
      return
    }

    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: upper,
          transactionType,
          tradeDate,
          quantity: qty,
          price: p,
          fees: fees.trim() ? Number(fees) : undefined,
          taxes: taxes.trim() ? Number(taxes) : undefined,
          notes: notes.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))

      if (res.status === 409 && json.error === 'manual_position_conflict') {
        setFeedback({ type: 'err', msg: t.portfolio.tx.manualConflict })
      } else if (res.status === 409 && json.error === 'insufficient_quantity') {
        setFeedback({ type: 'err', msg: t.portfolio.tx.insufficientQuantity })
      } else if (!res.ok) {
        setFeedback({ type: 'err', msg: json.error ?? 'Error' })
      } else {
        setTicker(''); setQuantity(''); setPrice(''); setFees(''); setTaxes(''); setNotes('')
        setFeedback({ type: 'ok', msg: t.portfolio.tx.added })
        onAdded()
        setTimeout(() => setFeedback(null), 2500)
      }
    } catch {
      setFeedback({ type: 'err', msg: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 bg-surface border border-border rounded px-4 py-3">
      <input
        type="text"
        list="portfolio-ticker-suggestions"
        value={ticker}
        onChange={e => setTicker(e.target.value.toUpperCase())}
        placeholder={t.portfolio.tickerPlaceholder}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-28"
        autoComplete="off"
        spellCheck={false}
      />
      <select
        value={transactionType}
        onChange={e => setTransactionType(e.target.value as TransactionType)}
        className="h-8 px-2 rounded border border-border bg-surface-2 text-xs text-foreground focus:outline-none focus:border-accent"
      >
        <option value="buy">{t.portfolio.tx.buy}</option>
        <option value="sell">{t.portfolio.tx.sell}</option>
      </select>
      <input
        type="date"
        value={tradeDate}
        onChange={e => setTradeDate(e.target.value)}
        className="h-8 px-2 rounded border border-border bg-surface-2 text-xs ui-number text-foreground focus:outline-none focus:border-accent"
      />
      <input
        type="number" min="0" step="any" value={quantity}
        onChange={e => setQuantity(e.target.value)}
        placeholder={t.portfolio.tx.quantityLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs ui-number text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-24"
      />
      <input
        type="number" min="0" step="any" value={price}
        onChange={e => setPrice(e.target.value)}
        placeholder={t.portfolio.tx.priceLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs ui-number text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-28"
      />
      <input
        type="number" min="0" step="any" value={fees}
        onChange={e => setFees(e.target.value)}
        placeholder={t.portfolio.tx.feesLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs ui-number text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-20"
      />
      <input
        type="number" min="0" step="any" value={taxes}
        onChange={e => setTaxes(e.target.value)}
        placeholder={t.portfolio.tx.taxesLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs ui-number text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-20"
      />
      <input
        type="text" value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder={t.portfolio.tx.notesLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-32"
      />
      <button
        type="submit"
        disabled={loading || !ticker.trim() || !quantity.trim() || !price.trim()}
        className="h-8 px-3 rounded bg-primary text-surface text-xs font-medium disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--primary)' }}
      >
        {loading ? '…' : t.portfolio.tx.addTransaction}
      </button>
      {feedback && (
        <span className={`text-xs ${feedback.type === 'ok' ? 'text-positive' : 'text-negative'}`}>
          {feedback.msg}
        </span>
      )}
    </form>
  )
}

// ─── Transactions: list ─────────────────────────────────────────────────────────

function TransactionsTable({
  transactions,
  portfolioId,
  onChanged,
}: {
  transactions: TransactionOut[]
  portfolioId: string
  onChanged: () => void
}) {
  const { t } = useLang()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleRemove(id: string) {
    setBusyId(id)
    try {
      await fetch(`/api/portfolios/${portfolioId}/transactions/${id}`, { method: 'DELETE' })
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-surface border border-border rounded px-5 py-8 text-center">
        <p className="text-xs text-muted-fg">{t.portfolio.tx.empty}</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.date}</th>
            <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.ticker}</th>
            <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.type}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.quantity}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.price}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.fees}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.taxes}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.net}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.tx.cols.realizedPnl}</th>
            <th className="text-right py-2.5 pr-4 px-3 ui-table-header text-muted-fg"></th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
              <td className="py-2.5 pl-4 pr-3 ui-number text-foreground">{tx.tradeDate}</td>
              <td className="py-2.5 px-3">
                <Link href={`/companies/${tx.ticker}`} className="font-mono text-primary hover:underline">{tx.ticker}</Link>
              </td>
              <td className={`py-2.5 px-3 ${tx.transactionType === 'buy' ? 'text-positive' : 'text-negative'}`}>
                {tx.transactionType === 'buy' ? t.portfolio.tx.buy : t.portfolio.tx.sell}
              </td>
              <td className="py-2.5 px-3 text-right ui-number text-foreground">{tx.quantity}</td>
              <td className="py-2.5 px-3 text-right ui-number text-foreground">{formatCLP(tx.price)}</td>
              <td className="py-2.5 px-3 text-right ui-number text-muted-fg">{formatCLP(tx.fees)}</td>
              <td className="py-2.5 px-3 text-right ui-number text-muted-fg">{formatCLP(tx.taxes)}</td>
              <td className="py-2.5 px-3 text-right ui-number text-foreground">{tx.netAmount !== null ? formatCLP(tx.netAmount) : '—'}</td>
              <td className={`py-2.5 px-3 text-right ui-number ${tx.realizedPnl !== null ? changeColor(tx.realizedPnl) : 'text-muted-fg'}`}>
                {tx.realizedPnl !== null ? formatCLP(tx.realizedPnl) : '—'}
              </td>
              <td className="py-2.5 px-3 pr-4 text-right whitespace-nowrap">
                <button
                  onClick={() => handleRemove(tx.id)}
                  disabled={busyId === tx.id}
                  className="text-muted-fg hover:text-negative text-xs disabled:opacity-40"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Cash: add form ─────────────────────────────────────────────────────────────

function AddCashForm({
  portfolioId,
  onAdded,
}: {
  portfolioId: string
  onAdded: () => void
}) {
  const { t } = useLang()
  const [entryType, setEntryType] = useState<'deposit' | 'withdrawal' | 'adjustment'>('deposit')
  const [ledgerDate, setLedgerDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt === 0) {
      setFeedback({ type: 'err', msg: t.portfolio.cash.invalidAmount })
      return
    }

    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/cash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryType, amount: amt, ledgerDate, description: description.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFeedback({ type: 'err', msg: json.error ?? 'Error' })
      } else {
        setAmount(''); setDescription('')
        setFeedback({ type: 'ok', msg: t.portfolio.cash.added })
        onAdded()
        setTimeout(() => setFeedback(null), 2500)
      }
    } catch {
      setFeedback({ type: 'err', msg: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 bg-surface border border-border rounded px-4 py-3">
      <select
        value={entryType}
        onChange={e => setEntryType(e.target.value as 'deposit' | 'withdrawal' | 'adjustment')}
        className="h-8 px-2 rounded border border-border bg-surface-2 text-xs text-foreground focus:outline-none focus:border-accent"
      >
        <option value="deposit">{t.portfolio.cash.deposit}</option>
        <option value="withdrawal">{t.portfolio.cash.withdrawal}</option>
        <option value="adjustment">{t.portfolio.cash.adjustment}</option>
      </select>
      <input
        type="date"
        value={ledgerDate}
        onChange={e => setLedgerDate(e.target.value)}
        className="h-8 px-2 rounded border border-border bg-surface-2 text-xs ui-number text-foreground focus:outline-none focus:border-accent"
      />
      <input
        type="number" step="any" value={amount}
        onChange={e => setAmount(e.target.value)}
        placeholder={t.portfolio.cash.amountLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs ui-number text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-32"
      />
      <input
        type="text" value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder={t.portfolio.cash.descriptionLabel}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-48"
      />
      <button
        type="submit"
        disabled={loading || !amount.trim()}
        className="h-8 px-3 rounded bg-primary text-surface text-xs font-medium disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--primary)' }}
      >
        {loading ? '…' : t.portfolio.cash.addEntry}
      </button>
      {feedback && (
        <span className={`text-xs ${feedback.type === 'ok' ? 'text-positive' : 'text-negative'}`}>
          {feedback.msg}
        </span>
      )}
    </form>
  )
}

// ─── Cash: summary + ledger ─────────────────────────────────────────────────────

function CashSummaryCards({ summary }: { summary: CashSummary }) {
  const { t } = useLang()
  const cards = [
    { label: t.portfolio.cash.totalDeposits, value: formatCLP(summary.totalDeposits), color: 'text-positive' },
    { label: t.portfolio.cash.totalWithdrawals, value: formatCLP(Math.abs(summary.totalWithdrawals)), color: 'text-negative' },
    { label: t.portfolio.cash.totalBuyOutflows, value: formatCLP(Math.abs(summary.totalBuyOutflows)), color: 'text-negative' },
    { label: t.portfolio.cash.totalSellInflows, value: formatCLP(summary.totalSellInflows), color: 'text-positive' },
    { label: t.portfolio.cash.netBalance, value: formatCLP(summary.netCashBalance), color: 'text-foreground' },
  ]
  return (
    <div className="grid grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-surface border border-border rounded px-4 py-3">
          <div className="ui-label text-muted-fg mb-1">{c.label}</div>
          <div className={`ui-number text-lg font-semibold ${c.color}`}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

function cashEntryLabel(t: ReturnType<typeof useLang>['t'], entryType: CashEntryType): string {
  switch (entryType) {
    case 'deposit': return t.portfolio.cash.deposit
    case 'withdrawal': return t.portfolio.cash.withdrawal
    case 'adjustment': return t.portfolio.cash.adjustment
    case 'buy_cash_outflow': return t.portfolio.cash.totalBuyOutflows
    case 'sell_cash_inflow': return t.portfolio.cash.totalSellInflows
    case 'fee': return t.portfolio.cash.totalFees
    case 'tax': return t.portfolio.cash.totalTaxes
  }
}

function CashLedgerTable({ entries }: { entries: CashEntryOut[] }) {
  const { t } = useLang()

  if (entries.length === 0) {
    return (
      <div className="bg-surface border border-border rounded px-5 py-8 text-center">
        <p className="text-xs text-muted-fg">{t.portfolio.cash.empty}</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.portfolio.cash.cols.date}</th>
            <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cash.cols.type}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.portfolio.cash.cols.amount}</th>
            <th className="text-left py-2.5 pr-4 px-3 ui-table-header text-muted-fg">{t.portfolio.cash.cols.description}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
              <td className="py-2.5 pl-4 pr-3 ui-number text-foreground">{e.ledgerDate}</td>
              <td className="py-2.5 px-3 text-muted-fg">{cashEntryLabel(t, e.entryType)}</td>
              <td className={`py-2.5 px-3 text-right ui-number ${changeColor(e.amount)}`}>{formatCLP(e.amount)}</td>
              <td className="py-2.5 pr-4 px-3 text-muted-fg">{e.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'positions' | 'transactions' | 'cash'

export default function PortfolioPage() {
  const { t } = useLang()
  const [portfolioId, setPortfolioId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PortfolioDetail | null>(null)
  const [transactions, setTransactions] = useState<TransactionOut[]>([])
  const [cashEntries, setCashEntries] = useState<CashEntryOut[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('positions')
  // Manual live-price overlay (Yahoo Finance) on top of the Supabase-persisted
  // baseline the API already returns — same pattern as Stocks/Home/Company.
  const [live, setLive] = useState<LiveSnapshot | null>(null)

  const doRefresh = useCallback(async () => {
    const data = await fetchLiveSnapshot()
    if (!data) throw new Error('unavailable')
    setLive(data)
  }, [])

  const priceStatus: DataSourceStatus = live ? 'live' : 'persisted'

  const displayed = useMemo(() => {
    if (!detail) return null
    if (!live) return { positions: detail.positions, totals: detail.totals, sectorExposure: detail.sectorExposure }

    const pricesByTicker = new Map<string, LatestPrice>(
      detail.positions.map((p) => {
        const lv = live.stocks[p.ticker]
        return [p.ticker.toUpperCase(), { price: lv?.price ?? p.latestPrice, currency: 'CLP' }]
      }),
    )
    const valued = valuePositions(
      detail.positions.map((p) => ({
        ticker: p.ticker,
        quantity: p.quantity,
        averageCost: p.averageCost,
        costCurrency: p.costCurrency,
        sector: p.sector,
      })),
      pricesByTicker,
    )
    const positions: PositionOut[] = detail.positions.map((p, i) => ({
      ...p,
      latestPrice: valued[i].latestPrice,
      marketValue: valued[i].marketValue,
      unrealizedPnL: valued[i].unrealizedPnL,
      unrealizedPnLPct: valued[i].unrealizedPnLPct,
      weight: valued[i].weight,
      mixedCurrency: valued[i].mixedCurrency,
    }))
    return {
      positions,
      totals: calculatePortfolioTotals(valued),
      sectorExposure: calculateSectorExposure(valued),
    }
  }, [detail, live])

  async function loadDetail(id: string, cancelled: { value: boolean }) {
    const [detailRes, txRes, cashRes] = await Promise.all([
      fetch(`/api/portfolios/${id}`, { cache: 'no-store' }),
      fetch(`/api/portfolios/${id}/transactions`, { cache: 'no-store' }),
      fetch(`/api/portfolios/${id}/cash`, { cache: 'no-store' }),
    ])
    if (cancelled.value) return
    if (detailRes.ok) {
      const json = await detailRes.json()
      setDetail({
        positions: json.positions ?? [],
        totals: json.totals,
        sectorExposure: json.sectorExposure ?? [],
        cashSummary: json.cashSummary,
        realizedPnl: json.realizedPnl,
      })
    }
    if (txRes.ok) {
      const json = await txRes.json()
      setTransactions(json.transactions ?? [])
    }
    if (cashRes.ok) {
      const json = await cashRes.json()
      setCashEntries(json.entries ?? [])
    }
  }

  useEffect(() => {
    const cancelled = { value: false }
    void (async () => {
      try {
        const res = await fetch('/api/portfolios', { cache: 'no-store' })
        if (!res.ok || cancelled.value) { setLoading(false); return }
        const json = await res.json()
        const pf = json.portfolios?.[0]
        if (!pf || cancelled.value) { setLoading(false); return }
        setPortfolioId(pf.id)
        await loadDetail(pf.id, cancelled)
      } catch {
        // network error — leave loading state, show empty
      } finally {
        if (!cancelled.value) setLoading(false)
      }
    })()
    return () => { cancelled.value = true }
  }, [])

  function refresh() {
    if (!portfolioId) return
    void loadDetail(portfolioId, { value: false })
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'positions', label: t.portfolio.tabPositions },
    { key: 'transactions', label: t.portfolio.tabTransactions },
    { key: 'cash', label: t.portfolio.tabCash },
  ]

  return (
    <div className="w-full space-y-5">
      <SectionHeader
        tag={t.portfolio.tag}
        title={t.portfolio.title}
        subtitle={t.portfolio.subtitle}
        actions={!loading && detail ? <UpdateDataButton onRefresh={doRefresh} /> : undefined}
      />

      {!loading && detail && (
        <div className="flex items-center gap-1.5">
          <MarketDataSourceBadge status={priceStatus} />
        </div>
      )}

      {loading ? (
        <div className="bg-surface border border-border rounded px-5 py-8 text-center">
          <p className="text-xs text-muted-fg">Loading…</p>
        </div>
      ) : (
        <>
          {displayed && (
            <SummaryCards
              totals={displayed.totals}
              realizedPnl={detail?.realizedPnl?.totalRealizedPnl ?? 0}
              cashBalance={detail?.cashSummary?.netCashBalance ?? 0}
            />
          )}
          {displayed && displayed.sectorExposure.length > 0 && (
            <SectorExposureList sectors={displayed.sectorExposure} />
          )}

          <div className="flex items-center gap-1 border-b border-border">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className="px-3 py-2 text-xs border-b-2 transition-colors -mb-px"
                style={
                  tab === tb.key
                    ? { borderColor: 'var(--accent)', color: 'var(--foreground)' }
                    : { borderColor: 'transparent', color: 'var(--muted-fg)' }
                }
              >
                {tb.label}
              </button>
            ))}
          </div>

          {tab === 'positions' && (
            <div className="space-y-3">
              {portfolioId && <AddPositionForm portfolioId={portfolioId} onAdded={refresh} />}
              <PositionsTable
                positions={displayed?.positions ?? []}
                portfolioId={portfolioId ?? ''}
                onChanged={refresh}
              />
            </div>
          )}

          {tab === 'transactions' && (
            <div className="space-y-3">
              {portfolioId && <AddTransactionForm portfolioId={portfolioId} onAdded={refresh} />}
              <TransactionsTable
                transactions={transactions}
                portfolioId={portfolioId ?? ''}
                onChanged={refresh}
              />
            </div>
          )}

          {tab === 'cash' && (
            <div className="space-y-3">
              {detail && <CashSummaryCards summary={detail.cashSummary} />}
              {portfolioId && <AddCashForm portfolioId={portfolioId} onAdded={refresh} />}
              <CashLedgerTable entries={cashEntries} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
