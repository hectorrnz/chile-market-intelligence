'use client'

// Phase 6A — Magic-link (email OTP) login page.
// Keeps the institutional Goldman-style aesthetic — no gradients, no hero,
// no hardcoded colors. Uses semantic CSS tokens throughout.

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { useLang } from '@/components/providers/LangProvider'
import { BrandLogo } from '@/components/ui/BrandLogo'

function LoginForm() {
  const { t } = useLang()
  const searchParams = useSearchParams()
  const callbackError = searchParams.get('error')
  const next = searchParams.get('next') ?? '/watchlist'

  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState<string | null>(
    callbackError ? t.auth.errorCallback : null
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const db = getSupabaseBrowserClient()
    if (!db) {
      setError('Authentication service not configured.')
      setLoading(false)
      return
    }

    const redirectTo =
      `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

    const { error: authErr } = await db.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirectTo },
    })

    if (authErr) {
      setError(t.auth.errorGeneric)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-background"
      style={{ minWidth: '320px' }}
    >
      {/* Card */}
      <div className="w-full max-w-sm bg-surface border border-border rounded px-8 py-8 shadow-sm">
        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-7">
          <BrandLogo className="h-8 w-auto shrink-0" />
          <span className="text-sm font-mono text-muted-fg uppercase tracking-wide">NMI</span>
        </div>

        {sent ? (
          /* Success state */
          <div>
            <p className="text-sm font-medium text-foreground mb-1">{t.auth.checkEmail}</p>
            <p className="text-xs text-muted-fg leading-relaxed">
              {t.auth.checkEmailDesc.replace('{email}', email)}
            </p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="mt-5 text-xs text-primary hover:underline"
            >
              {t.auth.tryDifferentEmail}
            </button>
          </div>
        ) : (
          /* Login form */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground mb-0.5">{t.auth.signInTitle}</p>
              <p className="text-xs text-muted-fg">{t.auth.signInSubtitle}</p>
            </div>

            {error && (
              <div className="text-xs text-negative bg-surface-2 border border-border rounded px-3 py-2">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="email" className="ui-label text-muted-fg">
                {t.auth.emailLabel}
              </label>
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
              className="w-full h-9 rounded bg-primary text-surface text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: 'var(--primary)' }}
            >
              {loading ? '…' : t.auth.sendLink}
            </button>
          </form>
        )}
      </div>

      {/* Back link */}
      <Link
        href="/"
        className="mt-5 text-xs text-muted-fg hover:text-foreground transition-colors"
      >
        ← {t.auth.backToHome}
      </Link>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
