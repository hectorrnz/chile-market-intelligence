'use client'

// R13.7 — `/family-portfolio` — the generated Overview (One Pager).
//
// Composition per doc 06 § 5 and doc 07 § 7.1: hero, weekly-close comparison,
// allocation on three bases, two evolution charts, weekly results, market
// context, administrator commentary, and the MANDATORY provisional-price
// disclaimer. Every element renders its real published figure or an honest
// `—` — never a sample value, never a stale number styled as current.
//
// THE CLIENT IS PRESENTATION, NEVER PROTECTION. Everything here is what
// /api/family-portfolio/overview/main returned for THIS caller; the route
// re-derives entitlement server-side and PostgreSQL RLS re-derives it again.
//
// PRIVACY: every PORTFOLIO amount renders through MaskedAmount / a
// privacy-masked KpiHero, and the evolution charts render only when unmasked
// (masking replaces the whole chart — axis labels and tooltips carry raw
// amounts, so hiding the line while leaving those would not mask anything).
// Returns, weights and public benchmark prices follow the app's existing
// policy for non-wealth figures and stay visible.

import { useEffect, useState } from 'react'
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
import { LineChart } from '@/components/charts/LineChart'
import { MemberGate } from '@/components/familyPortfolio/MemberGate'
import { HierarchicalTable } from '@/components/familyPortfolio/HierarchicalTable'
import { MaskedAmount } from '@/components/familyPortfolio/MaskedAmount'
import { AllocationDonut } from '@/components/familyPortfolio/AllocationDonut'
import { DualFreshnessBadge } from '@/components/familyPortfolio/DualFreshnessBadge'
import { formatUsd, formatRatioPct, formatWeightPct, formatIsoDateLabel } from '@/lib/formatters'
import {
  fetchFamilyPortfolioOverview,
  type FamilyPortfolioOverviewResponse,
  type OverviewAllocationBasis,
  type OverviewMarketMetric,
  type OverviewPerformanceBlock,
} from '@/lib/data/familyPortfolio'

type PageState = 'loading' | 'ready' | 'denied' | 'error'

// ---------------------------------------------------------------------------
// Weekly-results block (one performance basis, source-provided values)
// ---------------------------------------------------------------------------

