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
//
// Phase 5H — Fable composition. Presentation only: every hook, effect, fetch
// call, computed value, validation rule, and mutation payload below is
// byte-for-byte unchanged. What changed is the LAYOUT, rebuilt to the approved
// Fable Portfolio composition (nmi-fable-v1 SPECS.md §2 "the table IS the page"
// + §1 Overview hero language, per docs/fable-integration/03's route mapping):
//
//   Header      — Fable header architecture: eyebrow + 19px title with the
//                 identity/meta (holdings count, source badge) inline on the
//                 baseline, actions right.
//   Region A    — asymmetric hero row (Fable Overview §1 "no equal-card grid"):
//                 total-value hero card (flex 1.7) + exposure meter panel
//                 (flex 1). Replaces the old flat 7-across capsule grid.
//   Region B    — Fable Portfolio workspace: wide table card (flex 2.6) with
//                 the segmented control in its own toolbar, beside a narrow
//                 right rail (flex 1) holding the add-form side panel and the
//                 concentration meters.
//
// Fable elements with no authoritative NMI data are OMITTED, never faked:
// the hero sparkline (no portfolio value time series exists), currency mix
// (valuation.ts is CLP-first with no FX conversion), the asset-class/search
// filter row and sortable headers (no filter/sort state exists on this route),
// and the row-click position detail panel (no position-detail payload exists).

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import { getAllCompanies } from '@/lib/data/companies'
import { formatCLP, formatPct, changeColor } from '@/lib/formatters'
import { useMarketData } from '@/components/providers/MarketDataProvider'
import { useGlobalRefresh } from '@/components/providers/useGlobalRefresh'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { valuePositions, calculatePortfolioTotals, calculateSectorExposure, type LatestPrice } from '@/lib/portfolio/valuation'
import type { DataSourceStatus } from '@/lib/providers/types'
import { TableCard } from '@/components/fable/TableCard'
import { AsyncState } from '@/components/fable/AsyncState'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { ChangeIndicator } from '@/components/fable/ChangeIndicator'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { Reveal } from '@/components/fable/motion'
import { PrivacyValue } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'

const ALL_COMPANIES = getAllCompanies()
const VALID_TICKERS = new Set(ALL_COMPANIES.map(c => c.ticker.toUpperCase()))

// Fable composition ratios, transcribed from the approved export's Portfolio
// and Overview screens. Layout proportions only — no color/material value.
const FABLE_HERO  = { flex: '1.7 1 400px', minWidth: 'min(100%, 340px)' } as const
const FABLE_ASIDE = { flex: '1 1 250px',   minWidth: 'min(100%, 240px)' } as const
const FABLE_MAIN  = { flex: '2.6 1 620px', minWidth: 'min(100%, 340px)' } as const
const FABLE_RAIL  = { flex: '1 1 280px',   minWidth: 'min(100%, 260px)' } as const

// Fable chip-input recipe (established in Phase 5D/5E/5F/5G) — pill-shaped
// controls, `--nv-chip`/`--nv-chipbd` fill, tokenised focus/transition. In the
// Fable right-rail side panel these stack full-width rather than sitting on one
// horizontal row.
const CHIP_INPUT =
  'h-8 w-full px-3 rounded-full text-xs text-foreground placeholder:text-muted outline-none focus:border-accent nv-transition'
