// R1.5 — Reusable server-side guard for private API route handlers.
//
// SERVER-ONLY.
//
// ENFORCEMENT MODEL. Middleware is the authoritative layer: it runs on every
// private path, verifies the identity with the Auth server, re-reads the
// approval record, and returns the exact JSON 401/403 documented below. Every
// private endpoint is therefore covered without a per-handler opt-in — this
// guard is NOT the difference between a protected and an unprotected route.
//
// It exists as defence in depth for handlers that need the caller's identity in
// their own logic, and so a handler is never tempted to hand-roll an equivalent
// check. Use it as the first statement of such a handler:
//
//   const denied = await guardPrivateApi()
//   if (denied) return denied
//
// It applies the same two conditions as middleware, through the same predicate:
//   · 401 `unauthenticated` — no session, or the session failed verification
//   · 403 `not_authorized`  — verified identity with no current approval record
//
// Both responses are JSON, carry `Cache-Control: no-store`, and contain only a
// reason code — no payload fragment, no internal detail.

import { NextResponse } from 'next/server'
import { getApprovedUser, type ApprovedUserResult } from './getUser.ts'
import { ACCESS_DENIED_REASONS } from './approval.ts'

/** Headers applied to every denial: a 401/403 must never be cached or shared. */
export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
} as const

/** Builds the canonical unauthenticated JSON denial. */
export function unauthenticatedJson(): NextResponse {
  return NextResponse.json(
    { error: ACCESS_DENIED_REASONS.unauthenticated },
    { status: 401, headers: NO_STORE_HEADERS },
  )
}

/** Builds the canonical authenticated-but-unapproved JSON denial. */
export function notAuthorizedJson(): NextResponse {
  return NextResponse.json(
    { error: ACCESS_DENIED_REASONS.notApproved },
    { status: 403, headers: NO_STORE_HEADERS },
  )
}

/**
 * Returns a denial response when the caller is not a currently-approved user,
 * or null when the request may proceed. Never throws.
 */
export async function guardPrivateApi(): Promise<NextResponse | null> {
  const access: ApprovedUserResult = await getApprovedUser()
  if (access.ok) return null
  return access.reason === 'unauthenticated' ? unauthenticatedJson() : notAuthorizedJson()
}
