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
//   ROW 1       — R13.7B2.2.2 § 1: General Terms (LEFT, 3fr) beside
//                 Allocation by Entity (RIGHT, 2fr), equal height, stacking
//                 terms-first below lg.
//     Terms     — the Fable terms grid, grouped into Identity · Coupon &
//                 barriers · Key dates · Provenance (source type/file/
//                 confidence — its former card made way for the allocation
//                 card); boolean features render as chips only when true.
//     Allocation— the account allocation grid (upsert API, custom entities,
//                 thousands formatting) on Fable card glass, the R7.1B
//                 CUSTODIAN field, Nevada's investment notional and the total
//                 issuance size as two separate, separately-explained
//                 quantities — and, in its header, the note's Delete control:
//                 the shared DeleteButton (§ 11), same DELETE endpoint, same
//                 administrator gate, same success-only redirect as the
//                 DestructiveConfirm dialog it replaces. Never window.confirm.
//   ROW 2       — § 2: Current levels & distance to barrier (LEFT, 3fr)
//                 beside Underlyings (RIGHT, 2fr), equal height, stacking
//                 current-levels-first below lg.
//     Monitoring— the TableCard with the R3 BarrierGauge per underlying
//                 (level indexed to 100 at strike — a pure display transform
//                 of the API's own currentLevel; coinciding marks merged),
//                 proximity-colored distances (shared distanceTone), the
//                 worst-performer designation as VISIBLE text (never
//                 color/hover-only), last-monitored + stale flags, the visible
//                 legend, and the Yahoo footer + estimate disclaimer.
//     Underlyings — the contractual underlying-levels table (order, name,
//                 symbol, initial, strike, knock-in, coupon, autocall) in its
//                 own TableCard, scrolling inside the card at narrow widths.
//   Schedule    — the Fable lifecycle timeline (issued ✓ · observed dates
//                 n / m · next ● or called-on · maturity ○) as the card's
//                 header strip, above the COMPLETE real observation table —
//                 one row per valuation date, rendered in full with NO inner
//                 scroll region (R13.7B2.2.1 § 1); the page scrolls.
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
import { buildScheduleRows, findCallDate, maturityPresentation, type ScheduleOutcome, type ScheduleRow } from '@/lib/structuredNotes/observationSchedule'
import { mergeCoincidingMarks, markLevelKey, isCouponKnockInMark, isInitialCallMark, type GaugeMarkInput, type MergedGaugeMark } from '@/lib/structuredNotes/gaugeMarks'
import { calculateNevadaInvestmentNotional, classifyIssueSizePlausibility, nevadaInvestmentCurrency } from '@/lib/structuredNotes/calculations'
import type { StructuredNote, UnderlyingPrice, RiskStatus } from '@/lib/structuredNotes/types'
import { fmtPct, fmtNum, distanceTone, shortUnderlying, StatCapsule, RISK_TONE } from '../page'
import { PageHeader } from '@/components/fable/PageHeader'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { TableCard } from '@/components/fable/TableCard'
import { BarrierGauge, BARRIER_KIND_COLOR, type BarrierMark } from '@/components/fable/BarrierGauge'
import { AsyncState } from '@/components/fable/AsyncState'
import { DeleteButton } from '@/components/fable/DeleteButton'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { PrivacyValue } from '@/components/fable/PrivacyValue'
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
  // POST-R13.6B.1 — whether THIS caller may mutate. A module grant opens
  // reading only; create/edit/delete are administrator-only. Presentation,
  // never protection: the API re-checks and RLS refuses regardless.
  canManage?: boolean
  note: StructuredNote
  prices: UnderlyingPrice[]
  metrics: {
    riskStatus: RiskStatus
    /**
     * R13.7B2.2 § 6 — settlement of a CALLED note, a separate axis from risk
     * status. Null for any note that is not called. Derived server-side from the
     * calling observation's own Mandatory Early Redemption Date, so the label
     * and `currentNotional` below can never disagree.
     */
    settlement?: 'pending' | 'settled' | 'unknown' | null
    worstPerformer: { underlyingName: string; performance: number | null } | null
    nextObservation: { valuationDate: string; observationType: string } | null
    daysToNextObservation: number | null
    currentNotional: number
    distances: Distance[]
  }
}