const CHIP_STYLE = { backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' } as const
const PILL_BUTTON = 'h-8 w-full px-4 rounded-full bg-primary text-primary-fg text-xs font-medium disabled:opacity-50 nv-transition'

// ── R9.6 · what Privacy Mode masks on this page, and why ─────────────────────
//
// Privacy Mode hides HOW MUCH, not how it is distributed or how it is doing. It
// is a screen-share / shoulder-surfing feature, so the line is drawn at values
// that disclose the size of the book:
//
//   MASKED — every absolute amount derived from the user's holdings: total
//     market value, total cost basis, unrealized and realized P&L amounts, cash
//     balance and every cash-summary total, per-position quantity, average cost,
//     market value and P&L amount, and every transaction quantity, price, fee,
//     tax, net amount and realized P&L. Quantity and the per-unit costs are
//     masked alongside the totals precisely so an observer cannot multiply two
//     visible numbers back into a masked one.
//
//   NOT MASKED — public market data (latest price, ticker, company, sector) and
//     user-derived PERCENTAGES: P&L %, position weight, sector exposure and
//     concentration. Percentages disclose performance and proportion, never an
//     amount, and keeping them is what lets the page stay analytically useful
//     while it is on a shared screen. The exposure and concentration meters are
//     an additional, decisive reason: the bar width itself encodes the weight,
//     so masking only the printed number would be theatre — and hiding the bars
//     would be the Portfolio redesign this phase is explicitly not.
//
//   NOT MASKED — the holdings count, the transaction date/type and the ledger
//     description: none of them is an amount.
//
//   NOT MASKED — the inline editor and the add-position/transaction/cash forms.
//     Those are the user's own explicit input on their own record, and a masked
//     field cannot be edited.

/** Presentational tint only — mirrors ChangeIndicator's own direction→token map for a pill backdrop. */
function toneToken(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'var(--muted-fg)'
  if (v > 0) return 'var(--positive)'
  if (v < 0) return 'var(--negative)'
  return 'var(--muted-fg)'
}

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

// ─── Shared rail primitives (Fable right-rail panel + meter row) ──────────────

/** Fable right-rail panel: 22px-radius glass card, section label, optional right-aligned stat. */
function RailPanel({ label, stat, children }: { label: string; stat?: ReactNode; children: ReactNode }) {
  return (
    <GlassSurface variant="card" className="px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="ui-label text-muted-fg">{label}</div>
        {stat && <span className="ui-meta text-muted-fg">{stat}</span>}
      </div>
      <div className="mt-2">{children}</div>
    </GlassSurface>
  )
}

/** Fable meter row: truncating name · 6px bar track · right-aligned value. */
function MeterRow({ name, pct, value }: { name: string; pct: number | null; value: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-xs">
      <span className="flex-[0_0_92px] min-w-0 truncate text-foreground" title={name}>{name}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--nv-chip)' }}>
        <div
          className="h-full rounded-full nv-transition-state"
          style={{ width: `${pct ?? 0}%`, backgroundColor: 'var(--accent)' }}
        />
      </div>
      <span className="ui-number text-muted-fg w-12 text-right shrink-0">{value}</span>
    </div>
  )
}

// ─── Add-position form (Fable right-rail side panel) ──────────────────────────

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
        setFeedback({ type: 'err', msg: t.portfolio.addError })
      } else {
        setTicker(''); setQuantity(''); setAvgCost(''); setNotes('')
        setFeedback({ type: 'ok', msg: t.portfolio.added })
        onAdded()
        setTimeout(() => setFeedback(null), 2500)
      }
    } catch {
      setFeedback({ type: 'err', msg: t.portfolio.networkError })
    } finally {
      setLoading(false)
    }
  }

  return (
    <RailPanel label={t.portfolio.addPosition}>
      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <input
          type="text"
          list="portfolio-ticker-suggestions"
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          placeholder={t.portfolio.tickerPlaceholder}
          aria-label={t.portfolio.cols.ticker}
          className={`${CHIP_INPUT} font-mono`}
          style={CHIP_STYLE}
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
          aria-label={t.portfolio.quantityLabel}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />

        <input
          type="number"
          min="0"
          step="any"
          value={avgCost}
          onChange={e => setAvgCost(e.target.value)}
          placeholder={t.portfolio.averageCostLabel}
          aria-label={t.portfolio.averageCostLabel}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />

        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t.portfolio.notesLabel}
          aria-label={t.portfolio.notesLabel}
          className={CHIP_INPUT}
          style={CHIP_STYLE}
        />

        <button
          type="submit"
          disabled={loading || !ticker.trim() || !quantity.trim()}
          className={PILL_BUTTON}
        >
          {loading ? '…' : t.portfolio.addPosition}
        </button>

        <span role="status" aria-live="polite" className={feedback ? (feedback.type === 'ok' ? 'text-positive text-xs' : 'text-negative text-xs') : 'sr-only'}>
          {feedback?.msg ?? ''}
        </span>
      </form>
    </RailPanel>
  )
}

// ─── Region A · total-value hero (Fable Overview §1 hero language) ────────────

