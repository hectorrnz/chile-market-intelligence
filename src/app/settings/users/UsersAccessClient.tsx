'use client'

// R13.6F — the administrator Users & Access console: the account directory,
// the "Invite user" action, and the per-account Manage dialog.
//
// PRESENTATION ONLY. Rendered after the server component has already confirmed
// the caller is an administrator, and every action it offers is re-authorized
// server-side on its own request. Nothing here is a permission check.
//
// THE TABLE IS A PICTURE OF STORED ROWS, NOT AN INTENT
// ────────────────────────────────────────────────────
// Every cell below renders what `/api/admin/users` reports as stored — status
// from the lifecycle timestamps, access from explicit `user_module_grants`
// rows, platform access from the SAME predicate middleware refuses with. The
// table is never updated optimistically: drafts live in the dialogs, and after
// any save (successful or failed) the directory is re-read, so what is on
// screen is what is actually stored.
//
// STATUS AND ACCESS ARE DIFFERENT FACTS AND GET DIFFERENT COLUMNS (§21)
// ─────────────────────────────────────────────────────────────────────
// Status describes the ACCOUNT's lifecycle — Active / Invited / Disabled /
// Unprovisioned, derived from timestamps, never fabricated. Access describes
// REACH — all modules by role, the granted module set, or no platform access
// at all. An ACTIVE member holding zero grants is `Active` + "No platform
// access", never "Disabled": conflating the two would tell an administrator an
// account was switched off when it was merely left without modules.
//
// PORTFOLIO SCOPE IS A STATEMENT, NEVER A CONTROL. The Manage dialog shows the
// principal's frozen ceiling and the effective (ceiling ∩ grants) result as
// text — scopes outside the ceiling are unreachable by construction, not by
// configuration, so no checkbox may imply otherwise.

