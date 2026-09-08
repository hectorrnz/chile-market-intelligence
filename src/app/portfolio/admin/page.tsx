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
// NO AMOUNTS ARE RENDERED — with the one R13.8B exception, the before/after of
// an identity an import would OVERWRITE, which lives in `ImportPlanPreview`. The
// review payload otherwise carries counts, cell references, row labels and
// pass/fail; the figures themselves go from the parser straight into the import
// RPC without ever being serialized to a browser.
//
// R13.8C — this file owns the WORKFLOW (fetches, submit, gates, tables); the
// import plan's composition and hierarchy live in
// `src/components/familyPortfolio/ImportPlanPreview.tsx` and its pure
// derivations in `src/lib/familyPortfolio/importPlanPresentation.ts`.

import { useCallback, useEffect, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { TableCard } from '@/components/fable/TableCard'
import { DeleteButton } from '@/components/fable/DeleteButton'
import { ChipLabel } from '@/components/fable/Chip'
import {
  ImportPlanPreview,
  WorkflowSteps,
  type DraftReview,
  type ImportPlan,
  type ReviewFinding,
  type WorkflowStep,
} from '@/components/familyPortfolio/ImportPlanPreview'
import { TONE, isNoOp } from '@/lib/familyPortfolio/importPlanPresentation'

const CELL = 'py-2.5 px-3 first:pl-4 last:pr-4'
const TH = 'text-left py-2.5 px-3 first:pl-4 last:pr-4 ui-table-header text-muted-fg'
const BUTTON = 'rounded-full border border-border px-4 py-1.5 text-xs text-foreground disabled:opacity-50 disabled:cursor-not-allowed'

/** The status the server stamps on a Preview-only review fixture (R13.8C § 12). */
const FIXTURE_STATUS = 'review_fixture'

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

// ─── Draft review panel ───────────────────────────────────────────────────────

function ReviewPanel({
  upload,
  onLoaded,
  onPublished,
  onClose,
}: {
  upload: UploadRow
  /** The parse finished (well or badly) — the step indicator moves to Preview. */
  onLoaded: () => void
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
          onLoaded()
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
        onLoaded()
      } catch {
        if (!cancelled) {
          setError(a.error)
          setLoading(false)
          onLoaded()
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [upload.id, a.error, onLoaded])

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

  // R13.8C § 7 — a plan that writes nothing gets no enabled Apply. The server
  // would accept the request; the console simply never offers it for a no-op.
  const nothingToApply = plan !== null && isNoOp(plan)

  const cannotSubmit = !review?.publishable || busy || noteMissing || confirmDate === ''
  const isFixture = upload.status === FIXTURE_STATUS

  return (
    <div className="rounded-[20px] border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ui-label text-muted-fg mb-1">
            {upload.uploadKind === 'portfolio' ? a.kindPortfolio : a.kindAlternatives}
          </p>
          <p className="text-sm text-foreground truncate" title={upload.originalFilename}>
            {upload.originalFilename}
          </p>
          {isFixture && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-fg">
              <ChipLabel>{a.fixtureBadge}</ChipLabel>
              {a.fixtureNote}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-border px-3 py-1 text-xs text-muted-fg hover:text-foreground">
          {a.close}
        </button>
      </div>

      {loading && (
        <p className="mt-4 text-xs text-muted-fg" role="status">
          {a.parsing}
        </p>
      )}

      {error && (
        <p className="mt-4 text-xs" role="alert" style={{ color: TONE.blocked }}>
          {error}
        </p>
      )}

      {review && (
        <div className="mt-4 space-y-5">
          <ImportPlanPreview
            plan={plan}
            review={review}
            correction={{
              authorized: correctionAuthorized,
              reason: correctionReason,
              onAuthorizedChange: setCorrectionAuthorized,
              onReasonChange: setCorrectionReason,
              disabled: busy,
              // R13.8C § 6 — the STRONGER confirmation, inside the correction
              // card beside the reason it needs. Same submit as the normal
              // button; the server and the database each still refuse an
              // unauthorized or unexplained overwrite on their own.
              action: (
                <>
                  <button
                    type="button"
                    disabled={cannotSubmit || correctionIncomplete}
                    onClick={publish}
                    className="rounded-full border px-4 py-1.5 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderColor: TONE.changed, color: TONE.changed }}
                  >
                    {a.applyCorrection}
                  </button>
                  <span className="text-[11px] text-muted-fg">{a.normalConfirmDisabled}</span>
                </>
              ),
            }}
          />

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
                  cannotSubmit ||
                  // Nothing to write: never an enabled Apply for a no-op.
                  nothingToApply ||
                  // An overwrite can never be confirmed from HERE. The stronger
                  // control inside the correction card is the only path, and
                  // the server and the database each refuse independently;
                  // this is the courtesy layer, not the boundary.
                  needsCorrection ||
                  correctionIncomplete
                }
                onClick={publish}
                className={BUTTON}
              >
                {nothingToApply ? a.nothingToApply : a.publish}
              </button>
              <span className="text-xs" style={{ color: review.publishable ? TONE.new : TONE.blocked }}>
                {review.publishable ? a.publishable : a.notPublishable}
              </span>
              {needsCorrection && <span className="text-[11px] text-muted-fg">{a.normalConfirmDisabled}</span>}
            </div>
          </section>
        </div>
      )}
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

type UploadStage = 'choose' | 'chosen' | 'uploading' | 'uploaded'

function UploadPanel({
  onStage,
  onUploaded,
}: {
  onStage: (stage: UploadStage) => void
  onUploaded: (uploadId: string) => void
}) {
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
    onStage('uploading')
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
        onStage('chosen')
        return
      }

      // Warnings never block: the upload is valid either way, and the draft
      // preview is where a publication decision is actually made.
      setWarnings((data.findings ?? []).filter((f) => f.severity !== 'blocking'))
      setState('done')
      onStage('uploaded')
      if (data.uploadId) onUploaded(data.uploadId)
    } catch {
      setError(a.error)
      setState('idle')
      onStage('chosen')
    }
  }, [file, kind, a, onStage, onUploaded])

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

        <label className="inline-flex min-w-0 max-w-full items-center gap-2 cursor-pointer">
          <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-foreground">
            {a.chooseFile}
          </span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null
              setFile(picked)
              setState('idle')
              setError(null)
              setWarnings([])
              onStage(picked ? 'chosen' : 'choose')
            }}
          />
          {/* The browser supplies a bare filename — never a path. */}
          <span className="min-w-0 truncate text-xs text-muted-fg" title={file?.name}>
            {file ? file.name : a.noFileChosen}
          </span>
        </label>

        <button type="button" disabled={!file || state === 'uploading'} onClick={submit} className={BUTTON}>
          {state === 'uploading' ? a.uploading : a.uploadAction}
        </button>
      </div>

      {state === 'done' && (
        <p className="mt-3 text-xs" role="status" style={{ color: TONE.new }}>
          {a.uploadDone}
        </p>
      )}

      {error && (
        <p className="mt-3 text-xs" role="alert" style={{ color: TONE.blocked }}>
          {error}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="text-[11px]" style={{ color: TONE.changed }}>
              <span className="font-mono">{w.code}</span> <span className="text-muted-fg">— {w.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/** A count of import points in its disposition's tone; zero stays muted. */
function CountToken({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className="whitespace-nowrap" style={{ color: value > 0 ? tone : undefined }}>
      {label} <span className="ui-number font-medium">{value}</span>
    </span>
  )
}

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
  // R13.8C § 2 — where the administrator is in Choose → Upload → Parse →
  // Preview → Confirm. Derived from three plain facts, never a second state
  // machine: the upload control's stage, whether a draft is open and parsed,
  // and whether the last confirmation applied.
  const [uploadStage, setUploadStage] = useState<UploadStage>('choose')
  const [reviewLoaded, setReviewLoaded] = useState(false)
  const [applied, setApplied] = useState(false)

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
  const onReviewLoaded = useCallback(() => setReviewLoaded(true), [])

  const openDraft = useCallback((row: UploadRow) => {
    setReviewLoaded(false)
    setApplied(false)
    setSelected(row)
  }, [])

  /**
   * R13.5 — a publication rollback moves ONE `is_current` pointer for one week.
   * Resolves `false` on refusal so the shared destructive control returns to
   * idle and the refusal line below says why.
   */
  const rollback = useCallback(
    async (id: string): Promise<boolean> => {
      setRollbackError(null)
      const res = await fetch(`/api/family-portfolio/admin/publications/${id}/rollback`, { method: 'POST' })
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}))
        const code = data.error ?? 'error'
        setRollbackError((a.refusalImport as Record<string, string>)[code] ?? (a.refusal as Record<string, string>)[code] ?? code)
      }
      reload()
      return res.ok
    },
    [reload, a],
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
    async (id: string): Promise<boolean> => {
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
      return res.ok
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
      setReviewLoaded(false)
      setApplied(false)
      setSelected(row)
    }
  }

  const step: WorkflowStep = selected
    ? reviewLoaded
      ? 'preview'
      : 'parse'
    : applied
      ? 'confirm'
      : uploadStage === 'uploading' || uploadStage === 'chosen'
        ? 'upload'
        : uploadStage === 'uploaded'
          ? 'parse'
          : 'choose'

  const filenameOf = (uploadId: string) => uploads.find((u) => u.id === uploadId)?.originalFilename ?? '—'

  return (
    <div className="w-full space-y-6">
      <SectionHeader tag={a.tag} title={a.title} subtitle={a.subtitle} />

      {state === 'denied' && <p className="text-sm text-muted-fg">{a.notAuthorized}</p>}
      {state === 'error' && (
        <p className="text-sm" style={{ color: TONE.blocked }}>
          {a.error}
        </p>
      )}
      {state === 'loading' && <p className="text-sm text-muted-fg">{a.loading}</p>}

      {state === 'ready' && (
        <>
          <WorkflowSteps current={step} />

          <UploadPanel
            onStage={setUploadStage}
            onUploaded={(uploadId) => {
              setPendingUploadId(uploadId)
              reload()
            }}
          />

          {applied && !selected && (
            <p className="text-sm" role="status" style={{ color: TONE.new }}>
              {a.importApplied}
            </p>
          )}

          {rollbackError && (
            <p className="text-sm" role="alert" style={{ color: TONE.blocked }}>
              {rollbackError}
            </p>
          )}

          {selected && (
            <ReviewPanel
              upload={selected}
              onLoaded={onReviewLoaded}
              onClose={() => setSelected(null)}
              onPublished={() => {
                setSelected(null)
                setApplied(true)
                setUploadStage('choose')
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
                    <td className={`${CELL} text-foreground`}>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className="max-w-[18rem] truncate" title={u.originalFilename}>
                          {u.originalFilename}
                        </span>
                        {u.status === FIXTURE_STATUS && <ChipLabel>{a.fixtureBadge}</ChipLabel>}
                      </span>
                    </td>
                    <td className={`${CELL} text-muted-fg`}>{u.uploadKind === 'portfolio' ? a.kindPortfolio : a.kindAlternatives}</td>
                    <td className={`${CELL} font-mono text-xs text-muted-fg`}>{u.status}</td>
                    <td className={`${CELL} ui-number whitespace-nowrap text-muted-fg`}>{u.confirmedAsOfDate ?? u.detectedAsOfDate ?? '—'}</td>
                    <td className={`${CELL} ui-number whitespace-nowrap text-muted-fg`}>{u.uploadedAt.slice(0, 10)}</td>
                    <td className={CELL}>
                      <button type="button" onClick={() => openDraft(u)} className="rounded-full border border-border px-3 py-1 text-xs text-foreground">
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
                    <td className={`${CELL} text-muted-fg`}>{p.uploadKind === 'portfolio' ? a.kindPortfolio : a.kindAlternatives}</td>
                    <td className={`${CELL} ui-number whitespace-nowrap text-foreground`}>{p.asOfDate}</td>
                    <td className={`${CELL} ui-number whitespace-nowrap text-muted-fg`}>{p.revision}</td>
                    <td className={CELL}>
                      <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: p.isCurrent ? TONE.new : TONE.neutral }} aria-hidden />
                      <span className="ml-2 text-xs text-muted-fg">{p.isCurrent ? a.colCurrent : '—'}</span>
                    </td>
                    <td className={`${CELL} ui-number whitespace-nowrap text-muted-fg`}>{p.publishedAt.slice(0, 10)}</td>
                    <td className={`${CELL} font-mono text-xs text-muted-fg`}>{p.parserVersion}</td>
                    <td className={CELL}>
                      {!p.isCurrent && (
                        // The shared destructive control (Delete Control Rule):
                        // a visible question, confirmed in words, same handler.
                        <DeleteButton
                          label={`${a.rollback}: ${p.asOfDate} · rev. ${p.revision}`}
                          confirmLabel={a.rollbackPublicationConfirm}
                          onConfirm={() => rollback(p.id)}
                          size="sm"
                          layout="overlay"
                        >
                          {a.rollback}
                        </DeleteButton>
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
          <TableCard title={a.importsTitle} minWidth={900} footer={<TableSourceFooter source={a.source} />}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>{a.colImportDate}</th>
                  <th className={TH}>{a.colImportSource}</th>
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
                    <td className={`${CELL} text-muted-fg`} colSpan={7}>
                      {a.emptyImports}
                    </td>
                  </tr>
                )}
                {importOperations.map((op) => {
                  const c = op.counts as Record<string, number | undefined>
                  const source = filenameOf(op.uploadId)
                  return (
                    <tr key={op.id} className="border-b border-border/60">
                      <td className={`${CELL} ui-number whitespace-nowrap text-foreground`}>{op.asOfDate}</td>
                      <td className={`${CELL} text-xs text-muted-fg`}>
                        <span className="inline-block max-w-[16rem] truncate align-bottom" title={source}>
                          {source}
                        </span>
                      </td>
                      {/* Counts, never amounts — the same rule the rest of this
                          console follows outside the corrections block. Each
                          disposition in its own tone, so the composition of the
                          history an import wrote is visible at a glance. */}
                      <td className={`${CELL} text-xs text-muted-fg`}>
                        <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
                          <CountToken label={a.planNew} value={c.new ?? 0} tone={TONE.new} />
                          <CountToken label={a.planGapFill} value={c.gapFill ?? 0} tone={TONE.gapFill} />
                          <CountToken label={a.planChanged} value={c.changed ?? 0} tone={TONE.changed} />
                        </span>
                      </td>
                      <td className={`${CELL} text-xs text-muted-fg`}>
                        <span className="inline-block max-w-[16rem] truncate align-bottom" title={op.correctionReason ?? undefined}>
                          {op.correctionAuthorized ? op.correctionReason ?? '—' : '—'}
                        </span>
                      </td>
                      <td className={`${CELL} ui-number whitespace-nowrap text-muted-fg`}>{op.createdAt.slice(0, 10)}</td>
                      <td className={CELL}>
                        <span className="text-xs whitespace-nowrap" style={{ color: op.rolledBackAt ? TONE.neutral : TONE.new }}>
                          {op.rolledBackAt ? a.importRolledBack : a.importActive}
                        </span>
                      </td>
                      <td className={CELL}>
                        {/* An already-reversed import offers no control: the
                            database refuses a second rollback, and showing a
                            button that can only fail is not a courtesy. */}
                        {!op.rolledBackAt && (
                          <DeleteButton
                            label={`${a.rollbackImport}: ${op.asOfDate} · ${source}`}
                            confirmLabel={a.rollbackImportConfirm}
                            title={a.rollbackImportHint}
                            onConfirm={() => rollbackImport(op.id)}
                            size="sm"
                            layout="overlay"
                          >
                            {a.rollbackImport}
                          </DeleteButton>
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
