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

function severityColor(severity: ReviewFinding['severity']): string {
  if (severity === 'blocking') return 'var(--negative)'
  if (severity === 'warning') return 'var(--warning)'
  return 'var(--muted-fg)'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirmDate, setConfirmDate] = useState('')
  const [overrideNote, setOverrideNote] = useState('')
  const [adminNote, setAdminNote] = useState('')
  const [busy, setBusy] = useState(false)

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
        const data: { draft: DraftReview | null; draftError: string | null } = await res.json()
        if (cancelled) return
        setReview(data.draft)
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
        }),
      })
      const data: { error?: string; refusals?: string[] } = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Database refusals arrive prefixed (`publication_refused_…`); the
        // dictionary is keyed on the bare reason so one label serves both the
        // server-side gate and the database's own independent refusal.
        const raw = data.refusals?.[0] ?? data.error ?? 'error'
        const code = raw.replace(/^publication_refused_/, '')
        setError((a.refusal as Record<string, string>)[code] ?? code)
        return
      }
      onPublished()
    } catch {
      setError(a.error)
    } finally {
      setBusy(false)
    }
  }, [upload.id, confirmDate, overrideNote, adminNote, a, onPublished])

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
                disabled={!review.publishable || busy || noteMissing || confirmDate === ''}
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FamilyPortfolioAdminPage() {
  const { t } = useLang()
  const a = t.fpAdmin

  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [publications, setPublications] = useState<PublicationRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading')
  const [selected, setSelected] = useState<UploadRow | null>(null)

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
        const data: { uploads: UploadRow[]; publications: PublicationRow[] } = await res.json()
        if (cancelled) return
        setUploads(data.uploads ?? [])
        setPublications(data.publications ?? [])
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
        </>
      )}
    </div>
  )
}
