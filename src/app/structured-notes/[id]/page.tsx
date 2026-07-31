'use client'

// Phase 9A — Structured Note detail page (canonical route /structured-notes/[id]).
// General terms · underlyings · schedule · internal allocations · live prices +
// distance to barrier · source/provenance. Middleware guarantees auth.
//
// Phase R4 — Fable detail composition. Presentation only: every fetch call,
// endpoint, payload, allocation upsert, delete confirmation/redirect, and
// monitoring value below is unchanged in substance — the LAYOUT is rebuilt to
// the approved Fable note-detail anatomy (nmi-fable-v1 SPECS.md §6 "Row →
// panel: 12-field terms grid, lifecycle timeline (issued ✓, coupons ✓, next
// observation ●, maturity ○)" + §Overlays "Detail panel: header (title,
// status pill, subtitle), 2-column stats grid"), adapted from the export's
// supplementary 440px side panel to this CANONICAL full page in the R3
// dashboard's visual family (design_principles §2 — panels may never replace
// a canonical route):
//
//   Header      — back link → shared PageHeader: ISIN eyebrow (mono), the
//                 product name as a WRAPPING title (never truncation-only —
//                 the full name must not be hover-gated on touch devices),
//                 issuer · structure · lifecycle-status pill as metadata.
//   Capsules    — the R3 KPI-capsule row (StatCapsule, imported from the
//                 dashboard so the two pages can never drift): risk status,
//                 worst performer, worst distance to knock-in, next
//                 observation, coupon p.a., current notional, maturity.
//   Monitoring  — current levels & distance-to-barrier TableCard with the R3
//                 BarrierGauge per underlying (level indexed to 100 at
//                 strike — a pure display transform of the API's own
//                 currentLevel; marks = per-underlying knock-in pct + strike),
//                 proximity-colored distances (shared distanceTone), the
//                 worst-performer designation as VISIBLE text (never
//                 color/hover-only), last-monitored + stale flags, and the
//                 Yahoo footer + estimate disclaimer.
//   Terms       — the Fable terms grid, grouped into Identity · Coupon &
//                 barriers · Key dates instead of the legacy undifferentiated
//                 grid; boolean features (memory coupon, principal
//                 protection) render as chips only when true.
//   Underlyings — contractual levels table (order, name, symbol, initial,
//                 strike, knock-in, coupon, autocall).
//   Schedule    — the Fable lifecycle timeline (issued ✓ · observed n/m ✓ ·
//                 next ● · maturity ○) as the card's header strip, above the
//                 COMPLETE real observation table (every historical row kept;
//                 completed rows muted, the next observation highlighted).
//   Allocation  — the entity allocation grid preserved verbatim in behavior
//                 (upsert API, custom entities, thousands formatting, total +
//                 issue-size mismatch warning), re-housed on Fable card glass.
//   Provenance  — source type/file/confidence + the delete workflow (same
//                 confirmation text, DELETE endpoint and success-only
//                 redirect, gated by the shared Fable DestructiveConfirm
//                 dialog since R4.1 — never window.confirm) with explicit
//                 destructive styling and honest in-progress/failure states.
//
// Fable elements with no authoritative NMI data are OMITTED, never faked:
// the "View termsheet in Documents" panel action (no documents module — the
// provenance card names the source file instead), the header spark (no
// per-note valuation series exists), and the LATEST VALUATION / SETTLEMENT
// stats-grid fields (no such fields exist on this payload).

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { DEFAULT_ENTITIES } from '@/lib/structuredNotes/types'
import { dedupeObservationsByDate } from '@/lib/structuredNotes/pdf/extractStructuredNoteTerms'
import type { StructuredNote, UnderlyingPrice, RiskStatus } from '@/lib/structuredNotes/types'
import { fmtPct, fmtNum, distanceTone, shortUnderlying, StatCapsule, RISK_TONE } from '../page'
import { PageHeader } from '@/components/fable/PageHeader'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { TableCard } from '@/components/fable/TableCard'
import { BarrierGauge, type BarrierMark } from '@/components/fable/BarrierGauge'
import { AsyncState } from '@/components/fable/AsyncState'
import { DestructiveConfirm } from '@/components/fable/ModalShell'
import { Reveal } from '@/components/fable/motion'

