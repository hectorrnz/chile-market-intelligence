// D0B1 — MANUAL INVITATION DELIVERY: the link, and the fact that it goes nowhere else.
//
// The invitation URL is a BEARER CREDENTIAL — whoever holds it can activate that
// account until it expires. Most of this file exists to prove it reaches exactly
// one place: the response to the administrator request that created it.
//
// THE CENTRAL TEST IS NOT A SOURCE-TEXT ASSERTION (§17). A sentinel token is
// pushed through the REAL runtime binding (`buildInvitePorts`) and the REAL
// orchestration against in-memory Auth and PostgREST fakes, and every artifact
// the run produces — every RPC parameter (which is what becomes an audit row),
// every console line, every response body, every error — is deep-scanned for that
// sentinel. The scanner is then pointed at a DELIBERATELY LEAKY variant, in this
// same file, and must report the leak; a detector that cannot fail catches
// nothing.
//
// NO EMAIL IS EVER SENT HERE, in either mode. The transport is injected.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  runInvite,
  runResend,
  type InvitePorts,
  type InviteIdentity,
} from '../src/lib/admin/inviteOrchestration.ts'
import {
  parseInviteDelivery,
  inviteSuccessBody,
  resendSuccessBody,
  inviteErrorBody,
  isInviteDeliveryMode,
  INVITE_DELIVERY_MODES,
  DEFAULT_INVITE_DELIVERY,
} from '../src/lib/admin/inviteDelivery.ts'
import { buildInvitePorts } from '../src/lib/admin/inviteRuntime.ts'
import {
  buildInviteAcceptUrl,
  buildInviteRedirectUrl,
  INVITE_LANDING_PATH,
  AUTH_CALLBACK_PATH,
} from '../src/lib/admin/inviteLink.ts'
import { moduleAccessFromProfile, APP_MODULE_KEYS } from '../src/lib/auth/moduleAccess.ts'
import type { AccountShape } from '../src/lib/admin/userProvisioning.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const USERS_ROUTE = 'src/app/api/admin/users/route.ts'
const INVITATION_ROUTE = 'src/app/api/admin/users/[id]/invitation/route.ts'
const INVITE_DIALOG = 'src/app/settings/users/InviteUserDialog.tsx'
const MANAGE_DIALOG = 'src/app/settings/users/ManageUserDialog.tsx'
const LINK_PANEL = 'src/app/settings/users/InvitationLinkPanel.tsx'

/**
 * The one-time token. Deliberately unmistakable: anything containing this string
 * anywhere in a recorded artifact is a leak, with no false-positive risk.
 */
const SENTINEL = 'D0B1-SENTINEL-ONE-TIME-TOKEN-9f3a7c'
const ORIGIN = 'https://nevada-market-intelligence.vercel.app'
const REDIRECT = buildInviteRedirectUrl(ORIGIN)
const CANONICAL_URL = buildInviteAcceptUrl(ORIGIN, SENTINEL)

/** GoTrue's own link — deliberately DIFFERENT, and deliberately never handed over. */
const GOTRUE_ACTION_LINK = `https://project.supabase.co/auth/v1/verify?token=${SENTINEL}&type=invite`

const IDENTITY: InviteIdentity = {
  username: 'owneradmin',
  email: 'owner@example.invalid',
  displayName: 'Owner Admin',
}
const SHAPE: AccountShape = { role: 'administrator', principal: null, modules: [] }

/** Every file under a directory, as repo-relative POSIX paths. */
function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(full.slice(ROOT.length + 1).split('\\').join('/'))
    }
  }
  walk(dir)
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// The leak detector.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every path at which `secret` appears anywhere inside `value`.
 *
 * Walks objects, arrays, Errors (message AND stack), Maps and Sets, because a
 * credential that escapes does so through whatever container happened to be
 * nearby — a thrown error, a params bag, a logged object.
 */
function findSecret(value: unknown, secret: string, at = '$'): string[] {
  const hits: string[] = []
  const seen = new Set<unknown>()
  const walk = (v: unknown, p: string): void => {
    if (v === null || v === undefined) return
    if (typeof v === 'string') {
      if (v.includes(secret)) hits.push(p)
      return
    }
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return
    if (typeof v === 'symbol' || typeof v === 'function') {
      if (String(v).includes(secret)) hits.push(p)
      return
    }
    if (seen.has(v)) return
    seen.add(v)
    if (v instanceof Error) {
      walk(v.message, `${p}.message`)
      walk(v.stack ?? '', `${p}.stack`)
      return
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`))
      return
    }
    if (v instanceof Map) {
      for (const [k, x] of v) walk(x, `${p}.get(${String(k)})`)
      return
    }
    if (v instanceof Set) {
      let i = 0
      for (const x of v) walk(x, `${p}.set[${i++}]`)
      return
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${p}.${k}`)
  }
  walk(value, at)
  return hits
}

