'use client'

// Phase 6A — Authenticated personal watchlist page.
// Middleware guarantees this page is only reachable by signed-in users.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { getAllCompanies } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { formatCLP, formatPct, changeColor } from '@/lib/formatters'
import type { WatchlistRow, WatchlistItemRow } from '@/lib/db/repositories/watchlistRepository'

const ALL_COMPANIES = getAllCompanies()
const ALL_SNAPSHOTS = getAllSnapshots()
const VALID_TICKERS = new Set(ALL_COMPANIES.map(c => c.ticker.toUpperCase()))

const compMap = Object.fromEntries(ALL_COMPANIES.map(c => [c.ticker, c]))
const snapMap = Object.fromEntries(ALL_SNAPSHOTS.map(s => [s.ticker, s]))

// ─── Add-ticker form ──────────────────────────────────────────────────────────

function AddTickerForm({
  watchlistId,
  onAdded,
}: {
  watchlistId: string
  onAdded: (item: WatchlistItemRow) => void
}) {
  const { t } = useLang()
  const [ticker, setTicker]   = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const upper = ticker.trim().toUpperCase()
    if (!upper) return

    if (!VALID_TICKERS.has(upper)) {
      setFeedback({ type: 'err', msg: t.watchlist.invalidTicker })
      return
    }

    setLoading(true)
    setFeedback(null)

    try {
      const res = await fetch(`/api/watchlists/${watchlistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: upper }),
      })
      const json = await res.json()

      if (res.status === 409) {
        setFeedback({ type: 'err', msg: t.watchlist.duplicate })
      } else if (res.status === 422) {
        setFeedback({ type: 'err', msg: t.watchlist.invalidTicker })
      } else if (!res.ok) {
        setFeedback({ type: 'err', msg: json.error ?? 'Error' })
      } else {
        setTicker('')
        setFeedback({ type: 'ok', msg: t.watchlist.added })
        onAdded(json.item as WatchlistItemRow)
        setTimeout(() => setFeedback(null), 2500)
      }
    } catch {
      setFeedback({ type: 'err', msg: 'Network error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleAdd} className="flex items-center gap-2">
      <input
        type="text"
        list="ticker-suggestions"
        value={ticker}
        onChange={e => setTicker(e.target.value.toUpperCase())}
        placeholder={t.watchlist.tickerPlaceholder}
        className="h-8 px-3 rounded border border-border bg-surface-2 text-xs font-mono text-foreground placeholder:text-muted focus:outline-none focus:border-accent w-36"
        autoComplete="off"
        spellCheck={false}
      />
      <datalist id="ticker-suggestions">
        {ALL_COMPANIES.map(c => (
          <option key={c.ticker} value={c.ticker}>{c.shortName}</option>
        ))}
      </datalist>

      <button
        type="submit"
        disabled={loading || !ticker.trim()}
        className="h-8 px-3 rounded bg-primary text-surface text-xs font-medium disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--primary)' }}
      >
        {loading ? '…' : t.watchlist.addTicker}
      </button>

      {feedback && (
        <span className={`text-xs ${feedback.type === 'ok' ? 'text-positive' : 'text-negative'}`}>
          {feedback.msg}
        </span>
      )}
    </form>
  )
}

// ─── Watchlist table ──────────────────────────────────────────────────────────

function WatchlistTable({
  items,
  watchlistId,
  onRemoved,
}: {
  items: WatchlistItemRow[]
  watchlistId: string
  onRemoved: (ticker: string) => void
}) {
  const { t } = useLang()
  const [removing, setRemoving] = useState<string | null>(null)

  async function handleRemove(ticker: string) {
    setRemoving(ticker)
    try {
      await fetch(`/api/watchlists/${watchlistId}/items/${encodeURIComponent(ticker)}`, {
        method: 'DELETE',
      })
      onRemoved(ticker)
    } catch {
      // ignore — item stays in list
    } finally {
      setRemoving(null)
    }
  }

  if (items.length === 0) {
    return (
      <div className="bg-surface border border-border rounded px-5 py-8 text-center">
        <p className="text-xs text-muted-fg">{t.watchlist.emptyWatchlist}</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded overflow-x-auto">
      <table className="w-full text-xs min-w-[620px]">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.stocks.cols.ticker}</th>
            <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.company}</th>
            <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.sector}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.price}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.dayChg}</th>
            <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.ytd}</th>
            <th className="text-right py-2.5 pr-4 px-3 ui-table-header text-muted-fg"></th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const c = compMap[item.ticker]
            const s = snapMap[item.ticker]
            return (
              <tr key={item.ticker} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                <td className="py-2.5 pl-4 pr-3">
                  <Link href={`/companies/${item.ticker}`} className="font-mono text-primary hover:underline">
                    {item.ticker}
                  </Link>
                </td>
                <td className="py-2.5 px-3 text-foreground">{c?.shortName ?? item.ticker}</td>
                <td className="py-2.5 px-3 text-muted-fg">{c?.sector ?? '—'}</td>
                <td className="py-2.5 px-3 text-right ui-number text-foreground">
                  {s ? formatCLP(s.price) : '—'}
                </td>
                <td className={`py-2.5 px-3 text-right ui-number ${s ? changeColor(s.dayChangePct) : 'text-muted-fg'}`}>
                  {s ? formatPct(s.dayChangePct) : '—'}
                </td>
                <td className={`py-2.5 px-3 text-right ui-number ${s ? changeColor(s.ytdChangePct) : 'text-muted-fg'}`}>
                  {s ? formatPct(s.ytdChangePct) : '—'}
                </td>
                <td className="py-2.5 px-3 pr-4 text-right">
                  <button
                    onClick={() => handleRemove(item.ticker)}
                    disabled={removing === item.ticker}
                    className="text-muted-fg hover:text-negative text-xs transition-colors disabled:opacity-40"
                    title={t.watchlist.removeTicker}
                  >
                    {removing === item.ticker ? '…' : '×'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="px-4 py-2 border-t border-border bg-surface">
        <TableSourceFooter source={t.watchlist.source} />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const { t } = useLang()
  const [watchlist, setWatchlist]   = useState<WatchlistRow | null>(null)
  const [items, setItems]           = useState<WatchlistItemRow[]>([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/watchlists', { cache: 'no-store' })
        if (!res.ok || cancelled) { setLoading(false); return }
        const json = await res.json()
        const wl: WatchlistRow = json.watchlists?.[0]
        if (!wl || cancelled) { setLoading(false); return }
        setWatchlist(wl)

        const itemsRes = await fetch(`/api/watchlists/${wl.id}/items`, { cache: 'no-store' })
        if (itemsRes.ok && !cancelled) {
          const itemsJson = await itemsRes.json()
          setItems(itemsJson.items ?? [])
        }
      } catch {
        // network error — leave loading state, show empty
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  function handleItemAdded(item: WatchlistItemRow) {
    setItems(prev => [...prev, item])
  }

  function handleItemRemoved(ticker: string) {
    setItems(prev => prev.filter(i => i.ticker !== ticker))
  }

  return (
    <div className="w-full space-y-5">
      <SectionHeader
        tag={t.watchlist.tag}
        title={t.watchlist.title}
        subtitle={t.watchlist.subtitle}
        actions={
          watchlist ? (
            <AddTickerForm watchlistId={watchlist.id} onAdded={handleItemAdded} />
          ) : null
        }
      />

      {loading ? (
        <div className="bg-surface border border-border rounded px-5 py-8 text-center">
          <p className="text-xs text-muted-fg">Loading…</p>
        </div>
      ) : (
        <WatchlistTable
          items={items}
          watchlistId={watchlist?.id ?? ''}
          onRemoved={handleItemRemoved}
        />
      )}
    </div>
  )
}
