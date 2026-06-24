'use client'

import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { StatusPill } from '@/components/ui/StatusPill'
import { getAllCompanies } from '@/lib/data/companies'
import { getAllSnapshots } from '@/lib/data/stocks'
import { formatCLP, formatPct, formatLargeCLP, changeColor } from '@/lib/formatters'

const PREVIEW_TICKERS = ['BSANTANDER', 'SQM-B', 'FALABELLA', 'COPEC', 'LTM']

const companies  = getAllCompanies()
const snapshots  = getAllSnapshots()

export default function WatchlistPage() {
  const { t } = useLang()

  const snapMap  = Object.fromEntries(snapshots.map(s => [s.ticker, s]))
  const compMap  = Object.fromEntries(companies.map(c => [c.ticker, c]))

  const preview = PREVIEW_TICKERS.map(tk => ({
    company: compMap[tk],
    snap:    snapMap[tk],
    ticker:  tk,
  }))

  return (
    <div className="w-full space-y-5">
      <SectionHeader
        tag={t.watchlist.tag}
        title={t.watchlist.title}
        subtitle={t.watchlist.subtitle}
        actions={<StatusPill label={t.watchlist.pill} variant="soon" />}
      />

      {/* Phase notice */}
      <div className="bg-surface border border-border rounded px-5 py-4 flex items-start gap-4">
        <div className="flex-1">
          <div className="ui-label text-muted-fg mb-1.5">{t.watchlist.notAvail}</div>
          <p className="text-xs text-muted leading-relaxed max-w-lg">{t.watchlist.desc}</p>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <StatusPill label={t.watchlist.phase5} variant="soon" />
          <StatusPill label={t.watchlist.phase6} variant="soon" />
        </div>
      </div>

      {/* Mock preview table */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-surface-2 flex items-center justify-between">
          <span className="ui-label text-muted-fg">{t.watchlist.mockPreview}</span>
          <StatusPill label={t.common.mvpNote} variant="neutral" />
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.stocks.cols.ticker}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.company}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.sector}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.price}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.dayChg}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.ytd}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.stocks.cols.marketCap}</th>
              <th className="text-right py-2.5 px-3 pr-4 ui-table-header text-muted-fg">{t.stocks.cols.pe}</th>
            </tr>
          </thead>
          <tbody>
            {preview.map(({ ticker, company: c, snap: s }) => (
              <tr key={ticker} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                <td className="py-2.5 pl-4 pr-3">
                  <Link href={`/companies/${ticker}`} className="font-mono text-primary hover:underline">
                    {ticker}
                  </Link>
                </td>
                <td className="py-2.5 px-3 text-foreground">{c?.shortName ?? ticker}</td>
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
                <td className="py-2.5 px-3 text-right ui-number text-foreground">
                  {c?.marketCapCLP ? formatLargeCLP(c.marketCapCLP) : '—'}
                </td>
                <td className="py-2.5 px-3 pr-4 text-right ui-number text-foreground">
                  {s?.pe != null ? `${s.pe}x` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-border bg-surface">
          <p className="text-xs text-muted-fg">{t.home.stocksSource}</p>
        </div>
      </div>
    </div>
  )
}
