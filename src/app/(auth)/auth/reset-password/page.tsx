'use client'

// Landing page after a password-recovery email link. By the time the user
// arrives here, /auth/callback has already exchanged the recovery code, verified
// the approval boundary, and set a session cookie — this page only needs to
// collect and submit the new password. If there's no valid recovery session
// (expired/invalid link), the update call fails with 401 and we show an explicit
// "request a new link" message rather than a generic error.
//
// This page NEVER redirects on its own before the user has had the chance to set
// a password: an invalid recovery session is reported here, in place, so the
// error is legible. The only navigation is the post-success return to /login.
//
// R2 — moved from src/app/auth/reset-password/page.tsx into the (auth) route
// group. The public URL is unchanged (/auth/reset-password) and /auth/callback
// remains a route handler at its own URL; what changed is the shell — this route
// now renders through the group's AuthShell gateway using the same AuthPanel and
// form primitives as /login, instead of the application chrome.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { AuthPanel } from '@/components/fable/AuthPanel'
import {
  AuthField,
  AuthHeadline,
  AuthHint,
  AuthNotice,
  AuthPanelColumn,
  AuthSecondaryLink,
  AuthSubmitButton,
} from '@/components/fable/AuthForm'

/** id of the error banner, referenced by the fields' aria-describedby. */
const ERROR_ID = 'reset-error'

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

  const describedBy = error ? ERROR_ID : undefined

  return (
    <>
      <AuthHeadline
        eyebrow={t.auth.brandEyebrow}
        line1={t.auth.headline1}
        line2={t.auth.headline2}
        lede={t.auth.headlineSub}
        note={t.auth.headlineNote}
      />

      <AuthPanelColumn>
        {/* Eyebrow, title and explanation render in BOTH states, so completing
            the reset changes only the region below them — no head jump. */}
        <AuthPanel eyebrow={t.auth.privateAccess} title={t.auth.newPasswordTitle}>
          <AuthHint className="mt-1">{t.auth.newPasswordSubtitle}</AuthHint>

          {done ? (
            <div className="mt-4 space-y-3.5">
              <AuthNotice variant="success">{t.auth.resetSuccessMessage}</AuthNotice>
              <AuthSecondaryLink href="/login" label={t.auth.haveAccount} />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              {error && <AuthNotice variant="error" id={ERROR_ID}>{error}</AuthNotice>}

              <AuthField
                id="password"
                label={t.auth.newPasswordLabel}
                type="password"
                required
                autoFocus
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                placeholder={t.auth.passwordPlaceholder}
                hint={t.auth.passwordHint}
                describedBy={describedBy}
              />

              <AuthField
                id="confirmPassword"
                label={t.auth.confirmPasswordLabel}
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder={t.auth.passwordPlaceholder}
                describedBy={describedBy}
              />

              <AuthSubmitButton
                label={t.auth.submitNewPassword}
                loading={loading}
                disabled={loading || !password || !confirmPassword}
              />

              <AuthSecondaryLink href="/login" label={t.auth.haveAccount} />
            </form>
          )}
        </AuthPanel>
      </AuthPanelColumn>
    </>
  )
}
