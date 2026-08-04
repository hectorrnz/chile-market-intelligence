'use client'

// Platform notification bell — icon + red unread-count badge + a right-edge
// Fable glass drawer, mounted in the TopBar. Only rendered for signed-in
// users (the feed is auth-only). Polls the shared feed periodically so the
// badge stays current without a page refresh; "Mark as read" persists
// per-user via notification_reads, so the badge count stays correct across
// devices.
//
// Phase 3 (Fable): restyled from an anchored dropdown to a full dialog
// drawer — role="dialog" aria-modal, a Tab focus trap, Escape-to-close
// (unchanged), body-scroll lock, and focus restored to the bell button on
// close — mirroring the pattern `MobileNavDrawer` established in Phase 2.
// The fetch/polling/read APIs and auth gating below are unchanged.

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { useAuthDisplay } from '@/lib/auth/useAuthDisplay'
import { useEscape } from '@/lib/useEscape'

interface Notification {
  id: string
  title: string
  body: string | null
  linkUrl: string | null
  createdAt: string
  isRead: boolean
}

const POLL_MS = 60_000
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function NotificationBell() {
  const { t } = useLang()
  const { email, ready } = useAuthDisplay()
  const signedIn = ready && !!email
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(open)

  // Inline fetch (not a memoized callback invoked as the effect's top-level
  // statement) — setState only runs from inside the .then() callback, the
  // established pattern for effect-driven data fetches in this codebase.
  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    const fetchOnce = () => {
      fetch('/api/notifications', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (cancelled || !json) return
          setNotifications(Array.isArray(json.notifications) ? json.notifications : [])
          setUnreadCount(typeof json.unreadCount === 'number' ? json.unreadCount : 0)
        })
        .catch(() => {
          // Leave prior state — a transient fetch failure shouldn't clear the badge.
        })
    }
    fetchOnce()
    const id = setInterval(fetchOnce, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [signedIn])

  useEscape(open, () => setOpen(false))

  // Body-scroll lock while the drawer is open.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
  }, [open])

  // Focus trap: first focusable element on open, Tab/Shift+Tab cycle inside.
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
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    container.addEventListener('keydown', onKeydown)
    return () => { clearTimeout(id); container.removeEventListener('keydown', onKeydown) }
  }, [open])

  // Restore focus to the bell button when the drawer closes.
  useEffect(() => {
    if (wasOpenRef.current && !open) triggerRef.current?.focus()
    wasOpenRef.current = open
  }, [open])

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {})
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setUnreadCount(0)
    await fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {})
  }

  if (!signedIn) return null

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex items-center justify-center w-8 h-8 rounded-full text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition"
        aria-label={t.notifications.bellLabel}
        title={t.notifications.bellLabel}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 8a5 5 0 0 1 10 0v3.5l1.3 2.2a.8.8 0 0 1-.7 1.2H4.4a.8.8 0 0 1-.7-1.2L5 11.5V8Z" />
          <path strokeLinecap="round" d="M8.3 15.5a1.8 1.8 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-4 font-medium text-center"
            style={{ backgroundColor: 'var(--critical-fill)', color: 'var(--critical-fill-fg)' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="no-print fixed inset-0 z-[90]">
          <div className="nv-scrim absolute inset-0" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t.notifications.panelLabel}
            className="nv-glass-overlay nv-slide-in absolute inset-y-0 right-0 w-[min(390px,94vw)] flex flex-col overflow-y-auto rounded-none"
          >
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--nv-line)' }}>
              <span className="ui-label text-muted-fg">{t.notifications.panelLabel}</span>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-accent hover:underline">{t.notifications.markAllRead}</button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t.fable.panel.close}
                  title={t.fable.panel.close}
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition"
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                    <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="nv-surface-dense flex-1">
              {notifications.length === 0 ? (
                <div className="p-6 text-sm text-muted-fg text-center">{t.notifications.empty}</div>
              ) : (
                <ul>
                  {notifications.map((n) => (
                    <li
                      key={n.id}
                      className="px-4 py-3"
                      style={{ borderBottom: '1px solid var(--nv-line)', backgroundColor: n.isRead ? 'transparent' : 'var(--selected)' }}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: n.isRead ? 'var(--muted-fg)' : 'var(--accent)' }}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground font-medium">{n.title}</p>
                          {n.body && <p className="text-xs text-muted-fg mt-0.5">{n.body}</p>}
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="ui-meta">{new Date(n.createdAt).toLocaleString()}</span>
                            {n.linkUrl && (
                              <Link href={n.linkUrl} onClick={() => setOpen(false)} className="text-xs text-accent hover:underline">
                                {t.notifications.view}
                              </Link>
                            )}
                          </div>
                        </div>
                        {!n.isRead && (
                          <button
                            onClick={() => markRead(n.id)}
                            className="shrink-0 text-xs px-2 py-1 rounded-full nv-transition"
                            style={{ border: '1px solid var(--nv-chipbd)' }}
                          >
                            {t.notifications.markRead}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-4 py-3" style={{ borderTop: '1px solid var(--nv-line)' }}>
              {/* R9.4 — points DIRECTLY at the integrated section rather than
                  through the preserved /settings/notifications redirect, so the
                  bell costs one navigation instead of two. Nothing else about
                  the bell changed. */}
              <Link href="/settings#notifications" onClick={() => setOpen(false)} className="text-xs text-muted-fg hover:text-foreground hover:underline">
                {t.notifications.manageRecipients}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
