// R13.6F § 28 — EXECUTABLE proof of the installed Auth Admin invite API, run
// against an ISOLATED, DISPOSABLE Supabase stack.
//
// WHY THIS EXISTS
// ───────────────
// The invitation flow is built on ONE call:
//
//   supabase.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } })
//
// Reading the installed package proves the CLIENT half exactly — it POSTs to
// `${authUrl}/admin/generate_link` with `redirect_to` as a query parameter, and
// reshapes the response into `{ properties: { action_link, email_otp,
// hashed_token, redirect_to, verification_type }, user }`. That is a fact about
// the code on disk, not a recollection.
//
// It proves NOTHING about the SERVER half, which is where every question that
// actually matters lives:
//
//   · does it CREATE the `auth.users` row, or require one to exist?
//   · what identifier comes back, and is it the id the profile must key on?
//   · what happens on a SECOND invite for the same address — a duplicate
//     account, an error, or the same identity with a fresh link?
//   · what happens for an address that is already ACTIVATED?
//   · is `redirectTo` honoured, or silently replaced by the site URL?
//
// The application's partial-failure model depends on those answers: the
// compensating delete in `lib/admin/inviteOrchestration.ts` only runs when this
// request created the identity, and "resend" is only safe if a second call does
// not mint a second account. Building on an assumption would be exactly the
// "untested assumption" § 10 forbids.
//
// HERMETIC. Synthetic addresses at `@invite-proof.invalid` only, inside the
// throwaway local stack. No production project, no real person's address, and no
// email is ever delivered — `generate_link` returns a link, it does not send one
// (`inviteUserByEmail` is the endpoint that sends, and this application
// deliberately does not use it).
//
// The action links this prints are for a database that is destroyed when the job
// ends; even so, nothing prints a full link — only its SHAPE.

import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { buildInviteAcceptUrl } from '../../src/lib/admin/inviteLink.ts'

interface LocalConfig {
  url: string
  serviceRoleKey: string
  anonKey: string
}

function pick(obj: Record<string, unknown>, keys: string[], label: string): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  throw new Error(`Could not read ${label} from \`supabase status -o json\`. Tried ${keys.join(', ')}.`)
}

