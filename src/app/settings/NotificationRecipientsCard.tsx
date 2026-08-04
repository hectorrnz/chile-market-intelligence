'use client'

// R9.4 — the notification-recipient workflow, integrated into the canonical
// Settings page as the full-width third Fable row.
//
// STRUCTURAL AUTHORITY: Fable Administration's Audit History slot
// (standalone-html/nevada-frontend.html:1050–1067) — one full-width card, a
// compact uppercase section label, a near-opaque table material, dense rows,
// card-level horizontal overflow, and a bordered footer note. `TableCard`
// already is that anatomy, so this file composes it rather than re-deriving it.
//
// It lives beside the composition rather than inside it because this is the one
// mutation-heavy surface on the page: three server operations, per-row pending
// state, a confirmation gate and a feedback region would otherwise obscure the
// read-only Account/Data-sources/Security/Display cards.
//
// ── WHAT THIS PHASE REPAIRED ───────────────────────────────────────────────
// The legacy page shipped three dishonest mutation behaviours. All are fixed
// here, with the SERVER CONTRACT COMPLETELY UNCHANGED — same four endpoints,
// same methods, same payloads, same validation, same RLS, same shared-trust
// model. Only the client's honesty about what actually happened changed:
//
//   · Load — a failed GET fell through `Array.isArray(...) ? ... : []` and
//     rendered the empty state, so "we could not reach the server" and "you
//     have no recipients" were indistinguishable. Now three explicit states.
//   · Toggle — `.catch(() => {})` swallowed every failure, leaving the row
//     showing a state the server had rejected until the next reload. Now the
//     optimistic update rolls back, scoped to the one affected recipient.
//   · Delete — the row was removed from the list BEFORE the request, again
//     behind `.catch(() => {})`, so a failed delete looked like a success. Now
//     the row is removed only after a confirmed response, behind a real
//     confirmation dialog rather than no confirmation at all.
//
// ── R9.5 AUDIT REPAIRS ─────────────────────────────────────────────────────
// Two defects the R9.5 consolidation audit demonstrated, both repaired here
// without touching a shared primitive:
//
//   · Focus after a confirmed removal — `ModalShell` restores focus to the
//     control that opened the dialog, but on SUCCESS that control is the
//     deleted row's Remove chip, which unmounts with its row. Focusing a
//     detached node is a no-op, so focus fell to `<body>` and a keyboard user
//     was dropped at the top of the document. Focus now lands on this section.
//   · Naming the destructive target at narrow widths — an email address is one
//     unbreakable token, and the dialog clips (`overflow-hidden`) rather than
//     scrolls, so a long address could be cut off at 320–390px in the one place
//     that has to say exactly what is about to be deleted. It now wraps, the
//     same way the table cell already did.

