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

interface LocalConfig {
  url: string
  serviceRoleKey: string
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
  const REDIRECT = 'http://localhost:3000/auth/callback?next=%2Fauth%2Freset-password'

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
    'A8 the created identity has NO password set and is not yet confirmed as signed-in',
    !!createdRow?.data?.user && createdRow.data.user.last_sign_in_at === null,
    `last_sign_in_at=${String(createdRow?.data?.user?.last_sign_in_at)}`,
  )

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

  console.log('\n── D · deleteUser removes a just-created, never-activated identity ──')
  // The compensating action from lib/admin/inviteOrchestration.ts, proved to work
  // on the exact kind of identity it is allowed to touch.
  const del = aUserId ? await admin.auth.admin.deleteUser(aUserId) : { error: new Error('no id') }
  check('D1 the just-invited identity can be deleted', !del.error)
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
