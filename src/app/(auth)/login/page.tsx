'use client'

// R1 (Stage 5R) — Fable login. The full-bleed gateway (photo, veils, utility
// chips, notice) is supplied by src/app/(auth)/layout.tsx via AuthShell; this
// page composes the deep-navy headline block and the Tier-1 glass AuthPanel
// into the shell's middle row.
//
// R1.5 — PUBLIC SELF-REGISTRATION REMOVED. This is a private family-office
// platform: accounts are provisioned by the administrator only (see
// docs/security_access_control.md). The create-account mode, the recovery-email
// registration field, the mode toggle and the POST to /api/auth/register are all
// gone, and that endpoint no longer exists. Sign-in behaviour is otherwise
// unchanged from Phase 6B: POST /api/auth/login with the same payload, the same
// generic error mapping, the ?error callback banner, the same disabled/loading
// semantics, and a full navigation so the server-set session cookies are picked
// up. `next` is now validated by the shared safe-redirect helper rather than a
// bare `startsWith('/')`.
//
// Fable's simulated auth, passkey, demo-credentials chip, remember-device switch
// and show/hide-password control are deliberately NOT carried over.

import { useState, Suspense, type CSSProperties } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { AuthPanel } from '@/components/fable/AuthPanel'
import { toSafeInternalPath } from '@/lib/auth/safeRedirect'

function errorKeyToMessage(t: ReturnType<typeof useLang>['t'], code: string): string {
  // /api/auth/login answers only `invalid_credentials`, `invalid_json` or
  // `not_configured`; everything else falls through to the generic message.
  // The former create-account codes are gone with the endpoint.
  switch (code) {
    case 'invalid_credentials': return t.auth.errInvalidCredentials
    default:                    return t.auth.errorGeneric
  }
}

/** Maps a ?error= value set by a server redirect onto a user-facing message. */
function callbackErrorToMessage(t: ReturnType<typeof useLang>['t'], code: string): string {
  // `not_authorized` is set by /auth/callback when a verified Auth identity has
  // no approved application profile — an account that exists in Supabase but was
  // never provisioned for this platform.
  return code === 'not_authorized' ? t.auth.errNotAuthorized : t.auth.errorCallback
}

const LABEL_STYLE: CSSProperties = { fontSize: 12, fontWeight: 650, color: 'var(--nv-auth-ink-2)' }
const HINT_STYLE: CSSProperties = { color: 'var(--nv-auth-ink-3)' }
const LINK_STYLE: CSSProperties = { color: 'var(--nv-auth-link)' }

