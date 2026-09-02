// R13.6F — THE ACCOUNT LIFECYCLE AS AN AUTHORIZATION INPUT.
//
// MOSTLY BEHAVIOURAL. `isAccountUsable`, `accountStatus`, `moduleAccessOf`,
// `canEnterPlatform` and `decideRequestAccess` are pure and dependency-injected,
// so every case below runs the REAL decision middleware executes, with the
// identity verifier and the authorization-state lookup supplied as functions.
//
// STRUCTURAL ONLY WHERE BEHAVIOUR CANNOT REACH. Four properties live in SQL and
// cannot be executed by this runner: that every authorization function consults
// the usability predicate, that the last-administrator guard is a trigger rather
// than application code, that disabling preserves grants, and that the backfill
// is evidence-based. Those are asserted against comment-stripped migration source,
// and each asserts the PROPERTY rather than a literal. Their executable half lives
// in supabase/tests/database/user_lifecycle_test.sql, which runs against real
// PostgreSQL in CI.
//
// WHAT IS NOT CLAIMED. Nothing here executes SQL or HTTP. PostgreSQL RLS remains
// the authoritative layer underneath every assertion in this file.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isAccountUsable,
  accountStatus,
  lifecycleFromProfile,
  lifecycleForTruthRow,
  LIFECYCLE_TRUTH_TABLE,
  ACCOUNT_STATUSES,
  type AccountLifecycle,
} from '../src/lib/auth/accountLifecycle.ts'
import {
  parseAuthorizationRow,
  moduleAccessOf,
  AUTHORIZATION_STATE_SELECT,
} from '../src/lib/auth/authorizationState.ts'
import { canEnterPlatform, canAccessModule } from '../src/lib/auth/moduleAccess.ts'
import {
  decideRequestAccess,
  shouldClearSession,
  type IdentityVerifier,
  type AccessDecision,
} from '../src/lib/auth/requestAccess.ts'
import { scopesFor } from '../src/lib/portfolioAccess/entitlements.ts'
import { accountStatusOf, accountUsableOf } from '../src/lib/admin/userDirectory.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

