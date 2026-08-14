// R13.1.1A — Decision rules for an application-role change.
//
// PURE MODULE. No Supabase, Next.js, filesystem or environment import, and no
// database access — every guard is a total function over explicit inputs, so the
// entire authorization surface of a role change is executed for real in tests.
//
// THE GAP THIS CLOSES
// ───────────────────
// R13.1 made `user_profiles.role` the application-role authority but shipped no
// writer for it. The result was a hard deadlock:
//
//   · every profile row defaults to role = 'user'
//   · nothing in the repository writes `role`
//   · assigning a portfolio principal requires an administrator actor
//   ⇒ no administrator could ever exist, so no principal could ever be assigned,
//     so the whole Family Portfolio module was unreachable.
//
// The fix is a one-time, service-authorized BOOTSTRAP that is legal only while no
// approved administrator exists, plus ordinary administrator-actor role changes
// afterwards.
//
// WHY THE I/O LIVES IN A CLI
// ──────────────────────────
// `tests/accessControl.test.ts` enforces that no file under `src/` writes
// `user_profiles`. The executing half is `scripts/admin/setUserRole.ts`, outside
// the Next.js router and unreachable over HTTP. This module holds only the rules.

import type { PortfolioPrincipal } from './entitlements.ts'

/** Application roles. Mirrors the database CHECK on `user_profiles.role`. */
export const ASSIGNABLE_ROLES = ['user', 'administrator'] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value)
}

export type RoleChangeDenialCode =
  | 'invalid_role'
  | 'invalid_target'
  | 'target_not_found'
  | 'target_not_approved'
  | 'bootstrap_not_available'
  | 'bootstrap_required'
  | 'actor_unknown'
  | 'actor_not_approved'
  | 'actor_not_administrator'
  | 'self_role_change_forbidden'
  | 'last_administrator_protected'

/** How the change is authorized. Mirrors `family_portfolio_access_audit.actor_kind`. */
export type ActorKind = 'administrator' | 'service_bootstrap'

export interface RoleChangeRequest {
  /** True only when the operator explicitly asked for bootstrap mode. */
  bootstrapRequested: boolean
  /**
   * Count of currently APPROVED administrators in the database. Bootstrap is
   * legal only when this is 0; ordinary changes require it to be > 0.
   */
  approvedAdministratorCount: number
  /** Null in bootstrap mode; otherwise the acting administrator. */
  actor:
    | { userId: string | null | undefined; isApproved: boolean; isAdministrator: boolean }
    | null
  targetUserId: unknown
  targetExists: boolean
  /** The target must be approved — an unusable account must not hold a role. */
  targetIsApproved: boolean
  targetCurrentRole: unknown
  requestedRole: unknown
}

export type RoleChangeDecision =
  | {
      allowed: true
      actorKind: ActorKind
      targetUserId: string
      previousValue: AssignableRole
      newValue: AssignableRole
      /** False when the stored role already matches — no write, no audit row. */
      changed: boolean
    }
  | { allowed: false; code: RoleChangeDenialCode }

/** Narrows a stored role; anything unrecognised is treated as the safe default. */
export function normalizeStoredRole(value: unknown): AssignableRole {
  return isAssignableRole(value) ? value : 'user'
}

/**
 * Decides whether an application-role change may proceed.
 *
 * Guard order is deliberate. In ordinary mode the actor is authorized BEFORE the
 * request is examined, so an unauthorized caller learns nothing about the target.
 * In bootstrap mode the FIRST check is that bootstrap is still legal, so the
 * escape hatch closes permanently the moment an administrator exists.
 *
 * Fail-closed on every ambiguity.
 */
