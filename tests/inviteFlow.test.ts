// R13.6F — THE INVITATION FLOW: link, email, orchestration, partial failure.
//
// FULLY BEHAVIOURAL for the orchestration. `runInvite`/`runResend` take every side
// effect as an injected port, so the whole of § 13 — Auth failure, database
// failure, email failure, retry, duplicate username, duplicate email, pre-existing
// identity, orphan prevention — executes here against in-memory fakes. No network,
// no Supabase, no Resend, and NO EMAIL IS EVER SENT.
//
// The action link is treated as a credential throughout: several tests below exist
// only to prove it does not escape into a response, a log line or an error string.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  runInvite,
  runResend,
  type InvitePorts,
  type InviteIdentity,
} from '../src/lib/admin/inviteOrchestration.ts'
import {
  renderInviteEmail,
  sendInviteEmail,
  describeSendFailure,
  INVITE_SUBJECT,
  type InviteEmailTransport,
} from '../src/lib/admin/inviteEmail.ts'
import {
  buildInviteRedirectUrl,
  isUsableOrigin,
  INVITE_LANDING_PATH,
  AUTH_CALLBACK_PATH,
} from '../src/lib/admin/inviteLink.ts'
import { rpcErrorCode, classifyRpcError, RPC_ERROR_STATUS } from '../src/lib/admin/adminRpc.ts'
import type { AccountShape } from '../src/lib/admin/userProvisioning.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const IDENTITY: InviteIdentity = {
  username: 'newmember',
  email: 'new.member@example.invalid',
  displayName: 'New Member',
}
const SHAPE: AccountShape = { role: 'user', principal: 'jaime', modules: ['markets', 'portfolio'] }
const LINK = 'https://preview.example.invalid/auth/callback?token=SECRET-ONE-TIME-TOKEN'
const REDIRECT = 'https://preview.example.invalid/auth/callback?next=%2Fauth%2Freset-password'

interface Trace {
  generated: number
  provisioned: number
  deleted: string[]
  profileChecked: string[]
  sent: number
}

function ports(over: Partial<InvitePorts> = {}, trace?: Trace): InvitePorts {
  const t = trace ?? { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
  return {
    async findAuthUserByEmail() {
      return null
    },
    async generateInviteLink() {
      t.generated++
      return { ok: true, userId: 'new-user-id', actionLink: LINK }
    },
    async provisionInvite() {
      t.provisioned++
      return { ok: true }
    },
    async profileExists(id) {
      t.profileChecked.push(id)
      return false
    },
    async deleteAuthUser(id) {
      t.deleted.push(id)
      return true
    },
    async sendInvite() {
      t.sent++
      return { sent: true, configured: true, failure: null }
    },
    ...over,
  }
}

const invite = (p: InvitePorts) =>
  runInvite({ identity: IDENTITY, shape: SHAPE, redirectTo: REDIRECT, ports: p })

describe('R13.6F § 11 — the invitation destination', () => {
  it('is built from the REQUEST origin, so a Preview invite lands on that Preview', () => {
    assert.equal(
      buildInviteRedirectUrl('https://preview-abc.vercel.app'),
      'https://preview-abc.vercel.app/auth/callback?next=%2Fauth%2Freset-password',
    )
    assert.equal(
      buildInviteRedirectUrl('https://nevada-market-intelligence.vercel.app'),
      'https://nevada-market-intelligence.vercel.app/auth/callback?next=%2Fauth%2Freset-password',
    )
  })

  it('reuses the EXISTING recovery surface rather than a second auth system', () => {
    assert.equal(INVITE_LANDING_PATH, '/auth/reset-password')
    assert.equal(AUTH_CALLBACK_PATH, '/auth/callback')
    const policy = code(read('src/lib/auth/accessPolicy.ts'))
    assert.match(policy, /'\/auth\/reset-password'/, 'the landing page is already public')
    assert.match(policy, /'\/auth\/callback'/, 'the callback is already a session-mint path')
  })

  it('tolerates a trailing slash', () => {
    assert.equal(
      buildInviteRedirectUrl('https://x.invalid/'),
      'https://x.invalid/auth/callback?next=%2Fauth%2Freset-password',
    )
  })

  it('refuses anything that is not a bare http(s) origin', () => {
    for (const bad of [
      '',
      'not-a-url',
      'ftp://x.invalid',
      'javascript:alert(1)',
      'https://x.invalid/some/path',
      'https://x.invalid?q=1',
      'https://x.invalid#f',
      null,
      undefined,
      42,
    ]) {
      assert.equal(isUsableOrigin(bad), false, String(bad))
    }
    assert.throws(() => buildInviteRedirectUrl('https://x.invalid/path'), /invalid_origin/)
  })

  it('the `next` is a fixed internal constant — no caller-supplied redirect', () => {
    const src = code(read('src/lib/admin/inviteLink.ts'))
    // The only thing interpolated into the URL is the origin.
    const fn = src.match(/export function buildInviteRedirectUrl[\s\S]*?\n}/)?.[0]
    assert.match(fn!, /INVITE_LANDING_PATH/)
    assert.doesNotMatch(fn!, /next\s*\??\s*:/, 'the function takes no next parameter')
  })

  it('no deployment hostname is hard-coded anywhere in the invite path', () => {
    for (const f of [
      'src/lib/admin/inviteLink.ts',
      'src/lib/admin/inviteRuntime.ts',
      'src/lib/admin/inviteOrchestration.ts',
      'src/app/api/admin/users/route.ts',
    ]) {
      assert.doesNotMatch(code(read(f)), /nevada-market-intelligence|vercel\.app/i, f)
      assert.doesNotMatch(code(read(f)), /NEXT_PUBLIC_SITE_URL/, f)
    }
  })
})

