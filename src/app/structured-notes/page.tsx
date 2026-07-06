'use client'

// Phase 9A/9B — Structured Notes dashboard (shared book).
// Middleware guarantees this page is only reachable by signed-in users. Every
// authenticated user sees the same book. Automation-first: upload PDF →
// auto-extract → review → import. Live positions show risk status, worst
// performer, distance to barrier, current notional; called notes move to the
// Archived view. An Update button re-pulls live underlying prices.

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { ARCHIVED_STATUSES } from '@/lib/structuredNotes/types'
import type { StructuredNote } from '@/lib/structuredNotes/types'
import type { NoteDashboardMetrics, BookSummary } from '@/lib/structuredNotes/dashboard'

interface ExtractResponse {
  extractionRunId: string | null
  fileHash: string
  ok: boolean
  confidenceScore: number
  note: StructuredNote
  warnings: string[]
  errors: string[]
  needsReview: boolean
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(2)}%`
}
function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US')
}

const RISK_TONE: Record<string, string> = {
  safe: 'var(--positive)', watch: 'var(--warning)', breached: 'var(--negative)', autocallable: 'var(--accent)', unavailable: 'var(--muted-fg)',
}
const CHART_PALETTE = ['#004A64', '#1A6630', '#8B0E04', '#B07A12', '#0E7FB8', '#5B6770', '#7399C6', '#2E7D32', '#9A6A00', '#417B9C']

export default function StructuredNotesPage() {
  const { t } = useLang()
  const [notes, setNotes] = useState<StructuredNote[]>([])
  const [metrics, setMetrics] = useState<Record<string, NoteDashboardMetrics>>({})
  const [summary, setSummary] = useState<BookSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<'live' | 'archived'>('live')
  const [preview, setPreview] = useState<ExtractResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const ingest = useCallback((json: { notes?: StructuredNote[]; metrics?: NoteDashboardMetrics[]; summary?: BookSummary }) => {
    setNotes(Array.isArray(json.notes) ? json.notes : [])
    const byId: Record<string, NoteDashboardMetrics> = {}
    for (const m of json.metrics ?? []) if (m.noteId) byId[m.noteId] = m
    setMetrics(byId)
    setSummary(json.summary ?? null)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch('/api/structured-notes', { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    ingest(json)
  }, [ingest])

  useEffect(() => {
    const cancelled = { value: false }
    void (async () => {
      try {
        const res = await fetch('/api/structured-notes', { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (cancelled.value) return
        ingest(json)
      } catch {
        if (!cancelled.value) setNotes([])
      } finally {
        if (!cancelled.value) setLoading(false)
      }
    })()
    return () => { cancelled.value = true }
  }, [ingest])

  async function refresh() {
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  async function setCalled(noteId: string, called: boolean) {
    await fetch(`/api/structured-notes/${noteId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: called ? 'autocalled' : 'active' }),
    })
    await load()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null); setPreview(null)
    try {
      const form = new FormData(); form.append('file', file)
      const res = await fetch('/api/structured-notes/extract', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { setError(json.detail || json.error || t.sn.extractError); return }
      setPreview(json as ExtractResponse)
    } catch {
      setError(t.sn.extractError)
    } finally {
      setBusy(false); if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleImport() {
    if (!preview) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/structured-notes/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: preview.note, extractionRunId: preview.extractionRunId, sourceFileHash: preview.fileHash }),
      })
      const json = await res.json()
      if (!res.ok) { setError((json.errors && json.errors.join(', ')) || json.detail || t.sn.importError); return }
      setPreview(null); await load()
    } catch {
      setError(t.sn.importError)
    } finally { setBusy(false) }
  }

  const riskLabel = (s: string) => ({ safe: t.sn.riskSafe, watch: t.sn.riskWatch, breached: t.sn.riskBreached, autocallable: t.sn.riskAutocallable, unavailable: t.sn.riskUnavailable }[s] ?? s)
  const isArchived = (n: StructuredNote) => ARCHIVED_STATUSES.includes(n.status)
  const shown = notes.filter((n) => (view === 'archived' ? isArchived(n) : !isArchived(n)))

  return (
    <div className="w-full">
      <SectionHeader tag={t.sn.tag} title={t.sn.tag} subtitle={t.sn.subtitle} />

      {/* Dashboard summary */}
      {summary && summary.totalNotes > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-5">
          <Kpi label={t.sn.dashLive} value={String(summary.activeNotes)} />
          <Kpi label={t.sn.dashSafe} value={String(summary.safeNotes)} tone="var(--positive)" />
          <Kpi label={t.sn.dashWatch} value={String(summary.watchNotes)} tone="var(--warning)" />
          <Kpi label={t.sn.dashAutocallable} value={String(summary.autocallableNotes)} tone="var(--accent)" />
          <Kpi label={t.sn.dashBreached} value={String(summary.breachedNotes)} tone={summary.breachedNotes > 0 ? 'var(--negative)' : undefined} />
          <Kpi label={t.sn.dashCalled} value={String(summary.calledNotes)} onClick={() => setView('archived')} />
          <Kpi label={t.sn.dashNotional} value={`${summary.currency} ${fmtNum(summary.totalCurrentNotional)}`} />
        </div>
      )}

      {/* Exposure charts */}
      {summary && (summary.issuerExposure.length > 0 || summary.entityExposure.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {summary.issuerExposure.length > 0 && (
            <div className="border border-border rounded-lg bg-surface p-4">
              <h3 className="ui-label text-muted-fg mb-3">{t.sn.exposureByIssuer}</h3>
              <BarChart data={summary.issuerExposure.map((e) => ({ label: e.issuer, value: e.notional }))} currency={summary.currency} ofTotal={t.sn.ofTotal} />
            </div>
          )}
          {summary.entityExposure.length > 0 && (
            <div className="border border-border rounded-lg bg-surface p-4">
              <h3 className="ui-label text-muted-fg mb-3">{t.sn.exposureByEntity}</h3>
              <Donut data={summary.entityExposure.map((e) => ({ label: e.entityName, value: e.notional }))} currency={summary.currency} ofTotal={t.sn.ofTotal} />
            </div>
          )}
        </div>
      )}
      {summary?.pricesAsOf && <div className="mb-4 text-xs text-muted-fg">{t.sn.pricesAsOf} {new Date(summary.pricesAsOf).toLocaleString()}</div>}

      {/* Upload + Update bar + view toggle */}
      <div className="mb-5 flex flex-wrap items-center gap-3 no-print">
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-fg text-sm cursor-pointer hover:opacity-90">
          <input ref={fileRef} type="file" accept="application/pdf" onChange={handleFile} className="hidden" disabled={busy} />
          {busy ? t.sn.extracting : t.sn.upload}
        </label>
        <button onClick={refresh} disabled={refreshing} className="px-3 py-2 rounded-md border border-border text-sm disabled:opacity-50">↻ {refreshing ? t.sn.updating : t.sn.update}</button>
        <div className="ml-auto inline-flex rounded-md border border-border overflow-hidden text-sm">
          <button onClick={() => setView('live')} className={`px-3 py-1.5 ${view === 'live' ? 'bg-surface-2 text-foreground' : 'text-muted-fg'}`}>{t.sn.viewLive}{summary ? ` (${summary.activeNotes})` : ''}</button>
          <button onClick={() => setView('archived')} className={`px-3 py-1.5 ${view === 'archived' ? 'bg-surface-2 text-foreground' : 'text-muted-fg'}`}>{t.sn.viewArchived}{summary ? ` (${summary.calledNotes})` : ''}</button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-negative">{error}</div>}

      {/* Extraction preview */}
      {preview && (
        <div className="mb-6 border border-border rounded-lg bg-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="ui-label text-foreground">{t.sn.review}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${preview.needsReview ? 'text-warning' : 'text-positive'}`}
              style={{ backgroundColor: `color-mix(in oklab, ${preview.needsReview ? 'var(--warning)' : 'var(--positive)'} 12%, var(--surface))` }}>
              {t.sn.confidence}: {Math.round(preview.confidenceScore * 100)}%{preview.needsReview ? ` · ${t.sn.needsReview}` : ''}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
            <Field label={t.sn.colIsin} value={preview.note.isin} />
            <Field label={t.sn.colIssuer} value={preview.note.issuerDisplayName} />
            <Field label={t.sn.colCoupon} value={fmtPct(preview.note.couponRateAnnualized)} />
            <Field label={t.sn.colKnockIn} value={fmtPct(preview.note.knockInBarrierPct)} />
            <Field label={t.sn.colTrade} value={preview.note.tradeDate} />
            <Field label={t.sn.colMaturity} value={preview.note.maturityDate} />
            <Field label={t.sn.colUnderlyings} value={preview.note.underlyings.map((u) => u.underlyingName).join(', ')} />
            <Field label={t.sn.colStructure} value={preview.note.structureType} />
          </div>
          {preview.warnings.length > 0 && <ul className="mb-3 text-xs text-warning list-disc pl-5">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {preview.errors.length > 0 && <ul className="mb-3 text-xs text-negative list-disc pl-5">{preview.errors.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className="flex gap-2">
            <button onClick={handleImport} disabled={busy || preview.errors.length > 0} className="px-3 py-1.5 rounded-md bg-primary text-primary-fg text-sm disabled:opacity-50">{t.sn.importNote}</button>
            <button onClick={() => setPreview(null)} className="px-3 py-1.5 rounded-md border border-border text-sm">{t.sn.cancel}</button>
          </div>
        </div>
      )}

      {/* Positions table */}
      {loading ? (
        <div className="text-sm text-muted-fg">…</div>
      ) : shown.length === 0 ? (
        <div className="text-sm text-muted-fg border border-border rounded-lg p-6 text-center">{t.sn.empty}</div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[t.sn.colCalled, t.sn.colIsin, t.sn.colIssuer, t.sn.colUnderlyings, t.sn.colIssued, t.sn.colCoupon, t.sn.colKnockIn, t.sn.colStatus, t.sn.colWorst, t.sn.colDistance, t.sn.colNext, t.sn.colNotional].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 first:pl-4 ui-table-header text-muted-fg whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((n) => {
                const m = n.id ? metrics[n.id] : undefined
                const nearObs = m?.daysToNextObservation != null && m.daysToNextObservation <= 7 && m.daysToNextObservation >= 0
                return (
                  <tr key={n.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                    <td className="py-2.5 px-3 first:pl-4 no-print">
                      <input type="checkbox" checked={isArchived(n)} onChange={(e) => n.id && setCalled(n.id, e.target.checked)} title={t.sn.dashCalled} />
                    </td>
                    <td className="py-2.5 px-3"><Link href={`/structured-notes/${n.id}`} className="font-mono text-accent hover:underline">{n.isin ?? '—'}</Link></td>
                    <td className="py-2.5 px-3">{n.issuerDisplayName ?? '—'}</td>
                    <td className="py-2.5 px-3">{n.underlyings.map((u) => u.underlyingName).join(' / ')}</td>
                    <td className="py-2.5 px-3 ui-number">{n.issueDate ?? n.tradeDate ?? '—'}</td>
                    <td className="py-2.5 px-3 ui-number">{fmtPct(n.couponRateAnnualized)}</td>
                    <td className="py-2.5 px-3 ui-number">{fmtPct(n.knockInBarrierPct)}</td>
                    <td className="py-2.5 px-3">
                      {m ? <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: RISK_TONE[m.riskStatus], backgroundColor: `color-mix(in oklab, ${RISK_TONE[m.riskStatus]} 12%, var(--surface))` }}>{riskLabel(m.riskStatus)}</span> : <StatusPill status={n.status} />}
                    </td>
                    <td className="py-2.5 px-3">{m?.worstPerformer ? <span>{m.worstPerformer.underlyingName} <span className="ui-number">{fmtPct(m.worstPerformer.performance)}</span></span> : '—'}</td>
                    <td className="py-2.5 px-3 ui-number">{m ? fmtPct(m.minDistanceToCouponBarrier) : '—'}</td>
                    <td className="py-2.5 px-3 ui-number">
                      {m?.nextObservationDate ? (
                        <span className={nearObs ? 'inline-block px-1.5 py-0.5 rounded' : ''} style={nearObs ? { color: 'var(--negative)', backgroundColor: 'color-mix(in oklab, var(--negative) 14%, var(--surface))', border: '1px solid var(--negative)' } : undefined}>
                          {m.nextObservationDate}{m.daysToNextObservation != null ? ` (${m.daysToNextObservation}d)` : ''}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 px-3 ui-number">{n.currency} {fmtNum(m?.currentNotional ?? 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-fg">{t.sn.allocationsNote} · {t.sn.sourceMarket}</p>
    </div>
  )
}

// ── Small presentational helpers ────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="ui-label text-muted-fg">{label}</div>
      <div className="text-foreground">{value || '—'}</div>
    </div>
  )
}
function Kpi({ label, value, tone, onClick }: { label: string; value: string; tone?: string; onClick?: () => void }) {
  const cls = `border border-border rounded-lg bg-surface p-3 text-left ${onClick ? 'cursor-pointer hover:bg-surface-2' : ''}`
  const inner = (
    <>
      <div className="ui-label text-muted-fg">{label}</div>
      <div className="text-lg mt-1" style={tone ? { color: tone } : undefined}>{value}</div>
    </>
  )
  return onClick ? <button onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>
}
function StatusPill({ status }: { status: string }) {
  const color = status === 'active' ? 'var(--positive)' : status === 'autocalled' ? 'var(--accent)' : status === 'defaulted' ? 'var(--negative)' : 'var(--muted-fg)'
  return <span className="text-xs px-2 py-0.5 rounded-full" style={{ color, backgroundColor: `color-mix(in oklab, ${color} 12%, var(--surface))` }}>{status}</span>
}

/** Horizontal bar chart with notional + % of total. No chart library (SVG/CSS). */
function BarChart({ data, currency, ofTotal }: { data: { label: string; value: number }[]; currency: string; ofTotal: string }) {
  const total = data.reduce((s, d) => s + (Number.isFinite(d.value) ? d.value : 0), 0)
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const pct = total > 0 ? (d.value / total) * 100 : 0
        return (
          <div key={d.label} className="text-xs">
            <div className="flex justify-between mb-0.5">
              <span className="text-foreground">{d.label}</span>
              <span className="text-muted-fg ui-number">{currency} {fmtNum(d.value)} · {pct.toFixed(1)}% {ofTotal}</span>
            </div>
            <div className="h-2 rounded bg-surface-2 overflow-hidden">
              <div className="h-full rounded" style={{ width: `${(d.value / max) * 100}%`, backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Donut/pie chart with legend (notional + % of total). No chart library (SVG). */
function Donut({ data, currency, ofTotal }: { data: { label: string; value: number }[]; currency: string; ofTotal: string }) {
  const total = data.reduce((s, d) => s + (Number.isFinite(d.value) && d.value > 0 ? d.value : 0), 0)
  const r = 42
  const C = 2 * Math.PI * r
  const positive = data.filter((d) => d.value > 0)
  // Prefix-sum of preceding fractions gives each segment's start offset (no mutation).
  const segs = positive.map((d, i) => {
    const frac = total > 0 ? d.value / total : 0
    const precedingFrac = positive.slice(0, i).reduce((s, p) => s + (total > 0 ? p.value / total : 0), 0)
    return { label: d.label, value: d.value, frac, dash: frac * C, offset: precedingFrac * C, color: CHART_PALETTE[i % CHART_PALETTE.length] }
  })
  return (
    <div className="flex items-center gap-4">
      {total > 0 ? (
        <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0" style={{ transform: 'rotate(-90deg)' }}>
          {segs.map((s) => (
            <circle key={s.label} cx="50" cy="50" r={r} fill="none" strokeWidth="14" stroke={s.color}
              strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={-s.offset} />
          ))}
        </svg>
      ) : (
        <div className="w-24 h-24 shrink-0 rounded-full border-8 border-border" />
      )}
      <div className="text-xs space-y-1 min-w-0">
        {segs.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-foreground truncate">{s.label}</span>
            <span className="text-muted-fg ui-number ml-auto whitespace-nowrap">{currency} {fmtNum(s.value)} · {(s.frac * 100).toFixed(1)}% {ofTotal}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export { fmtPct, fmtNum }
