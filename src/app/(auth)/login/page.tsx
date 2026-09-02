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
// R2 — the field / notice / button / link markup this page introduced now lives
// in components/fable/AuthForm.tsx, so the two recovery routes render from the
// same implementation instead of copying it. Purely a composition change: every
// endpoint, payload, guard, error mapping and disabled expression below is
// unchanged, and the rendered markup is equivalent.
//
// Fable's simulated auth, passkey, demo-credentials chip, remember-device switch
// and show/hide-password control are deliberately NOT carried over.

import { useState, Suspense, type CSSProperties } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { AuthPanel } from '@/components/fable/AuthPanel'
import {
  AuthField,
  AuthHeadline,
  AuthHint,
  AuthNotice,
  AuthPanelColumn,
  AuthSubmitButton,
} from '@/components/fable/AuthForm'
import { toSafeInternalPath } from '@/lib/auth/safeRedirect'

function errorKeyToMessage(t: ReturnType<typeof useLang>['t'], code: string): string {
  // /api/auth/login answers `invalid_credentials`, `invalid_json`,
  // `not_configured` or `lookup_unavailable`; everything else falls through to
  // the generic message. The former create-account codes are gone with the
  // endpoint.
  //
  // POST-R13.6R1.1 — only a genuine credential refusal may say so. The two
  // deployment-side failures (`not_configured`, `lookup_unavailable`) are
  // deliberately NOT mapped here: telling someone their password is wrong when
  // the server could not look anything up is what makes a configuration fault
  // unfindable.
  switch (code) {
    case 'invalid_credentials': return t.auth.errInvalidCredentials
    case 'lookup_unavailable':  return t.auth.errAccessUnavailable
    default:                    return t.auth.errorGeneric
  }
}

/** Maps a ?error= value set by a server redirect onto a user-facing message. */
function callbackErrorToMessage(t: ReturnType<typeof useLang>['t'], code: string): string {
  switch (code) {
    // Set by /auth/callback and by middleware when a verified Auth identity has
    // no approved application profile — an account that exists in Supabase but
    // was never provisioned for this platform.
    case 'not_authorized':
      return t.auth.errNotAuthorized
    // R13.6F — provisioned, but switched off by an administrator. A third distinct
    // message: telling a disabled user they are "not authorized" would send them
    // asking to be set up again, when their account, role, principal and grants are
    // all still there and one reactivation away.
    case 'account_disabled':
      return t.auth.errAccountDisabled
    // R13.6F — invited, never accepted. The remedy is the invitation link, not an
    // access change, so it must not read like either of the two above.
    case 'account_not_activated':
      return t.auth.errAccountNotActivated
    // POST-R13.6CDE.1 — approved, but granted no module, so there is no
    // application to enter. Deliberately a DIFFERENT message from the one above:
    // this account is provisioned and the administrator needs to grant it
    // something, not create it again. It says nothing about which modules exist.
    case 'no_platform_access':
      return t.auth.errNoPlatformAccess
    // POST-R13.6CDE.2 — inside the platform, but that page belongs to a module
    // this account does not hold. A third distinct message: the account is
    // provisioned AND may enter, so telling it either of the two above would
    // send the reader after the wrong problem. It names no module, because
    // which modules exist is not something a denied caller needs to learn.
    case 'module_not_granted':
      return t.auth.errModuleNotGranted
    // A role capability, which no module grant can ever satisfy. Separate from
    // the message above so an administrator reading a report knows the request
    // failed on ROLE, not on a missing grant they could simply add.
    case 'administrator_required':
      return t.auth.errAdministratorRequired
    // The entitlement store could not be read. Not the account's fault, and not
    // a denial — so it must not read like one.
    case 'module_access_unavailable':
      return t.auth.errAccessUnavailable
    default:
      return t.auth.errorCallback
  }
}

const HINT_STYLE: CSSProperties = { color: 'var(--nv-auth-ink-3)' }
const LINK_STYLE: CSSProperties = { color: 'var(--nv-auth-link)' }

/** id of the error banner, referenced by the fields' aria-describedby. */
const ERROR_ID = 'login-error'

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

  const describedBy = error ? ERROR_ID : undefined

  return (
    <>
      {/* Identity column — shared with both recovery routes, so all three read
          as one gateway. Timing matches every app page (640ms, 22px rise); see
          the motion note in AuthShell. */}
      <AuthHeadline
        eyebrow={t.auth.brandEyebrow}
        line1={t.auth.headline1}
        line2={t.auth.headline2}
        lede={t.auth.headlineSub}
        note={t.auth.headlineNote}
      />

      <AuthPanelColumn>
        <AuthPanel eyebrow={t.auth.privateAccess} title={t.auth.signInTitle}>
          <AuthHint className="mt-1">{t.auth.signInSubtitle}</AuthHint>

          {error && <AuthNotice variant="error" id={ERROR_ID}>{error}</AuthNotice>}

          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            <AuthField
              id="username"
              label={t.auth.usernameLabel}
              type="text"
              required
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={setUsername}
              placeholder={t.auth.usernamePlaceholder}
              describedBy={describedBy}
            />

            <AuthField
              id="password"
              label={t.auth.passwordLabel}
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              placeholder={t.auth.passwordPlaceholder}
              describedBy={describedBy}
              action={
                <Link href="/forgot-password" className="text-xs hover:underline" style={LINK_STYLE}>
                  {t.auth.forgotPassword}
                </Link>
              }
            />

            <AuthSubmitButton
              label={t.auth.submitSignIn}
              loading={loading}
              disabled={loading || !username.trim() || !password}
            />

            {/* R1.5 — replaces the create-account toggle. States plainly that
                access is administrator-provisioned; no self-service path. */}
            <AuthHint className="text-center">{t.auth.adminProvisioned}</AuthHint>

            {/* Protected-session line */}
            <div className="flex items-center justify-center gap-2 text-[11px]" style={HINT_STYLE}>
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--nv-auth-secure)' }} />
              {t.auth.sessionProtected}
            </div>
          </form>
        </AuthPanel>
      </AuthPanelColumn>
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
