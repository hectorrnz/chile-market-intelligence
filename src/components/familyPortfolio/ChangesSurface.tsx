'use client'

// POST-R13.8 FOLLOW-UP E — THE ONE CHANGES SURFACE, RENDERED BY BOTH PAGES.
//
// ── WHAT THIS IS ────────────────────────────────────────────────────────────
//
// Everything below the page header on `/portfolio/weekly-changes` and on
// `/portfolio/compare`: the endpoint note, the reclassification list, the hero
// beside its reconciliation ledger, the cash toolbar, the two ranked panels,
// the hierarchy chart, the full listing, the status block and the breakdown
// popup. In the § 6h order the contract fixes, unchanged.
//
// It is ONE component, not two, because the owner's requirement is that the two
// surfaces stay visually synchronised as either is restyled. Two files with the
// same markup drift on the first change somebody makes to only one of them; a
// shared component cannot. The pages above it own what genuinely differs — the
// header, the date controls and the fetch — and nothing else.
//
// ── HOW THE TWO MODES DIFFER ────────────────────────────────────────────────
//
// By VOCABULARY, resolved once by `changesLabels(mode, t)`, and by three
// figures the period surface reads from `periodPerformance` instead of from the
// source's own stated week. There is no `mode === …` ternary at a label site in
// this file, and there must not be one: that pattern is what left three blocks
// of this page saying "Weekly" over a five-month comparison before this pass.
//
// The mode IS consulted in exactly three places, each a genuine difference of
// SUBSTANCE rather than of wording, and each commented where it appears:
//   · which four figures the ledger reports;
//   · which rate the hero shows, and the period disclosures under the ledger;
//   · whether the source's own weekly residual warning can apply at all.
//
// ── NO FINANCIAL SEMANTICS LIVE IN THIS FILE ────────────────────────────────
//
// Every figure comes from the API response or from a pure module — the
// hierarchy, the cash toggle and the contributors chart all call the same pure
// functions the server route calls (`deriveDrivers` / `buildWaterfall` /
// `rankWeeklyChanges` / `contributionChildren` / `buildContributionSet` /
// `buildFullChangesTable`), over only the rows RLS already released to this
// caller. The client is presentation, never protection and never a second
// calculator.
//
// PRIVACY: every dollar amount renders through `MaskedAmount` / a
// privacy-masked `KpiHero`; hierarchy bars keep only RELATIVE extents (the
// allocation-donut precedent) with their dollar labels masked. Percentages
// follow the app's existing visible-percentage policy.

