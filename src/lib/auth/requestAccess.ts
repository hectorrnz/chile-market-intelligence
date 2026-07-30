// R1.5 correction — THE per-request access decision.
//
// Pure and dependency-injected: it takes an identity VERIFIER and an approval
// LOOKUP as functions, so the whole decision table (forged cookie, expired
// token, banned user, unapproved identity, revoked approval, approved user) is
// exercised behaviourally in tests without a network or a framework. Middleware
// supplies Supabase-backed implementations; nothing else re-derives this logic.
//
// WHAT CHANGED AND WHY
// ────────────────────
// The first R1.5 pass gated on `getSession()` — a cookie read that does not
// verify the JWT with the Auth server — and checked approval only when a
// session was minted. Two consequences, both unacceptable for a private
// platform:
//
//   · a token the Auth server would reject (revoked, or belonging to a banned
//     or deleted user) still satisfied a cookie-only check until it expired;
//   · revoking approval took effect only at the next sign-in, leaving a window
//     of up to the access-token lifetime (Supabase default 1 h).
//
// Both are closed by verifying the identity AND re-reading the approval record
// on EVERY private request. See `docs/security_access_control.md` for the
// latency this costs and why it is accepted.

import { isApprovedProfile, type ApprovalProfile } from './approval.ts'
import { requiresApprovedSession, deniesWithJson } from './accessPolicy.ts'

/**
 * Result of an authoritative identity verification.
 *
 * `user` is non-null ONLY when the verifier confirmed the token with the
 * identity provider. A malformed cookie, a forged or expired token, and a
 * banned or deleted user must all produce `user: null` — the verifier must
 * never fall back to decoding the token locally.
 */
export interface VerifiedIdentity {
  user: { id: string } | null
}

export type IdentityVerifier = () => Promise<VerifiedIdentity>
export type ApprovalLookup = (userId: string) => Promise<ApprovalProfile | null>

export type DenialReason = 'unauthenticated' | 'not_approved'

export type AccessDecision =
  /** Path is exempt from the gate (public, framework, bearer-authenticated). */
  | { outcome: 'exempt' }
  /** Verified identity with a current approval record. */
  | { outcome: 'allow'; userId: string }
  /**
   * Denied. `status` is 401 when the session itself is invalid and 403 when a
   * valid identity simply lacks approval. `json` mirrors the route class, so
   * an API never receives an HTML redirect and a page never receives JSON.
   */
  | { outcome: 'deny'; reason: DenialReason; status: 401 | 403; json: boolean }

/**
 * Decides whether a request for `pathname` may proceed.
 *
 * Order matters: identity is verified first, so an unauthenticated caller can
 * never learn anything about approval state, and the approval lookup is never
 * issued for an unverified token.
 */
export async function decideRequestAccess(
  pathname: string,
  verifyIdentity: IdentityVerifier,
  loadApproval: ApprovalLookup,
): Promise<AccessDecision> {
  if (!requiresApprovedSession(pathname)) return { outcome: 'exempt' }

  const json = deniesWithJson(pathname)

  // 1 · Authoritative identity verification (network-verified, never a local
  //     token decode). Covers: missing session, malformed cookie, forged token,
  //     expired token, banned user, deleted user.
  let identity: VerifiedIdentity
  try {
    identity = await verifyIdentity()
  } catch {
    // A verifier that throws is treated as a failed verification — fail closed.
    return { outcome: 'deny', reason: 'unauthenticated', status: 401, json }
  }
  if (!identity.user?.id) {
    return { outcome: 'deny', reason: 'unauthenticated', status: 401, json }
  }

  // 2 · CURRENT approval, re-read on every private request. This is what makes
  //     revocation immediate: clearing the marker denies the very next request
  //     rather than waiting for the access token to expire.
  let profile: ApprovalProfile | null
  try {
    profile = await loadApproval(identity.user.id)
  } catch {
    return { outcome: 'deny', reason: 'not_approved', status: 403, json }
  }
  if (!isApprovedProfile(profile)) {
    return { outcome: 'deny', reason: 'not_approved', status: 403, json }
  }

  return { outcome: 'allow', userId: identity.user.id }
}

/**
 * When a denial should also clear the caller's session cookies.
 *
 * A revoked or unapproved identity is holding a cookie that will keep failing;
 * dropping it stops the browser replaying it and makes the next request a clean
 * unauthenticated one. Not done for a plain `unauthenticated` denial: there is
 * nothing useful to clear, and a mid-refresh request must not lose its session.
 */
export function shouldClearSession(decision: AccessDecision): boolean {
  return decision.outcome === 'deny' && decision.reason === 'not_approved'
}