describe('R13.6F § 13 — the happy path', () => {
  it('creates the identity, provisions, and reports delivery', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    const r = await invite(ports({}, t))
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.userId, 'new-user-id')
    assert.equal(r.ok && r.emailSent, true)
    assert.equal(r.ok && r.emailFailure, null)
    assert.deepEqual(t.deleted, [], 'nothing is compensated on success')
    assert.equal(t.generated, 1)
    assert.equal(t.provisioned, 1)
    assert.equal(t.sent, 1)
  })
})

describe('R13.6F § 13 — Auth failure', () => {
  it('a failed link mint provisions nothing and deletes nothing', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    const r = await invite(
      ports({ async generateInviteLink() { return { ok: false, code: 'invite_link_failed' } } }, t),
    )
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.code, 'invite_link_failed')
    assert.equal(!r.ok && r.authIdentity, 'none')
    assert.equal(t.provisioned, 0)
    assert.deepEqual(t.deleted, [])
  })

  it('an incomplete Auth response is a failure, not a half-success', async () => {
    const r = await invite(
      ports({ async generateInviteLink() { return { ok: false, code: 'invite_link_incomplete' } } }),
    )
    assert.equal(r.ok, false)
  })

  it('an UNREADABLE existing-identity lookup aborts before anything is created', async () => {
    // Proceeding would mean the compensating delete could not know whether this
    // request owned the identity — the one mistake that could destroy history.
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    const r = await invite(ports({ async findAuthUserByEmail() { return 'error' } }, t))
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.code, 'auth_lookup_failed')
    assert.equal(t.generated, 0, 'no identity was minted')
  })
})

