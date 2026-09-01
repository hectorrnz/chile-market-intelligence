// R1.5 — Private-access enforcement and admin-controlled user provisioning.
//
// WHAT IS BEHAVIOURAL HERE. The access decision itself lives in pure modules
// (`accessPolicy.ts`, `safeRedirect.ts`, `approval.ts`) and every test against
// them below calls the real function and asserts the real return value — no
// source scanning. The route matrices are built by WALKING src/app, so a route
// added in a later phase is covered automatically: a new private page or
// endpoint that the policy fails to protect fails this suite.
//
// WHAT IS STRUCTURAL, AND WHY. `middleware.ts` is the thin adapter that turns
// that decision into HTTP. It cannot be imported here: this project's runner is
// `node --test "tests/*.test.ts"`, and Node's ESM resolver cannot resolve the
// bare `next/server` specifier that middleware (and NextRequest) require. So the
// adapter is verified structurally — that it consults `requiresApprovedSession`,
// builds `next` with `buildLoginRedirectPath`, answers the documented status
// codes, stamps `no-store`, and fails closed with no credentials. The HTTP
// behaviour itself was exercised directly during development under `tsx`
// (/portfolio → 307 Location /login?next=%2Fportfolio, /api/market/stocks → 401
// {"error":"unauthenticated"}, /login → 200) and belongs in the manual
// verification list, not in a claim made by this file.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  classifyPath,
  requiresApprovedSession,
  deniesWithJson,
  isApiPath,
  isFrameworkPath,
  PUBLIC_PAGE_PATHS,
  PUBLIC_API_PATHS,
  SESSION_MINT_PATHS,
  BEARER_AUTH_API_PREFIXES,
} from '../src/lib/auth/accessPolicy.ts'
import { toSafeInternalPath, buildLoginRedirectPath, SAFE_FALLBACK_PATH } from '../src/lib/auth/safeRedirect.ts'
import { isApprovedProfile, ACCESS_DENIED_REASONS } from '../src/lib/auth/approval.ts'
import {
  decideRequestAccess,
  shouldClearSession,
  type IdentityVerifier,
} from '../src/lib/auth/requestAccess.ts'
import {
  AUTHORIZATION_STATE_SELECT,
  type AuthorizationStateLookup,
} from '../src/lib/auth/authorizationState.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * Removes comments before a source scan — the established convention in this
 * repo's suites (see tests/fableAuthShell.test.ts). Without it, a file's own
 * explanation of what it no longer does ("the POST to /api/auth/register is
 * gone") reads as the thing still being present.
 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const readCode = (p: string) => strip(read(p))

// ── Route discovery ──────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** `src/app/macro/calendar/page.tsx` → `/macro/calendar`; route groups stripped. */
function fileToRoutePath(absFile: string): string | null {
  const rel = relative(join(ROOT, 'src/app'), absFile).split(sep).join('/')
  if (!/(^|\/)(page|route)\.tsx?$/.test(rel)) return null
  const base = rel.replace(/(^|\/)(page|route)\.tsx?$/, '')
  const segments = base
    .split('/')
    .filter((s) => s.length > 0 && !(s.startsWith('(') && s.endsWith(')')))
  // Substitute a concrete value for each dynamic segment so the path is real.
  const concrete = segments.map((s) =>
    s.startsWith('[') ? (s.includes('ticker') ? 'SQM-B' : 'test-id') : s,
  )
  return `/${concrete.join('/')}`
}

const ROUTE_FILES = walk(join(ROOT, 'src/app')).filter((f) => /[/\\](page|route)\.tsx?$/.test(f))
const ALL_ROUTES = [...new Set(ROUTE_FILES.map(fileToRoutePath).filter((p): p is string => p !== null))].sort()
const PAGE_ROUTES = [...new Set(
  ROUTE_FILES.filter((f) => /page\.tsx$/.test(f)).map(fileToRoutePath).filter((p): p is string => p !== null),
)].sort()
const API_ROUTES = ALL_ROUTES.filter((p) => isApiPath(p))

describe('R1.5 preconditions', () => {
  test('route discovery found the real application surface', () => {
    // Sanity floor: if the walk breaks, every matrix below would vacuously pass.
    assert.ok(PAGE_ROUTES.length >= 15, `expected ≥15 page routes, found ${PAGE_ROUTES.length}`)
    assert.ok(API_ROUTES.length >= 50, `expected ≥50 api routes, found ${API_ROUTES.length}`)
    for (const expected of ['/', '/stocks', '/portfolio', '/login', '/companies/SQM-B', '/structured-notes/test-id']) {
      assert.ok(PAGE_ROUTES.includes(expected), `missing discovered page route ${expected}`)
    }
  })
})

// ── A · Browser-route matrix (behavioural over the real policy) ──────────────

describe('A · browser-route matrix', () => {
  const PUBLIC = new Set<string>([...PUBLIC_PAGE_PATHS])

  for (const route of PAGE_ROUTES) {
    if (PUBLIC.has(route)) continue

    test(`private page ${route} requires a session and denies by redirect`, () => {
      assert.equal(classifyPath(route), 'private_page')
      assert.ok(requiresApprovedSession(route), `${route} must require an approved session`)
      assert.ok(!deniesWithJson(route), `${route} must redirect, not return JSON`)
    })

    test(`private page ${route} produces a safe /login?next destination`, () => {
      const target = buildLoginRedirectPath(route)
      assert.ok(target.startsWith('/login'), `${route} must send the user to /login`)
      if (route === '/') {
        // `/` collapses to the fallback, so no redundant ?next is attached.
        assert.equal(target, '/login')
      } else {
        assert.equal(target, `/login?next=${encodeURIComponent(route)}`)
        const next = new URLSearchParams(target.split('?')[1]).get('next')
        assert.equal(toSafeInternalPath(next), route, 'the attached next must round-trip as safe')
      }
    })
  }

  for (const route of PUBLIC_PAGE_PATHS) {
    test(`public auth page ${route} is reachable with no session and cannot loop`, () => {
      assert.equal(classifyPath(route), 'public_page')
      assert.ok(!requiresApprovedSession(route), `${route} must never be gated (login loop)`)
    })
  }

  test('a private page preserves its safe query string in next', () => {
    assert.equal(buildLoginRedirectPath('/macro?region=cl'), '/login?next=%2Fmacro%3Fregion%3Dcl')
  })

  test('a hostile original URL cannot be reflected into the login page', () => {
    for (const hostile of ['//evil.example', '/\\evil.example', 'https://evil.example', '/%2F%2Fevil.example']) {
      assert.equal(buildLoginRedirectPath(hostile), '/login', `${hostile} must not survive into ?next`)
    }
  })

  test('an attacker-chosen path with a dot is still gated, not mistaken for a static asset', () => {
    // Regression: a broad "any dot means static" heuristic exempted these.
    for (const p of ['/%5C%5Cevil.example', '/some.route', '/companies/SQM.B']) {
      assert.ok(!isFrameworkPath(p), `${p} must not be treated as a static asset`)
      assert.ok(requiresApprovedSession(p), `${p} must be gated`)
    }
  })
})

// ── B · API-route matrix (behavioural over the real policy) ──────────────────

describe('B · API-route matrix', () => {
  const PUBLIC_API = new Set<string>([...PUBLIC_API_PATHS])
  const isBearer = (p: string) => BEARER_AUTH_API_PREFIXES.some((b) => p === b || p.startsWith(`${b}/`))

  for (const route of API_ROUTES) {
    if (PUBLIC_API.has(route) || isBearer(route)) continue

    test(`private endpoint ${route} requires a session and denies with JSON`, () => {
      assert.equal(classifyPath(route), 'private_api')
      assert.ok(requiresApprovedSession(route), `${route} must require an approved session`)
      assert.ok(deniesWithJson(route), `${route} must answer JSON 401, never an HTML redirect`)
    })
  }

  test('the formerly world-readable data families are now private', () => {
    // These carried the whole market/macro/financials surface before R1.5.
    for (const route of [
      '/api/market/stocks', '/api/market/live-snapshot', '/api/macro', '/api/macro/yield-curve',
      '/api/earnings', '/api/earnings/results', '/api/financials/coverage', '/api/valuation/SQM-B',
      '/api/compare', '/api/news', '/api/health/ingestion',
    ]) {
      assert.equal(classifyPath(route), 'private_api', `${route} must no longer be public`)
    }
  })

  for (const route of PUBLIC_API_PATHS) {
    test(`public auth endpoint ${route} is not session-gated`, () => {
      assert.equal(classifyPath(route), 'public_api')
      assert.ok(!requiresApprovedSession(route))
    })
  }

  test('bearer-authenticated cron endpoints are exempt from the session gate but not public', () => {
    for (const prefix of BEARER_AUTH_API_PREFIXES) {
      assert.equal(classifyPath(`${prefix}/ingest-bcch-macro`), 'bearer_auth_api')
      assert.ok(!requiresApprovedSession(`${prefix}/ingest-bcch-macro`))
    }
    const cronFiles = ROUTE_FILES.filter((f) => f.split(sep).join('/').includes('/api/cron/'))
    assert.ok(cronFiles.length >= 9, `expected ≥9 cron handlers, found ${cronFiles.length}`)
    for (const file of cronFiles) {
      const src = readFileSync(file, 'utf8')
      assert.match(src, /CRON_SECRET|MARKET_INGEST_SECRET/, `${file} must read a bearer secret`)
      assert.match(src, /401/, `${file} must fail closed`)
    }
  })

  test('no route handler trusts a client-supplied user identifier', () => {
    for (const file of ROUTE_FILES.filter((f) => f.split(sep).join('/').includes('/api/'))) {
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(
        src,
        /headers\(\)\.get\(['"]x-user-id|headers\.get\(['"]x-user-id|body\.user_?[Ii]d/,
        `${file} must not accept a client-supplied user identity`,
      )
    }
  })

  test('user-scoped handlers authorise through the session client, never the admin client', () => {
    const userScoped = ROUTE_FILES.filter((f) => {
      const p = f.split(sep).join('/')
      return /\/api\/(watchlists|portfolios|structured-notes|notifications|notification-recipients)\//.test(p)
        || /\/api\/(watchlists|portfolios|structured-notes|notifications|notification-recipients)\/route\.ts$/.test(p)
    })
    assert.ok(userScoped.length >= 15, `expected ≥15 user-scoped handlers, found ${userScoped.length}`)
    for (const file of userScoped) {
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(src, /getSupabaseAdminClient/, `${file} must not bypass RLS`)
    }
  })
})

// ── Policy invariants ────────────────────────────────────────────────────────

describe('access policy is default-deny and has one authoritative allowlist', () => {
  test('an unknown future route is private, for both pages and APIs', () => {
    assert.equal(classifyPath('/some-route-added-in-r7'), 'private_page')
    assert.equal(classifyPath('/api/some-endpoint-added-in-r7'), 'private_api')
    assert.ok(requiresApprovedSession('/some-route-added-in-r7'))
    assert.ok(requiresApprovedSession('/api/some-endpoint-added-in-r7'))
  })

  test('allowlists are exactly the documented minimum', () => {
    assert.deepEqual([...PUBLIC_PAGE_PATHS], ['/login', '/forgot-password', '/auth/reset-password'])
    assert.deepEqual([...PUBLIC_API_PATHS], ['/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password'])
    assert.deepEqual([...SESSION_MINT_PATHS], ['/auth/callback', '/logout'])
    assert.ok(!(PUBLIC_API_PATHS as readonly string[]).includes('/api/auth/register'))
  })

  test('prefix matching is segment-aware — a sibling path cannot borrow public status', () => {
    assert.equal(classifyPath('/login'), 'public_page')
    assert.equal(classifyPath('/login/help'), 'public_page')
    assert.equal(classifyPath('/loginfoo'), 'private_page', 'must not match on a bare prefix')
    assert.equal(classifyPath('/api/auth/login-bypass'), 'private_api')
    assert.equal(classifyPath('/api/auth/loginx/steal'), 'private_api')
  })

  test('framework and static paths are never gated', () => {
    for (const p of ['/_next/static/chunk.js', '/favicon.ico', '/robots.txt', '/login-santiago.webp', '/nevada-logo.svg']) {
      assert.ok(isFrameworkPath(p), `${p} must be treated as framework/static`)
      assert.ok(!requiresApprovedSession(p))
    }
  })

  test('the policy module is pure, so it can be audited and reused without a framework', () => {
    const src = read('src/lib/auth/accessPolicy.ts')
    assert.doesNotMatch(src, /from 'next\/|@supabase|process\.env/)
  })
})

// ── Verified session + per-request approval (BEHAVIOURAL) ────────────────────
//
// `decideRequestAccess` is the real decision the middleware executes, with the
// identity verifier and approval lookup injected. Every case below calls it and
// asserts the real returned decision — no source scanning.

describe('verified identity and per-request approval', () => {
  const APPROVED_USER = { id: 'user-1' }

  /** An identity provider that VERIFIED the token. */
  const verified: IdentityVerifier = async () => ({ user: APPROVED_USER })
  /** Anything the Auth server rejects: forged, malformed, expired, banned, deleted. */
  const rejected: IdentityVerifier = async () => ({ user: null })
  /** A verifier that throws (network/provider failure) must fail closed. */
  const throwing: IdentityVerifier = async () => { throw new Error('auth provider unreachable') }

  // POST-R13.6CDE.2 — approval, role and grants now arrive as ONE state from ONE
  // query, so these fixtures replace the former separate approval/grant lookups.
  //
  // The identity and approval cases below supply an ADMINISTRATOR. Approval is
  // the only variable they are about, and an administrator satisfies every
  // MAPPED binding by role — so a module denial can never be mistaken for the
  // approval denial under test. Module entitlement itself is exercised
  // exhaustively in tests/platformAccessBoundary.test.ts and
  // tests/moduleRequestEnforcement.test.ts.
  const approved: AuthorizationStateLookup = async () => ({
    ok: true,
    state: { userId: 'user-1', approved: true, role: 'administrator', grants: [] },
  })
  const noProfile: AuthorizationStateLookup = async () => ({ ok: true, state: null })
  const revoked: AuthorizationStateLookup = async () => ({
    ok: true,
    state: { userId: 'user-1', approved: false, role: 'administrator', grants: [] },
  })

  const PAGE = '/portfolio'
  const API = '/api/market/stocks'
  // POST-R13.5 — `/api/portfolios` no longer routes anywhere: it was the retired
  // positions tracker's data layer. It is kept as a fixture deliberately,
  // because the property it proves is that the policy is DEFAULT-DENY and
  // path-agnostic — an API path with no handler at all must still fail closed,
  // never fall through to a 404 that leaks the route's absence.
  const NO_HANDLER_API = '/api/portfolios'

  // 1 · fake or malformed session cookie cannot pass a private browser route
  test('a forged or malformed session cookie is denied on a private browser route', async () => {
    const d = await decideRequestAccess(PAGE, rejected, approved)
    assert.deepEqual(d, { outcome: 'deny', reason: 'unauthenticated', status: 401, json: false })
  })

  // 2 · fake or malformed session cookie cannot pass a private API
  test('a forged or malformed session cookie is denied on a private API', async () => {
    const d = await decideRequestAccess(API, rejected, approved)
    assert.deepEqual(d, { outcome: 'deny', reason: 'unauthenticated', status: 401, json: true })
  })

  // 3 · expired session is denied
  test('an expired token is denied (the verifier, not a local decode, decides)', async () => {
    // An expired JWT still parses; only server-side verification rejects it.
    const expired: IdentityVerifier = async () => ({ user: null })
    assert.equal((await decideRequestAccess(PAGE, expired, approved)).outcome, 'deny')
    assert.equal((await decideRequestAccess(API, expired, approved)).outcome, 'deny')
  })

  // 10 · deleted or banned Auth user is denied
  test('a banned or deleted Auth user is denied as unauthenticated', async () => {
    const banned: IdentityVerifier = async () => ({ user: null })
    const d = await decideRequestAccess(API, banned, approved)
    assert.equal(d.outcome, 'deny')
    assert.equal(d.outcome === 'deny' && d.reason, 'unauthenticated')
    assert.equal(d.outcome === 'deny' && d.status, 401)
  })

  test('a verifier that throws fails closed rather than admitting the request', async () => {
    const d = await decideRequestAccess(API, throwing, approved)
    assert.deepEqual(d, { outcome: 'deny', reason: 'unauthenticated', status: 401, json: true })
  })

  // 4 · valid Auth user without profile approval → browser denial
  test('a verified user with no approval record is denied on a browser route (403)', async () => {
    const d = await decideRequestAccess(PAGE, verified, noProfile)
    assert.deepEqual(d, { outcome: 'deny', reason: 'not_approved', status: 403, json: false })
  })

  // 5 · valid Auth user without profile approval → API 403
  test('a verified user with no approval record receives API 403, not 401', async () => {
    const d = await decideRequestAccess(API, verified, noProfile)
    assert.deepEqual(d, { outcome: 'deny', reason: 'not_approved', status: 403, json: true })
  })

  // 6 · approved user is permitted
  test('a verified, currently-approved user is permitted', async () => {
    const d = await decideRequestAccess(PAGE, verified, approved)
    assert.deepEqual(d, { outcome: 'allow', userId: 'user-1' })
    assert.deepEqual(await decideRequestAccess(API, verified, approved), { outcome: 'allow', userId: 'user-1' })
  })

  // 7, 8, 9 · revocation takes effect on the NEXT request, with no expiry wait
  test('revoking approval denies the very next browser and API request', async () => {
    // The identity is unchanged and still verifies — the token has NOT expired.
    // Only the approval marker changed, and that alone must flip the decision.
    assert.deepEqual(await decideRequestAccess(PAGE, verified, approved), { outcome: 'allow', userId: 'user-1' })

    const nextPage = await decideRequestAccess(PAGE, verified, revoked)
    assert.deepEqual(nextPage, { outcome: 'deny', reason: 'not_approved', status: 403, json: false })

    const nextApi = await decideRequestAccess(API, verified, revoked)
    assert.deepEqual(nextApi, { outcome: 'deny', reason: 'not_approved', status: 403, json: true })
  })

  test('the approval record is re-read on EVERY private request, not cached', async () => {
    let reads = 0
    const counting: AuthorizationStateLookup = async () => {
      reads += 1
      return {
        ok: true,
        state: { userId: 'user-1', approved: reads <= 2, role: 'administrator', grants: [] },
      }
    }
    assert.equal((await decideRequestAccess(API, verified, counting)).outcome, 'allow')
    assert.equal((await decideRequestAccess(API, verified, counting)).outcome, 'allow')
    // Third request: the marker is gone. No sign-out, no token refresh, no wait.
    assert.equal((await decideRequestAccess(API, verified, counting)).outcome, 'deny')
    assert.equal(reads, 3, 'exactly one authorization read per private request')
  })

  test('a deleted approval row is as denying as a cleared username', async () => {
    const blankUsername: AuthorizationStateLookup = async () => ({
      ok: true,
      state: { userId: 'user-1', approved: false, role: null, grants: ['markets'] },
    })
    for (const lookup of [noProfile, revoked, blankUsername]) {
      const d = await decideRequestAccess(API, verified, lookup)
      assert.equal(d.outcome === 'deny' && d.status, 403)
    }
  })

  test('approval is never consulted for an unverified caller', async () => {
    let consulted = false
    const spy: AuthorizationStateLookup = async () => {
      consulted = true
      return { ok: true, state: null }
    }
    await decideRequestAccess(API, rejected, spy)
    assert.equal(consulted, false, 'an unauthenticated caller must learn nothing about approval')
  })

  // POST-R13.6CDE.2 INVERTED this. A lookup that throws used to be reported as
  // `not_approved` (403) because approval was all it read. It now reads the
  // ENTITLEMENT STORE too, and a store that did not answer has told us nothing:
  // calling that "not approved" blames a correctly-provisioned account for the
  // deployment's schema version, which is the exact confusion POST-R13.6CDE was
  // opened to fix. The property that matters — it FAILS CLOSED — is unchanged
  // and is asserted more strongly here than before: denied, never allowed, in
  // both the throwing and the honest-failure shapes.
  test('a failing authorization lookup fails closed as an availability failure', async () => {
    const throwingLookup: AuthorizationStateLookup = async () => {
      throw new Error('db unreachable')
    }
    const reportedFailure: AuthorizationStateLookup = async () => ({ ok: false })
    for (const lookup of [throwingLookup, reportedFailure]) {
      const d = await decideRequestAccess(API, verified, lookup)
      assert.equal(d.outcome, 'deny')
      assert.equal(d.outcome === 'deny' && d.reason, 'access_unavailable')
      assert.equal(d.outcome === 'deny' && d.status, 503)
    }
  })

  test('an API path with no handler at all still fails closed', async () => {
    // Default-deny is path-agnostic: a non-existent private API must never fall
    // through to a 404 that reveals the route's absence, and must never allow.
    assert.deepEqual(
      await decideRequestAccess(NO_HANDLER_API, rejected, approved),
      { outcome: 'deny', reason: 'unauthenticated', status: 401, json: true },
    )
    const d = await decideRequestAccess(NO_HANDLER_API, verified, approved)
    assert.equal(d.outcome, 'deny', 'an undeclared private API is unreachable, administrators included')
    assert.equal(d.outcome === 'deny' && d.json, true, 'and it denies as JSON, never a redirect')
  })

  // 14 · public auth routes remain reachable; exempt classes are never gated
  test('public, session-mint, bearer and framework paths are exempt without any lookup', async () => {
    let touched = false
    const spy: IdentityVerifier = async () => { touched = true; return { user: null } }
    for (const p of [
      '/login', '/forgot-password', '/auth/reset-password',
      '/auth/callback', '/logout',
      '/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password',
      '/api/cron/ingest-bcch-macro',
      '/_next/static/chunk.js', '/nevada-logo.svg',
    ]) {
      assert.deepEqual(await decideRequestAccess(p, spy, noProfile), { outcome: 'exempt' }, p)
    }
    assert.equal(touched, false, 'exempt paths must not cost an identity round-trip')
  })

  test('an unapproved denial clears the stale session cookie; a plain 401 does not', () => {
    assert.ok(shouldClearSession({ outcome: 'deny', reason: 'not_approved', status: 403, json: false }))
    assert.ok(!shouldClearSession({ outcome: 'deny', reason: 'unauthenticated', status: 401, json: false }))
    assert.ok(!shouldClearSession({ outcome: 'allow', userId: 'user-1' }))
  })

  // 11 · every discovered private API maps to verified auth + approval
  test('EVERY discovered private API endpoint is enforced by the same decision', async () => {
    const privateApis = API_ROUTES.filter((r) => classifyPath(r) === 'private_api')
    assert.ok(privateApis.length >= 45, `expected ≥45 private endpoints, found ${privateApis.length}`)
    for (const route of privateApis) {
      assert.deepEqual(
        await decideRequestAccess(route, rejected, approved),
        { outcome: 'deny', reason: 'unauthenticated', status: 401, json: true },
        `${route} unverified`,
      )
      assert.deepEqual(
        await decideRequestAccess(route, verified, revoked),
        { outcome: 'deny', reason: 'not_approved', status: 403, json: true },
        `${route} revoked`,
      )
      assert.equal((await decideRequestAccess(route, verified, approved)).outcome, 'allow', `${route} approved`)
    }
  })

  // 12 · every discovered private browser route maps to the same decision
  test('EVERY discovered private browser route is enforced by the same decision', async () => {
    const privatePages = PAGE_ROUTES.filter((r) => classifyPath(r) === 'private_page')
    assert.ok(privatePages.length >= 12, `expected ≥12 private pages, found ${privatePages.length}`)
    for (const route of privatePages) {
      assert.deepEqual(
        await decideRequestAccess(route, rejected, approved),
        { outcome: 'deny', reason: 'unauthenticated', status: 401, json: false },
        `${route} unverified`,
      )
      assert.deepEqual(
        await decideRequestAccess(route, verified, noProfile),
        { outcome: 'deny', reason: 'not_approved', status: 403, json: false },
        `${route} unapproved`,
      )
      assert.equal((await decideRequestAccess(route, verified, approved)).outcome, 'allow', `${route} approved`)
    }
  })

  test('the decision module is pure and framework-free', () => {
    const src = read('src/lib/auth/requestAccess.ts')
    assert.doesNotMatch(src, /from 'next\/|@supabase|process\.env/)
    // No local token decoding — verification is delegated, never re-implemented.
    assert.doesNotMatch(src, /atob|jwtDecode|JSON\.parse\(.*payload/i)
  })
})

// ── Middleware contract (structural — see the header note) ───────────────────

describe('middleware wires the policy to the documented HTTP contract', () => {
  const MW = read('src/middleware.ts')
  const MW_CODE = readCode('src/middleware.ts')

  test('it consults the shared policy rather than its own list', () => {
    assert.match(MW, /requiresApprovedSession/)
    assert.match(MW, /deniesWithJson/)
    assert.doesNotMatch(MW_CODE, /const PROTECTED_(PAGES|API)/, 'the old denylist must be gone')
  })

  test('it builds next with the shared validator', () => {
    assert.match(MW, /buildLoginRedirectPath\(`\$\{pathname\}\$\{search\}`\)/)
    assert.doesNotMatch(MW_CODE, /next\.startsWith\('\/'\)/)
  })

  test('it delegates the decision to the tested function, not its own logic', () => {
    assert.match(MW, /decideRequestAccess\(/)
    assert.match(MW, /if \(decision\.outcome === 'deny'\) return deny\(request, decision\)/)
  })

  test('the identity verifier is the Auth server, never a cookie read or local decode', () => {
    assert.match(MW, /supabase\.auth\.getUser\(\)/)
    assert.doesNotMatch(MW_CODE, /auth\.getSession\(\)/, 'getSession() must not gate a private request')
    assert.doesNotMatch(MW_CODE, /atob|jwtDecode/, 'never decode a token locally')
    assert.doesNotMatch(MW_CODE, /user_metadata/, 'metadata is user-writable, never an approval source')
  })

  test('the authorization lookup re-reads user_profiles per request under own-row RLS', () => {
    assert.match(MW, /from\('user_profiles'\)/)
    assert.match(MW, /\.eq\('id', userId\)/)
    // POST-R13.6CDE.2 — approval, role and grants now arrive in ONE embedded
    // read, so the assertion covers both halves of that select. Still expressed
    // as the PROPERTY rather than a frozen literal: a NARROW explicit column
    // list carrying the approval marker, never `select('*')`.
    const select = MW.match(/from\('user_profiles'\)\s*\.select\(([^)]*)\)/)
    assert.ok(select, 'the authorization read must use an explicit column list')
    assert.match(select[1], /AUTHORIZATION_STATE_SELECT/,
      'the column list must come from the shared constant, not a second copy')
    const columns = AUTHORIZATION_STATE_SELECT
      .replace(/user_module_grants\([^)]*\)/, 'user_module_grants')
      .split(',')
      .map((c) => c.trim())
    assert.ok(columns.includes('username'), 'the approval marker must be read')
    assert.ok(!columns.includes('*'), 'never select *')
    assert.ok(columns.every((c) => ['id', 'username', 'role', 'user_module_grants'].includes(c)),
      `the middleware read must stay narrow, found: ${columns.join(', ')}`)
    assert.doesNotMatch(MW_CODE, /getSupabaseAdminClient|SERVICE_ROLE/, 'must not bypass RLS')
  })

  // POST-R13.6CDE.2 — the grants are EMBEDDED in that one read rather than
  // fetched separately, and are held to the same standard: own-row, user-session
  // client, explicit column, per request. RLS authorises the embedded rows
  // independently (`auth.uid() = user_id`), so the join can disclose nothing the
  // separate read could not.
  test('the module grants are embedded in that one read, never a second query', () => {
    assert.match(AUTHORIZATION_STATE_SELECT, /user_module_grants\(module_key\)/)
    assert.doesNotMatch(MW_CODE, /from\('user_module_grants'\)/,
      'a separate grant query would reintroduce the third round-trip')
    assert.doesNotMatch(MW_CODE, /getSupabaseAdminClient|SERVICE_ROLE/, 'must not bypass RLS')
  })

  test('a private API denial is JSON with the reason constant, its status, and no payload', () => {
    const fn = MW.slice(MW.indexOf('function apiDenial'), MW.indexOf('function pageDenial'))
    assert.match(fn, /NextResponse\.json/)
    assert.match(fn, /REASON_TO_CODE\[decision\.reason\]/)
    assert.match(fn, /status: decision\.status/)
    assert.match(fn, /'Cache-Control': NO_STORE/)
    assert.match(MW, /unauthenticated: ACCESS_DENIED_REASONS\.unauthenticated/)
    assert.match(MW, /not_approved: ACCESS_DENIED_REASONS\.notApproved/)
  })

  test('a private page denial redirects, flags an unapproved identity, and drops its cookies', () => {
    const fn = MW.slice(MW.indexOf('function pageDenial'), MW.indexOf('function deny('))
    assert.match(fn, /NextResponse\.redirect/)
    assert.match(fn, /Cache-Control', NO_STORE/)
    // POST-R13.6CDE.1 — the `?error` value is table-driven now that four reasons
    // exist. The property is unchanged: an unapproved identity is still flagged.
    assert.match(fn, /target\.searchParams\.set\('error', errorParam\)/)
    assert.match(MW, /not_approved: 'not_authorized'/)
    assert.match(fn, /shouldClearSession\(decision\)/)
    assert.match(fn, /response\.cookies\.delete\(cookie\.name\)/)
    assert.match(MW, /SESSION_COOKIE_PREFIX = 'sb-'/)
  })

  test('one function decides the denial style for every branch', () => {
    assert.match(MW, /function deny\(\s*request: NextRequest,\s*decision: Extract<AccessDecision, \{ outcome: 'deny' \}>,\s*\)/)
    assert.match(MW, /decision\.json \? apiDenial\(decision\) : pageDenial\(request, decision\)/)
  })

  test('it documents the latency the verified gate costs', () => {
    assert.match(MW, /LATENCY/)
    assert.match(MW, /exactly TWO sequential Supabase round-trips/)
  })

  test('it fails CLOSED when Supabase is unconfigured', () => {
    const branch = MW.slice(MW.indexOf('if (!supabaseUrl || !supabaseKey)'))
    assert.match(branch.slice(0, 260), /isPrivate \? deny\(request, unauthenticatedDecision\(pathname\)\)/)
  })

  test('the matcher still covers /api/**, which is what protects it', () => {
    const matcher = MW.slice(MW.indexOf('matcher:'))
    assert.doesNotMatch(matcher, /\(\?!.*\bapi\b/, 'the matcher must not exclude /api')
  })

  test('NO_STORE is a single constant applied to every private response', () => {
    assert.match(MW, /const NO_STORE = 'no-store, no-cache, must-revalidate, private'/)
    assert.match(MW, /if \(isPrivate\) response\.headers\.set\('Cache-Control', NO_STORE\)/)
  })
})

// ── C · Registration removal ─────────────────────────────────────────────────

describe('C · public self-registration is removed at both layers', () => {
  const LOGIN = readCode('src/app/(auth)/login/page.tsx')
  const LOGIN_RAW = read('src/app/(auth)/login/page.tsx')

  test('the registration endpoint no longer exists', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/api/auth/register/route.ts')))
    assert.ok(!ROUTE_FILES.some((f) => f.split(sep).join('/').includes('/api/auth/register')))
  })

  test('the login page cannot call it, and has no create-account mode', () => {
    assert.doesNotMatch(LOGIN, /api\/auth\/register/)
    const endpoints = [...LOGIN.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1])
    assert.deepEqual([...new Set(endpoints)], ['/api/auth/login'])
    assert.doesNotMatch(LOGIN, /\bisCreate\b|setMode|'create'/)
    assert.doesNotMatch(LOGIN, /createAccountTitle|createAccountSubtitle|submitCreate|needAccount/)
  })

  test('the login page has no recovery-email registration field', () => {
    assert.doesNotMatch(LOGIN, /id="email"/)
    assert.doesNotMatch(LOGIN, /emailLabel|emailPlaceholder|emailHint/)
  })

  test('the login page keeps exactly the required controls', () => {
    assert.match(LOGIN, /id="username"/)
    assert.match(LOGIN, /id="password"/)
    // R2: the submit control is the shared primary action.
    assert.match(LOGIN, /<AuthSubmitButton/)
    assert.match(readCode('src/components/fable/AuthForm.tsx'), /type="submit"/)
    assert.match(LOGIN, /href="\/forgot-password"/)
    assert.match(LOGIN, /t\.auth\.adminProvisioned/, 'administrator-provisioned wording')
  })

  test('restricted-access wording exists in BOTH languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const auth = dict[lang].auth as Record<string, string>
      assert.ok((auth.adminProvisioned ?? '').length > 0, `${lang} adminProvisioned`)
      assert.ok((auth.errNotAuthorized ?? '').length > 0, `${lang} errNotAuthorized`)
    }
    assert.notEqual(dict.en.auth.adminProvisioned, dict.es.auth.adminProvisioned, 'ES must be translated')
  })

  test('no sample credentials or public-invitation wording survives', () => {
    assert.doesNotMatch(LOGIN, /demo|sample credential|test@|password123/i)
    assert.doesNotMatch(LOGIN, /invite|invitation|sign up|signup|register/i)
  })

  test('no service-role secret can reach client code', () => {
    for (const file of walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(file, 'utf8')
      if (!/^'use client'|^"use client"/m.test(src)) continue
      assert.doesNotMatch(src, /SERVICE_ROLE|getSupabaseAdminClient/, `${file} is a client component`)
    }
  })

  test('the login page is a client component and imports no server-only auth module', () => {
    assert.match(LOGIN_RAW, /^'use client'/)
    assert.doesNotMatch(LOGIN, /supabase\/admin|auth\/getUser|auth\/apiGuard|sessionCookies/)
    // safeRedirect is pure and deliberately shared with the client.
    assert.match(LOGIN, /auth\/safeRedirect/)
  })
})

// ── D · Redirect safety (behavioural) ────────────────────────────────────────

describe('D · safe-redirect validator', () => {
  const ACCEPTED: [string, string][] = [
    ['/', '/'],
    ['/watchlist', '/watchlist'],
    ['/companies/TEST', '/companies/TEST'],
    ['/macro?region=cl', '/macro?region=cl'],
    ['/settings/notifications', '/settings/notifications'],
    ['/structured-notes/abc-123', '/structured-notes/abc-123'],
    ['/compare?tickers=SQM-B,CHILE', '/compare?tickers=SQM-B,CHILE'],
  ]
  for (const [input, expected] of ACCEPTED) {
    test(`accepts internal destination ${JSON.stringify(input)}`, () => {
      assert.equal(toSafeInternalPath(input), expected)
    })
  }

  const REJECTED = [
    'https://example.com',
    'http://example.com',
    '//example.com',
    '///example.com',
    '\\example.com',
    '/\\example.com',
    '/\\/example.com',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:someone@example.com',
    '%2F%2Fexample.com',
    '/%2F%2Fexample.com',
    '/%5Cexample.com',
    '/%252F%252Fexample.com',
    '%2525',
    '/%',
    '/%zz',
    '/..//example.com',
    '',
    '   ',
    'watchlist',
    'https:/example.com',
  ]
  for (const input of REJECTED) {
    test(`rejects ${JSON.stringify(input)} and falls back to /`, () => {
      assert.equal(toSafeInternalPath(input), SAFE_FALLBACK_PATH)
    })
  }

  test('rejects null, undefined and non-string input', () => {
    assert.equal(toSafeInternalPath(null), '/')
    assert.equal(toSafeInternalPath(undefined), '/')
    assert.equal(toSafeInternalPath(42 as unknown as string), '/')
  })

  test('rejects control characters browsers strip before resolving', () => {
    assert.equal(toSafeInternalPath('/\thttps://example.com'), '/')
    assert.equal(toSafeInternalPath('/\n//example.com'), '/')
    assert.equal(toSafeInternalPath('/\r/example.com'), '/')
    assert.equal(toSafeInternalPath('/%09//example.com'), '/')
  })

  test('every rejected value produces a bare /login with no next', () => {
    for (const input of REJECTED) {
      assert.equal(buildLoginRedirectPath(input), '/login', `for ${JSON.stringify(input)}`)
    }
  })

  test('there is exactly ONE redirect validator — no duplicate startsWith check survives', () => {
    for (const file of ['src/middleware.ts', 'src/app/(auth)/login/page.tsx', 'src/app/auth/callback/route.ts']) {
      const src = readCode(file)
      assert.match(src, /safeRedirect|toSafeInternalPath|buildLoginRedirectPath/, `${file} must use the shared helper`)
      assert.doesNotMatch(src, /next\.startsWith\('\/'\)/, `${file} must not re-implement validation`)
    }
  })

  test('the validator module is pure, so client and server share one implementation', () => {
    const src = read('src/lib/auth/safeRedirect.ts')
    assert.doesNotMatch(src, /from 'next\/|@supabase|process\.env/)
  })
})

// ── E · Session, approval and logout ─────────────────────────────────────────

describe('E · approval boundary', () => {
  test('a profile with a username is approved', () => {
    assert.ok(isApprovedProfile({ id: 'u1', username: 'someone', email: 'a@b.test' }))
  })

  test('an Auth identity with no profile row is NOT approved', () => {
    assert.ok(!isApprovedProfile(null))
    assert.ok(!isApprovedProfile(undefined))
  })

  test('a profile whose username was cleared or blanked is NOT approved (revocation)', () => {
    assert.ok(!isApprovedProfile({ id: 'u1', username: null }))
    assert.ok(!isApprovedProfile({ id: 'u1', username: '' }))
    assert.ok(!isApprovedProfile({ id: 'u1', username: '   ' }))
  })

  test('approval is never derived from user-writable Supabase metadata', () => {
    const src = read('src/lib/auth/approval.ts')
    assert.doesNotMatch(src, /user_metadata\s*[.[]/, 'metadata must not be read as a claim')
    assert.match(src, /user_metadata/, 'and the reason must be documented')
    assert.doesNotMatch(read('src/middleware.ts'), /user_metadata/)
  })

  test('BOTH session-minting routes enforce the approval boundary', () => {
    const login = read('src/app/api/auth/login/route.ts')
    assert.match(login, /isApprovedProfile\(profile\)/)
    assert.match(login, /invalid_credentials/, 'and stays generic, so approval state does not leak')

    const callback = read('src/app/auth/callback/route.ts')
    assert.match(callback, /isApprovedProfile\(profile\)/)
    assert.match(callback, /signOut\(\)/, 'an unapproved exchange must not leave a usable cookie')
    assert.match(callback, /error=not_authorized/)
  })

  test('the authoritative guard verifies the session rather than trusting the cookie', () => {
    const getUser = readCode('src/lib/auth/getUser.ts')
    assert.match(getUser, /export async function getApprovedUser/)
    assert.match(getUser, /auth\.getUser\(\)/, 'getUser() validates with the Auth server')
    assert.doesNotMatch(getUser, /auth\.getSession\(\)/, 'the authoritative path must not use getSession()')

    const guard = read('src/lib/auth/apiGuard.ts')
    assert.match(guard, /status: 401/)
    assert.match(guard, /status: 403/, '403 distinguishes authenticated-but-unapproved')
    assert.match(guard, /no-store/)
    assert.match(guard, /ACCESS_DENIED_REASONS/)
  })

  test('the guard returns only a reason code — never a payload fragment', () => {
    const guard = read('src/lib/auth/apiGuard.ts')
    const bodies = [...guard.matchAll(/NextResponse\.json\(\s*\{([^}]*)\}/g)].map((m) => m[1])
    assert.ok(bodies.length >= 2)
    for (const body of bodies) {
      assert.match(body, /^\s*error:/, `denial body must carry only an error code, got: ${body}`)
    }
  })

  test('the approval read uses own-row RLS, never the service-role client', () => {
    const getUser = read('src/lib/auth/getUser.ts')
    assert.match(getUser, /getSupabaseUserClient/)
    assert.doesNotMatch(getUser, /getSupabaseAdminClient|SERVICE_ROLE/)
  })

  test('logout is public, clears the session, and returns to /login without looping', () => {
    assert.equal(classifyPath('/logout'), 'session_mint')
    assert.ok(!requiresApprovedSession('/logout'))
    const src = read('src/app/logout/route.ts')
    assert.match(src, /auth\.signOut\(\)/)
    assert.match(src, /new URL\('\/login'/)
  })

  test('after logout a cleared session is indistinguishable from none — same denials apply', () => {
    assert.ok(requiresApprovedSession('/portfolio'))
    assert.ok(!deniesWithJson('/portfolio'), 'browser route redirects')
    assert.ok(requiresApprovedSession('/api/portfolios'))
    assert.ok(deniesWithJson('/api/portfolios'), 'API returns JSON 401')
    assert.equal(ACCESS_DENIED_REASONS.unauthenticated, 'unauthenticated')
    assert.equal(ACCESS_DENIED_REASONS.notApproved, 'not_authorized')
  })

  test('the login gateway itself is never gated — no redirect loop is possible', () => {
    assert.ok(!requiresApprovedSession('/login'))
    assert.equal(buildLoginRedirectPath('/login'), '/login?next=%2Flogin')
    // …and /login is public, so that destination cannot bounce.
    assert.equal(classifyPath('/login'), 'public_page')
  })
})

// ── F · Cache safety ─────────────────────────────────────────────────────────

describe('F · private responses are not publicly cacheable', () => {
  test('no private page opts into static generation or force-cache', () => {
    for (const file of ROUTE_FILES.filter((f) => /page\.tsx$/.test(f))) {
      const route = fileToRoutePath(file)
      if (!route || !requiresApprovedSession(route)) continue
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(src, /force-static|revalidate\s*=\s*\d|cache:\s*'force-cache'/, `${route} must not be cached`)
      // The invariant is that no private data is ever embedded in PRERENDERED
      // HTML. A private page satisfies that either by being a client shell
      // (the original form — data arrives over the API behind the same gate)
      // or, since R9.2's /settings, by being a server component that is
      // explicitly dynamic and therefore rendered per request. What is
      // forbidden either way is static generation, asserted above.
      assert.match(
        src,
        /^'use client'|export const dynamic = 'force-dynamic'/m,
        `${route} must be a client shell or an explicitly dynamic server component`,
      )
    }
  })

  test('private API responses are dynamic, never statically cached', () => {
    for (const file of ROUTE_FILES.filter((f) => /route\.ts$/.test(f))) {
      const route = fileToRoutePath(file)
      if (!route || classifyPath(route) !== 'private_api') continue
      const src = readFileSync(file, 'utf8')
      assert.doesNotMatch(src, /'public, max-age|s-maxage|force-static/, `${route} must not be publicly cacheable`)
    }
  })

  test('every denial path carries no-store', () => {
    assert.match(read('src/lib/auth/apiGuard.ts'), /no-store, no-cache, must-revalidate, private/)
    assert.match(read('src/middleware.ts'), /no-store, no-cache, must-revalidate, private/)
    assert.match(read('src/app/auth/callback/route.ts'), /no-store/)
  })
})

// ── Provisioning ─────────────────────────────────────────────────────────────

describe('administrator provisioning is server-only and complete', () => {
  const SCRIPT_PATH = 'scripts/admin/provisionUser.ts'
  const SCRIPT = read(SCRIPT_PATH)

  test('it exists outside the Next.js router, so it is not publicly callable', () => {
    assert.ok(existsSync(join(ROOT, SCRIPT_PATH)))
    assert.ok(!SCRIPT_PATH.includes('src/app'))
    assert.ok(!ROUTE_FILES.some((f) => f.toLowerCase().includes('provision')), 'no route handler exposes provisioning')
  })

  test('it creates EVERY record a usable username-based account needs', () => {
    assert.match(SCRIPT, /auth\.admin\.createUser/, 'Auth identity')
    assert.match(SCRIPT, /from\('user_profiles'\)[\s\S]{0,400}upsert/, 'approval record')
    for (const field of ['username', 'email', 'display_name']) {
      assert.match(SCRIPT, new RegExp(field), `must write ${field}`)
    }
  })

  test('it reads secrets only from the existing server environment', () => {
    assert.match(SCRIPT, /getSupabaseAdminClient/)
    assert.match(SCRIPT, /loadEnvConfig\(process\.cwd\(\)\)/, 'the env-loading bug we have shipped before')
    assert.doesNotMatch(SCRIPT, /SUPABASE_SERVICE_ROLE_KEY\s*=/, 'must never hardcode a key')
  })

  test('it requires explicit invocation — dry-run is the default', () => {
    assert.match(SCRIPT, /--write/)
    assert.match(SCRIPT, /DRY RUN/)
  })

  test('it is invoked with plain node — never npx, which would fetch an unpinned package', () => {
    // `tsx` is NOT a dependency of this project (`npm ls tsx` → empty), so an
    // `npx tsx` instruction would download an unpinned package from the network
    // before running an administrative command that holds the service-role key.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    assert.equal(pkg.dependencies?.tsx, undefined)
    assert.equal(pkg.devDependencies?.tsx, undefined)

    // No npx INVOCATION of this script anywhere (the header's explanation of
    // why npx is unsafe is the one permitted mention of the word).
    assert.doesNotMatch(SCRIPT, /npx \S*\s*scripts\/admin\/provisionUser\.ts/)
    assert.match(SCRIPT, /node scripts\/admin\/provisionUser\.ts/)
    assert.match(SCRIPT, /unpinned package/, 'and the reason is recorded')
    assert.doesNotMatch(read('docs/security_access_control.md'), /npx/)
    assert.doesNotMatch(read('docs/deployment.md'), /npx tsx/)
  })

  test('it loads env the way every other script in this repo does', () => {
    // @next/env is CJS; a named import fails under plain node at runtime.
    assert.match(SCRIPT, /import pkg from '@next\/env'/)
    assert.match(SCRIPT, /pkg\.loadEnvConfig\(process\.cwd\(\)\)/)
  })

  test('revocation targets the approval marker the per-request check reads', () => {
    // This is what makes --revoke deny the next REQUEST, not just the next login.
    assert.match(SCRIPT, /update\(\{ username: null \}\)/)
    assert.ok(!isApprovedProfile({ id: 'u', username: null }))
    // The per-request read still carries `username`. POST-R13.6CDE.1 added
    // `role` beside it for the platform boundary; POST-R13.6CDE.2 embedded the
    // module grants in the same read and moved the column list into a shared
    // constant, so the cross-check follows it there rather than re-spelling it.
    assert.match(read('src/middleware.ts'), /\.select\(AUTHORIZATION_STATE_SELECT\)/)
    assert.match(AUTHORIZATION_STATE_SELECT, /\busername\b/)
  })

  test('a retry cannot create a duplicate or mismatched identity', () => {
    // Re-running reuses the Auth identity for the same email, and refuses to
    // move a username that already belongs to a different account.
    assert.match(SCRIPT, /listUsers/, 'looks up an existing identity by email')
    assert.match(SCRIPT, /updateUserById/, 'repairs rather than duplicating')
    assert.equal((SCRIPT.match(/already held by a different account/g) ?? []).length, 2,
      'guarded on both the existing-identity and new-identity paths')
  })

  test('it validates inputs with the same validators the login flow uses', () => {
    for (const v of ['isValidUsername', 'isValidPassword', 'isValidEmail', 'isValidDisplayName']) {
      assert.match(SCRIPT, new RegExp(v), `must call ${v}`)
    }
  })

  test('it never logs a password or a secret', () => {
    const logged = [...SCRIPT.matchAll(/console\.(log|error)\(([^\n]*)\)/g)].map((m) => m[2])
    for (const line of logged) {
      assert.doesNotMatch(line, /SERVICE_ROLE|serviceRoleKey|config\.url/, `leaks a secret: ${line}`)
    }
    assert.match(SCRIPT, /shown once/i, 'the one-time password print is deliberate and labelled')
    assert.match(SCRIPT, /--password-stdin/, 'and a stdin path exists so it can stay off argv')
    assert.match(SCRIPT, /email         : \(supplied, not echoed\)/, 'the address is never echoed')
  })

  test('it reports partial provisioning rather than pretending to succeed', () => {
    assert.match(SCRIPT, /PARTIAL PROVISIONING/)
    assert.match(SCRIPT, /process\.exit\(1\)/)
  })

  test('it contains no real user details', () => {
    assert.doesNotMatch(SCRIPT, /@(gmail|hotmail|outlook|inevada)\.[a-z]+/i)
    assert.doesNotMatch(SCRIPT, /mesainversiones/i)
  })

  test('an incomplete identity is denied: no approval record means no access', () => {
    assert.ok(!isApprovedProfile({ id: 'auth-only-identity', username: null }))
    const createIdx = SCRIPT.indexOf('createUser')
    const upsertIdx = SCRIPT.indexOf("from('user_profiles').upsert")
    assert.ok(createIdx > 0 && upsertIdx > createIdx, 'approval record is written after the identity exists')
  })

  test('it offers revocation using the existing approval mechanism', () => {
    assert.match(SCRIPT, /--revoke/)
    assert.match(SCRIPT, /update\(\{ username: null \}\)/)
    assert.match(SCRIPT, /ban or delete/i, 'and documents active-session revocation')
  })

  test('the procedure is documented without secrets or real identities', () => {
    const doc = read('docs/security_access_control.md')
    assert.match(doc, /provisionUser\.ts/)
    assert.match(doc, /Revoking access/i)
    assert.match(doc, /PARTIAL PROVISIONING/)
    assert.doesNotMatch(doc, /mesainversiones|@inevada\.cl/i)
    assert.doesNotMatch(doc, /eyJ[A-Za-z0-9_-]{10,}/, 'no JWT or key material')
  })
})

// ── D · user_profiles approval integrity (RLS) ───────────────────────────────

describe('D · the approval marker must be administrator-controlled', () => {
  const AUTH_MIGRATION = read('supabase/migrations/20260701000000_auth_watchlist_foundation.sql')
  const DOC = read('docs/security_access_control.md')

  // Full coverage of the repair migration (policies, grants, data safety) lives
  // in tests/userProfilesRls.test.ts. The tests here pin the FINDING — the exact
  // unsafe policies as Phase 6A wrote them — so the report stays truthful.

  test('the self-service INSERT policy is a real self-approval path (documented finding)', () => {
    // `with check (auth.uid() = id)` lets ANY authenticated identity create its
    // own user_profiles row — including the username approval marker — using the
    // public anon key. This is the exact unsafe policy reported to the user.
    assert.match(AUTH_MIGRATION, /create policy "users_own_profile_insert" on user_profiles\s+for insert with check \(auth\.uid\(\) = id\)/)
  })

  test('the self-service UPDATE policy has no WITH CHECK, so the marker can be rewritten', () => {
    assert.match(AUTH_MIGRATION, /create policy "users_own_profile_update" on user_profiles\s+for update using \(auth\.uid\(\) = id\)/)
    const update = AUTH_MIGRATION.slice(AUTH_MIGRATION.indexOf('users_own_profile_update'))
    assert.doesNotMatch(update.slice(0, 160), /with check/i, 'no WITH CHECK ⇒ the new row is unconstrained')
  })

  test('a later migration repairs the self-approval policies', () => {
    // The Phase 6A creates still exist in their own file (migrations are
    // forward-only and never edited in place), so the repair must arrive as a
    // NEWER migration that drops them. Detailed coverage of that migration lives
    // in tests/userProfilesRls.test.ts.
    const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
    const phase6aIndex = files.indexOf('20260701000000_auth_watchlist_foundation.sql')
    assert.ok(phase6aIndex >= 0)

    // Strip `--` comments: the repair migration quotes the unsafe policies in
    // its header to explain what it removes, and prose must never satisfy a
    // code assertion.
    const laterSql = files.slice(phase6aIndex + 1)
      .map((f) => readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8'))
      .map((sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'))
      .join('\n')

    // The repair drops EVERY policy by enumerating pg_policies rather than
    // naming the Phase 6A ones — a guessed list would miss a permissive policy
    // added by hand. Full coverage in tests/userProfilesRls.test.ts.
    assert.match(laterSql, /from pg_catalog\.pg_policies\s+where schemaname = 'public' and tablename = 'user_profiles'/)
    assert.match(laterSql, /execute format\('drop policy %I on public\.user_profiles'/)

    for (const policy of ['users_own_profile_insert', 'users_own_profile_update']) {
      assert.doesNotMatch(
        laterSql,
        new RegExp(`create policy "${policy}"`),
        `${policy} must not be recreated`,
      )
    }

    // Exactly one policy survives, and it grants no write.
    const created = [...laterSql.matchAll(/create policy "([^"]+)" on public\.user_profiles\s+for (\w+)/g)]
      .map((m) => `${m[1]}:${m[2].toLowerCase()}`)
    assert.deepEqual(created, ['users_own_profile_select:select'])
  })

  // R11.1 supersedes the "not yet applied" half of this assertion. The enduring
  // contract is that the security document states the repair's APPLICATION
  // STATUS unambiguously — never that the status is one particular value. The
  // migration was applied during R1.5 (local/remote parity confirmed in that
  // execution record); the docs said otherwise until R11.1 reconciled them, and
  // this test was the last thing still asserting the stale claim. It now pins
  // the corrected status plus the provenance note, so a future turn cannot
  // silently re-open the finding or quietly overstate a fresh verification.
  test('the repair is documented, including its application status and provenance', () => {
    assert.match(DOC, /self-approval/i)
    assert.match(DOC, /users_own_profile_insert/, 'the exact policy must be named')
    assert.match(DOC, /20260730000000_user_profiles_admin_controlled_approval\.sql/)
    assert.match(DOC, /applied during\s*\n?R1\.5/i, 'the applied status must be stated')
    assert.doesNotMatch(DOC, /\*\*NOT YET APPLIED\.\*\*|Not applied to any\s*\n?environment/i)
    // The correction must never read as a fresh production check.
    assert.match(DOC, /no database was re-queried, no migration was run/i)
    assert.match(DOC, /Rollback/i, 'and its rollback')
  })

  test('the application itself never writes an approval marker from a user session', () => {
    // Only the administrator script may create or change a username.
    for (const file of walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(file, 'utf8')
      if (!/from\(['"]user_profiles['"]\)/.test(src)) continue
      const writes = /\.(insert|upsert|update)\(/.test(src)
      assert.ok(!writes, `${relative(ROOT, file)} must not write user_profiles from the app`)
    }
  })

  test('approval is read, never derived from a client-supplied value', () => {
    const mw = readCode('src/middleware.ts')
    assert.match(mw, /\.eq\('id', userId\)/, 'scoped to the VERIFIED user id')
    assert.doesNotMatch(mw, /searchParams\.get\('user|headers\.get\('x-user/)
  })
})

// ── E · direct Supabase signup (mandatory external control) ──────────────────

describe('E · public Supabase signup must be disabled at the project level', () => {
  const DOC = read('docs/security_access_control.md')

  test('the documentation carries a mandatory deployment-control section', () => {
    assert.match(DOC, /Mandatory Supabase deployment settings/i)
    assert.match(DOC, /disable.*signup/i)
    assert.match(DOC, /Allow new users to sign up/i, 'names the actual dashboard control')
  })

  test('it explains why deleting the app route is not sufficient', () => {
    assert.match(DOC, /anon|publishable/i)
    assert.match(DOC, /\/auth\/v1\/signup/, 'the endpoint that remains reachable')
  })

  test('it gives a verification procedure that creates no user and leaks no secret', () => {
    assert.match(DOC, /\/auth\/v1\/settings/, 'read-only settings endpoint')
    assert.match(DOC, /disable_signup/)
    assert.doesNotMatch(DOC, /SUPABASE_SERVICE_ROLE_KEY=|eyJ[A-Za-z0-9_-]{10,}/, 'no key material')
  })

  test('administrator invite and existing-user recovery are preserved by the control', () => {
    assert.match(DOC, /invite|create user/i)
    assert.match(DOC, /recovery/i)
  })

  test('it keeps a dated verification log, with no real identities in it', () => {
    assert.match(DOC, /\*\*Verification log\*\*/i, 'the log section exists')
    const log = DOC.slice(DOC.indexOf('**Verification log**'))
    assert.match(log, /\| 20\d\d-\d\d-\d\d[^|]*\| `(true|false)`/, 'at least one dated outcome row')
    assert.doesNotMatch(DOC, /mesainversiones|@inevada\.cl/i)
    assert.doesNotMatch(DOC, /eyJ[A-Za-z0-9_-]{10,}/, 'no key material')
  })

  test('the resolved/open status of the external control is stated explicitly', () => {
    // The setting is a deployment control this repo cannot enforce, so its
    // current state must be recorded rather than assumed.
    assert.match(DOC, /RESOLVED|OPEN — BLOCKING/i)
    assert.match(DOC, /deployment setting, not code/i)
  })
})

// ── G · Regression ───────────────────────────────────────────────────────────

describe('G · regression — authenticated behaviour and business logic untouched', () => {
  test('password recovery routes stay public and functionally unchanged', () => {
    for (const route of ['/forgot-password', '/auth/reset-password']) {
      assert.ok(!requiresApprovedSession(route), `${route} must remain reachable`)
    }
    for (const route of ['/api/auth/forgot-password', '/api/auth/reset-password']) {
      assert.ok(!requiresApprovedSession(route), `${route} must not be session-gated`)
    }
    const reset = read('src/app/api/auth/reset-password/route.ts')
    assert.match(reset, /no_session/)
    assert.match(reset, /status: 401/)
    assert.doesNotMatch(reset, /getSupabaseAdminClient/, 'must never fall back to the admin client')
  })

  test('the recovery link flow still targets /auth/callback → /auth/reset-password', () => {
    const forgot = read('src/app/api/auth/forgot-password/route.ts')
    assert.match(forgot, /\/auth\/callback\?next=/)
    assert.match(forgot, /\/auth\/reset-password/)
    assert.match(forgot, /ok: true/, 'still generic, no account enumeration')
  })

  test('login preserves its Phase-6B contract', () => {
    const login = read('src/app/api/auth/login/route.ts')
    assert.match(login, /signInWithPassword\(\{ email, password \}\)/)
    assert.match(login, /invalid_credentials/)
    assert.match(login, /applyCookies\(res\)/)
    const page = read('src/app/(auth)/login/page.tsx')
    assert.match(page, /window\.location\.assign\(safeNext\)/, 'full navigation so cookies are picked up')
    assert.match(page, /disabled=\{loading \|\| !username\.trim\(\) \|\| !password\}/)
    // R2: the assertive banner is the shared error notice.
    assert.match(page, /<AuthNotice variant="error"/)
    assert.match(read('src/components/fable/AuthForm.tsx'), /role=\{error \? 'alert' : 'status'\}/)
  })

  test('the Fable auth shell and R1 composition are untouched', () => {
    const page = read('src/app/(auth)/login/page.tsx')
    // R2 moved the two column wrappers into the shared slot primitives, which
    // all three auth routes compose; the values and entrance utilities are the
    // same ones R1 established.
    const form = read('src/components/fable/AuthForm.tsx')
    assert.match(page, /<AuthHeadline/)
    assert.match(page, /<AuthPanelColumn>/)
    assert.match(form, /nv-auth-reveal/)
    assert.match(form, /nv-auth-fade/)
    assert.match(form, /flex: '1\.1 1 340px'/)
    assert.match(form, /flex: '0 1 402px', minWidth: 'min\(100%, 330px\)'/)
    assert.match(page, /<AuthPanel/)
    assert.match(read('src/components/fable/AuthShell.tsx'), /<NevadaMark variant="lockup"/)
  })

  test('AppShell mounts once, through the unchanged ShellGate', () => {
    const gate = read('src/components/layout/ShellGate.tsx')
    assert.match(gate, /BARE_ROUTES/)
    assert.match(gate, /<AppShell>\{children\}<\/AppShell>/)
    assert.match(read('src/app/layout.tsx'), /<ShellGate>\{children\}<\/ShellGate>/)
  })

  test('the security layer imports no business logic, and stays framework-free', () => {
    for (const file of ['src/lib/auth/accessPolicy.ts', 'src/lib/auth/safeRedirect.ts', 'src/lib/auth/approval.ts']) {
      const src = read(file)
      assert.doesNotMatch(src, /from '.*(providers|repositories|financials|market|macro)/, `${file} must stay policy-only`)
      assert.doesNotMatch(src, /from 'next\//, `${file} must remain pure`)
    }
  })

  test('no financial provider, formatter or data module was modified by this phase', () => {
    // These carry the source labels, timestamps and calculations R1.5 must not
    // touch; a change here would show up as an import from the auth layer.
    for (const file of ['src/lib/formatters.ts', 'src/lib/dataSourceRegistry.ts']) {
      assert.doesNotMatch(read(file), /auth\/(accessPolicy|safeRedirect|approval|apiGuard)/, `${file} must not depend on auth`)
    }
  })

  test('the login gateway renders no source badge or footer (nothing financial changed)', () => {
    assert.doesNotMatch(read('src/app/(auth)/login/page.tsx'), /TableSourceFooter|DataSourceBadge/)
  })
})
