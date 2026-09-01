// R13.6F — THE account lifecycle rule, in TypeScript.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import, so it is
// directly unit-testable and can be consumed identically by middleware, by server
// route handlers, and (for labelling only) by the client.
//
// THIS FILE IS ONE HALF OF A TWO-SIDED CONTRACT. The other half is
// `public.nmi_profile_usable(text, timestamptz, timestamptz)` in
// supabase/migrations/20260817000000_user_lifecycle_provisioning.sql.
// `tests/userLifecycle.test.ts` asserts both sides answer identically for every
// case in the shared truth table below. A mismatch is a blocking failure:
// TypeScript must never invent authorization semantics PostgreSQL does not share.
//
//
// WHY THREE TIMESTAMPS AND NOT AN `enabled` BOOLEAN
// ─────────────────────────────────────────────────
// A boolean records the current state and forgets how it was reached. The
// administrator's question is almost never "is this on?" — it is "was this person
// ever really here, and when did we switch them off?". Timestamps answer both, and
// they make reactivation non-destructive: clearing `disabledAt` restores the
// account without erasing that it was once disabled.
//
// The states are DERIVED, never stored, so a stored status can never drift out of
// step with the timestamps that justify it.
//
//
// THE ONE PROPERTY THAT MATTERS
// ─────────────────────────────
// `isAccountUsable` is substituted into the `isApproved` input of the existing
// module and Portfolio rules — exactly as `nmi_profile_usable` is substituted in
// SQL. Both of those rules already deny EVERYTHING (administrators included) when
// `isApproved` is false, so a disabled account loses every module and every
// Portfolio scope through rules that already existed and are not modified here.
//
// That is deliberate, and it is why this file contains no allow-list: adding a new
// module or a new scope later cannot accidentally escape lifecycle enforcement,
// because enforcement lives at the input, not at each consumer.

/** The lifecycle facts, exactly as stored on `user_profiles`. */
export interface AccountLifecycle {
  /** Non-empty `username` — the platform approval marker. */
  readonly approved: boolean
  /** `invited_at`, ISO string or null. */
  readonly invitedAt: string | null
  /** `activated_at`, ISO string or null. */
  readonly activatedAt: string | null
  /** `disabled_at`, ISO string or null. */
  readonly disabledAt: string | null
}

/**
 * The derived account states.
 *
 * `unprovisioned` is the fourth, honest state: a profile row exists but carries no
 * approval marker and no invitation — a record that was never turned into an
 * account. It is deliberately NOT called "pending", because pending suggests
 * something is in flight when nothing is.
 */
