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
  emailSent?: boolean
  emailFailure?: unknown
  reusedAuthIdentity?: boolean
  error?: unknown
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
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Set once the account exists. `emailSent: false` is the success-with-caveat state. */
  const [sent, setSent] = useState<{ userId: string; emailSent: boolean } | null>(null)
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
        }),
      })
      const json = (await res.json().catch(() => null)) as InviteResponse | null
      if (!res.ok || json?.ok !== true || typeof json.userId !== 'string') {
        setError(provisioningErrorMessage(t, json?.error))
        return
      }
      setSent({ userId: json.userId, emailSent: json.emailSent === true })
      void onInvited()
    } catch {
      setError(t.usersAccess.errGeneric)
    } finally {
      setSending(false)
    }
  }

  async function resendInvitation() {
    if (!sent || resend === 'sending') return
    setResend('sending')
    try {
      const res = await fetch(`/api/admin/users/${sent.userId}/invitation`, { method: 'POST' })
      const json = (await res.json().catch(() => null)) as InviteResponse | null
      setResend(res.ok && json?.ok === true && json.emailSent === true ? 'sent' : 'failed')
    } catch {
      setResend('failed')
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t.usersAccess.inviteTitle}
      description={t.usersAccess.inviteDescription}
      size="lg"
      dismissDisabled={sending}
      footer={
        sent ? (
          <button
            type="button"
            onClick={onClose}
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
            <ChipButton onClick={onClose} disabled={sending}>
              {t.usersAccess.cancel}
            </ChipButton>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending}
              aria-busy={sending || undefined}
              className="h-8 px-4 rounded-full bg-primary text-primary-fg text-xs font-medium disabled:opacity-50 nv-transition"
            >
              {sending ? t.usersAccess.sendingInvite : t.usersAccess.sendInvite}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-positive" role="status">
            {t.usersAccess.inviteSent}
          </p>
          {sent.emailSent ? (
            <p className="text-sm text-foreground">{t.usersAccess.inviteSentBody}</p>
          ) : (
            <>
              {/* Success with a caveat — the account exists; only the email failed. */}
              <p role="status" className="ui-meta rounded-[var(--radius-input)] border px-3 py-2.5" style={warnBoxStyle}>
                {t.usersAccess.inviteEmailNotDelivered}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <ChipButton
                  onClick={() => void resendInvitation()}
                  disabled={resend === 'sending'}
                  aria-busy={resend === 'sending' || undefined}
                >
                  {resend === 'sending' ? t.usersAccess.resendingInvite : t.usersAccess.resendInvite}
                </ChipButton>
                {resend === 'sent' && <span className="ui-meta text-positive">{t.usersAccess.resendSent}</span>}
                {resend === 'failed' && <span className="ui-meta text-negative">{t.usersAccess.resendNotDelivered}</span>}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
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
