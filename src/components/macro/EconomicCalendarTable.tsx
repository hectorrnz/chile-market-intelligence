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

  // R5 — the color-only importance dot became a visible, localized signal so
  // the classification never depends on color (or a hover title) alone. The
  // color mapping itself is unchanged — High keeps the platform-wide
  // --negative signal.
  const impLabel = (imp: EnrichedFredCalendarEvent['importance']) =>
    imp === 'High' ? t.cal.impHigh : imp === 'Medium' ? t.cal.impMedium : t.cal.impLow

  // R5.1 — relevance is encoded as a compact ascending bar meter (High 3 /
  // Medium 2 / Low 1 filled of 3) rather than a word chip: bar COUNT is the
  // primary signal, scannable down the column at a glance, with the tone
  // carried as reinforcement only. The data model defines exactly three
  // levels (fredReleaseAllowlist.ts) — no fourth level is invented.
  const FILLED: Record<EnrichedFredCalendarEvent['importance'], number> = { Low: 1, Medium: 2, High: 3 }
  const BAR_HEIGHT = [5, 8, 11]

  const RelevanceBars = ({ importance }: { importance: EnrichedFredCalendarEvent['importance'] }) => {
    const filled = FILLED[importance]
    const name = `${t.cal.relevanceLabel}: ${impLabel(importance)}`
    return (
      <span
        role="img"
        aria-label={name}
        title={`${name} · ${t.cal.impTitle}`}
        className="inline-flex items-end gap-[2px] h-3 align-middle"
      >
        {BAR_HEIGHT.map((h, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="block w-[3px] rounded-xs"
            style={{
              height: h,
              backgroundColor: i < filled
                ? impColor(importance)
                : 'color-mix(in oklab, var(--muted-fg) 24%, transparent)',
            }}
          />
        ))}
        <span className="sr-only">{impLabel(importance)}</span>
      </span>
    )
  }

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
          <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-center py-2.5 px-3 pr-4 sticky top-0 z-10 border-b border-border ui-table-header text-muted-fg w-16">{t.cal.imp}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const m = r.metric
          const pending = m?.status === 'pending'
          return (
            <tr key={`${r.event.id}-${m?.key ?? 'na'}-${i}`} className="border-b border-border last:border-0 nv-row-hover nv-transition">
              {/* R5 — the Fable releases-card date treatment (accent-2, 650) so
                  the chronological anchor of each event group reads at a glance. */}
              <td className="py-2 pl-4 pr-3 ui-number whitespace-nowrap text-accent-2" style={{ fontWeight: 650 }}>{r.firstOfEvent ? r.event.date : ''}</td>
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
                {r.firstOfEvent ? <RelevanceBars importance={r.event.importance} /> : ''}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
