'use client'

// Platform notification bell — icon + red unread-count badge + dropdown
// panel, mounted in the TopBar. Only rendered for signed-in users (the feed
// is auth-only). Polls the shared feed periodically so the badge stays
// current without a page refresh; "Mark as read" persists per-user via
// notification_reads, so the badge count stays correct across devices.

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

export function NotificationBell() {
  const { t } = useLang()
  const { email, ready } = useAuthDisplay()
  const signedIn = ready && !!email
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  useEscape(open, () => setOpen(false))

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
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded-md text-muted-fg hover:text-foreground hover:bg-surface-2 transition-colors"
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
            style={{ backgroundColor: 'var(--negative)', color: '#fff' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t.notifications.panelLabel}
          className="absolute right-0 mt-2 w-96 max-h-[28rem] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg z-50"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border sticky top-0 bg-surface">
            <span className="ui-label text-muted-fg">{t.notifications.panelLabel}</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-accent hover:underline">{t.notifications.markAllRead}</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="p-4 text-sm text-muted-fg text-center">{t.notifications.empty}</div>
          ) : (
            <ul>
              {notifications.map((n) => (
                <li key={n.id} className={`px-3 py-2.5 border-b border-border last:border-0 ${n.isRead ? '' : 'bg-surface-2'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground font-medium">{n.title}</p>
                      {n.body && <p className="text-xs text-muted-fg mt-0.5">{n.body}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-fg ui-number">{new Date(n.createdAt).toLocaleString()}</span>
                        {n.linkUrl && (
                          <Link href={n.linkUrl} onClick={() => setOpen(false)} className="text-xs text-accent hover:underline">
                            {t.notifications.view}
                          </Link>
                        )}
                      </div>
                    </div>
                    {!n.isRead && (
                      <button onClick={() => markRead(n.id)} className="shrink-0 text-xs px-2 py-1 rounded border border-border hover:bg-surface-2">
                        {t.notifications.markRead}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="px-3 py-2 border-t border-border">
            <Link href="/settings/notifications" onClick={() => setOpen(false)} className="text-xs text-muted-fg hover:text-foreground hover:underline">
              {t.notifications.manageRecipients}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
