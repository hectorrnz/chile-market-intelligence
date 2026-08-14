'use client'

// R13.8 — `/family-portfolio/weekly-changes` (doc 08 Stage 8; doc 07 Parts
// A2/A3, page order § 6h).
//
// SECTION ORDER IS THE CONTRACT'S (§ 6h), verbatim:
//   1. page header, portfolio selector, published-week selector
//   2. total-level weekly metrics
//   3. total-level flow and investment-result reconciliation
//   4. Drivers of Weekly Portfolio Value Change (waterfall)
//   5. Largest Weekly Value Increases / Largest Weekly Value Decreases
//   6. Weekly Value Change by Portfolio Hierarchy
//   7. full changes table
//   8. historical weekly-change trend
//   9. freshness, publication status, reconciliation status, source notes,
//      and the persistent methodology note
//
// ONE WEEK SELECTION DRIVES EVERYTHING (doc 07 § 6b): a single (scope, asOf)
// fetch feeds every section; no component holds its own week.
//
// NO FINANCIAL SEMANTICS LIVE IN THIS FILE. Every figure comes from the API
// response or from the LOCKED pure Stage-8 module — drilling the hierarchy,
// switching the personal driver view, and toggling cash all call the same
// pure functions the server route calls (`deriveDrivers` / `buildWaterfall` /
// `rankWeeklyChanges` / `buildHierarchyLevel` / `buildFullChangesTable`),
// over only the rows RLS already released to this caller. The client is
// presentation, never protection and never a second calculator.
//
// PRIVACY: every dollar amount renders through `MaskedAmount` / a
// privacy-masked `KpiHero`; the waterfall and the trend chart are replaced
// WHOLE while masked (their positions/axes encode absolute levels — the
// Stage-7 evolution-chart precedent); hierarchy bars keep only RELATIVE
// extents (the allocation-donut precedent) with their dollar labels masked.
// Percentages follow the app's existing visible-percentage policy.

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { AsyncState } from '@/components/fable/AsyncState'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { KpiHero } from '@/components/fable/KpiHero'
import { TableCard } from '@/components/fable/TableCard'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { PrivacyToggle, PrivacyValue } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { EmptyState } from '@/components/ui/EmptyState'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'
import { useFamilyPortfolio } from '@/components/familyPortfolio/FamilyPortfolioProvider'
import { WeekSelector } from '@/components/familyPortfolio/WeekSelector'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { ReconciliationStatus, type ReconciliationDisplayState } from '@/components/familyPortfolio/ReconciliationStatus'
import { ValueChangeWaterfall } from '@/components/familyPortfolio/ValueChangeWaterfall'
import { DivergingBarChart, type DivergingBarDatum } from '@/components/familyPortfolio/DivergingBarChart'
import { LineChart } from '@/components/charts/LineChart'
import { formatUsd, formatRatioPct, formatIsoDateLabel } from '@/lib/formatters'
import { dict, type Translation } from '@/lib/i18n'
import {
  breadcrumbFor,
  buildFullChangesTable,
  buildHierarchyLevel,
  buildWaterfall,
  childrenOf,
  deriveDrivers,
  rankWeeklyChanges,
  type ChangeNode,
  type DriverGrouping,
  type NodeUnavailableReason,
} from '@/lib/familyPortfolio/weeklyChanges'
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