/** Captures everything written to the console while `fn` runs. */
async function withConsoleCapture<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = []
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
  const saved = methods.map((m) => [m, console[m]] as const)
  for (const m of methods) {
    ;(console as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
      lines.push(
        args
          .map((a) => {
            if (typeof a === 'string') return a
            try {
              return JSON.stringify(a)
            } catch {
              return String(a)
            }
          })
          .join(' '),
      )
    }
  }
  try {
    const result = await fn()
    return { result, lines }
  } finally {
    for (const [m, original] of saved) {
      ;(console as unknown as Record<string, unknown>)[m] = original
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A whole invitation, recorded.
// ─────────────────────────────────────────────────────────────────────────────

interface Ledger {
  /** Every PostgREST RPC call, with its parameters — what becomes an audit row. */
  rpc: { fn: string; params: Record<string, unknown> }[]
  /** Every email actually handed to a transport. */
  transport: { to: string[]; subject: string; html: string }[]
  /** Every Auth Admin call. */
  auth: { op: string; arg: unknown }[]
}

function emptyLedger(): Ledger {
  return { rpc: [], transport: [], auth: [] }
}

/**
 * The REAL runtime ports over in-memory Auth and PostgREST.
 *
 * `buildInvitePorts` is the code Production runs — the same `generateLink` call,
 * the same `buildInviteAcceptUrl`, the same seven RPC parameters. Testing the
 * orchestration against hand-written ports would prove the sequence; testing it
 * against THIS proves what actually reaches the database.
 *
 * `leakUrlIntoRpc` exists for the §17 non-vacuity proof and is false everywhere
 * else.
 */
function realPorts(ledger: Ledger, opts: { leakUrlIntoRpc?: boolean } = {}): InvitePorts {
  const admin = {
    auth: {
      admin: {
        async listUsers(p: { page: number; perPage: number }) {
          ledger.auth.push({ op: 'listUsers', arg: p })
          return { data: { users: [] as { id: string; email?: string | null }[] }, error: null }
        },
        async generateLink(p: { type: 'invite'; email: string; options?: { redirectTo?: string } }) {
          ledger.auth.push({ op: 'generateLink', arg: p })
          return {
            data: {
              properties: { action_link: GOTRUE_ACTION_LINK, hashed_token: SENTINEL },
              user: { id: 'invited-user-id' },
            },
            error: null,
          }
        },
        async deleteUser(id: string) {
          ledger.auth.push({ op: 'deleteUser', arg: id })
          return { data: null, error: null }
        },
      },
    },
  }

  const session = {
    async rpc(fn: string, params: Record<string, unknown>) {
      const recorded = opts.leakUrlIntoRpc
        ? // A plausible mistake: somebody decides the audit should record how the
          // invitation travelled, and reaches for the whole link to do it.
          { ...params, p_delivery_mode: 'manual', p_delivery_url: CANONICAL_URL }
        : params
      ledger.rpc.push({ fn, params: recorded })
      return { data: null, error: null }
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: { id: 'invited-user-id' }, error: null }
                },
              }
            },
          }
        },
      }
    },
  }

  const ports = buildInvitePorts(admin as never, session as never)
  // Replace only the transport seam, so no email can leave even in email mode.
  return {
    ...ports,
    async sendInvite({ identity, actionLink }) {
      ledger.transport.push({
        to: [identity.email],
        subject: 'invite',
        html: `<a href="${actionLink}">link</a>`,
      })
      return { sent: true, configured: true, failure: null }
    },
  }
}

/** Hand-written ports, for the failure-path matrix where no real client is needed. */
interface Trace {
  generated: number
  provisioned: number
  deleted: string[]
  sent: number
}

