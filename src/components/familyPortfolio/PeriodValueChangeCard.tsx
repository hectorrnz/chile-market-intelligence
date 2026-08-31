'use client'

// R13.R3C — *Contributors and Detractors of Portfolio Value Change*, the
// Summary card that stands beside Portfolio Evolution.
//
// ── WHAT REPLACED WHAT, AND WHY ────────────────────────────────────────────
//
// R13.R3A built a true cumulative bridge on `/portfolio/weekly-changes`;
// R13.R3B kept the bridge and widened its window to whole periods, which fixed
// the legibility problem but kept a shape that asks the reader to follow a
// running total. R13.R3C answers the question people actually bring to this
// card — WHICH POSITIONS MOVED THE PORTFOLIO, AND BY HOW MUCH — with a
// zero-centred, magnitude-ranked bar chart, and moves the running-total
// checking into a popup that opens on any bar the source can decompose.
//
// The MEASURE is untouched across all three passes: a component's change is
// still `closing_value − opening_value` from two real published snapshots, and
// the set still has to reconcile to the portfolio's own change.
//
// ── THIS CARD ANSWERS A DIFFERENT QUESTION FROM ITS NEIGHBOUR ──────────────
//
// Portfolio Evolution plots a FLOW-ADJUSTED analytical path: external
// contributions and withdrawals removed, so a week the family moved money does
// not read as performance. THIS card decomposes the ACTUAL published change in
// portfolio value between two real published weeks — which contains whatever
// capital moved, because it is the difference of two balance sheets. The two
// cards therefore report DIFFERENT numbers for the same window, on purpose,
// and each says which it is in its own chip. Neither is an investment return:
//
//     Actual Portfolio Value Change  =  Weekly P&L  +  Net Flows
//
// and this card decomposes the LEFT side by asset, never the right side into
// performance and flows. Over a multi-week range the source's own single-week
// `flow` / `weekly_profit` / `weekly_return` figures describe the wrong period
// and the API withholds them (`suppressSingleWeekMetrics`) — so the card
// cannot show them even by accident.
//
// ── NO FINANCIAL SEMANTICS LIVE IN THIS FILE ───────────────────────────────
//
// Every figure comes from the API response or from a pure module. The range is
// resolved by `selectValueChangeRange`; the components by `deriveDrivers` /
// `contributionChildren` over only the nodes RLS already released to this
// caller; the subject by `resolveSubject`; the ranking, omissions, shares,
// residual and axis by `buildContributionSet` / `contributionAxis`. Nothing
// here sums, ranks, re-orders or derives anything — the suite asserts this
// file contains no `.sort(` and no `.reduce(`.
//
// ── FAIL CLOSED ───────────────────────────────────────────────────────────
//
// A period that resolves to fewer than two published weeks is reported as such
// and NEVER requested — a zero change would read as "flat". A subject absent
// from either endpoint is withheld rather than drawn on a structural zero. No
// date is snapped, interpolated or invented.

import { useEffect, useMemo, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { AsyncState } from '@/components/fable/AsyncState'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MaskedAmount } from './MaskedAmount'
import { ContributionChart } from './ContributionChart'
import { ContributionBreakdownModal } from './ContributionBreakdownModal'
import { usePersistentState } from '@/lib/usePersistentState'
import { formatRatioPct, formatIsoDateLabel } from '@/lib/formatters'
import { dict } from '@/lib/i18n'
import {
  contributionChildren,
  deriveDrivers,
  type ChangeNode,
  type DriverGrouping,
} from '@/lib/familyPortfolio/weeklyChanges'
import { buildContributionSet, contributionAxis } from '@/lib/familyPortfolio/contributionChart'
import { omittedZeroSentence } from '@/lib/familyPortfolio/contributionLabels'
import {
  COMBINED_SUBJECT,
  derivePortfolioSubjects,
  resolveSubject,
  subjectLabelOverrides,
} from '@/lib/familyPortfolio/portfolioSubject'
import {
  VALUE_CHANGE_PERIODS,
  isValueChangePeriod,
  selectValueChangeRange,
  type ValueChangePeriod,
} from '@/lib/familyPortfolio/valueChangeRange'
import {
  fetchFamilyPortfolioWeeklyChanges,
  type FamilyPortfolioWeek,
  type WeeklyChangesResponse,
} from '@/lib/data/familyPortfolio'

