'use client'

// R13.R4A · R13.R4A.1 — Alternatives · DASHBOARD.
//
// The LP overview: what the book holds, what has been committed and drawn, and
// what cash has actually moved — all of it source-backed, and all of it fenced
// by currency.
//
// THE PAGE IS BUILT AROUND ONE STRUCTURAL FACT ABOUT THE SOURCE. Position
// figures (commitments, contributed capital, unfunded, current value) come from
// the workbook's master-data columns as of each investment's own last
// statement. Cash-flow figures (calls, distributions) exist ONLY in the
// workbook's event timeline, over its own window. Measured during the R13.R4A
// audit, those two parts do NOT reconcile: of the 34 holdings carrying both a
// contributions figure and timeline calls, only 18 agree within 0.5%.
//
// So the two are presented as two BLOCKS, divided, each naming its own basis —
// never interleaved into one column of numbers that would invite a reader to
// divide one by the other. That is also why no DPI, TVPI, RVPI or MOIC appears
// anywhere: every one of them is a ratio spanning the divide, and would be
// wrong for 15 of those 34 holdings. IRR is shown only on the Holdings view,
// where the workbook itself supplies it.
//
// R13.R4A.1 — THE CARD IS NOW THREE REGIONS: position, observed cash flow, and
// that flow drawn over time. The divide above is unchanged and still explicit;
// what changed is that the third region gives the cash-flow block a shape
// instead of four numbers, and that each card carries its OWN year selector.
// The period is deliberately per card and NOT shared: currencies are read
// independently here (that is the whole premise of the currency fence), and one
// global year would silently narrow a currency whose record does not even cover
// the selected period.
//
// EVERY SELECTABLE YEAR IS A YEAR THAT CURRENCY RECORDS — `cashFlowYears` reads
// them off the events, so a card can never offer a period that resolves to an
// empty view, and a currency with no events at all shows no selector and no
// chart rather than an empty frame.
//
// R13.R4A.1 visual pass (owner review): ONE EVENT LEGEND PER SECTION. The
// per-chart legends repeated the same four entries five times down one screen,
// so the cards section now carries a single legend above the first card and
// the annual card keeps its own — every chart still sits under a legend on the
// same screen, stated once per section instead of once per region. And a
// currency with no recorded events no longer stretches a left-third position
// block across the full card width: its position spreads over the same three
// column tracks the flow cards use (hero · figures · commitment drawn, divided
// by the same hairlines), with the honest no-events sentence closing the card
// — compact, and never an empty frame pretending to be a chart region.
//
// R13.R4A.3 — THE PAGE IS NOW ONE SECTION, NOT TWO. It was a stack of equal
// full-width currency cards followed by a second region pairing a multi-year
// chart block with the activity feed, which spent the whole page width on
// currencies holding one or two investments and left the feed with a column of
// air beside it. Now the LEAD currency (read off the data — the source's own
// first position) keeps the full-width three-region card, the remaining
// currencies fold into two columns down the wider track, and the activity feed
// takes the narrower one beside them at a fixed capacity that fills it. The
// multi-year `Cash flow by year` block moved to the Cash Flows view, where it
// sits between the per-currency subtotals and the ledger those very years are
// made of — one page for "what moved over time", one for "what the position
// is". Every figure, fence, disclosure and drill-down is unchanged by the move.
//
// NO CROSS-CURRENCY TOTAL EXISTS HERE (doc 03 § 4.2, decision D4). There is one
// card per currency and no grand total — not in a KPI, not in a chart axis, not
// in a footer. The source's own USD roll-up is `#NAME?`; NMI has no approved FX
// basis and does not invent one.
//
// EVERY DERIVATION IS THE PURE MODULE'S. The server already computed the
// unfiltered summaries with `alternativesView.ts`; a card narrowed to one year
// re-derives through the very same functions, so the two can never disagree.
//
// PRIVACY: every monetary value renders through `MaskedAmount`, in the cards, in
// the chart tooltip and inside both drill-downs. Counts and percentages follow
// the app's established policy — a count of investments is not an amount, and a
// drawn-percentage is a proportion, not a balance.

import Link from 'next/link'
import { useMemo, useState, type CSSProperties } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { TableCard } from '@/components/fable/TableCard'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { useAlternatives } from '@/components/familyPortfolio/AlternativesProvider'
import { AlternativesCashFlowChart } from '@/components/familyPortfolio/AlternativesCashFlowChart'
import { AlternativesMultiSelect } from '@/components/familyPortfolio/AlternativesFilters'
import {
  PeriodBreakdownModal,
  UndrawnCommitmentsModal,
} from '@/components/familyPortfolio/AlternativesDrilldowns'
import { EventLegend, EventTypeTag } from '@/components/familyPortfolio/AlternativesEventChrome'
import { altEventColorVar } from '@/lib/familyPortfolio/alternatives/eventPresentation'
import {
  cashFlowYears,
  commitmentDrawn,
  currencyCashFlows,
  currencyLabel,
  eventsInPeriods,
  periodBreakdown,
  periodColumns,
  recentEvents,
  undrawnCommitments,
  type AlternativesEventRead,
  type AlternativesHoldingRead,
  type CommitmentDrawn,
  type CurrencyCashFlow,
  type CurrencyPosition,
  type GroupColumnSum,
  type TimelineCoverage,
  type TimelineEvent,
  type UndrawnCommitment,
} from '@/lib/familyPortfolio/alternativesView'
import { CASH_FLOW_HISTORY_HREF } from '@/lib/familyPortfolio/alternativesRoutes'
import { formatIsoDateLabel, formatWeightPct } from '@/lib/formatters'
import type { Translation } from '@/lib/i18n'

