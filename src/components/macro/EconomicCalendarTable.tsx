'use client'

import { useLang } from '@/components/providers/LangProvider'
import { AsyncState } from '@/components/fable/AsyncState'
import type { EnrichedFredCalendarEvent, EnrichedMetric } from '@/lib/providers/calendarEnrichment'

// Shared table body for the FRED release calendar (dates + real actual/previous
// enrichment) — reused by the full calendar (/macro/calendar) and the
// current-month embed on the main Macro tab, so both stay pixel-identical and
// any future column change only needs to happen once.

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

export function EconomicCalendarTable({ events, emptyMessage }: { events: EnrichedFredCalendarEvent[]; emptyMessage: string }) {
  const { t } = useLang()
  const sorted = events.slice().sort((a, b) => a.date.localeCompare(b.date))
  const rows = toRows(sorted)

  const impColor = (imp: EnrichedFredCalendarEvent['importance']) =>
    imp === 'High' ? 'var(--negative)' : imp === 'Medium' ? 'var(--warning)' : 'var(--muted-fg)'

  if (rows.length === 0) {
    return <AsyncState kind="empty" message={emptyMessage} />
  }

  return (
    <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
      <caption className="sr-only">{t.cal.fredTitle}</caption>
      <thead>
        <tr>
          <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 pl-4 pr-3 sticky top-0 z-10 border-b border-border ui-table-header text-muted-fg w-24">{t.cal.fredDate}</th>
          <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 px-3 sticky top-0 z-10 border-b border-border ui-table-header text-muted-fg">{t.cal.fredRelease}</th>
          <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2.5 px-3 sticky top-0 z-10 border-b border-border ui-table-header text-muted-fg">{t.cal.metricCol}</th>
          <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 sticky top-0 z-10 border-b border-border ui-table-header text-muted-fg w-24">{t.cal.actualCol}</th>
          <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2.5 px-3 sticky top-0 z-10 border-b border-border ui-table-header text-muted-fg w-24">{t.cal.previousCol}</th>
          <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-center py-2.5 px-3 sticky top-0 z-10 border-b border-border ui-table-header text-muted-fg w-20">{t.cal.srcCol}</th>
          <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-center py-2.5 px-3 pr-4 sticky top-0 z-10 border-b border-border ui-table-header text-muted-fg w-12">{t.cal.imp}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const m = r.metric
          const pending = m?.status === 'pending'
          return (
            <tr key={`${r.event.id}-${m?.key ?? 'na'}-${i}`} className="border-b border-border last:border-0 nv-row-hover nv-transition">
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
                  : <span className="text-foreground">{m.actualText ?? fmtValue(m.actual, m.unit, m.decimals)}</span>}
              </td>
              <td className="py-2 px-3 text-right ui-number text-muted-fg">
                {m && m.previousText != null ? m.previousText
                  : m && m.previous != null ? fmtValue(m.previous, m.unit, m.decimals)
                  : '—'}
              </td>
              <td className="py-2 px-3 text-center">
                {m ? <span className="text-[10px] px-1 py-0.5 rounded-full nv-transition" style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)', color: 'var(--muted-fg)' }} title={t.cal.srcTitle}>{m.originatingAgency}</span> : ''}
              </td>
              <td className="py-2 px-3 pr-4 text-center">
                {r.firstOfEvent ? <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: impColor(r.event.importance) }} title={r.event.importance} /> : ''}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
