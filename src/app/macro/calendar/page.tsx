'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { EconomicCalendarTable } from '@/components/macro/EconomicCalendarTable'
import { TableCard } from '@/components/fable/TableCard'
import { ChipLabel } from '@/components/fable/Chip'
import { Reveal } from '@/components/fable/motion'
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
  // R12: null-from-the-helper means the fetch FAILED, not "zero releases" —
  // the card previously rendered the confirmed-empty copy both while loading
  // and after a hard failure. Three-way state: loading → error/unavailable →
  // table (whose own empty message then genuinely means zero events).
  const [fredState, setFredState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [fomc, setFomc] = useState<FomcExpectationsResult | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    fetchFredReleaseCalendar(60, ac.signal).then(res => {
      if (ac.signal.aborted) return
      setFred(res)
      setFredState(res && res.ok ? 'ready' : 'error')
    })
    fetchFomcExpectations().then(setFomc)
    return () => ac.abort()
  }, [])

  const events = fred?.events ?? []
  const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)

  return (
    <div className="w-full space-y-4">
      <Reveal>
        {/* R5 — the shared Fable PageHeader (same baseline row as /macro and the
            R3/R4 routes). The back link joins the header metadata beside the
            honest scope sentence; the shell's SecondaryNav pill rail
            (Indicators | Calendar) remains the primary route navigation. */}
        <PageHeader
          eyebrow={t.macro.tag}
          title={t.cal.title}
          metadata={
            <>
              <Link href="/macro" className="text-primary hover:underline whitespace-nowrap">{t.cal.back}</Link>
              <span>{t.cal.subtitle}</span>
            </>
          }
        />
      </Reveal>

      {/* FRED release calendar, enriched with actual/previous from FRED time-series */}
      <Reveal delayMs={70}>
        <TableCard
          title={t.cal.fredTitle}
          controls={<ChipLabel>{t.cal.noConsensus}</ChipLabel>}
          minWidth={720}
          state={
            fredState === 'loading' ? 'loading'
              : fredState === 'error' ? 'error'
              : fred && !fred.configured ? 'unavailable'
              : undefined
          }
          stateMessage={fredState === 'ready' && fred && !fred.configured ? t.cal.fredUnavailable : undefined}
          footer={
            <>
              <p className="text-xs text-muted-fg">{t.cal.enrichedNote}</p>
              {/* R12: no fabricated as-of — the previous reduce() stamped the
                  furthest FUTURE scheduled release date as the data vintage.
                  Scheduled dates are content, not freshness; the Macro page's
                  own calendar embed already passes null for the same reason. */}
              <TableSourceFooter source="FRED (Federal Reserve Bank of St. Louis)" asOf={null} className="mt-0.5" />
            </>
          }
        >
          <EconomicCalendarTable events={events} emptyMessage={t.cal.fredEmpty} />
        </TableCard>
      </Reveal>

      {/* FOMC market-implied rate outlook — Atlanta Fed MPT (SOFR-based, per
          reference quarter, NOT per-meeting and NOT CME FedWatch), with the
          current target range as the reliable "previous/current" policy band. */}
      {fomc && fomc.status !== 'unavailable' && (
        <Reveal delayMs={130}>
          <TableCard
            title={t.cal.fomcTitle}
            controls={fomc.currentTargetRange ? (
              <span className="text-xs text-muted-fg">
                {t.cal.fomcCurrentTarget}: <span className="ui-number text-foreground">{fomc.currentTargetRange}</span>
              </span>
            ) : undefined}
            minWidth={480}
            state={fomc.quarters.length === 0 ? 'unavailable' : undefined}
            stateMessage={t.cal.fomcOutlookUnavailable}
            footer={
              <>
                <p className="text-xs text-muted-fg">{t.cal.fomcNote}</p>
                <TableSourceFooter source={fomc.source} asOf={fomc.observationDate || null} className="mt-0.5" />
              </>
            }
          >
            <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.cal.fomcTitle}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-left py-2 px-3 pl-4 border-b border-border ui-table-header text-muted-fg">{t.cal.fomcWindow}</th>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2 px-3 border-b border-border ui-table-header text-muted-fg">{t.cal.fomcExpected}</th>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2 px-3 border-b border-border ui-table-header text-muted-fg">{t.cal.fomcBelow}</th>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2 px-3 border-b border-border ui-table-header text-muted-fg">{t.cal.fomcInRange}</th>
                  <th scope="col" style={{ backgroundColor: 'var(--surface-table)' }} className="text-right py-2 px-3 pr-4 border-b border-border ui-table-header text-muted-fg">{t.cal.fomcAbove}</th>
                </tr>
              </thead>
              <tbody>
                {fomc.quarters.map(q => (
                  <tr key={q.referenceStart} className="border-b border-border last:border-0 nv-row-hover nv-transition">
                    <td className="py-1.5 px-3 pl-4 text-muted whitespace-nowrap">{q.windowLabel}</td>
                    <td className="py-1.5 px-3 text-right ui-number text-foreground">{q.expectedRatePct != null ? `${q.expectedRatePct.toFixed(2)}%` : '—'}</td>
                    <td className="py-1.5 px-3 text-right ui-number text-muted-fg">{pct(q.probBelowPct)}</td>
                    <td className="py-1.5 px-3 text-right ui-number text-muted-fg">{pct(q.probInRangePct)}</td>
                    <td className="py-1.5 px-3 pr-4 text-right ui-number text-muted-fg">{pct(q.probAbovePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </Reveal>
      )}

      {/* Chile release-date calendar — deferred. No free, stable, structured official
          release-date source (BCCh/INE publish rendered HTML only) has been verified —
          see docs/macro_market_source_coverage.md §5. Never fabricate Chile rows here. */}
      <Reveal delayMs={190}>
        <TableCard
          title={t.cal.chileTitle}
          controls={<ChipLabel>{t.cal.chileDeferred}</ChipLabel>}
          state="unavailable"
          stateMessage={t.cal.chileUnavailable}
        >
          <></>
        </TableCard>
      </Reveal>
    </div>
  )
}
