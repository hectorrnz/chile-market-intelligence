'use client'

// R13.7B2.2.2 § 4-10 — the ONE shared destructive control of the platform.
//
// REFERENCE INTERACTION (Rare UI "Delete button"): a compact bin; pressing it
// lifts the lid and slides an inline confirmation panel out beside it; a check
// confirms, a cross cancels, Escape cancels, pressing the bin again cancels;
// on a confirmed deletion a check mark takes the bin's place. Reproduced here
// on NMI's own materials and motion tokens — no animation library (the
// reference depends on `motion`; this repository has no such dependency and
// does not need one: the lid is a CSS transform on an SVG group, the panel a
// CSS transition, the success check a stroke-dashoffset transition, all on
// `--dur-state` / `--dur-pop` / `--ease-primary`), and every one of them is
// removed by the global `prefers-reduced-motion` rule (globals.css § 8), so
// the STATE transition survives while the motion does not.
//
// WHAT THIS COMPONENT OWNS — presentation and the confirmation GATE:
//   · the state machine in ./deleteButtonState.ts (pure, unit-tested): the
//     caller's handler is invoked at most ONCE per arming, never from cancel,
//     Escape or a repeated activation while a request is pending;
//   · success is shown only after the handler RESOLVED successfully — never
//     optimistically;
//   · a failed handler returns the control to a usable idle state and shows
//     nothing of its own: the caller's existing error treatment (its alert,
//     its live region, its feedback line) stays the single source of truth;
//   · keyboard: real <button>s (Enter/Space native), Escape cancels an armed
//     panel, focus returns to the bin on cancel, leaving the control while
//     armed disarms it; the panel is `inert` while closed so it is never a
//     hidden tab stop;
//   · the accessible name of the trigger is a REQUIRED prop and must name the
//     record ("Delete note: XS…", "Remove recipient: a@b.c"), and the visible
//     question inside the panel is REQUIRED too, so the destructive action is
//     stated in words — never by an icon or a colour alone.
//
// WHAT IT NEVER OWNS — deletion semantics. No fetch, no endpoint, no
// authorization, no refetch, no navigation. The caller's `onConfirm` is the
// exact handler that ran behind the previous DestructiveConfirm dialog; it
// resolves `true`/`void` on a confirmed success and `false` (or throws) on
// failure. Who may render this control is still decided by the caller's own
// capability flag and, binding, by the route/RLS behind the request.

import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { transition, invokesHandler, INITIAL_DELETE_STATE, type DeleteButtonEvent, type DeleteButtonState } from './deleteButtonState'

export interface DeleteButtonProps {
  /**
   * Accessible name of the trigger — MUST identify the record being deleted
   * (e.g. `${t.sn.delete}: ${note.isin}`). Also the default tooltip.
   */
  label: string
  /** The visible question inside the confirmation panel (e.g. "Delete this note permanently?"). */
  confirmLabel: string
  /**
   * The pre-existing destructive handler. Resolve `false` (or throw) on a
   * failed deletion; anything else is a confirmed success. Invoked at most
   * once per arming.
   */
  onConfirm: () => Promise<boolean | void> | boolean | void
  /** Optional: informed when the panel closes without deleting (cross, Escape, bin, focus leaving). */
  onCancel?: () => void
  /** Cannot arm, confirm or cancel while true. An in-flight request still resolves. */
  disabled?: boolean
  /** `md` (32px, table actions and card headers) or `sm` (24px, dense rows). */
  size?: 'sm' | 'md'
  /**
   * `inline` — the panel expands in the flow beside the bin (headers, meta
   * lines, wrapping rows). `overlay` — the panel floats beside the bin
   * without shifting layout (dense table cells).
   */
  layout?: 'inline' | 'overlay'
  /** Optional visible idle text beside the bin (e.g. "Delete note"). Icon-only when omitted. */
  children?: ReactNode
  /** Accessible name of the check. Defaults to the platform dictionary. */
  confirmActionLabel?: string
  /** Accessible name of the cross. Defaults to the platform dictionary. */
  cancelActionLabel?: string
  title?: string
  className?: string
}

/** How long the success check stays before an unmounted-or-not control returns to idle. */
const SUCCESS_HOLD_MS = 1400