interface Distance {
  underlyingOrder: number
  underlyingName: string
  currentLevel: number | null
  priceSource: string
  distanceToCouponBarrier: number | null
  distanceToKnockInBarrier: number | null
  distanceToAutocallBarrier: number | null
  lastMonitoredPrice: number | null
  lastMonitoredDate: string | null
  lastMonitoredStale: boolean
}
interface DetailResponse {
  note: StructuredNote
  prices: UnderlyingPrice[]
  metrics: {
    riskStatus: RiskStatus
    worstPerformer: { underlyingName: string; performance: number | null } | null
    nextObservation: { valuationDate: string; observationType: string } | null
    daysToNextObservation: number | null
    currentNotional: number
    distances: Distance[]
  }
}

export default function StructuredNoteDetailPage() {
  const { t } = useLang()
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/structured-notes/${id}`)
      if (res.status === 404) { setNotFound(true); return }
      const json = await res.json().catch(() => null)
      if (json) setData(json)
    } catch {
      // A failed background refresh keeps the already-loaded data on screen.
    }
  }, [id])

  useEffect(() => {
    const cancelled = { value: false }
    void (async () => {
      try {
        const res = await fetch(`/api/structured-notes/${id}`, { cache: 'no-store' })
        if (cancelled.value) return
        if (res.status === 404) { setNotFound(true); return }
        const json = await res.json().catch(() => null)
        if (!cancelled.value && json) { setData(json); setLoadFailed(false) }
        else if (!cancelled.value) setLoadFailed(true)
      } catch {
        // R4 — a failed load renders the honest error state, never the
        // not-found copy (the note may well exist).
        if (!cancelled.value) setLoadFailed(true)
      } finally {
        if (!cancelled.value) setLoading(false)
      }
    })()
    return () => { cancelled.value = true }
  }, [id])

  // Upsert the notional for one entity (0 clears it).
  async function setEntityAllocation(entityName: string, notional: number) {
    await fetch(`/api/structured-notes/${id}/allocations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityName, notionalAmount: notional }),
    })
    await load()
  }
  // R4.1 — the confirmation gate is the shared Fable DestructiveConfirm
  // dialog, never the browser-native window.confirm. The mutation itself is
  // unchanged: same DELETE endpoint, same success-only redirect; a failure
  // keeps the dialog open with the error inside it so the user can retry or
  // cancel.
  async function deleteNote() {
    setDeleting(true); setDeleteFailed(false)
    try {
      const res = await fetch(`/api/structured-notes/${id}`, { method: 'DELETE' })
      if (!res.ok) { setDeleteFailed(true); return }
      router.push('/structured-notes')
    } catch {
      setDeleteFailed(true)
    } finally {
      setDeleting(false)
    }
  }

  const riskLabel = (s: string) => ({ safe: t.sn.riskSafe, watch: t.sn.riskWatch, breached: t.sn.riskBreached, autocallable: t.sn.riskAutocallable, unavailable: t.sn.riskUnavailable }[s] ?? s)

  const backLink = (
    <Link href="/structured-notes" className="text-sm text-accent no-print">← {t.sn.back}</Link>
  )

  if (loading) return (
    <div className="w-full">
      <GlassSurface variant="card"><AsyncState kind="loading" /></GlassSurface>
    </div>
  )
  if (loadFailed) return (
    <div className="w-full">
      {backLink}
      <GlassSurface variant="card" className="mt-3"><AsyncState kind="error" /></GlassSurface>
    </div>
  )
  if (notFound || !data) return (
    <div className="w-full">
      {backLink}
      <GlassSurface variant="card" className="mt-3"><AsyncState kind="empty" message={t.sn.notFound} /></GlassSurface>
    </div>
  )

  const n = data.note
  const worst = data.metrics.worstPerformer
  const allocationTotal = n.allocations.filter((a) => a.active).reduce((s, a) => s + (Number.isFinite(a.notionalAmount) ? a.notionalAmount : 0), 0)
  const mismatch = n.issueSize !== null && Math.abs(allocationTotal - n.issueSize) > 0.01

  // Display-only SELECTION of the per-underlying knock-in distances the API
  // already computed (barrier/current − 1; negative = headroom, so the
  // closest-to-barrier value is the maximum). Never recomputed from prices —
  // the math stays in src/lib/structuredNotes/calculations.ts.
  const knockInDistances = data.metrics.distances.map((d) => d.distanceToKnockInBarrier).filter((v): v is number => v !== null && Number.isFinite(v))
  const worstKnockInDistance = knockInDistances.length > 0 ? Math.max(...knockInDistances) : null

  const pricesAsOf = data.prices.reduce<string | null>((max, p) => (p.asOf && (!max || p.asOf > max) ? p.asOf : max), null)
  const strikeByOrder = new Map(n.underlyings.map((u) => [u.underlyingOrder, u.strikeLevel ?? u.initialLevel]))
  const knockInPctByOrder = new Map(n.underlyings.map((u) => [u.underlyingOrder, u.knockInBarrierPct ?? n.knockInBarrierPct]))

  const nextObs = data.metrics.nextObservation
  const nextDays = data.metrics.daysToNextObservation
  const nearObs = nextDays !== null && nextDays <= 7 && nextDays >= 0
  const deduped = dedupeObservationsByDate(n.observations)
  const observedCount = deduped.filter((o) => o.status !== 'scheduled').length

  // Fable §6 lifecycle timeline — issued ✓ · observed ✓ · next ● · maturity ○.
  // Row classification comes from the API's own data (status + the resolver's
  // nextObservation), never from client-side date math.
  const timeline: { label: string; value: string; dot: string; strong?: boolean }[] = [
    { label: t.sn.colIssued, value: n.issueDate ?? n.tradeDate ?? '—', dot: 'var(--positive)' },
    { label: t.sn.monitoring.observedAt, value: `${observedCount}/${deduped.length}`, dot: observedCount > 0 ? 'var(--positive)' : 'var(--muted-fg)' },
    { label: t.sn.dashNextObs, value: nextObs ? `${nextObs.valuationDate}${nextDays !== null ? ` (${nextDays}d)` : ''}` : '—', dot: 'var(--warning)', strong: true },
    { label: t.sn.colMaturity, value: n.maturityDate ?? '—', dot: 'var(--muted-fg)' },
  ]

  const thBase = 'py-2 px-2 border-b border-border ui-table-header text-muted-fg whitespace-nowrap text-center'
  const cell = 'py-2 px-2 text-center'

  return (
    <div className="w-full">
      <Reveal>
        {backLink}
        <PageHeader
          className="mt-2"
          eyebrow={n.isin ? <span className="font-mono normal-case tracking-normal">{n.isin}</span> : t.sn.tag}
          title={<span className="break-words">{n.productName}</span>}
          metadata={
            <>
              {n.issuerDisplayName && <span>{n.issuerDisplayName}</span>}
              <span>{n.structureType}</span>
              <LifecyclePill status={n.status} />
            </>
          }
        />
      </Reveal>

      {/* Monitoring summary — the R3 capsule anatomy, decision-first order */}
      <Reveal delayMs={70}>
        <div className="grid gap-3 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <StatCapsule label={t.sn.riskStatus} value={riskLabel(data.metrics.riskStatus)} tone={RISK_TONE[data.metrics.riskStatus]} title={legendFor(t, data.metrics.riskStatus)} />
          <StatCapsule
            label={t.sn.worstPerformer}
            value={worst ? `${shortUnderlying(worst.underlyingName)} ${fmtPct(worst.performance)}` : t.sn.unavailable}
            tone={worst?.performance != null ? (worst.performance < 0 ? 'var(--negative)' : 'var(--positive)') : 'var(--muted-fg)'}
            title={worst?.underlyingName}
          />
          <StatCapsule label={t.sn.distanceKnockIn} value={worstKnockInDistance !== null ? fmtPct(worstKnockInDistance) : '—'} tone={distanceTone(worstKnockInDistance)} />
          <StatCapsule
            label={t.sn.dashNextObs}
            value={nextObs ? `${nextObs.valuationDate}${nextDays !== null ? ` (${nextDays}d)` : ''}` : '—'}
            tone={nearObs ? 'var(--negative)' : undefined}
          />
          <StatCapsule label={t.sn.colCoupon} value={fmtPct(n.couponRateAnnualized)} />
          <StatCapsule label={t.sn.colNotional} value={`${n.currency} ${fmtNum(data.metrics.currentNotional)}`} />
          <StatCapsule label={t.sn.colMaturity} value={n.maturityDate ?? '—'} />
        </div>
      </Reveal>

      {/* Current levels & barrier monitoring — R3 gauge language per underlying */}
      <Reveal delayMs={70}>
        <div className="mb-3.5">
          <TableCard
            title={t.sn.currentPrices}
            minWidth={680}
            footer={
              <>
                <TableSourceFooter source={t.sn.sourceMarket} asOf={pricesAsOf} />
                <p className="ui-meta text-muted-fg mt-1">{t.sn.monitoring.estimateDisclaimer}</p>
              </>
            }
          >
            <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.sn.currentPrices}</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${thBase} text-left pl-4`}>{t.sn.colUnderlyings}</th>
                  <th scope="col" className={thBase} style={{ minWidth: 160 }}>{t.sn.colLevel}</th>
                  <th scope="col" className={thBase}>{t.sn.currentLevel}</th>
                  <th scope="col" className={thBase}>{t.sn.distanceCoupon}</th>
                  <th scope="col" className={thBase}>{t.sn.distanceKnockIn}</th>
                  <th scope="col" className={`${thBase} pr-4`}>{t.sn.monitoring.lastMonitored}</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.distances.map((d) => {
                  const strike = strikeByOrder.get(d.underlyingOrder) ?? null
                  // Level indexed to 100 at strike — the R3 gauge's own scale, a
                  // pure display transform of the API's currentLevel.
                  const gaugeLevel = d.currentLevel !== null && strike ? (d.currentLevel / strike) * 100 : null
                  const kiPct = knockInPctByOrder.get(d.underlyingOrder) ?? null
                  const gaugeMarks: BarrierMark[] = [
                    ...(kiPct != null ? [{ kind: 'knockIn' as const, level: kiPct * 100 }] : []),
                    { kind: 'strike' as const, level: 100 },
                  ]
                  const isWorst = worst !== null && d.underlyingName === worst.underlyingName
                  return (
                    <tr key={d.underlyingOrder} className="border-b border-border last:border-0">
                      <td className={`${cell} text-left pl-4 whitespace-nowrap`}>
                        <span className="text-foreground" title={d.underlyingName}>{d.underlyingName}</span>
                        {isWorst && (
                          <span className="ml-1.5 inline-flex items-center h-5 px-2 rounded-full text-xs font-medium align-middle" style={{ color: 'var(--warning)', backgroundColor: 'color-mix(in oklab, var(--warning) 12%, var(--surface))' }}>
                            {t.sn.colWorst}
                          </span>
                        )}
                      </td>
                      <td className={cell}>
                        <BarrierGauge
                          current={gaugeLevel}
                          marks={gaugeMarks}
                          width={140}
                          height={18}
                          summary={gaugeLevel !== null ? `${t.fable.barrier.current} ${gaugeLevel.toFixed(1)}` : undefined}
                        />
                      </td>
                      <td className={`${cell} ui-number`}>{d.currentLevel !== null ? fmtNum(d.currentLevel) : <span className="text-muted-fg">{t.sn.unavailable}</span>}</td>
                      <td className={`${cell} ui-number font-medium`} style={{ color: distanceTone(d.distanceToCouponBarrier) }}>{fmtPct(d.distanceToCouponBarrier)}</td>
                      <td className={`${cell} ui-number font-medium`} style={{ color: distanceTone(d.distanceToKnockInBarrier) }}>{fmtPct(d.distanceToKnockInBarrier)}</td>
                      <td className={`${cell} pr-4 ui-number text-xs`}>
                        {d.lastMonitoredDate ? (
                          <span className={d.lastMonitoredStale ? 'text-warning' : 'text-muted-fg'} title={d.lastMonitoredStale ? t.sn.monitoring.priceStale : undefined}>
                            {d.lastMonitoredDate}{d.lastMonitoredStale ? ` ⚠ ${t.sn.monitoring.priceStale}` : ''}
                          </span>
                        ) : <span className="text-muted-fg">{t.sn.monitoring.never}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableCard>
        </div>
      </Reveal>

      {/* Terms + contractual underlying levels */}
      <Reveal delayMs={130}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mb-3.5 items-start">
          <GlassSurface variant="card" as="section" className="px-5 py-4">
            <h2 className="ui-label text-muted-fg mb-3">{t.sn.generalTerms}</h2>
            {(n.memoryCoupon || n.principalProtection) && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {n.memoryCoupon && <FeatureChip label={t.sn.memoryCoupon} />}
                {n.principalProtection && <FeatureChip label={t.sn.principalProtection} />}
              </div>
            )}
            <TermGroup label={t.sn.termsIdentity}>
              <TermField k={t.sn.colIsin} v={n.isin} mono />
              <TermField k={t.sn.colIssuer} v={n.issuerDisplayName ?? n.issuerName} />
              <TermField k={t.sn.guarantor} v={n.guarantorName} />
              <TermField k={t.sn.colStructure} v={n.structureType} />
              <TermField k={t.sn.payoffType} v={n.payoffType} />
              <TermField k={t.sn.currencyLabel} v={n.currency} />
              <TermField k={t.sn.issueSize} v={n.issueSize !== null ? `${n.currency} ${fmtNum(n.issueSize)}` : null} />
              <TermField k={t.sn.denomination} v={n.denomination !== null ? `${n.currency} ${fmtNum(n.denomination)}` : null} />
              <TermField k={t.sn.issuePrice} v={n.issuePricePct !== null ? fmtPct(n.issuePricePct) : null} />
            </TermGroup>
            <TermGroup label={t.sn.termsEconomics}>
              <TermField k={t.sn.colCoupon} v={`${fmtPct(n.couponRatePeriodic)} · ${fmtPct(n.couponRateAnnualized)} p.a.`} />
              <TermField k={t.sn.couponFrequency} v={n.couponFrequency} />
              <TermField k={t.sn.couponBarrier} v={fmtPct(n.couponBarrierPct)} />
              <TermField k={t.sn.colKnockIn} v={fmtPct(n.knockInBarrierPct)} />
              <TermField k={t.sn.autocallBarrier} v={fmtPct(n.autocallBarrierPct)} />
            </TermGroup>
            <TermGroup label={t.sn.termsDates} last>
              <TermField k={t.sn.colTrade} v={n.tradeDate} />
              <TermField k={t.sn.colIssued} v={n.issueDate} />
              <TermField k={t.sn.initialValuation} v={n.initialValuationDate} />
              <TermField k={t.sn.finalValuation} v={n.finalValuationDate} />
              <TermField k={t.sn.colMaturity} v={n.maturityDate} />
              <TermField k={t.sn.redemption} v={n.redemptionDate} />
            </TermGroup>
          </GlassSurface>

          <TableCard title={t.sn.underlyings} minWidth={560}>
            <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.sn.underlyings}</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${thBase} pl-4`}>#</th>
                  <th scope="col" className={`${thBase} text-left`}>{t.sn.colUnderlyings}</th>
                  <th scope="col" className={thBase}>{t.sn.symbolLabel}</th>
                  <th scope="col" className={thBase}>{t.sn.initialLevel}</th>
                  <th scope="col" className={thBase}>{t.sn.strikeLevel}</th>
                  <th scope="col" className={thBase}>{t.sn.colKnockIn}</th>
                  <th scope="col" className={thBase}>{t.sn.monitoring.coupon}</th>
                  <th scope="col" className={`${thBase} pr-4`}>{t.sn.monitoring.autocall}</th>
                </tr>
              </thead>
              <tbody>
                {n.underlyings.map((u) => (
                  <tr key={u.underlyingOrder} className="border-b border-border last:border-0">
                    <td className={`${cell} pl-4 ui-number`}>{u.underlyingOrder}</td>
                    <td className={`${cell} text-left text-foreground`}>{u.underlyingName}</td>
                    <td className={`${cell} font-mono text-xs`}>{u.yahooSymbol ?? '—'}</td>
                    <td className={`${cell} ui-number`}>{fmtNum(u.initialLevel)}</td>
                    <td className={`${cell} ui-number`}>{fmtNum(u.strikeLevel)}</td>
                    <td className={`${cell} ui-number`}>{fmtNum(u.knockInBarrierLevel)}</td>
                    <td className={`${cell} ui-number`}>{fmtNum(u.couponBarrierLevel)}</td>
                    <td className={`${cell} pr-4 ui-number`}>{fmtNum(u.autocallBarrierLevel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </div>
      </Reveal>

      {/* Observation schedule — Fable lifecycle timeline over the COMPLETE
          real schedule (one row per valuation date; coupon + autocall
          coincide). Coupon/Autocall columns show the scheduled monitoring
          job's evaluation once a valuation date arrives — a monitoring
          estimate, never an official calculation-agent determination. */}
      <Reveal delayMs={130}>
        <div className="mb-3.5">
          <TableCard
            title={t.sn.schedule}
            controls={
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" role="list" aria-label={t.sn.schedule}>
                {timeline.map((step) => (
                  <span key={step.label} role="listitem" className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: step.dot }} aria-hidden="true" />
                    <span className="ui-micro-label text-muted-fg">{step.label}</span>
                    <span className={`ui-number text-xs ${step.strong ? 'text-foreground font-medium' : 'text-muted-fg'}`}>{step.value}</span>
                  </span>
                ))}
              </div>
            }
            minWidth={680}
            maxHeight={300}
          >
            <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.sn.schedule}</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${thBase} pl-4`}>#</th>
                  <th scope="col" className={thBase}>{t.sn.valuationDate}</th>
                  <th scope="col" className={thBase}>{t.sn.paymentDate}</th>
                  <th scope="col" className={thBase}>{t.sn.couponBarrier}</th>
                  <th scope="col" className={thBase}>{t.sn.autocallBarrier}</th>
                  <th scope="col" className={thBase}>{t.sn.colStatus}</th>
                  <th scope="col" className={thBase}>{t.sn.monitoring.coupon}</th>
                  <th scope="col" className={`${thBase} pr-4`}>{t.sn.monitoring.autocall}</th>
                </tr>
              </thead>
              <tbody>
                {deduped.map((o) => {
                  // Classified from the API's own data: completed = the stored
                  // status; next = the resolver's nextObservation date. No
                  // client-side date math.
                  const done = o.status !== 'scheduled'
                  const isNext = !done && nextObs !== null && o.valuationDate === nextObs.valuationDate
                  return (
                    <tr
                      key={`${o.observationNumber}-${o.valuationDate}`}
                      className={`border-b border-border last:border-0 ${done ? 'opacity-60' : ''}`}
                      style={isNext ? { backgroundColor: 'color-mix(in oklab, var(--warning) 8%, transparent)' } : undefined}
                      title={o.reviewRequired && o.reviewReason ? `${t.sn.monitoring.reviewReason}: ${o.reviewReason}` : undefined}
                    >
                      <td className={`${cell} pl-4 ui-number`}>{o.observationNumber}{o.observationType === 'final' ? <span title={t.sn.monitoring.final}> ·F</span> : ''}</td>
                      <td className={`${cell} ui-number whitespace-nowrap`}>
                        {isNext && <span aria-hidden="true" style={{ color: 'var(--warning)' }}>● </span>}
                        {isNext && <span className="sr-only">{t.sn.dashNextObs}: </span>}
                        {o.valuationDate}
                      </td>
                      <td className={`${cell} ui-number`}>{o.paymentDate ?? o.redemptionDate ?? '—'}</td>
                      <td className={`${cell} ui-number`}>{fmtPct(o.couponBarrierPct)}</td>
                      <td className={`${cell} ui-number`}>{fmtPct(o.autocallBarrierPct)}</td>
                      <td className={`${cell} text-xs text-muted-fg`}>
                        {o.status}{o.reviewRequired ? <span className="text-warning"> ⚠</span> : ''}
                      </td>
                      <td className={`${cell} text-xs`}>
                        {o.couponEligible === true ? <span className="text-positive">{t.sn.monitoring.eligible}</span>
                          : o.couponEligible === false ? <span className="text-negative">{t.sn.monitoring.notEligible}</span>
                          : <span className="text-muted-fg">—</span>}
                      </td>
                      <td className={`${cell} pr-4 text-xs`}>
                        {o.autocallEligible === true ? <span className="text-positive">{t.sn.monitoring.eligible}</span>
                          : o.autocallEligible === false ? <span className="text-negative">{t.sn.monitoring.notEligible}</span>
                          : <span className="text-muted-fg">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableCard>
        </div>
      </Reveal>

      {/* Allocation (internal) + provenance/actions */}
      <Reveal delayMs={180}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
          <GlassSurface variant="card" as="section" className="px-5 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="ui-label text-muted-fg">{t.sn.allocations}</h2>
              <span className="ui-meta text-muted-fg">{t.sn.allocationsNote}</span>
            </div>
            <EntityAllocationGrid
              allocations={n.allocations}
              currency={n.currency}
              onSet={setEntityAllocation}
              onAddCustom={(name) => setEntityAllocation(name, 0)}
            />
            <div className="text-xs mt-3">
              {t.sn.allocationTotal}: <span className="ui-number text-foreground">{n.currency} {fmtNum(allocationTotal)}</span>
              {n.issueSize !== null && <span className="text-muted-fg"> / {t.sn.issueSize} {n.currency} {fmtNum(n.issueSize)}</span>}
              {mismatch && <span className="text-warning ml-2" role="status">⚠ {t.sn.allocationMismatch}</span>}
            </div>
          </GlassSurface>

          <GlassSurface variant="card" as="section" className="px-5 py-4">
            <h2 className="ui-label text-muted-fg mb-3">{t.sn.provenance}</h2>
            <div className="text-xs text-muted-fg space-y-1.5">
              <div>{t.sn.source}: {n.sourceType === 'pdf_extraction' ? t.sn.sourcePdf : t.sn.sourceManual}{n.sourceFileName ? <> · <span className="text-foreground">{n.sourceFileName}</span></> : ''}</div>
              {n.confidenceScore !== null && <div>{t.sn.confidence}: <span className="ui-number text-foreground">{Math.round(n.confidenceScore * 100)}%</span></div>}
            </div>
            <div className="mt-4 pt-3 border-t border-border no-print">
              <button
                onClick={() => { setDeleteFailed(false); setConfirmingDelete(true) }}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-xs font-medium cursor-pointer nv-transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ color: 'var(--negative)', border: '1px solid var(--negative)', backgroundColor: 'color-mix(in oklab, var(--negative) 8%, var(--surface))' }}
              >
                {deleting ? t.sn.deleting : t.sn.delete}
              </button>
              {deleteFailed && !confirmingDelete && <p className="mt-2 text-xs text-negative" role="alert">{t.sn.deleteError}</p>}
            </div>
          </GlassSurface>
        </div>
      </Reveal>

      {/* R4.1 — shared Fable destructive-confirmation dialog (ModalShell
          contract: role=alertdialog, focus trap, Escape-cancels unless the
          mutation is pending, scroll lock, focus restored to the trigger,
          at-most-once confirm). The description names the REAL record. */}
      <DestructiveConfirm
        open={confirmingDelete}
        title={t.sn.delete}
        description={`${n.productName}${n.isin ? ` · ${n.isin}` : ''}`}
        confirmLabel={deleting ? t.sn.deleting : t.sn.delete}
        cancelLabel={t.sn.cancel}
        pending={deleting}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={deleteNote}
      >
        <p className="text-sm text-foreground">{t.sn.confirmDelete}</p>
        {deleting && <p className="sr-only" role="status">{t.sn.deleting}</p>}
        {deleteFailed && <p className="mt-2 text-xs text-negative" role="alert">{t.sn.deleteError}</p>}
      </DestructiveConfirm>
    </div>
  )
}

/** Full legend sentence for a risk status — capsule tooltip only; the label text itself always names the status. */
function legendFor(t: ReturnType<typeof useLang>['t'], s: RiskStatus): string | undefined {
  return { safe: t.sn.legendSafe, watch: t.sn.legendWatch, breached: t.sn.legendBreached, autocallable: t.sn.legendAutocallable, unavailable: t.sn.legendUnavailable }[s]
}

/** Lifecycle-status pill (active/autocalled/matured/…) — same color-mix pill language as the R3 dashboard. */
function LifecyclePill({ status }: { status: string }) {
  const color = status === 'active' ? 'var(--positive)' : status === 'autocalled' ? 'var(--accent)' : status === 'defaulted' ? 'var(--negative)' : 'var(--muted-fg)'
  return <span className="inline-flex items-center h-6 px-2.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ color, backgroundColor: `color-mix(in oklab, ${color} 12%, var(--surface))` }}>{status}</span>
}

/** One Fable terms group — micro-label header over a responsive definition grid. */
function TermGroup({ label, last = false, children }: { label: string; last?: boolean; children: React.ReactNode }) {
  return (
    <section className={last ? '' : 'mb-4'}>
      <h3 className="ui-micro-label text-muted-fg mb-2">{label}</h3>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 text-sm">{children}</dl>
    </section>
  )
}

function TermField({ k, v, mono = false }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="ui-micro-label text-muted-fg">{k}</dt>
      <dd className={`text-foreground break-words ${mono ? 'font-mono text-xs' : ''}`}>{v || '—'}</dd>
    </div>
  )
}

/** Boolean contractual features (memory coupon, principal protection) render as chips only when TRUE — absence is never shown as a fabricated "No". */
function FeatureChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center h-6 px-2.5 rounded-full text-xs font-medium" style={{ color: 'var(--accent)', backgroundColor: 'color-mix(in oklab, var(--accent) 10%, var(--surface))' }}>
      {label}
    </span>
  )
}

/**
 * Allocation grid: the predefined in-house sociedades (plus any custom ones
 * already allocated) each with an editable USD notional. Blank/0 clears the
 * entity. "Add entity" appends a custom row. Every change upserts by entity.
 */
function EntityAllocationGrid({
  allocations, currency, onSet, onAddCustom,
}: {
  allocations: { entityName: string; notionalAmount: number }[]
  currency: string
  onSet: (entity: string, notional: number) => void
  onAddCustom: (entity: string) => void
}) {
  const { t } = useLang()
  const [custom, setCustom] = useState('')
  const byName = new Map(allocations.map((a) => [a.entityName, a.notionalAmount]))
  // Predefined list first, then any custom entities that already have a row.
  const extras = allocations.map((a) => a.entityName).filter((n) => !DEFAULT_ENTITIES.includes(n as (typeof DEFAULT_ENTITIES)[number]))
  const rows = [...DEFAULT_ENTITIES, ...extras]

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map((name) => (
          <EntityRow key={name} name={name} currency={currency} value={byName.get(name) ?? 0} onCommit={(v) => onSet(name, v)} removable={extras.includes(name)} onRemove={() => onSet(name, 0)} />
        ))}
      </div>
      <form className="flex gap-2 mt-3 no-print" onSubmit={(e) => { e.preventDefault(); const n = custom.trim(); if (n) { onAddCustom(n); setCustom('') } }}>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t.sn.entity} aria-label={t.sn.entity} className="px-2.5 py-1 text-sm border border-border rounded-lg bg-surface" />
        <button type="submit" className="px-3 py-1 text-sm rounded-full border border-border nv-transition cursor-pointer hover:border-accent">＋ {t.sn.addAllocation}</button>
      </form>
    </div>
  )
}

/** Strips everything but digits/decimal point, then re-inserts thousand separators as the user types. */
function formatWithThousands(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  if (!cleaned) return ''
  const [intPart, ...rest] = cleaned.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return rest.length > 0 ? `${grouped}.${rest.join('').slice(0, 2)}` : grouped
}
function parseFormattedNumber(formatted: string): number {
  const n = Number(formatted.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function EntityRow({ name, currency, value, onCommit, removable, onRemove }: { name: string; currency: string; value: number; onCommit: (v: number) => void; removable: boolean; onRemove: () => void }) {
  const { t } = useLang()
  const [draft, setDraft] = useState(value ? formatWithThousands(String(value)) : '')
  // Keep the input in sync when the persisted value changes (render-time prev pattern).
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setDraft(value ? formatWithThousands(String(value)) : '') }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex-1 truncate" title={name}>{name}</span>
      <span className="text-xs text-muted-fg">{currency}</span>
      <input
        value={draft}
        onChange={(e) => setDraft(formatWithThousands(e.target.value))}
        onBlur={() => { const v = parseFormattedNumber(draft); if (v !== value) onCommit(v > 0 ? v : 0) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        inputMode="decimal" placeholder="0" aria-label={`${name} — ${currency}`}
        className="w-32 px-2.5 py-1 text-sm text-right border border-border rounded-lg bg-surface ui-number no-print"
      />
      {removable && <button onClick={onRemove} className="text-xs text-negative no-print cursor-pointer" title={t.sn.removeEntity} aria-label={`${t.sn.removeEntity}: ${name}`}>✕</button>}
    </div>
  )
}
