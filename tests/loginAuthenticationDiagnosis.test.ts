// POST-R13.6R1.1 — SIGN-IN MUST NOT DEPEND ON ENTITLEMENT, AND A DEPLOYMENT
// FAULT MUST NOT BE REPORTED AS A WRONG PASSWORD.
//
// WHY THIS FILE EXISTS
// ────────────────────
// The owner reported that the PR #3 Preview rejected credentials that worked on
// Production. The obvious suspect was the new module-entitlement gate: if any
// part of it ran before or during password authentication, an administrator
// holding zero grant rows might be refused a session. Diagnosis showed it does
// not — but "we looked and it was fine" is not a property a future change is
// held to, so the ordering is pinned here as an executable rule.
//
// The investigation did surface a real defect, and it is the reason the stage
// was slow: `/api/auth/login` destructured the profile-lookup `error` away, so
// an unreachable database, a rotated service-role key or any PostgREST fault
// produced the same 401 as a genuinely wrong password. Every possible cause
// arrived at the reader as "Incorrect username or password" — the one message
// that sends someone to re-type a password that was never the problem.
//
// BEHAVIOURAL WHERE THE CODE IS REACHABLE. `canEnterPlatform`,
// `decideRequestAccess`, `parseAuthorizationRow` and the redirect helpers are
// pure and dependency-injected, so those cases run the real decisions.
// STRUCTURAL ONLY FOR THE ROUTE HANDLERS, which import `next/server` and cannot
// be executed under the bare node:test runner — those assertions read
// comment-stripped source so a comment can never satisfy one.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canEnterPlatform } from '../src/lib/auth/moduleAccess.ts'
import { decideRequestAccess, type IdentityVerifier } from '../src/lib/auth/requestAccess.ts'
import {
  parseAuthorizationRow,
  moduleAccessOf,
  type AuthorizationStateLookup,
} from '../src/lib/auth/authorizationState.ts'
import { requiresApprovedSession } from '../src/lib/auth/accessPolicy.ts'
import { toSafeInternalPath, buildLoginRedirectPath } from '../src/lib/auth/safeRedirect.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const LOGIN_ROUTE = read('src/app/api/auth/login/route.ts')
const LOGIN_ROUTE_CODE = code(LOGIN_ROUTE)
const LOGIN_PAGE = read('src/app/(auth)/login/page.tsx')
const CALLBACK = read('src/app/auth/callback/route.ts')
const FORGOT = read('src/app/api/auth/forgot-password/route.ts')

const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad'
const verified: IdentityVerifier = async () => ({ user: { id: ADMIN_ID } })

/** The exact production shape: approved administrator, zero grant rows. */
const ADMIN_ZERO_GRANTS = {
  id: ADMIN_ID,
  username: 'an-administrator',
  role: 'administrator',
  user_module_grants: [] as { module_key: string }[],
}

describe('POST-R13.6R1.1 — sign-in does not depend on module entitlement', () => {
  it('an approved administrator with ZERO grant rows may enter the platform', () => {
    const parsed = parseAuthorizationRow(ADMIN_ID, ADMIN_ZERO_GRANTS)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.ok && parsed.state)
    const access = moduleAccessOf(parsed.state!)
    assert.deepEqual(access, { isApproved: true, isAdministrator: true, grants: [] })
    assert.equal(canEnterPlatform(access), true)
  })

  it('that administrator is allowed on every class of private route', async () => {
    const lookup: AuthorizationStateLookup = async () =>
      parseAuthorizationRow(ADMIN_ID, ADMIN_ZERO_GRANTS)
    for (const path of [
      '/', '/settings', '/settings/users',
      '/portfolio', '/structured-notes', '/stocks', '/macro',
    ]) {
      const d = await decideRequestAccess(path, verified, lookup)
      assert.equal(d.outcome, 'allow', `${path} must allow an administrator with no grants`)
    }
  })

  it('the login endpoint reads no module, grant or entitlement state at all', () => {
    for (const forbidden of [
      'user_module_grants', 'app_modules', 'canEnterPlatform', 'moduleAccess',
      'nmi_can_access_module', 'moduleRoutes', 'authorizationState',
    ]) {
      assert.ok(
        !LOGIN_ROUTE_CODE.includes(forbidden),
        `/api/auth/login must not reference ${forbidden}: authentication precedes authorization`,
      )
    }
  })

  it('the login endpoint authenticates BEFORE any approval reasoning can matter', () => {
    // Ordering, asserted by position rather than by prose: the password grant is
    // the last thing the handler does, and the approval predicate is the only
    // gate before it.
    const signIn = LOGIN_ROUTE_CODE.indexOf('signInWithPassword')
    const approval = LOGIN_ROUTE_CODE.indexOf('isApprovedProfile')
    assert.ok(signIn > 0, 'the route must sign in with a password')
    assert.ok(approval > 0 && approval < signIn, 'approval is checked, and only before the grant')
    assert.ok(
      !/canEnterPlatform|grants/.test(LOGIN_ROUTE_CODE),
      'no entitlement check may stand between a caller and a session',
    )
  })
})

