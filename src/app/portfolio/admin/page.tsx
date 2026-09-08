'use client'

// R13.5 — administrator publication console (doc 08 Stage 5, "Admin UI").
//
// THE CLIENT IS PRESENTATION, NEVER PROTECTION (doc 05 § 2.1 layer 4). This page
// renders only what the API returned, and every endpoint it calls re-checks
// administrative capability server-side. Reaching this URL as a non-administrator
// yields an authorization message here AND a 403 from every request behind it —
// the visible state is a courtesy, not the boundary. `accessPolicy.ts` already
// classifies this path as private by default-deny, so no allowlist entry exists
// or may be added.
//
// SCOPE NOTE. This is a standalone administrator surface. The Family Portfolio
// module shell and its `Overview · Portfolio · Weekly Changes · Alternatives ·
// Admin` navigation belong to Stage 6, and are deliberately NOT built here.
//
// NO AMOUNTS ARE RENDERED. The review payload carries counts, cell references,
// row labels and pass/fail; the figures themselves go from the parser straight
// into the publication RPC without ever being serialized to a browser.

import { useCallback, useEffect, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { TableCard } from '@/components/fable/TableCard'

const CELL = 'py-2.5 px-3 first:pl-4 last:pr-4'
const TH = 'text-left py-2.5 px-3 first:pl-4 last:pr-4 ui-table-header text-muted-fg'

interface UploadRow {
  id: string
  uploadKind: 'portfolio' | 'alternatives'
  originalFilename: string
  fileSizeBytes: number
  uploadedAt: string
  status: string
  detectedAsOfDate: string | null
  confirmedAsOfDate: string | null
}

interface PublicationRow {
  id: string
  uploadKind: 'portfolio' | 'alternatives'
  asOfDate: string
  revision: number
  isCurrent: boolean
  publishedAt: string
  parserVersion: string
}

interface ReviewFinding {
  severity: 'blocking' | 'warning' | 'info'
  code: string
  detail: string
  scope?: string
  sourceSheet?: string
  sourceCell?: string
  rowLabel?: string
}

interface DraftReview {
  uploadKind: 'portfolio' | 'alternatives'
  detectedAsOfDate: string | null
  previousWeekDate: string | null
  beginningOfYearDate: string | null
  scopes: Array<{ scope: string; rowCount: number; unavailableCount: number }>
  performance: Array<{ scope: string; basis: string; metric: string; agrees: boolean; indeterminate: boolean }>
  groups: Array<{ category: string; currency: string; holdings: number }>
  legend: Array<{ event: string; hex: string }>
  unclassifiedEventCells: string[]
  findings: ReviewFinding[]
  recordCount: number
  publishable: boolean
  refusals: string[]
  warningCount: number
}

// ─── R13.8B — the import plan ────────────────────────────────────────────────

interface PreviewCorrection {
  scope: string
  basis: string
  observationDate: string
  beforeValue: number | null
  afterValue: number | null
}

interface ImportPlan {
  contractVersion: string
  contractVerdict: string
  sheetNames: string[]
  frozen: {
    publicationColumnLetter: string | null
    publicationDate: string | null
    historicalColumnCount: number
    liveColumnLetter: string | null
    liveColumnDate: string | null
    refusal: string | null
  }
  productionEndpoint: string | null
  workbookLatest: string | null
  publicationDate: string | null
  newDates: string[]
  gapFillDates: string[]
  corrections: PreviewCorrection[]
  unchangedCount: number
  invalidDates: string[]
  cadenceGaps: Array<{ from: string; to: string; days: number }>
  action: string
  requiresHistoricalCorrection: boolean
  blocked: boolean
  blockCodes: string[]
  counts: { new: number; gapFill: number; changed: number; unchanged: number; invalid: number }
  planFingerprint: string
}

interface ImportOperationRow {
  id: string
  uploadId: string
  asOfDate: string
  planVersion: string
  counts: Record<string, unknown>
  correctionAuthorized: boolean
  correctionReason: string | null
  createdAt: string
  rolledBackAt: string | null
}

function severityColor(severity: ReviewFinding['severity']): string {
  if (severity === 'blocking') return 'var(--negative)'
  if (severity === 'warning') return 'var(--warning)'
  return 'var(--muted-fg)'
}

/**
 * A list of reporting dates.
 *
 * Dates, never values: NEW and GAP_FILL points are insertions, and an
 * administrator confirming them is agreeing to a set of WEEKS. Only an overwrite
 * shows amounts, and it shows them in its own block below.
 */
function DateList({ label, dates, tone }: { label: string; dates: string[]; tone: string }) {
  if (dates.length === 0) return null
  return (
    <section>
      <p className="ui-label mb-2" style={{ color: tone }}>
        {label} · <span className="ui-number">{dates.length}</span>
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {dates.map((d) => (
          <li
            key={d}
            className="rounded-full border border-border px-2.5 py-0.5 ui-number text-[11px] text-foreground"
          >
            {d}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Draft review panel ───────────────────────────────────────────────────────

function ReviewPanel({
  upload,
  onPublished,
  onClose,
}: {
  upload: UploadRow
  onPublished: () => void
  onClose: () => void
}) {
  const { t } = useLang()
  const a = t.fpAdmin

  const [review, setReview] = useState<DraftReview | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDate, setConfirmDate] = useState('')
  const [overrideNote, setOverrideNote] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [busy, setBusy] = useState(false)
  // R13.8B § 7 — correction mode. Off by default and never inferred: authorizing
  // an overwrite is an explicit act, so a plan carrying one stays un-confirmable
  // until the administrator turns this on AND writes a reason.
  const [correctionAuthorized, setCorrectionAuthorized] = useState(false)
  const [correctionReason, setCorrectionReason] = useState('')

  // All state changes happen inside the async callback, never synchronously in
  // the effect body — the React Compiler rule this codebase already follows
  // (see `watchlist/page.tsx`). `loading` starts true, so no reset is needed.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/family-portfolio/admin/uploads/${upload.id}`, { cache: 'no-store' })
        if (cancelled) return
        if (!res.ok) {
          setError(a.error)
          setLoading(false)
          return
        }
        const data: {
          draft: DraftReview | null
          draftError: string | null
          importPlan: ImportPlan | null
        } = await res.json()
        if (cancelled) return
        setReview(data.draft)
        setPlan(data.importPlan)
        if (!data.draft) setError(data.draftError ?? a.error)
        else setConfirmDate(data.draft.detectedAsOfDate ?? '')
        setLoading(false)
      } catch {
        if (!cancelled) {
          setError(a.error)
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [upload.id, a.error])

  const detected = review?.detectedAsOfDate ?? null
  // The note is required exactly when the administrator asserts a date the file
  // does not say. Mirrors `resolvePublicationDate` and the database CHECK; the
  // button being disabled is a convenience, not the enforcement.
  const overriding = detected !== null && confirmDate !== '' && confirmDate !== detected
  const noteMissing = overriding && overrideNote.trim().length === 0

  const publish = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/family-portfolio/admin/uploads/${upload.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmedAsOfDate: confirmDate || null,
          overrideNote: overrideNote.trim() || null,
          adminNote: adminNote.trim() || null,
          // R13.8B § 7 — the authorization decision, and only the decision. No
          // classification, date, prior value or row travels from the browser:
          // the server rebuilds the plan from the stored bytes.
          historicalCorrectionAuthorized: correctionAuthorized,
          correctionReason: correctionReason.trim() || null,
          // R13.8B § 9 — the plan this screen actually displayed. If Production
          // moved since, the server refuses rather than applying a different
          // plan behind this confirmation.
          expectedPlanFingerprint: plan?.planFingerprint ?? null,
        }),
      })
      const data: { error?: string; refusals?: string[]; blockCodes?: string[] } =
        await res.json().catch(() => ({}))
      if (!res.ok) {
        // Database refusals arrive prefixed (`publication_refused_…`); the
        // dictionary is keyed on the bare reason so one label serves both the
        // server-side gate and the database's own independent refusal.
        const raw = data.blockCodes?.[0] ?? data.refusals?.[0] ?? data.error ?? 'error'
        const code = raw.replace(/^publication_refused_/, '')
        setError(
          (a.refusalImport as Record<string, string>)[raw] ??
            (a.refusalImport as Record<string, string>)[code] ??
            (a.refusal as Record<string, string>)[code] ??
            code,
        )
        return
      }
      onPublished()
    } catch {
      setError(a.error)
    } finally {
      setBusy(false)
    }
  }, [upload.id, confirmDate, overrideNote, adminNote, correctionAuthorized, correctionReason, plan, a, onPublished])

  // R13.8B § 7 — the confirmation gate.
  //
  // A plan of NEW + GAP_FILL + UNCHANGED confirms normally, however many weeks
  // it carries: multi-week append is ordinary recurring behaviour, and a gap
  // fill below the endpoint is an insertion, not a correction. ONLY an overwrite
  // demands authorization and a reason.
  const needsCorrection = plan?.requiresHistoricalCorrection === true
  const correctionIncomplete =
    needsCorrection && (!correctionAuthorized || correctionReason.trim().length === 0)

  return (
    <div className="rounded-[20px] border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ui-label text-muted-fg mb-1">
            {upload.uploadKind === 'portfolio' ? a.kindPortfolio : a.kindAlternatives}
          </p>
          <p className="text-sm text-foreground truncate">{upload.originalFilename}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-fg hover:text-foreground"
        >
          {a.close}
        </button>
      </div>

      {loading && <p className="mt-4 text-xs text-muted-fg">{a.loading}</p>}

      {error && (
        <p className="mt-4 text-xs" style={{ color: 'var(--negative)' }}>
          {error}
        </p>
      )}

      {review && (
        <div className="mt-4 space-y-5">
          <p className="text-[11px] text-muted-fg">{a.noAmountsNote}</p>

          {/* Dates — proposed, never asserted. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Fact label={a.detectedDate} value={review.detectedAsOfDate ?? '—'} />
            <Fact label={a.previousWeek} value={review.previousWeekDate ?? '—'} />
            <Fact label={a.beginningOfYear} value={review.beginningOfYearDate ?? '—'} />
          </div>

          {review.scopes.length > 0 && (
            <section>
              <p className="ui-label text-muted-fg mb-2">{a.scopeSummary}</p>
              <ul className="flex flex-wrap gap-2">
                {review.scopes.map((s) => (
                  <li
                    key={s.scope}
                    className="rounded-full border border-border px-3 py-1 text-xs text-foreground"
                  >
                    <span className="font-mono">{s.scope}</span>{' '}
                    <span className="ui-number">{s.rowCount}</span> {a.rows}
                    {s.unavailableCount > 0 && (
                      <span className="text-muted-fg">
                        {' · '}
                        <span className="ui-number">{s.unavailableCount}</span> {a.unavailable}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.groups.length > 0 && (
            <section>
              <p className="ui-label text-muted-fg mb-2">{a.groups}</p>
              <ul className="flex flex-wrap gap-2">
                {review.groups.map((g) => (
                  <li
                    key={`${g.category}-${g.currency}`}
                    className="rounded-full border border-border px-3 py-1 text-xs text-foreground"
                  >
                    {g.category} · {g.currency} · <span className="ui-number">{g.holdings}</span>{' '}
                    {a.holdings}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.performance.length > 0 && (
            <section>
              <p className="ui-label text-muted-fg mb-2">{a.performanceChecks}</p>
              <ul className="flex flex-wrap gap-2">
                {review.performance.map((p, i) => (
                  <li
                    key={`${p.scope}-${p.basis}-${p.metric}-${i}`}
                    className="rounded-full border border-border px-3 py-1 text-xs"
                    style={{
                      color: p.indeterminate
                        ? 'var(--muted-fg)'
                        : p.agrees
                          ? 'var(--positive)'
                          : 'var(--warning)',
                    }}
                  >
                    <span className="font-mono">{p.scope}</span> {p.metric} —{' '}
                    {p.indeterminate ? a.indeterminate : p.agrees ? a.agrees : a.mismatch}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.unclassifiedEventCells.length > 0 && (
            <section>
              <p className="ui-label mb-2" style={{ color: 'var(--warning)' }}>
                {a.unclassified}
              </p>
              <p className="text-[11px] text-muted-fg mb-2">{a.unclassifiedHint}</p>
              <p className="font-mono text-[11px] text-foreground break-all">
                {review.unclassifiedEventCells.join(', ')}
              </p>
            </section>
          )}

          <section>
            <p className="ui-label text-muted-fg mb-2">{a.findings}</p>
            {review.findings.length === 0 ? (
              <p className="text-xs text-muted-fg">{a.noFindings}</p>
            ) : (
              <ul className="space-y-1">
                {review.findings.map((f, i) => (
                  <li key={`${f.code}-${i}`} className="text-xs text-foreground">
                    <span style={{ color: severityColor(f.severity) }}>
                      {f.severity === 'blocking' ? a.blocking : f.severity === 'warning' ? a.warning : a.info}
                    </span>
                    {' · '}
                    <span className="font-mono">{f.code}</span>
                    {f.sourceCell && <span className="font-mono text-muted-fg"> {f.sourceCell}</span>}
                    <span className="text-muted-fg"> — {f.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── R13.8B § 6 — the import plan. ──────────────────────────────
              Three groups, never merged: an insertion above the endpoint, an
              insertion below it, and an overwrite are different acts. Nothing
              here implies one upload equals one week. */}
          {plan && (
            <section className="rounded-[18px] border border-border bg-surface-2 p-3 sm:p-4 space-y-4">
              <p className="ui-label text-muted-fg">{a.planTitle}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <Fact label={a.planSchema} value={`${plan.contractVersion} · ${plan.contractVerdict}`} />
                <Fact label={a.planEndpoint} value={plan.productionEndpoint ?? '—'} />
                <Fact label={a.planNewestFrozen} value={plan.workbookLatest ?? '—'} />
                <Fact label={a.planPublication} value={plan.publicationDate ?? '—'} />
              </div>

              {/* The live column is REPORTED, never selected. Showing it beside
                  the frozen column is what makes "not published" visible rather
                  than merely true. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Fact
                  label={a.planFrozenColumn}
                  value={
                    plan.frozen.publicationColumnLetter
                      ? `${plan.frozen.publicationColumnLetter} · ${plan.frozen.publicationDate ?? '—'}`
                      : '—'
                  }
                />
                <Fact
                  label={a.planLiveColumn}
                  value={
                    plan.frozen.liveColumnLetter
                      ? `${plan.frozen.liveColumnLetter} · ${plan.frozen.liveColumnDate ?? '—'}`
                      : '—'
                  }
                />
              </div>
              <p className="text-[11px] text-muted-fg">{a.planLiveHint}</p>

              <DateList label={a.planNew} dates={plan.newDates} tone="var(--positive)" />

              {plan.gapFillDates.length > 0 && (
                <div className="space-y-1">
                  <DateList label={a.planGapFill} dates={plan.gapFillDates} tone="var(--accent)" />
                  <p className="text-[11px] text-muted-fg">{a.planGapFillHint}</p>
                </div>
              )}

              <DateList label={a.planInvalid} dates={plan.invalidDates} tone="var(--negative)" />

              {/* The ONE place this console shows amounts. An administrator
                  cannot honestly authorize an overwrite without seeing what is
                  being replaced. */}
              {plan.corrections.length > 0 && (
                <section>
                  <p className="ui-label mb-2" style={{ color: 'var(--warning)' }}>
                    {a.planChanged} · <span className="ui-number">{plan.corrections.length}</span>
                  </p>
                  <ul className="space-y-1">
                    {plan.corrections.map((c) => (
                      <li
                        key={`${c.scope}-${c.basis}-${c.observationDate}`}
                        className="text-[11px] text-foreground"
                      >
                        <span className="font-mono">{c.scope}</span>{' '}
                        <span className="text-muted-fg">{c.basis}</span>{' '}
                        <span className="ui-number">{c.observationDate}</span>
                        {' — '}
                        <span className="text-muted-fg">{a.planBefore}</span>{' '}
                        <span className="ui-number">{c.beforeValue ?? '—'}</span>
                        {' → '}
                        <span className="text-muted-fg">{a.planAfter}</span>{' '}
                        <span className="ui-number">{c.afterValue ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="text-[11px] text-muted-fg">
                {a.planUnchanged}: <span className="ui-number">{plan.unchangedCount}</span> {a.planCount}
              </p>

              {/* Informational only. The workbook not freezing a week is a fact
                  about the workbook, never permission to manufacture one. */}
              {plan.cadenceGaps.length > 0 && (
                <section>
                  <p className="ui-label text-muted-fg mb-1">{a.planCadence}</p>
                  <ul className="flex flex-wrap gap-1.5">
                    {plan.cadenceGaps.map((g) => (
                      <li
                        key={`${g.from}-${g.to}`}
                        className="rounded-full border border-border px-2.5 py-0.5 ui-number text-[11px] text-muted-fg"
                      >
                        {g.from} → {g.to} ({g.days}d)
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-muted-fg">{a.planNoInvent}</p>
                </section>
              )}

              {plan.newDates.length === 0 &&
                plan.gapFillDates.length === 0 &&
                plan.corrections.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--muted-fg)' }}>
                    {a.planNothing}
                  </p>
                )}
            </section>
          )}

          {/* ── R13.8B § 7 — historical correction mode. ────────────────────
              Rendered ONLY when an existing identity is being overwritten.
              Multiple new weeks and gap fills never reach this block. */}
          {needsCorrection && (
            <section
              className="rounded-[18px] border p-3 sm:p-4 space-y-3"
              style={{ borderColor: 'var(--warning)' }}
            >
              <p className="ui-label" style={{ color: 'var(--warning)' }}>
                {a.correctionTitle}
              </p>
              <p className="text-[11px] text-muted-fg">{a.correctionHint}</p>

              <label className="flex items-start gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={correctionAuthorized}
                  onChange={(e) => setCorrectionAuthorized(e.target.checked)}
                  className="mt-0.5"
                />
                <span>{a.correctionAuthorize}</span>
              </label>

              <label className="block">
                <span className="ui-label text-muted-fg">{a.correctionReason}</span>
                <input
                  type="text"
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  disabled={!correctionAuthorized}
                  className="mt-1 w-full rounded-[13px] border border-border bg-surface-2 px-3 py-2 text-sm text-foreground disabled:opacity-50"
                />
                <span className="mt-1 block text-[11px] text-muted-fg">{a.correctionReasonHint}</span>
              </label>
            </section>
          )}

          {/* Confirmation. */}
          <section className="space-y-3">
            <label className="block">
              <span className="ui-label text-muted-fg">{a.confirmDate}</span>
              <input
                type="date"
                value={confirmDate}
                onChange={(e) => setConfirmDate(e.target.value)}
                className="mt-1 w-full rounded-[13px] border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
              />
            </label>

            {overriding && (
              <label className="block">
                <span className="ui-label text-muted-fg">{a.overrideNote}</span>
                <input
                  type="text"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  className="mt-1 w-full rounded-[13px] border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
                />
                <span className="mt-1 block text-[11px] text-muted-fg">{a.overrideNoteHint}</span>
              </label>
            )}

            <label className="block">
              <span className="ui-label text-muted-fg">{a.adminNote}</span>
              <input
                type="text"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                className="mt-1 w-full rounded-[13px] border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={
                  !review.publishable ||
                  busy ||
                  noteMissing ||
                  confirmDate === '' ||
                  // An unauthorized overwrite can never be confirmed from here.
                  // The server and the database each refuse it independently;
                  // this is the courtesy layer, not the boundary.
                  correctionIncomplete
                }
                onClick={publish}
                className="rounded-full border border-border px-4 py-1.5 text-xs text-foreground disabled:opacity-50"
              >
                {a.publish}
              </button>
              <span
                className="text-xs"
                style={{ color: review.publishable ? 'var(--positive)' : 'var(--negative)' }}
              >
                {review.publishable ? a.publishable : a.notPublishable}
              </span>
            </div>

            {!review.publishable && review.refusals.length > 0 && (
              <ul className="space-y-1">
                {review.refusals.map((r) => (
                  <li key={r} className="text-xs" style={{ color: 'var(--negative)' }}>
                    {(a.refusal as Record<string, string>)[r] ?? r}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-border bg-surface-2 px-3 py-2">
      <p className="ui-label text-muted-fg">{label}</p>
      <p className="ui-number text-sm text-foreground">{value}</p>
    </div>
  )
}

// ─── R13.8B § 4 — the administrator front door ───────────────────────────────
//
// It posts to the EXISTING `POST /api/family-portfolio/admin/uploads`. No
// parallel upload endpoint was created: that route already runs the full
// validation ladder — administrator capability before a byte of the body is
// read, a Content-Length screen before `formData()` materialises the workbook,
// the authoritative `file.size` bound, the digest, the twelve content checks and
// duplicate detection. A second door would have to reimplement all of it.
//
// ADMINISTRATOR-ONLY. This control renders only inside the `ready` state, which
// is reached only when the console index returned 200 — a non-administrator gets
// 403 there and sees `notAuthorized` instead. The real boundary is the route's
// own re-check, which runs on every request regardless of what rendered.

function UploadPanel({ onUploaded }: { onUploaded: (uploadId: string) => void }) {
  const { t } = useLang()
  const a = t.fpAdmin

  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<'portfolio' | 'alternatives'>('portfolio')
  const [state, setState] = useState<'idle' | 'uploading' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<ReviewFinding[]>([])

  const submit = useCallback(async () => {
    if (!file) return
    setState('uploading')
    setError(null)
    setWarnings([])
    try {
      // FormData, because the route reads a multipart body. The bytes go
      // straight from the picker to the server; nothing is parsed client-side.
      const form = new FormData()
      form.append('uploadKind', kind)
      form.append('file', file)

      const res = await fetch('/api/family-portfolio/admin/uploads', { method: 'POST', body: form })
      const data: { uploadId?: string; error?: string; findings?: ReviewFinding[] } = await res
        .json()
        .catch(() => ({}))

      if (!res.ok) {
        // A blocking upload error is named, not generic: "file_too_large" and
        // "duplicate_upload" are different problems with different fixes.
        const code = data.error ?? 'error'
        setError((a.refusal as Record<string, string>)[code] ?? code)
        setState('idle')
        return
      }

      // Warnings never block: the upload is valid either way, and the draft
      // preview is where a publication decision is actually made.
      setWarnings((data.findings ?? []).filter((f) => f.severity !== 'blocking'))
      setState('done')
      if (data.uploadId) onUploaded(data.uploadId)
    } catch {
      setError(a.error)
      setState('idle')
    }
  }, [file, kind, a, onUploaded])

  return (
    <div className="rounded-[20px] border border-border bg-surface p-4 sm:p-5">
      <p className="ui-label text-muted-fg mb-1">{a.uploadTitle}</p>
      <p className="text-[11px] text-muted-fg mb-3">{a.uploadHint}</p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2">
          <span className="ui-label text-muted-fg">{a.uploadKindLabel}</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value === 'alternatives' ? 'alternatives' : 'portfolio')}
            className="rounded-[13px] border border-border bg-surface-2 px-3 py-1.5 text-xs text-foreground"
          >
            <option value="portfolio">{a.kindPortfolio}</option>
            <option value="alternatives">{a.kindAlternatives}</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-2 cursor-pointer">
          <span className="rounded-full border border-border px-3 py-1.5 text-xs text-foreground">
            {a.chooseFile}
          </span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setState('idle')
              setError(null)
              setWarnings([])
            }}
          />
          <span className="text-xs text-muted-fg truncate max-w-[16rem]">
            {file ? file.name : a.noFileChosen}
          </span>
        </label>

        <button
          type="button"
          disabled={!file || state === 'uploading'}
          onClick={submit}
          className="rounded-full border border-border px-4 py-1.5 text-xs text-foreground disabled:opacity-50"
        >
          {state === 'uploading' ? a.uploading : a.uploadAction}
        </button>
      </div>

      {state === 'done' && (
        <p className="mt-3 text-xs" style={{ color: 'var(--positive)' }}>
          {a.uploadDone}
        </p>
      )}

      {error && (
        <p className="mt-3 text-xs" style={{ color: 'var(--negative)' }}>
          {error}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="text-[11px]" style={{ color: 'var(--warning)' }}>
              <span className="font-mono">{w.code}</span>{' '}
              <span className="text-muted-fg">— {w.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FamilyPortfolioAdminPage() {
  const { t } = useLang()
  const a = t.fpAdmin

  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [publications, setPublications] = useState<PublicationRow[]>([])
  const [importOperations, setImportOperations] = useState<ImportOperationRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading')
  const [selected, setSelected] = useState<UploadRow | null>(null)
  const [rollbackError, setRollbackError] = useState<string | null>(null)
  // Set by a successful upload so the freshly-created draft opens as soon as the
  // console index has reloaded and the row exists to select.
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null)

  // A monotonic counter drives re-fetching, mirroring the `refreshSeq` pattern
  // used by MacroDataProvider and Compare. The fetch is inlined in the effect
  // and every setState happens inside the async callback, so nothing is set
  // synchronously in the effect body.
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/family-portfolio/admin/uploads', { cache: 'no-store' })
        if (cancelled) return
        // 403 is told apart from a transport failure: showing "could not load"
        // when the real answer is "you are not an administrator" would be a
        // misleading error.
        if (res.status === 403) {
          setState('denied')
          return
        }
        if (!res.ok) {
          setState('error')
          return
        }
        const data: {
          uploads: UploadRow[]
          publications: PublicationRow[]
          importOperations?: ImportOperationRow[]
        } = await res.json()
        if (cancelled) return
        setUploads(data.uploads ?? [])
        setPublications(data.publications ?? [])
        setImportOperations(data.importOperations ?? [])
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadSeq])

  const reload = useCallback(() => setReloadSeq((n) => n + 1), [])

  const rollback = useCallback(
    async (id: string) => {
      await fetch(`/api/family-portfolio/admin/publications/${id}/rollback`, { method: 'POST' })
      reload()
    },
    [reload],
  )

  /**
   * R13.8B § 10 — reverse a whole import.
   *
   * Insertions are removed, overwrites are restored to their exact before-image
   * and prior lineage, and the displaced publication is promoted back — all in
   * one transaction. A refusal is SURFACED, not swallowed: when a later import
   * already rewrote one of these rows the database declines rather than
   * clobbering it, and the administrator needs to be told that is what happened.
   */
  const rollbackImport = useCallback(
    async (id: string) => {
      setRollbackError(null)
      const res = await fetch(`/api/family-portfolio/admin/imports/${id}/rollback`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}))
        const code = data.error ?? 'error'
        setRollbackError((a.refusalImport as Record<string, string>)[code] ?? code)
      }
      reload()
    },
    [reload, a],
  )

  // "Adjust state when a prop changes" via the render-time previous-value
  // pattern on self state — never an effect that calls setState (the React
  // Compiler rule this codebase follows).
  if (pendingUploadId !== null && state === 'ready') {
    const row = uploads.find((u) => u.id === pendingUploadId)
    if (row) {
      setPendingUploadId(null)
      setSelected(row)
    }
  }

  return (
    <div className="w-full space-y-6">
      <SectionHeader tag={a.tag} title={a.title} subtitle={a.subtitle} />

      {state === 'denied' && <p className="text-sm text-muted-fg">{a.notAuthorized}</p>}
      {state === 'error' && (
        <p className="text-sm" style={{ color: 'var(--negative)' }}>
          {a.error}
        </p>
      )}
      {state === 'loading' && <p className="text-sm text-muted-fg">{a.loading}</p>}

      {state === 'ready' && (
        <>
          <UploadPanel
            onUploaded={(uploadId) => {
              setPendingUploadId(uploadId)
              reload()
            }}
          />

          {rollbackError && (
            <p className="text-sm" style={{ color: 'var(--negative)' }}>
              {rollbackError}
            </p>
          )}

          {selected && (
            <ReviewPanel
              upload={selected}
              onClose={() => setSelected(null)}
              onPublished={() => {
                setSelected(null)
                reload()
              }}
            />
          )}

          {/* Dense tables scroll inside their own card — page-level horizontal
              overflow is never acceptable (responsive conventions). */}
          <TableCard title={a.uploadsTitle} minWidth={720} footer={<TableSourceFooter source={a.source} />}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={TH}>{a.colFile}</th>
                    <th className={TH}>{a.colKind}</th>
                    <th className={TH}>{a.colStatus}</th>
                    <th className={TH}>{a.colDate}</th>
                    <th className={TH}>{a.colUploaded}</th>
                    <th className={TH}>{a.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.length === 0 && (
                    <tr>
                      <td className={`${CELL} text-muted-fg`} colSpan={6}>
                        {a.empty}
                      </td>
                    </tr>
                  )}
                  {uploads.map((u) => (
                    <tr key={u.id} className="border-b border-border/60">
                      <td className={`${CELL} text-foreground`}>{u.originalFilename}</td>
                      <td className={`${CELL} text-muted-fg`}>
                        {u.uploadKind === 'portfolio' ? a.kindPortfolio : a.kindAlternatives}
                      </td>
                      <td className={`${CELL} font-mono text-xs text-muted-fg`}>{u.status}</td>
                      <td className={`${CELL} ui-number text-muted-fg`}>
                        {u.confirmedAsOfDate ?? u.detectedAsOfDate ?? '—'}
                      </td>
                      <td className={`${CELL} ui-number text-muted-fg`}>{u.uploadedAt.slice(0, 10)}</td>
                      <td className={CELL}>
                        <button
                          type="button"
                          onClick={() => setSelected(u)}
                          className="rounded-full border border-border px-3 py-1 text-xs text-foreground"
                        >
                          {a.review}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </TableCard>

          <TableCard title={a.publicationsTitle} minWidth={720} footer={<TableSourceFooter source={a.source} />}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={TH}>{a.colKind}</th>
                    <th className={TH}>{a.colDate}</th>
                    <th className={TH}>{a.colRevision}</th>
                    <th className={TH}>{a.colCurrent}</th>
                    <th className={TH}>{a.colPublishedAt}</th>
                    <th className={TH}>{a.colParser}</th>
                    <th className={TH}>{a.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {publications.length === 0 && (
                    <tr>
                      <td className={`${CELL} text-muted-fg`} colSpan={7}>
                        {a.emptyPublications}
                      </td>
                    </tr>
                  )}
                  {publications.map((p) => (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className={`${CELL} text-muted-fg`}>
                        {p.uploadKind === 'portfolio' ? a.kindPortfolio : a.kindAlternatives}
                      </td>
                      <td className={`${CELL} ui-number text-foreground`}>{p.asOfDate}</td>
                      <td className={`${CELL} ui-number text-muted-fg`}>{p.revision}</td>
                      <td className={CELL}>
                        <span
                          className="inline-block h-2 w-2 rounded-full align-middle"
                          style={{ background: p.isCurrent ? 'var(--positive)' : 'var(--muted-fg)' }}
                          aria-hidden
                        />
                        <span className="ml-2 text-xs text-muted-fg">
                          {p.isCurrent ? a.colCurrent : '—'}
                        </span>
                      </td>
                      <td className={`${CELL} ui-number text-muted-fg`}>{p.publishedAt.slice(0, 10)}</td>
                      <td className={`${CELL} font-mono text-xs text-muted-fg`}>{p.parserVersion}</td>
                      <td className={CELL}>
                        {!p.isCurrent && (
                          <button
                            type="button"
                            onClick={() => void rollback(p.id)}
                            className="rounded-full border border-border px-3 py-1 text-xs text-foreground"
                          >
                            {a.rollback}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </TableCard>

          {/* ── R13.8B § 10 — the import ledger. ────────────────────────────
              A publication rollback moves ONE `is_current` pointer for one week.
              An import rollback reverses every history point the upload wrote,
              across every week it touched, plus that publication. They are
              different operations and are offered as such. */}
          <TableCard title={a.importsTitle} minWidth={720} footer={<TableSourceFooter source={a.source} />}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={TH}>{a.colImportDate}</th>
                    <th className={TH}>{a.colImportCounts}</th>
                    <th className={TH}>{a.colImportCorrection}</th>
                    <th className={TH}>{a.colImportCreated}</th>
                    <th className={TH}>{a.colImportState}</th>
                    <th className={TH}>{a.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {importOperations.length === 0 && (
                    <tr>
                      <td className={`${CELL} text-muted-fg`} colSpan={6}>
                        {a.emptyImports}
                      </td>
                    </tr>
                  )}
                  {importOperations.map((op) => {
                    const c = op.counts as Record<string, number | undefined>
                    return (
                      <tr key={op.id} className="border-b border-border/60">
                        <td className={`${CELL} ui-number text-foreground`}>{op.asOfDate}</td>
                        {/* Counts, never amounts — the same rule the rest of this
                            console follows outside the corrections block. */}
                        <td className={`${CELL} ui-number text-muted-fg`}>
                          {a.planNew} <span className="text-foreground">{c.new ?? 0}</span>
                          {' · '}
                          {a.planGapFill} <span className="text-foreground">{c.gapFill ?? 0}</span>
                          {' · '}
                          {a.planChanged} <span className="text-foreground">{c.changed ?? 0}</span>
                        </td>
                        <td className={`${CELL} text-xs text-muted-fg`}>
                          {op.correctionAuthorized ? (op.correctionReason ?? '—') : '—'}
                        </td>
                        <td className={`${CELL} ui-number text-muted-fg`}>{op.createdAt.slice(0, 10)}</td>
                        <td className={CELL}>
                          <span
                            className="text-xs"
                            style={{ color: op.rolledBackAt ? 'var(--muted-fg)' : 'var(--positive)' }}
                          >
                            {op.rolledBackAt ? a.importRolledBack : a.importActive}
                          </span>
                        </td>
                        <td className={CELL}>
                          {/* An already-reversed import offers no control: the
                              database refuses a second rollback, and showing a
                              button that can only fail is not a courtesy. */}
                          {!op.rolledBackAt && (
                            <button
                              type="button"
                              onClick={() => void rollbackImport(op.id)}
                              className="rounded-full border border-border px-3 py-1 text-xs text-foreground"
                            >
                              {a.rollbackImport}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
          </TableCard>
        </>
      )}
    </div>
  )
}
