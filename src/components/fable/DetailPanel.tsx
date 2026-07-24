'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { useEscape } from '@/lib/useEscape'

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

interface DetailPanelProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  /**
   * Route to this content's canonical full page. Required in spirit (not
   * enforced by the type, since some content genuinely has no route yet) —
   * the panel is always a supplementary shortcut, never the only way to
   * reach content that has its own URL (design_principles.md §2).
   */
  fullPageHref?: string
  fullPageLabel?: string
  children: React.ReactNode
  className?: string
}

/**
 * Supplementary right-side detail panel (Fable "detail side panel"). Full
 * dialog behavior: focus trap, Escape-to-close, backdrop click, body-scroll
 * lock, and focus restored to the trigger element on close — the same
 * pattern established by `MobileNavDrawer` in Phase 2.
 */
export function DetailPanel({ open, onClose, title, subtitle, fullPageHref, fullPageLabel, children, className = '' }: DetailPanelProps) {
  const { t } = useLang()
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const wasOpenRef = useRef(open)

  useEscape(open, onClose)

  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const container = panelRef.current
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

  useEffect(() => {
    if (wasOpenRef.current && !open) (triggerRef.current as HTMLElement | null)?.focus?.()
    wasOpenRef.current = open
  }, [open])

  if (!open) return null

  return (
    <div className="no-print fixed inset-0 z-[90]">
      <div className="nv-scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`nv-glass-overlay nv-slide-in absolute inset-y-0 right-0 w-[min(440px,96vw)] flex flex-col overflow-y-auto rounded-none ${className}`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3" style={{ borderBottom: '1px solid var(--nv-line)' }}>
          <div className="min-w-0">
            <h2 className="ui-page-title text-foreground truncate">{title}</h2>
            {subtitle && <p className="text-xs text-muted-fg mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.fable.panel.close}
            title={t.fable.panel.close}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
              <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <div className="flex-1 px-5 py-4">{children}</div>

        {fullPageHref && (
          <div className="px-5 py-3" style={{ borderTop: '1px solid var(--nv-line)' }}>
            <Link href={fullPageHref} onClick={onClose} className="text-xs text-accent hover:underline">
              {fullPageLabel ?? t.fable.panel.viewFullPage}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