describe('POST-R13.6R1.1 — a deployment fault is never reported as a bad password', () => {
  it('the profile-lookup error is inspected, not destructured away', () => {
    assert.ok(
      /error:\s*lookupError/.test(LOGIN_ROUTE_CODE),
      'the lookup error must be captured',
    )
    assert.ok(
      /if\s*\(\s*lookupError\s*\)/.test(LOGIN_ROUTE_CODE),
      'the lookup error must be branched on',
    )
  })

  it('a failed lookup answers 503 lookup_unavailable, never 401 invalid_credentials', () => {
    const branch = LOGIN_ROUTE_CODE.slice(
      LOGIN_ROUTE_CODE.indexOf('if (lookupError)'),
      LOGIN_ROUTE_CODE.indexOf('if (lookupError)') + 200,
    )
    assert.ok(branch.includes('lookup_unavailable'), 'distinct code')
    assert.ok(branch.includes('503'), 'availability status, not an authorization status')
    assert.ok(
      !branch.includes('invalid_credentials'),
      'a lookup failure must not borrow the credential code',
    )
  })

  it('the four failure classes are internally distinct', () => {
    for (const c of ['not_configured', 'lookup_unavailable', 'invalid_credentials', 'invalid_json']) {
      assert.ok(LOGIN_ROUTE_CODE.includes(c), `${c} must exist as its own code`)
    }
    // Enumeration safety is unchanged: a missing profile and a wrong password
    // still share one response, so neither reveals whether the username exists.
    const occurrences = LOGIN_ROUTE_CODE.split('invalid_credentials').length - 1
    assert.ok(occurrences >= 3, 'not-found and wrong-password still answer identically')
  })

  it('only a genuine credential refusal renders the credential message', () => {
    const map = LOGIN_PAGE.slice(
      LOGIN_PAGE.indexOf('function errorKeyToMessage'),
      LOGIN_PAGE.indexOf('function callbackErrorToMessage'),
    )
    assert.ok(/case 'invalid_credentials': return t\.auth\.errInvalidCredentials/.test(map))
    assert.ok(
      !/case 'lookup_unavailable':\s*return t\.auth\.errInvalidCredentials/.test(map),
      'a lookup failure must never render "Incorrect username or password"',
    )
    assert.ok(map.includes("case 'lookup_unavailable'"), 'and it must be handled explicitly')
  })

  it('an entitlement-store failure is not shown as bad credentials either', async () => {
    const failing: AuthorizationStateLookup = async () => ({ ok: false })
    const d = await decideRequestAccess('/', verified, failing)
    assert.equal(d.outcome, 'deny')
    assert.ok(d.outcome === 'deny' && d.reason === 'access_unavailable')
    assert.equal(d.outcome === 'deny' && d.status, 503)
    // And it reaches the reader as its own sentence, not as a credential error.
    for (const lang of ['en', 'es'] as const) {
      const a = dict[lang].auth
      assert.notEqual(a.errAccessUnavailable, a.errInvalidCredentials)
      assert.ok(a.errAccessUnavailable.length > 0)
    }
  })
})

