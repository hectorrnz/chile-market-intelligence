'use client'

// R13.6F — the shared account-shape fieldset: role, Portfolio principal, and
// module switches, rendered identically by the Invite dialog and the Manage
// dialog so the two forms can never drift apart visually or behaviourally.
//
// PRESENTATION ONLY. Every decision this fieldset displays comes from the PURE
// provisioning layer (`lib/admin/userProvisioning.ts`) — the same functions the
// API routes run — so what the form promises is what the server would store:
//
//   · `resolveAccountShape`      canonicalizes the draft (an administrator's
//                                principal and modules collapse server-side);
//   · `principalCeiling`         the immutable Portfolio ceiling the principal
//                                fixes, independent of any module grant;
//   · `projectedPortfolioScopes` the effective result — ceiling ∩ grants — the
//                                IDENTICAL composition the runtime uses;
//   · `provisioningWarnings`     the advisory, non-blocking warnings.
//
// PRINCIPAL IS NOT A MODULE. It lives in its own control group, away from the
// switches, because it answers a different question: not "may this person reach
// the Portfolio section" (the module grant) but "whose portfolios may they ever
// see" (the frozen ceiling). Rendering it among the switches would invite the
// exact category error the authorization model makes unrepresentable.
//
// WARNINGS NEVER FLIP A SWITCH. A zero-module member, a Portfolio grant with no
// principal, and a principal with no Portfolio grant are all LEGAL and are saved
// exactly as asked. The warnings say so plainly and change nothing.

import { useId } from 'react'
import { useLang } from '@/components/providers/LangProvider'
import { SegmentedControl } from '@/components/fable/SegmentedControl'
import { Switch } from '@/components/fable/Switch'
import { APP_MODULE_KEYS } from '@/lib/auth/moduleAccess'
import { PORTFOLIO_PRINCIPALS } from '@/lib/portfolioAccess/entitlements'
import {
  resolveAccountShape,
  provisioningWarnings,
  principalCeiling,
  projectedPortfolioScopes,
  type AccountShape,
  type AssignableRole,
  type FamilyPortfolioScope,
  type ModuleKey,
  type PortfolioPrincipal,
  type ProvisioningWarning,
} from '@/lib/admin/userProvisioning'
import type { Translation } from '@/lib/i18n'

/** Scope display labels. Proper names are not translated. */
export const SCOPE_LABEL: Record<FamilyPortfolioScope, string> = {
  main: 'Main',
  jaime: 'Jaime',
  andres: 'Andrés',
  pablo: 'Pablo',
  alternatives: 'Alternatives',
  admin: 'Admin',
}

export const PRINCIPAL_LABEL: Record<PortfolioPrincipal, string> = {
  jaime: 'Jaime',
  andres: 'Andrés',
  pablo: 'Pablo',
}

/** The warning-note material (same recipe the zero-module note has always used). */
export const warnBoxStyle = {
  color: 'var(--warning)',
  borderColor: 'color-mix(in oklab, var(--warning) 40%, transparent)',
  backgroundColor: 'color-mix(in oklab, var(--warning) 10%, var(--surface))',
} as const

/**
 * Canonicalizes a typed draft through the SAME pure function the server runs.
 * Typed inputs cannot fail validation; the fallback is defensive only and grants
 * nothing (an empty member shape).
 */
export function accountShapeOf(
  role: AssignableRole,
  principal: PortfolioPrincipal | null,
  modules: ModuleKey[],
): AccountShape {
  const result = resolveAccountShape({ role, principal, modules })
  return result.ok ? result.shape : { role: 'user', principal: null, modules: [] }
}

/**
 * Maps a server refusal code to its dictionary message. `invalid_role` /
 * `invalid_principal` / `invalid_module` cannot arise from the typed form, so
 * they fall through to the generic message rather than getting copy nobody can
 * ever see. `last_administrator` gets its own clear sentence (§9).
 */
export function provisioningErrorMessage(t: Translation, code: unknown): string {
  switch (code) {
    case 'invalid_username': return t.usersAccess.errInvalidUsername
    case 'invalid_email': return t.usersAccess.errInvalidEmail
    case 'invalid_display_name': return t.usersAccess.errInvalidDisplayName
    case 'username_taken': return t.usersAccess.errUsernameTaken
    case 'already_activated': return t.usersAccess.errAlreadyActivated
    case 'invite_link_failed': return t.usersAccess.errInviteLinkFailed
    case 'last_administrator': return t.usersAccess.errLastAdministrator
    case 'account_disabled': return t.usersAccess.errAccountDisabled
    case 'target_not_found': return t.usersAccess.errTargetNotFound
    default: return t.usersAccess.errGeneric
  }
}

type PrincipalOption = 'none' | PortfolioPrincipal

/** Renders a scope set as text, hiding the internal `admin` scope. */
function scopeList(scopes: FamilyPortfolioScope[], emptyLabel: string): string {
  const shown = scopes.filter((s) => s !== 'admin')
  return shown.length === 0 ? emptyLabel : shown.map((s) => SCOPE_LABEL[s]).join(' + ')
}

interface AccountAccessFieldsProps {
  role: AssignableRole
  principal: PortfolioPrincipal | null
  modules: ModuleKey[]
  onRoleChange: (role: AssignableRole) => void
  onPrincipalChange: (principal: PortfolioPrincipal | null) => void
  onToggleModule: (module: ModuleKey) => void
  /** True while the caller's request is in flight (or editing is not allowed) — locks every control. */
  busy?: boolean
}

