// POST-R13.6CDE — the Users & Access console's rules, as pure functions.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, so every
// decision below executes for real in tests rather than being mocked around.
// The I/O lives in `src/app/api/admin/users/**`; this file holds only the rules,
// exactly as `roleAssignment.ts` and `principalAssignment.ts` do.
//
// WHY A SEPARATE DECISION LAYER
// ─────────────────────────────
// The console is the first surface in this application that reads and writes
// ANOTHER account's authorization. `user_profiles` and `user_module_grants` are
// both own-row-RLS for `authenticated`, so it necessarily runs on the
// service-role client — which bypasses RLS entirely. That makes the application
// layer the ONLY boundary on this path, and a boundary that only exists inside a
// route handler is one nobody can test exhaustively. So the rules live here, and
// the handler does I/O around them.
//
// THE ORDER OF THE GUARDS IS THE SECURITY PROPERTY. The actor is authorized
// before any target row is read, so an unauthorized caller learns nothing about
// who exists — not even whether the id they guessed is real.

import { APP_MODULE_KEYS, isModuleKey, type ModuleKey } from '../auth/moduleAccess.ts'
import {
  accountStatus,
  isAccountUsable,
  lifecycleFromProfile,
  type AccountStatus,
} from '../auth/accountLifecycle.ts'
import type { PortfolioPrincipal, FamilyPortfolioScope } from '../portfolioAccess/entitlements.ts'

/**
 * The account states this schema can honestly express — and only those.
 *
 * `user_profiles` carries no `invited_at`, `activated_at` or `disabled_at`
 * column, so "disabled" and "never approved" are the SAME stored state: an empty
 * username. Inventing a third label would mean guessing which one a given row
 * is, and telling an administrator an account was "disabled" when it may simply
 * never have been approved is worse than telling them less.
 *
 * Adding those columns is real work with real product decisions attached (what
 * does disabling DO — clear the username, or set a flag the approval check also
 * has to learn about?), and nothing writes them until invitations exist. It is
 * therefore deferred to the provisioning stage, where `invited_at` is actually
 * produced. See the report's account-status section.
 */
// R13.6F — the status vocabulary moved to `auth/accountLifecycle.ts`, because the
// same four states are now derived by the authorization layer and by this
// directory, and two copies would be two things to keep in step. Re-exported so
// existing importers of this module keep working.
export { ACCOUNT_STATUSES, type AccountStatus } from '../auth/accountLifecycle.ts'

/** A row of the administrator's user list. Deliberately narrow. */
export interface DirectoryUser {
  id: string
  displayName: string | null
  username: string | null
  /**
   * Present because an administrator managing accounts needs to tell two people
   * apart, and a display name is not unique. It is never sent to a non-admin —
   * the route is administrator-gated — and never logged.
   */
  email: string | null
  status: AccountStatus
  /** R13.6F lifecycle timestamps, for the administrator directory only. */
  invitedAt: string | null
  activatedAt: string | null
  disabledAt: string | null
  isAdministrator: boolean
  principal: PortfolioPrincipal | null
  /** Explicit `user_module_grants` rows. Empty for an administrator, by design. */
  modules: ModuleKey[]
  /** Ceiling ∩ mask, computed server-side. Display only — never editable. */
  portfolioScopes: FamilyPortfolioScope[]
  /**
   * POST-R13.6CDE.1 — whether this account may enter the application AT ALL.
   *
   * Computed server-side by `canEnterPlatform`, the SAME predicate middleware
   * refuses with, rather than re-derived in the console from `modules.length`.
   * If the two ever disagreed, the administrator would be reading a screen that
   * says "no modules" while the gate says something else — and the screen is
   * where they decide whether to act.
   */
  hasPlatformAccess: boolean
}

/**
 * Derives account status from what the row actually contains.
 *
 * Approval matches `isApprovedProfile()`, `entitlementFromProfile()` and
 * `moduleAccessFromProfile()` — a non-empty trimmed username. Keeping all four
 * identical is what stops the console from showing "Active" for an account the
 * authorization layer considers unapproved.
 */
/**
 * The account's status, derived from approval plus the R13.6F lifecycle columns.
 *
 * Before R13.6F this was a two-value function over `username` alone, which could
 * not tell an invited account from a disabled one from a never-provisioned row.
 * It now delegates to the single lifecycle rule so the directory and the
 * authorization layer can never disagree about what state an account is in.
 *
 * NOTE the deliberate separation §21 requires: `disabled` and "no platform access
 * because zero modules are granted" are DIFFERENT conditions and are reported
 * separately — `status` carries the first, `hasPlatformAccess` the second. An
 * active member with no grants is `active` with `hasPlatformAccess: false`, and
 * must never be shown as disabled.
 */
export function accountStatusOf(
  profile:
    | { username?: unknown; invited_at?: unknown; activated_at?: unknown; disabled_at?: unknown }
    | null
    | undefined,
): AccountStatus {
  return accountStatus(lifecycleFromProfile(profile))
}

/** True when this profile may be authorized at all — approved, activated, not disabled. */
export function accountUsableOf(
  profile:
    | { username?: unknown; invited_at?: unknown; activated_at?: unknown; disabled_at?: unknown }
    | null
    | undefined,
): boolean {
  return isAccountUsable(lifecycleFromProfile(profile))
}

/** Why a module-grant change was refused. */
export type GrantChangeDenialCode =
  | 'actor_not_administrator'
  | 'invalid_target'
  | 'target_not_found'
  | 'target_not_approved'
  | 'target_is_administrator'
  | 'invalid_module'

