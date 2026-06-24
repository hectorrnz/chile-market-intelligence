'use client'

import Link from 'next/link'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { StatusPill } from '@/components/ui/StatusPill'
import { SourceNote } from '@/components/ui/SourceNote'
import { useLang } from '@/components/providers/LangProvider'
import { getUpcomingEarnings, getRecentResults } from '@/lib/data/earnings'
import { getDocumentByRelatedId } from '@/lib/data/documents'
import { formatMillionsCLP, formatPct, surprisePct, changeColor } from '@/lib/formatters'
import { exportCSV } from '@/lib/export'
import type { EarningsRelease } from '@/types'

const qualityVariant: Record<EarningsRelease['resultQuality'], 'positive' | 'warning' | 'negative' | 'neutral'> = {
  Clean:   'positive',
  Mixed:   'warning',
  Weak:    'negative',
  Pending: 'neutral',
}

const upcoming = getUpcomingEarnings()
const results  = getRecentResults()

export default function EarningsPage() {
  const { t } = useLang()

  const surpriseLabel = (s: number) => (s > 0.5 ? t.earnings.beat : s < -0.5 ? t.earnings.miss : t.earnings.inline)

  const handleExport = () => {
    exportCSV(
      'earnings_recent_results',
      [
        t.earnings.calCols.ticker, t.earnings.cols.company, t.earnings.cols.period,
        t.earnings.cols.revenue, t.earnings.cols.revenueYoy, t.earnings.cols.ebitda, t.earnings.cols.ebitdaYoy,
        t.earnings.consensus, t.earnings.surprise, t.earnings.resultQuality, t.earnings.keyDriver,
      ],
      results.map(e => {
        const s = surprisePct(e.revenue, e.consensusRevenue)
        return [
          e.ticker, e.companyName, e.period,
          e.revenue ?? '', e.revenueYoY ?? '', e.ebitda ?? '', e.ebitdaYoY ?? '',
          e.consensusRevenue ?? '', s != null ? `${s.toFixed(1)}%` : '', e.resultQuality, e.keyDriver ?? '',
        ]
      }),
    )
  }

  return (
    <div className="w-full space-y-5">
      <SectionHeader
        tag={t.earnings.tag}
        title={t.earnings.title}
        subtitle={t.earnings.subtitle}
        asOf
      />

      {/* Upcoming calendar */}
      {upcoming.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-surface-2">
            <span className="ui-label text-muted-fg">{t.earnings.upcomingLabel}</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.earnings.calCols.ticker}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.calCols.company}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.calCols.period}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.calCols.expected}</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map(e => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="py-2.5 pl-4 pr-3">
                    <Link href={`/companies/${e.ticker}`} className="font-mono text-primary hover:underline">{e.ticker}</Link>
                  </td>
                  <td className="py-2.5 px-3 text-foreground">{e.companyName}</td>
                  <td className="py-2.5 px-3 text-muted-fg">{e.period}</td>
                  <td className="py-2.5 px-3 ui-number text-muted-fg">{e.reportDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent results */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-surface-2 flex items-center justify-between gap-3">
          <span className="ui-label text-muted-fg">{t.earnings.recentResults}</span>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 h-6 px-2 rounded border border-border bg-surface text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
          >
            <span aria-hidden>⤓</span>{t.common.exportCsv}
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg">{t.earnings.calCols.ticker}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.company}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.period}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.revenue}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.revenueYoy}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.ebitda}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.cols.ebitdaYoy}</th>
              <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.surprise}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.resultQuality}</th>
              <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.earnings.keyDriver}</th>
              <th className="text-left py-2.5 px-3 pr-4 ui-table-header text-muted-fg">{t.documents.viewSummary}</th>
            </tr>
          </thead>
          <tbody>
            {results.map(e => {
              const doc = getDocumentByRelatedId(e.id)
              return (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="py-2.5 pl-4 pr-3">
                    <Link href={`/companies/${e.ticker}`} className="font-mono text-primary hover:underline">{e.ticker}</Link>
                  </td>
                  <td className="py-2.5 px-3 text-foreground">{e.companyName}</td>
                  <td className="py-2.5 px-3 text-muted-fg">{e.period}</td>
                  <td className="py-2.5 px-3 text-right ui-number text-foreground">
                    {e.revenue != null ? formatMillionsCLP(e.revenue) : '—'}
                  </td>
                  <td className={`py-2.5 px-3 text-right ui-number ${e.revenueYoY != null ? changeColor(e.revenueYoY) : 'text-muted-fg'}`}>
                    {e.revenueYoY != null ? formatPct(e.revenueYoY) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right ui-number text-foreground">
                    {e.ebitda != null ? formatMillionsCLP(e.ebitda) : '—'}
                  </td>
                  <td className={`py-2.5 px-3 text-right ui-number ${e.ebitdaYoY != null ? changeColor(e.ebitdaYoY) : 'text-muted-fg'}`}>
                    {e.ebitdaYoY != null ? formatPct(e.ebitdaYoY) : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    {(() => {
                      const s = surprisePct(e.revenue, e.consensusRevenue)
                      if (s == null) return <span className="text-muted-fg">—</span>
                      return (
                        <span className={`ui-number ${changeColor(s)}`} title={`${t.earnings.consensus}: ${e.consensusRevenue != null ? formatMillionsCLP(e.consensusRevenue) : '—'}`}>
                          <span className="text-muted-fg mr-1">{surpriseLabel(s)}</span>{formatPct(s)}
                        </span>
                      )
                    })()}
                  </td>
                  <td className="py-2.5 px-3">
                    <StatusPill label={e.resultQuality} variant={qualityVariant[e.resultQuality]} />
                  </td>
                  <td className="py-2.5 px-3 text-muted max-w-[180px]">
                    <span className="block truncate" title={e.keyDriver}>{e.keyDriver ?? '—'}</span>
                  </td>
                  <td className="py-2.5 px-3 pr-4">
                    {doc ? (
                      <Link href={`/documents/${doc.id}`} className="text-xs text-primary hover:underline">
                        {t.documents.viewSummary}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-fg">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {results.length === 0 && (
              <tr>
                <td colSpan={11} className="py-6 text-center text-xs text-muted-fg">{t.common.noResults}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-border bg-surface flex items-center justify-between">
          <p className="text-xs text-muted-fg">{t.earnings.footer}</p>
          <span className="text-xs ui-number text-muted-fg">{results.length} {t.common.records}</span>
        </div>
      </div>

      <SourceNote>{t.common.mvpNote}</SourceNote>
    </div>
  )
}
