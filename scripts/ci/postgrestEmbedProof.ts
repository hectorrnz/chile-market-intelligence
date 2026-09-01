// POST-R13.6CDE-C § 17 / § 18 — EXECUTABLE proof of the PostgREST embedded
// authorization query, run against an ISOLATED, DISPOSABLE Supabase stack.
//
// WHY A SQL TEST IS NOT ENOUGH
// ────────────────────────────
// POST-R13.6CDE.2 replaced three sequential reads with ONE:
//
//   .from('user_profiles')
//     .select('id, username, role, user_module_grants(module_key)')
//     .eq('id', userId)
//
// That shape depends on something no pgTAP suite can observe: PostgREST's own
// resource-embedding resolver. It must detect the foreign key from
// `user_module_grants.user_id` to `user_profiles.id`, expose the child relation
// under exactly the name the parser reads, and apply RLS to the embedded rows
// independently of the parent. A `select ... join ...` in psql proves the data
// model; it proves nothing at all about the REST contract the application
// actually speaks. If PostgREST refuses the relationship the entire private
// surface answers 503, so this is a release gate, not a nicety.
//
// WHAT THIS PROVES, over the real wire, with real JWTs:
//   A · approved administrator          -> query succeeds, zero grants is fine
//   B · approved member with grants     -> own rows only, exact module keys
//   C · approved member with zero grants-> EMPTY ARRAY, not a relation error
//   D · unapproved profile              -> parseable; the outer rule denies
//   E · a different user                -> no profile and no grants leak
//
// and then (§ 18) feeds those REAL response bodies into the application's own
// parser and request decision, so the shapes under test are the shapes the
// application will actually receive — not a hand-written fixture that agrees
// with the code because the same person wrote both.
//
// HERMETIC. Every key and secret comes from the throwaway stack the runner just
// started; nothing is read from a repository secret and nothing leaves the
// runner. The application-facing query is issued with the ANON key plus a
// genuine user access token — never the service-role key, which is used ONLY to
// create fixture identities, and that is setup, not the proof.

import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import {
  AUTHORIZATION_STATE_SELECT,
  parseAuthorizationRow,
  moduleAccessOf,
  type AuthorizationRow,
  type AuthorizationStateResult,
} from '../../src/lib/auth/authorizationState.ts'
import { decideRequestAccess } from '../../src/lib/auth/requestAccess.ts'

// ── A minimal result recorder ────────────────────────────────────────────────
// Collects every check so one failure does not hide the next; CI wants the
// whole picture in a single run.

let passed = 0
const failures: string[] = []

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
    return
  }
  failures.push(name)
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

function equal(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, `expected ${e}, got ${a}`)
}

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 68 - title.length))}`)
}

// ── Local stack discovery ────────────────────────────────────────────────────
// `supabase status -o json` is the supported way to read the throwaway
// credentials the local stack minted. Key names have varied across CLI
// versions, so each one is resolved from a candidate list and a miss is a loud
// error rather than an `undefined` that fails later in a confusing place.

interface StackConfig {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
  jwtSecret: string
}

/**
 * The Supabase CLI's documented local development JWT secret.
 *
 * Used ONLY if `supabase status` does not expose JWT_SECRET on this CLI
 * version, and it can never produce a false pass: a wrong secret yields a
 * signature GoTrue rejects, the token check below fails, and the proof stops.
 */
const LOCAL_DEFAULT_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

function pick(status: Record<string, unknown>, candidates: string[], label: string): string {
  for (const key of candidates) {
    const value = status[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  throw new Error(
    `Could not read ${label} from \`supabase status -o json\`. Tried ${candidates.join(', ')}. ` +
      `Available keys: ${Object.keys(status).join(', ')}`,
  )
}

