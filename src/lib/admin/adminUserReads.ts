// POST-R13.6CDE — READ-ONLY lookups of another account's authorization facts.
//
// SERVER-ONLY, and administrator paths only. Every caller must have already
// passed `guardAdministrator()`; nothing here performs an authorization check,
// and nothing here should be reached without one.
//
// WHY THIS IS A SEPARATE FILE
// ───────────────────────────
// `tests/accessControl.test.ts` enforces a deliberately COARSE rule: no file
// under `src/` that touches `from('user_profiles')` may contain an insert,
// upsert or update ANYWHERE in it. The module-grant route needs to READ a
// target's profile and WRITE `user_module_grants`, which trips that rule even
// though it never writes a profile.
//
// The rule is not wrong and was not relaxed. It is coarse ON PURPOSE — a
// file-level boundary is hard to fool, and being pushed to keep profile-reading
// code away from write code is the rule working as intended, not an obstacle to
// route around. So the read lives here, in a file that contains no write verb of
// any kind and therefore satisfies the rule honestly, and the route keeps its
// writes in a file that never names `user_profiles`.
//
// `user_profiles` remains writable only by the administrator CLI
// (`scripts/admin/setUserRole.ts`), outside the Next.js router and unreachable
// over HTTP. Nothing in this stage changes that.

import { accountStatusOf, accountUsableOf } from './userDirectory.ts'
import { moduleAccessFromProfile } from '../auth/moduleAccess.ts'
import type { AccountStatus } from '../auth/accountLifecycle.ts'

/** The facts `decideGrantChange` needs about a target account. */
export interface AdminTargetFacts {
  exists: boolean
  /**
   * R13.6F — USABLE, not merely approved: activated and not disabled as well.
   *
   * Renaming this would have touched every caller for no benefit; what changed is
   * the MEANING, and it changed in the safe direction — a disabled account is no
   * longer a valid target for a mutation that assumes a live user.
   */
  isApproved: boolean
  isAdministrator: boolean
  /** Raw `module_key` values, unvalidated — the decision layer narrows them. */
  currentModules: string[]
  /** R13.6F — the derived status, so a caller can say WHY a target was refused. */
  status: AccountStatus
  /** True when a read failed. The caller must NOT treat this as "no access". */
  readFailed: boolean
}

const UNREADABLE: AdminTargetFacts = {
  exists: false,
  isApproved: false,
  isAdministrator: false,
  currentModules: [],
  status: 'unprovisioned',
  readFailed: true,
}

/**
 * Reads a target account's approval, role and explicit grants.
 *
 * A failed read returns `readFailed: true` rather than an empty grant set. The
 * difference matters: an empty set would let the caller conclude the target
 * holds nothing and proceed to "revoke" access that may in fact be granted.
 *
 * The narrow casts match the existing pattern in `getEntitlement.ts` and
 * `getModuleAccess.ts` — Supabase's type inference for these tables is
 * unreliable at this TypeScript recursion depth.
 */
export async function readAdminTargetFacts(
  client: unknown,
  targetUserId: string,
): Promise<AdminTargetFacts> {
  const profileRes = await (
    client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: {
                username: string | null
                role: string | null
                invited_at: string | null
                activated_at: string | null
                disabled_at: string | null
              } | null
              error: unknown
            }>
          }
        }
      }
    }
  )
    .from('user_profiles')
    .select('id, username, role, invited_at, activated_at, disabled_at')
    .eq('id', targetUserId)
    .maybeSingle()

  if (profileRes.error) return UNREADABLE

  const grantRes = await (
    client as never as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, val: string) => Promise<{
            data: { module_key: string }[] | null
            error: unknown
          }>
        }
      }
    }
  )
    .from('user_module_grants')
    .select('module_key')
    .eq('user_id', targetUserId)

  if (grantRes.error) return UNREADABLE

  const profile = profileRes.data
  const access = moduleAccessFromProfile(profile, [])

  return {
    exists: profile !== null,
    // R13.6F — `accountStatusOf(...) === 'active'` would NOT have been correct
    // here: an unapproved row that happens to carry an activated_at also derives
    // status 'active' (see the lifecycle truth table). Usability is the predicate
    // that actually combines approval with the lifecycle, so it is the one used.
    isApproved: accountUsableOf(profile),
    isAdministrator: access.isAdministrator,
    currentModules: (grantRes.data ?? []).map((r) => r.module_key),
    status: accountStatusOf(profile),
    readFailed: false,
  }
}
