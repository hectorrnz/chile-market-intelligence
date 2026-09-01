// POST-R13.6B.1 — reusable server-side guards for the two sensitive surfaces.
//
// SERVER-ONLY.
//
// WHY THESE EXIST. PostgreSQL RLS is the authoritative boundary and is enforced
// whether or not a handler calls anything here. But a route that relies solely
// on RLS answers a forbidden request with an opaque database failure — a 500, or
// a silently empty list that reads like "there is no data" rather than "you may
// not see this". These guards make the API honest about the answer, using the
// same facts the database uses, and they exist so no handler is ever tempted to
// hand-roll an equivalent role check from `user_metadata` or client state.
//
// Use as the first statement of a handler:
//
//   const denied = await guardModuleRead('structured_notes')
//   if (denied) return denied
//
//   const denied = await guardAdministrator()
//   if (denied) return denied
//
// THE TWO ARE NOT INTERCHANGEABLE. A module grant answers "may this account
// reach this module at all" — never "may it write". Structured Notes reads are
// module-gated; every Structured Notes mutation, and every notification
// recipient operation of any kind, is administrator-only. A member holding the
// `structured_notes` grant must still be refused INSERT, UPDATE and DELETE.
//
// NOT A MODULE. Notification recipients are an outbound-data administration
// capability, deliberately NOT modelled as a module grant and with no
// `app_modules` row — so `guardAdministrator` is the only correct guard there.
// Passing a module key for it would be a category error.

import { NextResponse } from 'next/server'
import { getCallerModuleAccess, isAccessUnavailable } from './getModuleAccess.ts'
import { canAccessModule, type ModuleKey } from './moduleAccess.ts'
import { NO_STORE_HEADERS } from './apiGuard.ts'
import { ACCESS_DENIED_REASONS } from './approval.ts'

/**
 * Machine-readable denial reasons for these surfaces.
 *
 * Every value is re-exported from `ACCESS_DENIED_REASONS` rather than written
 * out again. Middleware answers the same two conditions at the request boundary
 * (POST-R13.6CDE.2), and a route guard that spelled them differently would give
 * one denial two wire codes depending on which layer happened to catch it.
 */
export const SENSITIVE_DENIAL_REASONS = {
  /** Authenticated and approved, but the module was not granted. */
  moduleNotGranted: ACCESS_DENIED_REASONS.moduleNotGranted,
  /** Authenticated and approved, but the operation is administrator-only. */
  administratorRequired: ACCESS_DENIED_REASONS.administratorRequired,
  /**
   * The entitlement store could not be READ. Not an authorization answer — the
   * request is still refused, but the cause is this deployment, not the caller.
   *
   * Answered 503, never 403. A 403 asserts "we checked and you may not"; saying
   * that when nothing was checked sends every reader — the UI, the operator,
   * the next engineer — after the wrong problem. POST-R13.6CDE traced the
   * reported "Something went wrong" on Structured Notes to exactly that
   * confusion.
   */
  accessUnavailable: ACCESS_DENIED_REASONS.accessUnavailable,
} as const

/** Builds the canonical module denial. Carries no payload fragment. */
export function moduleForbiddenJson(): NextResponse {
  return NextResponse.json(
    { error: SENSITIVE_DENIAL_REASONS.moduleNotGranted },
    { status: 403, headers: NO_STORE_HEADERS },
  )
}

/** Builds the canonical administrator-required denial. */
export function administratorForbiddenJson(): NextResponse {
  return NextResponse.json(
    { error: SENSITIVE_DENIAL_REASONS.administratorRequired },
    { status: 403, headers: NO_STORE_HEADERS },
  )
}

/**
 * Builds the entitlement-store-unavailable response.
 *
 * 503, and deliberately retryable-looking, because it IS: the same request from
 * the same caller succeeds once the deployment's database carries the module
 * migrations. Carries no schema detail — an unauthenticated probe learns only
 * that this deployment is degraded, which it can already tell.
 */
export function accessUnavailableJson(): NextResponse {
  return NextResponse.json(
    { error: SENSITIVE_DENIAL_REASONS.accessUnavailable },
    { status: 503, headers: NO_STORE_HEADERS },
  )
}

/**
 * Denies unless the caller may reach `module`.
 *
 * Returns a 403 response, or null when the request may proceed. Never throws.
 * An administrator passes by role without holding a grant row; an unapproved or
 * session-less caller is denied here as well, so this is safe even on a path
 * middleware has not already covered.
 */
export async function guardModuleRead(module: ModuleKey): Promise<NextResponse | null> {
  const { access, reason } = await getCallerModuleAccess()
  if (isAccessUnavailable(reason)) return accessUnavailableJson()
  return canAccessModule(access, module) ? null : moduleForbiddenJson()
}

/**
 * Denies unless the caller is a currently-approved administrator.
 *
 * Returns a 403 response, or null when the request may proceed. Never throws.
 * A module grant can never satisfy this guard — that is the entire point.
 */
export async function guardAdministrator(): Promise<NextResponse | null> {
  const { isAdministrator, reason } = await getCallerModuleAccess()
  if (isAccessUnavailable(reason)) return accessUnavailableJson()
  return isAdministrator ? null : administratorForbiddenJson()
}

/**
 * Guard a read AND report whether the caller may mutate, in ONE resolution.
 *
 * Read routes that also drive UI affordances need both facts. Resolving them
 * separately would mean two profile+grant round-trips per request and, worse,
 * two chances for the answers to disagree. `canManage` is the same
 * administrator fact the mutation guard uses, so a client can never be shown a
 * control the API would refuse.
 *
 * `canManage` is always false when `denied` is non-null.
 */
export async function guardModuleReadWithCapability(
  module: ModuleKey,
): Promise<{ denied: NextResponse | null; canManage: boolean }> {
  const { access, isAdministrator, reason } = await getCallerModuleAccess()
  if (isAccessUnavailable(reason)) return { denied: accessUnavailableJson(), canManage: false }
  if (!canAccessModule(access, module)) return { denied: moduleForbiddenJson(), canManage: false }
  return { denied: null, canManage: isAdministrator }
}