function PerformanceBlockCard({
  block,
  title,
  masked,
}: {
  block: OverviewPerformanceBlock
  title: string
  masked: boolean
}) {
  const { t } = useLang()
  const o = t.fp.overview
  const rows: Array<{ label: string; amount?: number | null; ratio?: number | null }> = [
    { label: o.flow, amount: block.flow },
    { label: o.weeklyReturn, ratio: block.weeklyReturn },
    { label: o.weeklyProfit, amount: block.weeklyProfit },
    { label: o.ytdReturn, ratio: block.ytdReturn },
    { label: o.ytdProfit, amount: block.ytdProfit },
  ]
  return (
    <GlassSurface variant="card" className="p-4 flex flex-col gap-2">
      <h3 className="ui-label text-muted-fg">{title}</h3>
      <dl className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-muted-fg min-w-0 truncate">{r.label}</dt>
            <dd className="ui-number text-foreground shrink-0">
              {r.ratio !== undefined ? (
                <span className={r.ratio !== null && r.ratio < 0 ? 'text-negative' : r.ratio !== null && r.ratio > 0 ? 'text-positive' : ''}>
                  {formatRatioPct(r.ratio)}
                </span>
              ) : (
                <MaskedAmount value={r.amount ?? null} masked={masked} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </GlassSurface>
  )
}

// ---------------------------------------------------------------------------
// Allocation card — donut for the selected basis, table across all three
// ---------------------------------------------------------------------------

type BasisId = OverviewAllocationBasis['id']

function AllocationCard({
  bases,
  masked,
  publishedAt,
}: {
  bases: OverviewAllocationBasis[]
  masked: boolean
  publishedAt: string
}) {
  const { t, lang } = useLang()
  const o = t.fp.overview
  const [basisId, setBasisId] = useState<BasisId>('total')

  const basisLabel = (id: BasisId) =>
    id === 'total' ? o.basisTotal : id === 'ex_chilean' ? o.basisExChilean : o.basisExChileanExInretail

  const selectable = bases.filter((b) => b.status !== 'unavailable')
  const selected = bases.find((b) => b.id === basisId && b.status !== 'unavailable') ?? selectable[0] ?? null

  // Union of entries across bases (the widest basis carries the superset);
  // per-basis weights are looked up by rowKey and absent = '—', not 0.
  const unionKeys: string[] = []
  const labels = new Map<string, string>()
  for (const b of bases) {
    for (const e of b.entries) {
      if (!unionKeys.includes(e.rowKey)) unionKeys.push(e.rowKey)
      labels.set(e.rowKey, lang === 'es' ? e.labelEs : (e.labelEn ?? e.labelEs))
    }
  }
  const weightOf = (b: OverviewAllocationBasis, rowKey: string) =>
    b.entries.find((e) => e.rowKey === rowKey)?.weight ?? null
  const valueOf = (rowKey: string) => {
    for (const b of bases) {
      const e = b.entries.find((x) => x.rowKey === rowKey)
      if (e) return e.value
    }
    return null
  }
  const denomLabel = (b: OverviewAllocationBasis) =>
    lang === 'es' ? (b.denominatorLabelEs ?? '—') : (b.denominatorLabelEn ?? b.denominatorLabelEs ?? '—')

  const allUnavailable = bases.every((b) => b.status === 'unavailable')

  return (
    <TableCard
      title={o.allocationTitle}
      controls={
        selectable.length > 1 && selected ? (
          <SegmentedControl
            options={selectable.map((b) => ({ value: b.id, label: basisLabel(b.id) }))}
            value={selected.id}
            onChange={(v) => setBasisId(v)}
            ariaLabel={o.allocationTitle}
            remeasureToken={lang}
          />
        ) : undefined
      }
      state={allUnavailable ? 'unavailable' : undefined}
      minWidth={640}
      footer={
        <div className="flex flex-col gap-y-0.5">
          <TableSourceFooter source={t.fp.portfolio.source} asOf={publishedAt} />
          <p className="ui-meta text-muted-fg">{o.allocationNote}</p>
          {bases
            .filter((b) => b.residual !== null)
            .map((b) => (
              <p key={b.id} className="ui-meta flex items-center gap-1.5" style={{ color: 'var(--warning)' }}>
                <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--warning)' }} />
                {basisLabel(b.id)}: {o.residualWarning}{' '}
                <MaskedAmount value={b.residual} masked={masked} />
              </p>
            ))}
        </div>
      }
    >
      {!allUnavailable && (
        <div className="flex flex-col gap-4 p-4">
          {selected && (
            <AllocationDonut
              entries={selected.entries.map((e) => ({
                key: e.rowKey,
                label: lang === 'es' ? e.labelEs : (e.labelEn ?? e.labelEs),
                weight: e.weight,
              }))}
              summary={`${o.allocationTitle} — ${basisLabel(selected.id)}`}
            />
          )}
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="border-b border-border-strong">
                <th className="text-left py-2.5 px-3 first:pl-4 ui-table-header text-muted-fg" scope="col">
                  {t.fp.portfolio.colHierarchy}
                </th>
                <th className="text-right py-2.5 px-3 ui-table-header text-muted-fg" scope="col">
                  {t.fp.portfolio.valuesInUsd}
                </th>
                {bases.map((b) => (
                  <th key={b.id} className="text-right py-2.5 px-3 last:pr-4 ui-table-header text-muted-fg" scope="col">
                    <span className="block">{basisLabel(b.id)}</span>
                    <span className="block ui-meta font-normal normal-case tracking-normal">
                      {o.denominator}: {denomLabel(b)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unionKeys.map((rowKey) => (
                <tr key={rowKey} className="border-b border-border">
                  <td className="py-2 px-3 first:pl-4 text-left">{labels.get(rowKey)}</td>
                  <td className="py-2 px-3 text-right ui-number whitespace-nowrap">
                    <MaskedAmount value={valueOf(rowKey)} masked={masked} />
                  </td>
                  {bases.map((b) => (
                    <td key={b.id} className="py-2 px-3 last:pr-4 text-right ui-number whitespace-nowrap">
                      {formatWeightPct(weightOf(b, rowKey))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  )
}

// ---------------------------------------------------------------------------
// Market context
// ---------------------------------------------------------------------------

function MarketMetricRow({
  label,
  metric,
  kind,
}: {
  label: string
  metric: OverviewMarketMetric
  kind: 'price' | 'return'
}) {
  const { t } = useLang()
  const o = t.fp.overview
  const title =
    metric.status === 'unavailable'
      ? o.marketUnavailable
      : metric.status === 'unverified'
        ? o.benchmarksPending
        : metric.observationDate
          ? `${o.observedOn} ${formatIsoDateLabel(metric.observationDate)}`
          : undefined
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs" title={title}>
      <span className="text-muted-fg min-w-0 truncate">{label}</span>
      <span className="ui-number text-foreground shrink-0">
        {metric.status !== 'ok' || metric.value === null ? (
          <span className="text-muted-fg">—</span>
        ) : kind === 'price' ? (
          formatUsd(metric.value, 2)
        ) : (
          <span className={metric.value < 0 ? 'text-negative' : metric.value > 0 ? 'text-positive' : ''}>
            {formatRatioPct(metric.value)}
          </span>
        )}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FamilyPortfolioOverviewPage() {
  const { t } = useLang()
  const o = t.fp.overview
  const [masked, setMasked] = usePrivacyMode()
  const [state, setState] = useState<PageState>('loading')
  const [data, setData] = useState<FamilyPortfolioOverviewResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchFamilyPortfolioOverview('main')
      if (cancelled) return
      if (!result.ok) {
        setState(result.status === 403 ? 'denied' : 'error')
        return
      }
      setData(result.data)
      setState('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const pub = data?.publication ?? null
  const anyUnverified =
    data?.marketContext !== undefined &&
    Object.values(data.marketContext).some((m) => m.status === 'unverified')

  return (
    <div className="w-full">
      <PageHeader
        eyebrow={t.fp.tag}
        title={t.fp.navOverview}
        metadata={
          pub ? (
            <>
              <span>
                {t.fp.portfolio.week} {formatIsoDateLabel(pub.asOfDate)}
              </span>
              <span>
                {t.fp.portfolio.revisionShort} {pub.revision}
              </span>
            </>
          ) : undefined
        }
        actions={<PrivacyToggle masked={masked} onToggle={() => setMasked((prev) => !prev)} />}
      />

      <MemberGate>
        {state === 'loading' && <AsyncState kind="loading" />}
        {state === 'error' && <AsyncState kind="error" message={t.fp.portfolio.loadError} />}
        {state === 'denied' && <AsyncState kind="unavailable" message={t.fp.portfolio.notAuthorized} />}
        {state === 'ready' && !pub && <AsyncState kind="empty" message={t.fp.portfolio.noPublication} />}

        {state === 'ready' && data && pub && (
          <div className="flex flex-col gap-4">
            {/* ── Hero + weekly results (asymmetric, not an equal grid) ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr] gap-4 items-start">
              <KpiHero
                label={o.heroLabel}
                value={data.hero?.totalValue ?? null}
                formatValue={(v) => formatUsd(v)}
                privacyMasked={masked}
                countUp
                changeValue={data.hero?.weeklyReturn ?? null}
                changeLabel={`${formatRatioPct(data.hero?.weeklyReturn ?? null)} ${o.weeklyReturn}`}
                minis={[
                  // The weekly NMI-derived portfolio-value difference is a
                  // MONETARY figure — `sensitive` binds it to the hero's own
                  // privacy state, so it can never print while the headline
                  // amount above it is masked.
                  {
                    label: o.weeklyDifference,
                    value: formatUsd(data.hero?.weeklyDifference ?? null),
                    // An em dash discloses nothing, so an unavailable figure
                    // stays a plain `—` rather than becoming bullets that would
                    // imply a value exists (same rule as `MaskedAmount`).
                    sensitive: data.hero?.weeklyDifference != null,
                  },
                  { label: o.ytdReturn, value: formatRatioPct(data.hero?.ytdReturn ?? null) },
                ]}
              />
              {(data.performanceBlocks ?? []).map((block) => (
                <PerformanceBlockCard
                  key={block.basis}
                  block={block}
                  title={block.basis === 'ex_chilean_equities' ? o.blockExChilean : o.blockWithChilean}
                  masked={masked}
                />
              ))}
            </div>

            {/* ── Weekly close comparison (doc 06 § 2.1) ────────────────── */}
            <TableCard
              title={o.comparisonTitle}
              state={data.comparison && data.comparison.length > 0 ? undefined : 'unavailable'}
              minWidth={760}
              footer={
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
                  <p className="ui-meta text-muted-fg">
                    {t.fp.portfolio.revisionShort} {pub.revision} · {t.fp.portfolio.parserLabel}{' '}
                    {pub.parserVersion}
                  </p>
                  <p className="ui-meta text-muted-fg">{t.fp.portfolio.diffNote}</p>
                </div>
              }
            >
              {data.comparison && data.comparison.length > 0 && (
                <HierarchicalTable rows={data.comparison} dates={pub.dates} masked={masked} />
              )}
            </TableCard>

            {/* ── Allocation, three bases (doc 06 § 2.3) ────────────────── */}
            {data.allocation && (
              <AllocationCard bases={data.allocation} masked={masked} publishedAt={pub.publishedAt} />
            )}

            {/* ── Evolution (doc 06 § 2.4) ──────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(
                [
                  { key: 'ex', title: o.evolutionExChilean, points: data.evolution?.exChilean ?? [] },
                  { key: 'with', title: o.evolutionWithChilean, points: data.evolution?.withChilean ?? [] },
                ] as const
              ).map((chart) => (
                <GlassSurface key={chart.key} variant="card" className="p-4 flex flex-col gap-2">
                  <h3 className="ui-label text-muted-fg">
                    {o.evolutionTitle} · {chart.title}
                  </h3>
                  {chart.points.length < 2 ? (
                    <AsyncState kind="empty" message={o.evolutionEmpty} />
                  ) : masked ? (
                    // The chart's axis labels and tooltips carry raw amounts,
                    // so privacy mode masks the WHOLE chart, not just a line.
                    <PrivacyValue masked className="block py-10 text-center" >
                      {null}
                    </PrivacyValue>
                  ) : (
                    <LineChart
                      data={chart.points}
                      height={200}
                      valueFormatter={(v) => formatUsd(v)}
                    />
                  )}
                  <TableSourceFooter source={t.fp.portfolio.source} />
                </GlassSurface>
              ))}
            </div>

            {/* ── Market context (doc 06 §§ 2.5, 3.3) ───────────────────── */}
            <GlassSurface variant="card" className="p-4 flex flex-col gap-3">
              <h3 className="ui-label text-muted-fg">{o.marketTitle}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <h4 className="ui-label text-muted-fg">{o.inretailTitle}</h4>
                  {data.marketContext && (
                    <>
                      <MarketMetricRow label={o.inretailPrice} metric={data.marketContext.inretailPrice} kind="price" />
                      <MarketMetricRow label={o.inretailVariation} metric={data.marketContext.inretailVariation} kind="return" />
                    </>
                  )}
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-muted-fg min-w-0 truncate">{o.inretailImpact}</span>
                    <span className="ui-number text-foreground shrink-0">
                      <MaskedAmount value={data.inretailImpact?.value ?? null} masked={masked} />
                    </span>
                  </div>
                </div>
                {data.marketContext && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <h4 className="ui-label text-muted-fg">{o.globalEquity}</h4>
                      <MarketMetricRow label={o.weeklyReturn} metric={data.marketContext.globalEquity} kind="return" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <h4 className="ui-label text-muted-fg">{o.globalFixedIncome}</h4>
                      <MarketMetricRow label={o.weeklyReturn} metric={data.marketContext.globalFixedIncome} kind="return" />
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-y-0.5">
                <TableSourceFooter source={t.fp.portfolio.source} asOf={pub.publishedAt} />
                {anyUnverified && <p className="ui-meta text-muted-fg">{o.benchmarksPending}</p>}
              </div>
            </GlassSurface>

            {/* ── Administrator commentary — hidden entirely when absent ── */}
            {data.commentary && (
              <GlassSurface variant="card" className="p-4 flex flex-col gap-2">
                <h3 className="ui-label text-muted-fg">{o.commentaryTitle}</h3>
                <p className="text-sm text-foreground whitespace-pre-wrap">{data.commentary.body}</p>
                <p className="ui-meta text-muted-fg">
                  {o.commentaryAttribution} · {t.fp.portfolio.revisionShort} {data.commentary.revision} ·{' '}
                  {formatIsoDateLabel(data.commentary.updatedAt.slice(0, 10))}
                </p>
              </GlassSurface>
            )}

            {/* ── Disclosures (doc 06 §§ 2.6, 5 elements 21-23) ─────────── */}
            <div className="flex flex-col gap-2">
              <DualFreshnessBadge
                entries={[
                  { label: o.freshnessPortfolio, asOfDate: data.freshness?.portfolio.asOfDate ?? null },
                  { label: o.freshnessAlternatives, asOfDate: data.freshness?.alternatives?.asOfDate ?? null },
                ]}
              />
              <p className="ui-meta text-muted-fg">*** {o.provisionalDisclaimer}</p>
            </div>
          </div>
        )}
      </MemberGate>
    </div>
  )
}