// The waterfall's synthetic step labels, in BOTH languages (the pure module
// stores labelEs/labelEn per step and the renderer picks by language) — the
// same shape the server route bakes in, sourced from the same dictionary.
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
                  <td className={`${CELL} text-right ui-number whitespace-nowrap ${changeColor(n.weeklyValueChange)}`}>
                    <MaskedAmount value={n.weeklyValueChange} masked={masked} signed />
                  </td>
                  <td className={`${CELL} text-right ui-number whitespace-nowrap ${changeColor(n.ownPctChange)}`}>
                    {formatRatioPct(n.ownPctChange)}
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

  /** Personal-scope waterfall driver view (doc 07 § 6e). Main is fixed. */
  const [grouping, setGrouping] = useState<DriverGrouping>('sociedad')
  const [includeCash, setIncludeCash] = useState(false)
  const [drillKey, setDrillKey] = useState<string | null>(null)
  const fullTableRef = useRef<HTMLDivElement | null>(null)

  // Render-time previous-value pattern (the codebase's standing rule — never
  // an effect): a scope switch resets the personal-view controls; any new
  // (scope, week) request resets the drill position.
  const [prevScope, setPrevScope] = useState(activeScope)
  if (prevScope !== activeScope) {
    setPrevScope(activeScope)
    setGrouping('sociedad')
    setIncludeCash(false)
    // A custom range belongs to the scope it was chosen in; carrying it across
    // could name a week the new scope has not published.
    setCompareFrom(null)
  }
  const [prevRequestKey, setPrevRequestKey] = useState(requestKey)
  if (prevRequestKey !== requestKey) {
    setPrevRequestKey(requestKey)
    setDrillKey(null)
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
  const waterfallGrouping: DriverGrouping = isMain ? 'top_level' : grouping
  const waterfallDrivers = useMemo(() => deriveDrivers(nodes, waterfallGrouping), [nodes, waterfallGrouping])
  const waterfall = useMemo(
    () => (total ? buildWaterfall(total, waterfallDrivers, STEP_LABELS) : null),
    [total, waterfallDrivers],
  )
  const ranked = useMemo(() => rankWeeklyChanges(nodes, { excludeCash: !includeCash }), [nodes, includeCash])
  // § 6g fixes the drill hierarchy per scope kind: Main tiles by its top-level
  // rows; a personal scope drills Sociedad → Asset Class → Subasset → Asset.
  const hierarchyGrouping: DriverGrouping = isMain ? 'top_level' : 'sociedad'
  const hierarchyDrivers = useMemo(() => deriveDrivers(nodes, hierarchyGrouping), [nodes, hierarchyGrouping])
  const level = useMemo(
    () => buildHierarchyLevel(nodes, hierarchyDrivers, drillKey),
    [nodes, hierarchyDrivers, drillKey],
  )
  const fullRows = useMemo(() => buildFullChangesTable(nodes), [nodes])

  const bars: DivergingBarDatum[] = level.bars.map((n) => ({
    key: n.rowKey,
    label: nodeLabel(n, lang),
    value: n.weeklyValueChange,
    impact: n.impactOnPortfolioValue,
    available: n.status === 'ok',
    reasonText: reasonText(n.unavailableReason, w),
    // The SAME pure drill semantics the level itself uses — a sociedad total
    // drills into its sociedad's constituents even though its own structural
    // child list is empty (R13.8 D4).
    drillable: childrenOf(nodes, n.rowKey).length > 0,
  }))

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

            {/* ── § 6h item 2 · total-level weekly metrics ─────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
              <KpiHero
                label={w.weeklyValueChange}
                value={total.weeklyValueChange}
                formatValue={(v) => (v > 0 ? `+${formatUsd(v)}` : formatUsd(v))}
                privacyMasked={masked}
                countUp
                changeValue={total.weeklyReturn}
                changeLabel={`${formatRatioPct(total.weeklyReturn)} ${o.weeklyReturn}`}
                minis={[
                  {
                    label: w.currentValueLabel,
                    value: formatUsd(total.currentValue),
                    sensitive: total.currentValue != null,
                  },
                  {
                    label: w.previousValueLabel,
                    value: formatUsd(total.previousValue),
                    sensitive: total.previousValue != null,
                  },
                  { label: o.ytdReturn, value: formatRatioPct(total.ytdReturn) },
                ]}
              />
              <GlassSurface variant="card" className="p-4 flex flex-col gap-2">
                <h2 className="ui-label text-muted-fg">{w.totalsTitle}</h2>
                <dl className="flex flex-col gap-1.5">
                  {(
                    [
                      { label: o.weeklyReturn, ratio: total.weeklyReturn },
                      { label: o.weeklyProfit, amount: total.weeklyProfit },
                      { label: o.flow, amount: total.flow },
                      { label: o.ytdReturn, ratio: total.ytdReturn },
                      { label: o.ytdProfit, amount: total.ytdProfit },
                    ] as Array<{ label: string; amount?: number | null; ratio?: number | null }>
                  ).map((r) => (
                    <div key={r.label} className="flex items-baseline justify-between gap-3 text-xs">
                      <dt className="text-muted-fg min-w-0 truncate">{r.label}</dt>
                      <dd className="ui-number text-foreground shrink-0">
                        {r.ratio !== undefined ? (
                          <span className={changeColor(r.ratio)}>{formatRatioPct(r.ratio)}</span>
                        ) : (
                          <MaskedAmount value={r.amount ?? null} masked={masked} signed />
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </GlassSurface>
            </div>

            {/* ── § 6h item 3 · flow / investment-result reconciliation ────── */}
            {flowRecon && (
              <GlassSurface variant="card" className="p-4 flex flex-col gap-2">
                <h2 className="ui-label text-muted-fg">{w.flowReconTitle}</h2>
                <dl className="flex flex-col gap-1.5 max-w-xl">
                  {(
                    [
                      { label: w.previousValueLabel, value: flowRecon.previousValue, signed: false },
                      { label: o.flow, value: flowRecon.flow, signed: true },
                      { label: o.weeklyProfit, value: flowRecon.profit, signed: true },
                      { label: w.impliedCurrent, value: flowRecon.expectedCurrent, signed: false, divider: true },
                      { label: w.publishedCurrent, value: flowRecon.actualCurrent, signed: false },
                    ] as Array<{ label: string; value: number | null; signed: boolean; divider?: boolean }>
                  ).map((r) => (
                    <div
                      key={r.label}
                      className={`flex items-baseline justify-between gap-3 text-xs ${r.divider ? 'border-t border-border pt-1.5' : ''}`}
                    >
                      <dt className="text-muted-fg min-w-0 truncate">{r.label}</dt>
                      <dd className="ui-number text-foreground shrink-0">
                        <MaskedAmount value={r.value} masked={masked} signed={r.signed} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <ReconciliationStatus
                  state={displayState(flowRecon.status)}
                  residual={flowRecon.residual}
                  masked={masked}
                />
                <p className="ui-meta text-muted-fg">{w.flowReconNote}</p>
              </GlassSurface>
            )}

            {/* ── § 6h item 4 · the waterfall (exact § 6e title) ───────────── */}
            <GlassSurface variant="card" className="p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="ui-label text-muted-fg">{w.waterfallTitle}</h2>
                {!isMain && (
                  <SegmentedControl
                    options={[
                      { value: 'sociedad', label: w.groupBySociedad },
                      { value: 'asset_class', label: w.groupByAssetClass },
                    ]}
                    value={grouping === 'asset_class' ? 'asset_class' : 'sociedad'}
                    onChange={(v) => setGrouping(v as DriverGrouping)}
                    ariaLabel={w.groupingSelector}
                    remeasureToken={lang}
                  />
                )}
              </div>
              {waterfall && waterfall.status !== 'unavailable' ? (
                <>
                  <ValueChangeWaterfall waterfall={waterfall} masked={masked} lang={lang} />
                  <ReconciliationStatus
                    state={displayState(waterfall.status)}
                    residual={waterfall.residual}
                    unavailableCount={waterfall.unavailableDriverCount}
                    unavailableNoun={w.unavailableDrivers}
                    masked={masked}
                  />
                </>
              ) : (
                <AsyncState kind="unavailable" />
              )}
              {/* R13.R2F5.1 § A — `.nv-notes` stacks the source line and the
                  waterfall note at ONE left origin, each at a 110ch measure. */}
              <div className="nv-notes">
                <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
                <p className="ui-meta text-muted-fg">{w.waterfallNote}</p>
              </div>
            </GlassSurface>

            {/* ── § 6h item 5 · ranked panels + cash toggle + View All ─────── */}
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
            </div>

            {/* ── § 6h item 6 · hierarchy drill-down (exact § 6g title) ────── */}
            <GlassSurface variant="card" className="p-4 flex flex-col gap-3">
              <h2 className="ui-label text-muted-fg">{w.hierarchyTitle}</h2>
              {/* The § 4.2 name of what each bar shows: the node's share of
                  the portfolio's dollar move — a value change, never a return. */}
              <p className="ui-meta text-muted-fg">{w.contribution}</p>
              <nav aria-label={w.breadcrumbLabel} className="flex flex-wrap items-center gap-1.5 text-xs">
                {drillKey === null ? (
                  <span aria-current="page" className="text-foreground font-medium">
                    {w.hierarchyRootLabel}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDrillKey(null)}
                    className="text-muted-fg hover:text-foreground nv-transition"
                  >
                    {w.hierarchyRootLabel}
                  </button>
                )}
                {level.breadcrumb.map((crumb, i) => {
                  const last = i === level.breadcrumb.length - 1
                  return (
                    <Fragment key={crumb.rowKey}>
                      <span aria-hidden className="text-muted-fg">
                        ›
                      </span>
                      {last ? (
                        <span aria-current="page" className="text-foreground font-medium">
                          {nodeLabel(crumb, lang)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDrillKey(crumb.rowKey)}
                          className="text-muted-fg hover:text-foreground nv-transition"
                        >
                          {nodeLabel(crumb, lang)}
                        </button>
                      )}
                    </Fragment>
                  )
                })}
                {drillKey !== null && (
                  <button
                    type="button"
                    onClick={() =>
                      setDrillKey(
                        level.breadcrumb.length > 1 ? level.breadcrumb[level.breadcrumb.length - 2].rowKey : null,
                      )
                    }
                    className="ml-2 border border-border rounded-full px-2.5 py-0.5 text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition"
                  >
                    ← {w.backUp}
                  </button>
                )}
              </nav>
              <DivergingBarChart bars={bars} masked={masked} onDrill={(key) => setDrillKey(key)} emptyText={w.hierarchyEmpty} />
              {level.reconciliation && (
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-fg">
                      {w.parentChange}:{' '}
                      <MaskedAmount value={level.reconciliation.parentChange} masked={masked} signed />
                    </span>
                    <span className="text-muted-fg">
                      {w.childSum}: <MaskedAmount value={level.reconciliation.childSum} masked={masked} signed />
                    </span>
                  </div>
                  <ReconciliationStatus
                    state={displayState(level.reconciliation.status)}
                    residual={level.reconciliation.residual}
                    unavailableCount={level.reconciliation.unavailableChildCount}
                    unavailableNoun={w.unavailableChildren}
                    masked={masked}
                  />
                </div>
              )}
              <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
            </GlassSurface>

            {/* ── § 6h item 7 · full changes table ─────────────────────────── */}
            <div ref={fullTableRef}>
              <TableCard
                title={w.fullTableTitle}
                minWidth={860}
                maxHeight={640}
                footer={
                  // R13.R2F5.1 § A — `.nv-notes` stacks the source line and the
                  // two table notes at ONE left origin, each at 110ch.
                  <div className="nv-notes">
                    <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
                    <p className="ui-meta text-muted-fg">{w.fullTableNote}</p>
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
                      <th className={`${TH} text-right`} scope="col">
                        <span className="block">{t.fp.portfolio.colPrev}</span>
                        <span className="block ui-number font-normal normal-case tracking-normal">
                          {formatIsoDateLabel(prevPub.asOfDate)}
                        </span>
                      </th>
                      <th className={`${TH} text-right`} scope="col">
                        <span className="block">{t.fp.portfolio.colThis}</span>
                        <span className="block ui-number font-normal normal-case tracking-normal">
                          {formatIsoDateLabel(pub.asOfDate)}
                        </span>
                      </th>
                      <th className={`${TH} text-right`} scope="col">
                        {w.weeklyValueChange}
                      </th>
                      <th className={`${TH} text-right`} scope="col">
                        {w.ownPctChange}
                      </th>
                      <th className={`${TH} text-right`} scope="col">
                        {w.impactOnPortfolio}
                      </th>
                      <th className={`${TH} text-left`} scope="col">
                        {w.statusColumn}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullRows.map((n) => (
                      <tr key={n.rowKey} className={`border-b border-border ${structuralRowClasses(n.rowType)}`}>
                        <td className={`${CELL} text-left`}>
                          <span className="block truncate max-w-[18rem]" style={{ paddingLeft: n.depth * 14 }} title={nodeLabel(n, lang)}>
                            {nodeLabel(n, lang)}
                          </span>
                        </td>
                        <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                          <MaskedAmount value={n.previousValue} masked={masked} />
                        </td>
                        <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                          <MaskedAmount value={n.currentValue} masked={masked} />
                        </td>
                        <td className={`${CELL} text-right ui-number whitespace-nowrap ${changeColor(n.weeklyValueChange)}`}>
                          <MaskedAmount value={n.weeklyValueChange} masked={masked} signed />
                        </td>
                        <td className={`${CELL} text-right ui-number whitespace-nowrap ${changeColor(n.ownPctChange)}`}>
                          {formatRatioPct(n.ownPctChange)}
                        </td>
                        <td className={`${CELL} text-right ui-number whitespace-nowrap`}>
                          {formatRatioPct(n.impactOnPortfolioValue)}
                        </td>
                        <td className={`${CELL} text-left`}>
                          {n.status !== 'ok' && (
                            <span className="ui-meta text-muted-fg">
                              {w.statusUnavailable}
                              {reasonText(n.unavailableReason, w) ? ` — ${reasonText(n.unavailableReason, w)}` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            </div>

            {/* ── § 6h item 8 · historical weekly-change trend ─────────────── */}
            <GlassSurface variant="card" className="p-4 flex flex-col gap-2">
              <h2 className="ui-label text-muted-fg">{w.trendTitle}</h2>
              {(data.trend ?? []).length < 2 ? (
                <AsyncState kind="empty" message={o.evolutionEmpty} />
              ) : masked ? (
                // Axis labels and tooltips carry raw amounts — privacy mode
                // replaces the WHOLE chart (Stage-7 evolution precedent).
                <PrivacyValue masked className="block py-10 text-center">
                  {null}
                </PrivacyValue>
              ) : (
                <LineChart data={data.trend ?? []} height={200} valueFormatter={(v) => formatUsd(v)} />
              )}
              {/* R13.R2F5.1 § A — `.nv-notes` stacks the source line and the
                  trend note at ONE left origin, each at a 110ch measure. */}
              <div className="nv-notes">
                <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
                <p className="ui-meta text-muted-fg">{w.trendNote}</p>
              </div>
            </GlassSurface>

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
                {waterfall && (
                  <div className="flex flex-wrap items-center gap-x-2 text-xs">
                    <span className="text-muted-fg">{w.waterfallStatusLabel}:</span>
                    <ReconciliationStatus
                      state={displayState(waterfall.status)}
                      residual={waterfall.residual}
                      unavailableCount={waterfall.unavailableDriverCount}
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
                  {[w.methodologyLevel, w.methodologyPair, w.methodologyImpact, w.methodologyWaterfall, w.methodologyCash].map(
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