/** Strips comments so an assertion cannot be satisfied by prose. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const MIGRATION = read('supabase/migrations/20260817000000_user_lifecycle_provisioning.sql')
const MIGRATION_CODE = code(MIGRATION)

const ACTIVE: AccountLifecycle = {
  approved: true,
  invitedAt: '2026-01-01T00:00:00.000Z',
  activatedAt: '2026-01-02T00:00:00.000Z',
  disabledAt: null,
}

function withLifecycle(over: Partial<AccountLifecycle>): AccountLifecycle {
  return { ...ACTIVE, ...over }
}

function stateFor(over: Partial<AccountLifecycle>, role: string, grants: string[]) {
  const lc = withLifecycle(over)
  const parsed = parseAuthorizationRow('u1', {
    id: 'u1',
    username: lc.approved ? 'someone' : null,
    role,
    invited_at: lc.invitedAt,
    activated_at: lc.activatedAt,
    disabled_at: lc.disabledAt,
    user_module_grants: grants.map((module_key) => ({ module_key })),
  })
  assert.equal(parsed.ok, true)
  assert.notEqual(parsed.state, null)
  return parsed.state!
}

async function decide(
  path: string,
  over: Partial<AccountLifecycle>,
  role: string,
  grants: string[],
): Promise<AccessDecision> {
  const verify: IdentityVerifier = async () => ({ user: { id: 'u1' } })
  return decideRequestAccess(path, verify, async () => ({
    ok: true,
    state: stateFor(over, role, grants),
  }))
}

describe('R13.6F § 3 — the lifecycle rule', () => {
  it('agrees with the shared truth table on every row', () => {
    for (const row of LIFECYCLE_TRUTH_TABLE) {
      const lc = lifecycleForTruthRow(row)
      assert.equal(isAccountUsable(lc), row.usable, `usable: ${row.label}`)
      assert.equal(accountStatus(lc), row.status, `status: ${row.label}`)
    }
  })

  it('the SQL predicate encodes the same three conjuncts', () => {
    // The executable parity check is in the pgTAP suite; this asserts the SQL
    // rule is the same SHAPE, so the two cannot silently diverge in structure.
    const fn = MIGRATION_CODE.match(
      /create or replace function public\.nmi_profile_usable[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.ok(fn, 'nmi_profile_usable is defined')
    assert.match(fn!, /username/i)
    assert.match(fn!, /p_activated_at is not null/i)
    assert.match(fn!, /p_disabled_at\s+is null/i)
  })

  it('is immutable and reads no table', () => {
    const fn = MIGRATION_CODE.match(
      /create or replace function public\.nmi_profile_usable[\s\S]*?\$\$[\s\S]*?\$\$/,
    )?.[0]
    assert.match(fn!, /immutable/i)
    assert.doesNotMatch(fn!, /\bfrom\s+public\./i, 'a pure rule must not read a table')
  })

  it('has exactly four states, and none of them is a boolean flag', () => {
    assert.deepEqual([...ACCOUNT_STATUSES], ['active', 'invited', 'disabled', 'unprovisioned'])
    assert.doesNotMatch(MIGRATION_CODE, /add column if not exists\s+enabled\b/i)
    assert.doesNotMatch(MIGRATION_CODE, /add column if not exists\s+is_active\b/i)
  })

  it('an unreadable disabled_at value is read as DISABLED, never as enabled', () => {
    // The one field where "I do not understand this" must reduce access.
    const lc = lifecycleFromProfile({
      username: 'x',
      activated_at: '2026-01-02T00:00:00.000Z',
      disabled_at: 12345 as unknown,
    })
    assert.equal(isAccountUsable(lc), false)
    assert.equal(accountStatus(lc), 'disabled')
  })

  it('an absent lifecycle (a database behind its code) denies rather than admits', () => {
    const lc = lifecycleFromProfile({ username: 'x' })
    assert.equal(isAccountUsable(lc), false)
  })
})

describe('R13.6F § 4 — usability is the outer gate for every rule', () => {
  it('a DISABLED member holds no module, whatever their grants say', () => {
    const state = stateFor({ disabledAt: '2026-02-01T00:00:00.000Z' }, 'user', [
      'markets',
      'portfolio',
      'structured_notes',
    ])
    const access = moduleAccessOf(state)
    assert.equal(access.isApproved, false)
    assert.equal(canEnterPlatform(access), false)
    for (const m of ['markets', 'portfolio', 'structured_notes']) {
      assert.equal(canAccessModule(access, m), false, m)
    }
  })

  it('a DISABLED administrator is not an administrator', () => {
    const state = stateFor({ disabledAt: '2026-02-01T00:00:00.000Z' }, 'administrator', [])
    const access = moduleAccessOf(state)
    assert.equal(access.isAdministrator, false)
    assert.equal(canEnterPlatform(access), false)
    assert.equal(canAccessModule(access, 'markets'), false)
  })

  it('a NEVER-ACTIVATED member holds no module', () => {
    const state = stateFor({ activatedAt: null }, 'user', ['markets'])
    assert.equal(canEnterPlatform(moduleAccessOf(state)), false)
  })

  it('a DISABLED member gets no Portfolio scope, and the ceiling itself is untouched', () => {
    const state = stateFor({ disabledAt: '2026-02-01T00:00:00.000Z' }, 'user', ['portfolio'])
    const access = moduleAccessOf(state)
    assert.deepEqual(
      scopesFor({ isApproved: access.isApproved, isAdministrator: false, principal: 'jaime' }),
      [],
    )
    // The frozen rule is unchanged — only the fact fed into it.
    assert.deepEqual(scopesFor({ isApproved: true, isAdministrator: false, principal: 'jaime' }), [
      'main',
      'jaime',
      'alternatives',
    ])
  })

  it('the ACTIVE control case still works — the gate is not simply always-deny', () => {
    const state = stateFor({}, 'user', ['markets'])
    const access = moduleAccessOf(state)
    assert.equal(canEnterPlatform(access), true)
    assert.equal(canAccessModule(access, 'markets'), true)
    assert.equal(canAccessModule(access, 'portfolio'), false)
  })

  it('the grant rows survive so reactivation can restore them', () => {
    const state = stateFor({ disabledAt: '2026-02-01T00:00:00.000Z' }, 'user', ['markets', 'macro'])
    assert.deepEqual([...state.grants], ['markets', 'macro'])
  })
})

describe('R13.6F § 4 — request decisions', () => {
  it('a disabled account is denied with its OWN reason, not not_approved', async () => {
    const d = await decide('/portfolio', { disabledAt: '2026-02-01T00:00:00.000Z' }, 'user', [
      'portfolio',
    ])
    assert.equal(d.outcome, 'deny')
    assert.equal(d.outcome === 'deny' && d.reason, 'account_disabled')
    assert.equal(d.outcome === 'deny' && d.status, 403)
  })

  it('an unaccepted invitation is denied with its own reason too', async () => {
    const d = await decide('/portfolio', { activatedAt: null }, 'user', ['portfolio'])
    assert.equal(d.outcome === 'deny' && d.reason, 'account_not_activated')
  })

  it('disabled beats not-activated when both are true', async () => {
    const d = await decide(
      '/portfolio',
      { activatedAt: null, disabledAt: '2026-02-01T00:00:00.000Z' },
      'user',
      ['portfolio'],
    )
    assert.equal(d.outcome === 'deny' && d.reason, 'account_disabled')
  })

  it('a disabled ADMINISTRATOR is denied an administrator-only surface', async () => {
    const d = await decide(
      '/settings/users',
      { disabledAt: '2026-02-01T00:00:00.000Z' },
      'administrator',
      [],
    )
    assert.equal(d.outcome, 'deny')
  })

  it('the four denial reasons stay distinct — none collapses into another', async () => {
    const reasons = new Set<string>()
    const cases: [string, Partial<AccountLifecycle>, string, string[]][] = [
      ['/portfolio', { approved: false }, 'user', []],
      ['/portfolio', { disabledAt: '2026-02-01T00:00:00.000Z' }, 'user', ['portfolio']],
      ['/portfolio', { activatedAt: null }, 'user', ['portfolio']],
      ['/portfolio', {}, 'user', []],
    ]
    for (const [p, lc, role, grants] of cases) {
      const d = await decide(p, lc, role, grants)
      assert.equal(d.outcome, 'deny')
      if (d.outcome === 'deny') reasons.add(d.reason)
    }
    assert.deepEqual(
      [...reasons].sort(),
      ['account_disabled', 'account_not_activated', 'no_platform_access', 'not_approved'],
    )
  })

  it('a disabled session is cleared; an unaccepted invitation is not', async () => {
    const disabled = await decide('/portfolio', { disabledAt: '2026-02-01T00:00:00.000Z' }, 'user', [])
    assert.equal(shouldClearSession(disabled), true)
    const invited = await decide('/portfolio', { activatedAt: null }, 'user', ['portfolio'])
    assert.equal(
      shouldClearSession(invited),
      false,
      'the invitee is mid-acceptance — ending their session would break the flow',
    )
  })

  it('clearing the cookie is not the mechanism: the same state is denied regardless', async () => {
    // Proven by the fact that the denial is produced by the state itself, with no
    // reference to any cookie, on a route that does not clear one.
    const d = await decide('/api/structured-notes', { disabledAt: '2026-02-01T00:00:00.000Z' }, 'user', [
      'structured_notes',
    ])
    assert.equal(d.outcome === 'deny' && d.reason, 'account_disabled')
    assert.equal(d.outcome === 'deny' && d.json, true)
  })
})

describe('R13.6F § 4 — the single-query design is preserved', () => {
  it('the lifecycle columns ride on the SAME select', () => {
    for (const col of ['invited_at', 'activated_at', 'disabled_at']) {
      assert.ok(AUTHORIZATION_STATE_SELECT.includes(col), col)
    }
    assert.ok(AUTHORIZATION_STATE_SELECT.includes('user_module_grants(module_key)'))
  })

  it('no third query was introduced', () => {
    const mw = code(read('src/middleware.ts'))
    const froms = mw.match(/\.from\(/g) ?? []
    assert.equal(froms.length, 1, 'middleware still issues exactly one table read')
  })

  it('a failed read is still a failure, not an empty lifecycle', () => {
    const parsed = parseAuthorizationRow('u1', {
      id: 'u1',
      username: 'x',
      role: 'user',
      user_module_grants: 'not-an-array' as unknown,
    })
    assert.equal(parsed.ok, false)
  })
})

describe('R13.6F § 5 — SQL authorization honours the lifecycle', () => {
  const FUNCTIONS = [
    'nmi_is_administrator',
    'nmi_can_access_module',
    'nmi_current_module_grants',
    'nmi_current_portfolio_scopes',
  ]

  it('every authorization function consults the usability predicate', () => {
    for (const fn of FUNCTIONS) {
      const body = MIGRATION_CODE.match(
        new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`),
      )?.[1]
      assert.ok(body, `${fn} is redefined by the migration`)
      assert.match(body!, /nmi_profile_usable/, `${fn} must consult nmi_profile_usable`)
    }
  })

  it('the frozen pure rules are NOT redefined', () => {
    assert.doesNotMatch(
      MIGRATION_CODE,
      /create or replace function public\.nmi_module_allowed\b/,
      'the module rule must not be rewritten',
    )
    assert.doesNotMatch(
      MIGRATION_CODE,
      /create or replace function public\.nmi_portfolio_scopes\b/,
      'the Portfolio ceiling must not be rewritten',
    )
  })

  it('no RLS policy had to be edited — enforcement is at the predicate', () => {
    assert.doesNotMatch(MIGRATION_CODE, /create policy/i)
    assert.doesNotMatch(MIGRATION_CODE, /drop policy/i)
  })

  it('a disabled caller resolves to an EMPTY grant array in SQL too', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_current_module_grants\b[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /nmi_profile_usable/)
    assert.match(body!, /else\s+array\[\]::text\[\]/i)
  })

  it('every redefined function keeps its hardened posture', () => {
    for (const fn of FUNCTIONS) {
      const decl = MIGRATION_CODE.match(
        new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?as \\$\\$`),
      )?.[0]
      assert.match(decl!, /security definer/i, `${fn} keeps definer rights`)
      assert.match(decl!, /set search_path = ''/i, `${fn} keeps a fixed search_path`)
    }
  })
})

describe('R13.6F § 6 — the last active administrator invariant', () => {
  it('is a database TRIGGER, not application code', () => {
    // The name is anchored at a WORD BOUNDARY on purpose. Non-vacuity break D
    // renamed the trigger to `..._guard_disabled_for_test`, and a bare substring
    // match happily accepted it — a detached guard would have shipped green.
    assert.match(
      MIGRATION_CODE,
      /create trigger user_profiles_last_administrator_guard\b(?!_)/i,
      'the trigger exists under exactly that name',
    )
    assert.match(MIGRATION_CODE, /before update or delete on public\.user_profiles/i)
    // And it must actually be wired to the guard function, not merely declared.
    assert.match(
      MIGRATION_CODE,
      /create trigger user_profiles_last_administrator_guard\b(?!_)[\s\S]{0,160}execute function public\.nmi_guard_last_administrator\(\)/i,
      'and it executes the guard function',
    )
  })

  it('covers delete as well as update', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_guard_last_administrator[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /tg_op = 'DELETE'/)
  })

  it('raises a stable, bare token carrying no user data', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_guard_last_administrator[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /raise exception 'last_administrator'/)
    // No interpolation of a name, email or id into the raised message.
    assert.doesNotMatch(body!, /raise exception 'last_administrator[^']*%/)
  })

  it('counts the resulting population rather than checking "is this me"', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_guard_last_administrator[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /count\(\*\)/i)
    assert.match(body!, /p\.id <> old\.id/)
    // Self-disable is covered by the same rule, so no separate "is this the
    // caller" branch is needed — and its absence is the point.
    assert.doesNotMatch(body!, /auth\.uid\(\)/)
  })

  it('is not solved by creating a hidden second administrator', () => {
    assert.doesNotMatch(MIGRATION_CODE, /insert into public\.user_profiles[\s\S]{0,300}administrator/i)
  })

  it('the API surfaces it as a conflict, not a generic failure', () => {
    const rpc = code(read('src/lib/admin/adminRpc.ts'))
    assert.match(rpc, /last_administrator:\s*409/)
  })
})

describe('R13.6F § 3 — the backfill is evidence-based', () => {
  it('prefers real sign-in history over an invented date', () => {
    const backfill = MIGRATION_CODE.match(/update public\.user_profiles p[\s\S]*?;/)?.[0]
    assert.ok(backfill)
    assert.match(backfill!, /last_sign_in_at/)
    assert.match(backfill!, /email_confirmed_at/)
    assert.doesNotMatch(backfill!, /now\(\)/, 'no arbitrary now() activation date')
  })

  it('only touches approved rows, and only where the column is empty', () => {
    const backfill = MIGRATION_CODE.match(/update public\.user_profiles p[\s\S]*?;/)?.[0]
    assert.match(backfill!, /p\.activated_at is null/)
    assert.match(backfill!, /btrim\(p\.username/)
  })

  it('does NOT fabricate an invitation that never happened', () => {
    const backfill = MIGRATION_CODE.match(/update public\.user_profiles p[\s\S]*?;/)?.[0]
    assert.doesNotMatch(backfill!, /invited_at\s*=/)
  })

  it('asserts the administrator survives, or fails loudly', () => {
    assert.match(MIGRATION_CODE, /administrator\(s\) unusable/)
    assert.match(MIGRATION_CODE, /backfill incomplete/)
  })

  it('rewrites no identity or authorization value', () => {
    const backfill = MIGRATION_CODE.match(/update public\.user_profiles p[\s\S]*?;/)?.[0]
    for (const col of ['username', 'email', 'display_name', 'role', 'portfolio_principal']) {
      assert.doesNotMatch(backfill!, new RegExp(`set[\\s\\S]*\\b${col}\\s*=`), col)
    }
  })
})

describe('R13.6F § 18 — disable preserves, reactivate restores', () => {
  it('disabling writes only disabled_at', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_admin_set_lifecycle[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /set disabled_at = now\(\)/)
    assert.doesNotMatch(body!, /delete from public\.user_module_grants/)
    assert.doesNotMatch(body!, /set role\s*=/)
    assert.doesNotMatch(body!, /portfolio_principal\s*=/)
  })

  it('reactivating clears ONLY disabled_at', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_admin_set_lifecycle[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /set disabled_at = null/)
    assert.doesNotMatch(body!, /set activated_at = null/)
  })

  it('both directions are audited', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_admin_set_lifecycle[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /'user_disable'/)
    assert.match(body!, /'user_reactivate'/)
  })

  it('a reactivated zero-grant member still cannot enter', () => {
    const state = stateFor({}, 'user', [])
    assert.equal(canEnterPlatform(moduleAccessOf(state)), false)
  })
})

describe('R13.6F § 12 — activation', () => {
  it('takes no target id at all', () => {
    const decl = MIGRATION_CODE.match(
      /create or replace function public\.nmi_activate_current_user\s*\(([^)]*)\)/,
    )?.[1]
    assert.equal((decl ?? '').trim(), '', 'the function must accept no parameters')
  })

  it('resolves the account from auth.uid()', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_activate_current_user[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /auth\.uid\(\)/)
  })

  it('is idempotent and refuses a disabled account', () => {
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_activate_current_user[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.match(body!, /'changed', false/)
    assert.match(body!, /raise exception 'account_disabled'/)
  })

  it('the callback calls it with no argument object carrying a user id', () => {
    const cb = code(read('src/app/auth/callback/route.ts'))
    assert.match(cb, /nmi_activate_current_user/)
    assert.doesNotMatch(
      cb,
      /nmi_activate_current_user'[^)]*user_id/,
      'the callback must not pass a target',
    )
  })
})

describe('R13.6F § 21 — disabled and zero-grant are different conditions', () => {
  it('the directory reports them separately', () => {
    const activeNoGrants = { username: 'x', activated_at: '2026-01-02T00:00:00.000Z', disabled_at: null }
    assert.equal(accountStatusOf(activeNoGrants), 'active')
    assert.equal(accountUsableOf(activeNoGrants), true)
    const access = moduleAccessOf(stateFor({}, 'user', []))
    assert.equal(canEnterPlatform(access), false, 'no platform access — but NOT disabled')

    const disabled = { username: 'x', activated_at: '2026-01-02T00:00:00.000Z', disabled_at: '2026-02-01T00:00:00.000Z' }
    assert.equal(accountStatusOf(disabled), 'disabled')
    assert.equal(accountUsableOf(disabled), false)
  })

  it('an invited account is neither active nor disabled', () => {
    assert.equal(accountStatusOf({ username: 'x', invited_at: '2026-01-01T00:00:00.000Z' }), 'invited')
  })

  it('a row with nothing at all is honestly "unprovisioned"', () => {
    assert.equal(accountStatusOf({}), 'unprovisioned')
    assert.equal(accountStatusOf(null), 'unprovisioned')
  })

  it('the login page tells the two apart in both languages', () => {
    const i18n = read('src/lib/i18n.ts')
    for (const key of ['errAccountDisabled', 'errAccountNotActivated']) {
      assert.ok(i18n.split(key).length - 1 >= 2, `${key} exists in EN and ES`)
    }
    const page = code(read('src/app/(auth)/login/page.tsx'))
    assert.match(page, /case 'account_disabled':/)
    assert.match(page, /case 'account_not_activated':/)
  })
})

describe('R13.6F § 19 — permanent delete is DEFERRED, on evidence', () => {
  const AUDIT = read('supabase/migrations/20260806000000_family_portfolio_entitlements.sql')

  it('the audit trail CASCADES on user delete — so deleting destroys history', () => {
    // This is the finding that decided the disposition. §19 permits a permanent
    // "delete invitation" only if it can be proven that no historical audit row is
    // lost. It cannot: the trail is keyed to `auth.users` with ON DELETE CASCADE.
    assert.match(
      AUDIT,
      /target_user_id\s+uuid\s+not null references auth\.users\(id\) on delete cascade/,
    )
  })

  it('...and an invited account already HAS audit rows to lose', () => {
    // A never-activated invitation is not a blank record: provisioning writes a
    // user_invite row, one module_grant row per granted module, and a principal
    // row. Deleting the identity would erase the evidence that the invitation was
    // ever issued, and by whom.
    const body = MIGRATION_CODE.match(
      /create or replace function public\.nmi_admin_provision_invite[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    const inserts = (body!.match(/insert into public\.family_portfolio_access_audit/g) ?? []).length
    assert.ok(inserts >= 2, `the invite writes ${inserts} kinds of audit row`)
  })

  it('an actor FK additionally RESTRICTS deleting anyone who has administered', () => {
    assert.match(AUDIT, /actor_user_id\s+uuid\s+references auth\.users\(id\) on delete restrict/)
  })

  it('NO delete endpoint was shipped', () => {
    // The disposition is enforced by absence, not by a disabled button.
    const routes = [
      'src/app/api/admin/users/route.ts',
      'src/app/api/admin/users/[id]/route.ts',
      'src/app/api/admin/users/[id]/lifecycle/route.ts',
      'src/app/api/admin/users/[id]/invitation/route.ts',
      'src/app/api/admin/users/[id]/modules/route.ts',
    ]
    for (const f of routes) {
      assert.doesNotMatch(code(read(f)), /export async function DELETE/, f)
    }
  })

  it('and no audit foreign key was weakened to make deletion convenient', () => {
    // The tempting "fix" would be to relax the cascade. §19 forbids it explicitly,
    // and the migration does not touch the audit table's keys at all.
    assert.doesNotMatch(MIGRATION_CODE, /drop constraint[\s\S]{0,80}target_user_id/i)
    assert.doesNotMatch(MIGRATION_CODE, /alter[\s\S]{0,120}on delete (set null|no action)/i)
  })

  it('the ONLY delete is the compensating one, and it is confined to failure recovery', () => {
    const orch = code(read('src/lib/admin/inviteOrchestration.ts'))
    // It runs only when provisioning FAILED and therefore rolled back — so there
    // are no audit rows, no profile and no grants for a cascade to reach.
    assert.match(orch, /if \(existedBefore\) return 'preserved'/)
    assert.match(orch, /profileExists/)
    assert.match(orch, /hasProfile !== false\) return 'orphaned'/)
    // And it is never reachable from a success path. Bounded to the tail of
    // `runInvite` itself — slicing to end-of-file would run into `compensate`'s own
    // body and make the assertion meaningless.
    const start = orch.indexOf('const send = await ports.sendInvite')
    const end = orch.indexOf('async function compensate')
    assert.ok(start > 0 && end > start, 'the success tail is locatable')
    assert.doesNotMatch(orch.slice(start, end), /deleteAuthUser/)

    // The compensating call has exactly ONE call site, inside the failure branch.
    assert.equal((orch.match(/ports\.deleteAuthUser\(/g) ?? []).length, 1)
  })
})

describe('R13.6F — regression: the frozen contracts', () => {
  it('the module registry is untouched by this migration', () => {
    assert.doesNotMatch(MIGRATION_CODE, /insert into public\.app_modules/i)
    assert.doesNotMatch(MIGRATION_CODE, /delete from public\.app_modules/i)
    assert.match(MIGRATION_CODE, /the module registry changed/)
  })

  it('the Portfolio ceiling is asserted unchanged inside the migration', () => {
    assert.match(MIGRATION_CODE, /nmi_portfolio_scopes\(true, false, 'jaime'\)/)
    assert.match(MIGRATION_CODE, /ceiling changed/)
  })

  it('default_for_member is never consulted by an authorization function', () => {
    for (const fn of ['nmi_can_access_module', 'nmi_current_module_grants', 'nmi_profile_usable']) {
      const body = MIGRATION_CODE.match(
        new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`),
      )?.[1]
      assert.doesNotMatch(body ?? '', /default_for_member/, fn)
    }
    const rule = code(read('src/lib/auth/moduleAccess.ts'))
    assert.doesNotMatch(rule, /default_for_member/)
  })

  it('user_profiles stays administrator-controlled', () => {
    assert.match(MIGRATION_CODE, /authenticated must not be able to write user_profiles/)
    assert.doesNotMatch(MIGRATION_CODE, /grant (insert|update|delete)[\s\S]{0,60}user_profiles to authenticated/i)
  })

  it('the audit table gains kinds but no mutation policy', () => {
    for (const kind of ['user_invite', 'user_activate', 'user_disable', 'user_reactivate']) {
      assert.ok(MIGRATION_CODE.includes(`'${kind}'`), kind)
    }
    assert.match(MIGRATION_CODE, /must have NO mutation policy/)
  })

  it('no second access-audit table is introduced', () => {
    assert.doesNotMatch(MIGRATION_CODE, /create table[\s\S]{0,80}audit/i)
  })
})