describe('R13.6F § 13 — database failure and orphan prevention', () => {
  it('removes a just-created identity when provisioning fails', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    const r = await invite(
      ports(
        { async provisionInvite() { return { ok: false, code: 'write_failed', status: 500 } } },
        t,
      ),
    )
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.authIdentity, 'removed')
    assert.deepEqual(t.deleted, ['new-user-id'])
    assert.equal(t.sent, 0, 'no email is sent for an account that does not exist')
  })

  it('NEVER deletes a pre-existing identity', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    const r = await invite(
      ports(
        {
          async findAuthUserByEmail() { return { id: 'established-user' } },
          async provisionInvite() { return { ok: false, code: 'already_activated', status: 409 } },
        },
        t,
      ),
    )
    assert.equal(!r.ok && r.authIdentity, 'preserved')
    assert.deepEqual(t.deleted, [], 'an established account is never deleted as compensation')
  })

  it('does NOT delete when a profile turns out to exist', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    const r = await invite(
      ports(
        {
          async provisionInvite() { return { ok: false, code: 'write_failed', status: 500 } },
          async profileExists() { return true },
        },
        t,
      ),
    )
    assert.equal(!r.ok && r.authIdentity, 'orphaned')
    assert.deepEqual(t.deleted, [])
  })

  it('does NOT delete when the profile check itself fails', async () => {
    // "Cannot confirm" must mean "do not delete". An un-deleted orphan is a
    // nuisance; a deleted account with its audit trail is unrecoverable.
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    const r = await invite(
      ports(
        {
          async provisionInvite() { return { ok: false, code: 'write_failed', status: 500 } },
          async profileExists() { return 'error' },
        },
        t,
      ),
    )
    assert.equal(!r.ok && r.authIdentity, 'orphaned')
    assert.deepEqual(t.deleted, [])
  })

  it('reports "orphaned" when the delete itself fails', async () => {
    const r = await invite(
      ports({
        async provisionInvite() { return { ok: false, code: 'write_failed', status: 500 } },
        async deleteAuthUser() { return false },
      }),
    )
    assert.equal(!r.ok && r.authIdentity, 'orphaned')
  })

  it('a failure never broadens access — no email, no session, no grants', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    await invite(
      ports({ async provisionInvite() { return { ok: false, code: 'username_taken', status: 409 } } }, t),
    )
    assert.equal(t.sent, 0)
  })
})

describe('R13.6F § 13 — duplicate and retry semantics', () => {
  it('surfaces a username collision as a clean conflict', async () => {
    const r = await invite(
      ports({ async provisionInvite() { return { ok: false, code: 'username_taken', status: 409 } } }),
    )
    assert.equal(!r.ok && r.code, 'username_taken')
    assert.equal(!r.ok && r.status, 409)
  })

  it('refuses to re-invite an ALREADY-ACTIVATED account', async () => {
    const r = await invite(
      ports({
        async findAuthUserByEmail() { return { id: 'live-user' } },
        async provisionInvite() { return { ok: false, code: 'already_activated', status: 409 } },
      }),
    )
    assert.equal(!r.ok && r.code, 'already_activated')
    assert.equal(!r.ok && r.authIdentity, 'preserved')
  })

  it('reusing an existing Auth identity is reported, not hidden', async () => {
    const r = await invite(ports({ async findAuthUserByEmail() { return { id: 'existing' } } }))
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.reusedAuthIdentity, true)
  })

  it('a retry converges rather than accumulating — the RPC replaces the grant set', () => {
    const m = code(read('supabase/migrations/20260817000000_user_lifecycle_provisioning.sql'))
    const body = m.match(
      /create or replace function public\.nmi_admin_provision_invite[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /on conflict \(id\) do update/i, 'the profile upserts')
    assert.match(body!, /delete from public\.user_module_grants/i, 'stale grants are removed')
    assert.match(body!, /on conflict \(user_id, module_key\) do nothing/i, 'no duplicate grants')
    assert.match(body!, /raise exception 'already_activated'/, 'a live account is never re-opened')
  })
})

describe('R13.6F § 13 / § 29 — email failure is reported honestly', () => {
  it('a delivery failure still returns ok, with emailSent false', async () => {
    const r = await invite(
      ports({
        async sendInvite() { return { sent: false, configured: true, failure: 'smtp_refused' } },
      }),
    )
    assert.equal(r.ok, true, 'the account IS provisioned — that is the truth')
    assert.equal(r.ok && r.emailSent, false, 'but delivery is NOT claimed')
    assert.equal(r.ok && r.emailFailure, 'smtp_refused')
  })

  it('an unconfigured mailer is reported, never treated as sent', async () => {
    const r = await invite(
      ports({
        async sendInvite() { return { sent: false, configured: false, failure: 'email_not_configured' } },
      }),
    )
    assert.equal(r.ok && r.emailSent, false)
    assert.equal(r.ok && r.emailFailure, 'email_not_configured')
  })

  it('the route forwards emailSent rather than flattening it to success', () => {
    const route = code(read('src/app/api/admin/users/route.ts'))
    assert.match(route, /emailSent: outcome\.emailSent/)
    assert.match(route, /emailFailure: outcome\.emailFailure/)
  })
})