import { useEffect, useId, useRef, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { TableCard } from '@/components/fable/TableCard'
import { ChipButton } from '@/components/fable/Chip'
import { Switch } from '@/components/fable/Switch'
import { DestructiveConfirm } from '@/components/fable/ModalShell'

/** Exactly the shape `GET /api/notification-recipients` already returns. */
interface Recipient {
  id: string
  email: string
  label: string | null
  active: boolean
  createdAt: string
}

type LoadState = 'loading' | 'ready' | 'error'

/**
 * One coherent feedback area for the whole section. `scope` exists only so the
 * email field can mark itself invalid for an ADD error and not for an unrelated
 * row failure.
 */
type Feedback = { tone: 'error' | 'success'; message: string; scope: 'add' | 'row' } | null

const ENDPOINT = '/api/notification-recipients'

/**
 * A unique-violation on `notification_recipients.email` (citext NOT NULL
 * UNIQUE) surfaces as the route's sanitized Postgres message. We CLASSIFY it to
 * pick a localized sentence — the server's own text is never rendered.
 */
const DUPLICATE_ERROR = /duplicate key|unique constraint|already exists/i

/** The Fable chip/input material, matching the recipe the Watchlist form established. */
const FIELD =
  'h-8 w-full rounded-[var(--radius-input)] border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] px-3 text-xs text-foreground placeholder:text-muted-fg focus:border-accent nv-transition'

/** Reads a JSON body without letting a non-JSON error page become an unhandled throw. */
async function readJson(res: Response): Promise<{ error?: string }> {
  try {
    return (await res.json()) as { error?: string }
  } catch {
    // A 5xx HTML body is still a handled failure — the caller branches on res.ok.
    return {}
  }
}

export function NotificationRecipientsCard() {
  const { t } = useLang()
  const n = t.notifications.settings

  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  /** Keyed by recipient id — one row's in-flight request never disables another. */
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [confirming, setConfirming] = useState<Recipient | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  /**
   * R9.5 — bumped ONLY by a server-confirmed removal, so the focus repair below
   * can never fire for a cancelled or failed delete (where the Remove control
   * still exists and `ModalShell`'s own restoration is correct).
   */
  const [removedSeq, setRemovedSeq] = useState(0)

  const sectionRef = useRef<HTMLElement>(null)
  const emailId = useId()
  const labelId = useId()
  const errorId = useId()
  const noteId = useId()

  // Initial load. A failure is its own state — never the empty state, and never
  // a stale success claim.
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: 'no-store', signal: controller.signal })
        if (!res.ok) throw new Error('load_failed')
        const json = (await res.json()) as { recipients?: unknown }
        if (controller.signal.aborted) return
        setRecipients(Array.isArray(json.recipients) ? (json.recipients as Recipient[]) : [])
        setLoadState('ready')
      } catch {
        if (!controller.signal.aborted) setLoadState('error')
      }
    })()
    return () => controller.abort()
  }, [])

  /**
   * R9.5 — park focus on this section after a confirmed removal.
   *
   * `ModalShell` captures the invoking control and refocuses it on close, which
   * is right for cancel, Escape and a failed delete. On SUCCESS the invoker was
   * that row's Remove chip, which has just unmounted — `.focus()` on a detached
   * node does nothing and focus falls to `<body>`. `ModalShell` is a CHILD, so
   * its restoration effect runs before this one in the same commit and this
   * lands last. `tabIndex={-1}` makes the section programmatically focusable
   * without adding it to the tab order.
   */
  useEffect(() => {
    if (removedSeq === 0) return
    sectionRef.current?.focus()
  }, [removedSeq])

  /** Re-reads the confirmed list after a successful POST — the route returns `{ ok: true }`, not the row. */
  async function fetchConfirmed(): Promise<Recipient[] | null> {
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      if (!res.ok) return null
      const json = (await res.json()) as { recipients?: unknown }
      return Array.isArray(json.recipients) ? (json.recipients as Recipient[]) : []
    } catch {
      return null
    }
  }

  function addErrorMessage(error: string | undefined): string {
    // `invalid_email` keeps the exact user-facing behavior it already had.
    if (error === 'invalid_email') return n.invalidEmail
    if (error && DUPLICATE_ERROR.test(error)) return n.duplicateError
    return n.addError
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmedEmail = email.trim()
    // Non-empty pre-check (unchanged) + duplicate-submission guard.
    if (!trimmedEmail || adding) return
    setAdding(true)
    setFeedback(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, label: label.trim() || undefined }),
      })
      const json = await readJson(res)
      if (!res.ok) {
        // Both entered values are preserved and no unconfirmed row is inserted.
        setFeedback({ tone: 'error', message: addErrorMessage(json.error), scope: 'add' })
        return
      }
      const confirmed = await fetchConfirmed()
      if (confirmed) setRecipients(confirmed)
      setEmail('')
      setLabel('')
      setFeedback({ tone: 'success', message: n.addSuccess, scope: 'add' })
    } catch {
      setFeedback({ tone: 'error', message: n.addError, scope: 'add' })
    } finally {
      setAdding(false)
    }
  }

  async function toggleActive(r: Recipient) {
    if (pendingIds.includes(r.id)) return // no overlapping PATCH for the same row
    const previous = r.active // this recipient's prior value, captured before the write
    const next = !previous
    setPendingIds((prev) => [...prev, r.id])
    setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: next } : x)))
    setFeedback(null)
    try {
      const res = await fetch(`${ENDPOINT}/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: next }),
      })
      if (!res.ok) throw new Error('update_failed')
      setFeedback({ tone: 'success', message: n.updateSuccess, scope: 'row' })
    } catch {
      // Roll back ONLY this recipient, to the value captured above. A whole-list
      // snapshot would discard another row's concurrently-confirmed result.
      setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: previous } : x)))
      setFeedback({ tone: 'error', message: n.updateError, scope: 'row' })
    } finally {
      setPendingIds((prev) => prev.filter((id) => id !== r.id))
    }
  }

  async function confirmRemove() {
    const target = confirming
    if (!target || pendingIds.includes(target.id)) return
    setPendingIds((prev) => [...prev, target.id])
    setFeedback(null)
    try {
      const res = await fetch(`${ENDPOINT}/${target.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete_failed')
      // Removed only now — never optimistically.
      setRecipients((prev) => prev.filter((x) => x.id !== target.id))
      setFeedback({ tone: 'success', message: n.removeSuccess, scope: 'row' })
      // Only on the confirmed-success path: the invoking control is now gone.
      setRemovedSeq((seq) => seq + 1)
    } catch {
      setFeedback({ tone: 'error', message: n.removeError, scope: 'row' })
    } finally {
      setPendingIds((prev) => prev.filter((id) => id !== target.id))
      // Closed on either outcome: the feedback area sits behind the dialog, and
      // closing is what returns focus to the Remove control that opened it.
      setConfirming(null)
    }
  }

  const errorMessage = feedback?.tone === 'error' ? feedback.message : null
  const successMessage = feedback?.tone === 'success' ? feedback.message : null
  const addInvalid = feedback?.tone === 'error' && feedback.scope === 'add'

  const state =
    loadState === 'loading' ? 'loading'
      : loadState === 'error' ? 'error'
        : recipients.length === 0 ? 'empty'
          : undefined

  return (
    <section ref={sectionRef} tabIndex={-1} id="notifications" className="mt-[14px] scroll-mt-6">
      <TableCard
        title={n.title}
        controls={
          <div className="flex flex-col gap-2 w-full lg:w-auto">
            <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 w-full lg:w-auto">
              <div className="flex flex-col gap-1 grow shrink basis-[190px] min-w-0">
                <label htmlFor={emailId} className="ui-label text-muted-fg">{n.emailLabel}</label>
                <input
                  id={emailId}
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  aria-invalid={addInvalid || undefined}
                  aria-describedby={addInvalid ? errorId : noteId}
                  className={`${FIELD} font-mono`}
                />
              </div>
              <div className="flex flex-col gap-1 grow shrink basis-[160px] min-w-0">
                <label htmlFor={labelId} className="ui-label text-muted-fg">
                  {n.labelLabel} <span className="text-muted-fg">{n.optional}</span>
                </label>
                <input
                  id={labelId}
                  type="text"
                  maxLength={80}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={n.labelPlaceholder}
                  className={FIELD}
                />
              </div>
              <ChipButton type="submit" disabled={adding || !email.trim()} aria-busy={adding || undefined}>
                {adding ? n.adding : n.add}
              </ChipButton>
            </form>

            {/* Two permanently-mounted regions: `role="alert"` implies an
                assertive live region, so pairing it with an explicit polite one
                on the SAME element would muddle both announcements. Empty
                paragraphs render at zero height. */}
            <p id={errorId} role="alert" className={errorMessage ? 'ui-meta text-negative' : undefined}>
              {errorMessage}
            </p>
            <p aria-live="polite" className={successMessage ? 'ui-meta text-positive' : undefined}>
              {successMessage}
            </p>
          </div>
        }
        state={state}
        stateMessage={state === 'error' ? n.loadError : state === 'empty' ? n.empty : undefined}
        minWidth={560}
        footer={
          <>
            <p className="ui-meta text-muted-fg">{n.subtitle}</p>
            <p id={noteId} className="ui-meta text-muted-fg mt-1">{n.note}</p>
          </>
        }
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--nv-line)' }}>
              <th scope="col" className="text-left py-2.5 px-4 ui-table-header text-muted-fg">{n.emailLabel}</th>
              <th scope="col" className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{n.labelLabel}</th>
              <th scope="col" className="text-center py-2.5 px-4 ui-table-header text-muted-fg">{n.activeLabel}</th>
              <th scope="col" className="text-right py-2.5 px-4 ui-table-header text-muted-fg">{n.remove}</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => {
              const busy = pendingIds.includes(r.id)
              return (
                <tr key={r.id} aria-busy={busy || undefined} style={{ borderBottom: '1px solid var(--nv-line)' }}>
                  <td className="py-3 px-4 font-mono break-all text-foreground">{r.email}</td>
                  <td className="py-3 px-3 text-muted-fg break-words">{r.label ?? '—'}</td>
                  {/* px-4 on both control cells keeps ≥34px between the Switch
                      track and the Remove chip, so the Switch's 13px invisible
                      touch inset can never intercept the destructive control. */}
                  <td className="py-3 px-4 text-center">
                    <Switch
                      checked={r.active}
                      disabled={busy}
                      onCheckedChange={() => void toggleActive(r)}
                      aria-label={`${n.activeFor}: ${r.email}`}
                    />
                  </td>
                  <td className="py-3 px-4 text-right">
                    <ChipButton
                      onClick={() => setConfirming(r)}
                      disabled={busy}
                      aria-label={`${n.removeFor}: ${r.email}`}
                    >
                      {busy ? n.removing : n.remove}
                    </ChipButton>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableCard>

      {/* The shared destructive gate: confirm fires at most once per open, and
          cancel / Escape / scrim / ✕ never mutate. Focus trap, scroll lock and
          focus restoration stay the shared shell's contract. */}
      <DestructiveConfirm
        open={confirming !== null}
        title={n.confirmRemoveTitle}
        // R9.5 — the same value, wrapped the same way the table cell wraps it.
        // An email is one unbreakable token and the dialog clips rather than
        // scrolls, so at 320px an unwrapped address could be cut off in the one
        // place that must state exactly what is about to be deleted.
        description={
          confirming ? (
            <>
              <span className="break-all">{confirming.email}</span>
              {confirming.label ? <span className="break-words"> · {confirming.label}</span> : null}
            </>
          ) : undefined
        }
        confirmLabel={confirming && pendingIds.includes(confirming.id) ? n.removing : n.remove}
        cancelLabel={n.cancel}
        pending={confirming ? pendingIds.includes(confirming.id) : false}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void confirmRemove()}
      />
    </section>
  )
}