type AltT = Translation['fp']['alternatives']

/**
 * How many movements the activity feed holds — a CAPACITY, not a page size.
 *
 * The panel never scrolls, so this constant is its height: the newest
 * `RECENT_LIMIT` movements are shown and the rest roll off the bottom as the
 * source publishes new ones. A new publication therefore changes WHAT the panel
 * lists without changing how tall it stands.
 *
 * 21 is measured, not guessed: on the current publication it renders the feed
 * at 1308px against a 1295px stack of secondary currency cards at both 1440 and
 * 1728 — 13px over, and 16px under at 1280 — and below `xl` the two stack
 * anyway, so the pairing stops mattering. That is a presentation fit, not a
 * claim about the data: a book carrying fewer recorded movements than this
 * simply renders a shorter panel, because `recentEvents` returns what exists
 * and never pads to a capacity. Re-measure this if a card's composition
 * changes — one row of this feed is ~56px, so the fit moves in whole rows.
 */
const RECENT_LIMIT = 21

/** `YYYY-MM-DD` → `MM-YYYY`, read off the string — never `new Date()`. */
function monthLabel(iso: string | null): string {
  if (iso === null) return '—'
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  return m ? `${m[2]}-${m[1]}` : iso
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// ---------------------------------------------------------------------------
// One labelled figure. `missing > 0` marks a subtotal that summed only the rows
// carrying a value — the module's established `*` convention, never a silent
// partial presented as complete.
// ---------------------------------------------------------------------------

function Figure({
  label,
  sum,
  masked,
  t,
}: {
  label: string
  sum: GroupColumnSum
  masked: boolean
  t: AltT
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="min-w-0 truncate text-muted-fg">
        {label}
        {sum.missing > 0 && (
          <span className="text-warning" title={t.subtotalPartialNote}>
            {' '}*
          </span>
        )}
      </dt>
      <dd className="ui-number shrink-0 text-foreground">
        <MaskedAmount value={sum.value} masked={masked} />
      </dd>
    </div>
  )
}

/**
 * The three master-data figures under the hero, in one place.
 *
 * Defined once because a card renders them from TWO different layouts — inside
 * the position column when the currency has recorded flow, and spread across
 * the tracks the flow regions would have taken when it has none. Two literal
 * copies would be two chances for a future change to reach one state of the
 * card and not the other, which is exactly how a currency ends up quietly
 * showing a different row set than its neighbours.
 */
function PositionFigures({
  position,
  masked,
  t,
  className = '',
  style,
}: {
  position: CurrencyPosition
  masked: boolean
  t: AltT
  className?: string
  style?: CSSProperties
}) {
  return (
    <dl className={`flex flex-col gap-1.5 ${className}`} style={style}>
      <Figure label={t.kpiCommitted} sum={position.commitments} masked={masked} t={t} />
      <Figure label={t.kpiContributed} sum={position.contributions} masked={masked} t={t} />
      <Figure label={t.kpiUnfunded} sum={position.unfunded} masked={masked} t={t} />
    </dl>
  )
}

/**
 * The Position block's anchor: the currency's current value at hero scale.
 *
 * R13.R4A.1 raised it from capsule (20px) to the hero step (40px) at the
 * owner's direction — it is the card's headline KPI and was reading as the
 * first of four sibling rows. Same figure, same `*` partial-subtotal
 * disclosure, same guarded `MaskedAmount` render path; only the typographic
 * weight moved.
 */
function CurrentValueHero({
  label,
  sum,
  masked,
  t,
}: {
  label: string
  sum: GroupColumnSum
  masked: boolean
  t: AltT
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="ui-label text-muted-fg">
        {label}
        {sum.missing > 0 && (
          <span className="text-warning" title={t.subtotalPartialNote}>
            {' '}*
          </span>
        )}
      </span>
      <MaskedAmount
        value={sum.value}
        masked={masked}
        className="ui-kpi-hero ui-number text-foreground"
      />
    </div>
  )
}

/** A signed cash-flow figure — the source's own sign, with its event count. */
function FlowFigure({
  label,
  amount,
  count,
  masked,
  strong = false,
  hollow = false,
  t,
}: {
  label: string
  amount: number
  count?: number
  masked: boolean
  strong?: boolean
  hollow?: boolean
  t: AltT
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? 'text-sm' : 'text-xs'}`}>
      <dt className={`min-w-0 truncate ${strong ? 'text-foreground' : 'text-muted-fg'}`}>
        {hollow && (
          <span
            aria-hidden="true"
            className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
            style={{ border: `2px solid ${altEventColorVar('unclassified')}` }}
          />
        )}
        {label}
        {count !== undefined && count > 0 && (
          <span className="text-muted-fg">
            {' '}
            · {count} {t.eventsWord}
          </span>
        )}
      </dt>
      <dd className={`ui-number shrink-0 text-foreground ${strong ? 'text-base font-semibold' : ''}`}>
        <MaskedAmount value={amount} masked={masked} signed />
      </dd>
    </div>
  )
}

/**
 * Commitment drawn — a proportion over the rows reporting BOTH operands, and
 * (R13.R4A.1) the entry point to the holdings behind the remainder.
 *
 * The whole figure is the control rather than a separate small link: the
 * question a reader has when they see "84,7% drawn" is "which ones are not",
 * and the answer belongs on the thing that raised it. It is a real `<button>`,
 * so it is keyboard-operable and announces itself; when nothing is left undrawn
 * — or the source carries no unfunded figure at all — it renders as static text
 * instead, because there would be nothing to open.
 */
function DrawnBlock({
  drawn,
  undrawn,
  onInspect,
  masked,
  t,
}: {
  drawn: CommitmentDrawn | null
  undrawn: UndrawnCommitment
  onInspect: () => void
  masked: boolean
  t: AltT
}) {
  if (drawn === null) {
    return <p className="ui-meta text-muted-fg">{t.fundingUnavailable}</p>
  }
  // A commitment can be over-drawn; the bar caps at 100% while the printed
  // percentage keeps the true figure.
  const width = Math.min(100, Math.max(0, drawn.ratio * 100))
  const partial = drawn.holdings !== drawn.ofHoldings
  // Openable when there is either something to list OR something to disclose:
  // a currency whose every commitment is drawn may still hold a row the source
  // gives no unfunded figure for, and that row is exactly what a reader should
  // be able to find out about rather than read "100% drawn" and stop.
  const inspectable = undrawn.holdings.length > 0 || undrawn.unavailable > 0

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="ui-label text-muted-fg">{t.fundingLabel}</span>
        <span className="ui-capsule-value ui-number text-foreground">
          {formatWeightPct(drawn.ratio)}
        </span>
      </div>
      <div
        className="h-2 w-full rounded-full overflow-hidden bg-surface-2"
        role="img"
        aria-label={`${t.fundingLabel} ${formatWeightPct(drawn.ratio)}`}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${width}%`, backgroundColor: 'var(--accent)' }}
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        {/* R13.R4A.2 — this count says how many holdings the PERCENTAGE was
            computed from, and it must say so. Printed bare as "34/38 holdings"
            beneath a heading reading "Commitment drawn", it was read as 34
            drawn and 4 undrawn — a different question entirely, answered by a
            different column over a measurably different set of rows (the
            breakdown behind this control). The label is the fix; the figure and
            the calculation are unchanged. */}
        {partial ? (
          <span className="ui-meta text-muted-fg" title={t.drawnBasisTitle}>
            {fill(t.drawnBasis, { n: drawn.holdings, total: drawn.ofHoldings })}
          </span>
        ) : (
          <span />
        )}
        {inspectable && (
          <span className="ui-meta text-accent">
            {t.undrawnOpen}
            {/* The remaining amount rides the affordance only when there IS a
                remaining amount; a currency opened purely to disclose an
                unreported row must not advertise a "0" that would read as a
                measured figure. */}
            {undrawn.holdings.length > 0 && (
              <>
                {' · '}
                <MaskedAmount value={undrawn.listedTotal} masked={masked} compact="unit" />
              </>
            )}
          </span>
        )}
      </div>
    </>
  )

  if (!inspectable) {
    return <div className="flex flex-col gap-1.5">{body}</div>
  }
  return (
    <button
      type="button"
      onClick={onInspect}
      title={t.undrawnOpen}
      className="flex flex-col gap-1.5 text-left rounded-[13px] -mx-2 px-2 py-1.5 nv-transition hover:bg-surface-2"
    >
      {body}
    </button>
  )
}

