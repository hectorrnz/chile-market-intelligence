'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SearchInput } from '@/components/ui/SearchInput'
import { useLang } from '@/components/providers/LangProvider'
import { getAllCompanies, getSectors } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { formatCLP, formatPct, formatLargeCLP, changeColor } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'
import { useMarketData } from '@/components/providers/MarketDataProvider'
import { stockOverlayCoverage, overlayStatus } from '@/lib/market/liveOverlay'
import { useGlobalRefresh } from '@/components/providers/useGlobalRefresh'
import { fetchStockSnapshots } from '@/lib/data/marketData'
import type { StockSnapshot } from '@/lib/providers/market/types'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { TableCard } from '@/components/fable/TableCard'
import { AsyncState } from '@/components/fable/AsyncState'
import { Reveal } from '@/components/fable/motion'
import type { DataSourceStatus } from '@/lib/providers/types'

type SortKey = 'ticker' | 'dayChangePct' | 'ytdChangePct' | 'marketCapCLP'

const companies    = getAllCompanies()
const snapshots    = getAllSnapshots()
const sectors      = getSectors()

export default function StocksPage() {
  const { t } = useLang()
  const [search,  setSearch]  = useState('')
  const [sector,  setSector]  = useState('')
  // The sort is DERIVED, not imperatively set. `userSort` is null until the
  // user actually clicks a column header; while null the table falls back to
  // "Day Chg. desc whenever live data is on screen". That ordering therefore
  // applies even when the refresh happened on a different tab and this page
  // mounted afterwards — the case a one-shot flag structurally cannot catch,
  // since there is no mounted component to receive it at refresh time.
  const [userSort, setUserSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null)
  // Live market snapshot is shared platform-wide (see MarketDataProvider) — Update
  // on any tab refreshes it, and it survives navigating away from this page.
  const { live, refreshSeq } = useMarketData()
  const refresh = useGlobalRefresh()
  // Supabase-persisted baseline (auto-loaded on mount, below live overlay in priority)
  const [supaSnapMap, setSupaSnapMap] = useState<Record<string, StockSnapshot>>({})

  useEffect(() => {
    let mounted = true
    fetchStockSnapshots().then(res => {
      if (mounted && res.data.length) {
        setSupaSnapMap(Object.fromEntries(res.data.map(s => [s.ticker, s])))
      }
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  // Render-time previous-value pattern (never an effect — see CLAUDE.md), and
  // critically only ever setState on THIS component: the earlier version
  // cleared a flag on MarketDataProvider from here, which React forbids
  // (updating a parent while rendering a child) and which silently broke the
  // auto-sort. A refresh landing while this page is open drops any manual
  // sort so the day's biggest movers surface again.
  const [seenSeq, setSeenSeq] = useState(refreshSeq)
  if (refreshSeq !== seenSeq) {
    setSeenSeq(refreshSeq)
    setUserSort(null)
  }

  const sortKey: SortKey = userSort?.key ?? (live ? 'dayChangePct' : 'marketCapCLP')
  const sortDir: 'asc' | 'desc' = userSort?.dir ?? 'desc'

  const snapMap = useMemo(
    () => Object.fromEntries(snapshots.map(s => [s.ticker, s])),
    [],
  )

  const rows = useMemo(() => {
    const q = search.toLowerCase()
    return companies
      .filter(c => !sector || c.sector === sector)
      .filter(c =>
        !q ||
        c.ticker.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.shortName.toLowerCase().includes(q),
      )
      .map(c => {
        const s = snapMap[c.ticker]
        const lv = live?.stocks[c.ticker]
        const ss = supaSnapMap[c.ticker]
        return {
          c,
          s,
          // Mirror the same live → persisted → static merge used for display below,
          // so sorting these two columns matches what's actually on screen.
          dayChangePct: lv?.dayChangePct ?? ss?.dayChangePct ?? s?.dayChangePct,
          marketCapCLP: lv?.marketCapCLP ?? ss?.marketCapCLP ?? c.marketCapCLP,
        }
      })
      .sort((a, b) => {
        if (sortKey === 'ticker') {
          const cmp = a.c.ticker.localeCompare(b.c.ticker)
          return sortDir === 'asc' ? cmp : -cmp
        }
        if (sortKey === 'dayChangePct' || sortKey === 'marketCapCLP') {
          const av = a[sortKey] ?? -Infinity
          const bv = b[sortKey] ?? -Infinity
          return sortDir === 'asc' ? av - bv : bv - av
        }
        const av = a.s != null ? ((a.s as unknown as Record<string, number | null | undefined>)[sortKey] ?? -Infinity) : -Infinity
        const bv = b.s != null ? ((b.s as unknown as Record<string, number | null | undefined>)[sortKey] ?? -Infinity) : -Infinity
        const an = av == null ? -Infinity : (av as number)
        const bn = bv == null ? -Infinity : (bv as number)
        return sortDir === 'asc' ? an - bn : bn - an
      })
  }, [search, sector, sortKey, sortDir, snapMap, live, supaSnapMap])

  // R12 — per-instrument live gating: the badge describes the rows actually on
  // screen, never the snapshot's mere existence. Only full coverage of the
  // displayed tickers may claim Live; a snapshot that missed some of them is
  // disclosed as a hybrid; zero coverage keeps the fallback layer's own word.
  // (One successful symbol must never make another failed symbol's fallback
  // row read as live — see liveOverlay.stockOverlayCoverage.)
  const fallbackStatus: DataSourceStatus = Object.keys(supaSnapMap).length ? 'persisted' : 'static'
  const coverage = stockOverlayCoverage(live?.stocks, rows.map(r => r.c.ticker))
  const priceStatus: DataSourceStatus = live ? overlayStatus(coverage, fallbackStatus) : fallbackStatus
  // One as-of for the page, always describing the data actually on screen: the
  // live snapshot's time only when at least one displayed row is actually
  // overlaid, otherwise the persisted snapshot's own date.
  const priceAsOf = live && coverage !== 'none' ? live.lastUpdated : (Object.values(supaSnapMap)[0]?.lastUpdated ?? null)

  function toggleSort(key: SortKey) {
    setUserSort(
      sortKey === key
        ? { key, dir: sortDir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    )
  }

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : ''

  // Sort state is announced, not inferred from the arrow glyph alone (a11y:
  // never meaning by colour or ornament alone). Sortable-but-inactive columns
  // report 'none' so a screen reader knows they are sortable at all.
  const ariaSort = (key: SortKey | null) =>
    !key ? undefined
      : sortKey === key ? (sortDir === 'asc' ? 'ascending' as const : 'descending' as const)
      : 'none' as const

  const handleExport = () => {
    exportCSV(
      'chilean_stocks',
      [
        t.stocks.cols.ticker, t.stocks.cols.company, t.stocks.cols.sector, t.stocks.cols.price,
        t.stocks.cols.dayChg, t.stocks.cols.ytd, t.stocks.cols.marketCap,
      ],
      rows.map(({ c, s }) => [
        c.ticker, c.shortName, c.sector, s?.price ?? '',
        s?.dayChangePct ?? '', s?.ytdChangePct ?? '', c.marketCapCLP ?? '',
      ]),
    )
  }

  // Column order is unchanged. `numeric` only drives alignment (Fable
  // right-aligns figures so tabular numerals line up) — it never changes which
  // columns exist, their order, or their sortability.
  const headers: { key: SortKey | null; label: string; numeric?: boolean }[] = [
    { key: 'ticker',        label: t.stocks.cols.ticker },
    { key: null,            label: t.stocks.cols.company },
    { key: null,            label: t.stocks.cols.sector },
    { key: null,            label: t.stocks.cols.price,     numeric: true },
    { key: 'dayChangePct',  label: t.stocks.cols.dayChg,    numeric: true },
    { key: 'ytdChangePct',  label: t.stocks.cols.ytd,       numeric: true },
    { key: 'marketCapCLP',  label: t.stocks.cols.marketCap, numeric: true },
    // R12: the P/E and Div. Yield columns are REMOVED, not restyled. Their
    // values in stockPrices.json are frozen Phase-2D synthetic ratios the
    // twice-daily refresh never rewrites (it touches only price/day/YTD), so
    // rendering them under this table's Yahoo Finance footer and live as-of
    // misattributed fabricated figures. Real, live P/E and dividend yield
    // remain on the Company page and Compare via resolveValuation.
  ]

  const cellPad = 'py-2.5 px-3 first:pl-4 last:pr-4'

  return (
    <div className="w-full">
      <Reveal>
        <SectionHeader
          tag={t.stocks.tag}
          title={t.stocks.title}
          subtitle={t.stocks.subtitle}
          actions={<UpdateDataButton onRefresh={refresh} />}
        />
      </Reveal>

      {/* 70ms stagger — the Fable section-reveal cadence. Both wrappers collapse
          to their final state under prefers-reduced-motion (globals.css §8), so
          no data is ever hidden behind an entrance animation. */}
      <Reveal delayMs={70}>
        <TableCard
          minWidth={760}
          controls={
            <div className="flex flex-wrap items-center gap-2.5 w-full">
              <div role="group" aria-label={t.stocks.filters} className="flex flex-wrap items-center gap-2.5 min-w-0">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder={t.common.search}
                  ariaLabel={t.common.search}
                  width={220}
                />
                <div className="relative shrink-0">
                  <select
                    value={sector}
                    onChange={e => setSector(e.target.value)}
                    aria-label={t.stocks.sectorFilter}
                    className="h-8 max-w-[200px] appearance-none rounded-full border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] pl-3 pr-8 text-xs text-foreground outline-none focus:border-accent nv-transition"
                  >
                    <option value="">{t.stocks.allSectors}</option>
                    {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-fg"
                  >
                    <polyline points="4,6.5 8,10.5 12,6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              <MarketDataSourceBadge status={priceStatus} className="ml-auto" />

              <button
                type="button"
                onClick={handleExport}
                className="inline-flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-full border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] text-xs text-muted-fg hover:text-foreground nv-transition"
              >
                <span aria-hidden>⤓</span>{t.common.exportCsv}
              </button>
            </div>
          }
          footer={
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <TableSourceFooter source={t.stocks.footer} asOf={priceAsOf} />
              <span className="ui-meta ui-number text-muted-fg" aria-live="polite">
                {rows.length} {t.common.companies}
              </span>
            </div>
          }
        >
          <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
            <caption className="sr-only">{t.stocks.title}</caption>
            <thead>
              <tr>
                {headers.map(({ key, label, numeric }) => (
                  <th
                    key={label}
                    scope="col"
                    aria-sort={ariaSort(key)}
                    // Sticky header sits on the near-opaque dense surface, never
                    // on low-opacity glass — column labels stay legible over
                    // scrolling rows (design_principles §8).
                    style={{ backgroundColor: 'var(--surface-table)' }}
                    className={[
                      cellPad, 'sticky top-0 z-10 border-b border-border',
                      numeric ? 'text-right' : 'text-left',
                    ].join(' ')}
                  >
                    {key ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        title={`${t.stocks.sortBy} ${label}`}
                        className="ui-table-header text-muted-fg hover:text-foreground nv-transition inline-flex items-center gap-1 whitespace-nowrap select-none"
                      >
                        {label}
                        {arrow(key) && <span aria-hidden="true">{arrow(key)}</span>}
                      </button>
                    ) : (
                      <span className="ui-table-header text-muted-fg whitespace-nowrap">{label}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, s }) => {
                const lv = live?.stocks[c.ticker]
                const ss = supaSnapMap[c.ticker]
                const price  = lv?.price        ?? ss?.price        ?? s?.price
                const dayPct = lv?.dayChangePct ?? ss?.dayChangePct ?? s?.dayChangePct
                const mktCap = lv?.marketCapCLP ?? ss?.marketCapCLP ?? c.marketCapCLP
                return (
                  <tr key={c.ticker} className="border-b border-border last:border-0 nv-row-hover nv-transition">
                    <td className={cellPad}>
                      <Link href={`/companies/${c.ticker}`} className="font-mono text-primary hover:underline">{c.ticker}</Link>
                    </td>
                    <td className={`${cellPad} text-foreground`}>{c.shortName}</td>
                    <td className={`${cellPad} text-muted-fg`}>{c.sector}</td>
                    <td className={`${cellPad} text-right ui-number text-foreground`}>{price != null ? formatCLP(price) : '—'}</td>
                    <td className={`${cellPad} text-right ui-number ${dayPct != null ? changeColor(dayPct) : 'text-muted-fg'}`}>
                      {dayPct != null ? formatPct(dayPct) : '—'}
                    </td>
                    <td className={`${cellPad} text-right ui-number ${s?.ytdChangePct != null ? changeColor(s.ytdChangePct) : 'text-muted-fg'}`}>
                      {s?.ytdChangePct != null ? formatPct(s.ytdChangePct) : '—'}
                    </td>
                    <td className={`${cellPad} text-right ui-number text-foreground`}>
                      {mktCap ? formatLargeCLP(mktCap) : '—'}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  {/* The filtered-to-nothing state keeps its own precise wording
                      (`noResults`), rendered through the shared AsyncState so it
                      can never be confused with "loading" or "failed". */}
                  <td colSpan={headers.length} className="p-0">
                    <AsyncState kind="empty" message={t.common.noResults} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableCard>
      </Reveal>
    </div>
  )
}
