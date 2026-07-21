'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { EconomicCalendarTable } from '@/components/macro/EconomicCalendarTable'
import { fetchFredReleaseCalendar, type FredCalendarFetchResult } from '@/lib/data/fredCalendar'
import { fetchFomcExpectations, type FomcExpectationsResult } from '@/lib/data/fomcExpectations'

// Phase 8D.1: dates-only FRED release calendar — the only real (non-fabricated)
// release-date data this page shows. A prior schedule-driven synthetic table
// (deterministic pseudo-random forecast/actual/prior values) was removed per the
// calendar-integrity fix. Phase 8D.3: release rows are now ENRICHED with real
// actual/previous values derived from verified FRED time-series (never
// consensus/forecast/surprise). Release DATES come from FRED's release calendar;
// actual/previous VALUES come from FRED time-series (redistributing BLS/BEA/
// Census/Fed data) — two distinct, honestly-labeled sources. The table markup
// itself is shared with the Macro page's current-month embed via
// EconomicCalendarTable.tsx.

export default function CalendarPage() {
  const { t } = useLang()

  const [fred, setFred] = useState<FredCalendarFetchResult | null>(null)
  const [fomc, setFomc] = useState<FomcExpectationsResult | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    fetchFredReleaseCalendar(60, ac.signal).then(setFred)
    fetchFomcExpectations().then(setFomc)
    return () => ac.abort()
  }, [])

  const events = fred?.events ?? []
  const latestAsOf = events.reduce((max, e) => (e.date > max ? e.date : max), '')
  const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)

  return (
    <div className="w-full space-y-4">
      <Link href="/macro" className="text-xs text-muted-fg hover:text-foreground inline-flex items-center gap-1">{t.cal.back}</Link>
      <SectionHeader tag={t.macro.tag} title={t.cal.title} subtitle={t.cal.subtitle} />

      {/* FRED release calendar, enriched with actual/previous from FRED time-series */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="ui-label text-muted-fg">{t.cal.fredTitle}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 border border-border text-muted-fg">{t.cal.noConsensus}</span>
        </div>
        {fred && !fred.configured ? (
          <div className="px-4 py-6 text-center text-xs text-muted-fg">{t.cal.fredUnavailable}</div>
        ) : (
          <EconomicCalendarTable events={events} emptyMessage={t.cal.fredEmpty} />
        )}
        <div className="px-4 py-2 border-t border-border space-y-0.5">
          <p className="text-xs text-muted-fg">{t.cal.enrichedNote}</p>
          <TableSourceFooter source="FRED (Federal Reserve Bank of St. Louis)" asOf={latestAsOf || null} />
        </div>
      </div>

      {/* FOMC market-implied rate outlook — Atlanta Fed MPT (SOFR-based, per
          reference quarter, NOT per-meeting and NOT CME FedWatch), with the
          current target range as the reliable "previous/current" policy band. */}
      {fomc && fomc.status !== 'unavailable' && (
        <div className="bg-surface border border-border rounded overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <span className="ui-label text-muted-fg">{t.cal.fomcTitle}</span>
            {fomc.currentTargetRange && (
              <span className="text-xs text-muted-fg">
                {t.cal.fomcCurrentTarget}: <span className="ui-number text-foreground">{fomc.currentTargetRange}</span>
              </span>
            )}
          </div>
          {fomc.quarters.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="text-left py-2 px-3 pl-4 ui-table-header text-muted-fg">{t.cal.fomcWindow}</th>
                    <th className="text-right py-2 px-3 ui-table-header text-muted-fg">{t.cal.fomcExpected}</th>
                    <th className="text-right py-2 px-3 ui-table-header text-muted-fg">{t.cal.fomcBelow}</th>
                    <th className="text-right py-2 px-3 ui-table-header text-muted-fg">{t.cal.fomcInRange}</th>
                    <th className="text-right py-2 px-3 pr-4 ui-table-header text-muted-fg">{t.cal.fomcAbove}</th>
                  </tr>
                </thead>
                <tbody>
                  {fomc.quarters.map(q => (
                    <tr key={q.referenceStart} className="border-b border-border last:border-0">
                      <td className="py-1.5 px-3 pl-4 text-muted whitespace-nowrap">{q.windowLabel}</td>
                      <td className="py-1.5 px-3 text-right ui-number text-foreground">{q.expectedRatePct != null ? `${q.expectedRatePct.toFixed(2)}%` : '—'}</td>
                      <td className="py-1.5 px-3 text-right ui-number text-muted-fg">{pct(q.probBelowPct)}</td>
                      <td className="py-1.5 px-3 text-right ui-number text-muted-fg">{pct(q.probInRangePct)}</td>
                      <td className="py-1.5 px-3 pr-4 text-right ui-number text-muted-fg">{pct(q.probAbovePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-4 text-center text-xs text-muted-fg">{t.cal.fomcOutlookUnavailable}</div>
          )}
          <div className="px-4 py-2 border-t border-border space-y-0.5">
            <p className="text-xs text-muted-fg">{t.cal.fomcNote}</p>
            <TableSourceFooter source={fomc.source} asOf={fomc.observationDate || null} />
          </div>
        </div>
      )}

      {/* Chile release-date calendar — deferred. No free, stable, structured official
          release-date source (BCCh/INE publish rendered HTML only) has been verified —
          see docs/macro_market_source_coverage.md §5. Never fabricate Chile rows here. */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="ui-label text-muted-fg">{t.cal.chileTitle}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 border border-border text-muted-fg">{t.cal.chileDeferred}</span>
        </div>
        <div className="px-4 py-6 text-center text-xs text-muted-fg">{t.cal.chileUnavailable}</div>
      </div>
    </div>
  )
}