// ---------------------------------------------------------------------------
// One currency: position · observed cash flow · that flow over time.
//
// THREE REGIONS (R13.R4A.1). Before that pass the sparse currencies were
// compact third-width tiles, which left no room for a period selector or a
// chart — and the owner asked for both on every card. So every card carries the
// same three regions and differs only in what the source gives it. A currency
// with no recorded events shows its POSITION — hero, then the three figures,
// then commitment drawn — plus the no-events sentence: still no empty
// cash-flow frame, because an empty region would state a shape the source does
// not have. HOW those pieces sit follows the placement (see the two no-flow
// branches below): spread across the full-width tracks on a lead card, stacked
// beside the absence statement in the narrow placement.
//
// TWO PLACEMENTS OF THOSE SAME THREE REGIONS (R13.R4A.3). The book is one large
// currency and a tail of small ones — on the real publication, 38 USD holdings
// against 2 · 2 · 1 — and giving the tail the same full-width three-region form
// spent a full screen-width row on a card holding a single holding, while the
// activity feed sat below with a column of air beside it. So the LEAD currency
// (the source's own first position, i.e. the most holdings) keeps the
// full-width three-region form, and the remaining currencies fold those same
// three regions into two columns — cash flow stacked under the position it
// belongs to, the chart beside them — freeing the right-hand track for the
// activity feed. WHICH currency leads is read off the data, never named in
// code: a publication whose largest book is not USD composes correctly with no
// change here.
//
// The DATA is identical in both placements. Same figures, same pure functions,
// same per-card year selector, same drill-downs, same currency fence.
// ---------------------------------------------------------------------------