function PortfolioHero({
  totals,
  realizedPnl,
  cashBalance,
}: {
  totals: Totals
  realizedPnl: number
  cashBalance: number
}) {
  const { t } = useLang()
  const [masked] = usePrivacyMode()
  const pnl = totals.totalUnrealizedPnL
  const pnlPct = totals.totalUnrealizedPnLPct

  return (
    <GlassSurface variant="card" className="px-5 py-5" style={FABLE_HERO}>
      <div className="ui-label text-muted-fg">{t.portfolio.totalMarketValue}</div>
      <div className="ui-kpi-hero ui-number text-foreground mt-2">
        <PrivacyValue masked={masked}>{formatCLP(totals.totalMarketValue)}</PrivacyValue>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center rounded-full px-3 py-1"
          style={{ backgroundColor: `color-mix(in oklab, ${toneToken(pnl)} 14%, transparent)` }}
        >
          {/* The direction tint stays — up or down is not an amount. */}
          <PrivacyValue masked={masked}>
            <ChangeIndicator value={pnl} label={pnl !== null ? formatCLP(pnl) : undefined} />
          </PrivacyValue>
        </span>
        <span className="ui-meta text-muted-fg">
          {t.portfolio.unrealizedPnL} · {t.portfolio.vsCostBasis}
        </span>
      </div>

      <div
        className="mt-4 pt-3.5 border-t border-border grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}
      >
        <div>
          {/* A return PERCENTAGE — performance, not size. Deliberately visible. */}
          <div className="ui-micro-label text-muted-fg">{t.portfolio.unrealizedPnLPct}</div>
          <div className="mt-1"><ChangeIndicator value={pnlPct} label={pnlPct !== null ? formatPct(pnlPct) : undefined} /></div>
        </div>
        <div>
          <div className="ui-micro-label text-muted-fg">{t.portfolio.totalCostBasis}</div>
          <div className="ui-card-value ui-number text-foreground mt-1">
            <PrivacyValue masked={masked}>{formatCLP(totals.totalCostBasis)}</PrivacyValue>
          </div>
        </div>
        <div>
          <div className="ui-micro-label text-muted-fg">{t.portfolio.realizedPnL}</div>
          <div className="mt-1">
            <PrivacyValue masked={masked}>
              <ChangeIndicator value={realizedPnl} label={formatCLP(realizedPnl)} />
            </PrivacyValue>
          </div>
        </div>
        <div>
          <div className="ui-micro-label text-muted-fg">{t.portfolio.cashBalance}</div>
          <div className="ui-card-value ui-number text-foreground mt-1">
            <PrivacyValue masked={masked}>{formatCLP(cashBalance)}</PrivacyValue>
          </div>
        </div>
        <div>
          <div className="ui-micro-label text-muted-fg">{t.portfolio.positionCount}</div>
          <div className="ui-card-value ui-number text-foreground mt-1">{totals.positionCount}</div>
        </div>
      </div>
    </GlassSurface>
  )
}

// ─── Region A · sector exposure panel (Fable exposure-meter language) ─────────

function SectorExposurePanel({ sectors }: { sectors: SectorExposureOut[] }) {
  const { t } = useLang()
  return (
    <GlassSurface variant="card" className="px-5 py-4" style={FABLE_ASIDE}>
      <div className="ui-label text-muted-fg">{t.portfolio.sectorExposure}</div>
      <div className="mt-2">
        {sectors.length === 0 ? (
          <AsyncState kind="empty" message={t.portfolio.noExposure} />
        ) : (
          sectors.map(s => (
            <MeterRow
              key={s.sector}
              name={s.sector}
              pct={s.weight}
              value={s.weight !== null ? formatPct(s.weight, 1).replace('+', '') : '—'}
            />
          ))
        )}
      </div>
    </GlassSurface>
  )
}

// ─── Region B rail · concentration panel (existing position weights) ──────────

