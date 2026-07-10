'use client'

// Landing page after a password-recovery email link. By the time the user
// arrives here, /auth/callback has already exchanged the recovery code and
// set a session cookie — this page only needs to collect and submit the new
// password. If there's no valid recovery session (expired/invalid link), the
// update call fails with 401 and we show an explicit "request a new link"
// message rather than a generic error.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { BrandLogo } from '@/components/ui/BrandLogo'

export default function ResetPasswordPage() {
  const { t } = useLang()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(t.auth.errPasswordMismatch)
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(json.error === 'no_session' ? t.auth.errResetLinkInvalid : t.auth.errResetFailed)
        setLoading(false)
        return
      }

      setDone(true)
      setTimeout(() => router.push('/login'), 1500)
    } catch {
      setError(t.auth.errResetFailed)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background" style={{ minWidth: '320px' }}>
      <div className="w-full max-w-sm bg-surface border border-border rounded px-8 py-8 shadow-sm">
        <div className="flex items-center gap-2.5 mb-7">
          <BrandLogo className="h-8 w-auto shrink-0" />
          <span className="text-sm font-mono text-muted-fg uppercase tracking-wide">NMI</span>
        </div>

        {done ? (
          <p className="text-sm text-positive">{t.auth.resetSuccessMessage}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">{t.auth.newPasswordTitle}</p>
              <p className="text-xs text-muted-fg">{t.auth.newPasswordSubtitle}</p>
            </div>

            {error && (
              <div className="text-xs text-negative bg-surface-2 border border-border rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="password" className="ui-label text-muted-fg">{t.auth.newPasswordLabel}</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t.auth.passwordPlaceholder}
                className="w-full h-9 px-3 rounded border border-border bg-surface-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
              />
              <p className="text-xs text-muted">{t.auth.passwordHint}</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirmPassword" className="ui-label text-muted-fg">{t.auth.confirmPasswordLabel}</label>
              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder={t.auth.passwordPlaceholder}
                className="w-full h-9 px-3 rounded border border-border bg-surface-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !password || !confirmPassword}
              className="w-full h-9 rounded text-surface text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {loading ? '…' : t.auth.submitNewPassword}
            </button>
          </form>
        )}
      </div>

      <Link href="/login" className="mt-5 text-xs text-muted-fg hover:text-foreground transition-colors">
        ← {t.auth.haveAccount}
      </Link>
    </div>
  )
}
