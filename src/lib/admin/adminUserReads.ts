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

import { accountStatusOf } from './userDirectory.ts'
import { moduleAccessFromProfile } from '../auth/moduleAccess.ts'

/** The facts `decideGrantChange` needs about a target account. */
export interface AdminTargetFacts {
  exists: boolean
  isApproved: boolean
  isAdministrator: boolean
  /** Raw `module_key` values, unvalidated — the decision layer narrows them. */
  currentModules: string[]
  /** True when a read failed. The caller must NOT treat this as "no access". */
  readFailed: boolean
}

const UNREADABLE: AdminTargetFacts = {
  exists: false,
  isApproved: false,
  isAdministrator: false,
  currentModules: [],
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
              data: { username: string | null; role: string | null } | null
              error: unknown
            }>
          }
        }
      }
    }
  )
    .from('user_profiles')
    .select('id, username, role')
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
    isApproved: accountStatusOf(profile) === 'active',
    isAdministrator: access.isAdministrator,
    currentModules: (grantRes.data ?? []).map((r) => r.module_key),
    readFailed: false,
  }
}