function LoginForm() {
  const { t } = useLang()
  const searchParams = useSearchParams()
  const callbackError = searchParams.get('error')
  const next = searchParams.get('next') ?? '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(
    callbackError ? callbackErrorToMessage(t, callbackError) : null,
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(errorKeyToMessage(t, json.error ?? ''))
        setLoading(false)
        return
      }

      // Session cookies are set by the server. Navigate to the target, via the
      // one authoritative validator (middleware and /auth/callback share it) so
      // a hostile ?next can never send an authenticated user off-site.
      const safeNext = toSafeInternalPath(next)
      // Full navigation so the new session cookies are picked up server-side.
      window.location.assign(safeNext)
    } catch {
      setError(t.auth.errorGeneric)
      setLoading(false)
    }
  }

  return (
    <>
      {/* Headline block — the gateway's largest element (spec §0 hierarchy),
          so it leads the reveal with no delay. Timing matches every app page
          (640ms, 22px rise); see the motion note in AuthShell. */}
      <div
        className="nv-auth-reveal"
        style={{ flex: '1.1 1 340px', maxWidth: 640 } as CSSProperties}
      >
        <div className="ui-label mb-4" style={{ color: 'var(--nv-auth-eyebrow)' }}>
          {t.auth.brandEyebrow}
        </div>
        <h1
          className="m-0"
          style={{
            fontSize: 'var(--fs-login-headline)',
            lineHeight: 1.06,
            letterSpacing: 'var(--tracking-hero)',
            fontWeight: 650,
            color: 'var(--brand-navy)',
            textWrap: 'balance',
          }}
        >
          {t.auth.headline1}
          <br />
          {t.auth.headline2}
        </h1>
        <p
          style={{
            margin: '20px 0 0',
            fontSize: 'clamp(14.5px, 1.25vw, 16.5px)',
            lineHeight: 1.5,
            color: 'var(--nv-auth-ink-2)',
            maxWidth: '46ch',
            fontWeight: 550,
          }}
        >
          {t.auth.headlineSub}
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--nv-auth-ink-3)', maxWidth: '54ch' }}>
          {t.auth.headlineNote}
        </p>
      </div>

      {/* Panel column — Fable's 402px collapse basis, never narrower than
          min(100%, 330px), so it stacks under the headline on narrow widths.
          Fades rather than translates — it wraps the backdrop-filtered glass
          panel, and moving a blurred surface re-samples its backdrop on every
          frame — and trails the headline by one stagger step, the same cadence
          app pages use between their sections. */}
      <div
        className="nv-auth-fade"
        style={{ flex: '0 1 402px', minWidth: 'min(100%, 330px)', '--nv-auth-delay': 'var(--stagger-reveal)' } as CSSProperties}
      >
        <AuthPanel eyebrow={t.auth.privateAccess} title={t.auth.signInTitle}>
          <p className="mt-1 text-xs" style={HINT_STYLE}>
            {t.auth.signInSubtitle}
          </p>

          {error && (
            <div
              role="alert"
              className="nv-pop mt-3.5 px-3 py-2.5 text-xs font-medium"
              style={{
                background: 'var(--nv-auth-err-bg)',
                border: '1px solid var(--nv-auth-err-bd)',
                color: 'var(--nv-auth-err-fg)',
                borderRadius: 'var(--radius-menu)',
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            {/* Username */}
            <div className="space-y-1.5">
              <label htmlFor="username" className="block" style={LABEL_STYLE}>{t.auth.usernameLabel}</label>
              <input
                id="username"
                type="text"
                required
                autoFocus
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t.auth.usernamePlaceholder}
                className="nv-auth-input"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2.5">
                <label htmlFor="password" className="block" style={LABEL_STYLE}>{t.auth.passwordLabel}</label>
                <Link href="/forgot-password" className="text-xs hover:underline" style={LINK_STYLE}>
                  {t.auth.forgotPassword}
                </Link>
              </div>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t.auth.passwordPlaceholder}
                className="nv-auth-input"
              />
            </div>

            {/* Primary action — navy capsule with spinner state */}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="w-full rounded-full flex items-center justify-center gap-2 nv-transition disabled:opacity-50"
              style={{
                padding: '12px 18px',
                background: 'var(--brand-navy)',
                color: 'var(--primary-fg)',
                fontSize: 14.5,
                fontWeight: 650,
                letterSpacing: '.01em',
                boxShadow: 'var(--nv-sh-button)',
              }}
            >
              {loading && (
                <span
                  aria-hidden="true"
                  className="inline-block w-[15px] h-[15px] rounded-full border-2 nv-spin"
                  style={{ borderColor: 'var(--nv-chip-bd)', borderTopColor: 'var(--primary-fg)' }}
                />
              )}
              {t.auth.submitSignIn}
            </button>

            {/* R1.5 — replaces the create-account toggle. States plainly that
                access is administrator-provisioned; no self-service path. */}
            <p className="text-center text-xs" style={HINT_STYLE}>
              {t.auth.adminProvisioned}
            </p>

            {/* Protected-session line */}
            <div className="flex items-center justify-center gap-2 text-[11px]" style={HINT_STYLE}>
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--nv-auth-secure)' }} />
              {t.auth.sessionProtected}
            </div>
          </form>
        </AuthPanel>

        <div className="text-center mt-4">
          <Link
            href="/"
            className="text-xs nv-transition hover:underline"
            style={{ color: 'var(--nv-auth-onphoto)', textShadow: 'var(--nv-auth-onphoto-shadow)' }}
          >
            ← {t.auth.backToHome}
          </Link>
        </div>
      </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
