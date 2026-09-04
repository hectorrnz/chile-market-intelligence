'use client'

// Phase 9A/9B — Structured Notes dashboard (shared book).
// Middleware guarantees this page is only reachable by signed-in users. Every
// authenticated user sees the same book. Automation-first: upload PDF →
// auto-extract → review → import. Live positions show risk status, worst
// performer, distance to barrier, current notional; called notes move to the
// Archived view. An Update button re-pulls live underlying prices.
//
// Phase R3 — Fable composition. Presentation only: every hook, effect, fetch
// call, computed value, filter, sort, and mutation payload below is unchanged
// in substance. The LAYOUT is rebuilt to the approved Fable Structured Notes
// screen (nmi-fable-v1 SPECS.md §6 — capsule row → lifecycle legend chips →
// wide table with the barrier gauge — per docs/fable-integration/03's route
// mapping):
//
//   Header      — Fable header architecture via the shared PageHeader
//                 primitive: 19px title + baseline metadata, actions right.
//                 The Update button stays PAGE-LOCAL (it re-pulls this book's
//                 prices, not the platform-wide market/macro refresh), so it
//                 deliberately does NOT use UpdateDataButton.
//   Capsules    — the Fable capsule row, carrying ALL SEVEN existing NMI
//                 dashboard KPIs (more than Fable's four — NMI substance wins)
//                 plus the Fable NEXT OBSERVATION capsule, derived from the
//                 per-note nextObservationDate the dashboard API already
//                 returns. Status capsules keep their click-to-filter
//                 behavior and legend tooltips.
//   Exposure    — (R3 manual-validation repair) issuer exposure recomposed as
//                 a Fable ranked-bar list (name + share over a thin uniform
//                 accent fill on the chip track — the old per-issuer palette
//                 colors falsely implied a color link with the entity donut)
//                 and the entity allocation donut refined (gapped segments,
//                 center TOTAL, hover-linked legend). Both sit on Fable card
//                 glass behind a shared header carrying the card's TOTAL.
//                 Same data, same exact values/percentages — presentation only.
//   Legend      — the Fable lifecycle-legend chip row (SPECS §6), replacing
//                 the pre-Fable always-visible legend paragraph; each chip
//                 keeps the full legend sentence via title + sr-only text.
//   Table       — Fable wide-table language inside the shared TableCard, in
//                 the triage-first column order of the R3 manual-validation
//                 repair: Status and Next observation lead, then the
//                 composite NOTE cell (product name over ISIN · underlyings,
//                 width-capped with the full text revealed on hover), Issuer,
//                 the signature BarrierGauge column (0–130 track, knock-in +
//                 strike ticks, proximity-colored current dot), distance,
//                 worst performer, coupon, knock-in, issued, notional — and
//                 the administrative Called checkbox last. Every pre-Fable
//                 column remains — Fable's per-row VALUATION timestamp column
//                 is the one omission, because no per-note valuation
//                 timestamp exists on this list payload; the book-level
//                 as-of stays in the footer.
//   Density     — (R3 table-density repair) table-layout: fixed + a COLS
//                 colgroup so every column fits a maximized 1728px desktop
//                 with no internal scrollbar; narrower viewports keep the
//                 card-contained scroll. Status is left-aligned; Note is
//                 left-aligned and truncated (full text via hover title);
//                 the gauge is centered; every other column — Next obs,
//                 Issuer, distance, worst, coupon, knock-in, issued,
//                 notional, Called — centers header and cells (final manual
//                 review; supersedes the earlier right-alignment, which
//                 itself superseded the pre-Fable Phase 9B.2 centering).
//
// Fable elements with no authoritative NMI data are OMITTED, never faked:
// the per-row valuation timestamp (above), the "% of portfolio" capsule
// subline (no portfolio-total linkage exists), and Fable's sample coupon
// narration ("Paid Q2 · 8.20% p.a." — NMI has the annualized rate only).

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { TableSourceFooter } from '@/components/ui/TableSourceFooter'
import { ARCHIVED_STATUSES } from '@/lib/structuredNotes/types'
import type { StructuredNote } from '@/lib/structuredNotes/types'
import type { NoteDashboardMetrics, BookSummary } from '@/lib/structuredNotes/dashboard'
import { PageHeader } from '@/components/fable/PageHeader'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { TableCard } from '@/components/fable/TableCard'
import { BarrierGauge, type BarrierMark } from '@/components/fable/BarrierGauge'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { ChipButton, ChipSelect } from '@/components/fable/Chip'
import { DestructiveConfirm } from '@/components/fable/ModalShell'
import { PrivacyValue } from '@/components/fable/PrivacyValue'
import { usePrivacyMode } from '@/components/fable/usePrivacyMode'
import { Reveal, Pop } from '@/components/fable/motion'

interface MonitoringStatus {
  latestRun: { status: string; startedAt: string; completedAt: string | null; pricesSucceeded: number | null; pricesFailed: number | null } | null
  latestSnapshotDate: string | null
  activeNoteCount: number
  unsupportedUnderlyingCount: number
  staleNoteCount: number
  dueSoonCount: number
  reviewRequiredCount: number
  // Phase 9E — free-provider quality signals from the latest monitoring run's metadata.
  fallbackProviderUsed?: boolean
  providerDisagreement?: boolean
}

type ReviewState = 'ready' | 'review_recommended' | 'review_required' | 'unsupported'

interface ExtractResponse {
  extractionRunId: string | null
  fileHash: string
  ok: boolean
  confidenceScore: number
  note: StructuredNote
  warnings: string[]
  errors: string[]
  needsReview: boolean
  reviewState: ReviewState
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
  // R13.7B2.2 § 3/§ 6 — `called` is a TERMINAL state, distinct from the
  // `autocallable` forecast, and the owner review specified red for it. The
  // label text always names the status, so meaning is never color-alone.
  safe: 'var(--positive)', watch: 'var(--warning)', breached: 'var(--negative)', autocallable: 'var(--accent)', called: 'var(--negative)', unavailable: 'var(--muted-fg)',
}

const REVIEW_STATE_TONE: Record<ReviewState, string> = {
  ready: 'var(--positive)', review_recommended: 'var(--accent)', review_required: 'var(--warning)', unsupported: 'var(--negative)',
}
// Severity order used when sorting/filtering by status — most urgent first.
// `called` is terminal rather than a live risk level, so it sorts after every
// live classification and before the "no data" bucket.
const STATUS_RANK: Record<string, number> = { breached: 0, autocallable: 1, watch: 2, safe: 3, called: 4, unavailable: 5 }
const CHART_PALETTE = ['#004A64', '#1A6630', '#8B0E04', '#B07A12', '#0E7FB8', '#5B6770', '#7399C6', '#2E7D32', '#9A6A00', '#417B9C']
type SortKey = 'issued' | 'issuer' | 'status' | 'next'

