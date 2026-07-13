'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { fetchFredReleaseCalendar, type FredCalendarFetchResult } from '@/lib/data/fredCalendar'
import type { EnrichedFredCalendarEvent, EnrichedMetric } from '@/lib/providers/calendarEnrichment'

// Phase 8D.1: dates-only FRED release calendar — the only real (non-fabricated)
// release-date data this page shows. A prior schedule-driven synthetic table
// (deterministic pseudo-random forecast/actual/prior values) was removed per the
// calendar-integrity fix. Phase 8D.3: release rows are now ENRICHED with real
// actual/previous values derived from verified FRED time-series (never
// consensus/forecast/surprise). Release DATES come from FRED's release calendar;
// actual/previous VALUES come from FRED time-series (redistributing BLS/BEA/
// Census/Fed data) — two distinct, honestly-labeled sources.

/** Formats a metric value (US macro conventions) with its unit; null → em dash. */
function fmtValue(v: number | null, unit: string, decimals: number): string {
  if (v == null) return '—'
  const n = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (unit === '%') return `${n}%`
  if (unit === 'K') return `${n}K`
  if (unit === '$M') return `$${n}M`
  return n
}

interface Row {
  event: EnrichedFredCalendarEvent
  metric: EnrichedMetric | null
  firstOfEvent: boolean
}

/** Flattens events → one row per metric (releases with no mapped metric get one placeholder row). */
function toRows(events: EnrichedFredCalendarEvent[]): Row[] {
  const rows: Row[] = []
  for (const e of events) {
    if (e.metrics.length === 0) {
      rows.push({ event: e, metric: null, firstOfEvent: true })
    } else {
      e.metrics.forEach((m, i) => rows.push({ event: e, metric: m, firstOfEvent: i === 0 }))
    }
  }
  return rows
}

export default function CalendarPage() {
  const { t } = useLang()

  const [fred, setFred] = useState<FredCalendarFetchResult | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    fetchFredReleaseCalendar(60, ac.signal).then(setFred)
    return () => ac.abort()
  }, [])

  // Recent (past 7d) + upcoming, sorted by date — recent rows carry published
  // actuals, upcoming rows carry pending actual + the last published "previous".
  const events = (fred?.events ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))
  const rows = toRows(events)

  const impColor = (imp: EnrichedFredCalendarEvent['importance']) =>
    imp === 'High' ? 'var(--negative)' : imp === 'Medium' ? 'var(--warning)' : 'var(--muted-fg)'

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
        ) : fred && fred.configured && rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-fg">{t.cal.fredEmpty}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg w-24">{t.cal.fredDate}</th>
                  <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.cal.fredRelease}</th>
                  <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.cal.metricCol}</th>
                  <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg w-24">{t.cal.actualCol}</th>
                  <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg w-24">{t.cal.previousCol}</th>
                  <th className="text-center py-2.5 px-3 ui-table-header text-muted-fg w-20">{t.cal.srcCol}</th>
                  <th className="text-center py-2.5 px-3 pr-4 ui-table-header text-muted-fg w-12">{t.cal.imp}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const m = r.metric
                  const pending = m?.status === 'pending'
                  return (
                    <tr key={`${r.event.id}-${m?.key ?? 'na'}-${i}`} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                      <td className="py-2 pl-4 pr-3 ui-number text-muted-fg whitespace-nowrap">{r.firstOfEvent ? r.event.date : ''}</td>
                      <td className="py-2 px-3 text-foreground">
                        {r.firstOfEvent ? (
                          <a href={r.event.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.event.name}</a>
                        ) : ''}
                      </td>
                      <td className="py-2 px-3 text-muted-fg">{m ? m.label : <span className="italic">{t.cal.datesOnlyRow}</span>}</td>
                      <td className="py-2 px-3 text-right ui-number">
                        {!m ? <span className="text-muted-fg">—</span>
                          : pending ? <span className="text-muted-fg" title={t.cal.pendingTitle}>{t.cal.pending}</span>
                          : m.status === 'unavailable' ? <span className="text-muted-fg">—</span>
                          : <span className="text-foreground">{fmtValue(m.actual, m.unit, m.decimals)}</span>}
                      </td>
                      <td className="py-2 px-3 text-right ui-number text-muted-fg">
                        {m && m.previous != null ? fmtValue(m.previous, m.unit, m.decimals) : '—'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {m ? <span className="text-[10px] px-1 py-0.5 rounded bg-surface-2 border border-border text-muted-fg" title={t.cal.srcTitle}>{m.originatingAgency}</span> : ''}
                      </td>
                      <td className="py-2 px-3 pr-4 text-center">
                        {r.firstOfEvent ? <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: impColor(r.event.importance) }} title={r.event.importance} /> : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 border-t border-border">
          <p className="text-xs text-muted-fg">{t.cal.enrichedNote}</p>
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
