'use client'

// Phase 9A — Structured Note detail page.
// General terms · underlyings · schedule · internal allocations · live prices +
// distance to barrier · source/provenance. Middleware guarantees auth.

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { DEFAULT_ENTITIES } from '@/lib/structuredNotes/types'
import { dedupeObservationsByDate } from '@/lib/structuredNotes/pdf/extractStructuredNoteTerms'
import type { StructuredNote, UnderlyingPrice, RiskStatus } from '@/lib/structuredNotes/types'
import { fmtPct, fmtNum } from '../page'

interface Distance {
  underlyingOrder: number
  underlyingName: string
  currentLevel: number | null
  priceSource: string
  distanceToCouponBarrier: number | null
  distanceToKnockInBarrier: number | null
  distanceToAutocallBarrier: number | null
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

  const load = useCallback(async () => {
    const res = await fetch(`/api/structured-notes/${id}`)
    if (res.status === 404) { setNotFound(true); return }
    const json = await res.json().catch(() => null)
    if (json) setData(json)
  }, [id])

  useEffect(() => {
    const cancelled = { value: false }
    void (async () => {
      try {
        const res = await fetch(`/api/structured-notes/${id}`, { cache: 'no-store' })
        if (cancelled.value) return
        if (res.status === 404) { setNotFound(true); return }
        const json = await res.json().catch(() => null)
        if (!cancelled.value && json) setData(json)
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
  async function deleteNote() {
    await fetch(`/api/structured-notes/${id}`, { method: 'DELETE' })
    router.push('/structured-notes')
  }

  if (loading) return <div className="w-full text-sm text-muted-fg">…</div>
  if (notFound || !data) return (
    <div className="w-full">
      <Link href="/structured-notes" className="text-sm text-accent">← {t.sn.back}</Link>
      <div className="mt-4 text-sm text-muted-fg">not found</div>
    </div>
  )

  const n = data.note
  const allocationTotal = n.allocations.filter((a) => a.active).reduce((s, a) => s + (Number.isFinite(a.notionalAmount) ? a.notionalAmount : 0), 0)
  const mismatch = n.issueSize !== null && Math.abs(allocationTotal - n.issueSize) > 0.01

  return (
    <div className="w-full">
      <Link href="/structured-notes" className="text-sm text-accent no-print">← {t.sn.back}</Link>
      <div className="mt-2">
        <SectionHeader tag={n.isin ?? t.sn.tag} title={n.productName} subtitle={`${n.issuerDisplayName ?? ''} · ${n.structureType}`} />
      </div>

      {/* Metrics strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Kpi label={t.sn.riskStatus} value={data.metrics.riskStatus} tone={riskTone(data.metrics.riskStatus)} />
        <Kpi label={t.sn.worstPerformer} value={data.metrics.worstPerformer ? `${data.metrics.worstPerformer.underlyingName} ${fmtPct(data.metrics.worstPerformer.performance)}` : t.sn.unavailable} />
        <Kpi label={t.sn.colNext} value={data.metrics.nextObservation ? `${data.metrics.nextObservation.valuationDate}${data.metrics.daysToNextObservation !== null ? ` (${data.metrics.daysToNextObservation}d)` : ''}` : '—'} />
        <Kpi label={t.sn.colNotional} value={`${n.currency} ${fmtNum(data.metrics.currentNotional)}`} />
        <Kpi label={t.sn.colStatus} value={n.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* General terms */}
        <Card title={t.sn.generalTerms}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row k="ISIN" v={n.isin} mono />
            <Row k={t.sn.colIssuer} v={n.issuerDisplayName} />
            <Row k="Guarantor" v={n.guarantorName} />
            <Row k={t.sn.colCoupon} v={`${fmtPct(n.couponRatePeriodic)} · ${fmtPct(n.couponRateAnnualized)} p.a.`} />
            <Row k="Coupon barrier" v={fmtPct(n.couponBarrierPct)} />
            <Row k={t.sn.colKnockIn} v={fmtPct(n.knockInBarrierPct)} />
            <Row k="Autocall barrier" v={fmtPct(n.autocallBarrierPct)} />
            <Row k={t.sn.colTrade} v={n.tradeDate} />
            <Row k="Issue" v={n.issueDate} />
            <Row k="Final valuation" v={n.finalValuationDate} />
            <Row k={t.sn.colMaturity} v={n.maturityDate} />
            <Row k={t.sn.issueSize} v={n.issueSize !== null ? `${n.currency} ${fmtNum(n.issueSize)}` : null} />
          </dl>
        </Card>

        {/* Current levels & distance to barrier */}
        <Card title={t.sn.currentPrices} note={t.sn.sourceMarket}>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              {[t.sn.colUnderlyings, 'Level', t.sn.distanceCoupon, t.sn.distanceKnockIn].map((h) => <th key={h} className="text-left py-1.5 px-2 ui-table-header text-muted-fg">{h}</th>)}
            </tr></thead>
            <tbody>
              {data.metrics.distances.map((d) => (
                <tr key={d.underlyingOrder} className="border-b border-border last:border-0">
                  <td className="py-1.5 px-2">{d.underlyingName}</td>
                  <td className="py-1.5 px-2 ui-number">{d.currentLevel !== null ? fmtNum(d.currentLevel) : <span className="text-muted-fg">{t.sn.unavailable}</span>}</td>
                  <td className="py-1.5 px-2 ui-number">{fmtPct(d.distanceToCouponBarrier)}</td>
                  <td className="py-1.5 px-2 ui-number">{fmtPct(d.distanceToKnockInBarrier)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Underlyings */}
        <Card title={t.sn.underlyings}>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              {['#', t.sn.colUnderlyings, 'Yahoo', 'Initial', 'Strike', 'Knock-in', 'Coupon', 'Autocall'].map((h) => <th key={h} className="text-left py-1.5 px-2 ui-table-header text-muted-fg">{h}</th>)}
            </tr></thead>
            <tbody>
              {n.underlyings.map((u) => (
                <tr key={u.underlyingOrder} className="border-b border-border last:border-0">
                  <td className="py-1.5 px-2">{u.underlyingOrder}</td>
                  <td className="py-1.5 px-2">{u.underlyingName}</td>
                  <td className="py-1.5 px-2 font-mono text-xs">{u.yahooSymbol ?? '—'}</td>
                  <td className="py-1.5 px-2 ui-number">{fmtNum(u.initialLevel)}</td>
                  <td className="py-1.5 px-2 ui-number">{fmtNum(u.strikeLevel)}</td>
                  <td className="py-1.5 px-2 ui-number">{fmtNum(u.knockInBarrierLevel)}</td>
                  <td className="py-1.5 px-2 ui-number">{fmtNum(u.couponBarrierLevel)}</td>
                  <td className="py-1.5 px-2 ui-number">{fmtNum(u.autocallBarrierLevel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Schedule — one row per valuation date (coupon + autocall coincide) */}
        <Card title={t.sn.schedule}>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border">
                {['#', 'Valuation', 'Payment', 'Coupon barrier', 'Autocall barrier', 'Status'].map((h) => <th key={h} className="text-left py-1.5 px-2 ui-table-header text-muted-fg whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {dedupeObservationsByDate(n.observations).map((o) => (
                  <tr key={`${o.observationNumber}-${o.valuationDate}`} className="border-b border-border last:border-0">
                    <td className="py-1.5 px-2">{o.observationNumber}{o.observationType === 'final' ? ' ·F' : ''}</td>
                    <td className="py-1.5 px-2 ui-number">{o.valuationDate}</td>
                    <td className="py-1.5 px-2 ui-number">{o.paymentDate ?? o.redemptionDate ?? '—'}</td>
                    <td className="py-1.5 px-2 ui-number">{fmtPct(o.couponBarrierPct)}</td>
                    <td className="py-1.5 px-2 ui-number">{fmtPct(o.autocallBarrierPct)}</td>
                    <td className="py-1.5 px-2 text-xs text-muted-fg">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Allocation by entity (internal) — predefined sociedades + custom */}
        <Card title={t.sn.allocations} note={t.sn.allocationsNote}>
          <EntityAllocationGrid
            allocations={n.allocations}
            currency={n.currency}
            onSet={setEntityAllocation}
            onAddCustom={(name) => setEntityAllocation(name, 0)}
          />
          <div className="text-xs mt-2">
            {t.sn.allocationTotal}: <span className="ui-number">{n.currency} {fmtNum(allocationTotal)}</span>
            {n.issueSize !== null && <span className="text-muted-fg"> / {t.sn.issueSize} {n.currency} {fmtNum(n.issueSize)}</span>}
            {mismatch && <span className="text-warning ml-2">⚠ {t.sn.allocationMismatch}</span>}
          </div>
        </Card>
      </div>

      {/* Provenance + actions */}
      <div className="mt-6 border border-border rounded-lg p-4">
        <h3 className="ui-label text-muted-fg mb-2">{t.sn.provenance}</h3>
        <div className="text-xs text-muted-fg space-y-1">
          <div>{t.sn.source}: {n.sourceType === 'pdf_extraction' ? t.sn.sourcePdf : t.sn.sourceManual}{n.sourceFileName ? ` · ${n.sourceFileName}` : ''}</div>
          {n.confidenceScore !== null && <div>{t.sn.confidence}: {Math.round(n.confidenceScore * 100)}%</div>}
        </div>
        <button onClick={deleteNote} className="mt-3 text-xs text-negative no-print">{t.sn.delete}</button>
      </div>
    </div>
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
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map((name) => (
          <EntityRow key={name} name={name} currency={currency} value={byName.get(name) ?? 0} onCommit={(v) => onSet(name, v)} removable={extras.includes(name)} onRemove={() => onSet(name, 0)} />
        ))}
      </div>
      <form className="flex gap-2 mt-3 no-print" onSubmit={(e) => { e.preventDefault(); const n = custom.trim(); if (n) { onAddCustom(n); setCustom('') } }}>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t.sn.entity} className="px-2 py-1 text-sm border border-border rounded bg-surface" />
        <button type="submit" className="px-3 py-1 text-sm rounded border border-border">＋ {t.sn.addAllocation}</button>
      </form>
    </div>
  )
}

function EntityRow({ name, currency, value, onCommit, removable, onRemove }: { name: string; currency: string; value: number; onCommit: (v: number) => void; removable: boolean; onRemove: () => void }) {
  const [draft, setDraft] = useState(value ? String(value) : '')
  // Keep the input in sync when the persisted value changes (render-time prev pattern).
  const [prev, setPrev] = useState(value)
  if (value !== prev) { setPrev(value); setDraft(value ? String(value) : '') }
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex-1 truncate" title={name}>{name}</span>
      <span className="text-xs text-muted-fg">{currency}</span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const v = Number(draft.replace(/,/g, '')); if (Number.isFinite(v) && v !== value) onCommit(v > 0 ? v : 0) }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        inputMode="decimal" placeholder="0"
        className="w-28 px-2 py-1 text-sm text-right border border-border rounded bg-surface ui-number no-print"
      />
      {removable && <button onClick={onRemove} className="text-xs text-negative no-print" title="remove">✕</button>}
    </div>
  )
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="ui-label text-foreground">{title}</h3>
        {note && <span className="text-xs text-muted-fg">{note}</span>}
      </div>
      {children}
    </div>
  )
}
function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="border border-border rounded-lg bg-surface p-3">
      <div className="ui-label text-muted-fg">{label}</div>
      <div className="text-sm mt-1" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  )
}
function Row({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-fg">{k}</dt>
      <dd className={mono ? 'font-mono' : ''}>{v || '—'}</dd>
    </>
  )
}
function riskTone(s: RiskStatus): string | undefined {
  if (s === 'safe') return 'var(--positive)'
  if (s === 'watch') return 'var(--warning)'
  if (s === 'breached' || s === 'autocallable') return s === 'breached' ? 'var(--negative)' : 'var(--accent)'
  return undefined
}