function ConcentrationPanel({ top }: { top: PositionOut[] }) {
  const { t } = useLang()
  const largest = top[0]?.weight ?? null
  return (
    <RailPanel
      label={t.portfolio.concentration}
      stat={<>{t.portfolio.largestPosition} <b className="text-foreground">{largest !== null ? formatPct(largest, 1).replace('+', '') : '—'}</b></>}
    >
      {top.map(p => (
        <MeterRow
          key={p.id}
          name={p.ticker}
          pct={p.weight}
          value={p.weight !== null ? formatPct(p.weight, 1).replace('+', '') : '—'}
        />
      ))}
    </RailPanel>
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
  const [masked] = usePrivacyMode()
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
            aria-label={t.portfolio.quantityLabel}
            className="h-7 w-20 px-2 rounded-full ui-number text-right text-foreground outline-none focus:border-accent nv-transition"
            style={CHIP_STYLE}
          />
        </td>
        <td className="py-2 px-3 text-right">
          <input
            type="number" min="0" step="any" value={avgCost}
            onChange={e => setAvgCost(e.target.value)}
            aria-label={t.portfolio.averageCostLabel}
            className="h-7 w-24 px-2 rounded-full ui-number text-right text-foreground outline-none focus:border-accent nv-transition"
            style={CHIP_STYLE}
          />
        </td>
        <td className="py-2 px-3 text-right ui-number text-foreground">{position.latestPrice !== null ? formatCLP(position.latestPrice) : '—'}</td>
        <td className="py-2 px-3 text-left" colSpan={3}>
          <input
            type="text" value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={t.portfolio.notesLabel}
            aria-label={t.portfolio.notesLabel}
            className="h-7 w-full px-2 rounded-full text-foreground outline-none focus:border-accent nv-transition"
            style={CHIP_STYLE}
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
    <tr className="border-b border-border last:border-0 nv-row-hover nv-transition">
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
      <td className="py-2.5 px-3 text-right ui-number text-foreground">
        <PrivacyValue masked={masked}>{position.quantity}</PrivacyValue>
      </td>
      <td className="py-2.5 px-3 text-right ui-number text-foreground">
        <PrivacyValue masked={masked}>{position.averageCost !== null ? formatCLP(position.averageCost) : '—'}</PrivacyValue>
      </td>
      {/* Public last price — never masked. */}
      <td className="py-2.5 px-3 text-right ui-number text-foreground">{position.latestPrice !== null ? formatCLP(position.latestPrice) : '—'}</td>
      <td className="py-2.5 px-3 text-right ui-number text-foreground">
        <PrivacyValue masked={masked}>{position.marketValue !== null ? formatCLP(position.marketValue) : '—'}</PrivacyValue>
      </td>
      <td className={`py-2.5 px-3 text-right ui-number ${position.unrealizedPnL !== null ? changeColor(position.unrealizedPnL) : 'text-muted-fg'}`}>
        <PrivacyValue masked={masked}>{position.unrealizedPnL !== null ? formatCLP(position.unrealizedPnL) : '—'}</PrivacyValue>
      </td>
      {/* P&L PERCENTAGE and weight — performance and proportion, not size. */}
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
  controls,
}: {
  positions: PositionOut[]
  portfolioId: string
  onChanged: () => void
  controls: ReactNode
}) {
  const { t } = useLang()

  return (
    <TableCard
      title={t.portfolio.tabPositions}
      controls={controls}
      minWidth={720}
      state={positions.length === 0 ? 'empty' : undefined}
      stateMessage={t.portfolio.emptyPortfolio}
      footer={<TableSourceFooter source={t.portfolio.source} />}
    >
      <table className="w-full text-xs" style={{ fontSize: 'var(--fs-table-cell)' }}>
        <caption className="sr-only">{t.portfolio.tabPositions}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left py-2.5 pl-4 pr-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.ticker}</th>
            <th scope="col" className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.company}</th>
            <th scope="col" className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.sector}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.quantity}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.avgCost}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.latestPrice}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.marketValue}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.pnl}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.pnlPct}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cols.weight}</th>
            <th scope="col" className="text-center py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}><span className="sr-only">{t.portfolio.cols.company}</span></th>
            <th scope="col" className="text-right py-2.5 pr-4 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}><span className="sr-only">{t.portfolio.editPosition}</span></th>
          </tr>
        </thead>
        <tbody>
          {positions.map(p => (
            <PositionRow key={p.id} position={p} portfolioId={portfolioId} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </TableCard>
  )
}

// ─── Transactions: add form (Fable right-rail side panel) ─────────────────────

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
        setFeedback({ type: 'err', msg: t.portfolio.addError })
      } else {
        setTicker(''); setQuantity(''); setPrice(''); setFees(''); setTaxes(''); setNotes('')
        setFeedback({ type: 'ok', msg: t.portfolio.tx.added })
        onAdded()
        setTimeout(() => setFeedback(null), 2500)
      }
    } catch {
      setFeedback({ type: 'err', msg: t.portfolio.networkError })
    } finally {
      setLoading(false)
    }
  }

  return (
    <RailPanel label={t.portfolio.tx.addTransaction}>
      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <input
          type="text"
          list="portfolio-ticker-suggestions"
          value={ticker}
          onChange={e => setTicker(e.target.value.toUpperCase())}
          placeholder={t.portfolio.tickerPlaceholder}
          aria-label={t.portfolio.cols.ticker}
          className={`${CHIP_INPUT} font-mono`}
          style={CHIP_STYLE}
          autoComplete="off"
          spellCheck={false}
        />
        <select
          value={transactionType}
          onChange={e => setTransactionType(e.target.value as TransactionType)}
          aria-label={t.portfolio.tx.type}
          className={CHIP_INPUT}
          style={CHIP_STYLE}
        >
          <option value="buy">{t.portfolio.tx.buy}</option>
          <option value="sell">{t.portfolio.tx.sell}</option>
        </select>
        <input
          type="date"
          value={tradeDate}
          onChange={e => setTradeDate(e.target.value)}
          aria-label={t.portfolio.tx.tradeDate}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />
        <input
          type="number" min="0" step="any" value={quantity}
          onChange={e => setQuantity(e.target.value)}
          placeholder={t.portfolio.tx.quantityLabel}
          aria-label={t.portfolio.tx.quantityLabel}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />
        <input
          type="number" min="0" step="any" value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder={t.portfolio.tx.priceLabel}
          aria-label={t.portfolio.tx.priceLabel}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />
        <input
          type="number" min="0" step="any" value={fees}
          onChange={e => setFees(e.target.value)}
          placeholder={t.portfolio.tx.feesLabel}
          aria-label={t.portfolio.tx.feesLabel}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />
        <input
          type="number" min="0" step="any" value={taxes}
          onChange={e => setTaxes(e.target.value)}
          placeholder={t.portfolio.tx.taxesLabel}
          aria-label={t.portfolio.tx.taxesLabel}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />
        <input
          type="text" value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t.portfolio.tx.notesLabel}
          aria-label={t.portfolio.tx.notesLabel}
          className={CHIP_INPUT}
          style={CHIP_STYLE}
        />
        <button
          type="submit"
          disabled={loading || !ticker.trim() || !quantity.trim() || !price.trim()}
          className={PILL_BUTTON}
        >
          {loading ? '…' : t.portfolio.tx.addTransaction}
        </button>
        <span role="status" aria-live="polite" className={feedback ? (feedback.type === 'ok' ? 'text-positive text-xs' : 'text-negative text-xs') : 'sr-only'}>
          {feedback?.msg ?? ''}
        </span>
      </form>
    </RailPanel>
  )
}

