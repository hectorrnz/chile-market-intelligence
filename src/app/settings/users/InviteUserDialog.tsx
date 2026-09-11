'use client'

// R13.6F — the "Invite user" dialog.
//
// PRESENTATION ONLY. Submitting POSTs `/api/admin/users`, which re-authorizes
// the caller and re-validates the whole request server-side; nothing here is a
// permission check, and the draft below is never shown as stored state.
//
// EMAIL NOT DELIVERED IS SUCCESS WITH A CAVEAT, NOT AN ERROR (§13). A 200 with
// `emailSent: false` means the account exists, correctly restricted — only the
// activation email failed. The dialog says exactly that and offers a resend,
// rather than inviting the administrator to re-create an account that is
// already there.
//
// D0B1 — TWO WAYS TO DELIVER, CHOSEN EXPLICITLY
// ─────────────────────────────────────────────
// Outbound email is deferred (no verified sending domain), so an invitation
// cannot currently reach an arbitrary work address. MANUAL is therefore the
// default: the server returns the one-time URL on the creation response and the
// administrator carries it themselves.
//
// The URL IS A CREDENTIAL and is handled as one here. It lives in this
// component's state and nowhere else — not in localStorage, not in a ref that
// outlives the dialog, not in a query string. `dismiss()` clears it before the
// dialog closes, so reopening cannot show it again and neither can anything
// else: the application stores no copy. If it is lost, re-inviting mints a fresh
// token and supersedes the old one.
//
// THE STARTING SWITCHES ARE FORM INITIALISATION AND NOTHING ELSE. They come
// from `defaultModulesForNewMember()` over a mirror of the `app_modules` seed
// (migration 20260814000000): every module defaults ON for a new member except
// Structured Notes. The submitted array is what is saved — runtime
// authorization never consults this metadata, and unticking a default is fully
// respected.

import { useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { ModalShell } from '@/components/fable/ModalShell'
import { ChipButton } from '@/components/fable/Chip'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import type { InviteDeliveryMode } from '@/lib/admin/inviteDelivery'
import { InvitationLinkPanel } from './InvitationLinkPanel'
import { APP_MODULE_KEYS } from '@/lib/auth/moduleAccess'
import {
  defaultModulesForNewMember,
  type AssignableRole,
  type ModuleKey,
  type ModuleRegistryRow,
  type PortfolioPrincipal,
} from '@/lib/admin/userProvisioning'
import {
  normalizeUsername,
  isValidUsername,
  isValidEmail,
  isValidDisplayName,
} from '@/lib/auth/credentials'
import {
  AccountAccessFields,
  accountShapeOf,
  provisioningErrorMessage,
  warnBoxStyle,
} from './AccountAccessFields'

/** Mirror of the `app_modules` seed, consumed ONLY by the form initializer below. */
const INVITE_FORM_REGISTRY: ModuleRegistryRow[] = APP_MODULE_KEYS.map((k) => ({
  module_key: k,
  default_for_member: k !== 'structured_notes',
}))

const INITIAL_MEMBER_MODULES: ModuleKey[] = defaultModulesForNewMember(INVITE_FORM_REGISTRY)

/** The Fable chip/input material (the recipe the Watchlist form established). */
const FIELD =
  'h-8 w-full rounded-[var(--radius-input)] border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] px-3 text-xs text-foreground placeholder:text-muted-fg focus:border-accent nv-transition'

interface InviteResponse {
  ok?: boolean
  userId?: string
  delivery?: unknown
  emailSent?: boolean
  emailFailure?: unknown
  reusedAuthIdentity?: boolean
  /** Present only on a manual invitation, and only on this one response. */
  invitationUrl?: unknown
  error?: unknown
}

/** What the dialog holds after a successful invitation. */
interface InviteResult {
  userId: string
  delivery: InviteDeliveryMode
  emailSent: boolean
  /** The one-time URL. Cleared by `dismiss()` — see the header. */
  invitationUrl: string | null
}

interface InviteUserDialogProps {
  open: boolean
  onClose: () => void
  /** Called after a successful invite so the directory behind refreshes. */
  onInvited: () => void | Promise<void>
}

export function InviteUserDialog({ open, onClose, onInvited }: InviteUserDialogProps) {
  const { t } = useLang()
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AssignableRole>('user')
  const [principal, setPrincipal] = useState<PortfolioPrincipal | null>(null)
  const [modules, setModules] = useState<ModuleKey[]>(INITIAL_MEMBER_MODULES)
  /**
   * MANUAL by default, because email delivery is not currently operational for an
   * arbitrary recipient. An administrator who wants email must ask for it.
   */
  const [delivery, setDelivery] = useState<InviteDeliveryMode>('manual')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set once the account exists. `emailSent: false` is the success-with-caveat state. */
  const [sent, setSent] = useState<InviteResult | null>(null)
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  // Reset to a fresh form each time the dialog opens — the render-time
  // previous-value pattern (never an effect calling setState).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setDisplayName('')
      setUsername('')
      setEmail('')
      setRole('user')
      setPrincipal(null)
      setModules(INITIAL_MEMBER_MODULES)
      setDelivery('manual')
      setSending(false)
      setError(null)
      setSent(null)
      setResend('idle')
    }
  }

  function toggleModule(m: ModuleKey) {
    setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
  }

  async function submit() {
    if (sending || sent) return
    const uname = normalizeUsername(username)
    if (!isValidDisplayName(displayName)) { setError(t.usersAccess.errInvalidDisplayName); return }
    if (!isValidUsername(uname)) { setError(t.usersAccess.errInvalidUsername); return }
    if (!isValidEmail(email)) { setError(t.usersAccess.errInvalidEmail); return }

    // Canonicalized through the same pure function the server runs, so the
    // request already says what will be stored (an administrator's principal
    // and modules collapse here, not as a server surprise).
    const shape = accountShapeOf(role, principal, modules)
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: uname,
          email: email.trim(),
          displayName: displayName.trim(),
          role: shape.role,
          principal: shape.principal,
          modules: shape.modules,
          delivery,
        }),
      })
      const json = (await res.json().catch(() => null)) as InviteResponse | null
      if (!res.ok || json?.ok !== true || typeof json.userId !== 'string') {
        setError(provisioningErrorMessage(t, json?.error))
        return
      }
      setSent({
        userId: json.userId,
        delivery: json.delivery === 'manual' ? 'manual' : 'email',
        emailSent: json.emailSent === true,
        invitationUrl: typeof json.invitationUrl === 'string' ? json.invitationUrl : null,
      })
      void onInvited()
    } catch {
      setError(t.usersAccess.errGeneric)
    } finally {
      setSending(false)
    }
  }

  /**
   * Re-invites the account that was just created, in the requested mode.
   *
   * Used two ways from the success state: retry an email that did not go out, or
   * — because email delivery is currently unproven — switch to a manual link
   * instead. Both mint a FRESH token; neither recovers the previous one, because
   * nothing kept it. Choosing manual here is the administrator's explicit act,
   * never an automatic fallback from a failed send.
   */
  async function reinvite(mode: InviteDeliveryMode) {
    if (!sent || resend === 'sending') return
    setResend('sending')
    try {
      const res = await fetch(`/api/admin/users/${sent.userId}/invitation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery: mode }),
      })
      const json = (await res.json().catch(() => null)) as InviteResponse | null
      if (!res.ok || json?.ok !== true) {
        setResend('failed')
        return
      }
      if (mode === 'manual') {
        const url = typeof json.invitationUrl === 'string' ? json.invitationUrl : null
        if (!url) {
          setResend('failed')
          return
        }
        // Replaces the success state with the manual one: the old token is now
        // superseded, so showing it alongside the new one would be showing a
        // link that no longer works.
        setSent({ ...sent, delivery: 'manual', emailSent: false, invitationUrl: url })
        setResend('idle')
        return
      }
      setResend(json.emailSent === true ? 'sent' : 'failed')
    } catch {
      setResend('failed')
    }
  }

  /**
   * Closes the dialog, dropping the invitation URL first.
   *
   * §3 — the link is deliberately not recoverable. Clearing it here is what makes
   * that true in the browser as well as on the server: after this, the only way
   * back to a working link is to mint a new one.
   */
  function dismiss() {
    setSent(null)
    setResend('idle')
    onClose()
  }

  return (
    <ModalShell
      open={open}
      onClose={dismiss}
      title={t.usersAccess.inviteTitle}
      description={sent ? undefined : t.usersAccess.inviteDescription}
      size="lg"
      dismissDisabled={sending}
      footer={
        sent ? (
          <button
            type="button"
            onClick={dismiss}
            className="h-8 px-4 rounded-full bg-primary text-primary-fg text-xs font-medium nv-transition"
          >
            {t.usersAccess.done}
          </button>
        ) : (
          <>
            {error && (
              <span role="alert" className="ui-meta text-negative min-w-0">
                {error}
              </span>
            )}
            <ChipButton onClick={dismiss} disabled={sending}>
              {t.usersAccess.cancel}
            </ChipButton>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending}
              aria-busy={sending || undefined}
              className="h-8 px-4 rounded-full bg-primary text-primary-fg text-xs font-medium disabled:opacity-50 nv-transition"
            >
              {sending
                ? delivery === 'manual'
                  ? t.usersAccess.creatingInvite
                  : t.usersAccess.sendingInvite
                : delivery === 'manual'
                  ? t.usersAccess.createInvite
                  : t.usersAccess.sendInvite}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col gap-3 min-w-0">
          <p className="text-sm font-medium text-positive" role="status">
            {sent.delivery === 'manual' ? t.usersAccess.inviteCreated : t.usersAccess.inviteSent}
          </p>

          {/* MANUAL — the one-time URL, shown once and cleared on close. */}
          {sent.delivery === 'manual' && sent.invitationUrl ? (
            <InvitationLinkPanel
              url={sent.invitationUrl}
              recipient={displayName.trim() || email.trim()}
            />
          ) : sent.emailSent ? (
            <p className="text-sm text-foreground">{t.usersAccess.inviteSentBody}</p>
          ) : (
            <>
              {/* Success with a caveat — the account exists; only the email failed. */}
              <p role="status" className="ui-meta rounded-[var(--radius-input)] border px-3 py-2.5" style={warnBoxStyle}>
                {t.usersAccess.inviteEmailNotDelivered}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ChipButton
                  onClick={() => void reinvite('email')}
                  disabled={resend === 'sending'}
                  aria-busy={resend === 'sending' || undefined}
                >
                  {resend === 'sending' ? t.usersAccess.resendingInvite : t.usersAccess.resendInvite}
                </ChipButton>
                {/* An EXPLICIT switch to manual, never an automatic fallback. */}
                <ChipButton onClick={() => void reinvite('manual')} disabled={resend === 'sending'}>
                  {t.usersAccess.switchToManualLink}
                </ChipButton>
                {resend === 'sent' && <span className="ui-meta text-positive">{t.usersAccess.resendSent}</span>}
                {resend === 'failed' && <span className="ui-meta text-negative">{t.usersAccess.resendNotDelivered}</span>}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 min-w-0">
          {/* ── Delivery ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2 min-w-0">
            <span className="ui-label text-muted-fg">{t.usersAccess.deliveryHeading}</span>
            <SegmentedControl<InviteDeliveryMode>
              options={[
                { value: 'manual', label: t.usersAccess.deliveryManual },
                { value: 'email', label: t.usersAccess.deliveryEmail },
              ]}
              value={delivery}
              onChange={setDelivery}
              ariaLabel={t.usersAccess.deliveryHeading}
              remeasureToken={t.usersAccess.deliveryManual}
              className="self-start max-w-full"
            />
            <p className="ui-meta text-muted-fg">
              {delivery === 'manual' ? t.usersAccess.deliveryManualNote : t.usersAccess.deliveryEmailNote}
            </p>
          </div>

          {/* ── Identity ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor="invite-display-name" className="ui-label text-muted-fg">
                {t.usersAccess.fieldDisplayName}
              </label>
              <input
                id="invite-display-name"
                type="text"
                maxLength={60}
                autoComplete="off"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={sending}
                className={FIELD}
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor="invite-username" className="ui-label text-muted-fg">
                {t.usersAccess.fieldUsername}
              </label>
              <input
                id="invite-username"
                type="text"
                maxLength={30}
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={sending}
                aria-describedby="invite-username-hint"
                className={`${FIELD} font-mono`}
              />
              <p id="invite-username-hint" className="ui-meta text-muted-fg">
                {t.usersAccess.usernameHint}
              </p>
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <label htmlFor="invite-email" className="ui-label text-muted-fg">
                {t.usersAccess.fieldEmail}
              </label>
              <input
                id="invite-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                placeholder="name@company.com"
                className={`${FIELD} font-mono`}
              />
            </div>
          </div>

          {/* ── Role · principal · modules — the shared fieldset ─────── */}
          <div className="border-t border-[var(--nv-line)] pt-4">
            <AccountAccessFields
              role={role}
              principal={principal}
              modules={modules}
              onRoleChange={setRole}
              onPrincipalChange={setPrincipal}
              onToggleModule={toggleModule}
              busy={sending}
            />
          </div>
        </div>
      )}
    </ModalShell>
  )
}
