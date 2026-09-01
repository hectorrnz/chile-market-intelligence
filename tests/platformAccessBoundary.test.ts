// POST-R13.6CDE.1 — THE ZERO-MODULE PLATFORM ACCESS BOUNDARY.
//
// The owner replaced one rule: Overview and personal Settings are no longer
// unconditional for an approved member. Approval now means the account EXISTS;
// what admits it to the application is entitlement — administrator by role, or
// at least one explicit module grant. An approved member holding nothing is
// refused the authenticated application entirely.
//
// MOSTLY BEHAVIOURAL. `canEnterPlatform` and `decideRequestAccess` are pure and
// dependency-injected, so every case below runs the REAL decision the middleware
// executes, with the identity verifier, the approval lookup and the grant lookup
// supplied as functions. No mocking of the decision itself, and no source
// scanning where a behaviour can be executed.
//
// STRUCTURAL ONLY WHERE BEHAVIOUR CANNOT REACH. Three properties live in the
// binding rather than in a function: that middleware reads `role` and the grant
// table through the user-session client, that a page denial for the two new
// reasons carries no `next`, and that the console confirms a total revocation in
// the app's own dialog. Those are asserted against comment-stripped source, and
// each asserts the property rather than a literal.
//
// WHAT IS NOT CLAIMED. Nothing here executes SQL or HTTP. PostgreSQL RLS remains
// the authoritative layer underneath every assertion in this file: a zero-grant
// member who bypassed this boundary entirely would still read nothing.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  canEnterPlatform,
  APP_MODULE_KEYS,
  type ModuleAccessInput,
} from '../src/lib/auth/moduleAccess.ts'
import {
  decideRequestAccess,
  shouldClearSession,
  type IdentityVerifier,
} from '../src/lib/auth/requestAccess.ts'
import {
  AUTHORIZATION_STATE_SELECT,
  type AuthorizationStateLookup,
} from '../src/lib/auth/authorizationState.ts'
import { classifyPath, requiresApprovedSession, deniesWithJson } from '../src/lib/auth/accessPolicy.ts'
import { ACCESS_DENIED_REASONS } from '../src/lib/auth/approval.ts'
import { scopesFor } from '../src/lib/portfolioAccess/entitlements.ts'
import { portfolioVisibleScopes } from '../src/lib/portfolioAccess/portfolioModuleComposition.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Source with comments stripped, so a comment can never satisfy an assertion. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const MIDDLEWARE = read('src/middleware.ts')
const REQUEST_ACCESS = read('src/lib/auth/requestAccess.ts')
const LOGIN_PAGE = read('src/app/(auth)/login/page.tsx')
const CONSOLE = read('src/app/settings/users/UsersAccessClient.tsx')
const USERS_ROUTE = read('src/app/api/admin/users/route.ts')
// Imported as SOURCE, not as a module: `moduleApiGuard.ts` pulls in `next/server`,
// which Node's native test runner cannot resolve.
const API_GUARD = read('src/lib/auth/moduleApiGuard.ts')

// ── fixtures ────────────────────────────────────────────────────────────────

const member = (grants: readonly string[]): ModuleAccessInput => ({
  isApproved: true,
  isAdministrator: false,
  grants,
})
const administrator = (grants: readonly string[] = []): ModuleAccessInput => ({
  isApproved: true,
  isAdministrator: true,
  grants,
})

const USER = { id: 'user-1' }
const verified: IdentityVerifier = async () => ({ user: USER })
const rejected: IdentityVerifier = async () => ({ user: null })

// POST-R13.6CDE.2 — approval, role and grants arrive as ONE state from ONE
// query, so the two former lookups are expressed as two DESCRIPTORS combined by
// `auth()`. Keeping them separate in the test keeps each case readable; the
// combiner reproduces the real failure ordering, where a query that did not
// answer tells us nothing about the profile either.
type ProfileFixture = { username: string | null; role?: string | null } | null
type GrantFixture = { ok: true; grants: string[] } | { ok: false } | 'throws'

const auth = (profile: ProfileFixture, grants: GrantFixture): AuthorizationStateLookup =>
  async () => {
    if (grants === 'throws') throw new Error('relation "user_module_grants" does not exist')
    if (!grants.ok) return { ok: false }
    if (profile === null) return { ok: true, state: null }
    const username = typeof profile.username === 'string' ? profile.username.trim() : ''
    return {
      ok: true,
      state: {
        userId: USER.id,
        approved: username.length > 0,
        role: profile.role ?? null,
        grants: grants.grants,
      },
    }
  }