// ─── Transactions: list ─────────────────────────────────────────────────────────

function TransactionsTable({
  transactions,
  portfolioId,
  onChanged,
  controls,
}: {
  transactions: TransactionOut[]
  portfolioId: string
  onChanged: () => void
  controls: ReactNode
}) {
  const { t } = useLang()
  const [masked] = usePrivacyMode()
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

  return (
    <TableCard
      title={t.portfolio.tabTransactions}
      controls={controls}
      minWidth={720}
      state={transactions.length === 0 ? 'empty' : undefined}
      stateMessage={t.portfolio.tx.empty}
    >
      <table className="w-full text-xs" style={{ fontSize: 'var(--fs-table-cell)' }}>
        <caption className="sr-only">{t.portfolio.tabTransactions}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left py-2.5 pl-4 pr-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.date}</th>
            <th scope="col" className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.ticker}</th>
            <th scope="col" className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.type}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.quantity}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.price}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.fees}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.taxes}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.net}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.tx.cols.realizedPnl}</th>
            <th scope="col" className="text-right py-2.5 pr-4 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}><span className="sr-only">{t.portfolio.removePosition}</span></th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id} className="border-b border-border last:border-0 nv-row-hover nv-transition">
              <td className="py-2.5 pl-4 pr-3 ui-number text-foreground">{tx.tradeDate}</td>
              <td className="py-2.5 px-3">
                <Link href={`/companies/${tx.ticker}`} className="font-mono text-primary hover:underline">{tx.ticker}</Link>
              </td>
              <td className={`py-2.5 px-3 ${tx.transactionType === 'buy' ? 'text-positive' : 'text-negative'}`}>
                {tx.transactionType === 'buy' ? t.portfolio.tx.buy : t.portfolio.tx.sell}
              </td>
              {/* Quantity and the executed price are masked with the amounts —
                  otherwise the two of them multiply straight back into `net`. */}
              <td className="py-2.5 px-3 text-right ui-number text-foreground">
                <PrivacyValue masked={masked}>{tx.quantity}</PrivacyValue>
              </td>
              <td className="py-2.5 px-3 text-right ui-number text-foreground">
                <PrivacyValue masked={masked}>{formatCLP(tx.price)}</PrivacyValue>
              </td>
              <td className="py-2.5 px-3 text-right ui-number text-muted-fg">
                <PrivacyValue masked={masked}>{formatCLP(tx.fees)}</PrivacyValue>
              </td>
              <td className="py-2.5 px-3 text-right ui-number text-muted-fg">
                <PrivacyValue masked={masked}>{formatCLP(tx.taxes)}</PrivacyValue>
              </td>
              <td className="py-2.5 px-3 text-right ui-number text-foreground">
                <PrivacyValue masked={masked}>{tx.netAmount !== null ? formatCLP(tx.netAmount) : '—'}</PrivacyValue>
              </td>
              <td className={`py-2.5 px-3 text-right ui-number ${tx.realizedPnl !== null ? changeColor(tx.realizedPnl) : 'text-muted-fg'}`}>
                <PrivacyValue masked={masked}>{tx.realizedPnl !== null ? formatCLP(tx.realizedPnl) : '—'}</PrivacyValue>
              </td>
              <td className="py-2.5 px-3 pr-4 text-right whitespace-nowrap">
                <button
                  onClick={() => handleRemove(tx.id)}
                  disabled={busyId === tx.id}
                  className="text-muted-fg hover:text-negative text-xs disabled:opacity-40"
                  aria-label={`${t.portfolio.removePosition} ${tx.ticker} ${tx.tradeDate}`}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  )
}