/**
 * The residual's label, in BOTH languages, from the ONE dictionary the card
 * also reads — so a bar label and the card's own copy can never drift apart.
 * Period-NEUTRAL by design: the route bakes in the Weekly Changes wording, and
 * over a one-year range "this week" would be false.
 */
const RESIDUAL_LABEL = {
  es: dict.es.fp.contrib.residual,
  en: dict.en.fp.contrib.residual,
} as const

/**
 * There is deliberately no `loading` member. Loading is DERIVED — a slot whose
 * key is not the key currently being requested simply is not the answer yet —
 * rather than written into state from inside an effect, which is the app's
 * standing React-Compiler discipline (no `setState` in an effect body).
 */
type Phase = 'ready' | 'denied' | 'error'

interface Slot {
  key: string
  phase: Phase
  data: WeeklyChangesResponse | null
}

const NO_NODES: ChangeNode[] = []
/** Main's labels are the source's own; a stable empty map keeps the memo cheap. */
const NO_OVERRIDES: ReadonlyMap<string, string> = new Map()

interface PeriodValueChangeCardProps {
  /** The entitled scope already resolved by the page. Null → nothing to fetch. */
  scope: string | null
  masked: boolean
  /** Source attribution — the page's own, so both cards cite one string. */
  source: string
}

