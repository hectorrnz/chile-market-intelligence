'use client'

// R13.8 — `/family-portfolio/weekly-changes` (doc 08 Stage 8; doc 07 Parts
// A2/A3, page order § 6h).
//
// SECTION ORDER IS THE CONTRACT'S (§ 6h), verbatim:
//   1. page header, portfolio selector, published-week selector
//   2. total-level weekly metrics  (R13.R3C.4 — the hero alone; see below)
//   3. total-level flow and investment-result reconciliation
//   4. RETIRED — see below
//   5. Largest Weekly Value Increases / Largest Weekly Value Decreases
//   6. Weekly Value Change by Portfolio Hierarchy
//   7. full changes table
//   8. RETIRED — see below
//   9. freshness, publication status, reconciliation status, source notes,
//      and the persistent methodology note
//
// ── R13.R3C.2 · THE PAGE IS TWO REGIONS NOW, AND ITEM 8 IS GONE ───────────
//
// The contract's ORDER is unchanged — every surviving section still renders
// in its § 6h position — but items 2 and 3 now sit in ONE row (the week's
// change, the week's result, the week's reconciliation) and items 5 and 6 in
// the next (the movers listed, beside the same movers drawn). Compressing
// them exposed how much they repeated, so each block was given one job and
// the duplicated figures were removed rather than tiled; the row's own
// comment records which figure went where and why two of them legitimately
// remain in two places.
//
// ── R13.R3C.4 · WHAT THIS PAGE IS FOR, ENFORCED ───────────────────────────
//
// Every block on this page is about ONE selected week. Two things that were
// not are gone, on the owner's product decision:
//
//   · The *Total-level weekly metrics* card (part of § 6h item 2) carried YTD
//     P&L and YTD RETURN — year-to-date figures under a weekly heading, which
//     invited the year to be read as the week. Summary already reports both,
//     over a period the reader picks. Its other two lines, weekly P&L and net
//     flows, were terms of the reconciliation beside it and now live there
//     once. Item 2 survives as the hero: the week's change, as an amount and
//     as a rate.
//   · The IMPLIED-vs-PUBLISHED pair in the reconciliation. Still computed on
//     every request and still reported as a verdict in item 9 — but no longer
//     printed as two adjacent dollar amounts, which read as a discrepancy to
//     anyone not already reconciling. A real mismatch is caught before
//     publication, by the parser, in the administrator's upload review.
//
// Both apply to Main and to every personal portfolio: this is ONE page, and
// the scope selector only changes which rows it is handed.
//
// § 6h item 8, *Historical Weekly Value Change*, is retired: it plotted a
// series ACROSS weeks on a page whose every other block is about the one week
// selected above, and Portfolio Evolution on Summary answers that question
// better and on a flow-adjusted basis. No calculation changed with it — the
// route still returns `trend`.
//
// ── R13.R3B.1 · ITEM 4 IS RETIRED FROM THIS PAGE ──────────────────────────
//
// § 6h item 4 was "Drivers of Weekly Portfolio Value Change (waterfall)". On
// the owner's product decision it no longer earns its space HERE: measured on
// the real book, one week moves this portfolio by a fraction of a percent, so
// five of seven drivers drew under a pixel and the card taught the reader
// almost nothing. The decomposition itself was not the problem — the WINDOW
// was — so R13.R3B moved it to the Summary tab over 3M / YTD / 1Y / ALL, where
// the same drivers are an order of magnitude more legible.
//
// The contract's numbering is kept as-is rather than re-flowed: renumbering
// would misstate § 6h, and a gap that says WHY is more useful to the next
// reader than a tidy sequence that hides the change.
//
// WHAT STAYED. Everything item 4 was built on. The driver decomposition is
// still computed here from the same locked functions and still reported — as
// the DRIVER RECONCILIATION in the status section (item 9), which is a real
// data-quality property of the week whether or not anything is drawn. What is
// gone is the drawing, and the personal-scope "driver view" rail that only
// ever chose the drawing's tiling; the hierarchy section already drills a
// personal scope by sociedad, which is what that rail defaulted to.
//
// ── R13.R3C · ITEM 6 IS THE SAME SYSTEM AS SUMMARY NOW ────────────────────
//
// *Weekly Value Change by Portfolio Hierarchy* keeps its § 6g title, its
// subject and its reconciliation, and swaps its presentation for the shared
// Contributors and Detractors system: one zero-centred, magnitude-ranked bar
// chart (`ContributionChart`) and one breakdown popup
// (`ContributionBreakdownModal`), both the very components the Summary card
// renders. The in-place breadcrumb drill is gone — depth now happens inside
// the popup, where the parent and its reconciliation stay on screen the whole
// way down — and personal scopes gain a SUBJECT rail (Combined Portfolio /
// one sociedad), which is a different control from the R13.R3B.1 tiling rail
// it visually replaces.
//
// ONE WEEK SELECTION DRIVES EVERYTHING (doc 07 § 6b): a single (scope, asOf)
// fetch feeds every section; no component holds its own week.
//
// NO FINANCIAL SEMANTICS LIVE IN THIS FILE. Every figure comes from the API
// response or from a pure module — the hierarchy, the cash toggle and the
// contributors chart all call the same pure functions the server route calls
// (`deriveDrivers` / `buildWaterfall` / `rankWeeklyChanges` /
// `contributionChildren` / `buildContributionSet` / `buildFullChangesTable`),
// over only the rows RLS already released to this caller. The client is
// presentation, never protection and never a second calculator.
//
// PRIVACY: every dollar amount renders through `MaskedAmount` / a
// privacy-masked `KpiHero`; hierarchy bars keep only RELATIVE extents (the
// allocation-donut precedent) with their dollar labels masked. Percentages
// follow the app's existing visible-percentage policy. (The whole-chart
// privacy replacement this page used to carry went with item 8: no surface
// here plots absolute LEVELS any more.)

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { KpiHero } from '@/components/fable/KpiHero'
import { TableCard } from '@/components/fable/TableCard'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { PrivacyToggle } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { EmptyState } from '@/components/ui/EmptyState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'
import { useFamilyPortfolio } from '@/components/familyPortfolio/FamilyPortfolioProvider'
import { WeekSelector } from '@/components/familyPortfolio/WeekSelector'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { ReconciliationStatus, type ReconciliationDisplayState } from '@/components/familyPortfolio/ReconciliationStatus'
import { ContributionChart } from '@/components/familyPortfolio/ContributionChart'
import { ContributionBreakdownModal } from '@/components/familyPortfolio/ContributionBreakdownModal'
import { formatUsd, formatRatioPct, formatChangePct, formatIsoDateLabel } from '@/lib/formatters'
import { dict, type Translation } from '@/lib/i18n'
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
import {
  fetchFamilyPortfolioWeeklyChanges,
  type WeeklyChangesResponse,
} from '@/lib/data/familyPortfolio'

