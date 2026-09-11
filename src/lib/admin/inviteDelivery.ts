// D0B1 — HOW an invitation reaches its recipient, and nothing else.
//
// PURE MODULE. No I/O, no environment, no imports with side effects — so the
// delivery contract and the exact shape of every response body below are
// unit-testable without a server, and the one property that matters most can be
// asserted behaviourally rather than by reading source text.
//
//
// WHY A DELIVERY MODE AND NOT A SECOND INVITATION FLOW
// ────────────────────────────────────────────────────
// The account lifecycle is unchanged and must stay that way: Auth mints the
// identity, `nmi_admin_provision_invite` writes profile + grants + audit in one
// transaction, the emailed URL is built from the `hashed_token` by
// `buildInviteAcceptUrl`, and `/auth/callback` redeems it with `verifyOtp`. A
// second onboarding path would be a second thing to get wrong, and the two would
// drift. The ONLY difference manual mode makes is that the last hop — Resend —
// is not attempted, and the URL that would have been emailed is handed to the
// administrator who asked for it instead.
//
// Outbound email is deferred at the owner's instruction (no purchased domain, no
// Resend-verified sender), so an invitation cannot currently be delivered to an
// arbitrary work address. Manual delivery is what makes onboarding possible
// without one. The email path is retained, unchanged, for when a domain exists.
//
//
// THE INVITATION URL IS A BEARER CREDENTIAL
// ─────────────────────────────────────────
// Whoever holds it before it expires can activate that account. It is therefore
// treated exactly like the action link always has been: returned once, to the
// administrator who created the invitation, over the response to their own
// authenticated request — and never written to a database, an audit row, a log
// line, an error message or any subsequent read.
//
// That is why `invitationUrl` appears in exactly ONE place in this file: the
// success body of a creation or re-invitation. `inviteErrorBody` cannot carry it
// because it never receives it, and the directory read has nowhere to get it
// from — no token is stored, so there is nothing for a later GET to return.

/** The two ways an invitation can reach the person it is for. */
export const INVITE_DELIVERY_MODES = ['email', 'manual'] as const

export type InviteDeliveryMode = (typeof INVITE_DELIVERY_MODES)[number]

/**
 * The mode used when a request does not say.
 *
 * `email` — deliberately the PRE-D0B1 behaviour, so a caller written before this
 * field existed keeps getting exactly what it got before. New delivery semantics
 * must be asked for; they are never assumed for someone who did not ask.
 * (The console asks for `manual` explicitly — see InviteUserDialog.)
 */
export const DEFAULT_INVITE_DELIVERY: InviteDeliveryMode = 'email'

export function isInviteDeliveryMode(v: unknown): v is InviteDeliveryMode {
  return v === 'email' || v === 'manual'
}

/**
 * Reads the delivery mode off a request body.
 *
 * Absent means "unspecified", which resolves to the existing behaviour. A value
 * that is PRESENT but not one of the two is rejected rather than coerced: a
 * caller that sent `"Manual"`, `"link"` or `true` believed something about how
 * this invitation would travel, and silently doing the other thing is how an
 * administrator ends up waiting for an email nobody sent — or, worse, how a URL
 * they expected to copy is instead mailed to an unverified address.
 */
export function parseInviteDelivery(
  raw: unknown,
): { ok: true; mode: InviteDeliveryMode } | { ok: false; code: 'invalid_delivery' } {
  if (raw === undefined || raw === null) return { ok: true, mode: DEFAULT_INVITE_DELIVERY }
  if (isInviteDeliveryMode(raw)) return { ok: true, mode: raw }
  return { ok: false, code: 'invalid_delivery' }
}

/** What a manual invitation hands back. Null for every email-mode outcome. */
export interface InvitationUrlCarrier {
  readonly delivery: InviteDeliveryMode
  readonly invitationUrl: string | null
}

/** The success body of `POST /api/admin/users`. */
export interface InviteSuccessBody {
  readonly ok: true
  readonly userId: string
  readonly delivery: InviteDeliveryMode
  readonly emailSent: boolean
  readonly emailFailure: string | null
  readonly reusedAuthIdentity: boolean
  /** Present ONLY for a manual invitation, and only on this one response. */
  readonly invitationUrl: string | null
}

/** The success body of `POST /api/admin/users/[id]/invitation`. */
export interface ResendSuccessBody {
  readonly ok: true
  readonly delivery: InviteDeliveryMode
  readonly emailSent: boolean
  readonly emailFailure: string | null
  readonly invitationUrl: string | null
}

/**
 * Projects a successful invitation into the JSON the route returns.
 *
 * Written as a function rather than an object literal inside the handler so the
 * response body itself is a testable value: the tests below assert the URL is
 * present exactly once in manual mode and absent entirely in email mode, against
 * this function's real output rather than against the handler's source text.
 */
export function inviteSuccessBody(outcome: {
  userId: string
  delivery: InviteDeliveryMode
  emailSent: boolean
  emailFailure: string | null
  reusedAuthIdentity: boolean
  invitationUrl: string | null
}): InviteSuccessBody {
  return {
    ok: true,
    userId: outcome.userId,
    delivery: outcome.delivery,
    emailSent: outcome.emailSent,
    emailFailure: outcome.emailFailure,
    reusedAuthIdentity: outcome.reusedAuthIdentity,
    // Belt and braces over the orchestration's own guarantee: an email-mode
    // outcome can never carry a URL out of this function even if a future change
    // started populating the field upstream.
    invitationUrl: outcome.delivery === 'manual' ? outcome.invitationUrl : null,
  }
}

export function resendSuccessBody(outcome: {
  delivery: InviteDeliveryMode
  emailSent: boolean
  emailFailure: string | null
  invitationUrl: string | null
}): ResendSuccessBody {
  return {
    ok: true,
    delivery: outcome.delivery,
    emailSent: outcome.emailSent,
    emailFailure: outcome.emailFailure,
    invitationUrl: outcome.delivery === 'manual' ? outcome.invitationUrl : null,
  }
}

/**
 * The failure body. Takes a code and, for the creation path, what happened to the
 * Auth identity — and structurally CANNOT carry a URL, because it is never given
 * one. A failed invitation has no link to hand over: either none was minted, or
 * the account it belonged to was rolled back and the identity compensated.
 */
export function inviteErrorBody(
  code: string,
  authIdentity?: 'none' | 'removed' | 'orphaned' | 'preserved',
): { error: string; authIdentity?: string } {
  return authIdentity === undefined ? { error: code } : { error: code, authIdentity }
}