export interface GrantChangeRequest {
  actor: { userId: string | null | undefined; isApproved: boolean; isAdministrator: boolean } | null
  targetUserId: unknown
  targetExists: boolean
  targetIsApproved: boolean
  targetIsAdministrator: boolean
  /** The complete desired set. Absent keys are revocations. */
  requestedModules: unknown
  /** The target's current explicit grants. */
  currentModules: readonly string[]
}

export type GrantChangeDecision =
  | {
      allowed: true
      targetUserId: string
      /** Modules to INSERT — requested and not currently held. */
      toGrant: ModuleKey[]
      /** Modules to DELETE — currently held and not requested. */
      toRevoke: ModuleKey[]
      /** False when the stored set already matches: no write, no audit rows. */
      changed: boolean
    }
  | { allowed: false; code: GrantChangeDenialCode }

/**
 * Normalises a requested module set.
 *
 * Returns null when ANY entry is not a declared module key, rather than
 * silently dropping it. A request naming `pablo`, `portfolio_admin` or
 * `notification_recipients` is a category error — the caller believes it is
 * granting something this system does not model that way — and answering "done"
 * while ignoring it would leave the administrator believing they had configured
 * access they had not. Rejecting the whole request is the honest answer.
 *
 * `jaime`/`andres`/`pablo` are additionally unrepresentable downstream:
 * `user_module_grants.module_key` is a foreign key into `app_modules` and no
 * such row exists. This check simply reports it clearly instead of surfacing a
 * constraint violation.
 */
export function normalizeRequestedModules(value: unknown): ModuleKey[] | null {
  if (!Array.isArray(value)) return null
  const out = new Set<ModuleKey>()
  for (const entry of value) {
    if (!isModuleKey(entry)) return null
    out.add(entry)
  }
  // Canonical order, deduplicated.
  return APP_MODULE_KEYS.filter((k) => out.has(k))
}

/**
 * Decides whether an administrator may set a target's module grants.
 *
 * Guard order, deliberately: the ACTOR is authorized before the target is
 * examined at all, so an unauthorized caller cannot use the denial codes to
 * discover whether a user id exists.
 *
 * An ADMINISTRATOR TARGET IS REFUSED, not silently no-opped. Administrators hold
 * every module by role and are deliberately given no grant rows, so writing
 * grants for one would store rows that change nothing and read back as an
 * access configuration that is not real. The console disables those checkboxes
 * for the same reason, and refusing here is what stops the two from disagreeing.
 */
export function decideGrantChange(request: GrantChangeRequest): GrantChangeDecision {
  const { actor } = request

  if (
    !actor ||
    typeof actor.userId !== 'string' ||
    actor.userId.trim().length === 0 ||
    actor.isApproved !== true ||
    actor.isAdministrator !== true
  ) {
    return { allowed: false, code: 'actor_not_administrator' }
  }

  if (typeof request.targetUserId !== 'string' || request.targetUserId.trim().length === 0) {
    return { allowed: false, code: 'invalid_target' }
  }
  const targetUserId = request.targetUserId.trim()

  const requested = normalizeRequestedModules(request.requestedModules)
  if (requested === null) return { allowed: false, code: 'invalid_module' }

  if (request.targetExists !== true) return { allowed: false, code: 'target_not_found' }
  // Approval is the outer gate everywhere else in this system; a grant on an
  // unusable account is a dormant permission waiting to activate. Mirrors
  // `decideRoleChange`'s `target_not_approved` for exactly the same reason.
  if (request.targetIsApproved !== true) return { allowed: false, code: 'target_not_approved' }
  if (request.targetIsAdministrator === true) {
    return { allowed: false, code: 'target_is_administrator' }
  }

  const current = new Set(request.currentModules.filter(isModuleKey))
  const want = new Set(requested)
  const toGrant = APP_MODULE_KEYS.filter((k) => want.has(k) && !current.has(k))
  const toRevoke = APP_MODULE_KEYS.filter((k) => current.has(k) && !want.has(k))

  return {
    allowed: true,
    targetUserId,
    toGrant,
    toRevoke,
    changed: toGrant.length > 0 || toRevoke.length > 0,
  }
}

/** One audit row for one module-grant transition. */
export interface ModuleGrantAuditEntry {
  target_user_id: string
  actor_user_id: string
  actor_kind: 'administrator'
  field_changed: 'module_grant'
  module_key: ModuleKey
  previous_value: 'granted' | 'revoked'
  new_value: 'granted' | 'revoked'
}

/**
 * Builds one audit entry per module actually changed.
 *
 * Never built for a denial, and never for a no-op — recording a refused or
 * unchanged request as a change would make the trail lie, and a trail that
 * records non-events is one nobody trusts when it matters. Carries no financial
 * value and no personal detail beyond the two user ids the table already keys on.
 */
export function buildGrantAuditEntries(
  decision: GrantChangeDecision,
  actorUserId: string,
): ModuleGrantAuditEntry[] {
  if (!decision.allowed || !decision.changed) return []
  const row = (module_key: ModuleKey, granted: boolean): ModuleGrantAuditEntry => ({
    target_user_id: decision.targetUserId,
    actor_user_id: actorUserId,
    actor_kind: 'administrator',
    field_changed: 'module_grant',
    module_key,
    previous_value: granted ? 'revoked' : 'granted',
    new_value: granted ? 'granted' : 'revoked',
  })
  return [
    ...decision.toGrant.map((m) => row(m, true)),
    ...decision.toRevoke.map((m) => row(m, false)),
  ]
}