/**
 * Pure display thresholding — the Fable barrier-proximity palette (≥25%
 * headroom positive, 15–25% warning, <15% critical) applied to the EXISTING
 * minDistanceToCouponBarrier measure (barrier/current − 1; negative =
 * headroom). Mirrors BarrierGauge's own documented thresholds. Never feeds
 * any eligibility/business logic — that stays in src/lib/structuredNotes.
 */
function distanceTone(d: number | null | undefined): string {
  if (d === null || d === undefined || !Number.isFinite(d)) return 'var(--muted-fg)'
  const headroom = -d
  if (headroom < 0.15) return 'var(--critical)'
  if (headroom < 0.25) return 'var(--warning)'
  return 'var(--positive)'
}

/**
 * Display-only shortening of a Bloomberg-style underlying ticker: term sheets
 * (and therefore `underlyingName`) carry the market-sector qualifier — "SPX
 * Index", "SPY US Equity" — which is redundant in a dense table where every
 * row is an underlying. Strips ONLY a recognized trailing qualifier (with an
 * optional 2-letter exchange code); anything else is returned verbatim, so an
 * unrecognized name is never mangled. The full ticker stays available via the
 * cell's hover `title`, and the stored value is untouched — this never feeds
 * symbol resolution, which stays in structuredNoteMarketProvider.
 */
function shortUnderlying(name: string): string {
  const m = /^(\S+)\s+(?:[A-Z]{2}\s+)?(?:Index|Equity|Curncy|Comdty|Govt|Corp)$/i.exec(name.trim())
  return m ? m[1] : name
}

// Fable chip-input / pill recipes (established Phase 5D–5H) — tokens only.
const PILL_PRIMARY =
  'inline-flex items-center gap-1.5 h-8 px-4 rounded-full bg-primary text-primary-fg text-xs font-medium cursor-pointer nv-transition hover:opacity-90'

