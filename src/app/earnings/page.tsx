'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MarketDataSourceBadge } from '@/components/ui/MarketDataSourceBadge'
import { UpdateDataButton } from '@/components/ui/UpdateDataButton'
import { useLang } from '@/components/providers/LangProvider'
import { useGlobalRefresh } from '@/components/providers/useGlobalRefresh'
import { fetchEarningsCalendar, upcomingWithinDays, type EarningsCalendarResult } from '@/lib/data/earningsCalendar'
import { fetchEarningsResults, type EarningsResultsPayload } from '@/lib/data/earningsResults'
import { formatPct, changeColor } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'

/** Millions of the row's own reporting currency (Yahoo reports some issuers in USD). */
function fmtMM(v: number | null): string {
  if (v == null) return '—'
  return v.toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/**
 * EPS in the row's reporting currency. Issuers reporting in USD with very large
 * share counts (LATAM, Enel Américas, Colbún) have a sub-cent EPS that rounds to
 * a useless "0,00" at 2dp — those get 4dp so a real figure is shown rather than
 * an apparent zero.
 */
function fmtEps(v: number | null): string {
  if (v == null) return '—'
  const d = Math.abs(v) < 1 ? 4 : 2
  return v.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function EarningsPage() {
  const { t } = useLang()
  const refreshAll = useGlobalRefresh()

  const [cal, setCal] = useState<EarningsCalendarResult | null>(null)
  const [results, setResults] = useState<EarningsResultsPayload | null>(null)
  const [loading, setLoading] = useState(true)

  // Inline promise chain (not a named helper called from the effect body) so
  // every setState lands in a callback — the shape the React Compiler rules
  // require, and the same one Home uses for its mount fetches.
  useEffect(() => {
    let mounted = true
    Promise.all([
      fetchEarningsCalendar().catch(() => null),
      fetchEarningsResults(false).catch(() => null),
    ]).then(([c, r]) => {
      if (!mounted) return
      if (c) setCal(c)
      if (r) setResults(r)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  // Update Data: refresh every live domain, then force-refetch this tab's own
  // data past the resolver's 6h cache.
  const refreshEarnings = useCallback(async () => {
    setLoading(true)
    await refreshAll()
    const [c, r] = await Promise.all([
      fetchEarningsCalendar().catch(() => null),
      fetchEarningsResults(true).catch(() => null),
    ])
    if (c) setCal(c)
    if (r) setResults(r)
    setLoading(false)
  }, [refreshAll])

  // Upcoming = real CMF EEFF-sending dates (next 45 days), replacing the old
  // static sample. Absolute dates, so the window is always computed live.
  const upcoming = cal?.status === 'live' ? upcomingWithinDays(cal.events, 45) : []
  const rows = results?.rows ?? []
  const live = results?.status === 'live'

  const handleExport = () => {
    exportCSV(
      'earnings_recent_results',
      [
        t.earnings.calCols.ticker, t.earnings.cols.company, t.earnings.cols.period, t.earnings.currency,
        t.earnings.cols.revenue, t.earnings.cols.revenueYoy, t.earnings.cols.ebitda, t.earnings.cols.ebitdaYoy,
        t.earnings.cols.netIncome, t.earnings.cols.netIncomeYoy, t.earnings.cols.eps,
      ],
      rows.map(e => [
        e.ticker, e.companyName, e.period, e.currency,
        e.revenue ?? '', e.revenueYoY ?? '', e.ebitda ?? '', e.ebitdaYoY ?? '',
        e.netIncome ?? '', e.netIncomeYoY ?? '', e.eps ?? '',
      ]),
    )
  }

  const pctCell = (v: number | null) => (
    <td className={`py-2.5 px-3 text-right ui-number ${v != null ? changeColor(v) : 'text-muted-fg'}`}>
      {v != null ? formatPct(v) : '—'}
    </td>
  )

  return (
    <div className="w-full space-y-5">
      <SectionHeader
        tag={t.earnings.tag}
        title={t.earnings.title}
        subtitle={t.earnings.subtitle}
        actions={<UpdateDataButton onRefresh={refreshEarnings} />}
      />

      {/* Upcoming — real CMF report dates */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-surface-2 flex items-center gap-2">
          <span className="ui-label text-muted-fg">{t.earnings.upcomingLabel}</span>
          <MarketDataSourceBadge status={cal?.status === 'live' ? 'live' : 'static'} />
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.earnings.calCols.ticker}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.calCols.period}</th>
              <th className="text-left py-2.5 px-3 pr-4 ui-table-header text-muted-fg">{t.earnings.calCols.expected}</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map(e => (
              <tr key={`${e.ticker}-${e.reportDate}`} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                <td className="py-2.5 pl-4 pr-3">
                  <Link href={`/companies/${e.ticker}`} className="font-mono text-primary hover:underline">{e.ticker}</Link>
                </td>
                <td className="py-2.5 px-3 text-muted-fg">{e.period}</td>
                <td className="py-2.5 px-3 pr-4 ui-number text-muted-fg">{e.reportDate}</td>
              </tr>
            ))}
            {upcoming.length === 0 && (
              <tr><td colSpan={3} className="py-6 text-center text-xs text-muted-fg">{loading ? t.common.loading : t.earnings.noUpcoming}</td></tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-border">
          <TableSourceFooter source={t.home.earningsCalSource} asOf={cal?.asOf ?? null} />
        </div>
      </div>

      {/* Recent results — real reported quarterly financials, rolling last 2 quarters */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-surface-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="ui-label text-muted-fg">{t.earnings.recentResults}</span>
            <MarketDataSourceBadge status={live ? 'live' : 'static'} />
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 h-6 px-2 rounded border border-border bg-surface text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
          >
            <span aria-hidden>⤓</span>{t.common.exportCsv}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.earnings.calCols.ticker}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.company}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.period}</th>
                <th className="text-center py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.currency}</th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.revenue}</th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.revenueYoy}</th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.ebitda}</th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.ebitdaYoy}</th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.netIncome}</th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.netIncomeYoy}</th>
                <th className="text-right py-2.5 px-3 pr-4 ui-table-header text-muted-fg">{t.earnings.cols.eps}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(e => (
                <tr key={`${e.ticker}-${e.periodEnd}`} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="py-2.5 pl-4 pr-3">
                    <Link href={`/companies/${e.ticker}`} className="font-mono text-primary hover:underline">{e.ticker}</Link>
                  </td>
                  <td className="py-2.5 px-3 text-foreground">{e.companyName}</td>
                  <td className="py-2.5 px-3 text-muted-fg">{e.period}</td>
                  <td className="py-2.5 px-3 text-center text-muted-fg">{e.currency}</td>
                  <td className="py-2.5 px-3 text-right ui-number text-foreground">{fmtMM(e.revenue)}</td>
                  {pctCell(e.revenueYoY)}
                  <td className="py-2.5 px-3 text-right ui-number text-foreground" title={e.isBank ? t.earnings.bankNoEbitda : undefined}>
                    {fmtMM(e.ebitda)}
                  </td>
                  {pctCell(e.ebitdaYoY)}
                  <td className={`py-2.5 px-3 text-right ui-number ${e.netIncome != null && e.netIncome < 0 ? 'text-negative' : 'text-foreground'}`}>{fmtMM(e.netIncome)}</td>
                  {pctCell(e.netIncomeYoY)}
                  <td className={`py-2.5 px-3 pr-4 text-right ui-number ${e.eps != null && e.eps < 0 ? 'text-negative' : 'text-foreground'}`}>{fmtEps(e.eps)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={11} className="py-6 text-center text-xs text-muted-fg">{loading ? t.common.loading : t.common.noResults}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-border bg-surface flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-0.5">
            <TableSourceFooter source={t.stocks.footer} asOf={results?.asOf ?? null} />
            <p className="text-xs text-muted-fg">{t.earnings.amountsNote}</p>
          </div>
          <span className="text-xs ui-number text-muted-fg">{rows.length} {t.common.records}</span>
        </div>
      </div>
    </div>
  )
}
