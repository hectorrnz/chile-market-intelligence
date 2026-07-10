'use client'

// Password-reset request page. Asks only for the recovery email (username is
// never resolved to an email client-side, per the Phase 6B privacy rule), and
// always shows the same generic "check your email" confirmation regardless of
// whether the account exists.

import { useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { BrandLogo } from '@/components/ui/BrandLogo'

export default function ForgotPasswordPage() {
  const { t } = useLang()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
    } catch {
      // Intentionally ignored — the confirmation state is shown either way.
    } finally {
      setLoading(false)
      setSent(true)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background" style={{ minWidth: '320px' }}>
      <div className="w-full max-w-sm bg-surface border border-border rounded px-8 py-8 shadow-sm">
        <div className="flex items-center gap-2.5 mb-7">
          <BrandLogo className="h-8 w-auto shrink-0" />
          <span className="text-sm font-mono text-muted-fg uppercase tracking-wide">NMI</span>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">{t.auth.resetLinkSentTitle}</p>
              <p className="text-xs text-muted-fg">{t.auth.resetLinkSentMessage}</p>
            </div>
            <Link href="/login" className="block w-full text-center text-xs text-primary hover:underline">
              {t.auth.haveAccount}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">{t.auth.forgotPasswordTitle}</p>
              <p className="text-xs text-muted-fg">{t.auth.forgotPasswordSubtitle}</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="ui-label text-muted-fg">{t.auth.emailLabel}</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t.auth.emailPlaceholder}
                className="w-full h-9 px-3 rounded border border-border bg-surface-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full h-9 rounded text-surface text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {loading ? '…' : t.auth.sendResetLink}
            </button>

            <Link href="/login" className="block w-full text-center text-xs text-primary hover:underline">
              {t.auth.haveAccount}
            </Link>
          </form>
        )}
      </div>

      <Link href="/" className="mt-5 text-xs text-muted-fg hover:text-foreground transition-colors">
        ← {t.auth.backToHome}
      </Link>
    </div>
  )
}
