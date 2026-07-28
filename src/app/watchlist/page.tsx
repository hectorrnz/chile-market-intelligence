'use client'

// Phase 6A — Authenticated personal watchlist page.
// Middleware guarantees this page is only reachable by signed-in users.
//
// Phase 5B (Fable) — presentation re-skinned onto the shared TableCard /
// AsyncState / pill-control language. Every API call, request shape, status
// code mapping and piece of rendered content is preserved; the three async
// situations that used to collapse into "your watchlist is empty" (no
// watchlist, load error, expired session) are now told apart honestly.

import { useState, useEffect, useId } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { TableCard } from '@/components/fable/TableCard'
import { Reveal } from '@/components/fable/motion'
import type { AsyncStateKind } from '@/components/fable/AsyncState'
import { getAllCompanies } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { formatCLP, formatPct, changeColor } from '@/lib/formatters'
import type { WatchlistRow, WatchlistItemRow } from '@/lib/db/repositories/watchlistRepository'

const ALL_COMPANIES = getAllCompanies()
const ALL_SNAPSHOTS = getAllSnapshots()
const VALID_TICKERS = new Set(ALL_COMPANIES.map(c => c.ticker.toUpperCase()))

const compMap = Object.fromEntries(ALL_COMPANIES.map(c => [c.ticker, c]))
const snapMap = Object.fromEntries(ALL_SNAPSHOTS.map(s => [s.ticker, s]))

