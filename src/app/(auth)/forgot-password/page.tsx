'use client'

// Password-reset request page. Asks only for the recovery email (username is
// never resolved to an email client-side, per the Phase 6B privacy rule), and
// always shows the same generic "check your email" confirmation regardless of
// whether the account exists.
//
// R2 — moved from src/app/forgot-password/page.tsx into the (auth) route group.
// The public URL is unchanged (/forgot-password); what changed is the shell:
// this route now renders through the group's AuthShell gateway instead of the
// application chrome, using the same AuthPanel and form primitives as /login.
// Behaviour is carried over verbatim — same endpoint, same payload, same
// fire-and-forget error handling, and the same single generic sent state that
// makes a real address indistinguishable from an unknown one.
//
// The pre-Fable page's "← Back to dashboard" link is deliberately dropped: it
// pointed at a private route from a page only signed-out users reach, and the
// in-panel "Back to sign in" is the meaningful way out.

import { useState } from 'react'
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
    <>
      <AuthHeadline
        eyebrow={t.auth.brandEyebrow}
        line1={t.auth.headline1}
        line2={t.auth.headline2}
        lede={t.auth.headlineSub}
        note={t.auth.headlineNote}
      />

      <AuthPanelColumn>
        {/* Eyebrow, title and explanation render in BOTH states, so submitting
            changes only the region below them — the panel head never jumps. */}
        <AuthPanel eyebrow={t.auth.privateAccess} title={t.auth.forgotPasswordTitle}>
          <AuthHint className="mt-1">{t.auth.forgotPasswordSubtitle}</AuthHint>

          {sent ? (
            <div className="mt-4 space-y-3.5">
              {/* Deliberately generic: this same confirmation appears whether or
                  not an account exists for the address, and the endpoint itself
                  always answers ok:true. Nothing here may become conditional on
                  the result. */}
              <AuthNotice variant="success">
                <span className="block font-semibold">{t.auth.resetLinkSentTitle}</span>
                <span className="block mt-1">{t.auth.resetLinkSentMessage}</span>
              </AuthNotice>
              <AuthSecondaryLink href="/login" label={t.auth.haveAccount} />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              <AuthField
                id="email"
                label={t.auth.emailLabel}
                type="email"
                required
                autoFocus
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={setEmail}
                placeholder={t.auth.emailPlaceholder}
                hint={t.auth.emailHint}
              />

              <AuthSubmitButton
                label={t.auth.sendResetLink}
                loading={loading}
                disabled={loading || !email.trim()}
              />

              <AuthSecondaryLink href="/login" label={t.auth.haveAccount} />
            </form>
          )}
        </AuthPanel>
      </AuthPanelColumn>
    </>
  )
}