export function decideRoleChange(request: RoleChangeRequest): RoleChangeDecision {
  const {
    bootstrapRequested,
    approvedAdministratorCount,
    actor,
    targetExists,
    targetIsApproved,
  } = request

  // ── Mode selection, before anything else ─────────────────────────────────
  const noAdministratorExists = approvedAdministratorCount === 0

  if (bootstrapRequested) {
    // Bootstrap is a one-time escape hatch. It is illegal the moment any
    // approved administrator exists — otherwise it would be a standing
    // privilege-escalation path for anyone holding the service-role key.
    if (!noAdministratorExists) return { allowed: false, code: 'bootstrap_not_available' }
  } else if (noAdministratorExists) {
    // There is no administrator to act, so an ordinary change is impossible.
    // Say so explicitly rather than failing as "actor not administrator".
    return { allowed: false, code: 'bootstrap_required' }
  }

  const actorKind: ActorKind = bootstrapRequested ? 'service_bootstrap' : 'administrator'

  // ── Ordinary mode: authorize the actor first ─────────────────────────────
  if (actorKind === 'administrator') {
    if (!actor || typeof actor.userId !== 'string' || actor.userId.trim().length === 0) {
      return { allowed: false, code: 'actor_unknown' }
    }
    if (actor.isApproved !== true) return { allowed: false, code: 'actor_not_approved' }
    if (actor.isAdministrator !== true) return { allowed: false, code: 'actor_not_administrator' }
  }

  // ── Validate the request ─────────────────────────────────────────────────
  if (!isAssignableRole(request.requestedRole)) return { allowed: false, code: 'invalid_role' }
  const newValue: AssignableRole = request.requestedRole

  if (typeof request.targetUserId !== 'string' || request.targetUserId.trim().length === 0) {
    return { allowed: false, code: 'invalid_target' }
  }
  const targetUserId = request.targetUserId.trim()

  // No self-elevation and no self-demotion: an administrator must not change
  // their own role through this workflow, in either direction.
  if (actorKind === 'administrator' && actor && typeof actor.userId === 'string') {
    if (targetUserId === actor.userId.trim()) {
      return { allowed: false, code: 'self_role_change_forbidden' }
    }
  }

  if (targetExists !== true) return { allowed: false, code: 'target_not_found' }

  // An unapproved account must never hold a role — approval is the outer gate
  // everywhere else in this system, and a role on an unusable account is a
  // dormant grant waiting to activate.
  if (targetIsApproved !== true) return { allowed: false, code: 'target_not_approved' }

  const previousValue = normalizeStoredRole(request.targetCurrentRole)
  const changed = previousValue !== newValue

  // ── Last-administrator protection ────────────────────────────────────────
  // Demoting the final approved administrator would recreate exactly the
  // deadlock this module exists to prevent.
  if (previousValue === 'administrator' && newValue !== 'administrator') {
    if (approvedAdministratorCount <= 1) {
      return { allowed: false, code: 'last_administrator_protected' }
    }
  }

  return { allowed: true, actorKind, targetUserId, previousValue, newValue, changed }
}

/** The audit row an applied role change must produce. Never built for a denial. */
export interface RoleAuditEntry {
  target_user_id: string
  /** NULL for a service-authorized bootstrap — there is no application actor. */
  actor_user_id: string | null
  actor_kind: ActorKind
  field_changed: 'role'
  previous_value: string | null
  new_value: string | null
}

/**
 * Builds the audit entry for an allowed, actually-changing role assignment.
 *
 * Returns null when the decision denied OR nothing changed — a denial must never
 * be recorded as a successful change, and a no-op is noise.
 *
 * `actorUserId` is IGNORED for a bootstrap: recording the target (or any other
 * id) as the actor would be a false record, so the column is written NULL and
 * `actor_kind` carries the truth.
 */
export function buildRoleAuditEntry(
  decision: RoleChangeDecision,
  actorUserId: string | null,
): RoleAuditEntry | null {
  if (!decision.allowed || !decision.changed) return null
  return {
    target_user_id: decision.targetUserId,
    actor_user_id: decision.actorKind === 'service_bootstrap' ? null : actorUserId,
    actor_kind: decision.actorKind,
    field_changed: 'role',
    previous_value: decision.previousValue,
    new_value: decision.newValue,
  }
}

/** Re-exported so callers never import the principal type from two places. */
export type { PortfolioPrincipal }