type FetchOutcome = 'ready' | 'denied' | 'error'

interface FetchSlot {
  key: string
  outcome: FetchOutcome
  data: WeeklyChangesResponse | null
}

// The synthetic opening/closing/residual step labels `buildWaterfall` needs,
// in BOTH languages, from the same dictionary the server route reads.
//
// R13.R3B.1 — these are no longer DRAWN on this page: nothing here renders the
// steps. They are still required because the driver reconciliation reported in
// the status section is derived from the same locked `buildWaterfall` call,
// and that function labels its steps whether or not a caller shows them.
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
 * The contributors chart's residual label, from the SHARED namespace both this
 * page and the Summary card read — so the same remainder is named the same way
 * on both surfaces. Period-neutral, unlike `STEP_LABELS` above.
 */
const RESIDUAL_LABEL = {
  es: dict.es.fp.contrib.residual,
  en: dict.en.fp.contrib.residual,
} as const

function nodeLabel(n: ChangeNode, lang: 'en' | 'es'): string {
  return lang === 'es' ? n.labelEs : (n.labelEn ?? n.labelEs)
}

function reasonText(reason: NodeUnavailableReason | null, w: Translation['fp']['weeklyChanges']): string | null {
  switch (reason) {
    case 'missing_current':
      return w.reasonMissingCurrent
    case 'missing_previous':
      return w.reasonMissingPrevious
    case 'missing_both':
      return w.reasonMissingBoth
    case 'currency_mismatch':
      return w.reasonCurrencyMismatch
    default:
      return null
  }
}

/** ok/complete → reconciled · residual/partial → partial · else unavailable. */
function displayState(status: 'ok' | 'complete' | 'residual' | 'partial' | 'unavailable'): ReconciliationDisplayState {
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
 * Sentinel for "no custom range — compare with the preceding published week"
 * (R13.R1.1 § 13). A non-date string, so it can never collide with a real
 * `as_of_date` option value.
 */
const WEEKLY_DEFAULT = 'weekly'

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
  publishedAt,
}: {
  title: string
  rows: ChangeNode[]
  allNodes: ChangeNode[]
  masked: boolean
  emptyMessage: string
  dates: { previous: string; current: string }
  publishedAt: string
}) {
  const { t, lang } = useLang()
  const w = t.fp.weeklyChanges

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
                <span className="block">{t.fp.portfolio.colPrev}</span>
                <span className="block ui-number font-normal normal-case tracking-normal">
                  {formatIsoDateLabel(dates.previous)}
                </span>
              </th>
              <th className={`${TH} text-right`} scope="col">
                <span className="block">{t.fp.portfolio.colThis}</span>
                <span className="block ui-number font-normal normal-case tracking-normal">
                  {formatIsoDateLabel(dates.current)}
                </span>
              </th>
              <th className={`${TH} text-right`} scope="col">
                {w.weeklyValueChange}
              </th>
              <th className={`${TH} text-right`} scope="col">
                {w.ownPctChange}
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
                      about how a week with no movement is written. (A ranked
                      row is a mover by construction, so in practice neither
                      dashes here — the shared rule is what keeps it that way.) */}
                  <td className={`${CELL} text-right ui-number whitespace-nowrap ${changeColor(n.weeklyValueChange)}`}>
                    <MaskedAmount value={n.weeklyValueChange} masked={masked} signed zeroDash />
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
// Page
// ---------------------------------------------------------------------------

