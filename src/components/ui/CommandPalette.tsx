'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { getAllCompanies } from '@/lib/data/companies'

interface Item { ticker: string; label: string; sub: string }

const THREE_DAYS = 3 * 24 * 60 * 60 * 1000

export function CommandPalette() {
  const router = useRouter()
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recent, setRecent] = usePersistentState<{ ticker: string; ts: number }[]>('cmi.recentSearches', [])
  const inputRef = useRef<HTMLInputElement>(null)

  const companies = useMemo<Item[]>(
    () => getAllCompanies().map(c => ({ ticker: c.ticker, label: `${c.ticker} · ${c.shortName}`, sub: c.sector })),
    [],
  )
  const byTicker = useMemo(() => Object.fromEntries(companies.map(c => [c.ticker, c])), [companies])

  // Stale entries are pruned on write (see `select`); here we only drop tickers
  // that no longer exist, so render stays pure (no Date.now()).
  const validRecent = recent.filter(r => byTicker[r.ticker])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return companies.filter(c => `${c.label} ${c.sub}`.toLowerCase().includes(q)).slice(0, 40)
  }, [companies, query])

  // Visible list: search results when typing, otherwise recent searches
  const recentItems = validRecent.map(r => byTicker[r.ticker]).filter(Boolean) as Item[]
  const visible = query.trim() ? filtered : recentItems

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) }
      else if (e.key === '/' && !typing && !open) { e.preventDefault(); setOpen(true) }
      else if (e.key === 'Escape') setOpen(false)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('cmdk:open', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('cmdk:open', onOpen) }
  }, [open])

  // Reset the highlighted row whenever the query changes (render-time, not an effect).
  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) { setPrevQuery(query); setActive(0) }

  // Reset query + selection when the palette opens (render-time, not an effect).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) { setPrevOpen(open); if (open) { setQuery(''); setActive(0) } }

  // Focus the input when opened — a DOM side-effect, so it stays in an effect.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [open])

  const select = (ticker: string) => {
    const now = Date.now()
    const next = [
      { ticker, ts: now },
      ...recent.filter(r => r.ticker !== ticker && now - r.ts < THREE_DAYS),
    ].slice(0, 8)
    setRecent(next)
    setOpen(false)
    router.push(`/companies/${ticker}`)
  }

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, visible.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (visible[active]) select(visible[active].ticker) }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      style={{ backgroundColor: 'color-mix(in oklab, var(--foreground) 35%, transparent)' }}
      onClick={() => setOpen(false)}
    >
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <span className="text-muted-fg text-sm">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onListKey}
            placeholder={t.common.search}
            className="flex-1 bg-transparent outline-none py-3 text-sm text-foreground placeholder:text-muted-fg"
          />
          <kbd className="text-xs text-muted-fg border border-border rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1">
          {!query.trim() && recentItems.length > 0 && (
            <div className="px-3 pt-2 pb-1 ui-label text-muted-fg">{t.commandk.recent}</div>
          )}
          {visible.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-fg">
              {query.trim() ? t.common.noResults : t.commandk.recentEmpty}
            </div>
          )}
          {visible.map((item, i) => (
            <button
              key={item.ticker}
              onMouseEnter={() => setActive(i)}
              onClick={() => select(item.ticker)}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 ${i === active ? 'bg-surface-2' : ''}`}
            >
              <span className="text-sm text-foreground truncate"><span className="font-mono text-primary">{item.ticker}</span> <span className="text-muted-fg">· {item.label.split('· ')[1]}</span></span>
              <span className="text-xs text-muted-fg truncate shrink-0 max-w-[40%]">{item.sub}</span>
            </button>
          ))}
        </div>

        <div className="px-3 py-2 border-t border-border flex items-center gap-3 text-xs text-muted-fg">
          <span><kbd className="border border-border rounded px-1">↑</kbd> <kbd className="border border-border rounded px-1">↓</kbd> {t.commandk.navigate}</span>
          <span><kbd className="border border-border rounded px-1">↵</kbd> {t.commandk.open}</span>
          <span className="ml-auto"><kbd className="border border-border rounded px-1">⌘K</kbd></span>
        </div>
      </div>
    </div>
  )
}