import { useCallback, useEffect, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { TableCard } from '@/components/fable/TableCard'
import { ChipButton, ChipLabel } from '@/components/fable/Chip'
import { Reveal } from '@/components/fable/motion'
import type { ModuleKey } from '@/lib/auth/moduleAccess'
import type { AccountStatus } from '@/lib/auth/accountLifecycle'
import type { DirectoryUser } from '@/lib/admin/userDirectory'
import { PRINCIPAL_LABEL } from './AccountAccessFields'
import { InviteUserDialog } from './InviteUserDialog'
import { ManageUserDialog } from './ManageUserDialog'

type LoadState = 'loading' | 'ready' | 'error'

// The Fable dense-table cell rhythm (same recipe the Watchlist and the
// Alternatives holdings tables use).
const CELL = 'py-2.5 px-3 first:pl-4 last:pr-4'

// One hairline opens the access column group (Role · Principal · Access), so
// the row reads as identity + access rather than seven equal columns — the
// same divider idiom the Alternatives holdings table established.
const GROUP_EDGE = { borderLeft: '1px solid var(--nv-line)' } as const

// Header cells keep a high-opacity fill so the uppercase labels never sit on
// low-opacity glass (design_principles §8).
const TH_FILL = { backgroundColor: 'var(--surface-table)' } as const

// Status dots reinforce the word, never replace it (no meaning by color alone).
const STATUS_DOT: Record<AccountStatus, string> = {
  active: 'var(--positive)',
  invited: 'var(--accent)',
  disabled: 'var(--warning)',
  unprovisioned: 'var(--muted-fg)',
}

export function UsersAccessClient() {
  const { t } = useLang()
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [manageId, setManageId] = useState<string | null>(null)

  const moduleLabel: Record<ModuleKey, string> = {
    markets: t.nav.markets,
    analysis: t.nav.analysis,
    macro: t.nav.macro,
    earnings: t.nav.earnings,
    portfolio: t.nav.portfolio,
    alternatives: t.fp.navAlternatives,
    structured_notes: t.nav.structuredNotes,
  }

  /**
   * Reads the directory. PURE — it resolves a result and never touches state, so
   * the mount effect and the post-save refresh can each apply it in the shape
   * their own context allows (the project's React Compiler rules forbid calling
   * a setState-bearing callback from inside an effect).
   */
  const fetchDirectory = useCallback(
    async (signal?: AbortSignal): Promise<DirectoryUser[] | null> => {
      try {
        const res = await fetch('/api/admin/users', { cache: 'no-store', signal })
        if (!res.ok) return null
        const json = await res.json().catch(() => null)
        return json && Array.isArray(json.users) ? (json.users as DirectoryUser[]) : null
      } catch {
        return null
      }
    },
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetchDirectory(controller.signal).then((rows) => {
      if (controller.signal.aborted) return
      if (rows === null) { setLoadState('error'); return }
      setUsers(rows)
      setLoadState('ready')
    })
    return () => controller.abort()
  }, [fetchDirectory])

  /** Re-reads after any dialog action. Only ever called from an event handler. */
  const reload = useCallback(async () => {
    const rows = await fetchDirectory()
    if (rows !== null) { setUsers(rows); setLoadState('ready') }
  }, [fetchDirectory])

  // Same four situations as before, expressed through TableCard's async slot —
  // the same mapping the Notification Recipients card on /settings uses.
  const tableState =
    loadState === 'loading' ? ('loading' as const)
      : loadState === 'error' ? ('error' as const)
        : users.length === 0 ? ('empty' as const)
          : undefined

  const managed = users.find((u) => u.id === manageId) ?? null

  return (
    <div className="w-full">
      <PageHeader
        eyebrow={t.settings.tag}
        title={t.usersAccess.title}
        metadata={<span className="ui-meta text-muted-fg">{t.usersAccess.subtitle}</span>}
        actions={
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            aria-haspopup="dialog"
            className="h-8 px-4 rounded-full bg-primary text-primary-fg text-xs font-medium nv-transition"
          >
            {t.usersAccess.invite}
          </button>
        }
      />

      <Reveal>
        <TableCard
          state={tableState}
          stateMessage={
            tableState === 'error' ? t.usersAccess.loadError
              : tableState === 'empty' ? t.usersAccess.empty
                : undefined
          }
          minWidth={760}
        >
          <table className="w-full" style={{ fontSize: 'var(--fs-table-cell)' }}>
            <caption className="sr-only">{t.usersAccess.title}</caption>
            <thead>
              <tr>
                <th scope="col" style={TH_FILL} className={`${CELL} border-b border-border text-left ui-table-header text-muted-fg`}>{t.usersAccess.colName}</th>
                <th scope="col" style={TH_FILL} className={`${CELL} border-b border-border text-left ui-table-header text-muted-fg`}>{t.usersAccess.colAccount}</th>
                <th scope="col" style={TH_FILL} className={`${CELL} border-b border-border text-left ui-table-header text-muted-fg`}>{t.usersAccess.colStatus}</th>
                <th scope="col" style={{ ...TH_FILL, ...GROUP_EDGE }} className={`${CELL} border-b border-border text-left ui-table-header text-muted-fg`}>{t.usersAccess.colRole}</th>
                <th scope="col" style={TH_FILL} className={`${CELL} border-b border-border text-left ui-table-header text-muted-fg`}>{t.usersAccess.colPrincipal}</th>
                <th scope="col" style={TH_FILL} className={`${CELL} border-b border-border text-left ui-table-header text-muted-fg`}>{t.usersAccess.colAccess}</th>
                <th scope="col" style={TH_FILL} className={`${CELL} border-b border-border text-right`} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                // The row whose Manage dialog is open keeps the shared
                // selection fill, so the dialog visibly belongs to it.
                const isOpen = manageId === u.id
                return (
                  <tr
                    key={u.id}
                    className={`border-b border-border last:border-0 nv-row-hover nv-transition align-top${isOpen ? ' bg-[var(--selected)]' : ''}`}
                  >
                    <td className={`${CELL} text-foreground font-medium`}>
                      {u.displayName ?? u.username ?? '—'}
                    </td>
                    <td className={`${CELL} text-muted-fg`}>
                      <span className="font-mono">{u.username ?? '—'}</span>
                      {u.email && <span className="block ui-meta text-muted-fg">{u.email}</span>}
                    </td>
                    <td className={CELL}>
                      {/* Lifecycle only — reach is the Access column's fact. */}
                      <ChipLabel>
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: STATUS_DOT[u.status] }}
                          aria-hidden="true"
                        />
                        {t.usersAccess.statusWord[u.status]}
                      </ChipLabel>
                    </td>
                    <td className={`${CELL} text-muted-fg whitespace-nowrap`} style={GROUP_EDGE}>
                      {u.isAdministrator ? t.usersAccess.roleAdministrator : t.usersAccess.roleMember}
                    </td>
                    <td className={`${CELL} text-muted-fg whitespace-nowrap`}>
                      {u.principal ? PRINCIPAL_LABEL[u.principal] ?? u.principal : t.usersAccess.principalNone}
                    </td>
                    <td className={`${CELL} text-muted-fg`}>
                      {u.isAdministrator ? (
                        t.usersAccess.allModules
                      ) : !u.hasPlatformAccess && u.modules.length === 0 ? (
                        // Not "no modules" — the account cannot enter at all.
                        // Warning-toned, because it is a configuration an
                        // administrator almost always wants to notice.
                        <span style={{ color: 'var(--warning)' }}>{t.usersAccess.noPlatformAccess}</span>
                      ) : (
                        // The granted module set — for an invited or disabled
                        // account these are the PRESERVED grants that apply the
                        // moment it becomes usable; the Status column already
                        // says whether it currently is.
                        <div className="flex flex-wrap gap-1">
                          {u.modules.map((m) => (
                            <span
                              key={m}
                              className="inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] ui-meta text-muted-fg whitespace-nowrap"
                            >
                              {moduleLabel[m]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={`${CELL} text-right whitespace-nowrap`}>
                      <ChipButton
                        onClick={() => setManageId(u.id)}
                        aria-haspopup="dialog"
                        selected={isOpen}
                      >
                        {t.usersAccess.manage}
                      </ChipButton>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      </Reveal>

      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={reload}
      />

      <ManageUserDialog
        open={manageId !== null}
        user={managed}
        onClose={() => setManageId(null)}
        reload={reload}
      />
    </div>
  )
}