/**
 * What the chart is actually showing, in the heading.
 *
 * R13.R4A.5 — the three shapes `periodColumns` can return, named honestly:
 * no selection is every recorded year; one year is that year's months; several
 * years are those years as annual columns. The multi-year branch LISTS the
 * years while the list stays short and falls back to the count beyond that,
 * because a heading is a fixed-height line in a card track — spelling out eight
 * years would wrap it to four lines at the narrow placement, and a heading that
 * reflows the card is worse than one that says "5 selected" over an axis that
 * already labels every column.
 */
function chartTitle(selectedYears: readonly string[], t: AltT): string {
  if (selectedYears.length === 0) return t.annualFlowTitle
  if (selectedYears.length === 1) return `${t.monthlyTitle} · ${selectedYears[0]}`
  const detail =
    selectedYears.length <= 3
      ? selectedYears.join(' · ')
      : t.selectedYears.replace('{n}', String(selectedYears.length))
  return `${t.annualFlowTitle} · ${detail}`
}

function CurrencyCard({
  position,
  holdings,
  events,
  serverCashFlow,
  layout,
  masked,
  onInspectUndrawn,
  onSelectPeriod,
  t,
}: {
  position: CurrencyPosition
  holdings: readonly AlternativesHoldingRead[]
  events: readonly AlternativesEventRead[]
  /** The API's own unfiltered summary — used verbatim while no year narrows it. */
  serverCashFlow: CurrencyCashFlow | null
  /** How many tracks the card's three regions are laid across — see above. */
  layout: 'lead' | 'secondary'
  masked: boolean
  onInspectUndrawn: (currency: string) => void
  onSelectPeriod: (currency: string, period: string) => void
  t: AltT
}) {
  const code = currencyLabel(position.currency)
  // R13.R4A.5 — a SET of years, empty meaning the whole record, exactly as the
  // shared filter spells "all". Local to the card, per the per-currency rule
  // above: one currency's record does not authorize narrowing another's.
  const [selectedYears, setSelectedYears] = useState<string[]>([])

  const ownEvents = useMemo(
    () => events.filter((e) => e.currency === position.currency),
    [events, position.currency],
  )
  const years = useMemo(() => cashFlowYears(ownEvents), [ownEvents])

  // ONE SCOPED EVENT SET FEEDS THE FIGURES, THE CHART AND THE DRILL-DOWN.
  // The brief requires the observed cash-flow figures to use "exactly the same
  // selected-year set as the chart"; deriving both from this single value is
  // the only way that holds by construction rather than by two call sites
  // being trusted to pass the same argument.
  const scoped = useMemo(() => eventsInPeriods(ownEvents, selectedYears), [ownEvents, selectedYears])

  // Unnarrowed → the server's own summary, so parity holds by construction.
  // Narrowed → the SAME pure function over the scoped events.
  const cashFlow = useMemo(() => {
    if (selectedYears.length === 0) return serverCashFlow
    return currencyCashFlows(scoped)[0] ?? null
  }, [selectedYears, serverCashFlow, scoped])

  const columns = useMemo(
    () => periodColumns(ownEvents, position.currency, selectedYears),
    [ownEvents, position.currency, selectedYears],
  )
  const undrawn = useMemo(
    () => undrawnCommitments(holdings, position.currency),
    [holdings, position.currency],
  )
  const drawn = useMemo(
    () => commitmentDrawn(holdings, position.currency),
    [holdings, position.currency],
  )

  const hasFlow = ownEvents.length > 0
  const secondary = layout === 'secondary'
  const rule = { borderColor: 'var(--nv-line)' } as const

  // ── The three regions, each composed ONCE ─────────────────────────────
  // Written as values rather than repeated per branch: the two placements
  // differ only in which tracks they sit on, and a literal copy per layout is
  // exactly how one currency ends up quietly showing a different figure set
  // than its neighbours.

  const positionRegion = (
    <>
      <h3 className="ui-label text-muted-fg">{t.positionTitle}</h3>
      <CurrentValueHero label={t.kpiCurrentValue} sum={position.currentValue} masked={masked} t={t} />
      {hasFlow && (
        <>
          <PositionFigures
            position={position}
            masked={masked}
            t={t}
            className={secondary ? '' : 'max-w-[26rem]'}
          />
          <div className={secondary ? '' : 'max-w-[26rem]'}>
            <DrawnBlock
              drawn={drawn}
              undrawn={undrawn}
              onInspect={() => onInspectUndrawn(position.currency)}
              masked={masked}
              t={t}
            />
          </div>
        </>
      )}
    </>
  )

  const flowRegion = (
    <>
      {/* R13.R4A.5 visual pass — the multi-select trigger is a wider pill than
          the old select, so the pair gets a real column gap while side by side
          and a tighter row gap once it wraps under the heading; min-w-0 lets
          the trigger's own truncation work instead of widening the column. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 min-w-0">
        <h3 className="ui-label text-muted-fg shrink-0">{t.cashFlowTitle}</h3>
        <AlternativesMultiSelect
          label={t.filterYear}
          allLabel={t.allYears}
          selectedLabel={t.selectedYears}
          options={years}
          value={selectedYears}
          onChange={setSelectedYears}
        />
      </div>
      {cashFlow === null ? (
        // Reached only when the selected years hold no events for this
        // currency; the selector only offers years that do, so this is a
        // defensive state rather than an expected one.
        <p className="ui-meta text-muted-fg">{t.noFlowInPeriod}</p>
      ) : (
        <>
          {/* R13.R4A.3 visual pass — heading at the top, body centred in
              whatever height the row hands this region, meta line anchored at
              the bottom. The flow and chart regions share this grammar, so
              their tops AND bottoms align across the card instead of each
              region stopping at its own content and leaving a void under the
              shortest one. With no slack (stacked below lg, or the tallest
              track) the flex-1 wrapper is inert and nothing moves. */}
          <div className="flex-1 min-h-0 flex flex-col justify-center">
            <dl className="flex flex-col gap-1.5">
              <FlowFigure
                label={t.kpiCalls}
                amount={cashFlow.calls.amount}
                count={cashFlow.calls.count}
                masked={masked}
                t={t}
              />
              <FlowFigure
                label={t.kpiDistributions}
                amount={cashFlow.distributions.amount}
                count={cashFlow.distributions.count}
                masked={masked}
                t={t}
              />
              {cashFlow.unclassified.count > 0 && (
                <FlowFigure
                  label={t.kpiUnclassifiedAmount}
                  amount={cashFlow.unclassified.amount}
                  count={cashFlow.unclassified.count}
                  masked={masked}
                  hollow
                  t={t}
                />
              )}
              <div className="border-t border-border pt-1.5">
                <FlowFigure label={t.kpiNetFlow} amount={cashFlow.net} masked={masked} strong t={t} />
              </div>
            </dl>
          </div>
          <p className="ui-meta text-muted-fg">
            {t.windowLabel}{' '}
            <span className="ui-number">
              {monthLabel(cashFlow.firstEvent)} → {monthLabel(cashFlow.lastEvent)}
            </span>
          </p>
        </>
      )}
    </>
  )

  const chartRegion = (
    <>
      {/* No per-card legend (R13.R4A.1 owner review): the section-level legend
          above the cards names every colour once. */}
      <h3 className="ui-label text-muted-fg">{chartTitle(selectedYears, t)}</h3>
      {columns.length === 0 ? (
        <p className="ui-meta text-muted-fg">{t.noFlowInPeriod}</p>
      ) : (
        <>
          {/* Same top/centre/bottom grammar as the flow region: the plot
              breathes into the track's height instead of stacking against the
              heading and leaving the rest of the track empty — the void the
              narrow placement otherwise opens under a short chart — and the
              hint closes the region on the card's own bottom line. */}
          <div className="flex-1 min-h-0 flex flex-col justify-center">
            <AlternativesCashFlowChart
              currency={position.currency}
              columns={columns}
              masked={masked}
              onSelectPeriod={(period) => onSelectPeriod(position.currency, period)}
            />
          </div>
          <p className="ui-meta text-muted-fg">{t.chartClickHint}</p>
        </>
      )}
    </>
  )

  return (
    <GlassSurface variant="card" className="p-4 xl:p-5 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
        <span className="ui-number text-xl font-semibold text-foreground">{code}</span>
        <span className="ui-meta text-muted-fg">
          {position.investments} {t.kpiInvestments} · {position.holdings} {t.kpiHoldings} ·{' '}
          {position.sociedades} {t.kpiSociedades}
        </span>
        <span className="ui-meta text-muted-fg truncate" title={position.categories.join(' · ')}>
          {position.categories.join(' · ')}
        </span>
      </div>

      {!hasFlow ? (
        secondary ? (
          /* A currency with no recorded flow, in the NARROW track. The
             three-track spread below is built for the full page width; inside
             the 8-col track it stretched one small position thin across the
             row. So here the card keeps its SIBLINGS' two-track grammar
             instead — the whole position stacked down the left, exactly where
             every neighbouring card puts it — and the honest no-events
             sentence takes the track the chart would have occupied, centred
             in the space whose absence it explains. Same figures, same order,
             still no empty chart frame. */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-0">
            <div className="flex flex-col gap-3 min-w-0 lg:col-span-6 lg:pr-6">
              {positionRegion}
              <PositionFigures position={position} masked={masked} t={t} />
              <DrawnBlock
                drawn={drawn}
                undrawn={undrawn}
                onInspect={() => onInspectUndrawn(position.currency)}
                masked={masked}
                t={t}
              />
            </div>
            <div
              className="flex flex-col justify-center min-w-0 border-t pt-4 lg:col-span-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
              style={rule}
            >
              <p className="text-xs text-muted-fg text-center py-6 lg:py-0">
                {t.noRecordedEvents}
              </p>
            </div>
          </div>
        ) : (
          /* A LEAD currency with no recorded flow spreads the SAME position
             figures across the tracks the flow regions would occupy — same
             hairline dividers, same figures, no empty chart frame — and
             states the absence once, closing the card. Only the full-width
             placement uses this spread: a single stacked column at full width
             would leave two empty tracks beside it. */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-0">
            <div className="flex flex-col gap-3 min-w-0 lg:col-span-4 lg:pr-6">{positionRegion}</div>
            <PositionFigures
              position={position}
              masked={masked}
              t={t}
              className="justify-center min-w-0 border-t pt-4 lg:col-span-4 lg:border-t-0 lg:border-l lg:pt-0 lg:px-6"
              style={rule}
            />
            <div
              className="flex flex-col justify-center min-w-0 border-t pt-4 lg:col-span-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
              style={rule}
            >
              <DrawnBlock
                drawn={drawn}
                undrawn={undrawn}
                onInspect={() => onInspectUndrawn(position.currency)}
                masked={masked}
                t={t}
              />
            </div>
            <p className="ui-meta text-muted-fg lg:col-span-12 border-t pt-3 lg:mt-4" style={rule}>
              {t.noRecordedEvents}
            </p>
          </div>
        )
      ) : secondary ? (
        /* TWO TRACKS. Position and its observed cash flow stack down the left —
           they are the two halves of one reading, and the divide between them
           is the same hairline that separates them side by side on the lead
           card — with the chart taking the right. The flow group carries
           flex-1 so that when the CHART track is the taller one, the left
           column's slack lands inside the flow region (whose own internal
           flex-1 centres the figures) rather than as a void under the window
           line — both tracks close on the same bottom edge either way. */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-0">
          <div className="flex flex-col gap-4 min-w-0 lg:col-span-6 lg:pr-6">
            <div className="flex flex-col gap-3 min-w-0">{positionRegion}</div>
            <div className="flex-1 flex flex-col gap-3 min-w-0 border-t pt-4" style={rule}>
              {flowRegion}
            </div>
          </div>
          <div
            className="flex flex-col gap-2 min-w-0 lg:col-span-6 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
            style={rule}
          >
            {chartRegion}
          </div>
        </div>
      ) : (
        /* THREE TRACKS, full width — the lead currency. */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-0">
          <div className="flex flex-col gap-3 min-w-0 lg:col-span-4 lg:pr-6">{positionRegion}</div>
          <div
            className="flex flex-col gap-3 min-w-0 lg:col-span-3 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:px-6"
            style={rule}
          >
            {flowRegion}
          </div>
          <div
            className="flex flex-col gap-2 min-w-0 lg:col-span-5 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
            style={rule}
          >
            {chartRegion}
          </div>
        </div>
      )}
    </GlassSurface>
  )
}