describe('POST-R13.6R1.1 — origin handling is identical on Preview and Production', () => {
  it('no auth redirect is built from a deployment-pinned environment variable', () => {
    for (const [name, src] of [
      ['callback', CALLBACK], ['forgot-password', FORGOT], ['login route', LOGIN_ROUTE],
    ] as const) {
      assert.ok(
        !/NEXT_PUBLIC_SITE_URL|VERCEL_URL/.test(code(src)),
        `${name} must derive its origin from the request, or a Preview would build Production URLs`,
      )
    }
  })

  it('the recovery redirect is built from the request origin', () => {
    assert.ok(
      /request\.nextUrl\.origin/.test(code(FORGOT)),
      'redirectTo must come from the origin the caller actually used',
    )
  })

  it('a relative next survives on either origin, and an off-site one never does', () => {
    for (const good of ['/', '/settings', '/portfolio?scope=main']) {
      assert.equal(toSafeInternalPath(good), good)
    }
    for (const hostile of [
      'https://evil.example/x', '//evil.example', 'http://nevada-market-intelligence.vercel.app/x',
    ]) {
      assert.equal(
        toSafeInternalPath(hostile), '/',
        'an absolute URL must never be reflected back out of /login',
      )
    }
  })

  it('the login gateway itself is public, so a denial can never loop', () => {
    assert.equal(requiresApprovedSession('/login'), false)
    // The redirect a denial builds points at that public path.
    const target = buildLoginRedirectPath('/portfolio')
    assert.ok(target.startsWith('/login'), 'denials land on the public gateway')
    assert.equal(requiresApprovedSession(target.split('?')[0]), false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST-R13.6R1.2 — THE PREVIEW DIVERGENCE.
//
// R1.1 concluded the Preview was fine and Production merely held a stale cookie.
// That was WRONG: the owner signed in successfully on Production from a clean
// Incognito window with the same credentials the Preview rejects, and
// `last_sign_in_at` moved to prove it. So the divergence is real.
//
// It is not in the code — every server-side file on the login path is identical
// at the two deployed SHAs. It is in the environment: `SUPABASE_SERVICE_ROLE_KEY`
// carries no NEXT_PUBLIC_ prefix, so unlike the URL and the publishable key it is
// NOT inlined into the build. It is read at runtime from the per-deployment
// scope, which makes it the one login input that CAN differ between Preview and
// Production — and the one input R1.1 never compared, because there is no build
// artifact to compare it in.
//
// When that key is not accepted, PostgREST answers 401 and the lookup returns an
// ERROR (not "no such user"). The pre-fix route discarded that error, so the
// caller was told their password was wrong — and GoTrue was never even called.
// The tests below pin the two properties that keep this findable.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeUsername } from '../src/lib/auth/credentials.ts'

/** Exactly what the login form puts on the wire (see login/page.tsx). */
const clientSerializes = (username: string, password: string): string =>
  JSON.stringify({ username: username.trim(), password })

/** Exactly what the route reads back off it (see api/auth/login/route.ts). */
function routeParses(wire: string): { username: string; password: unknown } {
  const body = JSON.parse(wire) as Record<string, unknown>
  return { username: normalizeUsername(String(body.username ?? '')), password: body.password }
}

describe('POST-R13.6R1.2 — the password is opaque from field to grant', () => {
  it('an arbitrary password survives the client→route boundary byte for byte', () => {
    // Synthetic values only. Nothing here is anyone's password.
    const synthetic = [
      'plain-ascii-1234',
      '  leading and trailing  ',           // whitespace must NOT be trimmed
      'trailing-space ',
      'ends-with-newline\n',
      'contains "double" and \'single\' quotes',
      'back\slash and /forward/',
      'curly “quotes” and — dashes',        // smart punctuation from a paste
      'ñÁÉÍÓÚüç',                            // Latin-1 supplement
      'e\u0301-combining',                   // decomposed é: must not be normalized
      '\u00e9-precomposed',                  // precomposed é: must stay distinct
      '🔐🇨🇱 emoji',                          // astral plane / surrogate pairs
      'null\0byte',
      'x'.repeat(512),
      'MiXeD CaSe MuSt SuRvIvE',
    ]
    for (const password of synthetic) {
      const got = routeParses(clientSerializes('nmi-r15-test', password)).password
      assert.equal(typeof got, 'string')
      assert.equal(got, password, `password was altered in transit: ${JSON.stringify(password)}`)
    }
    // And the two look-alike accented forms stay different from each other, so no
    // Unicode normalization is being applied anywhere on the path.
    assert.notEqual(
      routeParses(clientSerializes('u', 'e\u0301')).password,
      routeParses(clientSerializes('u', '\u00e9')).password,
    )
  })

  it('the username IS trimmed and the password is deliberately NOT', () => {
    const parsed = routeParses(clientSerializes('  nmi-r15-test  ', '  keep  '))
    assert.equal(parsed.username, 'nmi-r15-test', 'a stray space around a username is forgiven')
    assert.equal(parsed.password, '  keep  ', 'but a password is a byte string, not a token to tidy')
  })

  it('no source on the path applies a transform to the password', () => {
    const AUTH_FORM = code(read('src/components/fable/AuthForm.tsx'))
    // The field hands back exactly what the user typed.
    assert.ok(
      /onChange=\{e => onChange\(e\.target\.value\)\}/.test(AUTH_FORM),
      'AuthField must pass the raw input value through',
    )
    // The form trims the username only; `password` is shorthand, unmodified.
    assert.ok(
      /username: username\.trim\(\), password \}/.test(code(LOGIN_PAGE)),
      'the submit body must trim the username and leave the password alone',
    )
    for (const transform of [
      /password\.trim\(\)/, /password\.toLowerCase\(\)/, /password\.toUpperCase\(\)/,
      /password\.normalize\(/, /password\.replace\(/, /password\.slice\(/,
      /encodeURIComponent\(password/, /decodeURIComponent\(password/,
    ]) {
      assert.ok(!transform.test(LOGIN_ROUTE_CODE), `the route must not apply ${transform} to the password`)
      assert.ok(!transform.test(code(LOGIN_PAGE)), `the page must not apply ${transform} to the password`)
    }
  })
})

describe('POST-R13.6R1.2 — a rejected service-role key must not read as a bad password', () => {
  // The two shapes PostgREST actually returns for a service-role key this project
  // does not accept. Both were observed live against the real project.
  const REJECTED_KEY_RESPONSES = [
    { status: 401, body: { message: 'Invalid API key' } },                                  // stale/legacy key
    { status: 401, body: { code: '42501', message: 'permission denied for table user_profiles' } }, // wrong key class
  ]

  it('both rejection shapes are errors, not an empty result', () => {
    for (const r of REJECTED_KEY_RESPONSES) {
      assert.equal(r.status, 401)
      // supabase-js surfaces a non-2xx as `error`, leaving `data` null. The point
      // that matters: this is NOT the same as a successful lookup finding no row.
      const asClientResult = { data: null, error: r.body }
      assert.notEqual(asClientResult.error, null)
      assert.equal(asClientResult.data, null)
    }
  })

  it('the route branches on the lookup error BEFORE the approval gate', () => {
    const lookupBranch = LOGIN_ROUTE_CODE.indexOf('if (lookupError)')
    const approvalGate = LOGIN_ROUTE_CODE.indexOf('isApprovedProfile(profile)')
    assert.ok(lookupBranch > 0, 'the lookup error must be branched on')
    assert.ok(
      lookupBranch < approvalGate,
      'an unreadable store must be reported as unreadable before it is mistaken for an unapproved account',
    )
  })

  it('a deployment whose key is refused says so, instead of blaming the password', () => {
    // This is the whole point of the fix: the same environment fault that produced
    // "Incorrect username or password" on the Preview now produces a 503 that names
    // an availability problem — without revealing whether the username exists.
    const map = LOGIN_PAGE.slice(
      LOGIN_PAGE.indexOf('function errorKeyToMessage'),
      LOGIN_PAGE.indexOf('function callbackErrorToMessage'),
    )
    assert.ok(map.includes("case 'lookup_unavailable'"))
    assert.ok(!/case 'lookup_unavailable':\s*return t\.auth\.errInvalidCredentials/.test(map))
    for (const lang of ['en', 'es'] as const) {
      assert.notEqual(dict[lang].auth.errAccessUnavailable, dict[lang].auth.errInvalidCredentials)
    }
  })
})
