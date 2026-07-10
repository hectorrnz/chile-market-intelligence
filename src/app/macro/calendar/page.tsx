'use client'

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { SourceNote } from '@/components/ui/SourceNote'
import {
  getCalendarForWeek, searchUpcoming, weekStartOf, todayUTC, addDays, weekLabel, dayLabel, dateStr,
  type CalEvent,
} from '@/lib/data/calendar'
import { fetchFredReleaseCalendar, type FredCalendarFetchResult } from '@/lib/data/fredCalendar'

function groupByDay(events: CalEvent[]): { date: string; items: CalEvent[] }[] {
  const map = new Map<string, CalEvent[]>()
  for (const e of events) { if (!map.has(e.date)) map.set(e.date, []); map.get(e.date)!.push(e) }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, items]) => ({ date, items }))
}

export default function CalendarPage() {
  const { t } = useLang()
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(todayUTC()))
  const [query, setQuery] = useState('')

  const todayStr = dateStr(todayUTC())
  const searching = query.trim().length > 0
  const events = searching ? searchUpcoming(query, todayUTC(), 8) : getCalendarForWeek(weekStart)
  const groups = groupByDay(events)

  // Phase 8D.1: dates-only FRED release calendar — additive, separate from the
  // synthetic schedule-driven table above. Never invents consensus/actual/prior.
  const [fred, setFred] = useState<FredCalendarFetchResult | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    fetchFredReleaseCalendar(60, ac.signal).then(setFred)
    return () => ac.abort()
  }, [])
  const fredUpcoming = (fred?.events ?? []).filter((e) => e.status === 'scheduled')

  const impColor = (imp: CalEvent['importance']) =>
    imp === 'High' ? 'var(--negative)' : imp === 'Medium' ? 'var(--warning)' : 'var(--muted-fg)'

  return (
    <div className="w-full space-y-4">
      <Link href="/macro" className="text-xs text-muted-fg hover:text-foreground inline-flex items-center gap-1">{t.cal.back}</Link>
      <SectionHeader tag={t.macro.tag} title={t.cal.title} subtitle={t.cal.subtitle} />

      {/* Controls: week nav + search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="w-7 h-7 rounded border border-border bg-surface text-muted-fg hover:text-foreground hover:border-accent transition-colors" aria-label="Previous week">←</button>
          <span className="px-3 py-1 rounded bg-surface-2 border border-border text-sm font-semibold ui-number" style={{ color: 'var(--warning)' }}>{weekLabel(weekStart)}</span>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="w-7 h-7 rounded border border-border bg-surface text-muted-fg hover:text-foreground hover:border-accent transition-colors" aria-label="Next week">→</button>
          <button onClick={() => setWeekStart(weekStartOf(todayUTC()))} className="ml-1 text-xs text-primary hover:underline">{t.cal.today}</button>
        </div>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t.cal.search}
          className="h-8 w-72 bg-surface border border-border rounded px-3 text-xs text-foreground outline-none focus:border-accent placeholder:text-muted-fg" />
      </div>

      {searching && <div className="ui-label text-muted-fg">{t.cal.results}</div>}

      <div className="bg-surface border border-border rounded overflow-hidden">
        {groups.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-fg">{searching ? t.cal.noResults : t.cal.noToday}</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left py-2.5 pl-4 pr-3 ui-table-header text-muted-fg w-20">{t.cal.time}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg w-16">{t.cal.country}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.cal.event}</th>
                <th className="text-center py-2.5 px-3 ui-table-header text-muted-fg w-14">{t.cal.imp}</th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.cal.forecast}</th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg">{t.cal.actual}</th>
                <th className="text-right py-2.5 px-3 pr-4 ui-table-header text-muted-fg">{t.cal.prior}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ date, items }) => (
                <Fragment key={date}>
                  <tr>
                    <td colSpan={7} className="bg-surface-2 px-4 py-1.5" style={{ borderLeft: '3px solid var(--accent)' }}>
                      <span className="ui-label text-foreground">{dayLabel(date)}</span>
                      {date === todayStr && <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in oklab, var(--accent) 22%, var(--surface))', color: 'var(--foreground)' }}>{t.cal.today}</span>}
                    </td>
                  </tr>
                  {items.map(e => {
                    const high = e.importance === 'High'
                    return (
                      <tr key={e.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors"
                        style={high ? { borderLeft: '3px solid var(--negative)', backgroundColor: 'color-mix(in oklab, var(--negative) 5%, var(--surface))' } : { borderLeft: '3px solid transparent' }}>
                        <td className="py-2 pl-4 pr-3 ui-number text-muted-fg whitespace-nowrap">{e.time}</td>
                        <td className="py-2 px-3"><span className="font-mono text-xs px-1.5 py-0.5 rounded bg-surface-2 border border-border text-muted">{e.country}</span></td>
                        <td className={`py-2 px-3 ${high ? 'font-semibold text-foreground' : 'text-foreground'}`}>{e.name}</td>
                        <td className="py-2 px-3 text-center"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: impColor(e.importance) }} title={e.importance} /></td>
                        <td className="py-2 px-3 text-right ui-number text-muted-fg">{e.forecast != null ? `${e.forecast}${e.unit}` : '—'}</td>
                        <td className={`py-2 px-3 text-right ui-number ${e.actual != null ? 'text-foreground' : 'text-muted-fg'}`}>{e.actual != null ? `${e.actual}${e.unit}` : '—'}</td>
                        <td className="py-2 px-3 pr-4 text-right ui-number text-muted-fg">{e.prior != null ? `${e.prior}${e.unit}` : '—'}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SourceNote>{t.common.mvpNote}</SourceNote>

      {/* Phase 8D.1 — dates-only FRED release calendar (additive, separate from the synthetic table above) */}
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
    </div>
  )
}