function WeeklyChangesPageInner() {
  const { t, lang } = useLang()
  const w = t.fp.weeklyChanges
  const o = t.fp.overview
  const { scopes } = useFamilyPortfolio()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [masked, setMasked] = usePrivacyMode()

  const portfolioScopes = scopes.filter((s) => s.id !== 'alternatives')
  const requested = searchParams.get('scope')
  const activeScope = portfolioScopes.some((s) => s.id === requested)
    ? (requested as string)
    : (portfolioScopes[0]?.id ?? null)

  /** null = the latest published week. */
  const [asOf, setAsOf] = useState<string | null>(null)
  /**
   * R13.R1.1 § 13 — the CUSTOM RANGE opening endpoint. Null keeps the default
   * weekly comparison against the immediately preceding published week; the
   * default is deliberately preserved, so the surface behaves exactly as before
   * until a range is chosen.
   */
  const [compareFrom, setCompareFrom] = useState<string | null>(null)
  const requestKey = `${activeScope ?? ''}|${asOf ?? 'latest'}|${compareFrom ?? 'weekly'}`
  const [slot, setSlot] = useState<FetchSlot | null>(null)

  // R13.R3B.1 — the personal-scope "driver view" rail (By Sociedad / By Asset
  // Class) is GONE with the waterfall it tiled. R13.R3C adds a different
  // control in its place: a SUBJECT rail (Combined Portfolio / one sociedad),
  // which chooses whose value change the card describes rather than at what
  // grain a single total is tiled.
  const [includeCash, setIncludeCash] = useState(false)
  // R13.R3C — the in-place breadcrumb drill is replaced by the shared
  // breakdown popup, so the page holds only which component is open, not a
  // path. Depth now lives inside the modal, where the parent and its
  // reconciliation stay on screen the whole way down.
  const [subjectKey, setSubjectKey] = useState<string>(COMBINED_SUBJECT)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const fullTableRef = useRef<HTMLDivElement | null>(null)

  // Render-time previous-value pattern (the codebase's standing rule — never
  // an effect): a scope switch resets the personal-view controls; any new
  // (scope, week) request resets the drill position.
  const [prevScope, setPrevScope] = useState(activeScope)
  if (prevScope !== activeScope) {
    setPrevScope(activeScope)
    setIncludeCash(false)
    // A custom range belongs to the scope it was chosen in; carrying it across
    // could name a week the new scope has not published.
    setCompareFrom(null)
  }
  const [prevRequestKey, setPrevRequestKey] = useState(requestKey)
  if (prevRequestKey !== requestKey) {
    setPrevRequestKey(requestKey)
    // A subject key names a row of THIS scope's hierarchy and an open popup
    // describes THIS comparison; neither survives a new request.
    setSubjectKey(COMBINED_SUBJECT)
    setOpenKey(null)
  }

  useEffect(() => {
    if (!activeScope) return
    let cancelled = false
    ;(async () => {
      const key = `${activeScope}|${asOf ?? 'latest'}|${compareFrom ?? 'weekly'}`
      const res = await fetchFamilyPortfolioWeeklyChanges(activeScope, asOf, compareFrom)
      if (cancelled) return
      if (!res.ok) {
        // A selected week that stopped existing (rolled back while open)
        // resets to the latest — never a nearest-week guess.
        if (res.status === 404 && compareFrom !== null) {
          setCompareFrom(null)
          return
        }
        if (res.status === 404 && asOf !== null) {
          setAsOf(null)
          return
        }
        setSlot({ key, outcome: res.status === 403 ? 'denied' : 'error', data: null })
        return
      }
      setSlot({ key, outcome: 'ready', data: res.data })
    })()
    return () => {
      cancelled = true
    }
  }, [activeScope, asOf, compareFrom])

  const current = slot && slot.key === requestKey ? slot : null
  const loading = activeScope !== null && current === null
  const data = current?.outcome === 'ready' ? current.data : null
  const pub = data?.publication ?? null
  const prevPub = data?.previousPublication ?? null

  const activeLabel = portfolioScopes.find((s) => s.id === activeScope)
  const scopeLabel = activeLabel ? (lang === 'es' ? activeLabel.labelEs : activeLabel.labelEn) : ''

  const isMain = activeScope === 'main'
  const nodes = useMemo(() => data?.nodes ?? [], [data])
  const total = data?.total ?? null
  const flowRecon = data?.flowReconciliation ?? null

  // ── Every derived figure below comes from the LOCKED pure module ──────────
  const ranked = useMemo(() => rankWeeklyChanges(nodes, { excludeCash: !includeCash }), [nodes, includeCash])
  // § 6g fixes the drill hierarchy per scope kind: Main tiles by its top-level
  // rows; a personal scope drills Sociedad → Asset Class → Subasset → Asset.
  const hierarchyGrouping: DriverGrouping = isMain ? 'top_level' : 'sociedad'
  const hierarchyDrivers = useMemo(() => deriveDrivers(nodes, hierarchyGrouping), [nodes, hierarchyGrouping])
  // ── R13.R3B.1 · ONE DRIVER SET, REPORTED AS A RECONCILIATION ─────────────
  //
  // The retired waterfall derived its own driver list because a personal scope
  // could re-tile it (top-level for Main, or the rail's sociedad/asset-class
  // choice). With the rail gone that list is identical to the hierarchy's, so
  // the page now derives ONE set and reuses it: the same `buildWaterfall` the
  // route calls still answers whether the week's drivers reconcile to the
  // published total, which the status section reports. Nothing is drawn from
  // it — the decomposition itself now lives on Summary over a real period.
  const driverReconciliation = useMemo(
    () => (total ? buildWaterfall(total, hierarchyDrivers, STEP_LABELS) : null),
    [total, hierarchyDrivers],
  )
  const fullRows = useMemo(() => buildFullChangesTable(nodes), [nodes])

  // ── R13.R3C · the same Contributors and Detractors system as Summary ──────
  //
  // Identical modules, identical component, identical popup — only the window
  // differs: Summary compares two endpoints of a chosen period, this page
  // compares the two weeks the reader selected above. A measure drawn one way
  // here and another way there would be two measures wearing one name.
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

  function selectScope(next: string) {
    router.replace(`/family-portfolio/weekly-changes?scope=${encodeURIComponent(next)}`, { scroll: false })
  }

  const ready = data !== null
  const state = data?.state ?? null
  const showSections = ready && state === 'ok' && pub !== null && prevPub !== null && total !== null

  // § 13 — the range controls. `isCustomRange` is the SERVER's answer, so the
  // title and notes describe the comparison actually performed rather than a
  // guess made from the two dates.
  const isCustomRange = data?.mode === 'custom'
  const selectedWeek = asOf ?? pub?.asOfDate ?? null
  const earlierWeeks = useMemo(
    () => (data?.weeks ?? []).filter((x) => selectedWeek !== null && x.asOfDate < selectedWeek),
    [data, selectedWeek],
  )
  const reclassifications = data?.reclassifications ?? []

  return (
    <div className="w-full">
      {/* ── § 6h item 1 · header, portfolio selector, week selector ───────── */}
      <PageHeader
        eyebrow={t.fp.tag}
        // § 13 — a range spanning more than one week is NOT a "Weekly Change".
        // The mode comes from the server's own answer, never from comparing the
        // two dates here, so the title always matches the measurement made.
        title={isCustomRange ? w.customTitle : w.title}
        metadata={
          pub ? (
            <>
              <span>{scopeLabel}</span>
              <span>
                {t.fp.portfolio.week} {formatIsoDateLabel(pub.asOfDate)}
              </span>
              <span>
                {t.fp.portfolio.revisionShort} {pub.revision}
              </span>
            </>
          ) : undefined
        }
        actions={
          <>
            {portfolioScopes.length > 1 && (
              <SegmentedControl
                options={portfolioScopes.map((s) => ({
                  value: s.id,
                  label: lang === 'es' ? s.labelEs : s.labelEn,
                }))}
                value={activeScope ?? portfolioScopes[0].id}
                onChange={selectScope}
                ariaLabel={t.fp.portfolio.scopeSelector}
                remeasureToken={lang}
              />
            )}
            {ready && data.weeks.length > 0 && pub && (
              <WeekSelector
                weeks={data.weeks}
                value={asOf ?? pub.asOfDate}
                onChange={(next) => setAsOf(next)}
                disabled={loading}
                label={data.weeks.length > 1 ? w.compareTo : undefined}
              />
            )}
            {/* § 13 — the FROM endpoint. Only weeks strictly EARLIER than the
                selected one are offered, so an invalid range cannot be built in
                the UI at all; the server still refuses one independently. */}
            {ready && pub && earlierWeeks.length > 0 && (
              <WeekSelector
                weeks={earlierWeeks}
                value={compareFrom ?? WEEKLY_DEFAULT}
                onChange={(next) => setCompareFrom(next === WEEKLY_DEFAULT ? null : next)}
                disabled={loading}
                label={w.compareFrom}
                leadingOption={{ value: WEEKLY_DEFAULT, label: w.compareWeekly }}
              />
            )}
            <PrivacyToggle masked={masked} onToggle={() => setMasked((prev) => !prev)} />
          </>
        }
      />

      <MemberGate>
        {portfolioScopes.length === 0 ? (
          <EmptyState message={t.fp.noAccess} />
        ) : current?.outcome === 'denied' ? (
          <AsyncState kind="unavailable" message={t.fp.portfolio.notAuthorized} />
        ) : loading ? (
          <AsyncState kind="loading" />
        ) : current?.outcome === 'error' ? (
          <AsyncState kind="error" message={t.fp.portfolio.loadError} />
        ) : state === 'no_publications' ? (
          <AsyncState kind="empty" message={t.fp.portfolio.noPublication} />
        ) : state === 'empty' ? (
          <AsyncState kind="empty" message={t.fp.portfolio.emptyScope} />
        ) : state === 'no_previous_week' ? (
          <div className="flex flex-col gap-3">
            {pub && (
              <p className="ui-meta text-muted-fg">
                {w.thisWeekLabel}: {formatIsoDateLabel(pub.asOfDate)} · {w.previousWeekLabel}: — · {w.pairNote}
              </p>
            )}
            {/* The earliest published week: a prior published observation does
                not exist, so weekly-change analytics are genuinely unavailable
                — an honest explanation, never a zero-change page. */}
            <AsyncState kind="empty" message={w.noPreviousWeek} />
          </div>
        ) : showSections ? (
          <div className="flex flex-col gap-4">
            {/* R13.R2F5.1 § A — these two notes were a bare vertical stack
                capped far short of the page's width; `.nv-notes` keeps the
                stack (one left origin) and widens the measure to 110ch. The
                reclassifications block below is excluded — it is a titled
                list, not plain footnote text. */}
            <div className="nv-notes">
              {/* The one selection every section below shares (doc 07 § 6b). */}
              <p className="ui-meta text-muted-fg">
                {isCustomRange ? (
                  <>
                    {w.compareFrom}: {formatIsoDateLabel(prevPub.asOfDate)} · {w.compareTo}:{' '}
                    {formatIsoDateLabel(pub.asOfDate)} · {w.customPairNote}
                  </>
                ) : (
                  <>
                    {w.thisWeekLabel}: {formatIsoDateLabel(pub.asOfDate)} · {w.previousWeekLabel}:{' '}
                    {formatIsoDateLabel(prevPub.asOfDate)} · {w.pairNote}
                  </>
                )}
              </p>
              {/* § 13 — why the source's own flow and profit are absent here. An
                  omission a reader can see explained is honest; a silent one is
                  indistinguishable from a bug. */}
              {isCustomRange && <p className="ui-meta text-muted-fg">{w.customFlowNote}</p>}
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

            {/* ── § 6h items 2–3 · ONE COMBINED WEEKLY BLOCK ─────────────────
                This row began as THREE cards — a hero, a *Total-level weekly
                metrics* list, and the reconciliation. The metrics card is
                deleted, and items 2 and 3 are now ONE card split by a vertical
                rule, both on the owner's product decision.

                The split is the point: the two halves answer different
                questions and repeat nothing.

                  LEFT — THE LEDGER. How the week got from one value to the
                  other, read top to bottom: opening value, the money the book
                  MADE, the money that MOVED IN OR OUT, closing value. Opening
                  and closing are set larger than the two movements between
                  them; they are the week's endpoints, and the two middle rows
                  are what happened in between.

                  RIGHT — THE HEADLINE. The same week as one figure: the value
                  change, and the rate it represents.

                NOTHING ELSE JOINS THEM, deliberately. Every other total-level
                figure this page could add is either already a ledger row or
                derivable from one by eye — the change IS ending − opening, and
                IS ALSO P&L + flows — so a fifth or sixth summary number would
                be exactly the wall of repeated figures this block exists to
                avoid. The deleted metrics card's YTD P&L and YTD RETURN were
                not folded in here for a different reason: they are
                year-to-date figures on a page whose every other block is about
                the ONE week selected above, so they invited the year to be
                read as the week. Summary reports both, over a period the
                reader chooses.

                The hero's two minis went the same way: opening and closing
                value are rows 1 and 4 of the ledger beside them.

                DOM ORDER IS THE CONTRACT'S — § 6h item 2, then item 3 — and
                the headline is placed right at xl with `order`. That also
                gives the stacked layout the better reading: the figure first,
                then the ledger that explains it. Nothing in the block is
                focusable, so the visual and DOM orders cannot diverge for a
                keyboard or a screen reader.

                ── THE IMPLIED-vs-PUBLISHED CROSS-CHECK IS NO LONGER DRAWN ──

                It is still COMPUTED, on every request, unchanged:
                `reconcileFlowAndProfit` is untouched, the route still returns
                it, and its verdict is still reported in the status section
                (item 9). What is gone is printing `implied` and `published`
                as two adjacent dollar figures — to a reader who is not already
                reconciling, two near-identical amounts read as a discrepancy
                even when they agree to the cent.

                The place to CATCH a real mismatch is before publication, and
                the parser already does: a stated weekly profit that does not
                equal `this week − previous week − flow` cannot bind its basis
                (`ambiguous_performance_basis`, blocking) or is reported as
                `performance_definition_mismatch` (warning), and an unreadable
                flow cell fails the week closed (`flow_cell_unreadable`). All
                three surface in the administrator's upload review before a
                byte is published. (The Resumen parser owns those checks; this
                page neither parses nor re-checks anything.)

                A residual that survives all that — the previous PUBLISHED week
                differing from the workbook's own previous column — still says
                so here, in one line, without printing the second figure. */}
            <GlassSurface variant="card" className="p-4 xl:p-5">
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(0,0.8fr)] gap-4 xl:gap-0">
                {/* § 6h item 2 · THE HEADLINE — placed RIGHT at xl, and first in
                    the stack below it, which is the better reading order there:
                    the figure, then the ledger that explains it. */}
                <KpiHero
                  bare
                  className="xl:order-2 justify-center border-b border-border pb-4 xl:border-b-0 xl:border-l xl:pb-0 xl:pl-6"
                  label={w.weeklyValueChange}
                  value={total.weeklyValueChange}
                  formatValue={(v) => (v > 0 ? `+${formatUsd(v)}` : formatUsd(v))}
                  privacyMasked={masked}
                  countUp
                  changeValue={total.weeklyReturn}
                  changeLabel={`${formatRatioPct(total.weeklyReturn)} ${o.weeklyReturn}`}
                />

                {/* § 6h item 3 · THE LEDGER — flow / investment-result
                    reconciliation, read top to bottom. */}
                {flowRecon && (
                <div className="xl:order-1 flex flex-col gap-2 min-w-0 xl:pr-6">
                  <h2 className="ui-label text-muted-fg">{w.flowReconTitle}</h2>
                  <dl className="flex flex-col gap-1.5">
                    {(
                      [
                        { label: w.previousValueLabel, value: flowRecon.previousValue, signed: false, strong: true },
                        { label: o.weeklyProfit, value: flowRecon.profit, signed: true },
                        { label: w.flowLabel, value: flowRecon.flow, signed: true },
                        { label: w.endingValueLabel, value: flowRecon.actualCurrent, signed: false, strong: true, divider: true },
                      ] as Array<{
                        label: string
                        value: number | null
                        signed: boolean
                        strong?: boolean
                        divider?: boolean
                      }>
                    ).map((r) => (
                      <div
                        key={r.label}
                        className={`flex items-baseline justify-between gap-3 ${r.strong ? 'text-sm' : 'text-xs'} ${r.divider ? 'border-t border-border pt-1.5' : ''}`}
                      >
                        <dt className={`min-w-0 truncate ${r.strong ? 'text-foreground' : 'text-muted-fg'}`}>
                          {r.label}
                        </dt>
                        {/* The week's ENDPOINTS carry the emphasis; the two
                            movements between them stay quiet, so the eye reads
                            "from here, to here" before it reads how. */}
                        <dd className={`ui-number shrink-0 text-foreground ${r.strong ? 'text-base font-semibold' : ''}`}>
                          <MaskedAmount value={r.value} masked={masked} signed={r.signed} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="ui-meta text-muted-fg">{w.flowReconNote}</p>
                  {/* Never on a week that reconciles, and never a second amount:
                      an equation whose printed terms do not sum must say so, or
                      the note above it becomes a claim the card disproves. */}
                  {flowRecon.status === 'residual' && (
                    <p className="ui-meta text-warning">{w.flowReconResidual}</p>
                  )}
                </div>
                )}
              </div>
            </GlassSurface>

            {/* ── § 6h item 4 · RETIRED (R13.R3B.1) ─────────────────────────
                The Drivers waterfall stood here. It now lives on the Summary
                tab over 3M / YTD / 1Y / ALL, beside Portfolio Evolution — the
                same decomposition, from the same locked functions, over a
                window wide enough for the drivers to be legible.

                Nothing replaces it here: the week's largest increases and
                decreases (item 5, below) already rank the same movers, and the
                driver reconciliation this card used to carry is reported in
                the status section (item 9). Adding a second waterfall would
                duplicate Summary, which is exactly what the move avoided. */}

            {/* ── § 6h item 5 · ranked panels + cash toggle + View All ───────
                R13.R3C.2 visual pass — the wrapper below closes after the
                movers/chart grid: the toggle, its notes and the panels they
                govern hold together at a tighter gap than the page's 16px
                section rhythm, so the toolbar reads as the head of the region
                below rather than a stray band between two regions. */}
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
              {/* R13.R2F5 — was four bare stacked `<p>`s at the full section
                  width; `.nv-notes` stacks the cash-toggle explanation, the
                  withheld/included state and the ranking note at ONE left
                  origin, each at a 110ch measure. */}
              <div className="nv-notes">
                <p className="ui-meta text-muted-fg">{w.cashWhy}</p>
                {!includeCash && ranked.cashRowCount > 0 && (
                  <p className="ui-meta text-muted-fg">
                    {ranked.cashRowCount} {w.cashWithheldSuffix}
                  </p>
                )}
                {includeCash && <p className="ui-meta text-muted-fg">{w.cashIncludedNote}</p>}
                <p className="ui-meta text-muted-fg">{w.rankNote}</p>
              </div>
            </div>

            {/* ── § 6h items 5–6 · the movers, and the chart that ranks them ──
                R13.R3C.2 — increases OVER decreases in one column, with the
                hierarchy chart beside them. The two panels are the same week's
                movers listed by name and figure; the chart is that same week
                ranked and drawn. Side by side they check each other: the
                tallest bar should be the first row of the increases panel, and
                the deepest the first row of the decreases. Stacked vertically,
                as they were, the reader had to remember one to read the other.

                R13.R3C.4 — THE TWO SIDES NOW END LEVEL. The row was
                `items-start`, so each column took its own natural height and
                the chart stopped wherever its 240px plot ran out — usually
                well above the decreases table, leaving a ragged step down the
                middle of the page and a plot smaller than the space it had.
                The row stretches now, and the slack lands in the PLOT
                (`fill`), not in padding under it: the taller side governs, the
                bars get every pixel the movers block spends, and the reader
                compares two blocks that share one baseline. Below xl the grid
                is one column, each card takes its own height, and `fill`
                falls back to the same 240px floor it always drew at. */}
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 items-stretch">
              <div className="flex flex-col gap-4 min-w-0">
                <RankedPanel
                  title={w.increasesTitle}
                  rows={ranked.increases}
                  allNodes={nodes}
                  masked={masked}
                  emptyMessage={w.noIncreases}
                  dates={{ previous: prevPub.asOfDate, current: pub.asOfDate }}
                  publishedAt={pub.publishedAt}
                />
                <RankedPanel
                  title={w.decreasesTitle}
                  rows={ranked.decreases}
                  allNodes={nodes}
                  masked={masked}
                  emptyMessage={w.noDecreases}
                  dates={{ previous: prevPub.asOfDate, current: pub.asOfDate }}
                  publishedAt={pub.publishedAt}
                />
              </div>

              {/* ── § 6h item 6 · hierarchy drill-down (exact § 6g title) ──── */}
              <GlassSurface variant="card" className="p-4 flex flex-col gap-3 min-w-0 h-full">
              {/* Title and its § 4.2 measure note read as ONE header unit —
                  tighter to each other than to the controls and chart below. */}
              <div className="flex flex-col gap-1">
                <h2 className="ui-label text-muted-fg">{w.hierarchyTitle}</h2>
                {/* The § 4.2 name of what each bar shows: the node's share of
                    the portfolio's dollar move — a value change, never a return. */}
                <p className="ui-meta text-muted-fg">{w.contribution}</p>
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
                    remeasureToken={`${lang}|${activeScope ?? ''}`}
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
                  ariaLabel={w.hierarchyTitle}
                  labelOverrides={labelOverrides}
                  fill
                />
              )}
              </div>

              {/* The set's own reconciliation against the subject it tiles.
                  Stated in words: a chart of changes has no closing column
                  whose landing point could state it geometrically. A hairline
                  sets the verdict band apart from the plot above it — the same
                  device the Summary card uses ahead of its own notes. */}
              {contributionSet.status !== 'unavailable' && (
                <div
                  className="flex flex-col gap-1 pt-2.5"
                  style={{ borderTop: '1px solid var(--nv-line)' }}
                >
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
              <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
              </GlassSurface>
            </div>
            </div>

            {/* ── § 6h item 7 · full changes table ─────────────────────────── */}
            <div ref={fullTableRef}>
              <TableCard
                title={w.fullTableTitle}
                minWidth={760}
                maxHeight={640}
                footer={
                  // R13.R2F5.1 § A — `.nv-notes` stacks the source line and the
                  // two table notes at ONE left origin, each at 110ch.
                  <div className="nv-notes">
                    <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
                    <p className="ui-meta text-muted-fg">{w.fullTableNote}</p>
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
                        <span className="block">{t.fp.portfolio.colPrev}</span>
                        <span className="block ui-number font-normal normal-case tracking-normal">
                          {formatIsoDateLabel(prevPub.asOfDate)}
                        </span>
                      </th>
                      <th className={`${TH} text-center`} scope="col">
                        <span className="block">{t.fp.portfolio.colThis}</span>
                        <span className="block ui-number font-normal normal-case tracking-normal">
                          {formatIsoDateLabel(pub.asOfDate)}
                        </span>
                      </th>
                      <th className={`${TH} text-center`} scope="col">
                        {w.weeklyValueChange}
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
                        {/* The hierarchy column stays LEFT-aligned and is the
                            one exception to the centring: its indent IS the
                            tree, and a centred row loses the depth it encodes. */}
                        <td className={`${CELL} text-left`}>
                          <span className="block truncate max-w-[18rem]" style={{ paddingLeft: n.depth * 14 }} title={nodeLabel(n, lang)}>
                            {nodeLabel(n, lang)}
                          </span>
                          {/* R13.R3C.4 — the retired Status column's content, in
                              the one place it can go without a column of its
                              own. It is not decoration: a row the source could
                              not compare must SAY why, or an em dash in the
                              value cells is indistinguishable from a bug. */}
                          {n.status !== 'ok' && (
                            <span
                              className="block ui-meta text-muted-fg truncate max-w-[18rem]"
                              style={{ paddingLeft: n.depth * 14 }}
                            >
                              {w.statusUnavailable}
                              {reasonText(n.unavailableReason, w) ? ` — ${reasonText(n.unavailableReason, w)}` : ''}
                            </span>
                          )}
                        </td>
                        <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
                          <MaskedAmount value={n.previousValue} masked={masked} />
                        </td>
                        <td className={`${CELL} text-center ui-number whitespace-nowrap`}>
                          <MaskedAmount value={n.currentValue} masked={masked} />
                        </td>
                        {/* R13.R3C.4 — the three CHANGE columns dash when they
                            print as zero. Most rows of a full weekly listing do
                            not move, and a column of `0` / `0,00%` buries the
                            handful that did. The two VALUE columns above keep
                            their numbers: a holding worth exactly nothing is a
                            real level, not an absence. */}
                        <td className={`${CELL} text-center ui-number whitespace-nowrap ${changeColor(n.weeklyValueChange)}`}>
                          <MaskedAmount value={n.weeklyValueChange} masked={masked} signed zeroDash />
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

            {/* ── § 6h item 8 · RETIRED (R13.R3C.2) ─────────────────────────
                *Historical Weekly Value Change* stood here: one point per
                published week, each week's change against its own predecessor.
                Removed on the owner's product decision. It answered a question
                the page is not for — how the week-to-week change has behaved
                over time — which Portfolio Evolution on Summary answers better
                and over a properly flow-adjusted series, while this page is
                about ONE selected week and what moved inside it.

                Nothing else went with it: the route still returns `trend` and
                no calculation changed. What is gone is a chart whose own
                subject was a different one from every other block around it. */}

            {/* ── § 6h item 9 · freshness, statuses, sources, methodology ──── */}
            <GlassSurface variant="card" className="p-4 flex flex-col gap-3">
              <h2 className="ui-label text-muted-fg">{w.statusTitle}</h2>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-fg">
                <span>
                  {t.fp.portfolio.week} {formatIsoDateLabel(pub.asOfDate)}
                </span>
                <span>
                  {w.previousWeekLabel}: {formatIsoDateLabel(prevPub.asOfDate)}
                </span>
                <span>
                  {w.publishedAtLabel}: {formatIsoDateLabel(pub.publishedAt.slice(0, 10))}
                </span>
                <span>
                  {t.fp.portfolio.revisionShort} {pub.revision}
                </span>
                <span>
                  {t.fp.portfolio.parserLabel} {pub.parserVersion}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {/* R13.R3B.1 — this is where the retired card's reconciliation
                    survives. It answers a question about the WEEK'S DATA, not
                    about a chart: do the week's asset-level changes account for
                    the published total? That stays worth reporting whether or
                    not anything is drawn from them. */}
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
                {flowRecon && (
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
              <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
              {/* Persistent methodology note (doc 07 § 7.3) — always rendered,
                  never a tooltip. */}
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <h3 className="ui-label text-muted-fg">{w.methodologyTitle}</h3>
                <ul className="flex flex-col gap-1 list-disc pl-4">
                  {[w.methodologyLevel, w.methodologyPair, w.methodologyImpact, w.methodologyDrivers, w.methodologyCash].map(
                    (item) => (
                      <li key={item} className="ui-meta text-muted-fg">
                        {item}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </GlassSurface>
          </div>
        ) : (
          <AsyncState kind="unavailable" />
        )}
      </MemberGate>

      {/* Mounted as a sibling at the bottom of the page tree, the established
          overlay pattern. `ModalShell` renders nothing while closed. */}
      <ContributionBreakdownModal
        open={openKey !== null}
        onClose={() => setOpenKey(null)}
        nodes={nodes}
        rowKey={openKey}
        masked={masked}
        periodLabel={
          pub && prevPub ? `${formatIsoDateLabel(prevPub.asOfDate)} — ${formatIsoDateLabel(pub.asOfDate)}` : ''
        }
        residualLabel={RESIDUAL_LABEL}
        labelOverrides={labelOverrides}
      />
    </div>
  )
}

export default function FamilyPortfolioWeeklyChangesPage() {
  return (
    <Suspense fallback={<AsyncState kind="loading" />}>
      <WeeklyChangesPageInner />
    </Suspense>
  )
}
