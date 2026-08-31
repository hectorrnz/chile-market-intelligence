'use client'

// R13.R4A — Alternatives · CASH FLOWS.
//
// Every recorded movement, newest first, banded by month: date, event type,
// investment, sociedad, currency, amount. One row per event the workbook
// actually carries — nothing is derived, interpolated or back-filled.
//
// SIGNS ARE THE SOURCE'S, UNCHANGED (doc 03 § 3.3). `Aporte` is negative — cash
// out to the fund — and `Dividendo`/`Distribución` positive. The direction is
// stated in the footer and shown by the sign itself; nothing here flips a
// figure to make it read more like a conventional LP statement, because that
// would silently restate the accounting.
//
// CLASSIFICATION IS THE PARSER'S, VERBATIM (doc 03 § 3.4). An `unclassified`
// event is one whose source fill did not resolve against the workbook's own
// legend. It keeps that label, is excluded from both the calls and the
// distributions subtotal, and is surfaced as an explicit administrator action —
// never guessed from the sign of its amount, which is exactly the inference the
// parser refused to make.
//
// THE PERIOD SUBTOTALS ARE PER CURRENCY AND NOTHING SUMS ACROSS THEM
// (doc 03 § 4.2). They are computed by `currencyCashFlows`, the same pure
// function the Dashboard uses, over the filtered set — so the two views can
// never report different totals for the same selection.
//
// R13.R4A.3 — THE VIEW NOW READS TOTAL → YEAR → ROW. The per-currency subtotal
// tiles, the by-year chart block (moved here from the Dashboard) and the
// chronological ledger are three grains of ONE selection, in descending order,
// and all three read the same filtered event set through the same pure
// functions. The tiles' row is sized to the number of currencies the source
// actually carries, so the header band ends exactly where the tables beneath it
// do rather than stopping short in an empty grid track.
//
// INCOMPLETENESS IS DISCLOSED, NOT FILLED. The timeline covers its own window
// only, and holdings whose capital moved before it opened carry no event. The
// footer states the recorded window and the coverage count rather than letting
// an empty history read as "nothing happened".

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { TableCard } from '@/components/fable/TableCard'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { useAlternatives } from '@/components/familyPortfolio/AlternativesProvider'
import { AlternativesFilters } from '@/components/familyPortfolio/AlternativesFilters'
import { AlternativesCashFlowChart } from '@/components/familyPortfolio/AlternativesCashFlowChart'
import { PeriodBreakdownModal } from '@/components/familyPortfolio/AlternativesDrilldowns'
import { EventLegend, EventTypeTag } from '@/components/familyPortfolio/AlternativesEventChrome'
import {
  applyEventFilter,
  buildTimeline,
  currencyCashFlows,
  currencyLabel,
  filterOptions,
  periodBreakdown,
  periodColumns,
  summarizeEvents,
} from '@/lib/familyPortfolio/alternativesView'
import { CASH_FLOW_HISTORY_ANCHOR } from '@/lib/familyPortfolio/alternativesRoutes'
import { formatIsoDateLabel } from '@/lib/formatters'

/**
 * The tile row's column count, so N currencies fill the row EDGE TO EDGE and
 * the band lines up with the ledger card beneath it (R13.R4A.3).
 *
 * A fixed four-column row left a three-currency publication with a quarter of
 * the row empty and the tiles visibly short of the table below — the tiles are
 * that table's section headers, and a header that stops before its table reads
 * as a different block. Written as whole literal class strings because Tailwind
 * scans source text: a template-built class name would not survive the build.
 */
const TILE_COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
}
const TILE_COLUMNS_MANY = 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'

const TH = 'py-2.5 px-3 first:pl-4 last:pr-4 ui-table-header text-muted-fg sticky top-0 bg-surface z-10'
const CELL = 'py-2 px-3 first:pl-4 last:pr-4'

/** `YYYY-MM` → `MM-YYYY`, read off the string — never `new Date()`. */
function monthBandLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  return m ? `${m[2]}-${m[1]}` : month
}