export default function StructuredNotesPage() {
  const { t, lang } = useLang()
  // R11: the Nevada notional is one of the six documented private amounts.
  // Home already masked it; its own canonical pages did not.
  const [masked] = usePrivacyMode()
  const router = useRouter()
  const [notes, setNotes] = useState<StructuredNote[]>([])
  const [metrics, setMetrics] = useState<Record<string, NoteDashboardMetrics>>({})
  const [summary, setSummary] = useState<BookSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  // POST-R13.6CDE — an authorization denial is an ANSWER, not a failure, and
  // must never render as "Something went wrong". 403 means this account does not
  // hold the module; 503 and everything else remain genuine failures.
  const [notAuthorized, setNotAuthorized] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<'live' | 'archived'>('live')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [issuerFilter, setIssuerFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('issued')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [preview, setPreview] = useState<ExtractResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [monitoring, setMonitoring] = useState<MonitoringStatus | null>(null)
  // R7.1B — dashboard row deletion. `pendingDelete` holds the note the trash
  // trigger opened the shared confirmation for; nothing mutates until confirm.
  // POST-R13.6B.1 — the API reports whether THIS caller may mutate the book.
  // A module grant opens reading only; create/edit/delete are administrator-
  // only. This hides controls the API would refuse; it is presentation, never
  // protection — every mutation route re-checks, and RLS refuses regardless.
  const [canManage, setCanManage] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<StructuredNote | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const ingest = useCallback((json: { notes?: StructuredNote[]; metrics?: NoteDashboardMetrics[]; summary?: BookSummary; canManage?: boolean }) => {
    setNotes(Array.isArray(json.notes) ? json.notes : [])
    // Absent or non-true => read-only. Never inferred from anything else.
    setCanManage(json.canManage === true)
    const byId: Record<string, NoteDashboardMetrics> = {}
    for (const m of json.metrics ?? []) if (m.noteId) byId[m.noteId] = m
    setMetrics(byId)
    setSummary(json.summary ?? null)
  }, [])

  const loadMonitoring = useCallback(async () => {
    try {
      const res = await fetch('/api/structured-notes/monitoring-status', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      setMonitoring(res.ok ? (json as MonitoringStatus) : null)
    } catch {
      setMonitoring(null)
    }
  }, [])

  const load = useCallback(async () => {
    // R12: a non-ok response (503 not-configured, middleware 401) still
    // carries a JSON body — ingesting it would render a live book as
    // confirmed-empty ("no structured notes yet"). Any failure now reaches
    // the honest error state instead.
    try {
      const res = await fetch('/api/structured-notes', { cache: 'no-store' })
      if (res.status === 403) { setNotes([]); setNotAuthorized(true); setLoadFailed(false); return }
      if (!res.ok) { setNotAuthorized(false); setLoadFailed(true); return }
      const json = await res.json().catch(() => null)
      if (!json) { setNotAuthorized(false); setLoadFailed(true); return }
      ingest(json)
      setNotAuthorized(false)
      setLoadFailed(false)
    } catch {
      setNotAuthorized(false)
      setLoadFailed(true)
    }
    await loadMonitoring()
  }, [ingest, loadMonitoring])

  useEffect(() => {
    const cancelled = { value: false }
    void (async () => {
      try {
        const res = await fetch('/api/structured-notes', { cache: 'no-store' })
        if (cancelled.value) return
        // R3/R12 — a failed initial load (thrown OR non-ok OR unparseable)
        // renders the honest error state, never the "no structured notes yet"
        // empty copy (the book may well be non-empty).
        if (res.status === 403) { setNotes([]); setNotAuthorized(true); setLoadFailed(false); return }
        if (!res.ok) { setNotes([]); setNotAuthorized(false); setLoadFailed(true); return }
        const json = await res.json().catch(() => null)
        if (cancelled.value) return
        if (!json) { setNotes([]); setNotAuthorized(false); setLoadFailed(true); return }
        ingest(json)
        setNotAuthorized(false)
        setLoadFailed(false)
      } catch {
        if (!cancelled.value) { setNotes([]); setNotAuthorized(false); setLoadFailed(true) }
      } finally {
        if (!cancelled.value) setLoading(false)
      }
      void loadMonitoring()
    })()
    return () => { cancelled.value = true }
  }, [ingest, loadMonitoring])

  async function refresh() {
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  // The "note was called" notice is now the platform notification bell (see
  // NotificationBell in TopBar) — the scheduled monitoring cron creates a
  // shared notification + emails the configured recipient list directly, so
  // this page no longer needs its own per-browser banner/seen-list.
  // R12: the Called toggle is a real status mutation — it now carries a
  // pending lock (no concurrent PATCH races), checks the response, and
  // surfaces a localized failure instead of silently reverting on reload.
  const [calledBusy, setCalledBusy] = useState(false)
  const [calledError, setCalledError] = useState(false)
  async function setCalled(noteId: string, called: boolean) {
    if (calledBusy) return
    setCalledBusy(true)
    setCalledError(false)
    try {
      const res = await fetch(`/api/structured-notes/${noteId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: called ? 'autocalled' : 'active' }),
      })
      if (!res.ok) { setCalledError(true); return }
      await load()
    } catch {
      setCalledError(true)
    } finally {
      setCalledBusy(false)
    }
  }

  /**
   * R7.1B — deletes the note behind the open confirmation. Same contract as the
   * detail page's action: one DELETE to /api/structured-notes/{id}, the shared
   * destructive dialog as the only gate, and a reload on success so the table
   * AND both exposure aggregates (issuer, custodian) recompute from the server.
   * A failure keeps the row and the dialog so the user can retry or cancel.
   */
  async function confirmDeleteNote() {
    const note = pendingDelete
    if (!note?.id) return
    setDeleting(true); setDeleteFailed(false)
    try {
      const res = await fetch(`/api/structured-notes/${note.id}`, { method: 'DELETE' })
      if (!res.ok) { setDeleteFailed(true); return }
      setPendingDelete(null)
      await load()
    } catch {
      setDeleteFailed(true)
    } finally {
      setDeleting(false)
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(null); setPreview(null)
    try {
      const form = new FormData(); form.append('file', file)
      const res = await fetch('/api/structured-notes/extract', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) {
        // R12: server error CODES map to localized copy — the response's
        // `detail` (hardcoded English, and formerly a raw parser exception)
        // is never rendered. Unknown codes fall back to the generic message.
        const codeMsg: Record<string, string> = {
          unsupported_type: t.sn.onlyPdf,
          file_too_large: t.sn.fileTooLarge,
          pdf_parse_failed: t.sn.pdfUnreadable,
          no_text_layer: t.sn.scannedPdf,
        }
        setError(codeMsg[json.error] ?? t.sn.extractError)
        return
      }
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
      // R12: validation `errors` (app-authored field messages from the review
      // workflow) still render; the backend `detail` (sanitized Postgres text)
      // never does.
      if (!res.ok) { setError((json.errors && json.errors.join(', ')) || t.sn.importError); return }
      setPreview(null); await load()
    } catch {
      setError(t.sn.importError)
    } finally { setBusy(false) }
  }

  const riskLabel = (s: string) => ({ safe: t.sn.riskSafe, watch: t.sn.riskWatch, breached: t.sn.riskBreached, autocallable: t.sn.riskAutocallable, called: t.sn.riskCalled, unavailable: t.sn.riskUnavailable }[s] ?? s)
  const isArchived = (n: StructuredNote) => ARCHIVED_STATUSES.includes(n.status)

  const issuers = [...new Set(notes.map((n) => n.issuerDisplayName).filter((x): x is string => !!x))].sort()

  const filtered = notes
    .filter((n) => (view === 'archived' ? isArchived(n) : !isArchived(n)))
    .filter((n) => issuerFilter === 'all' || n.issuerDisplayName === issuerFilter)
    .filter((n) => {
      if (statusFilter === 'all') return true
      const m = n.id ? metrics[n.id] : undefined
      return m?.riskStatus === statusFilter
    })

  const shown = [...filtered].sort((a, b) => {
    const ma = a.id ? metrics[a.id] : undefined
    const mb = b.id ? metrics[b.id] : undefined
    let cmp = 0
    if (sortKey === 'issued') cmp = (a.issueDate ?? a.tradeDate ?? '').localeCompare(b.issueDate ?? b.tradeDate ?? '')
    else if (sortKey === 'issuer') cmp = (a.issuerDisplayName ?? '').localeCompare(b.issuerDisplayName ?? '')
    else if (sortKey === 'status') cmp = (STATUS_RANK[ma?.riskStatus ?? 'unavailable'] ?? 9) - (STATUS_RANK[mb?.riskStatus ?? 'unavailable'] ?? 9)
    else if (sortKey === 'next') cmp = (ma?.nextObservationDate ?? '').localeCompare(mb?.nextObservationDate ?? '')
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'issuer' ? 'asc' : 'desc') }
  }
  function sortArrow(key: SortKey) {
    if (key !== sortKey) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }
  /** Jumps to Live and filters to one risk status (or clears the filter for "Live positions"). */
  function focusStatus(status: string | null) {
    setView('live')
    setStatusFilter(status ?? 'all')
  }

  // Fable NEXT OBSERVATION capsule — the earliest upcoming observation across
  // live notes, read straight off the per-note metrics the dashboard API
  // already returns (calculateNextObservation). Pure display aggregation.
  let nextObs: { date: string; days: number | null; note: StructuredNote } | null = null
  for (const n of notes) {
    if (isArchived(n) || !n.id) continue
    const m = metrics[n.id]
    if (!m?.nextObservationDate) continue
    if (!nextObs || m.nextObservationDate < nextObs.date) {
      nextObs = { date: m.nextObservationDate, days: m.daysToNextObservation, note: n }
    }
  }

  // Lifecycle legend — the Fable chip row (SPECS §6). Tooltip + sr-only text
  // carry the full legend sentences the pre-Fable paragraph showed.
  const legend: { status: string; label: string; tip: string }[] = [
    { status: 'safe', label: t.sn.riskSafe, tip: t.sn.legendSafe },
    { status: 'watch', label: t.sn.riskWatch, tip: t.sn.legendWatch },
    { status: 'autocallable', label: t.sn.riskAutocallable, tip: t.sn.legendAutocallable },
    { status: 'breached', label: t.sn.riskBreached, tip: t.sn.legendBreached },
    // R13.7B2.2 § 6 — the terminal state gets its own legend entry; it is not a
    // shade of "autocallable".
    { status: 'called', label: t.sn.riskCalled, tip: t.sn.legendCalled },
  ]

  const tableState = loading
    ? 'loading' as const
    // Denial is checked BEFORE failure: the two are mutually exclusive by
    // construction above, and ordering it first documents which one wins.
    : notAuthorized ? 'not_authorized' as const
    : loadFailed ? 'error' as const
    : shown.length === 0 ? 'empty' as const
    : undefined

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2.5 w-full no-print">
      {canManage && (
        <label className={`${PILL_PRIMARY} ${busy ? 'opacity-50 cursor-not-allowed' : ''} focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--nv-focus)]`}>
          <input ref={fileRef} type="file" accept="application/pdf" onChange={handleFile} className="sr-only" disabled={busy} aria-label={t.sn.upload} />
          {busy ? t.sn.extracting : t.sn.upload}
        </label>
      )}

      <ChipSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t.sn.filterStatus}>
        <option value="all">{t.sn.filterStatus}: {t.sn.filterAll}</option>
        <option value="safe">{t.sn.riskSafe}</option>
        <option value="watch">{t.sn.riskWatch}</option>
        <option value="autocallable">{t.sn.riskAutocallable}</option>
        <option value="breached">{t.sn.riskBreached}</option>
        <option value="called">{t.sn.riskCalled}</option>
        <option value="unavailable">{t.sn.riskUnavailable}</option>
      </ChipSelect>
      <ChipSelect value={issuerFilter} onChange={(e) => setIssuerFilter(e.target.value)} aria-label={t.sn.filterIssuer}>
        <option value="all">{t.sn.filterIssuer}: {t.sn.filterAll}</option>
        {issuers.map((iss) => <option key={iss} value={iss}>{iss}</option>)}
      </ChipSelect>

      <SegmentedControl
        className="ml-auto"
        options={[
          { value: 'live', label: `${t.sn.viewLive}${summary ? ` (${summary.activeNotes})` : ''}` },
          { value: 'archived', label: `${t.sn.viewArchived}${summary ? ` (${summary.calledNotes})` : ''}` },
        ]}
        value={view}
        onChange={setView}
        ariaLabel={t.sn.viewToggle}
        remeasureToken={`${summary?.activeNotes ?? 0}|${summary?.calledNotes ?? 0}|${lang}`}
      />
    </div>
  )

  const thBase = 'py-2.5 px-2 first:pl-4 last:pr-4 border-b border-border ui-table-header text-muted-fg whitespace-nowrap align-bottom'
  // Two-line variant for the two headers whose single-line width would force
  // the whole column wide ("Dist. to barrier", "Coupon p.a.") — utilities
  // override ui-table-header's own nowrap.
  const thBaseWrap = 'py-2.5 px-2 first:pl-4 last:pr-4 border-b border-border ui-table-header text-muted-fg whitespace-normal leading-tight align-bottom'
  const thBg = { backgroundColor: 'var(--surface-table)' } as const
  const cellPad = 'py-2.5 px-2 first:pl-4 last:pr-4'

  // R3 table-density repair — deliberate column system (table-layout: fixed +
  // <colgroup>) so every column fits a maximized 1728px desktop with no
  // internal horizontal scrollbar, while narrower viewports keep the same
  // card-contained scroll (the wrapper min-width is this system's sum).
  // Status is wider in Spanish ("Cerca de la barrera"); the archived view's
  // "Archived as of" header needs a little more than "Next obs.".
  const COLS: number[] = [
    lang === 'es' ? 150 : 118,       // status (risk pill)
    view === 'archived' ? 130 : 120, // next obs / archived as of
    160,                             // note (truncated; full text via hover title)
    80,                              // issuer (truncated; full name via hover title)
    160,                             // level gauge (140px track + px-2 padding)
    85,                              // dist. to barrier (2-line header)
    110,                             // worst (short ticker + % fits; % never truncates)
    80,                              // coupon p.a. (2-line header)
    75,                              // knock-in
    85,                              // issued
    100,                             // notional
    80,                              // called
    56,                              // R7.1B actions (trash) — far right
  ]

  return (
    <div className="w-full">
      <Reveal>
        <PageHeader
          title={t.sn.tag}
          metadata={
            <>
              <span>{t.sn.pageMeta}</span>
              {summary && summary.totalNotes > 0 && (
                <span className="ui-number">
                  {summary.activeNotes} {t.sn.viewLive} · {summary.calledNotes} {t.sn.viewArchived}
                </span>
              )}
            </>
          }
          actions={
            <ChipButton onClick={refresh} disabled={refreshing} title={t.sn.update}>
              <span aria-hidden>↻</span> {refreshing ? t.sn.updating : t.sn.update}
            </ChipButton>
          }
        />
      </Reveal>

      {/* Capsule row — Fable §6, carrying every existing NMI dashboard KPI.
          Click a status capsule to jump to Live filtered to it. */}
      {summary && summary.totalNotes > 0 && (
        <Reveal delayMs={70}>
          <div className="grid gap-3 mb-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <StatCapsule label={t.sn.dashLive} value={String(summary.activeNotes)} onClick={() => focusStatus(null)} />
            <StatCapsule label={t.sn.dashSafe} value={String(summary.safeNotes)} tone="var(--positive)" title={t.sn.legendSafe} onClick={() => focusStatus('safe')} />
            <StatCapsule label={t.sn.dashWatch} value={String(summary.watchNotes)} tone="var(--warning)" title={t.sn.legendWatch} onClick={() => focusStatus('watch')} />
            <StatCapsule label={t.sn.dashAutocallable} value={String(summary.autocallableNotes)} tone="var(--accent)" title={t.sn.legendAutocallable} onClick={() => focusStatus('autocallable')} />
            <StatCapsule label={t.sn.dashBreached} value={String(summary.breachedNotes)} tone={summary.breachedNotes > 0 ? 'var(--negative)' : undefined} title={t.sn.legendBreached} onClick={() => focusStatus('breached')} />
            <StatCapsule label={t.sn.dashCalled} value={String(summary.calledNotes)} onClick={() => setView('archived')} />
            <StatCapsule label={t.sn.dashNotional} value={`${summary.currency} ${fmtNum(summary.totalCurrentNotional)}`} masked={masked} />
            <StatCapsule
              label={t.sn.dashNextObs}
              value={nextObs ? `${nextObs.date}${nextObs.days != null ? ` (${nextObs.days}d)` : ''}` : '—'}
              sub={nextObs?.note.productName}
            />
          </div>
        </Reveal>
      )}

      {/* Exposure cards — R3 repair: same data and exact values, recomposed in
          the Fable card language (shared TOTAL header, ranked accent bars,
          gapped donut with center total and hover-linked legend). */}
      {summary && (summary.issuerExposure.length > 0 || summary.entityExposure.length > 0) && (
        <Reveal delayMs={70}>
          {/* R7.1B.1 layout — the two ranked lists were eating a full row each
              while the allocation donut, the more decision-useful view, was
              squeezed into a third. They now STACK in a narrower left column
              (issuer above custodian) with the donut beside them at lg+ and
              given the larger share of the width; below lg everything falls
              into one column in the same reading order. */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-3.5 mb-3.5">
            <div className="flex flex-col gap-3.5 min-w-0">
              {summary.issuerExposure.length > 0 && (
                <GlassSurface variant="card" as="section" className="px-5 py-4">
                  <ExposureHeader
                    title={t.sn.exposureByIssuer}
                    totalLabel={t.sn.totalLabel}
                    currency={summary.currency}
                    total={summary.issuerExposure.reduce((s, e) => s + (Number.isFinite(e.notional) ? e.notional : 0), 0)}
                    masked={masked}
                  />
                  <BarChart data={summary.issuerExposure.map((e) => ({ label: e.issuer, value: e.notional }))} currency={summary.currency} ofTotal={t.sn.ofTotal} masked={masked} />
                </GlassSurface>
              )}
              {/* R7.1B — Exposure by Custodian, directly below Exposure by
                  Issuer and in the SAME visual language (the shared BarChart,
                  so the issuer card is untouched and the two can never drift).
                  Each note contributes its whole Nevada position to its own
                  custodian; issue size is never involved. Notes with no
                  recorded custodian stay in the total under "Custodian
                  unavailable" — never dropped, never re-attributed. */}
              {summary.custodianExposure.length > 0 && (
                <GlassSurface variant="card" as="section" className="px-5 py-4">
                  <ExposureHeader
                    title={t.sn.exposureByCustodian}
                    totalLabel={t.sn.totalLabel}
                    currency={summary.currency}
                    total={summary.custodianExposure.reduce((s, e) => s + (Number.isFinite(e.notional) ? e.notional : 0), 0)}
                    masked={masked}
                  />
                  <BarChart
                    data={summary.custodianExposure.map((e) => ({ label: e.custodian ?? t.sn.custodianUnavailable, value: e.notional }))}
                    currency={summary.currency}
                    ofTotal={t.sn.ofTotal}
                    masked={masked}
                  />
                </GlassSurface>
              )}
            </div>
            {summary.entityExposure.length > 0 && (
              <GlassSurface variant="card" as="section" className="px-5 py-4 min-w-0">
                <ExposureHeader
                  title={t.sn.exposureByEntity}
                  totalLabel={t.sn.totalLabel}
                  currency={summary.currency}
                  total={summary.entityExposure.reduce((s, e) => s + (Number.isFinite(e.notional) && e.notional > 0 ? e.notional : 0), 0)}
                  masked={masked}
                />
                <Donut data={summary.entityExposure.map((e) => ({ label: e.entityName, value: e.notional }))} currency={summary.currency} ofTotal={t.sn.ofTotal} totalLabel={t.sn.totalLabel} masked={masked} />
              </GlassSurface>
            )}
          </div>
        </Reveal>
      )}

      {/* Scheduled monitoring warnings — the Update button stays an immediate
          on-demand refresh; this line reports only actionable exceptions from
          the automated background job. The source/as-of itself lives in the
          table footer below. */}
      {monitoring && (monitoring.staleNoteCount > 0 || monitoring.unsupportedUnderlyingCount > 0
        || monitoring.dueSoonCount > 0 || monitoring.reviewRequiredCount > 0
        || monitoring.fallbackProviderUsed || monitoring.providerDisagreement) && (
        <div className="mb-4 text-xs text-muted-fg flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
          {monitoring.staleNoteCount > 0 && <span className="text-warning">{monitoring.staleNoteCount} {t.sn.monitoring.stale}</span>}
          {monitoring.unsupportedUnderlyingCount > 0 && <span className="text-warning">{monitoring.unsupportedUnderlyingCount} {t.sn.monitoring.unsupported}</span>}
          {monitoring.dueSoonCount > 0 && <span style={{ color: 'var(--accent)' }}>{monitoring.dueSoonCount} {t.sn.monitoring.dueSoon}</span>}
          {monitoring.reviewRequiredCount > 0 && <span className="text-negative">{monitoring.reviewRequiredCount} {t.sn.monitoring.reviewRequired}</span>}
          {monitoring.fallbackProviderUsed && <span style={{ color: 'var(--accent)' }}>{t.sn.monitoring.fallbackUsed}</span>}
          {monitoring.providerDisagreement && <span className="text-warning">{t.sn.monitoring.providerDisagreement}</span>}
        </div>
      )}

      {error && <div className="mb-4 text-sm text-negative" role="alert">{error}</div>}
      {calledError && <div className="mb-4 text-xs text-negative" role="alert">{t.sn.saveError}</div>}

      {/* Extraction preview — Fable glass card + confidence pill */}
      {preview && (
        <Pop className="mb-5">
          <GlassSurface variant="card" as="section" className="px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="ui-label text-foreground">{t.sn.review}</h2>
              <span className="inline-flex items-center h-7 px-3 rounded-full text-xs font-medium"
                style={{ color: REVIEW_STATE_TONE[preview.reviewState], backgroundColor: `color-mix(in oklab, ${REVIEW_STATE_TONE[preview.reviewState]} 12%, var(--surface))` }}>
                {t.sn.confidence}: {Math.round(preview.confidenceScore * 100)}% · {t.sn.reviewState[preview.reviewState]}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
              <Field label={t.sn.colIsin} value={preview.note.isin} mono />
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
            <div className="flex flex-wrap gap-2">
              <button onClick={handleImport} disabled={busy || preview.errors.length > 0} className={`${PILL_PRIMARY} disabled:opacity-50 disabled:cursor-not-allowed`}>
                {t.sn.importNote}
              </button>
              <ChipButton onClick={() => setPreview(null)}>{t.sn.cancel}</ChipButton>
            </div>
          </GlassSurface>
        </Pop>
      )}

      {/* Lifecycle legend chips (Fable §6) + positions table */}
      <Reveal delayMs={130}>
        <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label={t.sn.riskStatus}>
          <span className="ui-label text-muted-fg mr-1">{t.sn.riskStatus}</span>
          {legend.map((l) => (
            <span
              key={l.status}
              title={l.tip}
              className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium whitespace-nowrap"
              style={{ color: RISK_TONE[l.status], backgroundColor: `color-mix(in oklab, ${RISK_TONE[l.status]} 12%, var(--surface))` }}
            >
              {l.label}
              <span className="sr-only"> — {l.tip}</span>
            </span>
          ))}
          <span className="flex-1" aria-hidden="true" />
          <span className="ui-meta text-muted-fg">{t.sn.clickHint}</span>
        </div>

        <TableCard
          minWidth={COLS.reduce((a, b) => a + b, 0)}
          controls={toolbar}
          state={tableState}
          stateMessage={tableState === 'empty' ? t.sn.empty : undefined}
          footer={<TableSourceFooter source={t.sn.sourceMarket} asOf={summary?.pricesAsOf ?? null} />}
        >
          <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)', tableLayout: 'fixed' }}>
            <caption className="sr-only">{t.sn.tag}</caption>
            <colgroup>
              {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            {/* R3 repair — triage-first column order: lifecycle status and the
                next observation lead so they are visible before any horizontal
                scroll; note identity and barrier context follow; the
                administrative Called checkbox moves to the end. */}
            <thead>
              <tr>
                <SortableHeader label={t.sn.colStatus} sortTitle={t.sn.sortBy} active={sortKey === 'status'} arrow={sortArrow('status')} onClick={() => toggleSort('status')} dir={sortDir} />
                {view === 'archived'
                  ? <th scope="col" className={`${thBase} text-center`} style={thBg}>{t.sn.colArchivedAt}</th>
                  : <SortableHeader label={t.sn.colNext} sortTitle={t.sn.sortBy} active={sortKey === 'next'} arrow={sortArrow('next')} onClick={() => toggleSort('next')} dir={sortDir} align="center" />}
                <th scope="col" className={`${thBase} text-left`} style={thBg}>{t.sn.colNote}</th>
                <SortableHeader label={t.sn.colIssuer} sortTitle={t.sn.sortBy} active={sortKey === 'issuer'} arrow={sortArrow('issuer')} onClick={() => toggleSort('issuer')} dir={sortDir} align="center" />
                <th scope="col" className={`${thBase} text-center`} style={thBg}>{t.sn.colLevel}</th>
                <th scope="col" className={`${thBaseWrap} text-center`} style={thBg}>{t.sn.colDistance}</th>
                <th scope="col" className={`${thBase} text-center`} style={thBg}>{t.sn.colWorst}</th>
                <th scope="col" className={`${thBaseWrap} text-center`} style={thBg}>{t.sn.colCoupon}</th>
                <th scope="col" className={`${thBase} text-center`} style={thBg}>{t.sn.colKnockIn}</th>
                <SortableHeader label={t.sn.colIssued} sortTitle={t.sn.sortBy} active={sortKey === 'issued'} arrow={sortArrow('issued')} onClick={() => toggleSort('issued')} dir={sortDir} align="center" />
                <th scope="col" className={`${thBase} text-center`} style={thBg}>{t.sn.colNotional}</th>
                <th scope="col" className={`${thBase} text-center no-print`} style={thBg}>{t.sn.colCalled}</th>
                {/* R7.1B — far-right Actions column. The header word is
                    visually hidden: the column holds one icon-only control
                    whose own accessible name identifies the note. */}
                <th scope="col" className={`${thBase} text-center no-print`} style={thBg}>
                  <span className="sr-only">{t.sn.colActions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((n) => {
                const m = n.id ? metrics[n.id] : undefined
                const nearObs = m?.daysToNextObservation != null && m.daysToNextObservation <= 7 && m.daysToNextObservation >= 0
                const perf = m?.worstPerformer?.performance ?? null
                // Worst-of level indexed to 100 at strike — the Fable gauge's
                // own scale, a pure display transform of the existing
                // worstPerformer.performance (current/initial − 1).
                const gaugeLevel = perf !== null ? (1 + perf) * 100 : null
                const gaugeMarks: BarrierMark[] = [
                  ...(n.knockInBarrierPct != null ? [{ kind: 'knockIn' as const, level: n.knockInBarrierPct * 100 }] : []),
                  { kind: 'strike' as const, level: 100 },
                ]
                // Full identifier line for the width-capped NOTE cell's hover
                // reveal — the same content the visible (truncated) line shows.
                const noteSub = [n.isin, n.underlyings.map((u) => u.underlyingName).join(' / ')].filter(Boolean).join(' · ')
                return (
                  <tr
                    key={n.id}
                    className="border-b border-border last:border-0 nv-row-hover nv-transition cursor-pointer"
                    onClick={(e) => {
                      // Row-level navigation (Fable "row → full terms") to the
                      // CANONICAL detail route — interactive cells opt out.
                      if ((e.target as HTMLElement).closest('a, button, input, label')) return
                      if (n.id) router.push(`/structured-notes/${n.id}`)
                    }}
                  >
                    <td className={cellPad}>
                      {m
                        ? <span className="inline-flex items-center h-6 px-2.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ color: RISK_TONE[m.riskStatus], backgroundColor: `color-mix(in oklab, ${RISK_TONE[m.riskStatus]} 12%, var(--surface))` }}>{riskLabel(m.riskStatus)}</span>
                        : <StatusPill status={n.status} />}
                    </td>
                    {view === 'archived' ? (
                      <td className={`${cellPad} text-center ui-number text-foreground`}>{n.archivedAt ? new Date(n.archivedAt).toLocaleDateString() : '—'}</td>
                    ) : (
                      <td className={`${cellPad} text-center ui-number whitespace-nowrap`}>
                        {m?.nextObservationDate ? (
                          <span className={nearObs ? 'inline-block px-1 py-0.5 rounded' : 'text-foreground'} style={nearObs ? { color: 'var(--negative)', backgroundColor: 'color-mix(in oklab, var(--negative) 14%, var(--surface))', border: '1px solid var(--negative)' } : undefined}>
                            {m.nextObservationDate}{m.daysToNextObservation != null ? ` (${m.daysToNextObservation}d)` : ''}
                          </span>
                        ) : '—'}
                      </td>
                    )}
                    <td className={cellPad}>
                      <Link href={`/structured-notes/${n.id}`} title={n.productName || n.isin || undefined} className="block font-medium text-foreground hover:underline truncate">
                        {n.productName || n.isin || '—'}
                      </Link>
                      <span className="block ui-meta text-muted-fg mt-0.5 truncate" title={noteSub || undefined}>
                        {n.isin && <span className="font-mono">{n.isin}</span>}
                        {n.isin && n.underlyings.length > 0 && ' · '}
                        {n.underlyings.map((u) => shortUnderlying(u.underlyingName)).join(' / ')}
                      </span>
                    </td>
                    <td className={`${cellPad} text-center`}>
                      <span className="block truncate text-foreground" title={n.issuerDisplayName ?? undefined}>{n.issuerDisplayName ?? '—'}</span>
                    </td>
                    <td className={`${cellPad} text-center`}>
                      <BarrierGauge
                        current={gaugeLevel}
                        marks={gaugeMarks}
                        width={140}
                        height={18}
                        summary={gaugeLevel !== null ? `${t.fable.barrier.current} ${gaugeLevel.toFixed(1)}` : undefined}
                      />
                    </td>
                    <td className={`${cellPad} text-center ui-number font-medium`} style={{ color: distanceTone(m?.minDistanceToCouponBarrier) }}>
                      {m ? fmtPct(m.minDistanceToCouponBarrier) : '—'}
                    </td>
                    <td className={`${cellPad} text-center`}>
                      {m?.worstPerformer ? (
                        <span className="inline-flex max-w-full items-baseline justify-center gap-1">
                          <span className="truncate text-foreground" title={m.worstPerformer.underlyingName}>{shortUnderlying(m.worstPerformer.underlyingName)}</span>
                          <span className="ui-number shrink-0" style={{ color: perf !== null && perf < 0 ? 'var(--negative)' : 'var(--positive)' }}>{fmtPct(perf)}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className={`${cellPad} text-center ui-number text-foreground`}>{fmtPct(n.couponRateAnnualized)}</td>
                    <td className={`${cellPad} text-center ui-number text-foreground`}>{fmtPct(n.knockInBarrierPct)}</td>
                    <td className={`${cellPad} text-center ui-number text-foreground`}>{n.issueDate ?? n.tradeDate ?? '—'}</td>
                    <td className={`${cellPad} text-center ui-number text-foreground`}>
                      {/* R11: per-note notional is the same private amount as
                          the book total — masked, and the `title` duplicate
                          removed (a tooltip would leak the raw value). */}
                      <PrivacyValue masked={masked} className="block">
                        {/* R12: a missing metric renders '—', never a
                            fabricated "USD 0". */}
                        <span className="block truncate">{m ? `${n.currency} ${fmtNum(m.currentNotional)}` : '—'}</span>
                      </PrivacyValue>
                    </td>
                    <td className={`${cellPad} text-center no-print`}>
                      <input type="checkbox" checked={isArchived(n)} disabled={calledBusy || !canManage} onChange={(e) => n.id && setCalled(n.id, e.target.checked)} title={t.sn.dashCalled} aria-label={`${t.sn.colCalled}: ${n.productName}`} />
                    </td>
                    {/* R7.1B — icon-only delete trigger. It is a real <button>,
                        so the row's own click handler skips it (interactive
                        cells opt out) and it can never navigate; it only opens
                        the shared confirmation. 32px touch target, localized
                        accessible name naming the note, tooltip, and the
                        global focus-visible ring. */}
                    <td className={`${cellPad} text-center no-print`}>
                      {canManage && (
                      <button
                        type="button"
                        onClick={() => { setDeleteFailed(false); setPendingDelete(n) }}
                        disabled={deleting}
                        title={t.sn.delete}
                        aria-label={`${t.sn.delete}: ${n.productName || n.isin || ''}`}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full cursor-pointer nv-transition hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ color: 'var(--negative)' }}
                      >
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h12M8.5 6V4.5h3V6M6 6l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L14 6M8.7 9v4.3M11.3 9v4.3" />
                        </svg>
                      </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      </Reveal>

      {/* R7.1B — the SAME shared destructive-confirmation component the detail
          page uses (ModalShell alertdialog: focus trap, Escape cancels unless
          pending, scroll lock, focus restored to the trash trigger,
          confirm-at-most-once). The description names the real record —
          product, ISIN, issuer, allocation count — built only from values
          already on this payload. R12: the Nevada notional was REMOVED from
          the description — it is a documented private amount and the dialog
          rendered it raw regardless of Privacy Mode; the remaining fields
          identify the record unambiguously without disclosing an amount.
          Deletion is permanent (hard delete), which is what the confirmation
          says. */}
      <DestructiveConfirm
        open={pendingDelete !== null}
        title={t.sn.delete}
        description={pendingDelete ? [
          pendingDelete.productName,
          pendingDelete.isin,
          pendingDelete.issuerDisplayName,
          `${pendingDelete.allocations.filter((a) => a.active).length} ${t.sn.accountAllocations}`,
        ].filter(Boolean).join(' · ') : undefined}
        confirmLabel={deleting ? t.sn.deleting : t.sn.delete}
        cancelLabel={t.sn.cancel}
        pending={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDeleteNote}
      >
        <p className="text-sm text-foreground">{t.sn.confirmDelete}</p>
        {deleting && <p className="sr-only" role="status">{t.sn.deleting}</p>}
        {deleteFailed && <p className="mt-2 text-xs text-negative" role="alert">{t.sn.deleteError}</p>}
      </DestructiveConfirm>
    </div>
  )
}

// ── Small presentational helpers ────────────────────────────────────────────────

function Field({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="ui-micro-label text-muted-fg">{label}</div>
      <div className={`text-foreground ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
    </div>
  )
}

/**
 * Fable KPI capsule (nv-glass-kpi tier) — label, value, optional sub. The
 * clickable form is a real `<button>` (the existing click-to-filter behavior);
 * hover is conveyed by the border, focus by the global :focus-visible ring.
 * Status tone colors the value only — the label text always names the status,
 * so meaning is never carried by color alone.
 */
function StatCapsule({ label, value, sub, tone, title, onClick, masked }: {
  label: string; value: string; sub?: string; tone?: string; title?: string; onClick?: () => void
  /** R11: private amounts (the Nevada notional) route through the shared
   *  PrivacyValue boundary, exactly as Home already does for this same figure. */
  masked?: boolean
}) {
  const inner = (
    <>
      <span className="ui-label text-muted-fg">{label}</span>
      {masked === undefined ? (
        <span className="ui-capsule-value ui-number" style={{ color: tone ?? 'var(--foreground)' }}>{value}</span>
      ) : (
        <PrivacyValue masked={masked} className="ui-capsule-value">
          <span className="ui-capsule-value ui-number" style={{ color: tone ?? 'var(--foreground)' }}>{value}</span>
        </PrivacyValue>
      )}
      {sub && <span className="ui-meta text-muted-fg truncate max-w-full" title={sub}>{sub}</span>}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className="nv-glass-kpi p-3 flex flex-col items-start gap-1 text-left cursor-pointer nv-transition hover:border-accent">
      {inner}
    </button>
  ) : (
    <GlassSurface variant="kpi" className="p-3 flex flex-col items-start gap-1">
      {inner}
    </GlassSurface>
  )
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'active' ? 'var(--positive)' : status === 'autocalled' ? 'var(--accent)' : status === 'defaulted' ? 'var(--negative)' : 'var(--muted-fg)'
  return <span className="inline-flex items-center h-6 px-2.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ color, backgroundColor: `color-mix(in oklab, ${color} 12%, var(--surface))` }}>{status}</span>
}

/** Clickable table header with an active sort-direction arrow + aria-sort. */
function SortableHeader({ label, sortTitle, active, arrow, onClick, dir, align = 'left' }: {
  label: string; sortTitle: string; active: boolean; arrow: string; onClick: () => void; dir: 'asc' | 'desc'; align?: 'left' | 'center'
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`py-2.5 px-2 first:pl-4 last:pr-4 border-b border-border align-bottom ${align === 'center' ? 'text-center' : 'text-left'}`}
      style={{ backgroundColor: 'var(--surface-table)' }}
    >
      <button
        type="button"
        onClick={onClick}
        title={`${sortTitle} ${label}`}
        className={`no-print ui-table-header nv-transition inline-flex items-center gap-1 whitespace-nowrap select-none ${active ? 'text-foreground' : 'text-muted-fg hover:text-foreground'}`}
      >
        {label}
        {arrow && <span aria-hidden="true">{arrow}</span>}
      </button>
    </th>
  )
}

/**
 * Shared Fable header for the two exposure cards — the ui-label title on the
 * left, the card's TOTAL anchored right (mirroring the capsule label/value
 * pattern so both cards read as the same family).
 */
function ExposureHeader({ title, totalLabel, currency, total, masked }: { title: string; totalLabel: string; currency: string; total: number; masked: boolean }) {
  // R12: this total IS the book's Nevada notional (the issuer/custodian/entity
  // exposures are decompositions of it) — one of the six documented private
  // amounts, so it routes through the same PrivacyValue boundary as the KPI
  // capsule above it. Percent shares stay visible (proportion, not size).
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h2 className="ui-label text-muted-fg">{title}</h2>
      <span className="whitespace-nowrap">
        <span className="ui-micro-label text-muted-fg mr-1.5">{totalLabel}</span>
        <span className="text-xs ui-number font-medium text-foreground">
          <PrivacyValue masked={masked}>{`${currency} ${fmtNum(total)}`}</PrivacyValue>
        </span>
      </span>
    </div>
  )
}

/**
 * Fable ranked exposure list (R3 repair) — issuer name + share over a thin
 * uniform accent fill on the chip track. One fill color on purpose: the old
 * per-issuer palette colors falsely implied a color link with the entity
 * donut. Bar widths are relative to the LARGEST exposure (comparative read);
 * the exact notional and % of total stay printed on every row, so hover
 * emphasis (nv-row-hover) is optional, never load-bearing. No chart library.
 */
function BarChart({ data, currency, ofTotal, masked }: { data: { label: string; value: number }[]; currency: string; ofTotal: string; masked: boolean }) {
  const rows = [...data].sort((a, b) => b.value - a.value)
  const total = rows.reduce((s, d) => s + (Number.isFinite(d.value) ? d.value : 0), 0)
  const max = Math.max(1, ...rows.map((d) => d.value))
  return (
    <div className="space-y-1">
      {rows.map((d) => {
        const pct = total > 0 ? (d.value / total) * 100 : 0
        return (
          <div key={d.label} className="text-xs rounded-lg px-2 py-1.5 -mx-2 nv-row-hover nv-transition">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-foreground font-medium truncate" title={d.label}>{d.label}</span>
              <span className="whitespace-nowrap ui-number">
                {/* Percent share stays visible (proportion, not size); the
                    amount is a slice of the masked book notional (R12). */}
                <span className="text-foreground font-medium">{pct.toFixed(1)}%</span>
                <span className="text-muted-fg"> {ofTotal} · <PrivacyValue masked={masked}>{`${currency} ${fmtNum(d.value)}`}</PrivacyValue></span>
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--nv-chip)' }}>
              <div className="h-full rounded-full nv-transition-state" style={{ width: `${(d.value / max) * 100}%`, backgroundColor: 'var(--accent)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Fable allocation donut (R3 repair) — descending gapped segments, center
 * TOTAL, and a hover-linked legend: entering a legend row or a segment dims
 * the others (opacity only, via nv-transition — reduced-motion safe). Every
 * value and share stays printed in the legend, so the hover emphasis is
 * optional, never load-bearing; the truncated center total repeats the exact
 * figure already shown in the card header. No chart library (SVG only).
 */
function Donut({ data, currency, ofTotal, totalLabel, masked }: { data: { label: string; value: number }[]; currency: string; ofTotal: string; totalLabel: string; masked: boolean }) {
  const [hi, setHi] = useState<string | null>(null)
  const total = data.reduce((s, d) => s + (Number.isFinite(d.value) && d.value > 0 ? d.value : 0), 0)
  const r = 42
  const C = 2 * Math.PI * r
  const positive = data.filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
  // Gap between segments (skipped for a single full-circle segment); tiny
  // allocations keep a minimum visible sliver rather than vanishing.
  const gap = positive.length > 1 ? 1.6 : 0
  // Prefix-sum of preceding fractions gives each segment's start offset (no mutation).
  const segs = positive.map((d, i) => {
    const frac = total > 0 ? d.value / total : 0
    const precedingFrac = positive.slice(0, i).reduce((s, p) => s + (total > 0 ? p.value / total : 0), 0)
    return { label: d.label, value: d.value, frac, dash: Math.max(frac * C - gap, 0.9), offset: precedingFrac * C, color: CHART_PALETTE[i % CHART_PALETTE.length] }
  })
  return (
    // R7.1A — container-query composition (Tailwind v4 native @container).
    // The donut + legend go side by side ONLY when this card itself is at
    // least @lg (32rem) wide; below that the chart stacks above a full-width
    // legend. A viewport breakpoint cannot express this: the exposure cards
    // sit in a wrapping two-up row, so a card is ~340px wide at tablet
    // widths (where side-by-side overflowed the card) yet ~590px on a phone
    // in the single-column stack (where side-by-side fits). The base styles
    // are the stacked composition, so an engine without container-query
    // support degrades to the mobile-safe layout, never the overflowing one.
    <div className="@container">
      <div className="flex flex-col items-center gap-4 @lg:flex-row @lg:gap-6">
      {/* R7.1B.1 — the allocation chart carries the wider column now, so the
          donut is drawn larger (its center total gets more room too). */}
      <div className="relative w-52 h-52 @lg:w-60 @lg:h-60 shrink-0">
        {total > 0 ? (
          <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
            {segs.map((s) => (
              <circle key={s.label} cx="50" cy="50" r={r} fill="none" strokeWidth="14" stroke={s.color}
                className="nv-transition" opacity={hi && hi !== s.label ? 0.3 : 1}
                strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={-s.offset}
                onMouseEnter={() => setHi(s.label)} onMouseLeave={() => setHi(null)} />
            ))}
          </svg>
        ) : (
          <div className="w-full h-full rounded-full border-8 border-border" />
        )}
        {total > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-7">
            <span className="ui-micro-label text-muted-fg">{totalLabel}</span>
            {/* R12: the center total is the masked book notional — no raw
                value in text OR in a title tooltip while masked. */}
            <span className="text-sm font-semibold ui-number text-foreground max-w-full truncate" title={masked ? undefined : `${currency} ${fmtNum(total)}`}>
              <PrivacyValue masked={masked}>{fmtNum(total)}</PrivacyValue>
            </span>
            <span className="ui-meta text-muted-fg">{currency}</span>
          </div>
        )}
      </div>
      {/* R7.1A — the legend takes the full card width when stacked, and each
          row wraps instead of overflowing: the entity name is the flexible
          part (truncate + title keep the full identity accessible) and the
          numeric block is two atomic nowrap units — "12,3% of total" and
          "· USD 1.234.567" — that drop to a right-aligned second line when
          the row is too narrow, so an amount can never leave the card and
          never needs a nested scrollbar. */}
      <div className="w-full text-xs space-y-0.5 min-w-0 @lg:flex-1">
        {segs.map((s) => (
          <div
            key={s.label}
            className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 -mx-2 nv-row-hover nv-transition ${hi && hi !== s.label ? 'opacity-50' : ''}`}
            onMouseEnter={() => setHi(s.label)}
            onMouseLeave={() => setHi(null)}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-foreground truncate min-w-0 flex-1 basis-24" title={s.label}>{s.label}</span>
            <span className="ui-number ml-auto flex flex-wrap justify-end gap-x-1 text-right">
              <span className="text-foreground font-medium whitespace-nowrap">
                {(s.frac * 100).toFixed(1)}%<span className="text-muted-fg font-normal"> {ofTotal}</span>
              </span>
              {/* Amount masked (R12); the share stays — proportion, not size. */}
              <span className="text-muted-fg whitespace-nowrap">· <PrivacyValue masked={masked}>{`${currency} ${fmtNum(s.value)}`}</PrivacyValue></span>
            </span>
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}

// R4 — the detail page reuses these display helpers and the KPI capsule so
// the two Structured Notes surfaces can never drift apart (same precedent as
// the pre-R4 fmtPct/fmtNum share). Display-only exports; no logic change.
export { fmtPct, fmtNum, distanceTone, shortUnderlying, StatCapsule, RISK_TONE }
