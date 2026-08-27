'use client'

// R13.R2C §§ 8-12 — Weekly Notes: SEVERAL notes per published week, each with
// its own identity, WRITTEN IN NMI.
//
// THIS IS NOT A WORKBOOK FIELD. Nothing in the RESUMEN sheet feeds it and the
// parser has never produced it; notes are authored here by an administrator to
// record buys, sells, flows, portfolio changes, manager comments and decisions
// worth keeping beside the week they belong to.
//
// MAIN ONLY (§ 7). The Summary renders this region for the Main portfolio and
// for nothing else — a personal scope gets no notes column at all, rather than
// an empty one or invented filler.
//
// WHY A LIST AND NOT ONE TEXTAREA (§ 8). Each note is a row with its own id, so
// editing or withdrawing one cannot disturb another, and the order is the
// module's own deterministic one rather than wherever a cursor happened to be.
// Appending paragraphs into a single document would have looked the same and
// been none of those things.
//
// DELETION IS A TOMBSTONE (§ 11), confirmed in the app's own alert dialog —
// never `window.confirm`. The row is stamped and drops out of the RLS read
// predicate; the record that a note existed and was withdrawn survives.
//
// AUTHORIZATION IS THE SERVER'S (§ 12). `canEdit` decides only whether this
// component draws controls; every mutation route re-derives
// `entitlement.isAdministrator` and the table has no write policy at all. A
// member is shown the notes themselves, never a disabled editor pretending at a
// capability they do not have.
//
// THE BODY IS TEXT, ALWAYS. It renders as a React text child — never
// `dangerouslySetInnerHTML` — so markup in a stored note is displayed, not
// executed. `whitespace-pre-wrap` preserves the author's own line breaks
// without giving them any other formatting power.

import { useEffect, useRef, useState } from 'react'
import { ModalShell } from '@/components/fable/ModalShell'

export interface WeeklyNoteItem {
  id: string
  body: string
  displayOrder: number
  createdAt: string
  updatedAt: string
}

export type WeeklyNoteSaveOutcome = 'saved' | 'empty' | 'too_long' | 'unavailable' | 'error'

/**
 * R13.R2 PASS 4 § 1 — can this surface read and write notes at all?
 *
 *   `ok`             the list is authoritative; an empty list is an empty week
 *   `schema_missing` `20260813000000_family_portfolio_weekly_notes.sql` has not
 *                    been applied, so nothing can be read or saved yet
 *   `unavailable`    the notes could not be read for some other reason
 *
 * Without this the panel could only say "no note has been written for this
 * week", which is a claim about the WEEK — and simply untrue when the real
 * answer is that the table does not exist.
 */
export type WeeklyNotesAvailability = 'ok' | 'schema_missing' | 'unavailable'

export interface WeeklyNotesPanelLabels {
  title: string
  empty: string
  add: string
  edit: string
  delete: string
  editorLabel: string
  placeholder: string
  save: string
  saving: string
  saved: string
  cancel: string
  emptyError: string
  tooLongError: string
  saveError: string
  deleteError: string
  remaining: string
  deleteTitle: string
  deleteBody: string
  deleteConfirm: string
  /** Shown INSTEAD of `empty` when the notes schema has not been applied. */
  schemaMissing: string
  /** Shown when the notes could not be read for any other reason. */
  unavailable: string
  /** e.g. "Administrator commentary". */
  attribution: string
}

export interface WeeklyNotesPanelProps {
  notes: WeeklyNoteItem[]
  /** Presentation only — the write routes are the actual gate. */
  canEdit: boolean
  /** Whether notes can be read/written at all — see `WeeklyNotesAvailability`. */
  availability: WeeklyNotesAvailability
  maxLength: number
  labels: WeeklyNotesPanelLabels
  /** Formats a note's date; supplied by the page, never derived here. */
  formatDate: (iso: string) => string
  onCreate: (body: string) => Promise<WeeklyNoteSaveOutcome>
  onUpdate: (id: string, body: string) => Promise<WeeklyNoteSaveOutcome>
  onDelete: (id: string) => Promise<'deleted' | 'error'>
}

/** `'new'` is the create slot; a uuid is the note being edited. */
type EditTarget = string | 'new' | null