function readStack(): StackConfig {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  // Slice to the JSON object: some CLI builds prepend an upgrade notice on
  // stdout, and a JSON.parse failure there would be reported as a broken embed.
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('`supabase status -o json` produced no JSON object')
  }
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1))
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('`supabase status -o json` did not return an object')
  }
  const status = parsed as Record<string, unknown>
  let jwtSecret: string
  try {
    jwtSecret = pick(status, ['JWT_SECRET', 'jwt_secret'], 'the JWT secret')
  } catch {
    console.log('note: `supabase status` exposes no JWT_SECRET; using the documented local default')
    jwtSecret = LOCAL_DEFAULT_JWT_SECRET
  }
  return {
    apiUrl: pick(status, ['API_URL', 'api_url'], 'the API URL'),
    anonKey: pick(status, ['ANON_KEY', 'anon_key', 'PUBLISHABLE_KEY'], 'the anon key'),
    serviceRoleKey: pick(
      status,
      ['SERVICE_ROLE_KEY', 'service_role_key', 'SECRET_KEY'],
      'the service-role key',
    ),
    jwtSecret,
  }
}

// ── Session tokens ───────────────────────────────────────────────────────────
// The local stack deliberately runs with `[auth.email] enable_signup = false`,
// mirroring production's no-self-registration posture — which also disables the
// password grant, so a fixture cannot simply "sign in". Rather than weaken that
// configuration for the convenience of a test, the token is minted directly
// with the stack's own JWT secret.
//
// This is not a shortcut around authentication. GoTrue and PostgREST do not
// care how a token was produced; they verify its signature against the project
// secret and read `sub` and `role` from it. A token minted here is byte-for-
// purpose the same artifact a browser sign-in returns — and it is CHECKED
// against `GET /auth/v1/user` below, so a bad secret or malformed claim set
// fails loudly instead of silently degrading the proof.

function mintAccessToken(cfg: StackConfig, sub: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      aud: 'authenticated',
      role: 'authenticated',
      sub,
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url')
  const signingInput = `${header}.${payload}`
  const signature = createHmac('sha256', cfg.jwtSecret).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

interface Response_ {
  status: number
  body: unknown
  text: string
}

async function request(url: string, init: RequestInit): Promise<Response_> {
  const res = await fetch(url, init)
  const text = await res.text()
  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  }
  return { status: res.status, body, text }
}

/** Waits for PostgREST to accept connections. Readiness only — never a retry of a failed assertion. */
async function waitForRest(cfg: StackConfig): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const res = await fetch(`${cfg.apiUrl}/rest/v1/`, { headers: { apikey: cfg.anonKey } })
      if (res.status < 500) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('PostgREST did not become reachable on the local stack')
}

// ── Fixture identities ───────────────────────────────────────────────────────
// Synthetic, created through GoTrue's admin API so the password grant below
// mints a REAL access token, signed by the local stack, carrying a real `sub`.
// Nothing here resembles a production identity.

interface Fixture {
  key: string
  email: string
  /** NULL username = provisioned but not approved. */
  username: string | null
  role: 'administrator' | 'user'
  principal: string | null
  grants: string[]
  id: string
  accessToken: string
}

const FIXTURES: Array<Omit<Fixture, 'id' | 'accessToken'>> = [
  {
    key: 'admin',
    email: 'ci_embed_admin@test.invalid',
    username: 'ci_embed_admin',
    role: 'administrator',
    principal: null,
    // Deliberately ZERO grants: an administrator is admitted by role, and § 9
    // accepts that they receive the joined relation even though it is empty.
    grants: [],
  },
  {
    key: 'memberTwo',
    email: 'ci_embed_member_two@test.invalid',
    username: 'ci_embed_member_two',
    role: 'user',
    principal: 'jaime',
    grants: ['macro', 'markets'],
  },
  {
    key: 'macroOnly',
    email: 'ci_embed_macro_only@test.invalid',
    username: 'ci_embed_macro_only',
    role: 'user',
    principal: 'andres',
    grants: ['macro'],
  },
  {
    key: 'zero',
    email: 'ci_embed_zero@test.invalid',
    username: 'ci_embed_zero',
    role: 'user',
    principal: 'pablo',
    grants: [],
  },
  {
    key: 'unapproved',
    email: 'ci_embed_unapproved@test.invalid',
    username: null,
    role: 'user',
    principal: 'jaime',
    // Granted everything it could want: approval must remain the outer gate.
    grants: ['macro', 'markets', 'portfolio'],
  },
]