export function PeriodValueChangeCard({ scope, masked, source }: PeriodValueChangeCardProps) {
  const { t, lang } = useLang()
  const o = t.fp.overview
  const c = t.fp.contrib

  // Defaults to ALL, matching the Evolution card beside it, so on first load
  // the two cards describe the same span rather than two different ones.
  const [period, setPeriod] = usePersistentState<ValueChangePeriod>('cmi.fpVwfPeriod', 'ALL')
  const safePeriod = isValueChangePeriod(period) ? period : 'ALL'

  // ── The publication spine, fetched once per scope ────────────────────────
  // The range endpoints must be REAL published weeks (the route refuses any
  // other, and never snaps to a nearest date), and no lighter endpoint
  // publishes that list.
  //
  // A FAILED spine read is kept apart from an EMPTY one. Both would leave the
  // list at zero weeks, but "nothing has been published" and "the book could
  // not be reached" are different statements about the portfolio.
  const [weeks, setWeeks] = useState<{
    key: string
    ok: boolean
    list: FamilyPortfolioWeek[]
  } | null>(null)

  useEffect(() => {
    if (scope === null) return
    let cancelled = false
    ;(async () => {
      const result = await fetchFamilyPortfolioWeeklyChanges(scope)
      if (cancelled) return
      setWeeks({ key: scope, ok: result.ok, list: result.ok ? (result.data.weeks ?? []) : [] })
    })()
    return () => {
      cancelled = true
    }
  }, [scope])

  const spineSlot = weeks !== null && weeks.key === scope ? weeks : null
  const spine = spineSlot !== null && spineSlot.ok ? spineSlot.list : null

  const range = useMemo(
    () => (spine === null ? null : selectValueChangeRange(spine, safePeriod)),
    [spine, safePeriod],
  )

  // ── The comparison itself ────────────────────────────────────────────────
  // Requested ONLY for a range that resolved to two distinct published weeks.
  const requestKey =
    scope !== null && range !== null && range.state === 'ok'
      ? `${scope}|${range.fromDate}|${range.toDate}`
      : null
  const [slot, setSlot] = useState<Slot | null>(null)

  useEffect(() => {
    if (scope === null || range === null || range.state !== 'ok' || requestKey === null) return
    let cancelled = false
    ;(async () => {
      const result = await fetchFamilyPortfolioWeeklyChanges(scope, range.toDate, range.fromDate)
      if (cancelled) return
      if (!result.ok) {
        setSlot({ key: requestKey, phase: result.status === 403 ? 'denied' : 'error', data: null })
        return
      }
      setSlot({ key: requestKey, phase: 'ready', data: result.data })
    })()
    return () => {
      cancelled = true
    }
  }, [scope, range, requestKey])

  const active = slot !== null && slot.key === requestKey ? slot : null
  const data = active?.phase === 'ready' ? active.data : null

  // ── Subject ──────────────────────────────────────────────────────────────
  // Main tiles by asset class; a personal book tiles by sociedad. The same
  // rule the Weekly Changes page applies, derived here rather than transported,
  // so the two surfaces cannot disagree about what a scope's components are.
  const grouping: DriverGrouping = scope === 'main' ? 'top_level' : 'sociedad'
  const nodes = data?.state === 'ok' && data.nodes ? data.nodes : NO_NODES
  const drivers = useMemo(() => deriveDrivers(nodes, grouping), [nodes, grouping])
  const subjects = useMemo(() => derivePortfolioSubjects(nodes, drivers), [nodes, drivers])

  // R13.R3C.2 — the display names for this book's sociedad-grain rows, used by
  // the pills, the bars, the x-axis, the tooltip, the omission footnote and the
  // popup heading alike. MAIN GETS NONE: its components are asset classes and
  // individual holdings whose labels are the source's own, and title-casing a
  // shouted brand there would rewrite a name the book actually publishes.
  const labelOverrides = useMemo(
    () => (scope === 'main' ? NO_OVERRIDES : subjectLabelOverrides(subjects, lang)),
    [scope, subjects, lang],
  )

  // A subject key names a hierarchy row, which is SCOPE-BOUND: carrying one
  // across a scope switch would either resolve to nothing or — far worse —
  // collide with another member's row. So it is plain state, reset on the
  // render where the scope changes, never persisted.
  const [subjectKey, setSubjectKey] = useState<string>(COMBINED_SUBJECT)
  const [prevScope, setPrevScope] = useState(scope)
  if (scope !== prevScope) {
    setPrevScope(scope)
    setSubjectKey(COMBINED_SUBJECT)
  }
  // A period switch can legitimately retire a sociedad (a book that did not yet
  // hold it). Falling back keeps the card on a real subject instead of an
  // empty one, without needing an effect to notice.
  const safeSubjectKey = subjects.some((s) => s.key === subjectKey) ? subjectKey : COMBINED_SUBJECT

  const resolved = useMemo(
    () => resolveSubject(nodes, drivers, data?.total ?? null, safeSubjectKey),
    [nodes, drivers, data, safeSubjectKey],
  )

  const set = useMemo(
    () =>
      buildContributionSet({
        openingValue: resolved.state === 'lifecycle_gap' ? null : resolved.openingValue,
        closingValue: resolved.state === 'lifecycle_gap' ? null : resolved.closingValue,
        components: resolved.components,
        isDrillable: (key) => contributionChildren(nodes, key).length > 0,
        residualLabel: RESIDUAL_LABEL,
      }),
    [resolved, nodes],
  )
  const axis = useMemo(() => contributionAxis(set.items.map((i) => i.value)), [set])

  // R13.R3C.2 — the omitted components are NAMED, not counted. "1 component(s)
  // did not move" reads as a hole in the data; naming them states a fact about
  // the period. Same names the bars would have carried, so the disclosure and
  // the plot cannot describe different entities.
  const omittedNote = omittedZeroSentence(
    set.omittedZero,
    lang,
    { template: c.zeroOmittedNames, more: c.zeroOmittedMore },
    labelOverrides,
  )

  const [openKey, setOpenKey] = useState<string | null>(null)

  const tone =
    set.netChange != null && set.netChange > 0
      ? 'text-positive'
      : set.netChange != null && set.netChange < 0
        ? 'text-negative'
        : 'text-muted-fg'

  const periodLabel = (p: ValueChangePeriod) =>
    p === '1M'
      ? o.evoPeriod1M
      : p === '3M'
        ? o.evoPeriod3M
        : p === 'YTD'
          ? o.evoPeriodYTD
          : p === '1Y'
            ? o.evoPeriod1Y
            : o.evoPeriodALL

  const windowLabel =
    range?.fromDate && range?.toDate
      ? `${periodLabel(safePeriod)} · ${formatIsoDateLabel(range.fromDate)} — ${formatIsoDateLabel(range.toDate)}`
      : periodLabel(safePeriod)

  /** The one honest message for whatever is not a drawable chart. */
  const emptyMessage: string | null =
    // No entitled scope resolved, so nothing is ever fetched — say so rather
    // than spin forever on a request that will not be made.
    scope === null
      ? o.vwfUnavailable
      : range !== null && range.state === 'no_publications'
        ? o.vwfNoPublications
        : range !== null && range.state === 'single_week'
          ? o.vwfSingleWeek
          : data !== null && data.state === 'no_previous_week'
            ? o.vwfEarliestWeek
            : data !== null && data.state !== 'ok'
              ? o.vwfUnavailable
              : // A subject absent from one endpoint would open on a structural
                // zero. The combined portfolio and a sociedad get the wording
                // that names which of the two the reader is looking at.
                resolved.state === 'lifecycle_gap'
                ? safeSubjectKey === COMBINED_SUBJECT
                  ? o.vwfTotalRowLifecycle
                  : o.vwfSubjectLifecycle
                : resolved.state === 'no_decomposition'
                  ? c.noDecomposition
                  : data !== null && set.status === 'unavailable'
                    ? o.vwfUnavailable
                    : null

  const spineFailed = spineSlot !== null && !spineSlot.ok
  const busy = scope !== null && !spineFailed && (spine === null || (requestKey !== null && active === null))

  return (
    <GlassSurface variant="card" as="section" className="px-5 sm:px-6 py-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
            <h2 className="ui-label text-foreground">{o.vwfTitle}</h2>
            {/* The counterpart to the Evolution card's flow-adjusted chip. Two
                cards side by side reporting different numbers for the same
                window is only honest if each says which number it is. */}
            <span
              className="ui-meta font-medium leading-snug inline-flex items-center px-2.5 py-1 rounded-full max-w-full"
              style={{
                color: 'var(--accent)',
                backgroundColor: 'color-mix(in oklab, var(--accent) 14%, transparent)',
              }}
            >
              {o.vwfActualChip}
            </span>
          </div>

          {/* The window is named in the card's own column — the period label a
              control carries, then the two REAL published dates it resolved to,
              so "3M" can never stand in for a span the record could not give. */}
          <p className="ui-meta text-muted-fg mt-1.5 ui-number">{windowLabel}</p>

          {/* Opening → closing → change. The two levels are the endpoints the
              whole decomposition is a difference of, so showing the change
              without them leaves the reader unable to size it. One KPI strip:
              hairline dividers group the three figures (the same device the
              Evolution card beside this one uses between its two figures), the
              endpoints stay at card-value scale, and the CHANGE — the figure
              this card exists to decompose — leads at chart-headline scale in
              its own tone. */}
          {set.status !== 'unavailable' && (
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3 mt-3.5 min-w-0">
              <Figure
                label={o.vwfOpeningLabel}
                meta={range?.fromDate != null ? formatIsoDateLabel(range.fromDate) : null}
                value={set.openingValue}
                masked={masked}
              />
              <Figure
                label={o.vwfClosingLabel}
                meta={range?.toDate != null ? formatIsoDateLabel(range.toDate) : null}
                value={set.closingValue}
                masked={masked}
                divider
              />
              <Figure
                label={o.vwfChangeLabel}
                meta={formatRatioPct(set.netChangeRatio)}
                value={set.netChange}
                masked={masked}
                signed
                tone={tone}
                divider
              />
            </div>
          )}
        </div>

        <div className="sm:ml-auto flex flex-col items-start sm:items-end gap-2 min-w-0 max-w-full">
          <div className="max-w-full overflow-x-auto nv-scrollbar-hidden">
            <SegmentedControl
              options={VALUE_CHANGE_PERIODS.map((p) => ({ value: p, label: periodLabel(p) }))}
              value={safePeriod}
              onChange={(v) => setPeriod(v)}
              ariaLabel={o.evoPeriodLabel}
              remeasureToken={lang}
            />
          </div>
          {/* Only a personal book has sociedades to choose between; Main's
              components are asset classes and it gets no subject rail. */}
          {subjects.length > 1 && scope !== 'main' && (
            <div className="max-w-full overflow-x-auto nv-scrollbar-hidden">
              <SegmentedControl
                options={subjects.map((s) => ({
                  value: s.key,
                  label:
                    s.key === COMBINED_SUBJECT
                      ? o.vwfSubjectCombined
                      : (labelOverrides.get(s.key) ?? s.key),
                }))}
                value={safeSubjectKey}
                onChange={(v) => setSubjectKey(v)}
                ariaLabel={o.vwfSubjectSelector}
                remeasureToken={`${lang}|${scope ?? ''}|${safePeriod}`}
              />
            </div>
          )}
        </div>
      </div>

      {/* The body reserves the Evolution chart's footprint and takes the
          equal-height row's slack, so a period switch or a transient loading /
          empty / error state never collapses the card below its sibling, and
          the footer rule lands on the same bottom edge as the Evolution
          card's. Layout only: every branch inside it is unchanged. */}
      <div className="flex-1 min-h-[17.5rem] min-w-0 flex flex-col justify-center">
        {busy ? (
          <AsyncState kind="loading" />
        ) : spineFailed || active?.phase === 'denied' || active?.phase === 'error' ? (
          <AsyncState kind="error" />
        ) : emptyMessage !== null ? (
          <AsyncState kind="empty" message={emptyMessage} />
        ) : (
          <ContributionChart
            set={set}
            axis={axis}
            masked={masked}
            onSelect={(key) => setOpenKey(key)}
            emptyText={c.chartEmpty}
            ariaLabel={o.vwfTitle}
            labelOverrides={labelOverrides}
          />
        )}
      </div>

      <div className="nv-notes pt-2.5" style={{ borderTop: '1px solid var(--nv-line)' }}>
        <TableSourceFooter source={source} asOf={data?.publication?.publishedAt ?? undefined} />
        {range?.state === 'ok' && range.weekCount !== null && (
          <p className="ui-meta text-muted-fg">
            {o.vwfWindowLabel}: {range.weekCount} {o.vwfWeeksSuffix}
          </p>
        )}
        <p className="ui-meta text-muted-fg">{o.vwfNote}</p>
        {/* Omissions are disclosed, never silent. */}
        {omittedNote !== null && <p className="ui-meta text-muted-fg">{omittedNote}</p>}
        {set.unavailable.length > 0 && <p className="ui-meta text-muted-fg">{c.reconcileIndeterminate}</p>}
        {set.unavailable.length === 0 && set.status === 'partial' && (
          <p className="ui-meta text-muted-fg">{c.reconcileResidual}</p>
        )}
        {range?.truncatedByHistory === true && <p className="ui-meta text-muted-fg">{o.vwfTruncated}</p>}
      </div>

      <ContributionBreakdownModal
        open={openKey !== null}
        onClose={() => setOpenKey(null)}
        nodes={nodes}
        rowKey={openKey}
        masked={masked}
        periodLabel={windowLabel}
        residualLabel={RESIDUAL_LABEL}
        labelOverrides={labelOverrides}
      />
    </GlassSurface>
  )
}