describe('R13.6F § 29 — the email boundary', () => {
  const capture = () => {
    const calls: { to: string[]; subject: string; html: string }[] = []
    const transport: InviteEmailTransport = async (to, subject, html) => {
      calls.push({ to, subject, html })
      return { ok: true, configured: true, sent: to, failed: [] }
    }
    return { calls, transport }
  }

  it('sends to exactly the invited address, once', async () => {
    const { calls, transport } = capture()
    const r = await sendInviteEmail(
      { to: 'a@b.invalid', displayName: 'A', username: 'a', actionLink: LINK },
      transport,
    )
    assert.equal(r.sent, true)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].to, ['a@b.invalid'])
    assert.equal(calls[0].subject, INVITE_SUBJECT)
  })

  it('the body carries the invite URL and the username', async () => {
    const { calls, transport } = capture()
    await sendInviteEmail(
      { to: 'a@b.invalid', displayName: 'A', username: 'chosen_name', actionLink: LINK },
      transport,
    )
    assert.ok(calls[0].html.includes(LINK), 'the link is present for the recipient')
    assert.ok(calls[0].html.includes('chosen_name'))
  })

  it('escapes interpolated values — a display name cannot inject markup', () => {
    const html = renderInviteEmail({
      to: 'a@b.invalid',
      displayName: '<script>alert(1)</script>',
      username: 'x" onload="y',
      actionLink: LINK,
    })
    assert.doesNotMatch(html, /<script>alert/)
    assert.match(html, /&lt;script&gt;/)
    assert.doesNotMatch(html, /onload="y/)
  })

  it('loads nothing remote — no tracking pixel, no web font, no remote CSS', () => {
    const html = renderInviteEmail({
      to: 'a@b.invalid',
      displayName: 'A',
      username: 'a',
      actionLink: LINK,
    })
    assert.doesNotMatch(html, /<img/i)
    assert.doesNotMatch(html, /<link/i)
    assert.doesNotMatch(html, /@import/i)
    // The only external URL is the invitation itself.
    const urls = html.match(/https?:\/\/[^"'\s>]+/g) ?? []
    assert.ok(urls.every((u) => u.startsWith('https://preview.example.invalid')), urls.join(','))
  })

  it('a thrown transport is reported, never swallowed as success', async () => {
    const r = await sendInviteEmail(
      { to: 'a@b.invalid', displayName: 'A', username: 'a', actionLink: LINK },
      async () => { throw new Error('connection reset') },
    )
    assert.equal(r.sent, false)
    assert.match(r.failure!, /connection reset/)
  })

  it('a per-recipient failure is not reported as sent', async () => {
    const r = await sendInviteEmail(
      { to: 'a@b.invalid', displayName: 'A', username: 'a', actionLink: LINK },
      async () => ({ ok: false, configured: true, sent: [], failed: [{ email: 'a@b.invalid', error: 'HTTP 422' }] }),
    )
    assert.equal(r.sent, false)
    assert.match(r.failure!, /422/)
  })

  it('THE ACTION LINK NEVER APPEARS IN A FAILURE STRING', () => {
    const leaked = `failed posting to ${LINK} after retry`
    const described = describeSendFailure(new Error(leaked))
    assert.doesNotMatch(described, /SECRET-ONE-TIME-TOKEN/)
    assert.match(described, /\[link\]/)
    assert.ok(described.length <= 120)
  })

  it('the orchestrator never returns the link to its caller', async () => {
    const r = await invite(ports())
    assert.doesNotMatch(JSON.stringify(r), /SECRET-ONE-TIME-TOKEN/)
  })

  it('nothing in the invite path logs the link or the token', () => {
    for (const f of [
      'src/lib/admin/inviteOrchestration.ts',
      'src/lib/admin/inviteRuntime.ts',
      'src/lib/admin/inviteEmail.ts',
      'src/app/api/admin/users/route.ts',
      'src/app/api/admin/users/[id]/invitation/route.ts',
    ]) {
      const src = code(read(f))
      assert.doesNotMatch(src, /console\.(log|info|warn|error)/, `${f} must not log`)
    }
  })

  it('no route response body contains the action link', () => {
    for (const f of [
      'src/app/api/admin/users/route.ts',
      'src/app/api/admin/users/[id]/invitation/route.ts',
    ]) {
      const src = code(read(f))
      assert.doesNotMatch(src, /actionLink/, `${f} must not serialize the link`)
    }
  })
})

describe('R13.6F § 20 — resend', () => {
  it('mints a fresh link and sends it, changing NO access', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], profileChecked: [], sent: 0 }
    const r = await runResend({ identity: IDENTITY, redirectTo: REDIRECT, ports: ports({}, t) })
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.emailSent, true)
    assert.equal(t.provisioned, 0, 'resend must not re-provision')
    assert.equal(t.deleted.length, 0)
  })

  it('reports a delivery failure honestly', async () => {
    const r = await runResend({
      identity: IDENTITY,
      redirectTo: REDIRECT,
      ports: ports({
        async sendInvite() { return { sent: false, configured: true, failure: 'refused' } },
      }),
    })
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.emailSent, false)
  })

  it('a failed link mint is a clean failure', async () => {
    const r = await runResend({
      identity: IDENTITY,
      redirectTo: REDIRECT,
      ports: ports({ async generateInviteLink() { return { ok: false, code: 'invite_link_failed' } } }),
    })
    assert.equal(r.ok, false)
  })

  it('the route refuses an active or disabled target before touching Auth', () => {
    const route = code(read('src/app/api/admin/users/[id]/invitation/route.ts'))
    const activeIdx = route.indexOf("'already_activated'")
    const disabledIdx = route.indexOf("'account_disabled'")
    // The CALL SITE, not the import. `indexOf('runResend')` would match the
    // import statement at the top of the file and make this assertion vacuous.
    const resendIdx = route.indexOf('runResend({')
    assert.ok(activeIdx > 0 && disabledIdx > 0 && resendIdx > 0)
    assert.ok(activeIdx < resendIdx, 'the active check precedes the Auth call')
    assert.ok(disabledIdx < resendIdx, 'the disabled check precedes the Auth call')
  })

  it('creates no duplicate Auth account — one generateLink, no createUser', () => {
    const runtime = code(read('src/lib/admin/inviteRuntime.ts'))
    assert.doesNotMatch(runtime, /createUser/, 'the invite path never calls createUser')
    assert.match(runtime, /generateLink/)
  })
})