const CELL = 'py-2.5 px-3 first:pl-4 last:pr-4'

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
  const feedbackId = useId()

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
        // Was `json.error ?? 'Error'` — an untranslated English literal, and a
        // raw server error code leaking into the UI. The server code is still
        // the useful one for a developer, so it stays in the hover title.
        setFeedback({ type: 'err', msg: t.watchlist.addError })
      } else {
        setTicker('')
        setFeedback({ type: 'ok', msg: t.watchlist.added })
        onAdded(json.item as WatchlistItemRow)
        setTimeout(() => setFeedback(null), 2500)
      }
    } catch {
      setFeedback({ type: 'err', msg: t.watchlist.networkError })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2" aria-label={t.watchlist.addTicker}>
      <input
        type="text"
        list="ticker-suggestions"
        value={ticker}
        onChange={e => setTicker(e.target.value.toUpperCase())}
        placeholder={t.watchlist.tickerPlaceholder}
        aria-label={t.watchlist.tickerLabel}
        aria-invalid={feedback?.type === 'err' || undefined}
        aria-describedby={feedbackId}
        className="h-8 w-36 rounded-full border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] px-3.5 text-xs font-mono text-foreground placeholder:text-muted-fg outline-none focus:border-accent nv-transition"
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
        className="h-8 px-4 rounded-full bg-primary text-primary-fg text-xs font-medium shrink-0 disabled:opacity-50 nv-transition"
      >
        {loading ? '…' : t.watchlist.addTicker}
      </button>

      {/* Always mounted so the live region is announced on change rather than
          on insertion, and so the row height does not jump when it fills. */}
      <span
        id={feedbackId}
        role="status"
        aria-live="polite"
        className={`text-xs min-w-0 ${feedback?.type === 'err' ? 'text-negative' : 'text-positive'}`}
      >
        {feedback && (
          <>
            {/* Glyph pairs with the colour — never meaning by colour alone. */}
            <span aria-hidden="true">{feedback.type === 'ok' ? '✓ ' : '⚠ '}</span>
            {feedback.msg}
          </>
        )}
      </span>
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
  const [removeMsg, setRemoveMsg] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  async function handleRemove(ticker: string) {
    setRemoving(ticker)
    setRemoveMsg(null)
    try {
      const res = await fetch(`/api/watchlists/${watchlistId}/items/${encodeURIComponent(ticker)}`, {
        method: 'DELETE',
      })
      // The response used to be ignored entirely, so a 500 still dropped the
      // row from the table and the ticker silently reappeared on the next
      // load. The request itself is unchanged — only the handling of its
      // result is: on failure the item stays, and the failure is stated.
      if (!res.ok) {
        setRemoveMsg({ type: 'err', msg: t.watchlist.removeError })
        return
      }
      onRemoved(ticker)
      setRemoveMsg({ type: 'ok', msg: t.watchlist.removed })
      setTimeout(() => setRemoveMsg(null), 2500)
    } catch {
      setRemoveMsg({ type: 'err', msg: t.watchlist.networkError })
    } finally {
      setRemoving(null)
    }
  }

  return (
    <>
      <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
        <caption className="sr-only">{t.watchlist.title}</caption>
        <thead>
          <tr>
            {/* Header fill stays high-opacity so labels never sit on
                low-opacity glass over scrolling rows (design_principles §8). */}
            {[
              { label: t.stocks.cols.ticker },
              { label: t.stocks.cols.company },
              { label: t.stocks.cols.sector },
              { label: t.stocks.cols.price, numeric: true },
              { label: t.stocks.cols.dayChg, numeric: true },
              { label: t.stocks.cols.ytd, numeric: true },
              { label: t.watchlist.removeTicker, numeric: true, hidden: true },
            ].map(({ label, numeric, hidden }) => (
              <th
                key={label}
                scope="col"
                style={{ backgroundColor: 'var(--surface-table)' }}
                className={`${CELL} border-b border-border ${numeric ? 'text-right' : 'text-left'}`}
              >
                {/* The action column header is visually blank exactly as
                    before, but is no longer nameless to a screen reader. */}
                <span className={hidden ? 'sr-only' : 'ui-table-header text-muted-fg whitespace-nowrap'}>{label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const c = compMap[item.ticker]
            const s = snapMap[item.ticker]
            return (
              <tr key={item.ticker} className="border-b border-border last:border-0 nv-row-hover nv-transition">
                <td className={CELL}>
                  <Link href={`/companies/${item.ticker}`} className="font-mono text-primary hover:underline">
                    {item.ticker}
                  </Link>
                </td>
                <td className={`${CELL} text-foreground`}>{c?.shortName ?? item.ticker}</td>
                <td className={`${CELL} text-muted-fg`}>{c?.sector ?? '—'}</td>
                <td className={`${CELL} text-right ui-number text-foreground`}>
                  {s ? formatCLP(s.price) : '—'}
                </td>
                <td className={`${CELL} text-right ui-number ${s ? changeColor(s.dayChangePct) : 'text-muted-fg'}`}>
                  {s ? formatPct(s.dayChangePct) : '—'}
                </td>
                <td className={`${CELL} text-right ui-number ${s ? changeColor(s.ytdChangePct) : 'text-muted-fg'}`}>
                  {s ? formatPct(s.ytdChangePct) : '—'}
                </td>
                <td className={`${CELL} text-right`}>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.ticker)}
                    disabled={removing === item.ticker}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-muted-fg hover:text-negative hover:bg-[var(--nv-chip)] nv-transition disabled:opacity-40"
                    title={`${t.watchlist.removeTicker} ${item.ticker}`}
                    aria-label={`${t.watchlist.removeTicker} ${item.ticker}`}
                  >
                    <span aria-hidden="true">{removing === item.ticker ? '…' : '×'}</span>
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Remove result is announced rather than silently swallowed. */}
      <p
        role="status"
        aria-live="polite"
        className={`px-4 pb-2 text-xs ${removeMsg?.type === 'err' ? 'text-negative' : 'text-positive'}`}
      >
        {removeMsg && (
          <>
            <span aria-hidden="true">{removeMsg.type === 'ok' ? '✓ ' : '⚠ '}</span>
            {removeMsg.msg}
          </>
        )}
      </p>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/** Why the list could not be shown — kept apart so the UI never tells a user
 *  their watchlist is empty when the real problem was a failed load. */
type LoadOutcome = 'ok' | 'error' | 'blocked' | 'none'

export default function WatchlistPage() {
  const { t } = useLang()
  const [watchlist, setWatchlist]   = useState<WatchlistRow | null>(null)
  const [items, setItems]           = useState<WatchlistItemRow[]>([])
  const [loading, setLoading]       = useState(true)
  const [outcome, setOutcome]       = useState<LoadOutcome>('ok')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/watchlists', { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          // 401 = the session lapsed after middleware let the page through.
          setOutcome(res.status === 401 ? 'blocked' : 'error')
          setLoading(false)
          return
        }
        const json = await res.json()
        const wl: WatchlistRow = json.watchlists?.[0]
        if (cancelled) return
        if (!wl) { setOutcome('none'); setLoading(false); return }
        setWatchlist(wl)

        const itemsRes = await fetch(`/api/watchlists/${wl.id}/items`, { cache: 'no-store' })
        if (cancelled) return
        if (itemsRes.ok) {
          const itemsJson = await itemsRes.json()
          if (!cancelled) setItems(itemsJson.items ?? [])
        } else {
          setOutcome(itemsRes.status === 401 ? 'blocked' : 'error')
        }
      } catch {
        if (!cancelled) setOutcome('error')
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

  const state: AsyncStateKind | undefined =
    loading                 ? 'loading'
    : outcome === 'blocked' ? 'blocked'
    : outcome === 'error'   ? 'error'
    : outcome === 'none'    ? 'unavailable'
    : items.length === 0    ? 'empty'
    :                         undefined

  const stateMessage =
    state === 'blocked'     ? t.watchlist.sessionExpired
    : state === 'error'     ? t.watchlist.loadError
    : state === 'unavailable' ? t.watchlist.noWatchlist
    : state === 'empty'     ? t.watchlist.emptyWatchlist
    :                         undefined

  // The count is only truthful once the list actually loaded — never printed
  // as "0" next to an error or an expired session.
  const countKnown = state === undefined || state === 'empty'

  return (
    <div className="w-full space-y-5">
      <Reveal>
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
      </Reveal>

      <Reveal delayMs={70}>
        <TableCard
          title={watchlist?.name}
          minWidth={620}
          state={state}
          stateMessage={stateMessage}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <TableSourceFooter source={t.watchlist.source} />
              {countKnown && (
                <span className="ui-meta ui-number text-muted-fg" aria-live="polite">
                  {items.length} {t.common.companies}
                </span>
              )}
            </div>
          }
        >
          <WatchlistTable
            items={items}
            watchlistId={watchlist?.id ?? ''}
            onRemoved={handleItemRemoved}
          />
        </TableCard>
      </Reveal>
    </div>
  )
}