// ─── Cash: add form (Fable right-rail side panel) ─────────────────────────────

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
      if (!res.ok) {
        setFeedback({ type: 'err', msg: t.portfolio.addError })
      } else {
        setAmount(''); setDescription('')
        setFeedback({ type: 'ok', msg: t.portfolio.cash.added })
        onAdded()
        setTimeout(() => setFeedback(null), 2500)
      }
    } catch {
      setFeedback({ type: 'err', msg: t.portfolio.networkError })
    } finally {
      setLoading(false)
    }
  }

  return (
    <RailPanel label={t.portfolio.cash.addEntry}>
      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <select
          value={entryType}
          onChange={e => setEntryType(e.target.value as 'deposit' | 'withdrawal' | 'adjustment')}
          aria-label={t.portfolio.cash.type}
          className={CHIP_INPUT}
          style={CHIP_STYLE}
        >
          <option value="deposit">{t.portfolio.cash.deposit}</option>
          <option value="withdrawal">{t.portfolio.cash.withdrawal}</option>
          <option value="adjustment">{t.portfolio.cash.adjustment}</option>
        </select>
        <input
          type="date"
          value={ledgerDate}
          onChange={e => setLedgerDate(e.target.value)}
          aria-label={t.portfolio.cash.date}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />
        <input
          type="number" step="any" value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={t.portfolio.cash.amountLabel}
          aria-label={t.portfolio.cash.amountLabel}
          className={`${CHIP_INPUT} ui-number`}
          style={CHIP_STYLE}
        />
        <input
          type="text" value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t.portfolio.cash.descriptionLabel}
          aria-label={t.portfolio.cash.descriptionLabel}
          className={CHIP_INPUT}
          style={CHIP_STYLE}
        />
        <button
          type="submit"
          disabled={loading || !amount.trim()}
          className={PILL_BUTTON}
        >
          {loading ? '…' : t.portfolio.cash.addEntry}
        </button>
        <span role="status" aria-live="polite" className={feedback ? (feedback.type === 'ok' ? 'text-positive text-xs' : 'text-negative text-xs') : 'sr-only'}>
          {feedback?.msg ?? ''}
        </span>
      </form>
    </RailPanel>
  )
}

// ─── Cash: summary + ledger ─────────────────────────────────────────────────────

