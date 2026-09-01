'use client'

// POST-R13.6CDE — the administrator Users & Access console.
//
// PRESENTATION ONLY. Rendered after the server component has already confirmed
// the caller is an administrator, and every action it offers is re-authorized
// server-side on its own request. Nothing here is a permission check.
//
// THE CHECKBOX GRID IS A PICTURE OF STORED ROWS, NOT AN INTENT
// ────────────────────────────────────────────────────────────
// A ticked box means an explicit `user_module_grants` row exists for that
// (user, module). Unticked means no row. There is no tri-state, no inherited
// state, and no rendering of `app_modules.default_for_member` — that column is
// provisioning metadata for a future invitation, and `moduleAccess.ts`
// deliberately never consults it at runtime. Showing it here would draw a
// checkbox that means something the authorization layer does not believe.
//
// A FAILED SAVE MUST NOT LOOK COMMITTED. On any error the local draft is
// discarded and the list is re-read from the server, so what is on screen is
// what is actually stored. Leaving the ticks where the administrator put them
// would show them an access configuration that does not exist.
//
// ZERO MODULES IS ZERO ACCESS (POST-R13.6CDE.1)
// ─────────────────────────────────────────────
// Clearing every switch does not merely hide navigation: it removes the
// account's access to the application entirely, Overview and Settings included.
// That is a consequential action taken by unticking things, so the console says
// so plainly while the switches are clear, and asks for confirmation in the
// app's own alert dialog before a save that causes it. The label comes from the
// server's `hasPlatformAccess`, computed with the SAME predicate middleware
// refuses with, so this screen cannot disagree with the gate.
//
// PORTFOLIO SCOPE IS A STATEMENT, NEVER A CONTROL
// ───────────────────────────────────────────────
// A member's reachable portfolios are their principal's frozen ceiling
// intersected with their module grants. Andrés and Pablo are not in a Jaime
// member's ceiling at all, so rendering `[✓ Main] [✓ Jaime] [ ] Andrés` would
// imply the last two are things an administrator could tick. They are not — they
// are unreachable by construction, not by configuration — so this renders the
// resolved set as text and says what determines it.

