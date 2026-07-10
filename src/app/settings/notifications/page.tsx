'use client'

// Notification recipients settings — the editable email distribution list
// notified (in-app + email) when a platform event fires (e.g. a structured
// note is auto-called). Middleware guarantees this page is only reachable by
// signed-in users; any authenticated user can manage it (same shared-trust
// model the rest of this app already uses).

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { SectionHeader } from '@/components/ui/SectionHeader'

interface Recipient {
  id: string
  email: string
  label: string | null
  active: boolean
  createdAt: string
}

export default function NotificationSettingsPage() {
  const { t } = useLang()
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/notification-recipients', { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    setRecipients(Array.isArray(json.recipients) ? json.recipients : [])
  }, [])

  useEffect(() => {
    const cancelled = { value: false }
    void (async () => {
      await load()
      if (!cancelled.value) setLoading(false)
    })()
    return () => { cancelled.value = true }
  }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = email.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const res = await fetch('/api/notification-recipients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, label: label.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error === 'invalid_email' ? t.notifications.settings.invalidEmail : t.notifications.settings.addError); return }
      setEmail(''); setLabel('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(r: Recipient) {
    setRecipients((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)))
    await fetch(`/api/notification-recipients/${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !r.active }),
    }).catch(() => {})
  }

  async function remove(id: string) {
    setRecipients((prev) => prev.filter((r) => r.id !== id))
    await fetch(`/api/notification-recipients/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div className="w-full">
      <SectionHeader tag={t.notifications.settings.tag} title={t.notifications.settings.title} subtitle={t.notifications.settings.subtitle} />
      <Link href="/structured-notes" className="text-sm text-accent hover:underline">{t.sn.back}</Link>

      <form onSubmit={handleAdd} className="mt-5 mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="ui-label text-muted-fg block mb-1" htmlFor="recipient-email">{t.notifications.settings.emailLabel}</label>
          <input
            id="recipient-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com" className="px-2 py-1.5 text-sm border border-border rounded bg-surface w-64"
          />
        </div>
        <div>
          <label className="ui-label text-muted-fg block mb-1" htmlFor="recipient-label">{t.notifications.settings.labelLabel}</label>
          <input
            id="recipient-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder={t.notifications.settings.labelPlaceholder} className="px-2 py-1.5 text-sm border border-border rounded bg-surface w-48"
          />
        </div>
        <button type="submit" disabled={busy || !email.trim()} className="px-3 py-1.5 rounded-md bg-primary text-primary-fg text-sm disabled:opacity-50">
          {t.notifications.settings.add}
        </button>
      </form>
      {error && <div className="mb-4 text-sm text-negative">{error}</div>}

      {loading ? (
        <div className="text-sm text-muted-fg">…</div>
      ) : recipients.length === 0 ? (
        <div className="text-sm text-muted-fg border border-border rounded-lg p-6 text-center">{t.notifications.settings.empty}</div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2.5 px-3 first:pl-4 ui-table-header text-muted-fg">{t.notifications.settings.emailLabel}</th>
                <th className="text-left py-2.5 px-3 ui-table-header text-muted-fg">{t.notifications.settings.labelLabel}</th>
                <th className="text-center py-2.5 px-3 ui-table-header text-muted-fg">{t.notifications.settings.activeLabel}</th>
                <th className="text-center py-2.5 px-3 ui-table-header text-muted-fg">{t.notifications.settings.remove}</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="py-2.5 px-3 pl-4 font-mono">{r.email}</td>
                  <td className="py-2.5 px-3 text-muted-fg">{r.label ?? '—'}</td>
                  <td className="py-2.5 px-3 text-center">
                    <input type="checkbox" checked={r.active} onChange={() => toggleActive(r)} title={t.notifications.settings.activeLabel} />
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <button onClick={() => remove(r.id)} className="text-xs text-negative hover:underline">{t.notifications.settings.remove}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-fg">{t.notifications.settings.note}</p>
    </div>
  )
}
