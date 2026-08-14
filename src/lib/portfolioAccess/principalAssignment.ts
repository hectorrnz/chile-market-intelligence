// R13.1 — The decision rules for an administrative portfolio-principal change.
//
// PURE MODULE. No Supabase, Next.js, filesystem or environment import — and,
// deliberately, no database access of any kind. Every guard below is a total
// function over explicit inputs, so the whole authorization surface of an
// assignment is executed for real in tests rather than inferred from source.
//
// WHY THE I/O LIVES IN A CLI, NOT IN `src/`
// ─────────────────────────────────────────
// `tests/accessControl.test.ts` enforces a standing invariant: no file under
// `src/` may write `user_profiles`. That is what keeps the approval marker
// administrator-controlled, and it is stronger than "only writes the columns it
// should" — nothing HTTP-reachable can write the table at all.
//
// R13.1 keeps that invariant intact. The executing half of an assignment is
// `scripts/admin/assignPortfolioPrincipal.ts`, a CLI that lives outside the
// Next.js router exactly like `scripts/admin/provisionUser.ts`, and therefore
// cannot be reached over HTTP by anyone. This module holds the rules it applies.
//
// WHAT IS DELIBERATELY NOT POSSIBLE HERE
// ──────────────────────────────────────
// There is no code path — in this module or in the CLI — that writes
// `user_profiles.role`. Administrative capability is granted only by the
// existing service-role provisioning path, so no assignment operation can
// elevate anyone, including the actor.

import { isPortfolioPrincipal, type PortfolioPrincipal } from './entitlements.ts'

export type AssignmentDenialCode =
  | 'actor_unknown'
  | 'actor_not_approved'
  | 'actor_not_administrator'
  | 'invalid_target'
  | 'target_not_found'
  | 'invalid_principal'
  | 'self_assignment_forbidden'

export interface AssignmentActor {
  userId: string | null | undefined
  /** Non-empty `user_profiles.username`. */
  isApproved: boolean
  /** `user_profiles.role === 'administrator'`. */
  isAdministrator: boolean
}

export interface AssignmentRequest {
  actor: AssignmentActor
  targetUserId: unknown
  /** Whether the target's `user_profiles` row was found. */
  targetExists: boolean
  /** The target's stored principal before the change. */
  currentPrincipal: unknown
  /** The requested value; `null` clears the principal. */
  requestedPrincipal: unknown
}

export type AssignmentDecision =
  | {
      allowed: true
      targetUserId: string
      previousValue: PortfolioPrincipal | null
      newValue: PortfolioPrincipal | null
      /** False when the stored value already matches — no write, no audit row. */
      changed: boolean
    }
  | { allowed: false; code: AssignmentDenialCode }

/** Narrows a stored value; anything unrecognised is treated as no principal. */
export function normalizeStoredPrincipal(value: unknown): PortfolioPrincipal | null {
  return isPortfolioPrincipal(value) ? value : null
}

/**
 * Decides whether an administrative principal change may proceed.
 *
 * Guard order is deliberate: the actor is authorised BEFORE the request is even
 * examined, so an unauthorised caller learns nothing about whether a target
 * exists or what its current principal is.
 *
 * Fail-closed on every ambiguity — an unknown actor, an unapproved actor, a
 * non-administrator, a missing target, a malformed principal, or a self-assignment
 * all deny.
 */
export function decidePrincipalAssignment(request: AssignmentRequest): AssignmentDecision {
  const { actor } = request

  // 1 · Authorise the actor first.
  if (typeof actor.userId !== 'string' || actor.userId.trim().length === 0) {
    return { allowed: false, code: 'actor_unknown' }
  }
  if (actor.isApproved !== true) return { allowed: false, code: 'actor_not_approved' }
  if (actor.isAdministrator !== true) return { allowed: false, code: 'actor_not_administrator' }

  // 2 · Validate the request.
  if (typeof request.targetUserId !== 'string' || request.targetUserId.trim().length === 0) {
    return { allowed: false, code: 'invalid_target' }
  }
  const targetUserId = request.targetUserId.trim()

  // A requested principal must be null (clear) or one of the three family
  // principals. `'administrator'` is rejected here as well as by the database
  // CHECK constraint — role and principal never mix.
  const requested = request.requestedPrincipal
  if (requested !== null && requested !== undefined && !isPortfolioPrincipal(requested)) {
    return { allowed: false, code: 'invalid_principal' }
  }
  const newValue: PortfolioPrincipal | null = isPortfolioPrincipal(requested) ? requested : null

  // 3 · An administrator may not assign themselves a family principal. Together
  //     with role being unwritable anywhere in this flow, this closes both
  //     self-elevation and self-entitlement.
  if (targetUserId === actor.userId.trim()) {
    return { allowed: false, code: 'self_assignment_forbidden' }
  }

  if (request.targetExists !== true) return { allowed: false, code: 'target_not_found' }

  const previousValue = normalizeStoredPrincipal(request.currentPrincipal)

  return {
    allowed: true,
    targetUserId,
    previousValue,
    newValue,
    changed: previousValue !== newValue,
  }
}

/** The audit row an applied change must produce. Never built for a denial. */
export interface AccessAuditEntry {
  target_user_id: string
  actor_user_id: string
  field_changed: 'portfolio_principal'
  previous_value: string | null
  new_value: string | null
}

/**
 * Builds the audit entry for an allowed, actually-changing assignment.
 *
 * Returns null when the decision denied OR when nothing changed — an audit
 * trail of changes that did not change anything is noise, and a denial must
 * never produce a successful audit record.
 */
export function buildAccessAuditEntry(
  decision: AssignmentDecision,
  actorUserId: string,
): AccessAuditEntry | null {
  if (!decision.allowed || !decision.changed) return null
  return {
    target_user_id: decision.targetUserId,
    actor_user_id: actorUserId,
    field_changed: 'portfolio_principal',
    previous_value: decision.previousValue,
    new_value: decision.newValue,
  }
}
