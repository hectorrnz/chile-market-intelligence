'use client'

// R13.6F — the Manage dialog for one existing account: role, Portfolio
// principal and module grants edited together (one PUT, one transaction
// server-side), plus the lifecycle actions — resend invitation, disable,
// reactivate.
//
// PRESENTATION ONLY. Every action re-authorizes on its own request, and the
// binding refusals — `last_administrator` above all — come from the database,
// not from anything this dialog decides. The dialog only has to report them
// honestly (§9: the final active administrator cannot be disabled or demoted).
//
// THE DIRECTORY TABLE STAYS THE PICTURE OF STORED ROWS. This dialog holds a
// DRAFT; the table behind it is never updated optimistically, and after any
// failed write the directory is re-read so what sits under the dialog is what
// is actually stored.
//
// TWO CONFIRMATIONS, BOTH IN THE APP'S OWN DIALOG — never `window.confirm`:
//   · saving a member shape with zero modules while the account can currently
//     enter the platform (access is being taken away entirely);
//   · disabling the account. The copy states what §18 guarantees: history,
//     grants, role and principal are preserved, and the action is reversible.
// Both are rendered as SIBLINGS of the main shell, not children, so their
// `position: fixed` overlay can never be trapped by an ancestor transform.
//
// A DISABLED ACCOUNT'S ACCESS FORM IS LOCKED. The directory payload flattens a
// disabled account's effective access (that is what the platform would really
// grant: nothing), so editing role/principal/modules from that flattened view
// could silently rewrite the preserved grants. Reactivate first — which
// restores exactly the stored access — then edit.

import { useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { ModalShell, DestructiveConfirm } from '@/components/fable/ModalShell'
import { ChipButton, ChipLabel } from '@/components/fable/Chip'
import { formatDate } from '@/lib/formatters'
import type { DirectoryUser } from '@/lib/admin/userDirectory'
import type {
  AssignableRole,
  ModuleKey,
  PortfolioPrincipal,
} from '@/lib/admin/userProvisioning'
import {
  AccountAccessFields,
  accountShapeOf,
  provisioningErrorMessage,
} from './AccountAccessFields'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

interface LifecycleResponse {
  ok?: boolean
  changed?: boolean
  status?: string | null
  emailSent?: boolean
  error?: unknown
}

interface ManageUserDialogProps {
  open: boolean
  /** The live directory row — refreshed by the parent after every reload. */
  user: DirectoryUser | null
  onClose: () => void
  /** Re-reads the directory, so the table always shows stored state. */
  reload: () => Promise<void>
}

export function ManageUserDialog({ open, user, onClose, reload }: ManageUserDialogProps) {
  const { t } = useLang()
  const [role, setRole] = useState<AssignableRole>('user')
  const [principal, setPrincipal] = useState<PortfolioPrincipal | null>(null)
  const [modules, setModules] = useState<ModuleKey[]>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  // Re-seed the draft whenever the dialog opens on a (possibly different)
  // account — the render-time previous-value pattern, never an effect.
  const key = open && user ? user.id : null
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (key !== prevKey) {
    setPrevKey(key)
    if (key !== null && user) {
      setRole(user.isAdministrator ? 'administrator' : 'user')
      setPrincipal(user.principal)
      setModules(user.modules)
      setSaveState('idle')
      setError(null)
      setConfirmRevoke(false)
      setConfirmDisable(false)
      setLifecycleBusy(false)
      setResend('idle')
    }
  }

  if (!open || !user) return null

  const isDisabled = user.status === 'disabled'
  const shape = accountShapeOf(role, principal, modules)
  const storedRole: AssignableRole = user.isAdministrator ? 'administrator' : 'user'
  const dirty =
    shape.role !== storedRole ||
    shape.principal !== user.principal ||
    !sameSet(shape.modules, user.modules)

  const saving = saveState === 'saving'
  const busy = saving || lifecycleBusy || resend === 'sending'

  function toggleModule(m: ModuleKey) {
    setModules((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
    setSaveState('idle')
  }

  /**
   * The Save button's handler. A save that leaves a member with no modules
   * while the account can currently enter the platform removes its access to
   * the whole application — that one goes through the app's own confirm first.
   * Every other save applies directly.
   */
  function requestSave() {
    if (!user || !dirty || busy || isDisabled) return
    if (shape.role === 'user' && shape.modules.length === 0 && user.hasPlatformAccess) {
      setConfirmRevoke(true)
      return
    }
    void save()
  }

  async function save() {
    if (!user || !dirty || isDisabled) return
    setConfirmRevoke(false)
    setSaveState('saving')
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: shape.role,
          principal: shape.principal,
          modules: shape.modules,
        }),
      })
      const json = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (!res.ok) {
        setSaveState('error')
        setError(provisioningErrorMessage(t, json?.error))
        // The table behind must keep showing stored state, whatever failed.
        await reload()
        return
      }
      setSaveState('saved')
      await reload()
    } catch {
      setSaveState('error')
      setError(t.usersAccess.errGeneric)
      await reload()
    }
  }

  async function setLifecycle(action: 'disable' | 'reactivate') {
    if (!user || lifecycleBusy) return
    setLifecycleBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json().catch(() => null)) as LifecycleResponse | null
      if (!res.ok) {
        setError(
          json?.error === 'last_administrator'
            ? t.usersAccess.errLastAdministrator
            : t.usersAccess.lifecycleFailed,
        )
      }
      await reload()
    } catch {
      setError(t.usersAccess.lifecycleFailed)
    } finally {
      setLifecycleBusy(false)
      setConfirmDisable(false)
    }
  }

  async function resendInvitation() {
    if (!user || resend === 'sending') return
    setResend('sending')
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/invitation`, { method: 'POST' })
      const json = (await res.json().catch(() => null)) as LifecycleResponse | null
      if (res.ok && json?.ok === true && json.emailSent === true) {
        setResend('sent')
      } else {
        setResend('failed')
        if (json?.error) setError(provisioningErrorMessage(t, json.error))
      }
    } catch {
      setResend('failed')
    }
  }

  const statusDot: Record<DirectoryUser['status'], string> = {
    active: 'var(--positive)',
    invited: 'var(--accent)',
    disabled: 'var(--warning)',
    unprovisioned: 'var(--muted-fg)',
  }

  const stamps: string[] = []
  if (user.invitedAt) stamps.push(`${t.usersAccess.invitedOn} ${formatDate(user.invitedAt)}`)
  if (user.activatedAt) stamps.push(`${t.usersAccess.activatedOn} ${formatDate(user.activatedAt)}`)
  if (user.disabledAt) stamps.push(`${t.usersAccess.disabledOn} ${formatDate(user.disabledAt)}`)

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        title={user.displayName ?? user.username ?? user.id}
        description={
          user.username ? (
            <>
              <span className="font-mono">{user.username}</span>
              {user.email ? ` · ${user.email}` : null}
            </>
          ) : (
            user.email ?? undefined
          )
        }
        size="lg"
        dismissDisabled={busy || confirmRevoke || confirmDisable}
        footer={
          <>
            {saveState === 'saved' && (
              <span className="ui-meta text-positive min-w-0" role="status">
                {t.usersAccess.saved}
              </span>
            )}
            {error && (
              <span role="alert" className="ui-meta text-negative min-w-0">
                {error}
              </span>
            )}
            <ChipButton onClick={onClose} disabled={busy}>
              {t.usersAccess.close}
            </ChipButton>
            <button
              type="button"
              onClick={requestSave}
              disabled={!dirty || busy || isDisabled}
              aria-busy={saving || undefined}
              className="h-8 px-4 rounded-full bg-primary text-primary-fg text-xs font-medium disabled:opacity-50 nv-transition"
            >
              {saving ? t.usersAccess.saving : t.usersAccess.save}
            </button>
          </>
        }
      >
        <div className="flex flex-col">
          {/* ── Lifecycle: status, timestamps, actions ─────────────────── */}
          <div className="pb-4 flex flex-col gap-2.5">
            <h3 className="ui-label text-muted-fg">{t.usersAccess.lifecycleHeading}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <ChipLabel>
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: statusDot[user.status] }}
                  aria-hidden="true"
                />
                {t.usersAccess.statusWord[user.status]}
              </ChipLabel>
              {stamps.length > 0 && (
                <span className="ui-meta text-muted-fg min-w-0">{stamps.join(' · ')}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Resend exists ONLY while the invitation is still the account's state. */}
              {user.status === 'invited' && (
                <ChipButton
                  onClick={() => void resendInvitation()}
                  disabled={busy}
                  aria-busy={resend === 'sending' || undefined}
                >
                  {resend === 'sending' ? t.usersAccess.resendingInvite : t.usersAccess.resendInvite}
                </ChipButton>
              )}
              {(user.status === 'active' || user.status === 'invited') && (
                <ChipButton
                  onClick={() => setConfirmDisable(true)}
                  disabled={busy}
                  style={{ color: 'var(--negative)' }}
                >
                  {t.usersAccess.disableAccount}
                </ChipButton>
              )}
              {isDisabled && (
                <ChipButton
                  onClick={() => void setLifecycle('reactivate')}
                  disabled={busy}
                  aria-busy={lifecycleBusy || undefined}
                >
                  {lifecycleBusy ? t.usersAccess.reactivating : t.usersAccess.reactivateAccount}
                </ChipButton>
              )}
              {resend === 'sent' && <span className="ui-meta text-positive">{t.usersAccess.resendSent}</span>}
              {resend === 'failed' && !error && (
                <span className="ui-meta text-negative">{t.usersAccess.resendNotDelivered}</span>
              )}
            </div>
            {isDisabled && (
              <p className="ui-meta text-muted-fg rounded-[var(--radius-input)] border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] px-3 py-2.5">
                {t.usersAccess.disabledEditNote}
              </p>
            )}
          </div>

          {/* ── Role · principal · modules — the shared fieldset ───────── */}
          <div className="border-t border-[var(--nv-line)] pt-4">
            <AccountAccessFields
              role={role}
              principal={principal}
              modules={modules}
              onRoleChange={(r) => { setRole(r); setSaveState('idle') }}
              onPrincipalChange={(p) => { setPrincipal(p); setSaveState('idle') }}
              onToggleModule={toggleModule}
              busy={busy || isDisabled}
            />
          </div>
        </div>
      </ModalShell>

      {/* Removing the last module removes the platform — confirmed in the
          app's own dialog, never `window.confirm`. */}
      <DestructiveConfirm
        open={confirmRevoke}
        title={t.usersAccess.revokeAllTitle}
        description={user.displayName ?? user.username ?? undefined}
        confirmLabel={t.usersAccess.revokeAllConfirm}
        cancelLabel={t.usersAccess.cancel}
        pending={saving}
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => void save()}
      >
        <p className="text-sm text-foreground">{t.usersAccess.revokeAllBody}</p>
      </DestructiveConfirm>

      {/* Disable preserves history, grants, role and principal — reversible. */}
      <DestructiveConfirm
        open={confirmDisable}
        title={t.usersAccess.disableConfirmTitle}
        description={user.displayName ?? user.username ?? undefined}
        confirmLabel={lifecycleBusy ? t.usersAccess.disabling : t.usersAccess.disableConfirmAction}
        cancelLabel={t.usersAccess.cancel}
        pending={lifecycleBusy}
        onCancel={() => setConfirmDisable(false)}
        onConfirm={() => void setLifecycle('disable')}
      >
        <p className="text-sm text-foreground">{t.usersAccess.disableConfirmBody}</p>
      </DestructiveConfirm>
    </>
  )
}