/**
 * R13.R3C.2 — ONE figure block, rendered three times, so the strip aligns by
 * construction rather than by matching two different markup shapes.
 *
 * The endpoints previously drew at `ui-card-value` (15px) with the date on a
 * third line, while the change drew at `ui-chart-headline` (23px) with its
 * percentage inline on the second — so the three headings sat at one height
 * but the three numbers did not share a baseline, and the strip read as a big
 * number with two annotations rather than as three comparable figures. Now
 * every block is label → value → meta with ONE value size, and each block's
 * meta is the thing that qualifies its own number: the real published date for
 * an endpoint, the percentage for the change.
 *
 * The meta row is never dropped when empty (a non-breaking space holds it), so
 * one missing date cannot shorten one column and break the row.
 *
 * Rhythm (R13.R3C.2 polish): the value draws at `leading-none` — the same
 * line-height-1 discipline `ui-kpi-hero` applies — so the 23px figure sits
 * tight between its label and its meta instead of floating in its own
 * leading, and the column gap drops to 4px to match. All three blocks share
 * the classes, so the three value baselines stay aligned by construction.
 */
function Figure({
  label,
  meta,
  value,
  masked,
  signed = false,
  tone = 'text-foreground',
  divider = false,
}: {
  label: string
  /** The line under the value: a published date, or the change's percentage. */
  meta: string | null
  value: number | null
  masked: boolean
  signed?: boolean
  /** Applied to BOTH the value and its meta, so a figure reads in one tone. */
  tone?: string
  divider?: boolean
}) {
  return (
    <div
      className={`flex flex-col gap-1 min-w-0 ${divider ? 'sm:pl-4 sm:border-l' : ''}`}
      style={divider ? { borderColor: 'var(--nv-line)' } : undefined}
    >
      <span className="ui-micro-label text-muted-fg whitespace-nowrap">{label}</span>
      <MaskedAmount
        value={value}
        masked={masked}
        signed={signed}
        // R13.R5C.1 § 2.2 — `signed` marks the CHANGE figures of this card, and
        // a change of zero is the module's `-`. The unsigned figures are period
        // levels and keep a real `0`.
        className={`ui-number ui-chart-headline ${tone} leading-none`}
      />
      <span className={`ui-meta ui-number ${tone === 'text-foreground' ? 'text-muted-fg' : `${tone} font-semibold`}`}>
        {meta ?? '\u00A0'}
      </span>
    </div>
  )
}