function CashSummaryCards({ summary }: { summary: CashSummary }) {
  const { t } = useLang()
  const [masked] = usePrivacyMode()
  // Secondary metrics, kept adjacent to the table they describe (Fable's
  // secondary-information placement). Each figure carries a FIXED cash-flow
  // direction colour in the original design (deposits/sells green,
  // withdrawals/buys red, net balance neutral) — a semantic distinct from a
  // sign-derived ChangeIndicator, so the original colour array is preserved.
  const cards = [
    { label: t.portfolio.cash.totalDeposits, value: formatCLP(summary.totalDeposits), color: 'text-positive' },
    { label: t.portfolio.cash.totalWithdrawals, value: formatCLP(Math.abs(summary.totalWithdrawals)), color: 'text-negative' },
    { label: t.portfolio.cash.totalBuyOutflows, value: formatCLP(Math.abs(summary.totalBuyOutflows)), color: 'text-negative' },
    { label: t.portfolio.cash.totalSellInflows, value: formatCLP(summary.totalSellInflows), color: 'text-positive' },
    { label: t.portfolio.cash.netBalance, value: formatCLP(summary.netCashBalance), color: 'text-foreground' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {cards.map((c) => (
        <GlassSurface key={c.label} variant="kpi" className="p-3 flex flex-col gap-1">
          <span className="ui-micro-label text-muted-fg">{c.label}</span>
          <span className={`ui-card-value ui-number ${c.color}`}>
            <PrivacyValue masked={masked}>{c.value}</PrivacyValue>
          </span>
        </GlassSurface>
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

function CashLedgerTable({ entries, controls }: { entries: CashEntryOut[]; controls: ReactNode }) {
  const { t } = useLang()
  const [masked] = usePrivacyMode()

  return (
    <TableCard
      title={t.portfolio.tabCash}
      controls={controls}
      minWidth={440}
      state={entries.length === 0 ? 'empty' : undefined}
      stateMessage={t.portfolio.cash.empty}
    >
      <table className="w-full text-xs" style={{ fontSize: 'var(--fs-table-cell)' }}>
        <caption className="sr-only">{t.portfolio.tabCash}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left py-2.5 pl-4 pr-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cash.cols.date}</th>
            <th scope="col" className="text-left py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cash.cols.type}</th>
            <th scope="col" className="text-right py-2.5 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cash.cols.amount}</th>
            <th scope="col" className="text-left py-2.5 pr-4 px-3 border-b border-border ui-table-header text-muted-fg" style={{ backgroundColor: 'var(--surface-table)' }}>{t.portfolio.cash.cols.description}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0 nv-row-hover nv-transition">
              <td className="py-2.5 pl-4 pr-3 ui-number text-foreground">{e.ledgerDate}</td>
              <td className="py-2.5 px-3 text-muted-fg">{cashEntryLabel(t, e.entryType)}</td>
              <td className={`py-2.5 px-3 text-right ui-number ${changeColor(e.amount)}`}>
                <PrivacyValue masked={masked}>{formatCLP(e.amount)}</PrivacyValue>
              </td>
              <td className="py-2.5 pr-4 px-3 text-muted-fg">{e.description ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
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
  /** R11: a failed load must be distinguishable from an empty portfolio. */
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<Tab>('positions')
  // Live market snapshot is shared platform-wide (see MarketDataProvider) — Update
  // on any tab refreshes it, and it survives navigating away from this page.
  // Manual live-price overlay (Yahoo Finance) on top of the Supabase-persisted
  // baseline the API already returns — same pattern as Stocks/Home/Company.
  const { live } = useMarketData()
  // One Update refreshes every live domain, on every tab — see useGlobalRefresh.
  const refreshLive = useGlobalRefresh()

  const doRefresh = useCallback(async () => {
    await refreshLive()
  }, [refreshLive])

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

  // Fable CONCENTRATION rail: the largest holdings by the weight ALREADY
  // computed by valuePositions. Sort + slice only — every number rendered is
  // `position.weight` verbatim; no new value is derived.
  const topByWeight = useMemo(() => {
    const withWeight = (displayed?.positions ?? []).filter(p => p.weight !== null)
    return [...withWeight].sort((a, b) => (b.weight as number) - (a.weight as number)).slice(0, 5)
  }, [displayed])

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
        // R11: an HTTP failure is an ERROR, not an empty portfolio. Previously
        // both this branch and the catch below fell through to loading=false
        // with no detail, so every table rendered its confirmed-empty state —
        // a failed load was indistinguishable from a genuinely empty account.
        // `!pf` stays non-error: no portfolio yet is a real, honest empty.
        if (!res.ok) { if (!cancelled.value) setLoadError(true); setLoading(false); return }
        if (cancelled.value) { setLoading(false); return }
        const json = await res.json()
        const pf = json.portfolios?.[0]
        if (!pf || cancelled.value) { setLoading(false); return }
        setPortfolioId(pf.id)
        await loadDetail(pf.id, cancelled)
      } catch {
        if (!cancelled.value) setLoadError(true)
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

  const tabs: { value: Tab; label: string }[] = [
    { value: 'positions', label: t.portfolio.tabPositions },
    { value: 'transactions', label: t.portfolio.tabTransactions },
    { value: 'cash', label: t.portfolio.tabCash },
  ]

  // Fable places the segmented group inside the analytical card's own toolbar,
  // not on a separate band above the workspace.
  const tabControl = (
    <SegmentedControl
      options={tabs}
      value={tab}
      onChange={setTab}
      ariaLabel={t.portfolio.tabsAriaLabel}
    />
  )

  return (
    <div className="w-full">
      {/* Header — Fable header architecture: eyebrow, 19px title, inline
          identity/meta on the baseline, actions right. */}
      <Reveal>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-5">
          <div className="min-w-0">
            <div className="ui-label text-muted-fg mb-1">{t.portfolio.tag}</div>
            <h1 className="ui-page-title text-foreground">{t.portfolio.title}</h1>
            <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1 mt-1">
              <p className="text-xs text-muted">{t.portfolio.subtitle}</p>
              {!loading && detail && (
                <>
                  <span className="ui-meta text-muted-fg ui-number">
                    {displayed?.totals.positionCount ?? 0} {t.portfolio.holdings}
                  </span>
                  <MarketDataSourceBadge status={priceStatus} />
                </>
              )}
            </div>
          </div>
          {!loading && detail && (
            <div className="flex flex-wrap items-center gap-2 shrink-0 ml-auto">
              <UpdateDataButton onRefresh={doRefresh} />
            </div>
          )}
        </div>
      </Reveal>

      {loading ? (
        <AsyncState kind="loading" message={t.common.loading} />
      ) : loadError ? (
        <AsyncState kind="error" />
      ) : (
        <>
          {/* Region A — asymmetric hero row (Fable Overview §1: no equal-card grid) */}
          {displayed && (
            <Reveal delayMs={70}>
              <div className="flex flex-wrap items-stretch gap-3.5">
                <PortfolioHero
                  totals={displayed.totals}
                  realizedPnl={detail?.realizedPnl?.totalRealizedPnl ?? 0}
                  cashBalance={detail?.cashSummary?.netCashBalance ?? 0}
                />
                <SectorExposurePanel sectors={displayed.sectorExposure} />
              </div>
            </Reveal>
          )}

          {/* Region B — Fable Portfolio workspace: wide table + narrow right rail */}
          <Reveal delayMs={130}>
            <div className="flex flex-wrap items-start gap-3.5 mt-3.5">
              <div style={FABLE_MAIN} className="flex flex-col gap-3">
                {tab === 'cash' && detail && <CashSummaryCards summary={detail.cashSummary} />}

                {tab === 'positions' && (
                  <PositionsTable
                    positions={displayed?.positions ?? []}
                    portfolioId={portfolioId ?? ''}
                    onChanged={refresh}
                    controls={tabControl}
                  />
                )}
                {tab === 'transactions' && (
                  <TransactionsTable
                    transactions={transactions}
                    portfolioId={portfolioId ?? ''}
                    onChanged={refresh}
                    controls={tabControl}
                  />
                )}
                {tab === 'cash' && <CashLedgerTable entries={cashEntries} controls={tabControl} />}
              </div>

              <div style={FABLE_RAIL} className="flex flex-col gap-3.5">
                {portfolioId && tab === 'positions' && <AddPositionForm portfolioId={portfolioId} onAdded={refresh} />}
                {portfolioId && tab === 'transactions' && <AddTransactionForm portfolioId={portfolioId} onAdded={refresh} />}
                {portfolioId && tab === 'cash' && <AddCashForm portfolioId={portfolioId} onAdded={refresh} />}
                {topByWeight.length > 0 && <ConcentrationPanel top={topByWeight} />}
              </div>
            </div>
          </Reveal>
        </>
      )}
    </div>
  )
}
