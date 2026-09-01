// R13.6F — the invitation sequence, and its partial-failure model.
//
// PURE ORCHESTRATION. Every side effect is an injected port, so the whole of §13
// — Auth failure, database failure, email failure, retry, duplicate username,
// duplicate email, pre-existing Auth identity, orphan prevention — is exercised in
// unit tests with no network, no Supabase and no Resend.
//
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE
// ─────────────────────────────────────
// Inviting a user spans THREE systems that cannot share a transaction:
//
//   1. Supabase Auth   — creates the identity, mints the one-time link
//   2. PostgreSQL      — profile + module grants + audit  (atomic among themselves)
//   3. Resend          — delivers the link
//
// Step 2 is a single transactional RPC, so it can never half-apply. The dangerous
// seams are 1→2 and 2→3, and they fail in opposite directions:
//
//   1 succeeds, 2 fails  ->  an Auth identity with NO application profile. It
//                            cannot sign in (login resolves username through
//                            `user_profiles`) and it cannot be seen in the
//                            directory. A silent orphan.
//
//   2 succeeds, 3 fails  ->  a fully provisioned, correctly restricted account
//                            whose owner never received their link. NOT an error
//                            state: it is a real, recoverable one, and reporting
//                            it as success is what §13 forbids.
//
// They are handled differently on purpose. The first is COMPENSATED; the second is
// REPORTED.
//
//
// WHY THE COMPENSATING DELETE IS SAFE HERE, AND ONLY HERE
// ───────────────────────────────────────────────────────
// §19 forbids hard-deleting an established account, and `family_portfolio_access_
// audit.target_user_id` is `references auth.users(id) ON DELETE CASCADE` — so
// deleting an Auth identity DESTROYS that account's audit history. That is exactly
// why deletion is not a general capability in this release.
//
// The compensating delete runs only where all five of these hold, and it checks
// them rather than assuming them:
//
//   a. this request created the identity moments ago (`existedBefore === false`);
//   b. the provisioning RPC FAILED, so it rolled back entirely;
//   c. a re-read confirms NO profile row exists for that id;
//   d. therefore no `user_module_grants` row exists (FK is on `user_profiles`);
//   e. therefore no audit row exists — the RPC writes them inside the same
//      transaction that rolled back.
//
// With (c)-(e) verified there is nothing for the cascade to destroy: the delete
// removes an identity that has existed for milliseconds and is referenced by
// nothing. If the re-read cannot confirm (c) — including if the read itself fails
// — the identity is LEFT IN PLACE and reported. An un-deleted orphan is a
// nuisance; a deleted account with its audit trail is not recoverable.

import type { AccountShape } from './userProvisioning.ts'
import type { InviteSendResult } from './inviteEmail.ts'

/** Identity of the account being invited. */
export interface InviteIdentity {
  readonly username: string
  readonly email: string
  readonly displayName: string
}

/** Injected effects. Each returns a discriminated result; none throws. */
export interface InvitePorts {
  /**
   * Whether an Auth identity already exists for this email.
   *
   * `'error'` is a THIRD outcome, not folded into `null`. Reading it as "no
   * existing identity" would make the compensating delete believe it created an
   * account it may not have, which is the one mistake that could destroy history.
   */
  findAuthUserByEmail(email: string): Promise<{ id: string } | null | 'error'>

  /** `auth.admin.generateLink({ type: 'invite', ... })`. */
  generateInviteLink(
    email: string,
    redirectTo: string,
  ): Promise<
    | { ok: true; userId: string; actionLink: string }
    | { ok: false; code: string }
  >

  /** `nmi_admin_provision_invite(...)`, through the administrator's session. */
  provisionInvite(args: {
    userId: string
    identity: InviteIdentity
    shape: AccountShape
  }): Promise<{ ok: true } | { ok: false; code: string; status: number }>

  /** True only when a profile row genuinely exists. Read failure must return `'error'`. */
  profileExists(userId: string): Promise<boolean | 'error'>

  /** Auth Admin delete. Only ever called under the five conditions above. */
  deleteAuthUser(userId: string): Promise<boolean>

  /** Renders and sends the invitation. */
  sendInvite(args: {
    identity: InviteIdentity
    actionLink: string
  }): Promise<InviteSendResult>
}

export type InviteOutcome =
  | {
      readonly ok: true
      /** The provisioned account. */
      readonly userId: string
      /** False when the account is provisioned but the email did not go out. */
      readonly emailSent: boolean
      /** Short, link-free reason when `emailSent` is false. */
      readonly emailFailure: string | null
      /** True when an existing Auth identity was reused rather than created. */
      readonly reusedAuthIdentity: boolean
    }
  | {
      readonly ok: false
      readonly code: string
      readonly status: number
      /**
       * What happened to the Auth identity when provisioning failed.
       *
       *   'none'        nothing was created
       *   'removed'     created by this request, provisioning failed, safely removed
       *   'orphaned'    created but could NOT be safely removed — needs attention
       *   'preserved'   pre-existing identity, deliberately untouched
       */
      readonly authIdentity: 'none' | 'removed' | 'orphaned' | 'preserved'
    }