export function DeleteButton({
  label,
  confirmLabel,
  onConfirm,
  onCancel,
  disabled = false,
  size = 'md',
  layout = 'inline',
  children,
  confirmActionLabel,
  cancelActionLabel,
  title,
  className = '',
}: DeleteButtonProps) {
  const { t } = useLang()
  const [state, setState] = useState<DeleteButtonState>(INITIAL_DELETE_STATE)
  // Mirror of `state` for event handlers and the async resolve path — written
  // ONLY where `setState` is written (inside `dispatch`), never during render.
  const stateRef = useRef<DeleteButtonState>(INITIAL_DELETE_STATE)
  const rootRef = useRef<HTMLSpanElement>(null)
  const binRef = useRef<HTMLButtonElement>(null)
  const mountedRef = useRef(true)
  const panelId = useId()

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /** Applies one event through the pure reducer and fires the handler iff the reducer says so. */
  const dispatch = useCallback((event: DeleteButtonEvent) => {
    const ctx = { disabled }
    const prev = stateRef.current
    const fire = invokesHandler(prev, event, ctx)
    const next = transition(prev, event, ctx)
    if (next !== prev) { stateRef.current = next; setState(next) }
    if (!fire) return
    void (async () => {
      let ok = false
      try {
        const result = await onConfirm()
        ok = result !== false
      } catch {
        ok = false
      }
      if (!mountedRef.current) return
      // The reducer lets a PENDING request resolve even if the control was
      // disabled meanwhile — a lock that lands mid-flight must not strand it.
      const resolved = transition(stateRef.current, { type: 'RESOLVE', ok }, ctx)
      stateRef.current = resolved
      setState(resolved)
    })()
  }, [onConfirm, disabled])

  // Success → idle after a short hold, if this control is still on screen (a
  // deleted row usually unmounts it first, which is fine).
  useEffect(() => {
    if (state !== 'success') return
    const id = window.setTimeout(() => { if (mountedRef.current) dispatch({ type: 'RESET' }) }, SUCCESS_HOLD_MS)
    return () => window.clearTimeout(id)
  }, [state, dispatch])

  const cancel = useCallback((via: 'CANCEL' | 'ESCAPE') => {
    if (stateRef.current !== 'armed') return
    dispatch({ type: via })
    onCancel?.()
    binRef.current?.focus()
  }, [dispatch, onCancel])

  // Escape cancels an ARMED panel — from anywhere on the page, as the
  // reference does. While pending nothing is cancellable (the reducer refuses).
  useEffect(() => {
    if (state !== 'armed') return
    const handler = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') cancel('ESCAPE') }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state, cancel])

  const armed = state === 'armed'
  const pending = state === 'pending'
  const success = state === 'success'
  const locked = disabled || pending

  const onBinClick = () => {
    if (armed) cancel('CANCEL')
    else dispatch({ type: 'ARM' })
  }
  const onConfirmClick = () => dispatch({ type: 'CONFIRM' })
  const onCancelClick = () => cancel('CANCEL')

  // Leaving the control while armed disarms it — an armed destructive panel
  // must not be left open behind the user's back.
  const onBlur = (e: FocusEvent<HTMLSpanElement>) => {
    const next = e.relatedTarget as Node | null
    if (stateRef.current === 'armed' && (!next || !rootRef.current?.contains(next))) dispatch({ type: 'CANCEL' })
  }
  // A destructive control's clicks never bubble to a row's navigation handler.
  const stop = (e: MouseEvent<HTMLSpanElement>) => e.stopPropagation()
  const stopKeys = (e: KeyboardEvent<HTMLSpanElement>) => e.stopPropagation()

  const confirmName = confirmActionLabel ?? t.fable.deleteButton.confirm
  const cancelName = cancelActionLabel ?? t.fable.deleteButton.cancel
  const iconOnly = children === undefined || children === null || children === false

  return (
    <span
      ref={rootRef}
      className={`nv-del nv-del--${size} nv-del--${layout} ${className}`}
      data-state={state}
      onBlur={onBlur}
      onClick={stop}
      onKeyDown={stopKeys}
    >
      <button
        ref={binRef}
        type="button"
        className={`nv-del-trigger${iconOnly ? ' nv-del-trigger--icon' : ''}`}
        onClick={onBinClick}
        disabled={locked}
        aria-label={label}
        title={title ?? label}
        aria-expanded={armed}
        aria-controls={panelId}
        aria-busy={pending || undefined}
      >
        {success ? (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.75} className="nv-del-icon nv-del-check" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5l3.5 3.5 7.5-8" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="nv-del-icon" aria-hidden="true">
            {/* the lid — the one part that moves (a CSS transform, § 8) */}
            <path className="nv-del-lid" strokeLinecap="round" strokeLinejoin="round" d="M3.5 6h13M8 6V4.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V6" />
            {/* the bin */}
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 6l.7 9.3a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9L14.5 6M8.5 9v4.5M11.5 9v4.5" />
          </svg>
        )}
        {!iconOnly && <span className="nv-del-text">{success ? t.fable.deleteButton.done : children}</span>}
      </button>

      {/* The inline confirmation panel. `inert` while closed: never a hidden
          tab stop, never clickable through its fade. The question is VISIBLE
          text, so the destructive action is stated in words. */}
      <span className="nv-del-panelwrap">
        <span
          id={panelId}
          role="group"
          aria-label={confirmLabel}
          className="nv-del-panel"
          inert={!armed && !pending}
        >
          <span className="nv-del-question">{confirmLabel}</span>
          <button
            type="button"
            className="nv-del-action nv-del-confirm"
            onClick={onConfirmClick}
            disabled={locked}
            aria-label={confirmName}
            title={confirmName}
            aria-busy={pending || undefined}
          >
            {pending ? (
              <span className="nv-del-spinner nv-spin" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="nv-del-icon" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5l3.5 3.5 7.5-8" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="nv-del-action nv-del-cancel"
            onClick={onCancelClick}
            disabled={locked}
            aria-label={cancelName}
            title={cancelName}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} className="nv-del-icon" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
            </svg>
          </button>
        </span>
      </span>

      {/* State announced for assistive tech; the visible states are the icon + text above. */}
      <span className="sr-only" role="status" aria-live="polite">
        {pending ? t.fable.deleteButton.pending : success ? t.fable.deleteButton.done : ''}
      </span>
    </span>
  )
}
