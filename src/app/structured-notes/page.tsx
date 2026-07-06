'use client'

// Phase 9A — Structured Notes list page.
// Middleware guarantees this page is only reachable by signed-in users.
// Automation-first: the primary flow is upload PDF → auto-extract → review →
// import. Manual editing is an exception path, not the default.

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import type { StructuredNote } from '@/lib/structuredNotes/types'

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

export default function StructuredNotesPage() {
  const { t } = useLang()
  const [notes, setNotes] = useState<StructuredNote[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<ExtractResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/structured-notes')
    const json = await res.json().catch(() => ({}))
    setNotes(Array.isArray(json.notes) ? json.notes : [])
  }, [])

  useEffect(() => {
    const cancelled = { value: false }
    void (async () => {
      try {
        const res = await fetch('/api/structured-notes', { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (cancelled.value) return
        setNotes(Array.isArray(json.notes) ? json.notes : [])
      } catch {
        if (!cancelled.value) setNotes([])
      } finally {
        if (!cancelled.value) setLoading(false)
      }
    })()
    return () => { cancelled.value = true }
  }, [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null); setPreview(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/structured-notes/extract', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) { setError(json.detail || json.error || t.sn.extractError); return }
      setPreview(json as ExtractResponse)
    } catch {
      setError(t.sn.extractError)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleImport() {
    if (!preview) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/structured-notes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: preview.note, extractionRunId: preview.extractionRunId, sourceFileHash: preview.fileHash }),
      })
      const json = await res.json()
      if (!res.ok) { setError((json.errors && json.errors.join(', ')) || json.detail || t.sn.importError); return }
      setPreview(null)
      await load()
    } catch {
      setError(t.sn.importError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full">
      <SectionHeader tag={t.sn.tag} title={t.sn.tag} subtitle={t.sn.subtitle} />

      {/* Upload / automation bar */}
      <div className="mb-5 flex items-center gap-3 no-print">
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-fg text-sm cursor-pointer hover:opacity-90">
          <input ref={fileRef} type="file" accept="application/pdf" onChange={handleFile} className="hidden" disabled={busy} />
          {busy ? t.sn.extracting : t.sn.upload}
        </label>
        <span className="text-xs text-muted-fg">{t.sn.subtitle}</span>
      </div>

      {error && <div className="mb-4 text-sm text-negative">{error}</div>}

      {/* Extraction preview (review-before-import) */}
      {preview && (
        <div className="mb-6 border border-border rounded-lg bg-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="ui-label text-foreground">{t.sn.review}</h3>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${preview.needsReview ? 'text-warning' : 'text-positive'}`}
                style={{ backgroundColor: `color-mix(in oklab, ${preview.needsReview ? 'var(--warning)' : 'var(--positive)'} 12%, var(--surface))` }}>
                {t.sn.confidence}: {Math.round(preview.confidenceScore * 100)}%{preview.needsReview ? ` · ${t.sn.needsReview}` : ''}
              </span>
            </div>
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
          {preview.warnings.length > 0 && (
            <ul className="mb-3 text-xs text-warning list-disc pl-5">
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {preview.errors.length > 0 && (
            <ul className="mb-3 text-xs text-negative list-disc pl-5">
              {preview.errors.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <button onClick={handleImport} disabled={busy || preview.errors.length > 0}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-fg text-sm disabled:opacity-50">
              {t.sn.importNote}
            </button>
            <button onClick={() => setPreview(null)} className="px-3 py-1.5 rounded-md border border-border text-sm">
              {t.sn.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Notes table */}
      {loading ? (
        <div className="text-sm text-muted-fg">…</div>
      ) : notes.length === 0 ? (
        <div className="text-sm text-muted-fg border border-border rounded-lg p-6 text-center">{t.sn.empty}</div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[t.sn.colIsin, t.sn.colIssuer, t.sn.colStructure, t.sn.colUnderlyings, t.sn.colCoupon, t.sn.colKnockIn, t.sn.colTrade, t.sn.colMaturity, t.sn.colStatus, t.sn.source].map((h) => (
                  <th key={h} className="text-left py-2.5 px-3 first:pl-4 ui-table-header text-muted-fg whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => (
                <tr key={n.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="py-2.5 px-3 first:pl-4">
                    <Link href={`/structured-notes/${n.id}`} className="font-mono text-accent hover:underline">{n.isin ?? '—'}</Link>
                  </td>
                  <td className="py-2.5 px-3">{n.issuerDisplayName ?? '—'}</td>
                  <td className="py-2.5 px-3 text-muted-fg">{n.structureType}</td>
                  <td className="py-2.5 px-3">{n.underlyings.map((u) => u.underlyingName).join(' / ')}</td>
                  <td className="py-2.5 px-3 ui-number">{fmtPct(n.couponRateAnnualized)}</td>
                  <td className="py-2.5 px-3 ui-number">{fmtPct(n.knockInBarrierPct)}</td>
                  <td className="py-2.5 px-3 ui-number">{n.tradeDate ?? '—'}</td>
                  <td className="py-2.5 px-3 ui-number">{n.maturityDate ?? '—'}</td>
                  <td className="py-2.5 px-3"><StatusPill status={n.status} /></td>
                  <td className="py-2.5 px-3 text-xs text-muted-fg">{n.sourceType === 'pdf_extraction' ? t.sn.sourcePdf : t.sn.sourceManual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-fg">{t.sn.allocationsNote} · {t.sn.sourceMarket}</p>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="ui-label text-muted-fg">{label}</div>
      <div className="text-foreground">{value || '—'}</div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'active' ? 'var(--positive)' : status === 'autocalled' ? 'var(--accent)' : status === 'defaulted' ? 'var(--negative)' : 'var(--muted-fg)'
  return (
    <span className="text-xs px-2 py-0.5 rounded-full" style={{ color, backgroundColor: `color-mix(in oklab, ${color} 12%, var(--surface))` }}>{status}</span>
  )
}

export { fmtPct, fmtNum }
