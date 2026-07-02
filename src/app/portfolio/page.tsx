'use client'

// Phase 6C — Authenticated personal portfolio page.
// Middleware guarantees this page is only reachable by signed-in users.
// Pricing comes from the latest Supabase market snapshot (no live Yahoo overlay
// in this phase). No transaction history / realized P&L / FX conversion yet.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { getAllCompanies } from '@/lib/data/companies'
import { formatCLP, formatPct, changeColor } from '@/lib/formatters'

const ALL_COMPANIES = getAllCompanies()
const VALID_TICKERS = new Set(ALL_COMPANIES.map(c => c.ticker.toUpperCase()))

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

interface PortfolioDetail {
  positions: PositionOut[]
  totals: Totals
  sectorExposure: SectorExposureOut[]
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

function SummaryCards({ totals }: { totals: Totals }) {
  const { t } = useLang()
  const pnl = totals.totalUnrealizedPnL
  const pnlPct = totals.totalUnrealizedPnLPct

  const cards = [
    { label: t.portfolio.totalMarketValue, value: formatCLP(totals.totalMarketValue), color: 'text-foreground' },
    { label: t.portfolio.totalCostBasis, value: formatCLP(totals.totalCostBasis), color: 'text-foreground' },
    { label: t.portfolio.unrealizedPnL, value: pnl !== null ? formatCLP(pnl) : '—', color: pnl !== null ? changeColor(pnl) : 'text-muted-fg' },
    { label: t.portfolio.unrealizedPnLPct, value: pnlPct !== null ? formatPct(pnlPct) : '—', color: pnlPct !== null ? changeColor(pnlPct) : 'text-muted-fg' },
    { label: t.portfolio.positionCount, value: String(totals.positionCount), color: 'text-foreground' },
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
        <td className="py-2 px-3 text-right ui-number text-negative">{error}</td>
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
      <td className="py-2.5 px-3 pr-4 text-right whitespace-nowrap">
        <button onClick={() => setEditing(true)} disabled={busy} className="text-muted-fg hover:text-foreground text-xs mr-2 disabled:opacity-40">{t.portfolio.editPosition}</button>
        <button onClick={handleRemove} disabled={busy} className="text-muted-fg hover:text-negative text-xs disabled:opacity-40" title={t.portfolio.removePosition}>×</button>
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
        <p className="text-xs text-muted-fg">{t.portfolio.source}</p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const { t } = useLang()
  const [portfolioId, setPortfolioId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PortfolioDetail | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadDetail(id: string, cancelled: { value: boolean }) {
    const res = await fetch(`/api/portfolios/${id}`, { cache: 'no-store' })
    if (res.ok && !cancelled.value) {
      const json = await res.json()
      setDetail({ positions: json.positions ?? [], totals: json.totals, sectorExposure: json.sectorExposure ?? [] })
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

  return (
    <div className="w-full space-y-5">
      <SectionHeader
        tag={t.portfolio.tag}
        title={t.portfolio.title}
        subtitle={t.portfolio.subtitle}
        actions={
          portfolioId ? (
            <AddPositionForm portfolioId={portfolioId} onAdded={refresh} />
          ) : null
        }
      />

      {loading ? (
        <div className="bg-surface border border-border rounded px-5 py-8 text-center">
          <p className="text-xs text-muted-fg">Loading…</p>
        </div>
      ) : (
        <>
          {detail && <SummaryCards totals={detail.totals} />}
          {detail && detail.sectorExposure.length > 0 && (
            <SectorExposureList sectors={detail.sectorExposure} />
          )}
          <PositionsTable
            positions={detail?.positions ?? []}
            portfolioId={portfolioId ?? ''}
            onChanged={refresh}
          />
        </>
      )}
    </div>
  )
}