/**
 * Runs the invitation.
 *
 * Ordering is deliberate: Auth first, because it is the step that mints the id
 * everything else keys on, and it is the only one that can be compensated. Doing
 * the database first would leave a profile pointing at an `auth.users` row that
 * does not exist, which the RPC's own `auth_identity_missing` guard rejects.
 */
export async function runInvite(args: {
  identity: InviteIdentity
  shape: AccountShape
  redirectTo: string
  ports: InvitePorts
}): Promise<InviteOutcome> {
  const { identity, shape, redirectTo, ports } = args

  // 1 · Does an Auth identity already exist for this address?
  //
  // Asked BEFORE creating anything, purely so the compensating delete later knows
  // whether this request is the owner of that identity. A read failure is fatal
  // here rather than assumed-safe: proceeding would mean deleting on a guess.
  const existing = await ports.findAuthUserByEmail(identity.email)
  if (existing === 'error') {
    return { ok: false, code: 'auth_lookup_failed', status: 503, authIdentity: 'none' }
  }
  const existedBefore = existing !== null

  // 2 · Mint the identity and the one-time link.
  const link = await ports.generateInviteLink(identity.email, redirectTo)
  if (!link.ok) {
    return { ok: false, code: link.code, status: 502, authIdentity: existedBefore ? 'preserved' : 'none' }
  }

  // 3 · Application state, atomically. `already_activated` here is the guard that
  //     stops a re-invitation from re-opening a live account, and `username_taken`
  //     is the clean form of the unique-constraint collision.
  const provisioned = await ports.provisionInvite({
    userId: link.userId,
    identity,
    shape,
  })

  if (!provisioned.ok) {
    const authIdentity = await compensate(link.userId, existedBefore, ports)
    return { ok: false, code: provisioned.code, status: provisioned.status, authIdentity }
  }

  // 4 · Deliver. A failure here does NOT undo the account: it is provisioned,
  //     correctly restricted, and cannot be used by anyone until its owner follows
  //     a link they have not yet received. Resending is the remedy, and the
  //     administrator is told plainly so they can.
  const send = await ports.sendInvite({ identity, actionLink: link.actionLink })

  return {
    ok: true,
    userId: link.userId,
    emailSent: send.sent,
    emailFailure: send.sent ? null : (send.failure ?? 'delivery_failed'),
    reusedAuthIdentity: existedBefore,
  }
}

/**
 * Removes a just-created Auth identity after provisioning failed — but only when
 * every precondition is verified. See the header for why each one matters.
 */
async function compensate(
  userId: string,
  existedBefore: boolean,
  ports: InvitePorts,
): Promise<'removed' | 'orphaned' | 'preserved'> {
  // (a) We did not create it. Never touch an identity that predates this request:
  //     it may belong to an established account with history.
  if (existedBefore) return 'preserved'

  // (c) Confirm there is genuinely nothing attached. A read failure is treated as
  //     "cannot confirm", and therefore as "do not delete".
  const hasProfile = await ports.profileExists(userId)
  if (hasProfile !== false) return 'orphaned'

  const removed = await ports.deleteAuthUser(userId)
  return removed ? 'removed' : 'orphaned'
}

/**
 * Resending an invitation.
 *
 * Deliberately NOT a second `runInvite`: re-running provisioning would rewrite
 * role, principal and grants from whatever the resend form happened to hold, which
 * is not what "resend" means. This mints a fresh link for the SAME identity and
 * sends it, changing no access at all.
 *
 * The caller is responsible for refusing to resend to an account that is already
 * activated or is disabled — that is a state question the route answers from the
 * directory, and the `nmi_admin_provision_invite` guard is not involved here
 * because nothing is being provisioned.
 */
export async function runResend(args: {
  identity: InviteIdentity
  redirectTo: string
  ports: Pick<InvitePorts, 'generateInviteLink' | 'sendInvite'>
}): Promise<
  | { ok: true; emailSent: boolean; emailFailure: string | null }
  | { ok: false; code: string; status: number }
> {
  const { identity, redirectTo, ports } = args

  const link = await ports.generateInviteLink(identity.email, redirectTo)
  if (!link.ok) return { ok: false, code: link.code, status: 502 }

  const send = await ports.sendInvite({ identity, actionLink: link.actionLink })
  return {
    ok: true,
    emailSent: send.sent,
    emailFailure: send.sent ? null : (send.failure ?? 'delivery_failed'),
  }
}
