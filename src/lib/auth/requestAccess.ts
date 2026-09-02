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

// POST-R13.6CDE.1 — THE PLATFORM-ACCESS BOUNDARY JOINS THIS TABLE.
//
// Approval used to be the whole gate: an approved account reached the shell and
// every module inside it. The owner replaced that model. Approval now means the
// account EXISTS; what admits it is entitlement — administrator by role, or at
// least one explicit module grant. A member holding nothing is refused the
// application entirely, Overview and personal Settings included.
//
// It belongs HERE, not in a page or a layout, for two reasons. Middleware is the
// only place that can refuse before the shell renders, which is what § 4 of the
// stage requires; and it is the same choke point that already answers pages with
// a redirect and APIs with JSON, so a zero-grant member's API call cannot
// receive an HTML login page.
//
// FOUR OUTCOMES, NOT TWO. `no_platform_access` is an ANSWER (approved, granted
// nothing) and `access_unavailable` is a FAILURE (the grant store could not be
// read). Both refuse. Keeping them apart is the same discipline
// `getModuleAccess.ts` applies, and for the same reason: collapsing them made a
// database-behind-its-code look identical to a deliberate denial, which is
// exactly the bug POST-R13.6CDE was opened to fix.

// POST-R13.6CDE.2 — STEP B: THE REQUESTED MODULE.
//
// Passing the platform boundary answers "may this account enter Nevada Market
// Intelligence". It does NOT answer "may it enter every module". Until this
// stage nothing asked the second question: `moduleRoutes.ts` existed, was
// tested, and had no production consumer, so a member granted `macro` alone
// reached Stocks, Compare, Earnings, Portfolio and Structured Notes by typing
// their URLs. Every private path now resolves through that table.
//
// It belongs in the SAME decision, immediately after the boundary, for the
// reasons the boundary belongs here: middleware is the only place that can
// refuse before the shell renders, and it is the one choke point that already
// answers pages with a redirect and APIs with JSON. Route handlers still
// re-derive their own answer and PostgreSQL RLS still holds underneath — this
// is the first of three layers, never the only one.
//
// ONE STATE, NOT TWO SNAPSHOTS. Steps A and B read the same
// `AuthorizationState`, resolved by ONE query. Two lookups would cost an extra
// sequential round-trip on every member request and, worse, could disagree with
// each other inside a single request if a grant changed between them.

import { requiresApprovedSession, deniesWithJson } from './accessPolicy.ts'
import { canEnterPlatform } from './moduleAccess.ts'
import { resolvePathModule, bindingSatisfiedBy } from './moduleRoutes.ts'
import {
  moduleAccessOf,
  type AuthorizationState,
  type AuthorizationStateLookup,
} from './authorizationState.ts'

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

export type DenialReason =
  | 'unauthenticated'
  | 'not_approved'
  /**
   * R13.6F — provisioned, but an administrator has switched this account off.
   * DISTINCT from `not_approved` because the remedies are opposite: this account
   * must be REACTIVATED, not provisioned again, and its grants, role and principal
   * are all still intact waiting for that.
   */
  | 'account_disabled'
  /**
   * R13.6F — invited, but the invitation has never been accepted. Also distinct:
   * nothing is wrong with the account, the person simply has not followed their
   * link, and the fix is to resend the invitation rather than change any access.
   */
  | 'account_not_activated'
  /** Approved, but holds no module: no application access at all. */
  | 'no_platform_access'
  /** Inside the platform, but this surface belongs to a module not held. */
  | 'module_not_granted'
  /** Inside the platform, but this surface is a role capability. */
  | 'administrator_required'
  /** The entitlement store could not be read. A failure, not an answer. */
  | 'access_unavailable'