export default function StructuredNoteDetailPage() {
  const { t } = useLang()
  const [masked] = usePrivacyMode()
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id
  const [data, setData] = useState<DetailResponse | null>(null)
  // Absent or non-true => read-only. Never inferred from anything else.
  const canManage = data?.canManage === true
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  // POST-R13.6CDE — see the list page: a 403 is an authorization ANSWER and
  // renders as such, never as the generic failure state.
  const [notAuthorized, setNotAuthorized] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const [allocError, setAllocError] = useState<string | null>(null)
  const [knownCustodians, setKnownCustodians] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/structured-notes/${id}`)
      if (res.status === 404) { setNotFound(true); return }
      // R12: a non-404 error response carries a JSON error body — setting it
      // as page data crashed the render (`data.note` undefined). A failed
      // background refresh keeps the already-loaded data on screen instead.
      if (!res.ok) return
      const json = await res.json().catch(() => null)
      if (json?.note) setData(json)
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
        if (res.status === 403) { setNotAuthorized(true); return }
        // R12: any other non-ok (503 not-configured, middleware 401) is a
        // LOAD FAILURE — its JSON error body must never become page data
        // (that crashed the render at `data.note`).
        if (!res.ok) { setLoadFailed(true); return }
        const json = await res.json().catch(() => null)
        if (!cancelled.value && json?.note) { setData(json); setLoadFailed(false) }
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

  // R7.1B — the custodian suggestion list IS the registry: the distinct
  // custodians users have already recorded across the book. The app never
  // ships a guessed roster of institutions.
  useEffect(() => {
    const cancelled = { value: false }
    void (async () => {
      try {
        const res = await fetch(`/api/structured-notes/${id}/allocations`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!cancelled.value && Array.isArray(json?.custodians)) setKnownCustodians(json.custodians)
      } catch {
        // A missing suggestion list only removes autocomplete — typing still works.
      }
    })()
    return () => { cancelled.value = true }
  }, [id])

  // Upsert the notional for one account (0 clears it). Custody is NOT part of
  // an allocation — see `setCustodian`. Returns whether the server accepted
  // the write — the custom-entity Remove control (a shared DeleteButton) uses
  // it to show success only after the upsert-to-zero was confirmed.
  async function setEntityAllocation(entityName: string, notional: number): Promise<boolean> {
    setAllocError(null)
    // R12: a thrown network failure surfaces the same localized error the
    // non-ok path already did (previously it was an unhandled rejection).
    try {
      const res = await fetch(`/api/structured-notes/${id}/allocations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityName, notionalAmount: notional }),
      })
      if (!res.ok) { setAllocError(t.sn.saveError); return false }
      await load()
      return true
    } catch {
      setAllocError(t.sn.saveError)
      return false
    }
  }

  // R7.1B.1 — custody is recorded ONCE per note: every account allocation of a
  // note is traded through the same custodian, so a single field owns it. An
  // empty value clears it (the note returns to "Custodian unavailable").
  async function setCustodian(value: string) {
    setAllocError(null)
    try {
      const res = await fetch(`/api/structured-notes/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custodian: value.trim() || null }),
      })
      if (!res.ok) { setAllocError(t.sn.saveError); return }
      await load()
    } catch {
      setAllocError(t.sn.saveError)
    }
  }
  // R13.7B2.2.2 — the confirmation gate is the shared DeleteButton's inline
  // panel (bin → "Delete this note permanently?" → check), never the
  // browser-native window.confirm; it invokes this handler at most once per
  // arming. The mutation itself is unchanged since R4.1: same DELETE endpoint,
  // same success-only redirect; a failure returns the control to a usable
  // state with the error stated beside it so the user can retry or leave.
  async function deleteNote(): Promise<boolean> {
    setDeleting(true); setDeleteFailed(false)
    try {
      const res = await fetch(`/api/structured-notes/${id}`, { method: 'DELETE' })
      if (!res.ok) { setDeleteFailed(true); return false }
      router.push('/structured-notes')
      return true
    } catch {
      setDeleteFailed(true)
      return false
    } finally {
      setDeleting(false)
    }
  }

  const riskLabel = (s: string) => ({ safe: t.sn.riskSafe, watch: t.sn.riskWatch, breached: t.sn.riskBreached, autocallable: t.sn.riskAutocallable, called: t.sn.riskCalled, unavailable: t.sn.riskUnavailable }[s] ?? s)

  const backLink = (
    <Link href="/structured-notes" className="text-sm text-accent no-print">← {t.sn.back}</Link>
  )

  if (loading) return (
    <div className="w-full">
      <GlassSurface variant="card"><AsyncState kind="loading" /></GlassSurface>
    </div>
  )
  if (notAuthorized) return (
    <div className="w-full">
      {backLink}
      <GlassSurface variant="card" className="mt-3"><AsyncState kind="not_authorized" /></GlassSurface>
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
  // R7.1B — Nevada's investment notional is the sum of the note's valid ACTIVE
  // account allocations, and is a different quantity from the issue size (the
  // total issuance across all investors). The old `Math.abs(total - issueSize)
  // > 0.01` warning asserted they must be equal, which is simply not true —
  // Nevada ordinarily owns a fraction of an issuance. The only surviving
  // comparison is the advisory review case below.
  const activeAllocations = n.allocations.filter((a) => a.active)
  const nevadaInvestment = calculateNevadaInvestmentNotional(n.allocations)
  const issueSizeComparison = classifyIssueSizePlausibility({
    nevadaInvestmentNotional: activeAllocations.length > 0 ? nevadaInvestment : null,
    nevadaCurrency: nevadaInvestmentCurrency(n.allocations),
    issueSize: n.issueSize,
    issueSizeCurrency: n.currency,
  })

  // Display-only SELECTION of the per-underlying knock-in distances the API
  // already computed (barrier/current − 1; negative = headroom, so the
  // closest-to-barrier value is the maximum). Never recomputed from prices —
  // the math stays in src/lib/structuredNotes/calculations.ts.
  const knockInDistances = data.metrics.distances.map((d) => d.distanceToKnockInBarrier).filter((v): v is number => v !== null && Number.isFinite(v))
  const worstKnockInDistance = knockInDistances.length > 0 ? Math.max(...knockInDistances) : null

  const pricesAsOf = data.prices.reduce<string | null>((max, p) => (p.asOf && (!max || p.asOf > max) ? p.asOf : max), null)
  const strikeByOrder = new Map(n.underlyings.map((u) => [u.underlyingOrder, u.strikeLevel ?? u.initialLevel]))
  const knockInPctByOrder = new Map(n.underlyings.map((u) => [u.underlyingOrder, u.knockInBarrierPct ?? n.knockInBarrierPct]))
  // R13.7 § 16 — the gauge's scale is "percent of this underlying's own strike"
  // (100 = strike), so every reference line must be expressed in that same
  // normalized unit. Raw index levels are never placed on it: SPX ~7700 and RTY
  // ~2970 share no axis, and their absolute magnitudes say nothing about
  // relative distance to their own thresholds.
  const couponPctByOrder = new Map(n.underlyings.map((u) => [u.underlyingOrder, u.couponBarrierPct ?? n.couponBarrierPct]))
  const autocallPctByOrder = new Map(n.underlyings.map((u) => [u.underlyingOrder, u.autocallBarrierPct ?? n.autocallBarrierPct]))
  // Every contractual threshold of ONE underlying, normalized to the gauge's
  // 0–130 percent-of-initial axis. `*Pct` fields are DECIMAL FRACTIONS
  // platform-wide (0.65 is 65%) — every parser emits `Number(match) / 100` and
  // `calculateBarrierLevel` multiplies without dividing — so × 100 is the only
  // transform. Raw index levels are never placed here.
  const rawMarksFor = (order: number): GaugeMarkInput[] => {
    const kiPct = knockInPctByOrder.get(order) ?? null
    const couponPct = couponPctByOrder.get(order) ?? null
    const autocallPct = autocallPctByOrder.get(order) ?? null
    return [
      ...(kiPct != null ? [{ kind: 'knockIn' as const, level: kiPct * 100 }] : []),
      ...(couponPct != null ? [{ kind: 'coupon' as const, level: couponPct * 100 }] : []),
      ...(autocallPct != null ? [{ kind: 'autocall' as const, level: autocallPct * 100 }] : []),
      { kind: 'strike' as const, level: 100 },
    ]
  }
  // R13.7B2.2.1 § 2 — the legend lists the marks THIS note actually draws (the
  // union across its underlyings, coinciding levels merged), so it can never
  // name a tick the gauge does not show or show a tick the legend does not name.
  const legendMarks = mergeCoincidingMarks(n.underlyings.flatMap((u) => rawMarksFor(u.underlyingOrder)))

  const nextObs = data.metrics.nextObservation
  const nextDays = data.metrics.daysToNextObservation
  const nearObs = nextDays !== null && nextDays <= 7 && nextDays >= 0
  // Canonical rows: coupon and autocall stay SEPARATE (the R13.7 repair).
  const deduped = dedupeObservationsByDate(n.observations)
  // R13.7B2.2 § 2 — display view: ONE row per contractual valuation date, with
  // the coupon and autocall outcomes side by side. Presentation only — nothing
  // here merges, rewrites or drops a canonical observation.
  const scheduleRows = buildScheduleRows(deduped)
  // R13.7 § 14/§ 11 — the contractual call date, derived from the observation
  // that actually recorded the call. Everything scheduled after it is no longer
  // a live observation of an existing note and is shown as void rather than
  // silently left looking pending.
  const calledOnDate = findCallDate(deduped)
  // R13.7B2.2.1 § 4 — progress is counted over DISPLAY rows (one per valuation
  // date), never over canonical event records: "8/15" mixed the two and read
  // as nonsense. A date is observed once it has actually been evaluated
  // (observed / called / matured); a date void after a call was never
  // observed, and a scheduled date not yet.
  const observedCount = scheduleRows.filter((r) => r.state === 'observed' || r.state === 'called' || r.state === 'matured').length
  const voidCount = scheduleRows.filter((r) => r.state === 'void').length

  // R13.7B2.2 § 6 — a called note is terminal: its operationally relevant date
  // is the Mandatory Early Redemption Date of the calling observation, not the
  // original maturity (which stays in General Terms, never erased).
  const isCalled = n.status === 'autocalled'
  const settlement = data.metrics.settlement ?? null
  const callingRow = calledOnDate !== null ? scheduleRows.find((r) => r.valuationDate === calledOnDate) ?? null : null
  const settlementLabel = settlement === 'pending' ? t.sn.settlementPending
    : settlement === 'settled' ? t.sn.settlementSettled
    : settlement === 'unknown' ? t.sn.settlementUnknown
    : undefined
  const settlementLegend = settlement === 'pending' ? t.sn.legendSettlementPending
    : settlement === 'settled' ? t.sn.legendSettlementSettled
    : undefined

  // Fable §6 lifecycle timeline — issued ✓ · observed ✓ · next ● · maturity ○.
  // Row classification comes from the API's own data (status + the resolver's
  // nextObservation), never from client-side date math.
  // R13.7B2.2.3 § 8-11 — the maturity step is STATE-AWARE. ACTIVE: the
  // scheduled maturity, plain. CALLED: the contractual date stays visible but
  // is struck through, muted and labelled in words ("Void after call") — the
  // note terminated through early redemption, so a future maturity must never
  // look like an operative endpoint; "Called on" is the terminal event.
  // MATURED: the maturity IS the terminal event — shown strong, never struck.
  // Other terminal statuses (cancelled, defaulted) keep the plain display.
  // Presentation only — the persisted maturity date is never touched.
  const maturityMode = maturityPresentation(n.status)
  const maturityVoid = maturityMode === 'void'
  const maturityTerminal = maturityMode === 'terminal'
  const timeline: { label: string; value: string; dot: string; strong?: boolean; title?: string; void?: boolean; note?: string }[] = [
    { label: t.sn.colIssued, value: n.issueDate ?? n.tradeDate ?? '—', dot: 'var(--positive)' },
    // § 4 — "Observed dates 1 / 8": evaluated valuation dates over ALL display
    // rows. The help text says what is and is not counted.
    {
      label: t.sn.obsProgress,
      value: `${observedCount} / ${scheduleRows.length}`,
      dot: observedCount > 0 ? 'var(--positive)' : 'var(--muted-fg)',
      title: voidCount > 0 ? `${t.sn.obsProgressHelp} (${voidCount} ${t.sn.obsState.void.toLowerCase()})` : t.sn.obsProgressHelp,
    },
    // A called note has no next observation; the date that matters is the one
    // it was called on — the same swap the hero capsules make (§ 6).
    isCalled
      ? { label: t.sn.calledOnLabel, value: calledOnDate ?? '—', dot: 'var(--negative)', strong: true, title: t.sn.legendCalled }
      : { label: t.sn.dashNextObs, value: nextObs ? `${nextObs.valuationDate}${nextDays !== null ? ` (${nextDays}d)` : ''}` : '—', dot: 'var(--warning)', strong: true },
    {
      label: t.sn.colMaturity,
      value: n.maturityDate ?? '—',
      dot: maturityTerminal ? 'var(--foreground)' : 'var(--muted-fg)',
      strong: maturityTerminal,
      void: maturityVoid,
      note: maturityVoid ? t.sn.maturityVoidAfterCall : undefined,
      title: maturityVoid ? t.sn.maturityVoidHelp : undefined,
    },
  ]

  const thBase = 'py-2 px-2 border-b border-border ui-table-header text-muted-fg whitespace-nowrap text-center'
  const cell = 'py-2 px-2 text-center'
  // R13.7B2.2.3 § 4 — headers of the FIT table (current levels): no
  // `whitespace-nowrap`, no utility padding/alignment — `.nv-tbl-fit` owns
  // those so the headers can wrap and the stacked mode can re-compose them.
  const thFit = 'border-b border-border ui-table-header text-muted-fg'

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
          {/* R13.7B2.2 § 6 — for a called note the state is "Called" with the
              settlement position as its own sub-line. Never "Autocallable",
              which means "would call on the NEXT date" and is meaningless for a
              note that has no next date. */}
          <StatCapsule
            label={t.sn.colStatus}
            value={riskLabel(data.metrics.riskStatus)}
            sub={isCalled ? settlementLabel : undefined}
            tone={RISK_TONE[data.metrics.riskStatus]}
            title={[legendFor(t, data.metrics.riskStatus), settlementLegend].filter(Boolean).join(' ')}
          />
          <StatCapsule
            label={t.sn.worstPerformer}
            value={worst ? `${shortUnderlying(worst.underlyingName)} ${fmtPct(worst.performance)}` : t.sn.unavailable}
            tone={worst?.performance != null ? (worst.performance < 0 ? 'var(--negative)' : 'var(--positive)') : 'var(--muted-fg)'}
            title={worst?.underlyingName}
          />
          <StatCapsule label={t.sn.distanceKnockIn} value={worstKnockInDistance !== null ? fmtPct(worstKnockInDistance) : '—'} tone={distanceTone(worstKnockInDistance)} />
          {/* A called note has no next observation — the date that matters is
              the one it was called on. */}
          {isCalled ? (
            <StatCapsule label={t.sn.calledOnLabel} value={calledOnDate ?? '—'} tone="var(--negative)" title={t.sn.legendCalled} />
          ) : (
            <StatCapsule
              label={t.sn.dashNextObs}
              value={nextObs ? `${nextObs.valuationDate}${nextDays !== null ? ` (${nextDays}d)` : ''}` : '—'}
              tone={nearObs ? 'var(--negative)' : undefined}
            />
          )}
          <StatCapsule label={t.sn.colCoupon} value={fmtPct(n.couponRateAnnualized)} sub={n.couponRatePeriodic !== null ? `${fmtPct(n.couponRatePeriodic)} · ${n.couponFrequency ?? ''}`.trim() : undefined} />
          {/* R11: private amount — same masking boundary as the book total. */}
          <StatCapsule label={t.sn.colNotional} value={`${n.currency} ${fmtNum(data.metrics.currentNotional)}`} sub={isCalled ? settlementLabel : undefined} masked={masked} />
          {/* § 6 — for a called note the redemption/settlement date is the
              operationally relevant one; contractual maturity is preserved in
              General Terms below, never erased. */}
          {isCalled ? (
            <StatCapsule label={t.sn.redemptionSettlement} value={callingRow?.paymentDate ?? '—'} sub={settlementLabel} title={settlementLegend} />
          ) : (
            <StatCapsule label={t.sn.colMaturity} value={n.maturityDate ?? '—'} />
          )}
        </div>
      </Reveal>

      {/* ROW 1 — General Terms (LEFT, 3fr) · Allocation by Entity (RIGHT, 2fr).
          R13.7B2.2.2 § 1 / § 3: the B2.2.1 terms-plus-underlyings block is
          superseded. The two cards share one desktop row and stretch to the
          same height (`lg:items-stretch` + `h-full`); below lg they stack,
          General Terms first. The note-level Delete control lives in the
          Allocation card's header (§ 11) as the shared DeleteButton — same
          DELETE endpoint, same administrator gate (`canManage`), same
          success-only redirect as the dialog it replaces. Provenance (source
          type · file · confidence) is folded into the terms card as a fourth
          group: its former card made way for the Allocation card, and no
          field was dropped. 3fr/2fr rather than a literal 65/35 so that the
          two rows share one column edge and the allocation notional inputs
          are never compressed. */}
      <Reveal delayMs={70}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3.5 mb-3.5 lg:items-stretch">
          <GlassSurface variant="card" as="section" className="px-5 py-4 h-full flex flex-col">
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
              {/* R7.1B — named "Total issuance size" everywhere, so it can
                  never be read as Nevada's position. */}
              <TermField k={t.sn.totalIssuanceSize} v={n.issueSize !== null ? `${n.currency} ${fmtNum(n.issueSize)}` : null} />
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
            <TermGroup label={t.sn.termsDates}>
              <TermField k={t.sn.colTrade} v={n.tradeDate} />
              <TermField k={t.sn.colIssued} v={n.issueDate} />
              <TermField k={t.sn.initialValuation} v={n.initialValuationDate} />
              <TermField k={t.sn.finalValuation} v={n.finalValuationDate} />
              <TermField k={t.sn.colMaturity} v={n.maturityDate} />
              <TermField k={t.sn.redemption} v={n.redemptionDate} />
            </TermGroup>
            {/* Provenance — source type, file name and extraction confidence,
                exactly the three facts the former provenance card showed. */}
            <TermGroup label={t.sn.provenance} last>
              <TermField
                k={t.sn.source}
                v={`${n.sourceType === 'pdf_extraction' ? t.sn.sourcePdf : t.sn.sourceManual}${n.sourceFileName ? ` · ${n.sourceFileName}` : ''}`}
              />
              <TermField k={t.sn.confidence} v={n.confidenceScore !== null ? `${Math.round(n.confidenceScore * 100)}%` : null} />
            </TermGroup>
          </GlassSurface>

          {/* Allocation (internal) — with the note's Delete control in its header. */}
          <GlassSurface variant="card" as="section" className="px-5 py-4 h-full flex flex-col">
            {/* R13.7B2.2.3 § 1-2 — the header is ONE fixed-height row in every
                DeleteButton state: title + one meta line on the left, the
                control on the right. The card body below begins at the same
                position whether the control is idle, armed, pending, failed or
                reset — nothing in this header may grow when the control is used. */}
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-3">
              <div className="min-w-0">
                <h2 className="ui-label text-muted-fg">{t.sn.allocations}</h2>
                {/* A failed deletion is stated in the meta line's OWN slot (one
                    line, same height), beside the control that failed — so the
                    message appears without moving the card body. Nothing
                    pretends the note is gone. */}
                {deleteFailed
                  ? <p className="ui-meta text-negative" role="alert">{t.sn.deleteError}</p>
                  : <p className="ui-meta text-muted-fg">{t.sn.allocationsNote}</p>}
              </div>
              {/* § 11 — the shared DeleteButton: arm → "Delete this note
                  permanently?" → check confirms ONCE / cross or Escape cancel.
                  Rendered only for a caller the API said may manage; the
                  route re-checks and RLS refuses regardless. `deleteNote` is
                  the unchanged mutation (DELETE, success-only redirect).
                    OVERLAY layout (R13.7B2.2.3): in the 2fr card this header is
                  ~500px wide; the title block takes ~300px and an open inline
                  panel plus the bin ~350px, so an inline panel could only open
                  by wrapping the header to a second line — which moved the whole
                  card body while armed. The overlay panel floats beside the bin
                  over the header's own text instead, and the card never moves. */}
              {canManage && (
                <DeleteButton
                  size="md"
                  layout="overlay"
                  className="ml-auto no-print"
                  label={`${t.sn.delete}: ${n.productName || n.isin || ''}`}
                  title={t.sn.delete}
                  confirmLabel={t.sn.confirmDeleteInline}
                  onConfirm={deleteNote}
                >
                  {t.sn.delete}
                </DeleteButton>
              )}
            </div>
            {deleting && <p className="sr-only" role="status">{t.sn.deleting}</p>}
            {/* R7.1B.1 — ONE custodian for the whole note: the accounts are
                traded together, so custody is captured once here rather than
                repeated on every allocation row. Suggestions come from the
                custodians already recorded on other notes. */}
            <CustodianField
              value={n.custodian}
              knownCustodians={knownCustodians}
              onCommit={setCustodian}
              readOnly={!canManage}
            />
            <EntityAllocationGrid
              allocations={n.allocations}
              currency={n.currency}
              onSet={setEntityAllocation}
              onAddCustom={(name) => setEntityAllocation(name, 0)}
              masked={masked}
              readOnly={!canManage}
            />
            {allocError && <p className="mt-2 text-xs text-negative" role="alert">{allocError}</p>}
            {/* R7.1B — the two quantities are stated SEPARATELY, each with its
                own help text, so neither can be read as the other. Issue size
                is never used as exposure, an allocation, or a fallback. */}
            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="ui-micro-label text-muted-fg" title={t.sn.nevadaInvestmentHelp}>{t.sn.nevadaInvestment}</dt>
                <dd className="ui-number text-foreground">
                  {/* R12: this IS the note's Nevada notional — the same private
                      amount the capsule above masks. Same boundary here. */}
                  <PrivacyValue masked={masked}>{`${nevadaInvestmentCurrency(n.allocations) ?? n.currency} ${fmtNum(nevadaInvestment)}`}</PrivacyValue>
                </dd>
                <dd className="ui-meta text-muted-fg">{t.sn.nevadaInvestmentHelp}</dd>
              </div>
              <div>
                <dt className="ui-micro-label text-muted-fg" title={t.sn.totalIssuanceSizeHelp}>{t.sn.totalIssuanceSize}</dt>
                <dd className="ui-number text-foreground">{n.issueSize !== null ? `${n.currency} ${fmtNum(n.issueSize)}` : '—'}</dd>
                <dd className="ui-meta text-muted-fg">{t.sn.totalIssuanceSizeHelp}</dd>
              </div>
            </dl>
            {issueSizeComparison === 'review' && (
              <p className="mt-2 text-xs text-warning" role="status">⚠ {t.sn.allocationMismatch}</p>
            )}
          </GlassSurface>
        </div>
      </Reveal>

      {/* ROW 2 — Current levels & distance to barrier (LEFT, 3fr) · Underlyings
          (RIGHT, 2fr). Owner-specified order (R13.7B2.2.2 § 2): the analytical
          monitoring table is the dominant card and stays LEFT; the contractual
          underlying-levels table sits RIGHT in its own TableCard again. Both
          stretch to one height; below lg they stack, Current levels first.
          Every column, the gauge legend, the raw level, the normalized level,
          the merged marks, the halo, last-monitored and stale flags are the
          B2.2/B2.2.1 ones, unchanged. */}
      <Reveal delayMs={130}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3.5 mb-3.5 lg:items-stretch">
          {/* R13.7B2.2.3 § 3-5 — this table FITS its card: no `minWidth`, so no
              card-level horizontal scrollbar at 1440 or 1024. Fixed layout,
              widths declared by the <colgroup>, long headers wrap ("Move to /
              coupon barrier"), the gauge scales into its column, numerals stay
              on one line. Below md the same DOM stacks one block per
              underlying with each value under its own column name — every one
              of the seven metrics stays visible; nothing scrolls sideways. */}
          <TableCard
            title={t.sn.currentPrices}
            className="h-full"
            footer={
              <>
                {/* R13.7B2.2 § 8 — the marks are named in VISIBLE text, not only
                    in the SVG tooltip, so the gauge is readable without hover
                    and without knowing the implementation. */}
                <GaugeLegend marks={legendMarks} />
                {/* § 11 — an unambiguous full calendar date. These levels are a
                    fixed contractual valuation close, not a refresh time, so the
                    dense "28-08" convention is wrong here. */}
                <TableSourceFooter className="mt-1.5" source={t.sn.sourceMarket} asOf={pricesAsOf} asOfFormat="full" />
                <p className="ui-meta text-muted-fg mt-1">{t.sn.monitoring.estimateDisclaimer}</p>
              </>
            }
          >
            <div className="nv-tbl-fit-host">
            <table className="nv-tbl-fit nv-tbl-fit--stack" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.sn.currentPrices}</caption>
              {/* Intentional column budget (sums to 100): identity 19 · gauge 17 ·
                  raw level 11 · coupon 12 · knock-in 12 · call 13 · last
                  monitored 16. Derived from the MEASURED width of every header's
                  longest word in EN and ES at the 1024 two-column case (~573px):
                  each word stays whole inside its own cell box, a numeral never
                  wraps, the stale flag has its own line, and the gauge scales
                  into whatever is left (its full 150px from ~1200px up). */}
              <colgroup>
                <col style={{ width: '19%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={`${thFit} nv-tbl-fit-name`}>{t.sn.colUnderlyings}</th>
                  <th scope="col" className={thFit} title={t.sn.gaugeLegend}>{t.sn.gaugeNormalized}</th>
                  <th scope="col" className={thFit}>{t.sn.currentLevel}</th>
                  <th scope="col" className={thFit} title={t.sn.distanceConvention}>{t.sn.distanceCoupon}</th>
                  <th scope="col" className={thFit} title={t.sn.distanceConvention}>{t.sn.distanceKnockIn}</th>
                  <th scope="col" className={thFit} title={t.sn.distanceConvention}>{t.sn.distanceAutocall}</th>
                  <th scope="col" className={thFit}>{t.sn.monitoring.lastMonitored}</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.distances.map((d) => {
                  const strike = strikeByOrder.get(d.underlyingOrder) ?? null
                  // Level indexed to 100 at strike — the R3 gauge's own scale, a
                  // pure display transform of the API's currentLevel.
                  const gaugeLevel = d.currentLevel !== null && strike ? (d.currentLevel / strike) * 100 : null
                  const autocallPct = autocallPctByOrder.get(d.underlyingOrder) ?? null
                  // R13.7B2.2.1 § 2 — coinciding thresholds collapse to ONE tick
                  // (pure helper, unit-tested), and the label names exactly
                  // what sits there: on this book the coupon and knock-in
                  // barriers coincide at 65 → one "Coupon / knock-in barrier"
                  // mark; the call level coincides with the initial level at
                  // 100 → one "Initial / call level" mark. The call level and
                  // the coupon barrier are NOT the same and are never merged.
                  const rawMarks = rawMarksFor(d.underlyingOrder)
                  const gaugeMarks: BarrierMark[] = mergeCoincidingMarks(rawMarks).map((m) => ({ kind: m.kind, level: m.level, label: gaugeMarkLabel(t, m) }))
                  // The stated basis is honest per underlying: "initial / call
                  // level" only when the call level really is 100% of initial.
                  const basis = autocallPct != null && markLevelKey(autocallPct * 100) === 100 ? t.sn.gaugeBasis : t.sn.gaugeBasisInitialOnly
                  const isWorst = worst !== null && d.underlyingName === worst.underlyingName
                  return (
                    <tr key={d.underlyingOrder} className="border-b border-border last:border-0">
                      <td className="nv-tbl-fit-name" data-label={t.sn.colUnderlyings}>
                        <span className="text-foreground" title={d.underlyingName}>{d.underlyingName}</span>
                        {/* R13.7B2.2 § 9 — "Worst" must never be read as "the
                            smaller index level". The explanation is carried by
                            the badge's own title AND repeated in the legend
                            below, so it is never hover-only. */}
                        {isWorst && (
                          <span
                            className="ml-1.5 inline-flex items-center h-5 px-2 rounded-full text-xs font-medium align-middle cursor-help"
                            style={{ color: 'var(--warning)', backgroundColor: 'color-mix(in oklab, var(--warning) 12%, var(--surface))' }}
                            title={t.sn.worstExplain}
                          >
                            {t.sn.colWorst}
                          </span>
                        )}
                      </td>
                      <td data-label={t.sn.gaugeNormalized}>
                        {/* § 8 — the reading is NORMALIZED (100 = this
                            underlying's own initial, which is also its call
                            level), never a raw index level. The basis is stated
                            on the gauge itself, not left as a bare "101.9". */}
                        <BarrierGauge
                          current={gaugeLevel}
                          marks={gaugeMarks}
                          width={150}
                          height={18}
                          summary={gaugeLevel !== null ? `${t.sn.gaugeNormalized} ${gaugeLevel.toFixed(2)} — ${basis}` : undefined}
                        />
                      </td>
                      {/* The RAW market level always stays visible beside the
                          normalized gauge (§ 8) — they answer different
                          questions and neither replaces the other. */}
                      <td className="ui-number" data-label={t.sn.currentLevel}>{d.currentLevel !== null ? fmtNum(d.currentLevel) : <span className="text-muted-fg">{t.sn.unavailable}</span>}</td>
                      {/* R13.7B2.2 § 10 — the LOCKED formula and sign are
                          unchanged (`threshold / current − 1`); each cell now
                          also carries the plain-language reading of its own
                          value, so a bare "−35.70%" is never the only thing on
                          screen. */}
                      <td className="ui-number font-medium" data-label={t.sn.distanceCoupon} title={moveText(t, d.distanceToCouponBarrier, t.sn.couponBarrier)} style={{ color: distanceTone(d.distanceToCouponBarrier) }}>{fmtPct(d.distanceToCouponBarrier)}</td>
                      <td className="ui-number font-medium" data-label={t.sn.distanceKnockIn} title={moveText(t, d.distanceToKnockInBarrier, t.sn.colKnockIn)} style={{ color: distanceTone(d.distanceToKnockInBarrier) }}>{fmtPct(d.distanceToKnockInBarrier)}</td>
                      {/* R13.7 § 15 — the CALL level is the threshold that decides an
                          autocall, so it belongs beside the barriers rather than only
                          inside the event engine. Same metric and sign convention as
                          its neighbours; no proximity tone, because being close to a
                          call is not a risk signal the way a barrier is. */}
                      <td className="ui-number" data-label={t.sn.distanceAutocall} title={moveText(t, d.distanceToAutocallBarrier, t.sn.gaugeMarkAutocall)}>{fmtPct(d.distanceToAutocallBarrier)}</td>
                      <td className="text-xs" data-label={t.sn.monitoring.lastMonitored}>
                        {d.lastMonitoredDate ? (
                          <span className={d.lastMonitoredStale ? 'text-warning' : 'text-muted-fg'} title={d.lastMonitoredStale ? t.sn.monitoring.priceStale : undefined}>
                            <span className="ui-number">{d.lastMonitoredDate}</span>
                            {/* R13.7B2.2.3 § 4 — the stale flag sits on its own
                                line under the date (same warning colour), so
                                the cell never widens past its column. */}
                            {d.lastMonitoredStale ? <span className="block break-words">⚠ {t.sn.monitoring.priceStale}</span> : null}
                          </span>
                        ) : <span className="text-muted-fg">{t.sn.monitoring.never}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </TableCard>

          {/* Underlyings — the contractual levels (order, name, symbol, initial,
              strike, knock-in, coupon, autocall). R13.7B2.2.4: a FIT table like
              Current levels — no minWidth, no card-level horizontal scrollbar.
              Eight columns of eight-character numerals cannot fit the 2fr card
              at the 1024 two-column width (~381px) at a readable size, so the
              fit host stacks this table into one block per underlying there
              (every column shown under its own name) and lays it out as a table
              from ~520px up (548px at 1440). The footer note says what these
              levels ARE, and where the live ones are. */}
          <TableCard
            title={t.sn.underlyings}
            className="h-full"
            footer={<p className="ui-meta text-muted-fg">{t.sn.underlyingsNote}</p>}
          >
            <div className="nv-tbl-fit-host">
            <table className="nv-tbl-fit nv-tbl-fit--stack" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.sn.underlyings}</caption>
              {/* Intentional column budget (sums to 100): order 4 · name 19 ·
                  symbol 12 · initial 12 · strike 12 · knock-in 13 · coupon 12 ·
                  autocall 16. Measured at the 548px 2fr width (1440) in EN and
                  ES: every header word stays whole inside its own cell (two
                  earlier budgets spilled "Autocall" by 9px and "Subyacentes"
                  by 15px into a neighbour), every numeral stays on one line,
                  and only the name cell may wrap. */}
              <colgroup>
                <col style={{ width: '4%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className={thFit}>#</th>
                  <th scope="col" className={`${thFit} nv-tbl-fit-name`}>{t.sn.colUnderlyings}</th>
                  <th scope="col" className={thFit}>{t.sn.symbolLabel}</th>
                  <th scope="col" className={thFit}>{t.sn.initialLevel}</th>
                  <th scope="col" className={thFit}>{t.sn.strikeLevel}</th>
                  <th scope="col" className={thFit}>{t.sn.colKnockIn}</th>
                  <th scope="col" className={thFit}>{t.sn.monitoring.coupon}</th>
                  <th scope="col" className={thFit}>{t.sn.monitoring.autocall}</th>
                </tr>
              </thead>
              <tbody>
                {n.underlyings.map((u) => (
                  <tr key={u.underlyingOrder} className="border-b border-border last:border-0">
                    <td className="ui-number" data-label="#">{u.underlyingOrder}</td>
                    <td className="nv-tbl-fit-name text-foreground" data-label={t.sn.colUnderlyings}>{u.underlyingName}</td>
                    <td className="font-mono text-xs" data-label={t.sn.symbolLabel}>{u.yahooSymbol ?? '—'}</td>
                    <td className="ui-number" data-label={t.sn.initialLevel}>{fmtNum(u.initialLevel)}</td>
                    <td className="ui-number" data-label={t.sn.strikeLevel}>{fmtNum(u.strikeLevel)}</td>
                    <td className="ui-number" data-label={t.sn.colKnockIn}>{fmtNum(u.knockInBarrierLevel)}</td>
                    <td className="ui-number" data-label={t.sn.monitoring.coupon}>{fmtNum(u.couponBarrierLevel)}</td>
                    <td className="ui-number" data-label={t.sn.monitoring.autocall}>{fmtNum(u.autocallBarrierLevel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </TableCard>
        </div>
      </Reveal>

      {/* Observation schedule — Fable lifecycle timeline over the COMPLETE
          real schedule (one row per valuation date; coupon + autocall
          coincide). Coupon/Autocall columns show the scheduled monitoring
          job's evaluation once a valuation date arrives — a monitoring
          estimate, never an official calculation-agent determination.
          R13.7B2.2.1 § 1 — NO inner vertical scroll: every display row renders
          in full and the page scrolls. The card keeps only the card-level
          HORIZONTAL scroll that every dense table has (minWidth), so a narrow
          viewport never produces page-level horizontal overflow. */}
      <Reveal delayMs={180}>
        <div className="mb-3.5">
          <TableCard
            title={t.sn.schedule}
            controls={
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" role="list" aria-label={t.sn.schedule}>
                {timeline.map((step) => (
                  <span key={step.label} role="listitem" className={`inline-flex items-center gap-1.5 whitespace-nowrap${step.title ? ' cursor-help' : ''}`} title={step.title}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: step.dot }} aria-hidden="true" />
                    <span className="ui-micro-label text-muted-fg">{step.label}</span>
                    {/* § 9-11 — a voided step: the date struck AND muted AND
                        named in words, so the meaning never rests on the
                        strikethrough alone. Neutral chip material, not red —
                        it must not compete with "Called on". */}
                    {step.void ? (
                      <s className="ui-number text-xs text-muted-fg line-through opacity-70">{step.value}</s>
                    ) : (
                      <span className={`ui-number text-xs ${step.strong ? 'text-foreground font-medium' : 'text-muted-fg'}`}>{step.value}</span>
                    )}
                    {step.note && (
                      <span className="inline-flex items-center h-4 px-1.5 rounded-full ui-micro-label text-muted-fg" style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}>
                        {step.note}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            }
            minWidth={680}
          >
            <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
              <caption className="sr-only">{t.sn.schedule}</caption>
              <thead>
                <tr>
                  <th scope="col" className={`${thBase} pl-4`}>#</th>
                  <th scope="col" className={thBase}>{t.sn.valuationDate}</th>
                  <th scope="col" className={thBase}>{t.sn.paymentRedemptionDate}</th>
                  <th scope="col" className={thBase}>{t.sn.couponBarrier}</th>
                  <th scope="col" className={thBase}>{t.sn.autocallBarrier}</th>
                  <th scope="col" className={thBase}>{t.sn.colStatus}</th>
                  <th scope="col" className={thBase}>{t.sn.monitoring.coupon}</th>
                  <th scope="col" className={`${thBase} pr-4`}>{t.sn.monitoring.autocall}</th>
                </tr>
              </thead>
              <tbody>
                {/* R13.7B2.2 § 2 — ONE row per contractual valuation date. The
                    canonical coupon and autocall observations remain separate
                    records (that is the R13.7 repair); this view puts their two
                    outcomes side by side, the way the term sheet states them,
                    instead of emitting "1 COUPON" and "1 AUTOCALL" as two
                    physical rows for one Observation Date. */}
                {scheduleRows.map((r) => {
                  const isNext = r.state === 'scheduled' && nextObs !== null && r.valuationDate === nextObs.valuationDate
                  const rowCalled = r.state === 'called'
                  const rowVoid = r.state === 'void'
                  return (
                    <tr
                      key={r.key}
                      className={`border-b border-border last:border-0 ${r.state === 'observed' ? 'opacity-60' : ''} ${rowVoid ? 'opacity-40 line-through' : ''}`}
                      style={
                        rowCalled
                          ? { backgroundColor: 'color-mix(in oklab, var(--negative) 12%, transparent)' }
                          : isNext
                            ? { backgroundColor: 'color-mix(in oklab, var(--warning) 8%, transparent)' }
                            : undefined
                      }
                      title={r.reviewRequired && r.reviewReason ? `${t.sn.monitoring.reviewReason}: ${r.reviewReason}` : undefined}
                    >
                      <td className={`${cell} pl-4 ui-number`}>
                        {r.displayNumber}
                        {r.hasFinal && <span className="ml-1 ui-micro-label text-muted-fg" title={t.sn.obsFinalTag}>{t.sn.obsTypeFinal}</span>}
                      </td>
                      <td className={`${cell} ui-number whitespace-nowrap`}>
                        {isNext && <span aria-hidden="true" style={{ color: 'var(--warning)' }}>● </span>}
                        {isNext && <span className="sr-only">{t.sn.dashNextObs}: </span>}
                        {r.valuationDate}
                      </td>
                      <td className={`${cell} ui-number`}>{r.paymentDate ?? '—'}</td>
                      <td className={`${cell} ui-number`}>{fmtPct(r.couponBarrierPct)}</td>
                      <td className={`${cell} ui-number`}>{fmtPct(r.autocallBarrierPct)}</td>
                      {/* § 3 — human-readable, never the storage enum. */}
                      <td className={`${cell} text-xs`}>
                        <RowStateChip state={r.state} />
                        {r.reviewRequired ? <span className="text-warning"> ⚠</span> : ''}
                      </td>
                      <td className={`${cell} text-xs`}><OutcomeCell outcome={r.coupon} /></td>
                      <td className={`${cell} pr-4 text-xs`}><OutcomeCell outcome={r.autocall} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableCard>
        </div>
      </Reveal>

    </div>
  )
}

/** Full legend sentence for a risk status — capsule tooltip only; the label text itself always names the status. */
function legendFor(t: ReturnType<typeof useLang>['t'], s: RiskStatus): string | undefined {
  return { safe: t.sn.legendSafe, watch: t.sn.legendWatch, breached: t.sn.legendBreached, autocallable: t.sn.legendAutocallable, called: t.sn.legendCalled, unavailable: t.sn.legendUnavailable }[s]
}

/**
 * R13.7B2.2 § 10 — the plain-language reading of ONE distance value.
 *
 * The metric itself is untouched: `moveToThresholdPct = threshold / current − 1`,
 * negative when the level must FALL. This only says that in words for the
 * specific value in the cell, because a standalone "−35.70%" told the owner
 * review neither the direction nor which level it referred to.
 *
 * Deliberately NOT the negation of the cushion metric — the two have different
 * denominators (§ 15 of R13.7), so this sentence is derived from the same
 * number the cell prints and from no other.
 */
function moveText(t: ReturnType<typeof useLang>['t'], v: number | null | undefined, levelName: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return t.sn.distanceConvention
  const pct = `${Math.abs(v * 100).toFixed(2)}%`
  const direction = v < 0 ? t.sn.declineTo : v > 0 ? t.sn.riseTo : t.sn.atLevel
  return v === 0
    ? `${direction} ${levelName} · ${t.sn.distanceConvention}`
    : `${pct} ${direction} ${levelName} · ${t.sn.distanceConvention}`
}

/** Chip colors for a schedule row's lifecycle state. Owner-specified: Called is RED; the label always names the state, so meaning is never color-alone. */
const ROW_STATE_TONE: Record<ScheduleRow['state'], string> = {
  called: 'var(--negative)',
  void: 'var(--muted-fg)',
  matured: 'var(--accent)',
  observed: 'var(--muted-fg)',
  scheduled: 'var(--muted-fg)',
}

function RowStateChip({ state }: { state: ScheduleRow['state'] }) {
  const { t } = useLang()
  const label = t.sn.obsState[state]
  const tone = ROW_STATE_TONE[state]
  if (state === 'scheduled' || state === 'observed') {
    return <span className="text-muted-fg">{label}</span>
  }
  return (
    <span
      className="inline-flex items-center h-5 px-2 rounded-full font-medium whitespace-nowrap"
      style={{ color: tone, backgroundColor: `color-mix(in oklab, ${tone} 14%, var(--surface))` }}
    >
      {label}
    </span>
  )
}

/**
 * One contractual test's outcome on one date (§ 3).
 *
 * `none` renders an em dash with an explanation rather than "not eligible":
 * production currently holds no autocall observations at all, and describing a
 * test that never ran as a negative result would be a fabrication.
 */
function OutcomeCell({ outcome }: { outcome: ScheduleOutcome }) {
  const { t } = useLang()
  const label = t.sn.obsOutcome[outcome]
  // R13.7B2.2.1 § 3 — a test that did not run (`none`) or can no longer run
  // (`void`, after a call) shows a dash, not a third repetition of the row's
  // status. The reason travels with it (tooltip + screen-reader text), so the
  // dash is never unexplained and never colour- or hover-only.
  if (outcome === 'none' || outcome === 'void') {
    const help = outcome === 'none' ? t.sn.obsOutcomeNoneHelp : t.sn.obsOutcomeVoidHelp
    return (
      <span className="text-muted-fg cursor-help" title={help}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{label} — {help}</span>
      </span>
    )
  }
  const cls =
    outcome === 'paid' || outcome === 'eligible' ? 'text-positive'
      : outcome === 'called' ? 'text-negative font-medium'
      : outcome === 'missed' || outcome === 'not_eligible' ? 'text-negative'
      : 'text-muted-fg'
  return <span className={cls}>{label}</span>
}

/**
 * R13.7B2.2.1 § 2 — the visible name of ONE merged gauge mark.
 *
 * Composed from the kinds that actually sit at that level, so the label states
 * exactly what the tick is and nothing else:
 *   · strike + autocall  → "Initial / call level"   (call level = 100% of initial)
 *   · strike alone       → "Initial level"           (the call level is a separate mark)
 *   · coupon + knockIn   → "Coupon / knock-in barrier"
 *   · anything else      → each kind's own name, joined
 * The normalized level follows in parentheses. The call level and the coupon
 * barrier are never merged unless they truly share a level.
 */
function gaugeMarkLabel(t: ReturnType<typeof useLang>['t'], m: MergedGaugeMark): string {
  const single: Record<MergedGaugeMark['kind'], string> = {
    knockIn: t.sn.gaugeMarkKnockIn,
    coupon: t.sn.gaugeMarkCoupon,
    autocall: t.sn.gaugeMarkAutocall,
    strike: t.sn.gaugeMarkStrikeOnly,
    other: t.sn.gaugeMarkStrikeOnly,
  }
  const rest = new Set(m.kinds)
  const parts: string[] = []
  if (isInitialCallMark(m)) { parts.push(t.sn.gaugeMarkStrike); rest.delete('strike'); rest.delete('autocall') }
  else if (rest.has('strike')) { parts.push(t.sn.gaugeMarkStrikeOnly); rest.delete('strike') }
  if (isCouponKnockInMark(m)) { parts.push(t.sn.gaugeMarkCouponKnockIn); rest.delete('coupon'); rest.delete('knockIn') }
  for (const k of rest) parts.push(single[k])
  const level = Number.isInteger(m.level) ? String(m.level) : m.level.toFixed(2)
  return `${parts.join(' · ')} (${level})`
}

/**
 * R13.7B2.2 § 8 — the gauge's legend, as VISIBLE text under the table.
 *
 * R13.7B2.2.1 § 2 — DATA-DRIVEN: it lists the marks THIS note's gauges
 * actually draw (coinciding levels already merged), one entry per tick, in
 * BarrierGauge's own colours (`BARRIER_KIND_COLOR`) so legend and gauge can
 * never disagree. The old fixed four-entry list named "Call level" and
 * "Initial / call level" as two things and "Coupon barrier" and "Knock-in
 * barrier" as two things while the gauge drew one tick for each pair — which
 * is precisely what made the owner ask whether the call level and the coupon
 * barrier were the same. They are not (100 vs 65), and the legend now shows
 * exactly two ticks with exactly those two names.
 */
function GaugeLegend({ marks }: { marks: MergedGaugeMark[] }) {
  const { t } = useLang()
  return (
    <div className="ui-meta text-muted-fg">
      <p>{t.sn.gaugeLegend}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-1" aria-label={t.sn.gaugeLegend}>
        {/* The current level is a DOT whose fill is proximity-based (it changes
            with the reading), so its swatch is an outlined circle rather than
            a fixed colour that would misdescribe it — the label says so too. */}
        <li className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ border: '1.5px solid var(--muted-fg)' }} aria-hidden="true" />
          <span>{t.sn.gaugeMarkCurrent}</span>
        </li>
        {marks.map((m) => (
          <li key={m.level} className="inline-flex items-center gap-1.5">
            <span className="shrink-0" style={{ display: 'inline-block', width: 2, height: 10, backgroundColor: BARRIER_KIND_COLOR[m.kind] }} aria-hidden="true" />
            <span>{gaugeMarkLabel(t, m)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1">{t.sn.gaugeMarksCoincide}</p>
      <p className="mt-1">{t.sn.worstExplain}</p>
      <p className="mt-1">{t.sn.distanceConvention}</p>
    </div>
  )
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
      {/* R13.7B2.2.2 § 1 — the terms card is the 3fr half of a shared row, so
          the grid opens to three columns at sm and four at xl: identity fills
          three rows, economics and dates two, provenance one — scannable, with
          no dead column beside it. */}
      <dl className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-2.5 text-sm">{children}</dl>
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
  allocations, currency, onSet, onAddCustom, masked, readOnly = false,
}: {
  allocations: { entityName: string; notionalAmount: number }[]
  currency: string
  /** Resolves whether the server accepted the upsert (the Remove control shows success only then). */
  onSet: (entity: string, notional: number) => Promise<boolean> | void
  onAddCustom: (entity: string) => void
  masked: boolean
  readOnly?: boolean
}) {
  const { t } = useLang()
  const [custom, setCustom] = useState('')
  const byName = new Map(allocations.map((a) => [a.entityName, a.notionalAmount]))
  // Predefined list first, then any custom entities that already have a row.
  const extras = allocations.map((a) => a.entityName).filter((n) => !DEFAULT_ENTITIES.includes(n as (typeof DEFAULT_ENTITIES)[number]))
  const rows = [...DEFAULT_ENTITIES, ...extras]

  return (
    <div>
      {/* R13.7B2.2.2 § 1 — one column in the 2fr allocation card at lg/xl so the
          notional inputs are never compressed; two columns only where the
          card is genuinely wide (below lg stacked full-width, and at 2xl). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map((name) => (
          <EntityRow key={name} name={name} currency={currency} value={byName.get(name) ?? 0} onCommit={(v) => onSet(name, v)} removable={extras.includes(name) && !readOnly} onRemove={() => onSet(name, 0)} masked={masked} readOnly={readOnly} />
        ))}
      </div>
      {!readOnly && (
      <form className="flex gap-2 mt-3 no-print" onSubmit={(e) => { e.preventDefault(); const n = custom.trim(); if (n) { onAddCustom(n); setCustom('') } }}>
        {/* R13.7B2.2.2 — in the 2fr card the input yields and the button never wraps its label. */}
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t.sn.entity} aria-label={t.sn.entity} className="flex-1 min-w-0 px-2.5 py-1 text-sm border border-border rounded-lg bg-surface" />
        <button type="submit" className="shrink-0 whitespace-nowrap px-3 py-1 text-sm rounded-full border border-border nv-transition cursor-pointer hover:border-accent">＋ {t.sn.addAllocation}</button>
      </form>
      )}
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

/**
 * R7.1B.1 — the note's single custodian field.
 *
 * Custody is a PORTFOLIO fact, not a product term: an issuer's term sheet does
 * not say who Nevada banks with, so this is always user-entered (or picked
 * from custodians already recorded on other notes) and is never derived from
 * the issuer, dealer, calculation agent, or a clearing system — Euroclear and
 * Clearstream are settlement infrastructure, not a custodian. One field per
 * note, because a note's accounts are all traded through the same institution.
 * An unrecorded custodian is shown honestly, never guessed.
 */
function CustodianField({ value, knownCustodians, onCommit, readOnly = false }: {
  value: string | null; knownCustodians: string[]; onCommit: (v: string) => void; readOnly?: boolean
}) {
  const { t } = useLang()
  const [draft, setDraft] = useState(value ?? '')
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setDraft(value ?? '') }
  const listId = 'sn-custodian-options'

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3 pb-3 text-sm" style={{ borderBottom: '1px solid var(--nv-line)' }}>
      <datalist id={listId}>
        {knownCustodians.map((c) => <option key={c} value={c} />)}
      </datalist>
      <label htmlFor="sn-custodian" className="ui-micro-label text-muted-fg" title={t.sn.custodianHelp}>{t.sn.custodian}</label>
      <input
        id="sn-custodian"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (!readOnly && draft.trim() !== (value ?? '')) onCommit(draft) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        readOnly={readOnly}
        list={listId}
        placeholder={t.sn.custodianUnavailable}
        aria-label={t.sn.custodian}
        title={t.sn.custodianHelp}
        className="flex-1 min-w-0 basis-40 px-2.5 py-1 text-sm border rounded-lg bg-surface no-print"
        style={{ borderColor: (value ?? '').trim() === '' ? 'var(--warning)' : 'var(--border)' }}
      />
      <span className="basis-full ui-meta text-muted-fg">{t.sn.custodianHelp}</span>
    </div>
  )
}

function EntityRow({ name, currency, value, onCommit, removable, onRemove, masked, readOnly = false }: { name: string; currency: string; value: number; onCommit: (v: number) => void; removable: boolean; onRemove: () => Promise<boolean> | void; masked: boolean; readOnly?: boolean }) {
  const { t } = useLang()
  const [draft, setDraft] = useState(value ? formatWithThousands(String(value)) : '')
  // Keep the input in sync when the persisted value changes (render-time prev pattern).
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setDraft(value ? formatWithThousands(String(value)) : '') }
  // R12 · Privacy Mode — the per-entity amounts sum to the masked note
  // notional, so a populated row must not sit raw in an always-visible input.
  // The Portfolio editor exception (raw values only after an explicit user
  // action) applies per row: while masked, a populated row shows the shared
  // placeholder until the user chooses to edit it. Empty rows stay editable —
  // a zero row discloses nothing. Re-enabling Privacy Mode re-hides all rows.
  const [revealed, setRevealed] = useState(false)
  const [prevMasked, setPrevMasked] = useState(masked)
  if (masked !== prevMasked) { setPrevMasked(masked); setRevealed(false) }
  const hidden = masked && !revealed && value > 0
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex-1 truncate" title={name}>{name}</span>
      <span className="text-xs text-muted-fg">{currency}</span>
      {hidden ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          title={t.sn.revealToEdit}
          aria-label={`${t.sn.accountNotional}: ${name} — ${t.fable.privacy.masked}`}
          className="w-32 px-2.5 py-1 text-sm text-right border border-border rounded-lg bg-surface ui-number tracking-wide no-print cursor-pointer"
        >
          •••••
        </button>
      ) : (
        <input
          value={draft}
          onChange={(e) => setDraft(formatWithThousands(e.target.value))}
          onBlur={() => { if (readOnly) return; const v = parseFormattedNumber(draft); if (v !== value) onCommit(v > 0 ? v : 0) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          readOnly={readOnly}
          inputMode="decimal" placeholder="0"
          aria-label={`${t.sn.accountNotional}: ${name} — ${currency}`}
          title={t.sn.accountNotionalHelp}
          className="w-32 px-2.5 py-1 text-sm text-right border border-border rounded-lg bg-surface ui-number no-print"
        />
      )}
      {/* R13.7B2.2.2 § 11 — a custom entity's Remove is the shared DeleteButton
          (compact; the panel floats over the row so the dense name · currency
          · notional line never shifts or overflows, even on a phone). Same
          mutation as before: an upsert of this entity's notional to 0,
          administrator-gated by the API — never a client-only removal. */}
      {removable && (
        <DeleteButton
          size="sm"
          layout="overlay"
          className="no-print"
          label={`${t.sn.removeEntity}: ${name}`}
          title={t.sn.removeEntity}
          confirmLabel={t.sn.removeEntityConfirm}
          onConfirm={onRemove}
        />
      )}
    </div>
  )
}
