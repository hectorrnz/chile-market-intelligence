'use client'

// Phase 6B — Username + password login (replaces magic-link flow).
// Two modes: "sign in" (username + password) and "create account"
// (username, display name, recovery email, password). Institutional styling,
// semantic tokens, i18n throughout. Session is set by the server via cookies.

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { BrandLogo } from '@/components/ui/BrandLogo'

type Mode = 'signin' | 'create'

function errorKeyToMessage(t: ReturnType<typeof useLang>['t'], code: string): string {
  switch (code) {
    case 'invalid_credentials':  return t.auth.errInvalidCredentials
    case 'username_taken':       return t.auth.errUsernameTaken
    case 'invalid_password':     return t.auth.errWeakPassword
    case 'invalid_username':     return t.auth.errInvalidUsername
    case 'invalid_email':        return t.auth.errInvalidEmail
    case 'invalid_display_name': return t.auth.errInvalidDisplayName
    default:                     return t.auth.errorGeneric
  }
}

function LoginForm() {
  const { t } = useLang()
  const searchParams = useSearchParams()
  const callbackError = searchParams.get('error')
  const next = searchParams.get('next') ?? '/'

  const [mode, setMode] = useState<Mode>('signin')
  const [username, setUsername]       = useState('')
  const [password, setPassword]       = useState('')
  const [email, setEmail]             = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(
    callbackError ? t.auth.errorCallback : null,
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const endpoint = mode === 'signin' ? '/api/auth/login' : '/api/auth/register'
      // Username doubles as the display name — no separate field.
      const payload =
        mode === 'signin'
          ? { username: username.trim(), password }
          : { username: username.trim(), password, email: email.trim(), displayName: username.trim() }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(errorKeyToMessage(t, json.error ?? ''))
        setLoading(false)
        return
      }

      // Session cookies are set by the server. Navigate to the target.
      const safeNext = next.startsWith('/') ? next : '/'
      // Full navigation so the new session cookies are picked up server-side.
      window.location.assign(safeNext)
    } catch {
      setError(t.auth.errorGeneric)
      setLoading(false)
    }
  }

  const isCreate = mode === 'create'

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-background"
      style={{ minWidth: '320px' }}
    >
      <div className="w-full max-w-sm bg-surface border border-border rounded px-8 py-8 shadow-sm">
        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-7">
          <BrandLogo className="h-8 w-auto shrink-0" />
          <span className="text-sm font-mono text-muted-fg uppercase tracking-wide">NMI</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground mb-0.5">
              {isCreate ? t.auth.createAccountTitle : t.auth.signInTitle}
            </p>
            <p className="text-xs text-muted-fg">
              {isCreate ? t.auth.createAccountSubtitle : t.auth.signInSubtitle}
            </p>
          </div>

          {error && (
            <div className="text-xs text-negative bg-surface-2 border border-border rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Username */}
          <div className="space-y-1.5">
            <label htmlFor="username" className="ui-label text-muted-fg">{t.auth.usernameLabel}</label>
            <input
              id="username"
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder={t.auth.usernamePlaceholder}
              className="w-full h-9 px-3 rounded border border-border bg-surface-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
            />
          </div>

          {/* Create-only: recovery email */}
          {isCreate && (
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
              <p className="text-xs text-muted">{t.auth.emailHint}</p>
            </div>
          )}

          {/* Password */}
          <div className="space-y-1.5">
            <label htmlFor="password" className="ui-label text-muted-fg">{t.auth.passwordLabel}</label>
            <input
              id="password"
              type="password"
              required
              autoComplete={isCreate ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t.auth.passwordPlaceholder}
              className="w-full h-9 px-3 rounded border border-border bg-surface-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
            />
            {isCreate && <p className="text-xs text-muted">{t.auth.passwordHint}</p>}
          </div>

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full h-9 rounded text-surface text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {loading ? '…' : isCreate ? t.auth.submitCreate : t.auth.submitSignIn}
          </button>

          {/* Mode toggle */}
          <button
            type="button"
            onClick={() => { setError(null); setMode(isCreate ? 'signin' : 'create') }}
            className="w-full text-xs text-primary hover:underline"
          >
            {isCreate ? t.auth.haveAccount : t.auth.needAccount}
          </button>
        </form>
      </div>

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