export type AccessDecision =
  /** Path is exempt from the gate (public, framework, bearer-authenticated). */
  | { outcome: 'exempt' }
  /** Verified identity, current approval record, and platform entitlement. */
  | { outcome: 'allow'; userId: string }
  /**
   * Denied. `status` is 401 when the session itself is invalid, 403 for every
   * authorization answer (unapproved, no platform access, module not granted,
   * administrator required), and 503 when the entitlement store could not be
   * read at all. `json` mirrors the ROUTE CLASS and is computed before any
   * reason is known, so an API can never receive an HTML redirect and a page
   * can never receive JSON — whichever layer produced the denial.
   */
  | { outcome: 'deny'; reason: DenialReason; status: 401 | 403 | 503; json: boolean }

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
  loadAuthorizationState: AuthorizationStateLookup,
): Promise<AccessDecision> {
  if (!requiresApprovedSession(pathname)) return { outcome: 'exempt' }

  // Computed from the ROUTE, before any authorization reasoning. A page denial
  // is a redirect and an API denial is JSON no matter which check refuses.
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

  // 2 · THE authorization state — approval, role and grants — read together in
  //     ONE query, re-read on every private request so revocation of either the
  //     username or the last grant denies the very next request rather than
  //     waiting for the access token to expire.
  let resolved: Awaited<ReturnType<AuthorizationStateLookup>>
  try {
    resolved = await loadAuthorizationState(identity.user.id)
  } catch {
    resolved = { ok: false }
  }
  // The store failed. Refuse — and say so honestly. NOT a fallback to "allow if
  // the table is missing", which would defeat the entire entitlement design, and
  // NOT a 403, which would tell a correctly-configured member they had been
  // denied when nothing was ever checked.
  if (!resolved.ok) {
    return { outcome: 'deny', reason: 'access_unavailable', status: 503, json }
  }
  const state: AuthorizationState | null = resolved.state
  if (state === null || !state.approved) {
    return { outcome: 'deny', reason: 'not_approved', status: 403, json }
  }

  // 2b · R13.6F — THE LIFECYCLE GATE, applied before role or grants are consulted.
  //
  // A disabled account with a still-valid Supabase session is refused HERE, on the
  // very next request, because the state is re-read every time rather than trusted
  // from the token. Hiding navigation or deleting a cookie would not be enough and
  // is not what happens: `moduleAccessOf` also collapses `isApproved` to false for
  // this state, so even a caller that bypassed this branch entirely would hold no
  // module and no scope — and PostgreSQL RLS refuses them a third time underneath.
  //
  // Two distinct reasons because the remedies differ: reactivate versus resend.
  // Ordered disabled-first to match `accountStatus` precedence, so an account
  // disabled before it was ever accepted reports as disabled rather than pending.
  // Read DEFENSIVELY. `parseAuthorizationRow` always populates `lifecycle`, but
  // this function takes its state from an injected lookup, and a state object
  // assembled by some other caller — a future adapter, an older build, a test —
  // could omit it. Dereferencing it directly threw a TypeError instead of
  // denying, which in middleware is strictly worse than any denial: an exception
  // escaping here is not a decision at all. Absent lifecycle is therefore read as
  // NOT ACTIVATED, which fails closed.
  const lifecycle = state.lifecycle
  if (lifecycle?.disabledAt) {
    return { outcome: 'deny', reason: 'account_disabled', status: 403, json }
  }
  if (!lifecycle?.activatedAt) {
    return { outcome: 'deny', reason: 'account_not_activated', status: 403, json }
  }

  const access = moduleAccessOf(state)

  // 3 · STEP A — PLATFORM ENTITLEMENT. Approval says the account exists; this
  //     says it may enter. An administrator is admitted by role; a member needs
  //     at least one module that resolves.
  if (!canEnterPlatform(access)) {
    return { outcome: 'deny', reason: 'no_platform_access', status: 403, json }
  }

  // 4 · STEP B — THE REQUESTED SURFACE. Entering the platform is not entering
  //     every module. An unmapped private path denies here, administrators
  //     included: a surface added later must be classified deliberately before
  //     anyone reaches it.
  const binding = resolvePathModule(pathname)
  if (!bindingSatisfiedBy(binding, access)) {
    const reason: DenialReason =
      binding.kind === 'administrator_only' ? 'administrator_required' : 'module_not_granted'
    return { outcome: 'deny', reason, status: 403, json }
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
 *
 * DELIBERATELY NOT DONE for `no_platform_access`, `module_not_granted`,
 * `administrator_required` or `access_unavailable`. All four callers are
 * approved and genuinely signed in; signing them out would be a routing
 * convenience, not a security measure, and it would destroy a valid session the
 * moment an administrator is about to grant them a module. Typing the URL of a
 * module you do not hold is not a reason to lose your session. The boundary
 * refuses the request — it does not end the session.
 *
 * R13.6F adds `account_disabled`, which belongs with `not_approved` rather than
 * with those four: the account has been switched off deliberately, so its cookie
 * will keep failing on every subsequent request until an administrator acts.
 *
 * This is DEFENCE IN DEPTH, never the mechanism. Clearing a cookie is advice to a
 * cooperating browser and nothing more; a caller who simply keeps replaying the
 * cookie is still refused here on every request, still holds no module because
 * `moduleAccessOf` collapses their access, and is still refused by PostgreSQL RLS
 * underneath. Deleting the cookie only stops the pointless replay.
 *
 * NOT done for `account_not_activated`: that session was minted by following a
 * live invitation link, and the very next thing the invitee does is activate. Ending
 * their session mid-acceptance would break the flow it exists to serve.
 */
export function shouldClearSession(decision: AccessDecision): boolean {
  if (decision.outcome !== 'deny') return false
  return decision.reason === 'not_approved' || decision.reason === 'account_disabled'
}