export function WeeklyNotesPanel({
  notes,
  canEdit,
  availability,
  maxLength,
  labels,
  formatDate,
  onCreate,
  onUpdate,
  onDelete,
}: WeeklyNotesPanelProps) {
  const [editing, setEditing] = useState<EditTarget>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus the editor when it opens — a Save control with no cursor in the field
  // is a keyboard dead end.
  useEffect(() => {
    if (editing !== null) textareaRef.current?.focus()
  }, [editing])

  function open(target: EditTarget, body: string) {
    setEditing(target)
    setDraft(body)
    setErrorText(null)
    setSavedId(null)
  }

  function cancel() {
    setEditing(null)
    setDraft('')
    setErrorText(null)
  }

  async function save() {
    const trimmed = draft.trim()
    // Client-side pre-checks mirror the server's `normalizeWeeklyNote` exactly,
    // so the common mistakes are caught without a round trip. They are a
    // convenience: the route and the database CHECK both validate again.
    if (trimmed.length === 0) return setErrorText(labels.emptyError)
    if (trimmed.length > maxLength) return setErrorText(labels.tooLongError)

    setErrorText(null)
    setSaving(true)
    const target = editing
    const outcome = target === 'new' ? await onCreate(trimmed) : await onUpdate(target as string, trimmed)
    setSaving(false)
    if (outcome === 'saved') {
      setSavedId(target === 'new' ? 'new' : (target as string))
      setEditing(null)
      setDraft('')
      return
    }
    setErrorText(
      outcome === 'empty'
        ? labels.emptyError
        : outcome === 'too_long'
          ? labels.tooLongError
          : // R13.R2 PASS 4 § 1 — a save that failed because the notes table does
            // not exist says SO, rather than the generic "could not be saved"
            // that gave the reader nothing to act on.
            outcome === 'unavailable'
            ? labels.schemaMissing
            : labels.saveError,
    )
  }

  async function confirmDelete() {
    if (confirmId === null) return
    setDeleting(true)
    const outcome = await onDelete(confirmId)
    setDeleting(false)
    if (outcome === 'deleted') {
      setConfirmId(null)
      return
    }
    setConfirmId(null)
    setErrorText(labels.deleteError)
  }

  const remaining = maxLength - draft.trim().length

  const editor = (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="fp-weekly-note">
        {labels.editorLabel}
      </label>
      <textarea
        id="fp-weekly-note"
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={maxLength}
        rows={5}
        placeholder={labels.placeholder}
        disabled={saving}
        className="w-full min-w-0 resize-y rounded-[var(--radius-input)] bg-surface-2 border border-border px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-fg"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 h-8 px-4 rounded-full text-xs font-medium bg-accent text-accent-fg nv-transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? labels.saving : labels.save}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="ui-meta text-muted-fg hover:text-foreground nv-transition"
        >
          {labels.cancel}
        </button>
        <span className="ui-meta text-muted-fg ml-auto">
          <span className="ui-number">{remaining}</span> {labels.remaining}
        </span>
      </div>
      {/* The failure is stated in WORDS, in the module's warning language —
          never a red field with no explanation. */}
      {errorText !== null && (
        <p role="alert" className="ui-meta flex items-start gap-1.5" style={{ color: 'var(--warning)' }}>
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full shrink-0 mt-1"
            style={{ backgroundColor: 'var(--warning)' }}
          />
          <span>{errorText}</span>
        </p>
      )}
    </div>
  )

  // R13.R2 PASS 4 § 1 — the notes STORE is not reachable. Every control stays
  // VISIBLE and disabled rather than disappearing: the capability exists and is
  // blocked, and hiding the affordance would misrepresent that as "notes are not
  // a feature here". The reason is stated in words beside it.
  const blocked = availability !== 'ok'
  const blockedText = availability === 'schema_missing' ? labels.schemaMissing : labels.unavailable

  return (
    // Tight chrome at the top (title, affordance, availability line), then the
    // notes themselves carry the panel — the list below sets its own rhythm.
    <section className="flex flex-col gap-2.5 min-w-0 px-5 sm:px-6 pt-4 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="ui-label text-muted-fg">{labels.title}</h2>
        {canEdit && editing === null && (
          // R13.R2F § 12 — A REAL, VISIBLY DISABLED CONTROL. While the store is
          // unreachable the capability still exists, so the affordance keeps
          // its full pill shape and simply reads as unavailable — never a
          // faint word that could be mistaken for absent chrome. Its reason
          // travels with it in `title`, and is stated in words directly below.
          <button
            type="button"
            onClick={() => open('new', '')}
            disabled={blocked}
            title={blocked ? blockedText : undefined}
            className="inline-flex items-center gap-1 h-7 px-3 shrink-0 rounded-full border border-border text-xs font-medium text-foreground hover:bg-surface-2 nv-transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <span aria-hidden="true">+</span>
            {labels.add}
          </button>
        )}
      </div>

      {/* Stated once, plainly — never a bare "no note has been written", which
          would be a false claim about the week.

          R13.R2F § 12 — A DESIGNED STATE, NOT AN ERROR. It reads as a quiet
          inset panel on the module surface with a warning DOT and the reason in
          plain words: the signal is carried by the dot and the sentence, not by
          a page of alarm-coloured text, because nothing here has failed — a
          capability is simply not switched on yet. */}
      {blocked && (
        <div className="rounded-[var(--radius-cell)] bg-surface-2 px-3 py-2.5 max-w-[52ch]">
          {/* `text-foreground`, not muted: this sits on the inset surface-2
              block, where muted ink falls under AA against the COMPOSITED
              backdrop in both themes. It is also a disclosure the reader has to
              actually read, not incidental metadata. */}
          <p className="ui-meta leading-snug flex items-start gap-2 text-foreground">
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
              style={{ backgroundColor: 'var(--warning)' }}
            />
            <span>{blockedText}</span>
          </p>
        </div>
      )}

      {editing === 'new' && editor}

      {blocked ? null : notes.length === 0 && editing !== 'new' ? (
        // Compact and intentional — a single honest line, never a large empty
        // panel implying something failed to load.
        <p className="ui-meta text-muted-fg">{labels.empty}</p>
      ) : (
        // Each entry is a distinct piece of AUTHORED commentary — a hair more
        // air between entries than within one, so an attribution line can
        // never read as the footer of the note above it.
        <ul className="flex flex-col gap-3.5 list-none p-0 m-0">
          {notes.map((note) =>
            editing === note.id ? (
              <li key={note.id}>{editor}</li>
            ) : (
              <li
                key={note.id}
                className="flex flex-col gap-1 pl-3.5"
                // The thin accent rule marks AUTHORED commentary apart from the
                // derived figures around it.
                style={{ borderLeft: '2px solid var(--accent)' }}
              >
                <p className="ui-meta text-muted-fg leading-snug flex flex-wrap items-baseline gap-x-2">
                  <span>{labels.attribution}</span>
                  <span aria-hidden="true">·</span>
                  <span className="ui-number">{formatDate(note.updatedAt.slice(0, 10))}</span>
                  {canEdit && (
                    <span className="flex items-baseline gap-x-2 ml-auto">
                      <button
                        type="button"
                        onClick={() => open(note.id, note.body)}
                        className="text-muted-fg hover:text-foreground nv-transition"
                      >
                        {labels.edit}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(note.id)}
                        className="text-muted-fg hover:text-negative nv-transition"
                      >
                        {labels.delete}
                      </button>
                    </span>
                  )}
                </p>
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap max-w-[65ch]">
                  {note.body}
                </p>
              </li>
            ),
          )}
        </ul>
      )}

      {/* Polite confirmation — a save that reports nothing is indistinguishable
          from one that silently failed. */}
      {savedId !== null && (
        <p role="status" aria-live="polite" className="ui-meta text-positive">
          {labels.saved}
        </p>
      )}

      {/* Restrained confirmation in the app's OWN alert dialog (§ 11) — focus
          trapped, Escape-dismissible, and undismissable while the request is in
          flight. Never `window.confirm`. */}
      <ModalShell
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title={labels.deleteTitle}
        description={labels.deleteBody}
        size="sm"
        role="alertdialog"
        dismissDisabled={deleting}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmId(null)}
              disabled={deleting}
              className="ui-meta text-muted-fg hover:text-foreground nv-transition"
            >
              {labels.cancel}
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="inline-flex items-center h-8 px-4 rounded-full text-xs font-medium nv-transition disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--negative)', color: '#fff' }}
            >
              {labels.deleteConfirm}
            </button>
          </div>
        }
      >
        <p className="text-sm text-foreground">{labels.deleteBody}</p>
      </ModalShell>
    </section>
  )
}