export default function AlternativesCashFlowsPage() {
  const { t } = useLang()
  const a = t.fp.alternatives
  const [masked] = usePrivacyMode()
  const { data, filter, setFilter } = useAlternatives()

  const holdings = useMemo(() => data?.holdings ?? [], [data])
  const events = useMemo(() => data?.events ?? [], [data])
  const options = useMemo(() => filterOptions(holdings, events), [holdings, events])

  // R13.R4A.4 — CASH FLOWS ALWAYS READS THE FULL RECORDED HISTORY. The year
  // control is gone (see `AlternativesFilters`), and this view states the
  // guarantee locally rather than inheriting it from the absence of a control
  // somewhere else: the year is cleared here, so the tiles, the by-year chart
  // and the ledger below all read every year the source records, and no future
  // surface that sets `filter.year` can silently narrow this page. Every OTHER
  // dimension — sociedad, category, currency, event type — passes through
  // untouched.
  const allYears = useMemo(() => ({ ...filter, year: [] }), [filter])
  const visibleEvents = useMemo(
    () => applyEventFilter(events, holdings, allYears),
    [events, holdings, allYears],
  )
  const months = useMemo(() => buildTimeline(visibleEvents, holdings), [visibleEvents, holdings])
  const totals = useMemo(() => currencyCashFlows(visibleEvents), [visibleEvents])

  // The unclassified callout reports the WHOLE publication, never the filtered
  // view — an actionable state must not disappear behind a filter.
  const unclassified = data?.eventSummary?.unclassified ?? summarizeEvents(events).unclassified
  const coverage = data?.coverage ?? null
  const publishedAt = data?.publication?.publishedAt ?? null

  // R13.R4A.3 — the by-year block moved here from the Dashboard. It reads the
  // FILTERED events, exactly like the subtotal tiles above it and the ledger
  // below it, so all three describe the same selection; a chart drawn from the
  // whole publication beside tiles drawn from a narrowed one would be two
  // different answers on one screen. Currency order follows the tiles' own,
  // which is `currencyCashFlows`'s — one order for the page.
  const [drilldown, setDrilldown] = useState<{ currency: string; period: string } | null>(null)
  const breakdown = useMemo(
    () =>
      drilldown === null
        ? null
        : periodBreakdown(visibleEvents, holdings, drilldown.currency, drilldown.period),
    [drilldown, visibleEvents, holdings],
  )

  // LANDING ON THE HISTORY SECTION (R13.R4A.4). A hash in the href is enough
  // when the module is already open — the provider holds the publication, so
  // the ledger is in the DOM the moment the route renders and the browser
  // scrolls to it. It is NOT enough on a cold deep link: the shell shows the
  // loading state, the anchor does not exist yet, and the browser's one attempt
  // finds nothing. This effect makes the landing survive that: it runs once the
  // section is actually mounted, and only when the hash asks for it.
  const historyRef = useRef<HTMLElement>(null)
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current) return
    if (typeof window === 'undefined') return
    if (window.location.hash !== `#${CASH_FLOW_HISTORY_ANCHOR}`) return
    const el = historyRef.current
    if (el === null) return
    landed.current = true
    el.scrollIntoView({
      // Motion rule: the reduced-motion path ships in the same change.
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
    // Focus follows the scroll so the keyboard lands where the eye does; the
    // section is not otherwise focusable, hence tabIndex={-1}.
    el.focus({ preventScroll: true })
  }, [data])

  return (
    <div className="flex flex-col gap-5">
      {/* R13.R4A.4 — sociedad / category / currency / type. NO year: this page
          shows every recorded year, always. The three blocks below are one
          selection at three grains, and the middle one is the years themselves;
          narrowing to a single year collapsed it to a single column while the
          tiles above and the ledger below quietly changed meaning with it. */}
      <AlternativesFilters options={options} filter={filter} onChange={setFilter} showEventType />

      {/* ── Unclassified events — explicit, actionable, never hidden ────── */}
      {unclassified > 0 && (
        <div
          role="status"
          className="rounded-[13px] border border-border bg-surface px-4 py-3 text-xs"
          style={{ borderLeft: '3px solid var(--warning)' }}
        >
          <p className="font-medium text-warning">
            {a.unclassifiedTitle} · {unclassified}
          </p>
          <p className="text-muted-fg mt-0.5">{a.unclassifiedBody}</p>
        </div>
      )}

      {/* ── Per-currency totals + the ledger, as ONE section ──────────────
          R13.R4A.1 owner review: the tiles ARE the ledger's section headers —
          each is the per-currency subtotal of exactly the rows below — so the
          two sit a half-step tighter (gap-3) than the page rhythm and the
          tiles row runs up to four across, one per currency, reading as a
          header band rather than a card grid of its own. Same figures, same
          per-currency fencing, same pure function as the Dashboard. */}
      <div className="flex flex-col gap-3">
        {totals.length > 0 && (
          <div className={`grid gap-4 ${TILE_COLUMNS[totals.length] ?? TILE_COLUMNS_MANY}`}>
            {totals.map((c) => (
              <GlassSurface key={c.currency} variant="card" className="px-4 py-3.5 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  {/* R13.R4A.1 — the currency IS the section heading of a
                      currency-fenced subtotal, so it carries the capsule step
                      rather than sitting at the same 13px as the rows beneath
                      it. Same figure set, same fence; only the weight moved. */}
                  <span className="ui-capsule-value ui-number text-foreground">
                    {currencyLabel(c.currency)}
                  </span>
                  <span className="ui-meta text-muted-fg">
                    {c.calls.count + c.distributions.count + c.unclassified.count} {a.eventsWord}
                  </span>
                </div>
                <dl className="flex flex-col gap-1.5 mt-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="text-muted-fg truncate">{a.kpiCalls}</dt>
                    <dd className="ui-number shrink-0 text-foreground">
                      <MaskedAmount value={c.calls.amount} masked={masked} signed />
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <dt className="text-muted-fg truncate">{a.kpiDistributions}</dt>
                    <dd className="ui-number shrink-0 text-foreground">
                      <MaskedAmount value={c.distributions.amount} masked={masked} signed />
                    </dd>
                  </div>
                  {c.unclassified.count > 0 && (
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <dt className="text-warning truncate">{a.kpiUnclassifiedAmount}</dt>
                      <dd className="ui-number shrink-0 text-foreground">
                        <MaskedAmount value={c.unclassified.amount} masked={masked} signed />
                      </dd>
                    </div>
                  )}
                  {/* The tile's conclusion — a half-step above the rows so the
                      header band reads as the subtotal it is. */}
                  <div className="flex items-baseline justify-between gap-3 text-xs border-t border-border pt-1.5">
                    <dt className="text-foreground truncate">{a.kpiNetFlow}</dt>
                    <dd className="ui-number shrink-0 text-sm font-semibold text-foreground">
                      <MaskedAmount value={c.net} masked={masked} signed />
                    </dd>
                  </div>
                </dl>
              </GlassSurface>
            ))}
          </div>
        )}

        {/* ── The same flow, by year ────────────────────────────────────────
            R13.R4A.3 — moved here from the Dashboard, and this is where it
            belongs: it sits between the per-currency subtotals it decomposes
            and the ledger of the very events it sums, so the reader can go
            total → year → row without leaving the page. On the Dashboard it
            was a multi-year block on a surface answering "what is the
            position"; here every neighbour is already an event view.

            Stacked, one currency per row across the full width — never two
            side by side, which would invite the eye to compare two axes drawn
            in different denominations. */}
        {totals.length > 0 && (
          <TableCard
            title={a.annualTitle}
            controls={<EventLegend t={a} />}
            footer={
              <div className="nv-notes">
                <TableSourceFooter source={a.source} asOf={publishedAt} />
                <p className="ui-meta text-muted-fg">{a.signNote}</p>
                <p className="ui-meta text-muted-fg">{a.noCrossCurrencyNote}</p>
              </div>
            }
          >
            {/* R13.R4A.3 visual pass — one hairline-fenced lane per currency,
                the same fence grammar as everything else on this page, so the
                stack reads as one structured block sitting between the
                subtotal tiles above and the ledger below rather than a loose
                pile of charts the height of a third unrelated card. */}
            <div className="flex flex-col gap-4 px-4 py-3.5">
              {totals.map((c, i) => (
                <div
                  key={c.currency}
                  className={`flex flex-col gap-2.5 min-w-0 ${i > 0 ? 'border-t border-border pt-4' : ''}`}
                >
                  <span className="ui-number text-sm font-semibold text-foreground">
                    {currencyLabel(c.currency)}
                  </span>
                  <AlternativesCashFlowChart
                    currency={c.currency}
                    columns={periodColumns(visibleEvents, c.currency, [])}
                    masked={masked}
                    onSelectPeriod={(period) => setDrilldown({ currency: c.currency, period })}
                  />
                </div>
              ))}
            </div>
          </TableCard>
        )}

        {/* ── The chronological ledger ────────────────────────────────────
            The landing target for the Dashboard's "View full activity history"
            action. `scroll-mt` keeps the section heading clear of the sticky
            chrome above it rather than tucking it underneath. */}
        <section
          ref={historyRef}
          id={CASH_FLOW_HISTORY_ANCHOR}
          tabIndex={-1}
          className="scroll-mt-6 min-w-0"
        >
          <TableCard
            title={a.cashFlowsTitle}
            controls={<EventLegend t={a} />}
            minWidth={720}
            // The full ledger runs to hundreds of events; capping the card keeps
            // the page walkable and makes the sticky column header actually
            // engage — the weekly full-changes table's own treatment.
            maxHeight={640}
            footer={
              <div className="nv-notes">
                <TableSourceFooter source={a.source} asOf={publishedAt} />
                <p className="ui-meta text-muted-fg">{a.signNote}</p>
                {coverage !== null && (
                  <p className="ui-meta text-muted-fg">
                    {a.windowLabel}{' '}
                    <span className="ui-number">
                      {coverage.firstEvent !== null ? formatIsoDateLabel(coverage.firstEvent) : '—'}{' '}
                      → {coverage.lastEvent !== null ? formatIsoDateLabel(coverage.lastEvent) : '—'}
                    </span>
                    {' · '}
                    {coverage.holdingsWithoutEvents === 0
                      ? a.coverageCompleteNote
                      : a.coverageNote
                          .replace('{withEvents}', String(coverage.holdingsWithEvents))
                          .replace('{total}', String(coverage.holdings))
                          .replace('{without}', String(coverage.holdingsWithoutEvents))}
                  </p>
                )}
                <span className="ui-meta text-muted-fg">
                  {visibleEvents.length} {a.eventsWord}
                </span>
              </div>
            }
          >
            {months.length === 0 ? (
              <p className="text-xs text-muted-fg py-6 text-center">{a.cashFlowsEmpty}</p>
            ) : (
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="border-b border-border-strong">
                    <th className={`${TH} text-left`} scope="col">{a.colDate}</th>
                    <th className={`${TH} text-left`} scope="col">{a.colEvent}</th>
                    <th className={`${TH} text-left`} scope="col">{a.colInvestment}</th>
                    <th className={`${TH} text-left`} scope="col">{a.colSociedad}</th>
                    <th className={`${TH} text-right`} scope="col">{a.colCurrency}</th>
                    <th className={`${TH} text-right`} scope="col">{a.colAmount}</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    // A month band plus its rows are siblings in one `<tbody>`, so
                    // the key belongs on the fragment, not on the first `<tr>`.
                    <Fragment key={m.month}>
                      {/* A quiet month marker (R13.R4A.1 owner review) — label,
                        air above, one strong rule below — instead of the tinted
                        accent stripe, which repeated per month read as zebra
                        noise. The date column restates the month on every row,
                        so the band only needs to mark the boundary. */}
                      <tr className="border-b border-border-strong">
                        <td colSpan={6} className="pl-4 pr-3 pt-4 pb-1.5 text-left ui-label text-muted-fg">
                          {monthBandLabel(m.month)}
                        </td>
                      </tr>
                      {m.events.map((e, i) => (
                        <tr
                          key={`${m.month}-${e.eventDate}-${e.investmentName ?? 'unknown'}-${i}`}
                          className="border-b border-border"
                        >
                          <td className={`${CELL} text-left ui-number whitespace-nowrap text-muted-fg`}>
                            {formatIsoDateLabel(e.eventDate)}
                          </td>
                          <td className={`${CELL} text-left whitespace-nowrap`}>
                            <EventTypeTag eventType={e.eventType} t={a} />
                          </td>
                          <td className={`${CELL} text-left`}>
                            <span className="block truncate max-w-[18rem]" title={e.investmentName ?? undefined}>
                              {e.investmentName ?? a.unknownInvestment}
                            </span>
                          </td>
                          <td className={`${CELL} text-left whitespace-nowrap text-muted-fg`}>
                            {e.sociedad ?? '—'}
                          </td>
                          <td className={`${CELL} text-right ui-number whitespace-nowrap text-muted-fg`}>
                            {currencyLabel(e.currency)}
                          </td>
                          <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                            <MaskedAmount value={e.amount} masked={masked} signed />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        </section>
      </div>

      {/* The same drill-down the Dashboard's charts open, over the FILTERED
          events the column was drawn from — so the dialog can never list a
          movement the chart above it did not count. */}
      <PeriodBreakdownModal
        open={drilldown !== null}
        onClose={() => setDrilldown(null)}
        breakdown={breakdown}
        masked={masked}
        asOf={publishedAt}
      />
    </div>
  )
}