describe('R13.6F — the RPC error contract', () => {
  it('maps the last-administrator refusal to a conflict', () => {
    assert.equal(classifyRpcError({ message: 'last_administrator' }).status, 409)
    assert.equal(classifyRpcError({ message: 'last_administrator' }).code, 'last_administrator')
  })

  it('recognises a token even when PostgREST prefixes the message', () => {
    assert.equal(rpcErrorCode({ message: 'ERROR: username_taken (SQLSTATE P0001)' }), 'username_taken')
  })

  it('does not confuse two similarly-named tokens', () => {
    assert.equal(rpcErrorCode({ message: 'not_administrator' }), 'not_administrator')
    assert.equal(rpcErrorCode({ message: 'not_authenticated' }), 'not_authenticated')
  })

  it('DROPS an unrecognised database message rather than forwarding it', () => {
    const r = classifyRpcError({
      message: 'duplicate key value violates unique constraint "user_profiles_username_key" DETAIL: Key (username)=(alice) already exists.',
    })
    assert.equal(r.code, 'write_failed')
    assert.equal(r.status, 500)
    assert.doesNotMatch(JSON.stringify(r), /alice/, 'no row value reaches the client')
  })

  it('every mapped token has a sane status', () => {
    for (const [token, status] of Object.entries(RPC_ERROR_STATUS)) {
      assert.ok(status >= 400 && status < 600, `${token} -> ${status}`)
    }
  })
})