const approvedMember: ProfileFixture = { username: 'member-1', role: 'member' }
const approvedNoRole: ProfileFixture = { username: 'member-1' }
const approvedAdmin: ProfileFixture = { username: 'admin-1', role: 'administrator' }
const unapproved: ProfileFixture = { username: null, role: 'member' }
const noProfile: ProfileFixture = null

const grantsOf = (...grants: string[]): GrantFixture => ({ ok: true, grants })
const noGrants: GrantFixture = { ok: true, grants: [] }
const storeDown: GrantFixture = { ok: false }
const storeThrows: GrantFixture = 'throws'

const PAGE = '/'
const API = '/api/me/access'

// ════════════════════════════════════════════════════════════════════════════
// A · THE PREDICATE
// ════════════════════════════════════════════════════════════════════════════

describe('canEnterPlatform — the platform-access predicate', () => {
  it('admits an approved administrator holding ZERO grant rows', () => {
    assert.equal(canEnterPlatform(administrator([])), true)
  })

  it('admits an approved member holding exactly one module', () => {
    for (const m of APP_MODULE_KEYS) {
      assert.equal(canEnterPlatform(member([m])), true, `one grant (${m}) must admit`)
    }
  })

  it('admits an approved member holding all seven modules', () => {
    assert.equal(canEnterPlatform(member([...APP_MODULE_KEYS])), true)
  })

  it('REFUSES an approved member holding zero modules', () => {
    assert.equal(canEnterPlatform(member([])), false)
  })

  it('refuses an UNAPPROVED account even when grant rows exist', () => {
    assert.equal(canEnterPlatform({ isApproved: false, isAdministrator: false, grants: [...APP_MODULE_KEYS] }), false)
  })

  it('refuses an UNAPPROVED administrator — approval remains the outer gate', () => {
    assert.equal(canEnterPlatform({ isApproved: false, isAdministrator: true, grants: [] }), false)
  })

  it('counts only modules this build declares, never raw grant rows', () => {
    // A retired key, a registry row from a newer deployment, or a corrupted read
    // must not be what admits an account. Strictly the stricter reading.
    assert.equal(canEnterPlatform(member(['pablo'])), false)
    assert.equal(canEnterPlatform(member(['portfolio_admin'])), false)
    assert.equal(canEnterPlatform(member(['notification_recipients'])), false)
    assert.equal(canEnterPlatform(member(['overview', 'settings', 'news'])), false)
    assert.equal(canEnterPlatform(member(['something_new_in_a_later_release'])), false)
    // …but one real key alongside unknown ones still admits.
    assert.equal(canEnterPlatform(member(['pablo', 'macro'])), true)
  })

  it('refuses malformed grant collections rather than throwing', () => {
    for (const grants of [[], [null], [undefined], [{}], [42], ['']] as unknown[][]) {
      assert.equal(canEnterPlatform(member(grants as string[])), false)
    }
  })

  it('never consults app_modules.default_for_member — defaults are not authorization', () => {
    const src = code(read('src/lib/auth/moduleAccess.ts'))
    const fn = src.slice(src.indexOf('export function canEnterPlatform'))
    assert.ok(!/default_for_member/.test(fn), 'the predicate must not read provisioning defaults')
  })

  it('re-granting one module restores eligibility', () => {
    assert.equal(canEnterPlatform(member(['markets'])), true)
    assert.equal(canEnterPlatform(member([])), false)
    assert.equal(canEnterPlatform(member(['markets'])), true)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// B · THE REQUEST DECISION
// ════════════════════════════════════════════════════════════════════════════

describe('decideRequestAccess — platform boundary', () => {
  it('an approved member with one grant is admitted, page and API alike', async () => {
    assert.deepEqual(await decideRequestAccess(PAGE, verified, auth(approvedMember, grantsOf('markets'))), {
      outcome: 'allow',
      userId: USER.id,
    })
    assert.deepEqual(await decideRequestAccess(API, verified, auth(approvedMember, grantsOf('markets'))), {
      outcome: 'allow',
      userId: USER.id,
    })
  })

  it('an approved member with ZERO grants is refused on a browser route', async () => {
    assert.deepEqual(await decideRequestAccess(PAGE, verified, auth(approvedMember, noGrants)), {
      outcome: 'deny',
      reason: 'no_platform_access',
      status: 403,
      json: false,
    })
  })

  it('an approved member with ZERO grants is refused on an API, as JSON', async () => {
    assert.deepEqual(await decideRequestAccess(API, verified, auth(approvedMember, noGrants)), {
      outcome: 'deny',
      reason: 'no_platform_access',
      status: 403,
      json: true,
    })
  })

  it('a profile with no role at all is treated as a member, not an administrator', async () => {
    const d = await decideRequestAccess(PAGE, verified, auth(approvedNoRole, noGrants))
    assert.equal(d.outcome === 'deny' && d.reason, 'no_platform_access')
  })

  it('an administrator is admitted holding zero grant rows', async () => {
    assert.deepEqual(await decideRequestAccess(PAGE, verified, auth(approvedAdmin, noGrants)), {
      outcome: 'allow',
      userId: USER.id,
    })
  })

  // POST-R13.6CDE.2 INVERTED the two assertions that used to sit here: that an
  // administrator triggered NO grant read, and was therefore admitted even when
  // the grant store was entirely unreadable.
  //
  // Both were artefacts of the two-query design. § 9 of this stage directs that
  // approval, role and grants come from ONE query and that "administrator may
  // receive the joined grant data even though role bypasses it" — so there is no
  // separate read to skip, and a query that fails fails for everyone. The
  // administrator short-circuit still exists and still matters: it is what makes
  // an administrator's decision independent of GRANT CONTENT. It can no longer
  // make it independent of the query SUCCEEDING.
  //
  // That is the stricter reading of § 13's "grant-store failure must still fail
  // closed", and it matches `getModuleAccess.ts`, which already refused to
  // honour an administrator through a failed grant read on the grounds that "if
  // the table is missing, let someone in" is the permissive fallback the design
  // forbids — even narrowed to one role. It also removes an asymmetry the
  // POST-R13.6CDE.1 report flagged as a hazard: an un-migrated deployment used
  // to look healthy to the administrator while every member was locked out. It
  // now fails visibly for the person able to fix it.
  it('an unreadable store refuses an ADMINISTRATOR too — failure is not selective', async () => {
    for (const lookup of [storeDown, storeThrows]) {
      const d = await decideRequestAccess(PAGE, verified, auth(approvedAdmin, lookup))
      assert.equal(d.outcome, 'deny', 'no permissive fallback, not even for a role')
      assert.equal(d.outcome === 'deny' && d.reason, 'access_unavailable')
      assert.equal(d.outcome === 'deny' && d.status, 503)
    }
  })

  it('administrator admission still ignores grant CONTENT entirely', async () => {
    // The property the short-circuit actually protects: whatever the grant rows
    // say — none, unknown keys, another deployment's registry — an approved
    // administrator is admitted by role.
    for (const grants of [noGrants, grantsOf('pablo'), grantsOf('retired_module'), grantsOf('macro')]) {
      assert.equal((await decideRequestAccess(PAGE, verified, auth(approvedAdmin, grants))).outcome, 'allow')
    }
  })

  it('an UNREADABLE grant store refuses with 503, not 403 — a failure is not an answer', async () => {
    for (const lookup of [storeDown, storeThrows]) {
      const page = await decideRequestAccess(PAGE, verified, auth(approvedMember, lookup))
      assert.deepEqual(page, { outcome: 'deny', reason: 'access_unavailable', status: 503, json: false })
      const api = await decideRequestAccess(API, verified, auth(approvedMember, lookup))
      assert.deepEqual(api, { outcome: 'deny', reason: 'access_unavailable', status: 503, json: true })
    }
  })

  it('an unreadable grant store is never treated as an empty grant set', async () => {
    const down = await decideRequestAccess(PAGE, verified, auth(approvedMember, storeDown))
    const empty = await decideRequestAccess(PAGE, verified, auth(approvedMember, noGrants))
    assert.notDeepEqual(down, empty, 'unavailable and denied must be distinguishable')
  })

  it('a missing grant table NEVER falls back to allowing the request', async () => {
    for (const lookup of [storeDown, storeThrows]) {
      const d = await decideRequestAccess(PAGE, verified, auth(approvedMember, lookup))
      assert.equal(d.outcome, 'deny', 'fail-closed is mandatory: no permissive compatibility fallback')
    }
  })

  it('approval is still the outer gate: grants cannot rescue an unapproved account', async () => {
    for (const lookup of [unapproved, noProfile]) {
      const d = await decideRequestAccess(PAGE, verified, auth(lookup, grantsOf(...APP_MODULE_KEYS)))
      assert.equal(d.outcome === 'deny' && d.reason, 'not_approved')
    }
  })

  // POST-R13.6CDE.2 narrowed this. Grants now travel WITH the profile in one
  // query, so "were they fetched" is no longer a meaningful question for an
  // approved-but-unapproved caller — they always are. The half that still
  // matters, and is unchanged, is the UNVERIFIED caller: no identity, no query
  // at all. The half that mattered for an unapproved caller — that grants cannot
  // rescue them — is asserted directly above, against the decision rather than
  // against the fetch.
  it('no authorization query is issued at all for an unverified caller', async () => {
    let consulted = false
    const spy: AuthorizationStateLookup = async (uid) => {
      consulted = true
      return auth(approvedMember, grantsOf('markets'))(uid)
    }
    await decideRequestAccess(PAGE, rejected, spy)
    await decideRequestAccess(API, rejected, spy)
    assert.equal(consulted, false, 'an unauthenticated caller must learn nothing about entitlement')
  })

  it('grants are re-read on EVERY private request: revoking the last one denies the next', async () => {
    let reads = 0
    const counting: AuthorizationStateLookup = async (uid) => {
      reads += 1
      return auth(approvedMember, reads <= 2 ? grantsOf('macro') : noGrants)(uid)
    }
    assert.equal((await decideRequestAccess(API, verified, counting)).outcome, 'allow')
    assert.equal((await decideRequestAccess(API, verified, counting)).outcome, 'allow')
    const third = await decideRequestAccess(API, verified, counting)
    assert.equal(third.outcome === 'deny' && third.reason, 'no_platform_access')
    assert.equal(reads, 3, 'one authorization read per private request — never cached')
  })

  // POST-R13.6CDE.2 INVERTED this. It asserted that an unapproved caller cost no
  // SEPARATE grant round-trip. There is no separate grant round-trip any more —
  // approval and grants come from one query — so the property it protected is
  // now structural. What is still worth asserting, and is stronger, is the count
  // itself: exactly ONE authorization query per private request, whatever the
  // outcome, so neither an unapproved caller nor an entitled one can be made to
  // pay for a second.
  it('costs exactly ONE authorization query per request, whatever the outcome', async () => {
    for (const [profile, grants] of [
      [noProfile, noGrants],
      [unapproved, grantsOf('macro')],
      [approvedMember, noGrants],
      [approvedMember, grantsOf('macro')],
      [approvedAdmin, noGrants],
    ] as [ProfileFixture, GrantFixture][]) {
      let queries = 0
      const counting: AuthorizationStateLookup = async (uid) => {
        queries += 1
        return auth(profile, grants)(uid)
      }
      await decideRequestAccess(API, verified, counting)
      assert.equal(queries, 1, 'one authorization query, never two')
    }
  })

  it('issues NO authorization query at all for an unverified caller', async () => {
    let queries = 0
    const counting: AuthorizationStateLookup = async (uid) => {
      queries += 1
      return auth(approvedAdmin, noGrants)(uid)
    }
    await decideRequestAccess(API, rejected, counting)
    assert.equal(queries, 0, 'an unauthenticated caller must learn nothing about entitlement')
  })

  it('exempt paths are decided without any lookup at all', async () => {
    let touched = false
    const spy: AuthorizationStateLookup = async (uid) => {
      touched = true
      return auth(approvedMember, noGrants)(uid)
    }
    for (const p of ['/login', '/forgot-password', '/auth/callback', '/logout', '/api/auth/login', '/api/cron/x']) {
      assert.deepEqual(await decideRequestAccess(p, verified, spy), { outcome: 'exempt' })
    }
    assert.equal(touched, false)
  })

  it('a zero-grant session is NOT torn down — refusal is not sign-out', async () => {
    const zero = await decideRequestAccess(PAGE, verified, auth(approvedMember, noGrants))
    const down = await decideRequestAccess(PAGE, verified, auth(approvedMember, storeDown))
    assert.equal(shouldClearSession(zero), false)
    assert.equal(shouldClearSession(down), false)
    // The unapproved case is unchanged: that cookie is worthless and is dropped.
    assert.equal(shouldClearSession(await decideRequestAccess(PAGE, verified, auth(unapproved, noGrants))), true)
  })

  it('the decision layer contains no branch that allows on a store failure', () => {
    const src = code(REQUEST_ACCESS)
    const tail = src.slice(src.indexOf('loadAuthorizationState'))
    // Every `allow` after the authorization read must be the entitled path; a
    // store failure must reach a deny. Asserted as: the `!resolved.ok` branch
    // returns a deny, and no `allow` appears between it and the entitlement
    // check. POST-R13.6CDE.2 renamed the binding when the two lookups became
    // one; the property is identical.
    const guard = tail.indexOf('!resolved.ok')
    assert.ok(guard > 0, 'the store-failure branch must exist')
    const branch = tail.slice(guard, tail.indexOf('canEnterPlatform'))
    assert.ok(/outcome: 'deny'/.test(branch), 'a failed authorization read must deny')
    assert.ok(!/outcome: 'allow'/.test(branch), 'a failed authorization read must never allow')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// C · PAGE BEHAVIOUR — §4
// ════════════════════════════════════════════════════════════════════════════

/** Every surface § 4 names, plus the two the revised rule newly covers. */
const GATED_PAGES = [
  '/',                    // Overview
  '/stocks',
  '/compare',
  '/macro',
  '/macro/calendar',
  '/earnings',
  '/portfolio',
  '/portfolio/alternatives',
  '/structured-notes',
  '/watchlist',
  '/chart-builder',
  '/settings',
  '/settings/users',
] as const

describe('zero-grant page behaviour', () => {
  it('every application page is a gated private page', () => {
    for (const p of GATED_PAGES) {
      assert.equal(classifyPath(p), 'private_page', p)
      assert.equal(requiresApprovedSession(p), true, p)
      assert.equal(deniesWithJson(p), false, `${p} must be refused with a redirect, never JSON`)
    }
  })

  it('a zero-grant member is refused EVERY application page, Overview and Settings included', async () => {
    for (const p of GATED_PAGES) {
      const d = await decideRequestAccess(p, verified, auth(approvedMember, noGrants))
      assert.equal(d.outcome, 'deny', p)
      assert.equal(d.outcome === 'deny' && d.reason, 'no_platform_access', p)
      assert.equal(d.outcome === 'deny' && d.json, false, `${p} must redirect, not answer JSON`)
    }
  })

  // POST-R13.6CDE.2 CORRECTED this. It asserted that a member holding `macro`
  // reached EVERY page in the list — which was true, and was exactly the defect
  // this stage was opened to close: one grant admitted the whole application.
  // The property that was actually meant is that holding a module admits the
  // member to the SHELL: Overview, personal Settings, and their own module. The
  // pages belonging to other modules are asserted denied in
  // tests/moduleRequestEnforcement.test.ts.
  it('a member holding one module reaches the shell and their own module', async () => {
    const lookup = auth(approvedMember, grantsOf('macro'))
    for (const p of ['/', '/settings', '/macro', '/macro/calendar']) {
      assert.equal((await decideRequestAccess(p, verified, lookup)).outcome, 'allow', p)
    }
  })

  it('…and is refused the pages of every module it does not hold', async () => {
    const lookup = auth(approvedMember, grantsOf('macro'))
    for (const p of GATED_PAGES) {
      if (['/', '/settings', '/macro', '/macro/calendar'].includes(p)) continue
      const d = await decideRequestAccess(p, verified, lookup)
      assert.equal(d.outcome, 'deny', `${p} must not be reachable on a macro-only grant`)
      assert.equal(d.outcome === 'deny' && d.json, false, `${p} must redirect, not answer JSON`)
    }
  })

  it('an administrator is unaffected on every page', async () => {
    for (const p of GATED_PAGES) {
      assert.equal((await decideRequestAccess(p, verified, auth(approvedAdmin, noGrants))).outcome, 'allow', p)
    }
  })

  it('the boundary is enforced in middleware, so the shell never renders for a refused caller', () => {
    const src = code(MIDDLEWARE)
    assert.ok(/decideRequestAccess\(/.test(src))
    // POST-R13.6CDE.2 — the grant read is EMBEDDED in the profile read rather
    // than issued separately, so the assertion moved to the shared select
    // constant. Both facts are still read by middleware itself, per request.
    assert.ok(/AUTHORIZATION_STATE_SELECT/.test(src), 'middleware must read the authorization state itself')
    assert.match(AUTHORIZATION_STATE_SELECT, /\brole\b/, 'role identifies an administrator')
    assert.match(AUTHORIZATION_STATE_SELECT, /user_module_grants\(module_key\)/, 'grants travel with it')
  })

  it('middleware reads the authorization state through the USER-SESSION client', () => {
    const src = code(MIDDLEWARE)
    assert.ok(!/service_role|SERVICE_ROLE|getSupabaseAdminClient/.test(src))
    // Issued on the same `supabase` client built from the request's own cookies,
    // filtered to the caller's own row. RLS authorises the embedded grant rows
    // independently (`auth.uid() = user_id`), so the join can disclose nothing a
    // separate own-row read could not.
    const read = src.slice(src.indexOf("from('user_profiles')"))
    assert.ok(/eq\('id', userId\)/.test(read), 'the state must be scoped to the caller')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// D · API BEHAVIOUR — §5
// ════════════════════════════════════════════════════════════════════════════

const GATED_APIS = [
  '/api/me/access',
  '/api/admin/users',
  '/api/structured-notes',
  '/api/family-portfolio/scopes',
  '/api/market/stocks',
  '/api/macro',
] as const

describe('zero-grant API behaviour', () => {
  it('a zero-grant member is refused every private API as JSON, never a redirect', async () => {
    for (const p of GATED_APIS) {
      const d = await decideRequestAccess(p, verified, auth(approvedMember, noGrants))
      assert.equal(d.outcome === 'deny' && d.json, true, `${p} must answer JSON`)
      assert.equal(d.outcome === 'deny' && d.status, 403, p)
      assert.equal(d.outcome === 'deny' && d.reason, 'no_platform_access', p)
    }
  })

  it('the denial reason is stable, machine-readable, and distinct from every other', () => {
    assert.equal(ACCESS_DENIED_REASONS.noPlatformAccess, 'no_platform_access')
    const codes = Object.values(ACCESS_DENIED_REASONS)
    assert.equal(new Set(codes).size, codes.length, 'no two reasons may share a code')
    assert.ok(!codes.includes('' as never))
  })

  it('database unavailability is NOT collapsed into an authorization denial', () => {
    assert.notEqual(ACCESS_DENIED_REASONS.accessUnavailable, ACCESS_DENIED_REASONS.noPlatformAccess)
    assert.notEqual(ACCESS_DENIED_REASONS.accessUnavailable, ACCESS_DENIED_REASONS.notApproved)
    // ONE source of truth shared with the route-handler guards, so the middleware
    // and the API layer can never answer the same condition with two codes.
    assert.match(code(API_GUARD), /accessUnavailable: ACCESS_DENIED_REASONS\.accessUnavailable/)
  })

  it('middleware maps every denial reason to a code — no reason can fall through', () => {
    const src = code(MIDDLEWARE)
    const table = src.slice(src.indexOf('REASON_TO_CODE'), src.indexOf('PAGE_ERROR_PARAM'))
    for (const reason of ['unauthenticated', 'not_approved', 'no_platform_access', 'access_unavailable']) {
      assert.ok(new RegExp(`${reason}:`).test(table), `${reason} must have a code`)
    }
    // Typed as a total Record so a future reason cannot be added without one.
    assert.ok(/Record<DenialReason, string>/.test(src))
  })

  it('an API denial is JSON by route class, decided before any reason is known', () => {
    for (const p of GATED_APIS) assert.equal(deniesWithJson(p), true, p)
    for (const p of GATED_PAGES) assert.equal(deniesWithJson(p), false, p)
  })

  it('the middleware never answers a private API with the HTML landing page', () => {
    // The decision carries the route class; the dispatcher must honour it. A
    // zero-grant member calling an API has to receive a refusal it can read,
    // not a login page its `fetch` would parse as success.
    const src = code(MIDDLEWARE)
    const dispatch = src.slice(src.indexOf('function deny('))
    const body = dispatch.slice(0, dispatch.indexOf('\n}'))
    assert.match(body, /decision\.json/, 'the denial style must follow the route class')
    assert.match(body, /apiDenial\(/)
    assert.match(body, /pageDenial\(/)

    const api = src.slice(src.indexOf('function apiDenial'), src.indexOf('function pageDenial'))
    assert.match(api, /NextResponse\.json/)
    assert.ok(!/redirect/.test(api), 'an API denial must never redirect')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// E · LANDING / LOGIN REDIRECT — §3, no loop
// ════════════════════════════════════════════════════════════════════════════

describe('landing redirect semantics', () => {
  it('the redirect destination is itself public, so the denial is terminal', () => {
    // THE LOOP PROOF, part 1: /login is not gated, so the redirect target can
    // never be re-evaluated by the boundary that produced it.
    assert.equal(classifyPath('/login'), 'public_page')
    assert.equal(requiresApprovedSession('/login'), false)
  })

  it('the login gateway never forwards an existing session into the app', () => {
    // THE LOOP PROOF, part 2: nothing navigates on mount. The only navigation is
    // inside the submit handler, after a successful credential POST — so an
    // authenticated zero-grant account that lands here STAYS here.
    const src = code(LOGIN_PAGE)
    const assigns = [...src.matchAll(/window\.location\.assign\(/g)]
    assert.equal(assigns.length, 1, 'exactly one navigation, in the submit handler')
    const before = src.slice(0, assigns[0].index ?? 0)
    assert.ok(/handleSubmit/.test(before), 'the navigation must live in the submit path')
    assert.ok(!/useEffect/.test(src), 'the gateway must not redirect on mount')
    assert.ok(!/redirect\(/.test(src))
  })

  it('a page denial that KEEPS the session carries no ?next — replaying it would re-deny', () => {
    const src = code(MIDDLEWARE)
    assert.ok(/function carriesNext/.test(src))
    const fn = src.slice(src.indexOf('function carriesNext'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    assert.ok(/'unauthenticated'/.test(body))
    assert.ok(/'not_approved'/.test(body))
    assert.ok(!/no_platform_access/.test(body), 'a retained session must not replay the destination')
    assert.ok(!/access_unavailable/.test(body))
    // And the redirect builder honours it.
    assert.ok(/carriesNext\(decision\.reason\)[\s\S]{0,120}buildLoginRedirectPath/.test(src))
  })

  it('each retained-session denial carries an honest ?error the gateway can render', () => {
    const src = code(MIDDLEWARE)
    const table = src.slice(src.indexOf('PAGE_ERROR_PARAM'), src.indexOf('function carriesNext'))
    assert.ok(/not_approved:/.test(table))
    assert.ok(/no_platform_access:/.test(table))
    assert.ok(/access_unavailable:/.test(table))
    assert.ok(!/^\s*unauthenticated:/m.test(table), 'an expired session needs no banner')
  })

  it('the gateway renders a DISTINCT message for each denial, in both languages', () => {
    const src = code(LOGIN_PAGE)
    assert.ok(/case 'no_platform_access'/.test(src))
    assert.ok(/case 'module_access_unavailable'/.test(src))
    assert.ok(/case 'not_authorized'/.test(src))

    for (const lang of [dict.en, dict.es]) {
      const messages = [
        lang.auth.errNotAuthorized,
        lang.auth.errNoPlatformAccess,
        lang.auth.errAccessUnavailable,
      ]
      for (const m of messages) assert.ok(m.trim().length > 0)
      assert.equal(new Set(messages).size, 3, 'the three denials must not read identically')
    }
    // The no-access message must point at the real remedy without naming what
    // exists behind the gate.
    assert.match(dict.en.auth.errNoPlatformAccess, /administrator/i)
    assert.ok(!/structured|portfolio|macro/i.test(dict.en.auth.errNoPlatformAccess))
  })

  it('the account is not signed out to simplify routing', () => {
    const src = code(MIDDLEWARE)
    assert.ok(/shouldClearSession\(decision\)/.test(src), 'cookie clearing stays governed by the shared rule')
    assert.ok(!/signOut/.test(src))
  })
})

// ════════════════════════════════════════════════════════════════════════════
// F · OVERVIEW / SETTINGS REVISED RULE — §6
// ════════════════════════════════════════════════════════════════════════════

describe('Overview and Settings are no longer unconditional', () => {
  it('an approved member with no modules reaches neither', async () => {
    for (const p of ['/', '/settings']) {
      const d = await decideRequestAccess(p, verified, auth(approvedMember, noGrants))
      assert.equal(d.outcome === 'deny' && d.reason, 'no_platform_access', p)
    }
  })

  it('a member holding ONLY structured_notes still reaches Overview and Settings', async () => {
    for (const p of ['/', '/settings', '/structured-notes']) {
      assert.equal((await decideRequestAccess(p, verified, auth(approvedMember, grantsOf('structured_notes')))).outcome, 'allow', p)
    }
  })

  it('the module registry still excludes overview and settings — they are not grantable', () => {
    assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes('overview'))
    assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes('settings'))
    assert.equal(APP_MODULE_KEYS.length, 7)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// G · USERS & ACCESS CONSOLE — §7, §8
// ════════════════════════════════════════════════════════════════════════════

describe('Users & Access — zero-module semantics', () => {
  it('the directory reports platform access from the SAME predicate the gate uses', () => {
    const src = code(USERS_ROUTE)
    assert.ok(/hasPlatformAccess: canEnterPlatform\(access\)/.test(src))
    assert.ok(!/hasPlatformAccess:\s*modules\.length/.test(src), 'never re-derived from a length')
  })

  it('the console labels a zero-grant member "No platform access", not "No modules"', () => {
    const src = code(CONSOLE)
    assert.ok(/!u\.hasPlatformAccess/.test(src), 'the row must branch on the server-computed fact')
    assert.ok(/t\.usersAccess\.noPlatformAccess/.test(src))
    for (const lang of [dict.en, dict.es]) {
      assert.notEqual(lang.usersAccess.noPlatformAccess, lang.usersAccess.noModules)
      assert.ok(lang.usersAccess.noPlatformAccessNote.trim().length > 0)
    }
  })

  it('account status no longer reads as usable access on its own', () => {
    // § 8: "Approved" describes the ACCOUNT; the Access column describes reach.
    assert.equal(dict.en.usersAccess.statusActive, 'Approved')
    assert.ok(dict.es.usersAccess.statusActive.trim().length > 0)
    assert.notEqual(dict.es.usersAccess.statusActive, dict.en.usersAccess.statusActive)
  })

  it('clearing every switch warns BEFORE the save, while the switches are clear', () => {
    const src = code(CONSOLE)
    assert.ok(/shown\.length === 0/.test(src))
    assert.ok(/t\.usersAccess\.noPlatformAccessNote/.test(src))
  })

  it('a save that removes the last module is confirmed in the app\'s OWN dialog', () => {
    const src = code(CONSOLE)
    assert.ok(!/window\.confirm/.test(src), 'never the browser-native confirm')
    assert.ok(/<ModalShell/.test(src))
    assert.ok(/role="alertdialog"/.test(src))
    assert.ok(/t\.usersAccess\.revokeAllTitle/.test(src))
    assert.ok(/t\.usersAccess\.revokeAllBody/.test(src))
    // The Save button routes through the guard, never straight to the mutation.
    assert.ok(/onClick=\{requestSave\}/.test(src))
    const guard = src.slice(src.indexOf('function requestSave'))
    assert.ok(/shown\.length === 0[\s\S]{0,80}setConfirmRevoke\(true\)/.test(guard))
  })

  it('the confirmation says what is lost, in both languages', () => {
    for (const lang of [dict.en, dict.es]) {
      const body = lang.usersAccess.revokeAllBody
      assert.ok(body.trim().length > 0)
      assert.ok(lang.usersAccess.revokeAllTitle.trim().length > 0)
      assert.ok(lang.usersAccess.revokeAllConfirm.trim().length > 0)
      assert.ok(lang.usersAccess.cancel.trim().length > 0)
    }
    assert.match(dict.en.usersAccess.revokeAllBody, /Overview and Settings/i)
    // It must not imply the ACCOUNT is deleted — this is revocation by grants.
    assert.match(dict.en.usersAccess.revokeAllBody, /not deleted/i)
  })

  it('no lifecycle state is invented to express this', () => {
    const src = code(read('src/lib/admin/userDirectory.ts'))
    const list = src.slice(src.indexOf('ACCOUNT_STATUSES'), src.indexOf('export type AccountStatus'))
    assert.ok(!/disabled/.test(list), 'a Disabled state the schema cannot express must not be fabricated')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// H · PORTFOLIO CEILING NON-REGRESSION — §11 overlay
// ════════════════════════════════════════════════════════════════════════════

describe('the portfolio ceiling is untouched by the platform boundary', () => {
  it('a Jaime member with zero modules gains no scope at all — and never a sibling', () => {
    const access = member([])
    const visible = portfolioVisibleScopes(
      { isApproved: true, isAdministrator: false, principal: 'jaime' },
      access,
    )
    // Sibling checks first: `assert.deepEqual` carries an `asserts` signature,
    // so running it earlier would narrow `visible` to never[] and make the two
    // assertions below vacuous at the type level.
    assert.ok(!visible.includes('andres'))
    assert.ok(!visible.includes('pablo'))
    assert.deepEqual(visible, [])
  })

  it('no grant subset ever reaches outside the principal ceiling', () => {
    for (const principal of ['jaime', 'andres', 'pablo'] as const) {
      const ceiling = scopesFor({ isApproved: true, isAdministrator: false, principal })
      for (let mask = 0; mask < 1 << APP_MODULE_KEYS.length; mask++) {
        const grants = APP_MODULE_KEYS.filter((_, i) => mask & (1 << i))
        const visible = portfolioVisibleScopes(
          { isApproved: true, isAdministrator: false, principal },
          member(grants),
        )
        for (const s of visible) {
          assert.ok(ceiling.includes(s), `${principal} + [${grants}] escaped the ceiling with ${s}`)
        }
      }
    }
  })

  it('administrator bypass is unchanged: full family access, no grant rows needed', () => {
    const ceiling = scopesFor({ isApproved: true, isAdministrator: true, principal: null })
    const visible = portfolioVisibleScopes(
      { isApproved: true, isAdministrator: true, principal: null },
      administrator([]),
    )
    assert.deepEqual(visible, ceiling)
    assert.ok(visible.includes('jaime') && visible.includes('andres') && visible.includes('pablo'))
  })
})