function stubPorts(over: Partial<InvitePorts> = {}, trace?: Trace): InvitePorts {
  const t = trace ?? { generated: 0, provisioned: 0, deleted: [], sent: 0 }
  return {
    async findAuthUserByEmail() {
      return null
    },
    async generateInviteLink() {
      t.generated++
      return { ok: true, userId: 'invited-user-id', actionLink: CANONICAL_URL }
    },
    async provisionInvite() {
      t.provisioned++
      return { ok: true }
    },
    async profileExists() {
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

const manual = (p: InvitePorts) =>
  runInvite({ identity: IDENTITY, shape: SHAPE, redirectTo: REDIRECT, delivery: 'manual', ports: p })
const byEmail = (p: InvitePorts) =>
  runInvite({ identity: IDENTITY, shape: SHAPE, redirectTo: REDIRECT, delivery: 'email', ports: p })

// ═════════════════════════════════════════════════════════════════════════════
// A · The delivery contract
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 4 — the delivery-mode contract', () => {
  it('has exactly two modes and no third', () => {
    assert.deepEqual([...INVITE_DELIVERY_MODES], ['email', 'manual'])
    assert.ok(isInviteDeliveryMode('email'))
    assert.ok(isInviteDeliveryMode('manual'))
    for (const bad of ['link', 'Manual', 'EMAIL', '', true, 0, null, {}, ['manual']]) {
      assert.ok(!isInviteDeliveryMode(bad), `${JSON.stringify(bad)} is not a delivery mode`)
    }
  })

  it('an ABSENT mode means the pre-D0B1 behaviour, so an old caller is unchanged', () => {
    assert.equal(DEFAULT_INVITE_DELIVERY, 'email')
    for (const absent of [undefined, null]) {
      const r = parseInviteDelivery(absent)
      assert.equal(r.ok, true)
      assert.equal(r.ok && r.mode, 'email')
    }
  })

  it('a PRESENT but unrecognised mode is refused, never coerced', () => {
    for (const bad of ['manual ', 'Manual', 'link', 'sms', true, 1, {}, []]) {
      const r = parseInviteDelivery(bad)
      assert.equal(r.ok, false, `${JSON.stringify(bad)} must be refused`)
      assert.equal(!r.ok && r.code, 'invalid_delivery')
    }
  })

  it('both routes parse the mode and refuse an unrecognised one', () => {
    for (const f of [USERS_ROUTE, INVITATION_ROUTE]) {
      const src = code(read(f))
      assert.match(src, /parseInviteDelivery\(/, `${f} must parse the delivery mode`)
      assert.match(src, /delivery\.ok/, `${f} must act on the parse result`)
      assert.match(src, /status: 400/, `${f} must refuse an unrecognised mode`)
    }
  })

  it('the re-invitation route tolerates NO BODY AT ALL — the pre-D0B1 console sends none', () => {
    const src = code(read(INVITATION_ROUTE))
    assert.match(src, /request\.json\(\)\.catch\(\(\) => null\)/)
    assert.match(src, /parseInviteDelivery\(body\?\.delivery\)/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// B · Manual mode behaviour  (§16 A, B, C, D)
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 16 A–D — manual mode does the account work and skips the email', () => {
  it('A · succeeds, and provisions the account exactly as email mode does', async () => {
    const l = emptyLedger()
    const out = await manual(realPorts(l))
    assert.equal(out.ok, true)
    assert.equal(out.ok && out.userId, 'invited-user-id')
    assert.equal(out.ok && out.delivery, 'manual')
    assert.equal(l.rpc.length, 1, 'exactly one provisioning RPC')
    assert.equal(l.rpc[0].fn, 'nmi_admin_provision_invite')
  })

  it('B · NEVER reaches the email transport — zero sends, not a skipped one', async () => {
    const l = emptyLedger()
    // A port that THROWS if called: not "was not observed to send", but "cannot".
    const ports: InvitePorts = {
      ...realPorts(l),
      async sendInvite() {
        throw new Error('the email transport must not be reached in manual mode')
      },
    }
    const out = await manual(ports)
    assert.equal(out.ok, true)
    assert.equal(l.transport.length, 0)
  })

  it('B · the orchestration has no manual branch that falls through to a send', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], sent: 0 }
    await runInvite({
      identity: IDENTITY,
      shape: SHAPE,
      redirectTo: REDIRECT,
      delivery: 'manual',
      ports: stubPorts({}, t),
    })
    assert.equal(t.sent, 0)
    assert.equal(t.provisioned, 1, 'the account is still fully provisioned')
  })

  it('C · email mode still sends, exactly as before, and returns no URL', async () => {
    const l = emptyLedger()
    const out = await byEmail(realPorts(l))
    assert.equal(out.ok, true)
    assert.equal(out.ok && out.delivery, 'email')
    assert.equal(out.ok && out.emailSent, true)
    assert.equal(out.ok && out.invitationUrl, null, 'an emailed link must not also come back')
    assert.equal(l.transport.length, 1)
    assert.deepEqual(l.transport[0].to, [IDENTITY.email])
  })

  it('C · an email-mode delivery failure is still reported, never swapped for a link', async () => {
    const out = await byEmail(
      stubPorts({
        async sendInvite() {
          return { sent: false, configured: false, failure: 'email_not_configured' }
        },
      }),
    )
    assert.equal(out.ok, true)
    assert.equal(out.ok && out.emailSent, false)
    assert.equal(out.ok && out.emailFailure, 'email_not_configured')
    assert.equal(out.ok && out.invitationUrl, null, 'NO silent fallback to a manual link')
  })

  it('manual mode reports no delivery failure, because nothing was attempted', async () => {
    const out = await manual(realPorts(emptyLedger()))
    assert.equal(out.ok && out.emailSent, false)
    assert.equal(out.ok && out.emailFailure, null)
  })

  it('D · the URL appears in the response body EXACTLY ONCE', async () => {
    const out = await manual(realPorts(emptyLedger()))
    assert.equal(out.ok, true)
    if (!out.ok) return
    const body = inviteSuccessBody(out)
    const hits = findSecret(body, SENTINEL)
    assert.deepEqual(hits, ['$.invitationUrl'], `unexpected leak paths: ${hits.join(', ')}`)
  })

  it('D · an email-mode body carries the URL nowhere, even if one were passed in', async () => {
    const body = inviteSuccessBody({
      userId: 'u',
      delivery: 'email',
      emailSent: true,
      emailFailure: null,
      reusedAuthIdentity: false,
      // Deliberately populated: the projection must still strip it.
      invitationUrl: CANONICAL_URL,
    })
    assert.equal(body.invitationUrl, null)
    assert.deepEqual(findSecret(body, SENTINEL), [])
  })

  it('D · a resend body behaves the same way in both modes', () => {
    const m = resendSuccessBody({
      delivery: 'manual',
      emailSent: false,
      emailFailure: null,
      invitationUrl: CANONICAL_URL,
    })
    assert.deepEqual(findSecret(m, SENTINEL), ['$.invitationUrl'])
    const e = resendSuccessBody({
      delivery: 'email',
      emailSent: true,
      emailFailure: null,
      invitationUrl: CANONICAL_URL,
    })
    assert.deepEqual(findSecret(e, SENTINEL), [])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// C · Nothing stores it, nothing logs it, nothing audits it  (§16 E, F, G)
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 16 E–G — the URL reaches no store, no audit and no log', () => {
  it('F · NO RPC PARAMETER carries the token — so no audit row can', async () => {
    const l = emptyLedger()
    const out = await manual(realPorts(l))
    assert.equal(out.ok, true)
    assert.equal(l.rpc.length, 1)
    const hits = findSecret(l.rpc, SENTINEL)
    assert.deepEqual(hits, [], `the token reached the database at: ${hits.join(', ')}`)
  })

  it('F · the provisioning call passes exactly the seven identity/access parameters', async () => {
    const l = emptyLedger()
    await manual(realPorts(l))
    assert.deepEqual(Object.keys(l.rpc[0].params).sort(), [
      'p_display_name',
      'p_email',
      'p_modules',
      'p_principal',
      'p_role',
      'p_target_user_id',
      'p_username',
    ])
  })

  it('F · the audit table has no free-form metadata column to hide a credential in', () => {
    const base = read('supabase/migrations/20260806000000_family_portfolio_entitlements.sql')
    const start = base.indexOf('create table if not exists public.family_portfolio_access_audit')
    assert.ok(start > 0)
    const decl = base.slice(start, base.indexOf(');', start))
    assert.doesNotMatch(decl, /\bjsonb\b/, 'no jsonb blob on the access audit')
    assert.doesNotMatch(decl, /token|url|link|secret/i)
    // `field_changed` is CHECK-constrained to an enumerated list, so a new kind
    // of audit row cannot be introduced from application code alone.
    assert.match(decl, /field_changed\s+text\s+not null check \(field_changed in \(/)
  })

  it('F · the provisioning RPC signature takes no URL or token', () => {
    const sql = read('supabase/migrations/20260817000000_user_lifecycle_provisioning.sql')
    const at = sql.indexOf('function public.nmi_admin_provision_invite(')
    assert.ok(at > 0)
    const sig = sql.slice(at, sql.indexOf(')', at))
    assert.doesNotMatch(sig, /token|url|link|secret/i)
  })

  it('G · nothing is written to the console during a manual invitation', async () => {
    const l = emptyLedger()
    const { result, lines } = await withConsoleCapture(() => manual(realPorts(l)))
    assert.equal(result.ok, true)
    const hits = findSecret(lines, SENTINEL)
    assert.deepEqual(hits, [], `the token was logged at: ${hits.join(', ')}`)
  })

  it('G · nothing is logged on any FAILURE path either, in either mode', async () => {
    const failures: Partial<InvitePorts>[] = [
      { async findAuthUserByEmail() { return 'error' } },
      { async generateInviteLink() { return { ok: false, code: 'invite_link_failed' } } },
      { async provisionInvite() { return { ok: false, code: 'username_taken', status: 409 } } },
      {
        async provisionInvite() { return { ok: false, code: 'db_unavailable', status: 503 } },
        async profileExists() { return 'error' },
      },
      {
        async provisionInvite() { return { ok: false, code: 'db_unavailable', status: 503 } },
        async deleteAuthUser() { return false },
      },
    ]
    for (const over of failures) {
      for (const delivery of ['manual', 'email'] as const) {
        const { result, lines } = await withConsoleCapture(() =>
          runInvite({
            identity: IDENTITY,
            shape: SHAPE,
            redirectTo: REDIRECT,
            delivery,
            ports: stubPorts(over),
          }),
        )
        assert.deepEqual(findSecret(lines, SENTINEL), [], 'nothing may be logged')
        assert.deepEqual(findSecret(result, SENTINEL), [], 'no failure outcome may carry the URL')
      }
    }
  })

  it('G · a transport error that QUOTES the link is redacted before it is reported', async () => {
    // A mail provider that echoes the request body back on failure is the most
    // likely way the link escapes into an operator-visible string.
    const out = await byEmail(
      stubPorts({
        async sendInvite() {
          throw new Error(`POST failed: {"html":"<a href=\\"${CANONICAL_URL}\\">"}`)
        },
      }),
    )
    assert.equal(out.ok, true)
    assert.equal(out.ok && out.emailSent, false)
    const hits = findSecret(out, SENTINEL)
    assert.deepEqual(hits, [], `the link survived into the reported failure at: ${hits.join(', ')}`)
    assert.match(String(out.ok && out.emailFailure), /\[link\]/, 'and it is visibly redacted')
  })

  it('E · an error body has no field a URL could occupy', () => {
    assert.deepEqual(inviteErrorBody('username_taken'), { error: 'username_taken' })
    assert.deepEqual(inviteErrorBody('db_unavailable', 'removed'), {
      error: 'db_unavailable',
      authIdentity: 'removed',
    })
  })

  it('E · NO route names the URL field — one shared builder is the only producer', () => {
    const api = listFiles(join(ROOT, 'src/app/api'))
    const carriers = api.filter((f) => read(f).includes('invitationUrl'))
    assert.deepEqual(carriers, [], 'a route that spells the field itself has bypassed the builder')

    // The two creation routes reach it only through the projection, which strips
    // the URL for every email-mode outcome.
    for (const f of [USERS_ROUTE, INVITATION_ROUTE]) {
      const src = read(f)
      assert.ok(
        src.includes('inviteSuccessBody') || src.includes('resendSuccessBody'),
        `${f} must answer through a success-body builder`,
      )
    }
    // And exactly one module defines it.
    const lib = listFiles(join(ROOT, 'src/lib')).filter((f) => read(f).includes('invitationUrl'))
    assert.deepEqual(lib.sort(), [
      'src/lib/admin/inviteDelivery.ts',
      'src/lib/admin/inviteOrchestration.ts',
    ])
  })

  it('E · the directory GET selects a fixed column list with nothing token-shaped in it', () => {
    const src = read(USERS_ROUTE)
    const at = src.indexOf(".select('id, email, display_name")
    assert.ok(at > 0, 'the narrow column list must still be there')
    const list = src.slice(at, src.indexOf(')', at))
    assert.doesNotMatch(list, /token|url|link|invitation|secret/i)
    assert.doesNotMatch(src, /\.select\('\*'\)/, 'never select *')
  })

  it('E · the GET handler never mentions the delivery response shape at all', () => {
    const src = read(USERS_ROUTE)
    const get = src.slice(
      src.indexOf('export async function GET'),
      src.indexOf('export async function POST'),
    )
    assert.doesNotMatch(get, /invitationUrl|inviteSuccessBody|resendSuccessBody/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// D · THE NON-VACUITY PROOF  (§17)
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 17 — the leak detector is proven to bite', () => {
  it('catches a token deliberately written into the provisioning call (→ the audit row)', async () => {
    const l = emptyLedger()
    const out = await manual(realPorts(l, { leakUrlIntoRpc: true }))
    assert.equal(out.ok, true, 'the leaky variant still succeeds — that is what makes it dangerous')

    const hits = findSecret(l.rpc, SENTINEL)
    assert.ok(hits.length > 0, 'the detector MUST report the deliberate leak')
    assert.deepEqual(hits, ['$[0].params.p_delivery_url'])

    // And the clean run, measured by the very same helper, reports nothing.
    const clean = emptyLedger()
    await manual(realPorts(clean))
    assert.deepEqual(findSecret(clean.rpc, SENTINEL), [])
  })

  it('catches a token deliberately echoed into a subsequent list response', () => {
    const leakyRow = {
      id: 'invited-user-id',
      username: 'owneradmin',
      status: 'invited',
      // The mistake: "it would be convenient to show the link in the table".
      invitationUrl: CANONICAL_URL,
    }
    const hits = findSecret({ users: [leakyRow] }, SENTINEL)
    assert.deepEqual(hits, ['$.users[0].invitationUrl'])

    const cleanRow = { id: 'invited-user-id', username: 'owneradmin', status: 'invited' }
    assert.deepEqual(findSecret({ users: [cleanRow] }, SENTINEL), [])
  })

  it('catches a token hiding in a thrown error, a nested array and a Map', () => {
    // V8 repeats the message in the stack, so BOTH are reported — and both are
    // real places a credential would end up in a log.
    assert.deepEqual(findSecret(new Error(`failed for ${CANONICAL_URL}`), SENTINEL), [
      '$.message',
      '$.stack',
    ])
    assert.deepEqual(findSecret({ a: [{ b: [CANONICAL_URL] }] }, SENTINEL), ['$.a[0].b[0]'])
    assert.deepEqual(findSecret(new Map([['k', CANONICAL_URL]]), SENTINEL), ['$.get(k)'])
  })

  it('catches a token logged to the console', async () => {
    const { lines } = await withConsoleCapture(async () => {
      console.warn('invite issued', { url: CANONICAL_URL })
    })
    assert.ok(findSecret(lines, SENTINEL).length > 0, 'console capture must see it')
  })

  it('does not fire on a clean value — it is not simply always true', () => {
    assert.deepEqual(findSecret({ ok: true, userId: 'u', delivery: 'manual' }, SENTINEL), [])
    assert.deepEqual(findSecret('https://example.invalid/auth/callback', SENTINEL), [])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// E · The URL itself  (§16 L, M, N, O)
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 9 & § 16 L–O — the manual URL is the canonical emailed one', () => {
  it('L · is built by the canonical builder, from the request origin', async () => {
    const out = await manual(realPorts(emptyLedger()))
    assert.equal(out.ok && out.invitationUrl, CANONICAL_URL)
    assert.equal(
      CANONICAL_URL,
      `${ORIGIN}${AUTH_CALLBACK_PATH}?token_hash=${SENTINEL}&type=invite` +
        `&next=${encodeURIComponent(INVITE_LANDING_PATH)}`,
    )
  })

  it('L · is NOT GoTrue’s own action_link, which a server callback can never redeem', async () => {
    const out = await manual(realPorts(emptyLedger()))
    assert.notEqual(out.ok && out.invitationUrl, GOTRUE_ACTION_LINK)
    assert.ok(String(out.ok && out.invitationUrl).startsWith(ORIGIN))
  })

  it('M · is BYTE-IDENTICAL to the link email mode would have sent for the same token', async () => {
    const manualOut = await manual(realPorts(emptyLedger()))

    const emailLedger = emptyLedger()
    await byEmail(realPorts(emailLedger))

    assert.equal(emailLedger.transport.length, 1)
    const emailed = /href="([^"]+)"/.exec(emailLedger.transport[0].html)?.[1]
    assert.equal(manualOut.ok && manualOut.invitationUrl, emailed)
  })

  it('M · the callback has no notion of delivery mode — one redemption path, not two', () => {
    const cb = code(read('src/app/auth/callback/route.ts'))
    assert.doesNotMatch(cb, /\bmanual\b|\bdelivery\b/i, 'the callback must not branch on how the link travelled')
    assert.match(cb, /verifyOtp/, 'both modes redeem through verifyOtp')
    assert.match(cb, /token_hash/)
  })

  it('O · activation and password setting are untouched — the same landing page', () => {
    assert.equal(INVITE_LANDING_PATH, '/auth/reset-password')
    const cb = code(read('src/app/auth/callback/route.ts'))
    assert.match(cb, /nmi_activate_current_user/, 'the invitee still activates their own account')
    const panel = code(read(LINK_PANEL))
    assert.doesNotMatch(
      panel,
      /activate|nmi_activate|signIn|setSession/i,
      'copying a link must never itself activate the account',
    )
  })

  it('N · an unredeemable manual invite still gets the D0C actionable message', () => {
    const cb = code(read('src/app/auth/callback/route.ts'))
    assert.match(cb, /invite_link_invalid/)
    assert.match(cb, /otpType === 'invite'/)
    const login = code(read('src/app/(auth)/login/page.tsx'))
    assert.match(login, /invite_link_invalid/)
    assert.match(login, /errInviteLinkInvalid/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// F · Re-invitation  (§16 J, K)
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 8 & § 16 J–K — re-inviting mints a new link and never recovers the old', () => {
  it('J · a manual re-invitation returns a FRESH URL, not the previous one', async () => {
    let n = 0
    const ports = stubPorts({
      async generateInviteLink() {
        n++
        return {
          ok: true,
          userId: 'invited-user-id',
          actionLink: buildInviteAcceptUrl(ORIGIN, `token-${n}`),
        }
      },
    })
    const first = await runResend({ identity: IDENTITY, redirectTo: REDIRECT, delivery: 'manual', ports })
    const second = await runResend({ identity: IDENTITY, redirectTo: REDIRECT, delivery: 'manual', ports })
    assert.equal(first.ok && first.invitationUrl, buildInviteAcceptUrl(ORIGIN, 'token-1'))
    assert.equal(second.ok && second.invitationUrl, buildInviteAcceptUrl(ORIGIN, 'token-2'))
    assert.notEqual(first.ok && first.invitationUrl, second.ok && second.invitationUrl)
  })

  it('J · a manual re-invitation changes NO access and sends NO email', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], sent: 0 }
    const r = await runResend({
      identity: IDENTITY,
      redirectTo: REDIRECT,
      delivery: 'manual',
      ports: stubPorts({}, t),
    })
    assert.equal(r.ok, true)
    assert.equal(t.provisioned, 0, 'a resend must never re-provision')
    assert.equal(t.sent, 0, 'manual must never send')
    assert.equal(t.generated, 1)
  })

  it('J · an email re-invitation is unchanged and returns no URL', async () => {
    const t: Trace = { generated: 0, provisioned: 0, deleted: [], sent: 0 }
    const r = await runResend({
      identity: IDENTITY,
      redirectTo: REDIRECT,
      delivery: 'email',
      ports: stubPorts({}, t),
    })
    assert.equal(r.ok && r.emailSent, true)
    assert.equal(r.ok && r.invitationUrl, null)
    assert.equal(t.sent, 1)
  })

  it('J · the route still refuses to re-invite an ACTIVE or DISABLED account', () => {
    const src = code(read(INVITATION_ROUTE))
    assert.match(src, /status === 'active'[\s\S]{0,200}already_activated/)
    assert.match(src, /status === 'disabled'[\s\S]{0,200}account_disabled/)
  })

  it('K · no application surface can hand back a previously issued link', () => {
    const api = listFiles(join(ROOT, 'src/app/api'))
    for (const f of api) {
      const src = read(f)
      if (!src.includes('invitationUrl')) continue
      assert.ok(
        src.includes('inviteSuccessBody') || src.includes('resendSuccessBody'),
        `${f} may only emit a URL through a success-body builder`,
      )
      assert.doesNotMatch(
        code(src),
        /export async function GET[\s\S]*invitationUrl/,
        `${f} must not expose a URL on a GET`,
      )
    }
  })

  it('K · the console keeps the link in component state only — never in browser storage', () => {
    for (const f of [INVITE_DIALOG, MANAGE_DIALOG, LINK_PANEL]) {
      const src = code(read(f))
      assert.doesNotMatch(
        src,
        /localStorage|sessionStorage|indexedDB|document\.cookie|usePersistentState/i,
        `${f} must not persist the invitation link`,
      )
      assert.doesNotMatch(src, /console\.(log|info|warn|error|debug)/, `${f} must not log`)
    }
  })

  it('K · closing either dialog drops the link before it closes', () => {
    const invite = code(read(INVITE_DIALOG))
    assert.match(invite, /function dismiss\(\)\s*\{[\s\S]*?setSent\(null\)[\s\S]*?onClose\(\)/)
    assert.match(invite, /onClose=\{dismiss\}/)
    assert.match(invite, /onClick=\{dismiss\}/)

    const manageSrc = code(read(MANAGE_DIALOG))
    assert.match(manageSrc, /function dismiss\(\)\s*\{[\s\S]*?setManualUrl\(null\)[\s\S]*?onClose\(\)/)
    assert.match(manageSrc, /onClose=\{dismiss\}/)
  })

  it('K · the users table shows lifecycle state only — no link, no copy action', () => {
    const table = read('src/app/settings/users/UsersAccessClient.tsx')
    assert.doesNotMatch(table, /invitationUrl|copyInviteLink|token_hash/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// G · Authorization  (§16 H, I)
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 11 & § 16 H–I — only an administrator may ask for a link', () => {
  it('H · a member holding EVERY module is still not an administrator', () => {
    const access = moduleAccessFromProfile(
      { username: 'member', role: 'user' },
      APP_MODULE_KEYS.map((k) => ({ module_key: k })),
    )
    assert.equal(access.isAdministrator, false, 'no grant can substitute for the role')
  })

  it('I · an absent profile is not an administrator', () => {
    assert.equal(moduleAccessFromProfile(null, []).isAdministrator, false)
    assert.equal(moduleAccessFromProfile(undefined, []).isAdministrator, false)
  })

  it('H/I · guardAdministrator is the FIRST statement of both handlers', () => {
    for (const f of [USERS_ROUTE, INVITATION_ROUTE]) {
      const src = code(read(f))
      const post = src.slice(src.indexOf('export async function POST'))
      const guard = post.indexOf('guardAdministrator()')
      assert.ok(guard > 0, `${f} must guard`)
      assert.match(post, /const denied = await guardAdministrator\(\)\s*\n\s*if \(denied\) return denied/)
      // Nothing sensitive may precede it.
      const before = post.slice(0, guard)
      assert.doesNotMatch(
        before,
        /generateLink|getSupabaseAdminClient|runInvite|runResend|parseInviteDelivery/,
      )
    }
  })

  it('the manual path adds NO new endpoint — the same admin routes as before', () => {
    const api = listFiles(join(ROOT, 'src/app/api/admin'))
    assert.deepEqual(api.sort(), [
      'src/app/api/admin/users/[id]/invitation/route.ts',
      'src/app/api/admin/users/[id]/lifecycle/route.ts',
      'src/app/api/admin/users/[id]/modules/route.ts',
      'src/app/api/admin/users/[id]/route.ts',
      'src/app/api/admin/users/route.ts',
    ])
  })

  it('§19 · the manual path adds NO migration and stores nothing', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((m) => m.endsWith('.sql'))
    assert.equal(
      migrations.sort().at(-1),
      '20260824000000_last_administrator_serialization.sql',
      'D0B1 is application-level: no new migration',
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// H · Failure compensation is unchanged  (§16 P)
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 12 & § 16 P — partial-failure handling is identical in both modes', () => {
  const cases: { name: string; over: Partial<InvitePorts>; code: string; authIdentity: string }[] = [
    {
      name: 'auth lookup failure',
      over: { async findAuthUserByEmail() { return 'error' } },
      code: 'auth_lookup_failed',
      authIdentity: 'none',
    },
    {
      name: 'link mint failure',
      over: { async generateInviteLink() { return { ok: false, code: 'invite_link_failed' } } },
      code: 'invite_link_failed',
      authIdentity: 'none',
    },
    {
      name: 'provisioning failure, identity safely removed',
      over: { async provisionInvite() { return { ok: false, code: 'username_taken', status: 409 } } },
      code: 'username_taken',
      authIdentity: 'removed',
    },
    {
      name: 'provisioning failure with an unconfirmable profile — left in place',
      over: {
        async provisionInvite() { return { ok: false, code: 'db_unavailable', status: 503 } },
        async profileExists() { return 'error' },
      },
      code: 'db_unavailable',
      authIdentity: 'orphaned',
    },
    {
      name: 'provisioning failure on a PRE-EXISTING identity — never touched',
      over: {
        async findAuthUserByEmail() { return { id: 'pre-existing' } },
        async provisionInvite() { return { ok: false, code: 'username_taken', status: 409 } },
      },
      code: 'username_taken',
      authIdentity: 'preserved',
    },
  ]

  for (const c of cases) {
    it(`P · ${c.name} behaves the same in manual and email mode`, async () => {
      const results: string[] = []
      for (const delivery of ['manual', 'email'] as const) {
        const out = await runInvite({
          identity: IDENTITY,
          shape: SHAPE,
          redirectTo: REDIRECT,
          delivery,
          ports: stubPorts(c.over),
        })
        assert.equal(out.ok, false)
        assert.equal(!out.ok && out.code, c.code)
        assert.equal(!out.ok && out.authIdentity, c.authIdentity)
        assert.deepEqual(findSecret(out, SENTINEL), [], 'a failure never carries the URL')
        results.push(JSON.stringify(out))
      }
      assert.equal(results[0], results[1], 'the two modes must fail identically')
    })
  }

  it('P · a link that cannot be built is a clean refusal, not an ambiguous invitation', async () => {
    const out = await manual(
      stubPorts({
        async generateInviteLink() {
          return { ok: false, code: 'invite_link_incomplete' }
        },
      }),
    )
    assert.equal(out.ok, false)
    assert.equal(!out.ok && out.code, 'invite_link_incomplete')
    const mapping = read('src/app/settings/users/AccountAccessFields.tsx')
    assert.match(
      mapping,
      /case 'invite_link_incomplete'/,
      'and the administrator is told what happened',
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// I · The administrator surface  (§5, §6, §7, §20)
// ═════════════════════════════════════════════════════════════════════════════

describe('D0B1 § 5–7 & § 20 — the administrator surface', () => {
  it('the invite dialog offers an explicit delivery choice, defaulting to manual', () => {
    const src = code(read(INVITE_DIALOG))
    assert.match(src, /useState<InviteDeliveryMode>\('manual'\)/)
    assert.match(src, /SegmentedControl<InviteDeliveryMode>/)
    assert.match(src, /deliveryManual/)
    assert.match(src, /deliveryEmail/)
    assert.match(src, /\n\s+delivery,\n/, 'the chosen mode is submitted')
  })

  it('the choice is described in user-facing words, never in mechanism', () => {
    const en = read('src/lib/i18n.ts')
    const labels = [
      /deliveryManual: '([^']+)'/g,
      /deliveryEmail: '([^']+)'/g,
      /deliveryHeading: '([^']+)'/g,
      /deliveryManualNote: '([^']+)'/g,
    ].flatMap((re) => [...en.matchAll(re)].map((m) => m[1]))
    assert.ok(labels.length >= 8, `both languages must be present (found ${labels.length})`)
    for (const l of labels) {
      assert.doesNotMatch(
        l,
        /generateLink|token_hash|OTP|hashed_token|verifyOtp/i,
        `technical wording leaked: ${l}`,
      )
    }
  })

  it('the success state names the recipient and warns, in VISIBLE text', () => {
    const panel = read(LINK_PANEL)
    assert.match(panel, /recipient/)
    // A rendered paragraph, not a title/tooltip.
    assert.match(panel, /<p[\s\S]{0,400}?\{t\.usersAccess\.manualLinkSecurityNote\}/)
    assert.match(panel, /copyInviteLink/)
    assert.doesNotMatch(panel, /title=\{t\.usersAccess\.manualLinkSecurityNote\}/)
  })

  it('the security note says both things that matter: bearer risk, and shown once', () => {
    const en = read('src/lib/i18n.ts')
    const note = /manualLinkSecurityNote: '([^']+)'/.exec(en)?.[1] ?? ''
    assert.match(note, /Anyone with this link/i)
    assert.match(note, /not be shown again/i)
  })

  it('the copy control never claims a copy that did not happen', () => {
    const panel = code(read(LINK_PANEL))
    assert.match(panel, /navigator\.clipboard/)
    assert.match(panel, /setCopy\('manual'\)/, 'an unavailable clipboard degrades to manual copy')
    assert.match(panel, /field\?\.select\(\)/)
  })

  it('§20 · the URL field scrolls inside itself and cannot widen the dialog', () => {
    const panel = read(LINK_PANEL)
    assert.match(panel, /readOnly/)
    assert.match(panel, /w-full min-w-0/)
    assert.doesNotMatch(panel, /min-w-\[\d/, 'no fixed minimum width')
    assert.match(panel, /font-mono text-xs/)
    for (const f of [INVITE_DIALOG, MANAGE_DIALOG]) {
      assert.match(read(f), /min-w-0/, `${f} must let the field shrink`)
    }
  })

  it('§20 · uses the existing token vocabulary, no hardcoded colours', () => {
    const panel = read(LINK_PANEL)
    assert.doesNotMatch(panel, /#[0-9a-fA-F]{3,8}\b/, 'no hardcoded hex')
    assert.doesNotMatch(panel, /bg-(white|black|gray-|emerald-|red-)/, 'no raw Tailwind scales')
    assert.match(panel, /var\(--/)
    assert.match(panel, /color-mix\(in oklab/)
  })

  it('the re-invite controls appear only while the account is still invited', () => {
    const src = code(read(MANAGE_DIALOG))
    assert.match(src, /user\.status === 'invited'/)
    assert.match(src, /newInviteLink/)
    assert.match(src, /reinvite\('manual'\)/)
    assert.match(src, /reinvite\('email'\)/)
  })

  it('the stale "invitations are not enabled yet" copy is gone', () => {
    const en = read('src/lib/i18n.ts')
    assert.doesNotMatch(en, /inviteNote:/, 'the CLI-era note no longer describes this product')
    assert.doesNotMatch(en, /Sending invitations is not enabled yet/)
  })

  it('every new key exists in BOTH languages', () => {
    const en = read('src/lib/i18n.ts')
    const keys = [
      'deliveryHeading', 'deliveryManual', 'deliveryEmail', 'deliveryManualNote', 'deliveryEmailNote',
      'createInvite', 'creatingInvite', 'inviteCreated', 'manualLinkBody', 'manualLinkLabel',
      'copyInviteLink', 'inviteLinkCopied', 'inviteLinkCopyManually', 'manualLinkSecurityNote',
      'switchToManualLink', 'newInviteLink', 'errInvalidDelivery',
    ]
    for (const k of keys) {
      const n = [...en.matchAll(new RegExp(`^\\s{6}${k}:`, 'gm'))].length
      assert.equal(n, 2, `${k} must appear once in each dictionary (found ${n})`)
    }
  })
})
