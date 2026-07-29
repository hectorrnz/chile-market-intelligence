'use client'

import { useEffect, useRef, useId, type ReactNode } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { useEscape } from '@/lib/useEscape'
import { ChipButton } from './Chip'

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

export type ModalSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
}

interface ModalShellProps {
  open: boolean
  onClose: () => void
  /** Dialog title — labels the dialog via aria-labelledby. */
  title: ReactNode
  /** Optional supporting line under the title — wired via aria-describedby. */
  description?: ReactNode
  size?: ModalSize
  /**
   * Near-opaque analytical surface instead of overlay glass. Required when
   * the body carries dense data — charts, tables, small text (§8: dense
   * content never sits on low-opacity glass).
   */
  dense?: boolean
  /**
   * Blocks Escape, scrim-click, and the ✕ while true — used while a
   * destructive mutation is in flight so the dialog cannot be dismissed
   * mid-request.
   */
  dismissDisabled?: boolean
  /** Set false to require an explicit close action (scrim click ignored). */
  scrimDismiss?: boolean
  role?: 'dialog' | 'alertdialog'
  /** Pinned footer slot (actions). The body scrolls between header and footer. */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * The one shared modal dialog shell (Fable overlay recipe). Centered glass —
 * or near-opaque dense — surface over the blurred scrim, with the full dialog
 * behavior contract: labelled `role="dialog"`, focus trap, initial focus,
 * Escape, scrim-click dismissal, body-scroll lock, and focus restored to the
 * invoking control on close (the same pattern as `DetailPanel` and
 * `MobileNavDrawer`). Header and footer stay pinned; only the body scrolls.
 *
 * Purely a shell: no data fetching, no mutations, no route copy — every
 * visible string arrives from the caller's dictionary.
 */
export function ModalShell({
  open,
  onClose,
  title,
  description,
  size = 'md',
  dense = false,
  dismissDisabled = false,
  scrimDismiss = true,
  role = 'dialog',
  footer,
  children,
  className = '',
}: ModalShellProps) {
  const { t } = useLang()
  const titleId = useId()
  const descId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const wasOpenRef = useRef(open)

  const canDismiss = !dismissDisabled
  useEscape(open && canDismiss, onClose)

  // Body-scroll lock + capture the invoking control for focus restoration.
  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // Initial focus + Tab/Shift+Tab focus trap inside the dialog.
  useEffect(() => {
    if (!open) return
    const container = dialogRef.current
    if (!container) return
    const getFocusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const id = setTimeout(() => getFocusable()[0]?.focus(), 0)
    function onKeydown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    container.addEventListener('keydown', onKeydown)
    return () => {
      clearTimeout(id)
      container.removeEventListener('keydown', onKeydown)
    }
  }, [open])

  // Restore focus to the invoking control when the dialog closes.
  useEffect(() => {
    if (wasOpenRef.current && !open) (triggerRef.current as HTMLElement | null)?.focus?.()
    wasOpenRef.current = open
  }, [open])

  if (!open) return null

  return (
    <div className="no-print fixed inset-0 z-[90] flex items-start justify-center pt-[8vh] px-4">
      <div
        className="nv-scrim absolute inset-0"
        onClick={scrimDismiss && canDismiss ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={[
          dense ? 'nv-surface-dense' : 'nv-glass-overlay',
          'nv-pop relative w-full flex flex-col overflow-hidden max-h-[85vh]',
          SIZE_CLASS[size],
          className,
        ].join(' ')}
        // .nv-surface-dense is a bare background (§8) — the dialog chrome the
        // overlay tier already carries has to be applied here from the same
        // tokens, never re-derived per page.
        style={
          dense
            ? {
                borderRadius: 'var(--radius-module)',
                border: '1px solid var(--nv-bd)',
                boxShadow: 'var(--shadow-palette)',
              }
            : undefined
        }
      >
        <div
          className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
          style={{ borderBottom: '1px solid var(--nv-line)' }}
        >
          <div className="min-w-0">
            <h2 id={titleId} className="ui-page-title text-foreground truncate">
              {title}
            </h2>
            {description && (
              <p id={descId} className="ui-meta text-muted-fg mt-0.5">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!canDismiss}
            aria-label={t.fable.panel.close}
            title={t.fable.panel.close}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
              <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div
            className="shrink-0 flex flex-wrap items-center justify-end gap-2 px-5 py-3"
            style={{ borderTop: '1px solid var(--nv-line)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

interface DestructiveConfirmProps {
  open: boolean
  /** Dialog title — caller-supplied from its dictionary. */
  title: ReactNode
  /**
   * Honest identification of the affected record, built by the caller from
   * existing fields only (a real ticker, a real trade date/quantity) — never
   * a fabricated or estimated value.
   */
  description?: ReactNode
  confirmLabel: ReactNode
  cancelLabel: ReactNode
  /** True while the caller's mutation is in flight — locks the dialog. */
  pending?: boolean
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}

/**
 * Destructive-confirmation mode of the shared modal shell. The mutation
 * itself stays with the caller — this component only guarantees the gate:
 * confirm fires at most once per open, cancel/Escape/scrim/✕ never mutate,
 * and nothing is dismissable while the mutation is pending. Never the native
 * browser confirm dialog.
 */
export function DestructiveConfirm({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending = false,
  onCancel,
  onConfirm,
  children,
}: DestructiveConfirmProps) {
  // Duplicate-submission guard: a double-activation in the tick before the
  // caller's `pending` flag lands must not fire the mutation twice.
  const firedRef = useRef(false)
  useEffect(() => {
    if (open && !pending) firedRef.current = false
  }, [open, pending])

  const handleConfirm = () => {
    if (pending || firedRef.current) return
    firedRef.current = true
    onConfirm()
  }

  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      dismissDisabled={pending}
      footer={
        <>
          <ChipButton onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </ChipButton>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            aria-busy={pending || undefined}
            className="inline-flex items-center gap-2 h-8 px-4 rounded-full text-xs font-medium nv-transition disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--critical-fill)', color: 'var(--critical-fill-fg)' }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {children ?? null}
    </ModalShell>
  )
}