import { useMemo, useRef, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { AsyncState } from '@/components/fable/AsyncState'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { KpiHero } from '@/components/fable/KpiHero'
import { TableCard } from '@/components/fable/TableCard'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import {
  ReconciliationStatus,
  type ReconciliationDisplayState,
} from '@/components/familyPortfolio/ReconciliationStatus'
import { ContributionChart } from '@/components/familyPortfolio/ContributionChart'
import { ContributionBreakdownModal } from '@/components/familyPortfolio/ContributionBreakdownModal'
import { formatUsd, formatRatioPct, formatChangePct, formatIsoDateLabel } from '@/lib/formatters'
import { dict, type Translation } from '@/lib/i18n'
import {
  changesLabels,
  type ChangesLabels,
  type ChangesMode,
} from '@/lib/familyPortfolio/changesPresentation'
import {
  breadcrumbFor,
  buildFullChangesTable,
  buildWaterfall,
  contributionChildren,
  deriveDrivers,
  rankWeeklyChanges,
  type ChangeNode,
  type DriverGrouping,
  type NodeUnavailableReason,
} from '@/lib/familyPortfolio/weeklyChanges'
import { buildContributionSet, contributionAxis } from '@/lib/familyPortfolio/contributionChart'
import { omittedZeroSentence } from '@/lib/familyPortfolio/contributionLabels'
import {
  COMBINED_SUBJECT,
  derivePortfolioSubjects,
  resolveSubject,
  subjectLabelOverrides,
} from '@/lib/familyPortfolio/portfolioSubject'
import type { WeeklyChangesResponse } from '@/lib/data/familyPortfolio'

// The synthetic opening/closing/residual step labels `buildWaterfall` needs, in
// BOTH languages, from the same dictionary the server route reads.
//
// R13.R3B.1 — these are no longer DRAWN: nothing here renders the steps. They
// are still required because the driver reconciliation reported in the status
// section is derived from the same locked `buildWaterfall` call, and that
// function labels its steps whether or not a caller shows them.
const STEP_LABELS = {
  opening: {
    es: dict.es.fp.weeklyChanges.previousValueLabel,
    en: dict.en.fp.weeklyChanges.previousValueLabel,
  },
  closing: {
    es: dict.es.fp.weeklyChanges.currentValueLabel,
    en: dict.en.fp.weeklyChanges.currentValueLabel,
  },
  residual: {
    es: dict.es.fp.weeklyChanges.residualStep,
    en: dict.en.fp.weeklyChanges.residualStep,
  },
} as const

/**
 * The contributors chart's residual label, from the SHARED namespace this
 * surface and the Summary card both read — so the same remainder is named the
 * same way on both. Interval-neutral, unlike `STEP_LABELS` above.
 */
const RESIDUAL_LABEL = {
  es: dict.es.fp.contrib.residual,
  en: dict.en.fp.contrib.residual,
} as const

function nodeLabel(n: ChangeNode, lang: 'en' | 'es'): string {
  return lang === 'es' ? n.labelEs : (n.labelEn ?? n.labelEs)
}

/**
 * Why a row could not be compared, in the vocabulary of the surface asking.
 *
 * `missing_current` is "no published value in the selected week" on Weekly and
 * "no source-backed value at the To date" on Compare — the same fact about the
 * same row, named for the endpoint the reader actually chose.
 */
function reasonText(
  reason: NodeUnavailableReason | null,
  labels: ChangesLabels,
  w: Translation['fp']['weeklyChanges'],
): string | null {
  switch (reason) {
    case 'missing_current':
      return labels.reasonMissingCurrent
    case 'missing_previous':
      return labels.reasonMissingPrevious
    case 'missing_both':
      return labels.reasonMissingBoth
    case 'currency_mismatch':
      // Interval-independent: currencies are never netted, whatever the window.
      return w.reasonCurrencyMismatch
    default:
      return null
  }
}

/** ok/complete → reconciled · residual/partial → partial · else unavailable. */
function displayState(
  status: 'ok' | 'complete' | 'residual' | 'partial' | 'unavailable',
): ReconciliationDisplayState {
  if (status === 'ok' || status === 'complete') return 'reconciled'
  if (status === 'residual' || status === 'partial') return 'partial'
  return 'unavailable'
}

/** Structural emphasis per ingested row type — mirrors `HierarchicalTable`. */
function structuralRowClasses(rowType: string): string {
  switch (rowType) {
    case 'group_header':
    case 'sociedad_header':
      return 'bg-surface-2 font-medium'
    case 'portfolio_total':
      return 'font-semibold border-t-2 border-border-strong'
    case 'portfolio_subtotal':
    case 'sociedad_subtotal':
    case 'sociedad_total':
    case 'named_holding':
      return 'font-medium border-t border-border'
    default:
      return ''
  }
}

/**
 * One line of the reconciliation ledger.
 *
 * Declared rather than inferred so BOTH modes must produce the same shape: an
 * inferred union let the period branch add `endpointDate` while the weekly
 * branch had no such field, and the renderer then could not read it at all.
 */
interface LedgerRow {
  label: string
  value: number | null
  /** A MOVEMENT (profit, net flow) prints its sign; an endpoint level does not. */
  signed: boolean
  /** The two endpoint levels, set larger than the movements between them. */
  strong?: boolean
  /** A rule above the closing level, closing the ledger. */
  divider?: boolean
  /** § 11 — the period's endpoints name their own date beside the label. */
  endpointDate?: string
}

/** Main's labels are the source's own; a stable empty map keeps the memo cheap. */
const NO_OVERRIDES: ReadonlyMap<string, string> = new Map()

const TH = 'py-2.5 px-3 first:pl-4 last:pr-4 ui-table-header text-muted-fg sticky top-0 bg-surface z-10'
const CELL = 'py-2 px-3 first:pl-4 last:pr-4'

function changeColor(v: number | null): string {
  return v === null ? '' : v < 0 ? 'text-negative' : v > 0 ? 'text-positive' : ''
}

// ---------------------------------------------------------------------------
// § 6f — one ranked panel (increases OR decreases)
// ---------------------------------------------------------------------------

function RankedPanel({
  title,
  rows,
  allNodes,
  masked,
  emptyMessage,
  dates,
  labels,
  publishedAt,
}: {
  title: string
  rows: ChangeNode[]
  allNodes: ChangeNode[]
  masked: boolean
  emptyMessage: string
  dates: { opening: string; closing: string }
  labels: ChangesLabels
  publishedAt: string | null
}) {
  const { t, lang } = useLang()

  return (
    <TableCard
      title={title}
      state={rows.length === 0 ? 'empty' : undefined}
      stateMessage={emptyMessage}
      minWidth={560}
      footer={<TableSourceFooter source={t.fp.portfolio.source} asOf={publishedAt} />}
    >
      {rows.length > 0 && (
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="border-b border-border-strong">
              <th className={`${TH} text-left`} scope="col">
                {t.fp.portfolio.colHierarchy}
              </th>
              <th className={`${TH} text-right`} scope="col">
                <span className="block">{labels.colOpening}</span>
                <span className="block ui-number font-normal normal-case tracking-normal">
                  {formatIsoDateLabel(dates.opening)}
                </span>
              </th>
              <th className={`${TH} text-right`} scope="col">
                <span className="block">{labels.colClosing}</span>
                <span className="block ui-number font-normal normal-case tracking-normal">
                  {formatIsoDateLabel(dates.closing)}
                </span>
              </th>
              <th className={`${TH} text-right`} scope="col">
                {labels.valueChange}
              </th>
              <th className={`${TH} text-right`} scope="col">
                {t.fp.weeklyChanges.ownPctChange}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const trail = breadcrumbFor(allNodes, n.rowKey)
              const classification = trail
                .slice(0, -1)
                .map((a) => nodeLabel(a, lang))
                .join(' › ')
              return (
                <tr key={n.rowKey} className="border-b border-border">
                  <td className={`${CELL} text-left`}>
                    <span className="block truncate max-w-[16rem]" title={nodeLabel(n, lang)}>
                      {nodeLabel(n, lang)}
                    </span>
                    {classification && (
                      <span className="block ui-meta text-muted-fg truncate max-w-[16rem]" title={classification}>
                        {classification}
                      </span>
                    )}
                  </td>
                  <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                    <MaskedAmount value={n.previousValue} masked={masked} />
                  </td>
                  <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                    <MaskedAmount value={n.currentValue} masked={masked} />
                  </td>
                  {/* The same two change columns, under the same rule, so the
                      ranked panels and the full listing can never disagree
                      about how an interval with no movement is written. (A
                      ranked row is a mover by construction, so in practice
                      neither dashes here — the shared rule is what keeps it
                      that way.) */}
                  <td className={`${CELL} text-right ui-number whitespace-nowrap ${changeColor(n.weeklyValueChange)}`}>
                    <MaskedAmount value={n.weeklyValueChange} masked={masked} signed />
                  </td>
                  <td className={`${CELL} text-right ui-number whitespace-nowrap ${changeColor(n.ownPctChange)}`}>
                    {formatChangePct(n.ownPctChange)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  )
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

export interface ChangesSurfaceProps {
  /** Which interval this surface measures — see `ChangesMode`. */
  mode: ChangesMode
  /** The API response, in state `ok`. */
  data: WeeklyChangesResponse
  /** The entitled scope on screen, so a scope switch resets the local rails. */
  scope: string
  masked: boolean
}

export function ChangesSurface({ mode, data, scope, masked }: ChangesSurfaceProps) {
  const { t, lang } = useLang()
  const w = t.fp.weeklyChanges
  const labels = useMemo(() => changesLabels(mode, t), [mode, t])

  const [includeCash, setIncludeCash] = useState(false)
  // R13.R3C — the in-place breadcrumb drill is replaced by the shared breakdown
  // popup, so this holds only which component is open, not a path. Depth lives
  // inside the modal, where the parent and its reconciliation stay on screen.
  const [subjectKey, setSubjectKey] = useState<string>(COMBINED_SUBJECT)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const fullTableRef = useRef<HTMLDivElement | null>(null)

  // Render-time previous-value pattern (the codebase's standing rule — never an
  // effect): a scope switch resets the cash rail, and any new comparison resets
  // the drill position. A subject key names a row of THIS scope's hierarchy and
  // an open popup describes THIS comparison; neither survives a new one.
  const [prevScope, setPrevScope] = useState(scope)
  if (prevScope !== scope) {
    setPrevScope(scope)
    setIncludeCash(false)
  }
  const openingDate = data.previousPublication?.asOfDate ?? ''
  const closingDate = data.closingEndpoint?.asOfDate ?? data.publication?.asOfDate ?? ''
  const comparisonKey = `${scope}|${openingDate}|${closingDate}`
  const [prevComparison, setPrevComparison] = useState(comparisonKey)
  if (prevComparison !== comparisonKey) {
    setPrevComparison(comparisonKey)
    setSubjectKey(COMBINED_SUBJECT)
    setOpenKey(null)
  }

  const isMain = scope === 'main'
  const nodes = useMemo(() => data.nodes ?? [], [data])
  const total = data.total ?? null
  const flowRecon = data.flowReconciliation ?? null
  // FOLLOW-UP D — the CUSTOM-PERIOD reconciliation. The server returns it only
  // in `custom` mode, and it is null even there when the analytical history the
  // period needs has not been loaded. Both cases render the SAME four ledger
  // rows; only the two middle figures go unavailable.
  const periodPerf = data.periodPerformance ?? null
  // The publication timestamp behind the source footers. Null when the closing
  // endpoint is a source-backed reporting date the book never published — the
  // footer then names the source without claiming a publication time.
  const publishedAt = data.publication?.publishedAt ?? null

  // ── Every derived figure below comes from the LOCKED pure module ──────────
  const ranked = useMemo(() => rankWeeklyChanges(nodes, { excludeCash: !includeCash }), [nodes, includeCash])
  // § 6g fixes the drill hierarchy per scope kind: Main tiles by its top-level
  // rows; a personal scope drills Sociedad → Asset Class → Subasset → Asset.
  const hierarchyGrouping: DriverGrouping = isMain ? 'top_level' : 'sociedad'
  const hierarchyDrivers = useMemo(() => deriveDrivers(nodes, hierarchyGrouping), [nodes, hierarchyGrouping])
  // ── R13.R3B.1 · ONE DRIVER SET, REPORTED AS A RECONCILIATION ─────────────
  //
  // The same `buildWaterfall` the route calls still answers whether the
  // interval's drivers reconcile to the published total, which the status
  // section reports. Nothing is drawn from it — the decomposition itself lives
  // on Summary over a real period.
  const driverReconciliation = useMemo(
    () => (total ? buildWaterfall(total, hierarchyDrivers, STEP_LABELS) : null),
    [total, hierarchyDrivers],
  )
  const fullRows = useMemo(() => buildFullChangesTable(nodes), [nodes])

  // ── R13.R3C · the same Contributors and Detractors system as Summary ──────
  const subjects = useMemo(
    () => derivePortfolioSubjects(nodes, hierarchyDrivers),
    [nodes, hierarchyDrivers],
  )
  const safeSubjectKey = subjects.some((s) => s.key === subjectKey) ? subjectKey : COMBINED_SUBJECT
  const resolvedSubject = useMemo(
    () => resolveSubject(nodes, hierarchyDrivers, total, safeSubjectKey),
    [nodes, hierarchyDrivers, total, safeSubjectKey],
  )
  const contributionSet = useMemo(
    () =>
      buildContributionSet({
        openingValue: resolvedSubject.state === 'lifecycle_gap' ? null : resolvedSubject.openingValue,
        closingValue: resolvedSubject.state === 'lifecycle_gap' ? null : resolvedSubject.closingValue,
        components: resolvedSubject.components,
        isDrillable: (key) => contributionChildren(nodes, key).length > 0,
        residualLabel: RESIDUAL_LABEL,
      }),
    [resolvedSubject, nodes],
  )
  const contributionAxisScale = useMemo(
    () => contributionAxis(contributionSet.items.map((i) => i.value)),
    [contributionSet],
  )
  // R13.R3C.2 — one display-name map for the pills, the bars, the x-axis, the
  // tooltip, the omission footnote and the popup heading. Main gets none: its
  // components are asset classes and individual holdings whose labels belong to
  // the source, and title-casing a shouted brand there would rewrite a real
  // published name.
  const labelOverrides = useMemo(
    () => (isMain ? NO_OVERRIDES : subjectLabelOverrides(subjects, lang)),
    [isMain, subjects, lang],
  )
  const omittedNote = omittedZeroSentence(
    contributionSet.omittedZero,
    lang,
    { template: t.fp.contrib.zeroOmittedNames, more: t.fp.contrib.zeroOmittedMore },
    labelOverrides,
  )

  // ── THE RECONCILIATION LEDGER, CHOSEN BY MODE ────────────────────────────
  //
  // Four rows either way — opening level, result, flows, closing level — but
  // they are DIFFERENT MEASURES over different intervals, so they carry
  // different labels and come from different sources:
  //
  //   WEEKLY  the source's own stated week, straight from `flowReconciliation`.
  //   PERIOD  cumulative over every reporting interval in (From, To], from
  //           `periodPerformance`, whose P&L is derived from the identity the
  //           note beneath the ledger states.
  //
  // ── FOLLOW-UP E · THE LEDGER ALWAYS HAS FOUR ROWS ────────────────────────
  //
  // The period branch used to render NOTHING when `periodPerformance` was null,
  // which is the state Preview is in until the analytical-history migration is
  // applied. Two of the four rows are genuinely unavailable there — but the
  // other two are not, and a card that vanishes teaches the reader that this
  // comparison does not reconcile rather than that two of its terms have not
  // been loaded. So the ENDPOINTS always come from the two snapshots, which
  // exist whenever this surface renders at all, and only the two MOVEMENTS go
  // to an em dash, with a sentence underneath saying which and why.
  const ledger = useMemo<LedgerRow[]>(() => {
    if (mode === 'period') {
      return [
        {
          label: labels.reconOpening,
          value: periodPerf?.openingValue ?? total?.previousValue ?? null,
          signed: false,
          strong: true,
          endpointDate: openingDate,
        },
        { label: labels.reconProfit, value: periodPerf?.profit ?? null, signed: true },
        { label: labels.reconFlow, value: periodPerf?.netFlows ?? null, signed: true },
        {
          label: labels.reconClosing,
          value: periodPerf?.closingValue ?? total?.currentValue ?? null,
          signed: false,
          strong: true,
          divider: true,
          endpointDate: closingDate,
        },
      ]
    }
    return [
      { label: labels.reconOpening, value: flowRecon?.previousValue ?? null, signed: false, strong: true },
      { label: labels.reconProfit, value: flowRecon?.profit ?? null, signed: true },
      { label: labels.reconFlow, value: flowRecon?.flow ?? null, signed: true },
      {
        label: labels.reconClosing,
        value: flowRecon?.actualCurrent ?? null,
        signed: false,
        strong: true,
        divider: true,
      },
    ]
  }, [mode, labels, periodPerf, flowRecon, total, openingDate, closingDate])

  const reclassifications = data.reclassifications ?? []
  const pub = data.publication
  const isPeriod = mode === 'period'

  return (
    <div className="flex flex-col gap-4">
      {/* R13.R2F5.1 § A — `.nv-notes` keeps the stack (one left origin) and
          widens the measure to 110ch. The reclassifications block below is
          excluded — it is a titled list, not plain footnote text. */}
      <div className="nv-notes">
        {/* The one selection every section below shares (doc 07 § 6b). */}
        <p className="ui-meta text-muted-fg">
          {labels.openingLabel}: {formatIsoDateLabel(openingDate)} · {labels.closingLabel}:{' '}
          {formatIsoDateLabel(closingDate)} ·{' '}
          {isPeriod
            ? w.customPairNote
            : data.weeklyBasis === 'source_previous_week'
              ? w.sourcePairNote
              : w.pairNote}
        </p>
        {/* The opening endpoint is a reporting date the book closed but never
            published. Stated rather than left to be discovered. */}
        {!isPeriod && data.openingSource === 'source_previous_week' && (
          <p className="ui-meta text-muted-fg">{w.weeklyOpeningUnpublished}</p>
        )}
        {/* How the period's two movements accumulate, and why the From week's
            own flow is not among them. An omission a reader can see explained is
            honest; a silent one is indistinguishable from a bug. */}
        {isPeriod && <p className="ui-meta text-muted-fg">{w.customFlowNote}</p>}
      </div>
      {/* § 7 — reported, never merged. */}
      {reclassifications.length > 0 && (
        <div className="ui-meta text-muted-fg">
          <span className="ui-label">{w.reclassTitle}</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {reclassifications.map((r) => (
              <li key={`${r.exitedRowKey}→${r.arrivedRowKey}`}>{r.label}</li>
            ))}
          </ul>
          <p className="mt-1">{w.reclassNote}</p>
        </div>
      )}

      {/* ── § 6h items 2–3 · ONE COMBINED BLOCK ────────────────────────────
          Two halves that answer different questions and repeat nothing.

            LEFT — THE HEADLINE. The whole interval as one figure: the value
            change, and the rate it represents. Vertically centred against the
            taller ledger beside it, its own text left-aligned.

            RIGHT — THE LEDGER. How the book got from one value to the other,
            read top to bottom: opening value, the money it MADE, the money that
            MOVED IN OR OUT, closing value. Opening and closing are set larger
            than the two movements between them; they are the endpoints, and the
            two middle rows are what happened in between.

          NOTHING ELSE JOINS THEM, deliberately. Every other total-level figure
          is either already a ledger row or derivable from one by eye — the
          change IS closing − opening, and IS ALSO P&L + flows — so a fifth
          summary number would be the wall of repeated figures this block exists
          to avoid.

          DOM ORDER IS THE CONTRACT'S — § 6h item 2, then item 3 — and it is
          also the visual order at every breakpoint: no `order` utility flips
          the two, so nothing can diverge between what is read and what is seen,
          for a keyboard, a screen reader or a printed page.

          ── THE IMPLIED-vs-PUBLISHED CROSS-CHECK IS NOT DRAWN ──
          Still COMPUTED on every request and still reported as a verdict in the
          status section. What is gone is printing `implied` and `published` as
          two adjacent dollar figures — to a reader who is not already
          reconciling, two near-identical amounts read as a discrepancy even
          when they agree to the cent. */}
      <GlassSurface variant="card" className="p-4 xl:p-5">
        {/* The headline LEADS and the ledger explains it. The narrower column is
            the headline's: the ledger carries four label/value rows and needs
            the width. */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,0.8fr)_1fr] gap-4 xl:gap-0">
          {/* § 6h item 2 · THE HEADLINE — LEFT at xl, first in the stack below
              it. `justify-center` centres it against the taller ledger beside it
              (the grid stretches both cells, so the column IS the card's
              height); text stays left-aligned — nothing here centres a line of
              type.

              THE RATE IS THE ONE FIGURE THE MODE CHANGES. The value is a
              difference of two snapshots and is correct over any span; the RATE
              is not. Weekly shows the source's own stated weekly return, and a
              period shows the chain-linked return over the whole range. The
              LABEL is rendered either way, even when the rate is unavailable:
              `formatRatioPct(null)` is an em dash, so the reader sees "— Period
              Return" rather than a hero that quietly lost its second line. */}
          <KpiHero
            bare
            className="justify-center border-b border-border pb-4 xl:border-b-0 xl:pb-0 xl:pr-6"
            label={labels.valueChange}
            value={total?.weeklyValueChange ?? null}
            formatValue={(v) => (v > 0 ? `+${formatUsd(v)}` : formatUsd(v))}
            privacyMasked={masked}
            countUp
            changeValue={isPeriod ? (periodPerf?.periodReturn ?? null) : (total?.weeklyReturn ?? null)}
            changeLabel={`${formatRatioPct(
              isPeriod ? (periodPerf?.periodReturn ?? null) : (total?.weeklyReturn ?? null),
            )} ${labels.returnLabel}`}
          />

          {/* § 6h item 3 · THE LEDGER — flow / investment-result
              reconciliation, read top to bottom. RIGHT at xl, so it carries the
              dividing rule. */}
          <div className="flex flex-col gap-2 min-w-0 xl:border-l xl:border-border xl:pl-6">
            <h2 className="ui-label text-muted-fg">{labels.reconTitle}</h2>
            <dl className="flex flex-col gap-1.5">
              {ledger.map((r) => (
                <div
                  key={r.label}
                  className={`flex items-baseline justify-between gap-3 ${r.strong ? 'text-sm' : 'text-xs'} ${r.divider ? 'border-t border-border pt-1.5' : ''}`}
                >
                  <dt className={`min-w-0 truncate ${r.strong ? 'text-foreground' : 'text-muted-fg'}`}>
                    {r.label}
                    {/* § 11 — the period's two endpoint rows name their own
                        date, so the ledger states WHICH two values it is
                        reconciling between without a second header line. */}
                    {r.endpointDate ? (
                      <span className="ui-number text-muted-fg font-normal">
                        {' '}
                        {formatIsoDateLabel(r.endpointDate)}
                      </span>
                    ) : null}
                  </dt>
                  {/* The ENDPOINTS carry the emphasis; the two movements between
                      them stay quiet, so the eye reads "from here, to here"
                      before it reads how. */}
                  <dd className={`ui-number shrink-0 text-foreground ${r.strong ? 'text-base font-semibold' : ''}`}>
                    {/* R13.R5C.1 § 2.2 — `signed` marks the MOVEMENTS of this
                        reconciliation (profit, net flow); the two endpoints are
                        levels and keep a real `0`. */}
                    <MaskedAmount value={r.value} masked={masked} signed={r.signed} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="ui-meta text-muted-fg">{labels.reconNote}</p>
            {/* Never on an interval that reconciles, and never a second amount:
                an equation whose printed terms do not sum must say so, or the
                note above it becomes a claim the card disproves. Weekly only —
                the period identity reconciles by construction, because its P&L
                is derived from it. */}
            {!isPeriod && flowRecon?.status === 'residual' && (
              <p className="ui-meta text-warning">{w.flowReconResidual}</p>
            )}
            {/* ── THE PERIOD DISCLOSURES ────────────────────────────────────
                The identity above always reconciles by construction, so the
                honest check is the INDEPENDENT one: the sum of the source's own
                weekly results over the same window. A mismatch is stated rather
                than resolved in favour of whichever number is convenient. */}
            {isPeriod && periodPerf === null && (
              <p className="ui-meta text-warning">{w.periodHistoryUnavailable}</p>
            )}
            {isPeriod && periodPerf?.profitCrossCheck === 'ok' && (
              <p className="ui-meta text-muted-fg">{w.periodCrossCheck}</p>
            )}
            {isPeriod && periodPerf?.profitCrossCheck === 'mismatch' && (
              <p className="ui-meta text-warning">{w.periodCrossMismatch}</p>
            )}
            {isPeriod && periodPerf !== null && periodPerf.netFlows === null && (
              <p className="ui-meta text-muted-fg">{w.periodFlowsUnavailable}</p>
            )}
            {isPeriod && periodPerf !== null && periodPerf.periodReturn === null && (
              <p className="ui-meta text-muted-fg">{w.periodReturnUnavailable}</p>
            )}
            {isPeriod && periodPerf?.periodReturn != null && (
              <p className="ui-meta text-muted-fg">{w.periodReturnNote}</p>
            )}
            {isPeriod && periodPerf !== null && periodPerf.intervals.length > 0 && (
              <p className="ui-meta text-muted-fg ui-number">
                {periodPerf.intervals.length} {w.periodIntervals}
              </p>
            )}
          </div>
        </div>
      </GlassSurface>

      {/* ── § 6h item 5 · ranked panels + cash toggle + View All ───────────
          The wrapper below closes after the movers/chart grid: the toggle, its
          notes and the panels they govern hold together at a tighter gap than
          the page's 16px section rhythm, so the toolbar reads as the head of
          the region below rather than a stray band between two regions. */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={includeCash}
                onChange={(e) => setIncludeCash(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {w.cashToggleLabel}
            </label>
            <button
              type="button"
              onClick={() =>
                fullTableRef.current?.scrollIntoView({
                  // Motion rule: the reduced-motion path ships in the same
                  // change — smooth scrolling is motion.
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                  block: 'start',
                })
              }
              className="border border-border rounded-full px-3 py-1 text-xs text-foreground hover:bg-surface-2 nv-transition"
            >
              {w.viewAll} ↓
            </button>
          </div>
          {/* R13.R2F5 — `.nv-notes` stacks the cash-toggle explanation, the
              withheld/included state and the ranking note at ONE left origin,
              each at a 110ch measure. */}
          <div className="nv-notes">
            <p className="ui-meta text-muted-fg">{labels.cashWhy}</p>
            {!includeCash && ranked.cashRowCount > 0 && (
              <p className="ui-meta text-muted-fg">
                {ranked.cashRowCount} {w.cashWithheldSuffix}
              </p>
            )}
            {includeCash && <p className="ui-meta text-muted-fg">{w.cashIncludedNote}</p>}
            <p className="ui-meta text-muted-fg">{labels.rankNote}</p>
          </div>
        </div>

        {/* ── § 6h items 5–6 · the movers, and the chart that ranks them ────
            Increases OVER decreases in one column, with the hierarchy chart
            beside them. The two panels are the same movers listed by name and
            figure; the chart is those same movers ranked and drawn. Side by
            side they check each other: the tallest bar should be the first row
            of the increases panel, and the deepest the first row of the
            decreases.

            THE TWO SIDES END LEVEL. The row stretches, and the slack lands in
            the PLOT (`fill`), not in padding under it: the taller side governs,
            the bars get every pixel the movers block spends, and the reader
            compares two blocks that share one baseline. Below xl the grid is one
            column, each card takes its own height, and `fill` falls back to the
            same 240px floor it always drew at. */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 items-stretch">
          <div className="flex flex-col gap-4 min-w-0">
            <RankedPanel
              title={labels.increasesTitle}
              rows={ranked.increases}
              allNodes={nodes}
              masked={masked}
              emptyMessage={labels.noIncreases}
              dates={{ opening: openingDate, closing: closingDate }}
              labels={labels}
              publishedAt={publishedAt}
            />
            <RankedPanel
              title={labels.decreasesTitle}
              rows={ranked.decreases}
              allNodes={nodes}
              masked={masked}
              emptyMessage={labels.noDecreases}
              dates={{ opening: openingDate, closing: closingDate }}
              labels={labels}
              publishedAt={publishedAt}
            />
          </div>

          {/* ── § 6h item 6 · hierarchy drill-down (exact § 6g title) ────── */}
          <GlassSurface variant="card" className="p-4 flex flex-col gap-3 min-w-0 h-full">
            {/* Title and its § 4.2 measure note read as ONE header unit —
                tighter to each other than to the controls and chart below. */}
            <div className="flex flex-col gap-1">
              <h2 className="ui-label text-muted-fg">{labels.hierarchyTitle}</h2>
              {/* The § 4.2 name of what each bar shows: the node's share of the
                  portfolio's dollar move — a value change, never a return. */}
              <p className="ui-meta text-muted-fg">{labels.hierarchySubtitle}</p>
            </div>
            {/* Only a personal book has sociedades to choose between; Main's
                components are asset classes and it gets no subject rail. */}
            {!isMain && subjects.length > 1 && (
              <div className="max-w-full overflow-x-auto nv-scrollbar-hidden">
                <SegmentedControl
                  options={subjects.map((s) => ({
                    value: s.key,
                    label:
                      s.key === COMBINED_SUBJECT
                        ? t.fp.overview.vwfSubjectCombined
                        : (labelOverrides.get(s.key) ?? s.key),
                  }))}
                  value={safeSubjectKey}
                  onChange={(v) => setSubjectKey(v)}
                  ariaLabel={t.fp.overview.vwfSubjectSelector}
                  remeasureToken={`${lang}|${scope}`}
                />
              </div>
            )}

            <div className="flex-1 min-h-0 flex flex-col">
              {resolvedSubject.state === 'lifecycle_gap' ? (
                <AsyncState
                  kind="empty"
                  message={
                    safeSubjectKey === COMBINED_SUBJECT
                      ? t.fp.overview.vwfTotalRowLifecycle
                      : t.fp.overview.vwfSubjectLifecycle
                  }
                />
              ) : resolvedSubject.state === 'no_decomposition' ? (
                <AsyncState kind="empty" message={t.fp.contrib.noDecomposition} />
              ) : (
                <ContributionChart
                  set={contributionSet}
                  axis={contributionAxisScale}
                  masked={masked}
                  onSelect={(key) => setOpenKey(key)}
                  emptyText={w.hierarchyEmpty}
                  ariaLabel={labels.hierarchyTitle}
                  labelOverrides={labelOverrides}
                  fill
                />
              )}
            </div>

            {/* The set's own reconciliation against the subject it tiles.
                Stated in words: a chart of changes has no closing column whose
                landing point could state it geometrically. A hairline sets the
                verdict band apart from the plot above it — the same device the
                Summary card uses ahead of its own notes. */}
            {contributionSet.status !== 'unavailable' && (
              <div className="flex flex-col gap-1 pt-2.5" style={{ borderTop: '1px solid var(--nv-line)' }}>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-fg">
                    {w.parentChange}: <MaskedAmount value={contributionSet.netChange} masked={masked} signed />
                  </span>
                </div>
                <ReconciliationStatus
                  state={displayState(
                    contributionSet.unavailable.length > 0
                      ? 'unavailable'
                      : contributionSet.status === 'complete'
                        ? 'ok'
                        : 'residual',
                  )}
                  residual={contributionSet.residual}
                  unavailableCount={contributionSet.unavailable.length}
                  unavailableNoun={w.unavailableChildren}
                  masked={masked}
                />
                {/* Named, never counted: an entity that did not move is a
                    finding, and the same names the bars would have carried. */}
                {omittedNote !== null && <p className="ui-meta text-muted-fg">{omittedNote}</p>}
              </div>
            )}
            <TableSourceFooter source={t.fp.portfolio.source} asOf={publishedAt} />
          </GlassSurface>
        </div>
      </div>

      {/* ── § 6h item 7 · full changes table ─────────────────────────────── */}
      <div ref={fullTableRef}>
        <TableCard
          title={labels.fullTableTitle}
          minWidth={760}
          maxHeight={640}
          footer={
            // R13.R2F5.1 § A — `.nv-notes` stacks the source line and the table
            // notes at ONE left origin, each at 110ch.
            <div className="nv-notes">
              <TableSourceFooter source={t.fp.portfolio.source} asOf={publishedAt} />
              <p className="ui-meta text-muted-fg">{labels.fullTableNote}</p>
              <p className="ui-meta text-muted-fg">{w.zeroDashNote}</p>
              {!includeCash && <p className="ui-meta text-muted-fg">{w.fullTableCashNote}</p>}
            </div>
          }
        >
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="border-b border-border-strong">
                <th className={`${TH} text-left`} scope="col">
                  <span className="block">{t.fp.portfolio.colHierarchy}</span>
                  <span className="block ui-meta font-normal normal-case tracking-normal">
                    {t.fp.portfolio.valuesInUsd}
                  </span>
                </th>
                <th className={`${TH} text-center`} scope="col">
                  <span className="block">{labels.colOpening}</span>
                  <span className="block ui-number font-normal normal-case tracking-normal">
                    {formatIsoDateLabel(openingDate)}
                  </span>
                </th>
                <th className={`${TH} text-center`} scope="col">
                  <span className="block">{labels.colClosing}</span>
                  <span className="block ui-number font-normal normal-case tracking-normal">
                    {formatIsoDateLabel(closingDate)}
                  </span>
                </th>
                <th className={`${TH} text-center`} scope="col">
                  {labels.valueChange}
                </th>
                <th className={`${TH} text-center`} scope="col">
                  {w.ownPctChange}
                </th>
                <th className={`${TH} text-center`} scope="col">
                  {w.impactOnPortfolio}
                </th>
              </tr>
            </thead>
            <tbody>
              {fullRows.map((n) => (
                <tr key={n.rowKey} className={`border-b border-border ${structuralRowClasses(n.rowType)}`}>
                  {/* The hierarchy column stays LEFT-aligned and is the one
                      exception to the centring: its indent IS the tree, and a
                      centred row loses the depth it encodes. */}
                  <td className={`${CELL} text-left`}>
                    <span
                      className="block truncate max-w-[18rem]"
                      style={{ paddingLeft: n.depth * 14 }}
                      title={nodeLabel(n, lang)}
                    >
                      {nodeLabel(n, lang)}
                    </span>
                    {/* R13.R3C.4 — the retired Status column's content, in the
                        one place it can go without a column of its own. It is
                        not decoration: a row the source could not compare must
                        SAY why, or an em dash in the value cells is
                        indistinguishable from a bug. */}
                    {n.status !== 'ok' && (
                      <span
                        className="block ui-meta text-muted-fg truncate max-w-[18rem]"
                        style={{ paddingLeft: n.depth * 14 }}
                      >
                        {w.statusUnavailable}
                        {reasonText(n.unavailableReason, labels, w)
                          ? ` — ${reasonText(n.unavailableReason, labels, w)}`
                          : ''}
                      </span>
                    )}
                  </td>
                  <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
                    <MaskedAmount value={n.previousValue} masked={masked} />
                  </td>
                  <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
                    <MaskedAmount value={n.currentValue} masked={masked} />
                  </td>
                  {/* R13.R3C.4 — the three CHANGE columns dash when they print
                      as zero. Most rows of a full listing do not move, and a
                      column of `0` / `0,00%` buries the handful that did. The
                      two VALUE columns above keep their numbers: a holding worth
                      exactly nothing is a real level, not an absence. */}
                  <td className={`${CELL} text-center ui-number whitespace-nowrap ${changeColor(n.weeklyValueChange)}`}>
                    <MaskedAmount value={n.weeklyValueChange} masked={masked} signed />
                  </td>
                  <td className={`${CELL} text-center ui-number whitespace-nowrap ${changeColor(n.ownPctChange)}`}>
                    {formatChangePct(n.ownPctChange)}
                  </td>
                  <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
                    {formatChangePct(n.impactOnPortfolioValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </div>

      {/* ── § 6h item 9 · freshness, statuses, sources, methodology ──────── */}
      <GlassSurface variant="card" className="p-4 flex flex-col gap-3">
        <h2 className="ui-label text-muted-fg">{w.statusTitle}</h2>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-fg">
          <span>
            {labels.closingLabel}: {formatIsoDateLabel(closingDate)}
          </span>
          <span>
            {labels.openingLabel}: {formatIsoDateLabel(openingDate)}
          </span>
          {/* Publication bookkeeping exists only where the closing endpoint IS a
              publication. A source-backed reporting date the book never
              published has no revision, no published-at and no parser version,
              and inventing any of the three would claim a publication that does
              not exist. */}
          {pub && (
            <>
              <span>
                {w.publishedAtLabel}: {formatIsoDateLabel(pub.publishedAt.slice(0, 10))}
              </span>
              <span>
                {t.fp.portfolio.revisionShort} {pub.revision}
              </span>
              <span>
                {t.fp.portfolio.parserLabel} {pub.parserVersion}
              </span>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {/* R13.R3B.1 — this is where the retired card's reconciliation
              survives. It answers a question about the INTERVAL'S DATA, not
              about a chart: do the asset-level changes account for the published
              total? That stays worth reporting whether or not anything is drawn
              from them. */}
          {driverReconciliation && (
            <div className="flex flex-wrap items-center gap-x-2 text-xs">
              <span className="text-muted-fg">{w.driverStatusLabel}:</span>
              <ReconciliationStatus
                state={displayState(driverReconciliation.status)}
                residual={driverReconciliation.residual}
                unavailableCount={driverReconciliation.unavailableDriverCount}
                unavailableNoun={w.unavailableDrivers}
                masked={masked}
              />
            </div>
          )}
          {!isPeriod && flowRecon && (
            <div className="flex flex-wrap items-center gap-x-2 text-xs">
              <span className="text-muted-fg">{w.flowStatusLabel}:</span>
              <ReconciliationStatus
                state={displayState(flowRecon.status)}
                residual={flowRecon.residual}
                masked={masked}
              />
            </div>
          )}
        </div>
        <TableSourceFooter source={t.fp.portfolio.source} asOf={publishedAt} />
        {/* Persistent methodology note (doc 07 § 7.3) — always rendered, never a
            tooltip. */}
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <h3 className="ui-label text-muted-fg">{w.methodologyTitle}</h3>
          <ul className="flex flex-col gap-1 list-disc pl-4">
            {[
              labels.methodologyLevel,
              labels.methodologyPair,
              labels.methodologyImpact,
              w.methodologyDrivers,
              w.methodologyCash,
            ].map((item) => (
              <li key={item} className="ui-meta text-muted-fg">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </GlassSurface>

      {/* Mounted at the bottom of the surface tree, the established overlay
          pattern. `ModalShell` renders nothing while closed. */}
      <ContributionBreakdownModal
        open={openKey !== null}
        onClose={() => setOpenKey(null)}
        nodes={nodes}
        rowKey={openKey}
        masked={masked}
        periodLabel={`${formatIsoDateLabel(openingDate)} — ${formatIsoDateLabel(closingDate)}`}
        residualLabel={RESIDUAL_LABEL}
        labelOverrides={labelOverrides}
      />
    </div>
  )
}