function serviceHeaders(cfg: StackConfig): Record<string, string> {
  return {
    apikey: cfg.serviceRoleKey,
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
}

async function createFixtures(cfg: StackConfig): Promise<Map<string, Fixture>> {
  const out = new Map<string, Fixture>()

  for (const spec of FIXTURES) {
    // 1 · the auth identity
    const created = await request(`${cfg.apiUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: serviceHeaders(cfg),
      body: JSON.stringify({ email: spec.email, email_confirm: true }),
    })
    if (created.status >= 300) {
      throw new Error(`could not create fixture ${spec.key}: HTTP ${created.status} ${created.text}`)
    }
    const createdBody = created.body as { id?: unknown } | null
    const id = createdBody && typeof createdBody.id === 'string' ? createdBody.id : null
    if (id === null) throw new Error(`fixture ${spec.key} was created without an id`)

    // 2 · the profile row (service role — RLS grants no INSERT to anyone else)
    const profile = await request(`${cfg.apiUrl}/rest/v1/user_profiles`, {
      method: 'POST',
      headers: { ...serviceHeaders(cfg), Prefer: 'return=minimal' },
      body: JSON.stringify({
        id,
        username: spec.username,
        email: spec.email,
        display_name: spec.key,
        role: spec.role,
        portfolio_principal: spec.principal,
      }),
    })
    if (profile.status >= 300) {
      throw new Error(`could not seed profile ${spec.key}: HTTP ${profile.status} ${profile.text}`)
    }

    // 3 · the explicit grants
    if (spec.grants.length > 0) {
      const grants = await request(`${cfg.apiUrl}/rest/v1/user_module_grants`, {
        method: 'POST',
        headers: { ...serviceHeaders(cfg), Prefer: 'return=minimal' },
        body: JSON.stringify(spec.grants.map((module_key) => ({ user_id: id, module_key }))),
      })
      if (grants.status >= 300) {
        throw new Error(`could not seed grants for ${spec.key}: HTTP ${grants.status} ${grants.text}`)
      }
    }

    // 4 · a genuine user session token, and PROOF that the stack accepts it.
    //     From here on nothing uses the service-role key.
    const accessToken = mintAccessToken(cfg, id)
    const whoami = await request(`${cfg.apiUrl}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` },
    })
    if (whoami.status !== 200) {
      throw new Error(
        `the stack rejected the session token for ${spec.key}: HTTP ${whoami.status} ${whoami.text}`,
      )
    }
    const whoamiBody = whoami.body as { id?: unknown } | null
    if (!whoamiBody || whoamiBody.id !== id) {
      throw new Error(`the session token for ${spec.key} did not resolve to that identity`)
    }

    out.set(spec.key, { ...spec, id, accessToken })
  }

  return out
}

// ── THE application-facing query ─────────────────────────────────────────────
// Assembled from AUTHORIZATION_STATE_SELECT itself, so this proof can never
// drift away from the select string the application sends. Anon key +
// user bearer: the exact header pair supabase-js uses for a session client.

interface EmbedResult {
  status: number
  rows: AuthorizationRow[] | null
  raw: string
}

async function authorizationQuery(
  cfg: StackConfig,
  accessToken: string,
  targetUserId: string,
): Promise<EmbedResult> {
  const url =
    `${cfg.apiUrl}/rest/v1/user_profiles` +
    `?select=${encodeURIComponent(AUTHORIZATION_STATE_SELECT)}` +
    `&id=eq.${encodeURIComponent(targetUserId)}`

  const res = await request(url, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` },
  })
  const rows = Array.isArray(res.body) ? (res.body as AuthorizationRow[]) : null
  return { status: res.status, rows, raw: res.text }
}

/** `maybeSingle()` semantics: the row, or null when the filter matched nothing. */
function singleRow(result: EmbedResult): AuthorizationRow | null {
  if (result.rows === null || result.rows.length === 0) return null
  return result.rows[0]
}

