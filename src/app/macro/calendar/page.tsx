'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { fetchFredReleaseCalendar, type FredCalendarFetchResult } from '@/lib/data/fredCalendar'
import type { FredCalendarEvent } from '@/lib/providers/fredReleaseCalendar'

export default function CalendarPage() {
  const { t } = useLang()

  // Phase 8D.1: dates-only FRED release calendar — the only real (non-fabricated)
  // release-date data this page shows. A prior schedule-driven synthetic table
  // (deterministic pseudo-random forecast/actual/prior values, US + Chile rows)
  // was removed from production per the calendar-integrity fix: it fabricated
  // numbers with no BCCh/FRED/INE backing and was easily mistaken for real data.
  // See docs/macro_market_source_coverage.md for the removal rationale.
  const [fred, setFred] = useState<FredCalendarFetchResult | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    fetchFredReleaseCalendar(60, ac.signal).then(setFred)
    return () => ac.abort()
  }, [])
  const fredUpcoming = (fred?.events ?? []).filter((e) => e.status === 'scheduled')

  const impColor = (imp: FredCalendarEvent['importance']) =>
    imp === 'High' ? 'var(--negative)' : imp === 'Medium' ? 'var(--warning)' : 'var(--muted-fg)'

  return (
    <div className="w-full space-y-4">
      <Link href="/macro" className="text-xs text-muted-fg hover:text-foreground inline-flex items-center gap-1">{t.cal.back}</Link>
      <SectionHeader tag={t.macro.tag} title={t.cal.title} subtitle={t.cal.subtitle} />

      {/* Dates-only FRED release calendar (additive, separate from macro time-series values) */}
      <div className="bg-surface border border-border rounded overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <span className="ui-label text-muted-fg">{t.cal.fredTitle}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-2 border border-border text-muted-fg">{t.common.datesOnly}</span>
        </div>
        {fred && !fred.configured ? (
          <div className="px-4 py-6 text-center text-xs text-muted-fg">{t.cal.fredUnavailable}</div>
        ) : fred && fred.configured && fredUpcoming.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-fg">{t.cal.fredEmpty}</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg w-28">{t.cal.fredDate}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.cal.fredRelease}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg w-40">{t.cal.fredCategory}</th>
                <th className="text-center py-2.5 px-3 pr-4 ui-table-header text-muted-fg w-14">{t.cal.imp}</th>
              </tr>
            </thead>
            <tbody>
              {fredUpcoming.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="py-2 pl-4 pr-3 ui-number text-muted-fg whitespace-nowrap">{e.date}</td>
                  <td className="py-2 px-3 text-foreground">
                    <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{e.name}</a>
                  </td>
                  <td className="py-2 px-3 text-muted-fg">{e.category}</td>
                  <td className="py-2 px-3 pr-4 text-center">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: impColor(e.importance) }} title={e.importance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 py-2 border-t border-border">
          <p className="text-xs text-muted-fg">{t.cal.fredSubtitle}</p>
        </div>
      </div>

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