export const ACCOUNT_STATUSES = ['active', 'invited', 'disabled', 'unprovisioned'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

/**
 * THE rule: may this account be authorized at all?
 *
 * Mirrors `nmi_profile_usable`. Fail-closed in one direction only — any missing or
 * unexpected value reduces access, never widens it.
 *
 *   approved AND activated AND NOT disabled
 *
 * Note what is absent: role. An administrator is not exempt. A disabled
 * administrator is not an administrator, which is what makes the disable action
 * meaningful for the only role that could otherwise ignore it.
 */
export function isAccountUsable(lifecycle: AccountLifecycle): boolean {
  if (lifecycle.approved !== true) return false
  if (lifecycle.activatedAt === null || lifecycle.activatedAt === undefined) return false
  if (lifecycle.disabledAt !== null && lifecycle.disabledAt !== undefined) return false
  return true
}

/**
 * The account's status, derived.
 *
 * Order matters and encodes precedence: disabled beats everything (an account
 * disabled after activation is DISABLED, not ACTIVE), activation beats invitation
 * (an accepted invitation is ACTIVE, not INVITED), and an approved-but-never
 * activated account with no invitation is still `unprovisioned` rather than
 * pretending an invitation exists.
 */
export function accountStatus(lifecycle: AccountLifecycle): AccountStatus {
  if (lifecycle.disabledAt) return 'disabled'
  if (lifecycle.activatedAt) return 'active'
  if (lifecycle.invitedAt) return 'invited'
  return 'unprovisioned'
}

/**
 * Reads lifecycle facts off a raw `user_profiles` row.
 *
 * Every field is treated as hostile: the row arrives from the database, and a
 * value this build does not understand must reduce access rather than be trusted.
 * A non-string timestamp is read as absent, which for `activatedAt` denies and for
 * `disabledAt` would ALLOW — so `disabledAt` is deliberately stricter: anything
 * present that is not an empty value counts as disabled.
 */
export function lifecycleFromProfile(
  profile:
    | {
        username?: unknown
        invited_at?: unknown
        activated_at?: unknown
        disabled_at?: unknown
      }
    | null
    | undefined,
): AccountLifecycle {
  if (!profile) return { approved: false, invitedAt: null, activatedAt: null, disabledAt: null }

  const username = typeof profile.username === 'string' ? profile.username.trim() : ''

  // A timestamp we can read as a string is a timestamp. Anything else is absent.
  const ts = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v : null

  // `disabled_at` is the one field where "I do not understand this value" must mean
  // DISABLED rather than not-disabled. A non-null, non-string value here (a Date
  // object from some future client, a number) would otherwise silently re-enable a
  // switched-off account.
  const rawDisabled = profile.disabled_at
  const disabledAt =
    rawDisabled === null || rawDisabled === undefined
      ? null
      : (ts(rawDisabled) ?? '__disabled__')

  return {
    approved: username.length > 0,
    invitedAt: ts(profile.invited_at),
    activatedAt: ts(profile.activated_at),
    disabledAt,
  }
}

/**
 * The shared truth table, asserted against BOTH implementations.
 *
 * Exported so the SQL-parity test and the TypeScript unit test read the same rows
 * rather than two hand-maintained copies that could drift apart — the same device
 * `moduleTruthTable.ts` uses for the module rule.
 */
export interface LifecycleTruthRow {
  readonly label: string
  readonly approved: boolean
  readonly activated: boolean
  readonly disabled: boolean
  readonly usable: boolean
  readonly status: AccountStatus
}

export const LIFECYCLE_TRUTH_TABLE: readonly LifecycleTruthRow[] = [
  { label: 'active member',                 approved: true,  activated: true,  disabled: false, usable: true,  status: 'active' },
  { label: 'invited, not yet accepted',     approved: true,  activated: false, disabled: false, usable: false, status: 'invited' },
  { label: 'disabled after activation',     approved: true,  activated: true,  disabled: true,  usable: false, status: 'disabled' },
  { label: 'disabled before activation',    approved: true,  activated: false, disabled: true,  usable: false, status: 'disabled' },
  { label: 'unapproved but activated',      approved: false, activated: true,  disabled: false, usable: false, status: 'active' },
  { label: 'unapproved and never active',   approved: false, activated: false, disabled: false, usable: false, status: 'invited' },
  { label: 'unapproved and disabled',       approved: false, activated: false, disabled: true,  usable: false, status: 'disabled' },
  { label: 'unapproved, activated, disabled', approved: false, activated: true, disabled: true, usable: false, status: 'disabled' },
] as const

/**
 * Builds the lifecycle facts for one truth-table row.
 *
 * The `invited` axis is not part of the table because it never affects usability —
 * only presentation — so every row is given an invitation to keep `status`
 * well-defined for the rows that are neither active nor disabled.
 */
export function lifecycleForTruthRow(row: LifecycleTruthRow): AccountLifecycle {
  return {
    approved: row.approved,
    invitedAt: '2026-01-01T00:00:00.000Z',
    activatedAt: row.activated ? '2026-01-02T00:00:00.000Z' : null,
    disabledAt: row.disabled ? '2026-01-03T00:00:00.000Z' : null,
  }
}