import { useCallback, useEffect, useId, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { TableCard } from '@/components/fable/TableCard'
import { ChipButton, ChipLabel } from '@/components/fable/Chip'
import { Switch } from '@/components/fable/Switch'
import { ModalShell } from '@/components/fable/ModalShell'
import { Reveal } from '@/components/fable/motion'
import { APP_MODULE_KEYS, type ModuleKey } from '@/lib/auth/moduleAccess'
import type { DirectoryUser } from '@/lib/admin/userDirectory'
import type { FamilyPortfolioScope } from '@/lib/portfolioAccess/entitlements'

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** Scope display labels. Proper names are not translated. */
const SCOPE_LABEL: Record<FamilyPortfolioScope, string> = {
  main: 'Main',
  jaime: 'Jaime',
  andres: 'Andrés',
  pablo: 'Pablo',
  alternatives: 'Alternatives',
  admin: 'Admin',
}

const PRINCIPAL_LABEL: Record<string, string> = { jaime: 'Jaime', andres: 'Andrés', pablo: 'Pablo' }

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

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

export function UsersAccessClient() {
  const { t } = useLang()
  const moduleIdBase = useId()
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [openId, setOpenId] = useState<string | null>(null)
  /** The in-progress checkbox draft for the open row. Null when untouched. */
  const [draft, setDraft] = useState<ModuleKey[] | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  /** Open while a save that would remove all platform access awaits confirmation. */
  const [confirmRevoke, setConfirmRevoke] = useState(false)

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

  /** Re-reads after a save. Only ever called from an event handler. */
  const reload = useCallback(async () => {
    const rows = await fetchDirectory()
    if (rows !== null) { setUsers(rows); setLoadState('ready') }
  }, [fetchDirectory])

  const open = users.find((u) => u.id === openId) ?? null
  const current = open ? open.modules : []
  const shown = draft ?? current
  const dirty = open !== null && !sameSet(shown, current)

  function toggle(module: ModuleKey) {
    const base = draft ?? current
    setDraft(base.includes(module) ? base.filter((m) => m !== module) : [...base, module])
    setSaveState('idle')
  }

  function openRow(id: string) {
    setOpenId(id)
    setDraft(null)
    setSaveState('idle')
  }

  /**
   * The Save button's handler.
   *
   * A save that leaves NO modules selected removes the account's access to the
   * whole application, so it goes through the app's own alert dialog first (the
   * WeeklyNotesPanel pattern — never `window.confirm`). Every other save applies
   * directly: granting or narrowing access is routine, revoking it entirely is
   * not. `dirty` already guarantees an empty `shown` here means the stored set
   * was non-empty, i.e. this save is genuinely the one that takes access away.
   */
  function requestSave() {
    if (!open || !dirty) return
    if (shown.length === 0) { setConfirmRevoke(true); return }
    void save()
  }

  async function save() {
    if (!open || !dirty) return
    setConfirmRevoke(false)
    setSaveState('saving')
    try {
      const res = await fetch(`/api/admin/users/${open.id}/modules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: shown }),
      })
      if (!res.ok) {
        // Discard the draft and re-read: the grid must show stored state.
        setSaveState('error')
        setDraft(null)
        await reload()
        return
      }
      setSaveState('saved')
      setDraft(null)
      await reload()
    } catch {
      setSaveState('error')
      setDraft(null)
      await reload()
    }
  }

  // Same four situations as before, expressed through TableCard's async slot —
  // the same mapping the Notification Recipients card on /settings uses.
  const tableState =
    loadState === 'loading' ? ('loading' as const)
      : loadState === 'error' ? ('error' as const)
        : users.length === 0 ? ('empty' as const)
          : undefined

  return (
    <div className="w-full">
      <PageHeader
        eyebrow={t.settings.tag}
        title={t.usersAccess.title}
        metadata={<span className="ui-meta text-muted-fg">{t.usersAccess.subtitle}</span>}
      />

      <Reveal>
        <TableCard
          state={tableState}
          stateMessage={
            tableState === 'error' ? t.usersAccess.loadError
              : tableState === 'empty' ? t.usersAccess.empty
                : undefined
          }
          minWidth={720}
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
                // The row whose manage panel is open keeps the shared selection
                // fill, so the panel below visibly belongs to it.
                const isOpen = openId === u.id
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
                      <ChipLabel>
                        {u.status === 'active' ? t.usersAccess.statusActive : t.usersAccess.statusPending}
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
                      ) : !u.hasPlatformAccess ? (
                        // Not "no modules" — the account cannot enter at all.
                        // Warning-toned, because it is a configuration an
                        // administrator almost always wants to notice.
                        <span style={{ color: 'var(--warning)' }}>{t.usersAccess.noPlatformAccess}</span>
                      ) : (
                        u.modules.map((m) => moduleLabel[m]).join(' · ')
                      )}
                    </td>
                    <td className={`${CELL} text-right whitespace-nowrap`}>
                      <ChipButton
                        onClick={() => openRow(u.id)}
                        aria-expanded={isOpen}
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

      {open && (
        <Reveal>
          <GlassSurface variant="card" as="section" className="mt-2 overflow-hidden">
            {/* Identity band — the same `--selected` fill as the highlighted
                table row, so the panel reads as attached to the row it came
                from rather than as an unrelated second card. */}
            <div className="flex items-start justify-between gap-3 px-5 py-3.5 bg-[var(--selected)] border-b border-[var(--nv-line)]">
              <div className="min-w-0">
                <p className="ui-label text-muted-fg">{t.usersAccess.manage}</p>
                <h2 className="ui-card-value text-foreground truncate mt-0.5">
                  {open.displayName ?? open.username ?? open.id}
                </h2>
                {open.username && <p className="ui-meta text-muted-fg font-mono mt-0.5">{open.username}</p>}
              </div>
              <ChipButton onClick={() => setOpenId(null)} className="shrink-0">
                {t.usersAccess.close}
              </ChipButton>
            </div>

            <div className="px-5">
              {/* ── Modules ─────────────────────────────────────────────── */}
              <div className="py-4 flex flex-col gap-2.5">
                <h3 className="ui-label text-muted-fg">{t.usersAccess.accessHeading}</h3>
                {open.isAdministrator ? (
                  <p className="ui-meta text-muted-fg rounded-[var(--radius-input)] border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] px-3 py-2.5">
                    {t.usersAccess.adminBypassNote}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {APP_MODULE_KEYS.map((m) => {
                      const on = shown.includes(m)
                      const switchId = `${moduleIdBase}-${m}`
                      return (
                        // The whole row is the hit target: the label forwards
                        // its click to the Switch it names via htmlFor.
                        <label
                          key={m}
                          htmlFor={switchId}
                          className={`flex items-center justify-between gap-3 min-h-10 px-3 rounded-[var(--radius-input)] border border-[var(--nv-chipbd)] cursor-pointer nv-transition ${
                            on ? 'bg-[var(--selected)]' : 'bg-[var(--nv-chip)]'
                          }`}
                        >
                          <span className={`text-xs ${on ? 'text-foreground font-medium' : 'text-muted-fg'}`}>
                            {moduleLabel[m]}
                          </span>
                          <Switch
                            id={switchId}
                            checked={on}
                            onCheckedChange={() => toggle(m)}
                            disabled={saveState === 'saving'}
                            aria-label={moduleLabel[m]}
                          />
                        </label>
                      )
                    })}
                  </div>
                )}
                {/* Stated while the switches are clear, not only at save time:
                    the consequence of unticking the last module is not
                    discoverable from the switches themselves. */}
                {!open.isAdministrator && shown.length === 0 && (
                  <p
                    role="status"
                    className="ui-meta rounded-[var(--radius-input)] border px-3 py-2.5"
                    style={{
                      color: 'var(--warning)',
                      borderColor: 'color-mix(in oklab, var(--warning) 40%, transparent)',
                      backgroundColor: 'color-mix(in oklab, var(--warning) 10%, var(--surface))',
                    }}
                  >
                    {t.usersAccess.noPlatformAccessNote}
                  </p>
                )}
              </div>

              {/* ── Portfolio scope: derived, locked ─────────────────────── */}
              <div className="py-4 flex flex-col gap-1.5 border-t border-[var(--nv-line)]">
                <h3 className="ui-label text-muted-fg">{t.usersAccess.portfolioHeading}</h3>
                <p className="text-xs text-foreground font-medium">
                  {open.portfolioScopes.length === 0
                    ? t.usersAccess.portfolioNone
                    : open.portfolioScopes.filter((s) => s !== 'admin').map((s) => SCOPE_LABEL[s]).join(' + ')}
                </p>
                <p className="ui-meta text-muted-fg">{t.usersAccess.portfolioLocked}</p>
              </div>

              {/* ── Role and principal: displayed, changed with the CLI ──── */}
              <div className="py-4 border-t border-[var(--nv-line)]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <h3 className="ui-label text-muted-fg">{t.usersAccess.roleHeading}</h3>
                    <p className="text-xs text-foreground">
                      {open.isAdministrator ? t.usersAccess.roleAdministrator : t.usersAccess.roleMember}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <h3 className="ui-label text-muted-fg">{t.usersAccess.principalHeading}</h3>
                    <p className="text-xs text-foreground">
                      {open.principal ? PRINCIPAL_LABEL[open.principal] ?? open.principal : t.usersAccess.principalNone}
                    </p>
                  </div>
                </div>
                <p className="ui-meta text-muted-fg mt-2.5">{t.usersAccess.managedElsewhere}</p>
              </div>

              {!open.isAdministrator && (
                <div className="py-4 border-t border-[var(--nv-line)] flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={requestSave}
                    disabled={!dirty || saveState === 'saving'}
                    className="h-8 px-4 rounded-full bg-primary text-primary-fg text-xs font-medium disabled:opacity-50 nv-transition"
                  >
                    {saveState === 'saving' ? t.usersAccess.saving : t.usersAccess.save}
                  </button>
                  {saveState === 'saved' && <span className="ui-meta text-positive">{t.usersAccess.saved}</span>}
                  {saveState === 'error' && <span className="ui-meta text-negative">{t.usersAccess.saveFailed}</span>}
                  {saveState === 'idle' && !dirty && <span className="ui-meta text-muted-fg">{t.usersAccess.unchanged}</span>}
                </div>
              )}
            </div>
          </GlassSurface>
        </Reveal>
      )}

      {/* Removing the last module removes the platform. Confirmed in the app's
          OWN alert dialog — focus-trapped, Escape-dismissible, undismissable
          while the request is in flight — never `window.confirm`. */}
      <ModalShell
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        title={t.usersAccess.revokeAllTitle}
        size="sm"
        role="alertdialog"
        dismissDisabled={saveState === 'saving'}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmRevoke(false)}
              disabled={saveState === 'saving'}
              className="ui-meta text-muted-fg hover:text-foreground nv-transition"
            >
              {t.usersAccess.cancel}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saveState === 'saving'}
              className="inline-flex items-center h-8 px-4 rounded-full text-xs font-medium nv-transition disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--negative)', color: '#fff' }}
            >
              {t.usersAccess.revokeAllConfirm}
            </button>
          </div>
        }
      >
        <p className="text-sm text-foreground">{t.usersAccess.revokeAllBody}</p>
      </ModalShell>

      <p className="ui-meta text-muted-fg mt-3">{t.usersAccess.inviteNote}</p>
    </div>
  )
}