function grantKeysOf(row: AuthorizationRow | null): string[] {
  if (row === null) return []
  const embedded = row.user_module_grants
  if (!Array.isArray(embedded)) return []
  return embedded
    .map((g) => (g && typeof g === 'object' ? (g as { module_key?: unknown }).module_key : null))
    .filter((k): k is string => typeof k === 'string')
    .sort()
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cfg = readStack()
  console.log(`PostgREST embed proof against the isolated stack at ${cfg.apiUrl}`)
  console.log(`select: ${AUTHORIZATION_STATE_SELECT}\n`)

  await waitForRest(cfg)
  const users = await createFixtures(cfg)

  const fixture = (key: string): Fixture => {
    const found = users.get(key)
    if (found === undefined) throw new Error(`fixture ${key} was not created`)
    return found
  }

  const admin = fixture('admin')
  const memberTwo = fixture('memberTwo')
  const macroOnly = fixture('macroOnly')
  const zero = fixture('zero')
  const unapproved = fixture('unapproved')

  // ══════════════════════════════════════════════════════════════════════════
  section('0 · The relationship resolves at all')
  // ══════════════════════════════════════════════════════════════════════════
  // If PostgREST cannot see the FK it answers 400/PGRST200 here. That is the
  // BLOCKED condition for this stage: it is never softened into a fallback.

  const probe = await authorizationQuery(cfg, memberTwo.accessToken, memberTwo.id)
  check(
    'PostgREST accepts the embedded select (no PGRST200 relationship error)',
    probe.status === 200,
    `HTTP ${probe.status} ${probe.raw.slice(0, 400)}`,
  )
  check(
    'the response body is an array of rows',
    probe.rows !== null,
    `body was ${probe.raw.slice(0, 200)}`,
  )
  if (probe.status !== 200) {
    console.log('\nThe embedded relationship did not resolve. Nothing below can be meaningful.')
    report()
    return
  }

  // ══════════════════════════════════════════════════════════════════════════
  section('A · Approved administrator')
  // ══════════════════════════════════════════════════════════════════════════

  const adminRes = await authorizationQuery(cfg, admin.accessToken, admin.id)
  const adminRow = singleRow(adminRes)
  check('the administrator query succeeds', adminRes.status === 200)
  check('it returns the administrator profile', adminRow !== null)
  equal('the profile is the caller own row', adminRow?.id, admin.id)
  equal('the role is administrator', adminRow?.role, 'administrator')
  check(
    'the embedded relation is present even with zero grants',
    Array.isArray(adminRow?.user_module_grants),
    `got ${JSON.stringify(adminRow?.user_module_grants)}`,
  )
  equal('an administrator may hold no grant rows at all', grantKeysOf(adminRow), [])

  // ══════════════════════════════════════════════════════════════════════════
  section('B · Approved member with grants')
  // ══════════════════════════════════════════════════════════════════════════

  const memberRes = await authorizationQuery(cfg, memberTwo.accessToken, memberTwo.id)
  const memberRow = singleRow(memberRes)
  check('the member query succeeds', memberRes.status === 200)
  check('it returns the member profile', memberRow !== null)
  equal('the exact module keys are returned', grantKeysOf(memberRow), ['macro', 'markets'])
  equal('the approval marker is readable', memberRow?.username, 'ci_embed_member_two')

  // Only that user's own grant rows — the embed is filtered by the CHILD
  // policy, not merely by the parent. Total grants in the database exceed two.
  const totalSeeded = FIXTURES.reduce((n, f) => n + f.grants.length, 0)
  check(
    'the database holds more grant rows than this member owns',
    totalSeeded > 2,
    `seeded ${totalSeeded}`,
  )
  equal('the embed returns only the caller own grants', grantKeysOf(memberRow).length, 2)

  // ══════════════════════════════════════════════════════════════════════════
  section('C · Approved member with zero grants')
  // ══════════════════════════════════════════════════════════════════════════
  // The load-bearing distinction: an EMPTY ARRAY is an answer. A missing
  // relation is a failure. They must not look alike on the wire.

  const zeroRes = await authorizationQuery(cfg, zero.accessToken, zero.id)
  const zeroRow = singleRow(zeroRes)
  check('the zero-grant query succeeds (not an error)', zeroRes.status === 200)
  check('it returns the profile', zeroRow !== null)
  check(
    'the embedded relation is an EMPTY ARRAY, not absent and not an error',
    Array.isArray(zeroRow?.user_module_grants) &&
      (zeroRow?.user_module_grants as unknown[]).length === 0,
    `got ${JSON.stringify(zeroRow?.user_module_grants)}`,
  )

  // ══════════════════════════════════════════════════════════════════════════
  section('D · Unapproved profile')
  // ══════════════════════════════════════════════════════════════════════════

  const unapprovedRes = await authorizationQuery(cfg, unapproved.accessToken, unapproved.id)
  const unapprovedRow = singleRow(unapprovedRes)
  check('the unapproved query is parseable, not an error', unapprovedRes.status === 200)
  check('a row is returned', unapprovedRow !== null)
  equal('the approval marker is null', unapprovedRow?.username, null)
  check(
    'grants exist for this account, yet approval is the outer gate',
    grantKeysOf(unapprovedRow).length === 3,
    `got ${JSON.stringify(grantKeysOf(unapprovedRow))}`,
  )

  // ══════════════════════════════════════════════════════════════════════════
  section('E · A different user leaks nothing')
  // ══════════════════════════════════════════════════════════════════════════

  const cross = await authorizationQuery(cfg, macroOnly.accessToken, memberTwo.id)
  check('querying another user id is accepted but filtered', cross.status === 200)
  equal('no other profile is returned', cross.rows?.length, 0)

  // …and unfiltered, the same route still returns only the caller's own row.
  const unfilteredUrl =
    `${cfg.apiUrl}/rest/v1/user_profiles?select=${encodeURIComponent(AUTHORIZATION_STATE_SELECT)}`
  const unfiltered = await request(unfilteredUrl, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${macroOnly.accessToken}` },
  })
  const unfilteredRows = Array.isArray(unfiltered.body)
    ? (unfiltered.body as AuthorizationRow[])
    : []
  equal('an unfiltered read returns exactly one row', unfilteredRows.length, 1)
  equal('and it is the caller own row', unfilteredRows[0]?.id, macroOnly.id)
  equal(
    'no other account grants are reachable through the embed',
    grantKeysOf(unfilteredRows[0] ?? null),
    ['macro'],
  )

  // The anon key ALONE — no user token — must reach nothing. This is the
  // exposure shape the profile hardening closed, re-proven through the embed.
  const anonOnly = await request(unfilteredUrl, { headers: { apikey: cfg.anonKey } })
  const anonRows = Array.isArray(anonOnly.body) ? (anonOnly.body as unknown[]) : null
  check(
    'the anon key alone reads no profile through the embedded route',
    anonOnly.status >= 400 || (anonRows !== null && anonRows.length === 0),
    `HTTP ${anonOnly.status} ${anonOnly.text.slice(0, 200)}`,
  )

  // ══════════════════════════════════════════════════════════════════════════
  section('§ 18 · The REAL response shapes drive the application decision')
  // ══════════════════════════════════════════════════════════════════════════
  // Everything below consumes the bodies captured above — no hand-written
  // fixture. If PostgREST ever renamed the embedded key, or returned an object
  // instead of an array, these fail even though the raw assertions passed.

  const lookupOf =
    (row: AuthorizationRow | null) =>
    async (userId: string): Promise<AuthorizationStateResult> =>
      parseAuthorizationRow(userId, row)

  const verified = (id: string) => async () => ({ user: { id } })

  // admin -> platform access
  const adminState = parseAuthorizationRow(admin.id, adminRow)
  check('the real admin row parses as an answer', adminState.ok === true)
  if (adminState.ok && adminState.state) {
    const access = moduleAccessOf(adminState.state)
    check('the parsed admin is an administrator', access.isAdministrator === true)
  }
  const adminHome = await decideRequestAccess('/', verified(admin.id), lookupOf(adminRow))
  equal('admin reaches Overview', adminHome.outcome, 'allow')
  const adminMarkets = await decideRequestAccess('/stocks', verified(admin.id), lookupOf(adminRow))
  equal('admin reaches Markets with no grant rows at all', adminMarkets.outcome, 'allow')
  const adminUsers = await decideRequestAccess(
    '/settings/users',
    verified(admin.id),
    lookupOf(adminRow),
  )
  equal('admin reaches the Users console', adminUsers.outcome, 'allow')

  // member macro-only -> macro yes, Markets no
  const macroRow = singleRow(await authorizationQuery(cfg, macroOnly.accessToken, macroOnly.id))
  equal('the real macro-only row carries exactly one grant', grantKeysOf(macroRow), ['macro'])

  const macroHome = await decideRequestAccess('/', verified(macroOnly.id), lookupOf(macroRow))
  equal('the macro-only member reaches Overview', macroHome.outcome, 'allow')

  const macroAllowed = await decideRequestAccess('/macro', verified(macroOnly.id), lookupOf(macroRow))
  equal('the macro-only member reaches Macro', macroAllowed.outcome, 'allow')
  const macroApi = await decideRequestAccess(
    '/api/macro',
    verified(macroOnly.id),
    lookupOf(macroRow),
  )
  equal('the macro-only member reaches the Macro API', macroApi.outcome, 'allow')

  const marketsDenied = await decideRequestAccess(
    '/stocks',
    verified(macroOnly.id),
    lookupOf(macroRow),
  )
  equal('Markets is denied for the macro-only member', marketsDenied.outcome, 'deny')
  if (marketsDenied.outcome === 'deny') {
    equal('and the reason is module_not_granted', marketsDenied.reason, 'module_not_granted')
    equal('with a 403, not a 503', marketsDenied.status, 403)
  }
  const marketsApiDenied = await decideRequestAccess(
    '/api/market/stocks',
    verified(macroOnly.id),
    lookupOf(macroRow),
  )
  equal('the Markets API is denied too', marketsApiDenied.outcome, 'deny')
  if (marketsApiDenied.outcome === 'deny') {
    check('and it is answered as JSON, never a login redirect', marketsApiDenied.json === true)
  }

  // member zero -> no_platform_access
  const zeroDecision = await decideRequestAccess('/', verified(zero.id), lookupOf(zeroRow))
  equal('the zero-grant member is refused the platform', zeroDecision.outcome, 'deny')
  if (zeroDecision.outcome === 'deny') {
    equal('with no_platform_access', zeroDecision.reason, 'no_platform_access')
    equal('at 403', zeroDecision.status, 403)
  }

  // unapproved -> not_approved, despite holding three grants
  const unapprovedDecision = await decideRequestAccess(
    '/',
    verified(unapproved.id),
    lookupOf(unapprovedRow),
  )
  equal('the unapproved account is refused', unapprovedDecision.outcome, 'deny')
  if (unapprovedDecision.outcome === 'deny') {
    equal('as not_approved, not as a module problem', unapprovedDecision.reason, 'not_approved')
  }

  // unreadable relation -> module_access_unavailable, NOT no_platform_access.
  // Modelled on the ACTUAL failure shape: PostgREST answers an error body, not
  // an array, so the caller reports `{ ok: false }`.
  const failingLookup = async (): Promise<AuthorizationStateResult> => ({ ok: false })
  const unreadable = await decideRequestAccess('/', verified(memberTwo.id), failingLookup)
  equal('an unreadable relation denies', unreadable.outcome, 'deny')
  if (unreadable.outcome === 'deny') {
    equal('as access_unavailable', unreadable.reason, 'access_unavailable')
    equal('at 503 — a failure, never a 403 blaming the account', unreadable.status, 503)
  }

  // And the same distinction at the parser: an error body is NOT an empty set.
  const errorBody = JSON.parse(
    '{"code":"PGRST200","details":null,"hint":null,"message":"Could not find a relationship"}',
  ) as AuthorizationRow
  const parsedError = parseAuthorizationRow(memberTwo.id, errorBody)
  equal('a PostgREST error body parses as a FAILURE', parsedError.ok, false)

  report()
}

function report(): void {
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`PostgREST embed proof: ${passed} passed, ${failures.length} failed`)
  if (failures.length > 0) {
    for (const f of failures) console.log(`  · ${f}`)
    process.exitCode = 1
    return
  }
  console.log('The embedded authorization query is valid over the real REST contract.')
}

main().catch((error: unknown) => {
  console.error('\nPostgREST embed proof aborted:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
