'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SearchInput } from '@/components/ui/SearchInput'
import { useLang } from '@/components/providers/LangProvider'
import { getAllCompanies, getSectors } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { formatCLP, formatPct, formatLargeCLP, changeColor } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'
import { fetchLiveSnapshot, type LiveSnapshot } from '@/lib/data/marketLiveData'
import { fetchStockSnapshots } from '@/lib/data/marketData'
import type { StockSnapshot } from '@/lib/providers/market/types'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import type { DataSourceStatus } from '@/lib/providers/types'

type SortKey = 'ticker' | 'dayChangePct' | 'ytdChangePct' | 'marketCapCLP' | 'pe' | 'dividendYield'

const companies    = getAllCompanies()
const snapshots    = getAllSnapshots()
const sectors      = getSectors()

export default function StocksPage() {
  const { t } = useLang()
  const [search,  setSearch]  = useState('')
  const [sector,  setSector]  = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('marketCapCLP')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [live, setLive] = useState<LiveSnapshot | null>(null)
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

  const doRefresh = useCallback(async () => {
    const data = await fetchLiveSnapshot()
    if (!data) throw new Error('unavailable')
    setLive(data)
  }, [])

  const priceStatus: DataSourceStatus = live ? 'live' : Object.keys(supaSnapMap).length ? 'persisted' : 'static'
  // One as-of for the page, always describing the data actually on screen:
  // the live snapshot when refreshed, otherwise the persisted snapshot's own date.
  const priceAsOf = live ? live.lastUpdated : (Object.values(supaSnapMap)[0]?.lastUpdated ?? null)

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

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const arrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const handleExport = () => {
    exportCSV(
      'chilean_stocks',
      [
        t.stocks.cols.ticker, t.stocks.cols.company, t.stocks.cols.sector, t.stocks.cols.price,
        t.stocks.cols.dayChg, t.stocks.cols.ytd, t.stocks.cols.marketCap, t.stocks.cols.pe, t.stocks.cols.divYield,
      ],
      rows.map(({ c, s }) => [
        c.ticker, c.shortName, c.sector, s?.price ?? '',
        s?.dayChangePct ?? '', s?.ytdChangePct ?? '', c.marketCapCLP ?? '', s?.pe ?? '', s?.dividendYield ?? '',
      ]),
    )
  }

  const headers: { key: SortKey | null; label: string }[] = [
    { key: 'ticker',        label: t.stocks.cols.ticker },
    { key: null,            label: t.stocks.cols.company },
    { key: null,            label: t.stocks.cols.sector },
    { key: null,            label: t.stocks.cols.price },
    { key: 'dayChangePct',  label: t.stocks.cols.dayChg },
    { key: 'ytdChangePct',  label: t.stocks.cols.ytd },
    { key: 'marketCapCLP',  label: t.stocks.cols.marketCap },
    { key: 'pe',            label: t.stocks.cols.pe },
    { key: 'dividendYield', label: t.stocks.cols.divYield },
  ]

  return (
    <div className="w-full">
      <SectionHeader
        tag={t.stocks.tag}
        title={t.stocks.title}
        subtitle={t.stocks.subtitle}
        actions={<UpdateDataButton onRefresh={doRefresh} />}
      />

      <div className="flex items-center gap-2.5 mb-4 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder={t.common.search} width={220} />
        <select
          value={sector}
          onChange={e => setSector(e.target.value)}
          className="h-7 bg-surface border border-border rounded px-2 text-xs text-foreground outline-none focus:border-accent"
        >
          <option value="">{t.stocks.allSectors}</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <MarketDataSourceBadge status={priceStatus} />
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded border border-border bg-surface text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
        >
          <span aria-hidden>⤓</span>{t.common.exportCsv}
        </button>
      </div>

      <div className="bg-surface border border-border rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              {headers.map(({ key, label }) => (
                <th
                  key={label}
                  onClick={key ? () => toggleSort(key) : undefined}
                  className={[
                    'text-left py-2.5 px-3 first:pl-4 ui-table-header text-muted-fg sticky top-0 z-10 bg-surface-2',
                    key ? 'cursor-pointer hover:text-foreground select-none' : '',
                  ].join(' ')}
                >
                  {label}{key ? arrow(key) : ''}
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
                <tr key={c.ticker} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="py-2.5 pl-4 pr-3">
                    <Link href={`/companies/${c.ticker}`} className="font-mono text-primary hover:underline">{c.ticker}</Link>
                  </td>
                  <td className="py-2.5 px-3 text-foreground">{c.shortName}</td>
                  <td className="py-2.5 px-3 text-muted-fg">{c.sector}</td>
                  <td className="py-2.5 px-3 ui-number text-foreground">{price != null ? formatCLP(price) : '—'}</td>
                  <td className={`py-2.5 px-3 ui-number ${dayPct != null ? changeColor(dayPct) : 'text-muted-fg'}`}>
                    {dayPct != null ? formatPct(dayPct) : '—'}
                  </td>
                  <td className={`py-2.5 px-3 ui-number ${s?.ytdChangePct != null ? changeColor(s.ytdChangePct) : 'text-muted-fg'}`}>
                    {s?.ytdChangePct != null ? formatPct(s.ytdChangePct) : '—'}
                  </td>
                  <td className="py-2.5 px-3 ui-number text-foreground">
                    {mktCap ? formatLargeCLP(mktCap) : '—'}
                  </td>
                  <td className="py-2.5 px-3 ui-number text-foreground">
                    {s?.pe != null ? `${s.pe}x` : '—'}
                  </td>
                  <td className="py-2.5 px-3 ui-number text-foreground">
                    {s?.dividendYield != null ? `${s.dividendYield}%` : '—'}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="py-6 text-center text-xs text-muted-fg">{t.common.noResults}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between bg-surface">
          <TableSourceFooter source={t.stocks.footer} asOf={priceAsOf} />
          <span className="text-xs ui-number text-muted-fg">{rows.length} {t.common.companies}</span>
        </div>
      </div>
    </div>
  )
}