export function AccountAccessFields({
  role,
  principal,
  modules,
  onRoleChange,
  onPrincipalChange,
  onToggleModule,
  busy = false,
}: AccountAccessFieldsProps) {
  const { t, lang } = useLang()
  const idBase = useId()
  const isAdmin = role === 'administrator'

  const moduleLabel: Record<ModuleKey, string> = {
    markets: t.nav.markets,
    analysis: t.nav.analysis,
    macro: t.nav.macro,
    earnings: t.nav.earnings,
    portfolio: t.nav.portfolio,
    alternatives: t.fp.navAlternatives,
    structured_notes: t.nav.structuredNotes,
  }

  const warningCopy: Record<ProvisioningWarning, string> = {
    no_modules: t.usersAccess.warnNoModules,
    portfolio_without_principal: t.usersAccess.warnPortfolioNoPrincipal,
    principal_without_portfolio: t.usersAccess.warnPrincipalNoPortfolio,
  }

  // The canonical shape this draft would store, and everything derived from it —
  // ceiling, effective scopes, warnings — all via the pure provisioning layer.
  const shape = accountShapeOf(role, principal, modules)
  const warnings = provisioningWarnings(shape)
  const ceiling = principalCeiling(shape.principal, shape.role)
  const projected = projectedPortfolioScopes(shape)

  return (
    <div className="flex flex-col">
      {/* ── Role ───────────────────────────────────────────────────────── */}
      <div className="pb-4 flex flex-col items-start gap-2">
        <h3 className="ui-label text-muted-fg">{t.usersAccess.roleHeading}</h3>
        <SegmentedControl<AssignableRole>
          options={[
            { value: 'user', label: t.usersAccess.roleMember, disabled: busy },
            { value: 'administrator', label: t.usersAccess.roleAdministrator, disabled: busy },
          ]}
          value={role}
          onChange={onRoleChange}
          ariaLabel={t.usersAccess.roleHeading}
          remeasureToken={lang}
        />
      </div>

      {/* ── Principal — its own group, deliberately apart from the module
             switches: it is a ceiling, never a grant ─────────────────────── */}
      <div className="py-4 border-t border-[var(--nv-line)] flex flex-col items-start gap-2">
        <h3 className="ui-label text-muted-fg">{t.usersAccess.principalHeading}</h3>
        <SegmentedControl<PrincipalOption>
          options={[
            { value: 'none', label: t.usersAccess.principalNone, disabled: busy || isAdmin },
            ...PORTFOLIO_PRINCIPALS.map((p) => ({
              value: p,
              label: PRINCIPAL_LABEL[p],
              disabled: busy || isAdmin,
            })),
          ]}
          // An administrator's principal is canonicalized to null server-side;
          // the control says so by sitting at None, disabled.
          value={isAdmin ? 'none' : (principal ?? 'none')}
          onChange={(v) => onPrincipalChange(v === 'none' ? null : v)}
          ariaLabel={t.usersAccess.principalHeading}
          remeasureToken={lang}
        />
        <p className="ui-meta text-muted-fg">{t.usersAccess.principalNote}</p>

        {/* The immutable ceiling and the effective result — statements, never controls. */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mt-1">
          <div className="min-w-0">
            <p className="ui-label text-muted-fg">{t.usersAccess.ceilingLabel}</p>
            <p className="text-xs text-foreground font-medium mt-0.5">
              {scopeList(ceiling, t.usersAccess.portfolioNone)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="ui-label text-muted-fg">{t.usersAccess.effectiveLabel}</p>
            <p className="text-xs text-foreground font-medium mt-0.5">
              {scopeList(projected, t.usersAccess.portfolioNone)}
            </p>
          </div>
        </div>
        <p className="ui-meta text-muted-fg">{t.usersAccess.ceilingNote}</p>
      </div>

      {/* ── Modules ────────────────────────────────────────────────────── */}
      <div className="pt-4 border-t border-[var(--nv-line)] flex flex-col gap-2.5">
        <h3 className="ui-label text-muted-fg">{t.usersAccess.modulesHeading}</h3>
        {isAdmin && (
          <p className="ui-meta text-muted-fg rounded-[var(--radius-input)] border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] px-3 py-2.5">
            {t.usersAccess.adminBypassNote}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {APP_MODULE_KEYS.map((m) => {
            // An administrator holds every module by role: the switches read ON
            // and locked, with the note above saying why. For a member the
            // switch is exactly the draft grant.
            const on = isAdmin || modules.includes(m)
            const switchId = `${idBase}-${m}`
            return (
              <label
                key={m}
                htmlFor={switchId}
                className={`flex items-center justify-between gap-3 min-h-10 px-3 rounded-[var(--radius-input)] border border-[var(--nv-chipbd)] nv-transition ${
                  on ? 'bg-[var(--selected)]' : 'bg-[var(--nv-chip)]'
                } ${busy || isAdmin ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span className={`text-xs ${on ? 'text-foreground font-medium' : 'text-muted-fg'}`}>
                  {moduleLabel[m]}
                </span>
                <Switch
                  id={switchId}
                  checked={on}
                  onCheckedChange={() => onToggleModule(m)}
                  disabled={busy || isAdmin}
                  aria-label={moduleLabel[m]}
                />
              </label>
            )
          })}
        </div>

        {/* Advisory only — each configuration below is legal and is saved as
            asked. Nothing here toggles a switch on the administrator's behalf. */}
        {warnings.map((w) => (
          <p
            key={w}
            role="status"
            className="ui-meta rounded-[var(--radius-input)] border px-3 py-2.5"
            style={warnBoxStyle}
          >
            {warningCopy[w]}
          </p>
        ))}
      </div>
    </div>
  )
}