// ---------------------------------------------------------------------------
// Recent activity — a FIXED-CAPACITY rolling feed (R13.R4A.3)
//
// The panel shows the newest `RECENT_LIMIT` movements in the book and NOTHING
// scrolls inside it: capacity is the height. A new publication pushes new
// movements in at the top and the oldest visible ones off the bottom, and the
// panel stands exactly as tall as it did before — which is what lets it sit
// beside the secondary currency cards without either side dictating the
// other's height.
//
// EVERY CURRENCY, NOT THE ONES BESIDE IT. The feed is book-wide and always has
// been; placing it in the same row as the secondary cards is a layout decision
// and must not be read as a scope. Each row carries its own currency code
// beside the amount, and the footer says so outright.
// ---------------------------------------------------------------------------

function RecentActivityCard({
  recent,
  coverage,
  publishedAt,
  masked,
  a,
}: {
  recent: readonly TimelineEvent[]
  coverage: TimelineCoverage | null
  publishedAt: string | null
  masked: boolean
  a: AltT
}) {
  return (
    <TableCard
      title={a.recentTitle}
      // R13.R4A.4 — OUT OF THE FEED, INTO THE HEADER. The feed's height IS its
      // capacity (see RECENT_LIMIT), measured against the currency stack beside
      // it; an action appended below the last row would have added its own
      // height to that pairing and pushed the two out of alignment. The card
      // header is a row that already exists, so this costs the feed nothing
      // vertically. In-app `Link` — same tab, client navigation — and the hash
      // lands the reader ON the history table rather than the top of the page.
      //
      // THE DRESS IS THE APP'S SECONDARY IN-CARD ACTION (DetailPanel's
      // full-page link: accent text, underline on hover), stepped to medium so
      // it reads as an action beside the muted card title rather than as body
      // text; the global :focus-visible ring covers keyboard focus. The arrow
      // is `aria-hidden` — it is a cue, not part of the name.
      //
      // WHAT IT COSTS THE HEADER, MEASURED. In English the header holds one
      // line at every width (38px at 1440 and at 1280). In Spanish the string
      // is half again as long and `TableCard`'s header — a `flex-wrap` row —
      // sends the whole action to a second line at ≤1280: 62px, +24. That is
      // fine and it is deliberate that it is fine. The feed is not PINNED to
      // the currency stack; the two are independent columns whose heights only
      // want to land near each other, and 24px is under half of one feed row
      // (~56px) — measured at ES/1280 the two end within 10px of each other.
      // The label still carries `min-w-0 truncate` as the floor beneath that:
      // if the card is ever narrower than the link itself, the text ellipsizes
      // inside the pill rather than overflowing it, with `title` restating it
      // on hover and the DOM keeping the complete accessible name.
      controls={
        <Link
          href={CASH_FLOW_HISTORY_HREF}
          title={a.recentViewAll}
          className="min-w-0 inline-flex items-baseline gap-1 text-xs font-medium text-accent hover:underline nv-transition"
        >
          <span className="min-w-0 truncate">{a.recentViewAll}</span>
          <span aria-hidden="true" className="shrink-0">
            →
          </span>
        </Link>
      }
      footer={
        <div className="nv-notes">
          <TableSourceFooter source={a.source} asOf={publishedAt} />
          <p className="ui-meta text-muted-fg">{a.recentAllCurrencies}</p>
          {coverage !== null && (
            <p className="ui-meta text-muted-fg">
              {coverage.holdingsWithoutEvents === 0
                ? a.coverageCompleteNote
                : fill(a.coverageNote, {
                    withEvents: coverage.holdingsWithEvents,
                    total: coverage.holdings,
                    without: coverage.holdingsWithoutEvents,
                  })}
            </p>
          )}
        </div>
      }
    >
      {recent.length === 0 ? (
        <p className="text-xs text-muted-fg py-6 text-center">{a.noRecordedEvents}</p>
      ) : (
        <ul className="flex flex-col">
          {recent.map((e, i) => (
            <li
              key={`${e.eventDate}-${e.investmentName ?? 'unknown'}-${i}`}
              className="flex flex-col gap-0.5 border-b border-border last:border-b-0 px-4 py-2 text-xs"
            >
              <div className="flex items-baseline justify-between gap-3 min-w-0">
                <span className="min-w-0 truncate" title={e.investmentName ?? undefined}>
                  {e.investmentName ?? a.unknownInvestment}
                </span>
                <span className="ui-number whitespace-nowrap shrink-0">
                  <MaskedAmount value={e.amount} masked={masked} signed />
                  <span className="text-muted-fg"> {currencyLabel(e.currency)}</span>
                </span>
              </div>
              <div className="flex items-baseline gap-2 min-w-0 text-muted-fg">
                <span className="ui-number shrink-0">{formatIsoDateLabel(e.eventDate)}</span>
                <EventTypeTag eventType={e.eventType} t={a} />
                {e.sociedad !== null && <span className="truncate">· {e.sociedad}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </TableCard>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AlternativesDashboardPage() {
  const { t } = useLang()
  const a = t.fp.alternatives
  const [masked] = usePrivacyMode()
  const { data } = useAlternatives()

  const holdings = useMemo(() => data?.holdings ?? [], [data])
  const events = useMemo(() => data?.events ?? [], [data])
  const positions = data?.positions ?? []
  const cashFlows = data?.cashFlows ?? []
  const coverage = data?.coverage ?? null
  const publishedAt = data?.publication?.publishedAt ?? null

  const cashFlowByCurrency = new Map(cashFlows.map((c) => [c.currency, c]))
  const recent = recentEvents(events, holdings, RECENT_LIMIT)

  // THE LEAD CURRENCY IS READ OFF THE DATA. `positions` arrives ordered by
  // holding count — a non-monetary dimension, so ordering by it crosses no
  // currency fence — and the first entry takes the full-width card while the
  // rest share their row with the activity feed. No currency code appears in
  // this decision: a publication led by a currency other than USD, or holding
  // only one currency, composes correctly with nothing changed here.
  const [lead, ...secondary] = positions

  // The two drill-downs. Both are keyed by currency, so a dialog can never show
  // one currency's figures under another's heading.
  const [drilldown, setDrilldown] = useState<{ currency: string; period: string } | null>(null)
  const [undrawnCurrency, setUndrawnCurrency] = useState<string | null>(null)

  const breakdown = useMemo(
    () =>
      drilldown === null
        ? null
        : periodBreakdown(events, holdings, drilldown.currency, drilldown.period),
    [drilldown, events, holdings],
  )
  const undrawn = useMemo(
    () => (undrawnCurrency === null ? null : undrawnCommitments(holdings, undrawnCurrency)),
    [undrawnCurrency, holdings],
  )
  // The dialog states the two bases side by side, so it needs the ratio the
  // card was showing as well as the partition behind it — the same pure
  // function the card itself calls, over the same holdings.
  const undrawnDrawn = useMemo(
    () => (undrawnCurrency === null ? null : commitmentDrawn(holdings, undrawnCurrency)),
    [undrawnCurrency, holdings],
  )

  const activity = (
    <RecentActivityCard
      recent={recent}
      coverage={coverage}
      publishedAt={publishedAt}
      masked={masked}
      a={a}
    />
  )

  return (
    <div className="flex flex-col gap-5">
      {/* ── One card per currency — never a blended total ──────────────────
          The cards sit a half-step tighter (gap-4) than the page's section
          rhythm (gap-5), so the four currencies read as one group and the
          annual/recent region below reads as the next. ONE legend serves the
          whole group — rendered only when at least one currency records
          events, i.e. exactly when a chart exists for it to explain. */}
      <section className="flex flex-col gap-4">
        {events.length > 0 && (
          <div className="flex justify-end">
            <EventLegend t={a} />
          </div>
        )}

        {lead !== undefined && (
          <CurrencyCard
            key={lead.currency}
            position={lead}
            holdings={holdings}
            events={events}
            serverCashFlow={cashFlowByCurrency.get(lead.currency) ?? null}
            layout="lead"
            masked={masked}
            onInspectUndrawn={setUndrawnCurrency}
            onSelectPeriod={(currency, period) => setDrilldown({ currency, period })}
            t={a}
          />
        )}

        {/* ── The tail currencies beside the activity feed ─────────────────
            Two tracks, and the feed takes the narrower one: it is a fixed-width
            list of rows, so extra width only stretches its whitespace, while
            each currency card carries a chart that uses everything it is given.
            The feed is sized to stand as tall as the stack beside it (see
            RECENT_LIMIT) — matched by capacity rather than by a stretch, so it
            fills its track with movements instead of air. */}
        {secondary.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            <div className="xl:col-span-8 min-w-0 flex flex-col gap-4">
              {secondary.map((p) => (
                <CurrencyCard
                  key={p.currency}
                  position={p}
                  holdings={holdings}
                  events={events}
                  serverCashFlow={cashFlowByCurrency.get(p.currency) ?? null}
                  layout="secondary"
                  masked={masked}
                  onInspectUndrawn={setUndrawnCurrency}
                  onSelectPeriod={(currency, period) => setDrilldown({ currency, period })}
                  t={a}
                />
              ))}
            </div>
            <div className="xl:col-span-4 min-w-0">{activity}</div>
          </div>
        ) : (
          // A single-currency book has no tail to sit beside; the feed takes
          // the full width rather than leaving an empty track next to itself.
          activity
        )}
      </section>

      {/* ── The three disclosures that make the blocks safe to read together ─
          A hairline above them, in the page's own divider weight: they are the
          section's footnotes, and without the rule they floated under the grid
          as a fourth, unattached region instead of closing the page.

          THE NO-CROSS-CURRENCY NOTE BELONGS HERE, at page level. It used to
          ride the footer of the by-year card, so relocating that card to the
          Cash Flows view took the disclosure with it and left a page carrying
          four currencies' worth of sums with nothing saying they are never
          added together. It was never really that card's note — every card
          above states its own denomination — so it now closes the page beside
          the other two, where its scope actually is. */}
      <div className="nv-notes border-t border-border pt-4">
        <p className="ui-meta text-muted-fg">{a.basisNote}</p>
        <p className="ui-meta text-muted-fg">{a.noRatioNote}</p>
        <p className="ui-meta text-muted-fg">{a.noCrossCurrencyNote}</p>
      </div>

      <PeriodBreakdownModal
        open={drilldown !== null}
        onClose={() => setDrilldown(null)}
        breakdown={breakdown}
        masked={masked}
        asOf={publishedAt}
      />
      <UndrawnCommitmentsModal
        open={undrawnCurrency !== null}
        onClose={() => setUndrawnCurrency(null)}
        undrawn={undrawn}
        drawn={undrawnDrawn}
        masked={masked}
        asOf={publishedAt}
      />
    </div>
  )
}