function readLocalConfig(): LocalConfig {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('`supabase status -o json` produced no JSON object')
  const status = JSON.parse(raw.slice(start)) as Record<string, unknown>
  return {
    url: pick(status, ['API_URL', 'api_url'], 'the API URL'),
    serviceRoleKey: pick(
      status,
      ['SERVICE_ROLE_KEY', 'service_role_key', 'SECRET_KEY'],
      'the service-role key',
    ),
    // Redeeming a one-time token is an ANONYMOUS action — it is what the invited
    // person's own browser does. Using the service-role key here would prove
    // nothing about whether a real recipient can accept an invitation.
    anonKey: pick(status, ['ANON_KEY', 'anon_key', 'PUBLISHABLE_KEY'], 'the anon key'),
  }
}

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++
    console.log(`  ok   ${label}${detail ? `  ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail ? `  ${detail}` : ''}`)
  }
}

/** Describes a link without disclosing it. */
function shapeOf(link: string): string {
  try {
    const u = new URL(link)
    const params = [...u.searchParams.keys()].sort()
    return `${u.origin}${u.pathname} params=[${params.join(',')}]`
  } catch {
    return '<unparseable>'
  }
}

async function main(): Promise<void> {
  const cfg = readLocalConfig()
  const admin = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const stamp = Date.now()
  const fresh = `invite-proof-${stamp}@invite-proof.invalid`
  const activated = `invite-proof-active-${stamp}@invite-proof.invalid`
  // Must match the local stack's own host and be allow-listed in
  // supabase/config.toml — see the note there. The shape mirrors what
  // buildInviteRedirectUrl() produces from the live request origin.
  const REDIRECT = 'http://127.0.0.1:3000/auth/callback?next=%2Fauth%2Freset-password'
  const NOT_ALLOWLISTED = 'http://evil.example.com/steal'

  console.log('\n── A · generateLink({ type: "invite" }) for a BRAND NEW address ──')
  const a = await admin.auth.admin.generateLink({
    type: 'invite',
    email: fresh,
    options: { redirectTo: REDIRECT },
  })
  check('A1 the call succeeds', !a.error, a.error ? String((a.error as { message?: string }).message) : '')
  const aUserId = a.data?.user?.id
  const aLink = a.data?.properties?.action_link
  check('A2 it returns a user id', typeof aUserId === 'string' && aUserId.length > 0, `id=${aUserId ? 'present' : 'MISSING'}`)
  check('A3 it returns an action_link', typeof aLink === 'string' && aLink.length > 0, aLink ? shapeOf(aLink) : 'MISSING')
  check(
    'A4 it returns the documented properties',
    !!a.data?.properties &&
      ['action_link', 'email_otp', 'hashed_token', 'redirect_to', 'verification_type'].every(
        (k) => k in (a.data!.properties as Record<string, unknown>),
      ),
  )
  check(
    'A5 verification_type is "invite"',
    (a.data?.properties as { verification_type?: string } | null)?.verification_type === 'invite',
    String((a.data?.properties as { verification_type?: string } | null)?.verification_type),
  )
  check(
    'A6 redirect_to is HONOURED, not replaced by the site URL',
    (a.data?.properties as { redirect_to?: string } | null)?.redirect_to === REDIRECT,
    String((a.data?.properties as { redirect_to?: string } | null)?.redirect_to),
  )

  // THE question the compensating delete depends on.
  const createdRow = aUserId ? await admin.auth.admin.getUserById(aUserId) : null
  check(
    'A7 generateLink CREATED the auth.users row',
    !!createdRow && !createdRow.error && createdRow.data?.user?.id === aUserId,
  )
  check(
    // GoTrue OMITS the field for an identity that has never signed in rather
    // than sending an explicit null, so both spellings mean "never signed in".
    'A8 the created identity has never signed in',
    !!createdRow?.data?.user &&
      (createdRow.data.user.last_sign_in_at === null ||
        createdRow.data.user.last_sign_in_at === undefined),
    `last_sign_in_at=${String(createdRow?.data?.user?.last_sign_in_at)}`,
  )

  // A9 — the hazard behind A6, proven rather than described.
  //
  // GoTrue does not reject a redirect_to it does not recognise: it SILENTLY
  // substitutes site_url and returns success. An invited user would then land on
  // the site root holding a session, never reaching /auth/callback, so the
  // password would never be set and nmi_activate_current_user() would never run
  // — an invitation that appears to work and quietly does not. The deployment
  // requirement this creates is recorded in supabase/config.toml.
  const probe = await admin.auth.admin.generateLink({
    type: 'invite',
    email: `invite-probe-${stamp}@invite-proof.invalid`,
    options: { redirectTo: NOT_ALLOWLISTED },
  })
  const probeRedirect = (probe.data?.properties as { redirect_to?: string } | null)?.redirect_to
  check(
    'A9 a NON-allow-listed redirect is silently replaced, never honoured',
    !probe.error && typeof probeRedirect === 'string' && !probeRedirect.startsWith('http://evil.'),
    `redirect_to=${String(probeRedirect)}`,
  )
  if (probe.data?.user?.id) await admin.auth.admin.deleteUser(probe.data.user.id)

  console.log('\n── B · a SECOND invite for the SAME address (the resend path) ──')
  const b = await admin.auth.admin.generateLink({
    type: 'invite',
    email: fresh,
    options: { redirectTo: REDIRECT },
  })
  check('B1 the second call succeeds', !b.error, b.error ? String((b.error as { message?: string }).message) : '')
  check(
    'B2 it returns the SAME user id — no duplicate account is created',
    b.data?.user?.id === aUserId,
    `same=${b.data?.user?.id === aUserId}`,
  )
  const bLink = b.data?.properties?.action_link
  check('B3 it returns a FRESH action link', typeof bLink === 'string' && bLink !== aLink)

  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const matches = (listed?.users ?? []).filter(
    (u) => (u.email ?? '').toLowerCase() === fresh.toLowerCase(),
  )
  check('B4 exactly ONE auth identity exists for that address', matches.length === 1, `count=${matches.length}`)

  // ── E · REDEEMING the link: does it reach the callback in a form the
  //        application can actually consume? (R13.6F § 19)
  //
  // Knowing the link POINTS at /auth/callback is not enough. The callback
  // establishes the session with exchangeCodeForSession(code), reading `code`
  // from the QUERY STRING, and that session is what makes
  // nmi_activate_current_user() possible. If GoTrue instead returns tokens in the
  // URL FRAGMENT (the implicit flow), the fragment never reaches the server, no
  // session is created there, and activation silently never happens — an
  // invitation that looks like it worked. So the link is actually followed and
  // the redirect it produces is inspected.
  console.log('\n── E · following the invite link to see what the callback receives ──')
  // E1-E2 record WHY the application does not email GoTrue's own action_link.
  const redeemable = typeof bLink === 'string' ? bLink : null
  const redeem = redeemable ? await fetch(redeemable, { redirect: 'manual' }) : null
  const location = redeem?.headers.get('location') ?? ''
  const hasFragmentTokens = /#.*access_token=/.test(location)
  check(
    'E1 GoTrue action_link redirects (303) rather than rendering',
    !!redeem && redeem.status >= 300 && redeem.status < 400,
    `status=${redeem ? redeem.status : 'no link to follow'}`,
  )
  check(
    // The finding this whole path exists to encode: the session comes back in the
    // FRAGMENT, which a server route can never read. If this ever stops being
    // true, the app-hosted link below is merely redundant rather than required —
    // but it must be OBSERVED, not assumed in either direction.
    'E2 action_link returns the session in the URL FRAGMENT — unreadable by a server',
    hasFragmentTokens,
    hasFragmentTokens ? 'implicit fragment, as expected' : `no fragment tokens: ${shapeOf(location)}`,
  )

  // E3-E6 prove the link the application ACTUALLY emails.
  //
  // A SEPARATE invitation, deliberately. The token above has just been spent by
  // following it in E1 — these links are single-use, which is itself part of the
  // security model — so reusing it would prove only that a consumed token is
  // rejected. This mints an unconsumed one for the redemption test.
  const redeemEmail = `invite-redeem-${stamp}@invite-proof.invalid`
  const r = await admin.auth.admin.generateLink({
    type: 'invite',
    email: redeemEmail,
    options: { redirectTo: REDIRECT },
  })
  const redeemUserId = r.data?.user?.id
  const acceptLink = buildInviteAcceptUrl('http://127.0.0.1:3000', String(r.data?.properties?.hashed_token))
  const acceptUrl = new URL(acceptLink)
  check(
    'E3 the emailed link is app-hosted and carries token_hash + type',
    acceptUrl.pathname === '/auth/callback' &&
      acceptUrl.searchParams.get('type') === 'invite' &&
      (acceptUrl.searchParams.get('token_hash') ?? '').length > 0,
    `${acceptUrl.pathname} params=[${[...acceptUrl.searchParams.keys()].sort().join(',')}]`,
  )
  check(
    'E4 it lands the user on the password page, not an invented welcome screen',
    acceptUrl.searchParams.get('next') === '/auth/reset-password',
    String(acceptUrl.searchParams.get('next')),
  )

  // THE load-bearing one: the token in that link really does mint a session
  // server-side, which is what makes nmi_activate_current_user() reachable.
  const otp = await createClient(cfg.url, cfg.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.verifyOtp({
    token_hash: String(r.data?.properties?.hashed_token),
    type: 'invite',
  })
  check(
    'E5 verifyOtp(token_hash, invite) mints a real session SERVER-SIDE',
    !otp.error && !!otp.data?.session?.access_token,
    otp.error ? String((otp.error as { message?: string }).message) : 'session established',
  )
  check(
    'E6 and it is the invited identity, not some other account',
    typeof redeemUserId === 'string' && otp.data?.user?.id === redeemUserId,
    `same=${otp.data?.user?.id === redeemUserId}`,
  )
  // E7 — single use is part of the security model, so it is asserted rather than
  // assumed: the same token must not mint a second session.
  const replay = await createClient(cfg.url, cfg.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.verifyOtp({
    token_hash: String(r.data?.properties?.hashed_token),
    type: 'invite',
  })
  check(
    'E7 the same token cannot be redeemed twice',
    !!replay.error && !replay.data?.session,
    replay.error ? 'replay refused' : 'REPLAY SUCCEEDED',
  )
  if (redeemUserId) await admin.auth.admin.deleteUser(redeemUserId)

  console.log('\n── C · invite for an ALREADY-ACTIVATED (password-holding) address ──')
  const created = await admin.auth.admin.createUser({
    email: activated,
    password: `proof-only-${stamp}-not-a-real-secret`,
    email_confirm: true,
  })
  check('C1 fixture identity created', !created.error && !!created.data?.user?.id)

  const c = await admin.auth.admin.generateLink({
    type: 'invite',
    email: activated,
    options: { redirectTo: REDIRECT },
  })
  // Either outcome is acceptable to the application — what matters is that it is
  // OBSERVED rather than assumed, and that the route layer refuses this case on
  // its own (POST /invitation returns 409 already_activated from the directory
  // status, before any Auth call is made).
  if (c.error) {
    check('C2 OBSERVED: an existing/confirmed identity is REFUSED by generateLink', true,
      `error=${String((c.error as { message?: string }).message).slice(0, 80)}`)
  } else {
    check('C2 OBSERVED: generateLink SUCCEEDS for an existing identity', true,
      `sameId=${c.data?.user?.id === created.data?.user?.id}`)
  }
  const { data: listed2 } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const matches2 = (listed2?.users ?? []).filter(
    (u) => (u.email ?? '').toLowerCase() === activated.toLowerCase(),
  )
  check('C3 STILL exactly one identity for that address — no duplicate', matches2.length === 1,
    `count=${matches2.length}`)

  console.log('\n── D · deleteUser removes an identity this request created ──')
  // The compensating action from lib/admin/inviteOrchestration.ts, proved against
  // a real Auth identity. NOTE what this does and does not establish: it shows the
  // DELETE works. WHEN it is allowed to run — only for an identity this request
  // provably created, never for a pre-existing or established one — is a decision
  // made in compensate(), which is pure logic and is proven by the TypeScript
  // suite (a deliberate break that deletes a pre-existing identity is caught
  // there). Auth cannot answer a provenance question; it is not asked to.
  const del = aUserId ? await admin.auth.admin.deleteUser(aUserId) : { error: new Error('no id') }
  check('D1 the invited identity can be deleted', !del.error)
  const gone = aUserId ? await admin.auth.admin.getUserById(aUserId) : null
  check('D2 it is really gone', !!gone && (!!gone.error || !gone.data?.user))

  // Clean-up: leave the disposable stack tidy even though it is destroyed anyway.
  if (created.data?.user?.id) await admin.auth.admin.deleteUser(created.data.user.id)

  console.log('\n' + '═'.repeat(72))
  console.log(`Auth invite proof: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log('The invitation flow rests on this contract — a failure here is a release blocker.')
    process.exitCode = 1
  } else {
    console.log('generateLink({type:"invite"}) behaves as the implementation assumes.')
  }
}

await main()
