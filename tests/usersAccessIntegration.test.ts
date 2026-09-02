// POST-R13.6CDE — Users & Access, module-aware navigation, and the Overview
// entitlement boundary.
//
// TWO KINDS OF TEST LIVE HERE, DELIBERATELY.
//
//   1. BEHAVIOURAL tests over the pure decision layers — `decideGrantChange`,
//      `normalizeRequestedModules`, `visibleNavGroups`, `portfolioLandingHref`,
//      `parseEffectiveAccess`, `accountStatusOf`. These execute the real rules
//      for real inputs, including the whole (principal x grant subset) matrix.
//
//   2. STRUCTURAL tests over the route and component source. These exist
//      because the authorization boundary on the admin path is the ORDER of two
//      statements — guard, then service-role client — and no unit test of a pure
//      function can observe that ordering. Where a structural assertion is used,
//      it asserts the property (the guard precedes the first admin-client use),
//      not a literal.
//
// WHAT IS NOT CLAIMED. Nothing here executes SQL. The migration added by this
// stage is validated by its own in-database postconditions when CI applies the
// chain; until that has run, no database-level claim in this file is asserted.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  decideGrantChange,
  normalizeRequestedModules,
  buildGrantAuditEntries,
  accountStatusOf, accountUsableOf,
  ACCOUNT_STATUSES,
} from '../src/lib/admin/userDirectory.ts'
import { APP_MODULE_KEYS, type ModuleKey } from '../src/lib/auth/moduleAccess.ts'
import {
  parseEffectiveAccess,
  hasModule,
  portfolioLandingHref,
  NO_ACCESS,
  type EffectiveAccess,
} from '../src/lib/auth/effectiveAccess.ts'
import { visibleNavGroups, navGroups, type NavGroupKey } from '../src/lib/navigation.ts'
import { scopesFor } from '../src/lib/portfolioAccess/entitlements.ts'
import { portfolioVisibleScopes } from '../src/lib/portfolioAccess/portfolioModuleComposition.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Source with comments stripped, so a comment can never satisfy an assertion. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const USERS_ROUTE = read('src/app/api/admin/users/route.ts')
const MODULES_ROUTE = read('src/app/api/admin/users/[id]/modules/route.ts')
const ME_ROUTE = read('src/app/api/me/access/route.ts')
const USERS_PAGE = read('src/app/settings/users/page.tsx')
const SETTINGS_CARD = read('src/app/settings/UsersAccessCard.tsx')
// R13.6F — the console is no longer ONE file.
//
// The manage flow moved out of `UsersAccessClient.tsx` into `ManageUserDialog.tsx`
// (and the shared role/principal/module fieldset into `AccountAccessFields.tsx`)
// when invitation, role, principal and lifecycle editing were added: a single
// component holding all of it would have been unreadable.
//
// The assertions below are about the CONSOLE'S BEHAVIOUR, not about which file
// happens to hold a line, so they scan the whole surface. Scanning the set rather
// than re-pointing each assertion at a specific new file also means a future
// refactor that moves a control again cannot quietly make one of them vacuous.
const CONSOLE_FILES = [
  'src/app/settings/users/UsersAccessClient.tsx',
  'src/app/settings/users/ManageUserDialog.tsx',
  'src/app/settings/users/InviteUserDialog.tsx',
  'src/app/settings/users/AccountAccessFields.tsx',
] as const
const CONSOLE = CONSOLE_FILES.map(read).join(String.fromCharCode(10))
const HOME = read('src/app/page.tsx')
const SN_LIST = read('src/app/structured-notes/page.tsx')
const SN_DETAIL = read('src/app/structured-notes/[id]/page.tsx')
const SCOPES_ROUTE = read('src/app/api/family-portfolio/scopes/route.ts')
const AUDIT_MIGRATION = read('supabase/migrations/20260816000000_module_grant_audit.sql')
const DIRECTORY = read('src/lib/admin/userDirectory.ts')

const ADMIN_ACTOR = { userId: 'admin-1', isApproved: true, isAdministrator: true }

function member(modules: ModuleKey[], over: Partial<EffectiveAccess> = {}): EffectiveAccess {
  return {
    status: 'ok',
    isApproved: true,
    isAdministrator: false,
    modules,
    portfolioScopes: [],
    principal: null,
    ...over,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · A — module grant changes are administrator-only', () => {
  const base = {
    targetUserId: 'member-1',
    targetExists: true,
    targetIsApproved: true,
    targetIsAdministrator: false,
    currentModules: [] as string[],
    requestedModules: ['markets'],
  }

  it('refuses a member actor', () => {
    const d = decideGrantChange({
      ...base,
      actor: { userId: 'member-1', isApproved: true, isAdministrator: false },
    })
    assert.equal(d.allowed, false)
    assert.equal(d.allowed === false && d.code, 'actor_not_administrator')
  })

  it('refuses an unapproved actor even with the administrator role', () => {
    const d = decideGrantChange({
      ...base,
      actor: { userId: 'a', isApproved: false, isAdministrator: true },
    })
    assert.equal(d.allowed === false && d.code, 'actor_not_administrator')
  })

  it('refuses a missing or malformed actor', () => {
    for (const actor of [null, { userId: null, isApproved: true, isAdministrator: true }, { userId: '  ', isApproved: true, isAdministrator: true }]) {
      const d = decideGrantChange({ ...base, actor })
      assert.equal(d.allowed === false && d.code, 'actor_not_administrator')
    }
  })

  it('authorizes the ACTOR before it looks at the target', () => {
    // A non-existent target with an unauthorized actor must report the ACTOR
    // problem: otherwise the denial code leaks whether a guessed id is real.
    const d = decideGrantChange({
      ...base,
      actor: { userId: 'm', isApproved: true, isAdministrator: false },
      targetExists: false,
    })
    assert.equal(d.allowed === false && d.code, 'actor_not_administrator')
  })

  it('allows an approved administrator', () => {
    const d = decideGrantChange({ ...base, actor: ADMIN_ACTOR })
    assert.equal(d.allowed, true)
    assert.deepEqual(d.allowed === true && d.toGrant, ['markets'])
  })
})

describe('POST-R13.6CDE · B — only real modules may be granted', () => {
  it('accepts exactly the seven declared keys', () => {
    assert.deepEqual(normalizeRequestedModules([...APP_MODULE_KEYS]), [...APP_MODULE_KEYS])
  })

  it('REJECTS a principal name — a cross-person grant is not a module', () => {
    for (const bad of ['jaime', 'andres', 'pablo', 'main']) {
      assert.equal(normalizeRequestedModules(['markets', bad]), null, bad)
    }
  })

  it('REJECTS the administrator capabilities that are deliberately not modules', () => {
    for (const bad of ['portfolio_admin', 'notification_recipients', 'overview', 'settings', 'news']) {
      assert.equal(normalizeRequestedModules([bad]), null, bad)
    }
  })

  it('rejects rather than silently dropping an unknown entry', () => {
    // Dropping it would answer "saved" while ignoring part of the request, so
    // the administrator would believe they had configured access they had not.
    assert.equal(normalizeRequestedModules(['markets', 'nonsense']), null)
    assert.equal(normalizeRequestedModules(['markets', 42]), null)
    assert.equal(normalizeRequestedModules('markets'), null)
    assert.equal(normalizeRequestedModules(null), null)
  })

  it('normalises order and duplicates', () => {
    assert.deepEqual(normalizeRequestedModules(['macro', 'markets', 'macro']), ['markets', 'macro'])
  })

  it('surfaces an invalid module as a denial, not a partial write', () => {
    const d = decideGrantChange({
      actor: ADMIN_ACTOR,
      targetUserId: 'm',
      targetExists: true,
      targetIsApproved: true,
      targetIsAdministrator: false,
      currentModules: [],
      requestedModules: ['markets', 'pablo'],
    })
    assert.equal(d.allowed === false && d.code, 'invalid_module')
  })
})

describe('POST-R13.6CDE · C — target guards', () => {
  const admin = { actor: ADMIN_ACTOR, targetUserId: 'm', currentModules: [] as string[], requestedModules: ['markets'] }

  it('refuses a target that does not exist', () => {
    const d = decideGrantChange({ ...admin, targetExists: false, targetIsApproved: true, targetIsAdministrator: false })
    assert.equal(d.allowed === false && d.code, 'target_not_found')
  })

  it('refuses an unapproved target — a grant on an unusable account is dormant', () => {
    const d = decideGrantChange({ ...admin, targetExists: true, targetIsApproved: false, targetIsAdministrator: false })
    assert.equal(d.allowed === false && d.code, 'target_not_approved')
  })

  it('refuses an administrator target rather than storing rows that mean nothing', () => {
    const d = decideGrantChange({ ...admin, targetExists: true, targetIsApproved: true, targetIsAdministrator: true })
    assert.equal(d.allowed === false && d.code, 'target_is_administrator')
  })

  it('refuses a malformed target id', () => {
    for (const id of [null, '', '   ', 7]) {
      const d = decideGrantChange({ ...admin, targetUserId: id, targetExists: true, targetIsApproved: true, targetIsAdministrator: false })
      assert.equal(d.allowed === false && d.code, 'invalid_target', String(id))
    }
  })
})

describe('POST-R13.6CDE · D — the diff is exact', () => {
  const t = (current: string[], requested: string[]) =>
    decideGrantChange({
      actor: ADMIN_ACTOR,
      targetUserId: 'm',
      targetExists: true,
      targetIsApproved: true,
      targetIsAdministrator: false,
      currentModules: current,
      requestedModules: requested,
    })

  it('grants only what is newly requested', () => {
    const d = t(['markets'], ['markets', 'macro'])
    assert.deepEqual(d.allowed === true && d.toGrant, ['macro'])
    assert.deepEqual(d.allowed === true && d.toRevoke, [])
  })

  it('revokes only what was dropped', () => {
    const d = t(['markets', 'macro'], ['markets'])
    assert.deepEqual(d.allowed === true && d.toGrant, [])
    assert.deepEqual(d.allowed === true && d.toRevoke, ['macro'])
  })

  it('reports an identical set as unchanged — no write, no audit row', () => {
    const d = t(['macro', 'markets'], ['markets', 'macro'])
    assert.equal(d.allowed === true && d.changed, false)
    assert.deepEqual(buildGrantAuditEntries(d, 'admin-1'), [])
  })

  it('revoking everything is expressible', () => {
    const d = t([...APP_MODULE_KEYS], [])
    assert.deepEqual(d.allowed === true && d.toRevoke, [...APP_MODULE_KEYS])
  })

  it('ignores an unrecognised STORED grant rather than trying to revoke it', () => {
    // A row naming a module this build does not know cannot be acted on here;
    // it must not cause a spurious revoke of something else.
    const d = t(['markets', 'legacy_thing'], ['markets'])
    assert.equal(d.allowed === true && d.changed, false)
  })
})

describe('POST-R13.6CDE · E — the audit trail', () => {
  it('records one row per module actually changed, with both directions', () => {
    const d = decideGrantChange({
      actor: ADMIN_ACTOR,
      targetUserId: 'member-9',
      targetExists: true,
      targetIsApproved: true,
      targetIsAdministrator: false,
      currentModules: ['macro'],
      requestedModules: ['markets'],
    })
    const rows = buildGrantAuditEntries(d, 'admin-1')
    assert.equal(rows.length, 2)
    const granted = rows.find((r) => r.module_key === 'markets')!
    const revoked = rows.find((r) => r.module_key === 'macro')!
    assert.equal(granted.previous_value, 'revoked')
    assert.equal(granted.new_value, 'granted')
    assert.equal(revoked.previous_value, 'granted')
    assert.equal(revoked.new_value, 'revoked')
    for (const r of rows) {
      assert.equal(r.target_user_id, 'member-9')
      assert.equal(r.actor_user_id, 'admin-1')
      assert.equal(r.actor_kind, 'administrator')
      assert.equal(r.field_changed, 'module_grant')
    }
  })

  it('never records a denial as a change', () => {
    const d = decideGrantChange({
      actor: { userId: 'm', isApproved: true, isAdministrator: false },
      targetUserId: 'x',
      targetExists: true,
      targetIsApproved: true,
      targetIsAdministrator: false,
      currentModules: [],
      requestedModules: ['markets'],
    })
    assert.deepEqual(buildGrantAuditEntries(d, 'admin-1'), [])
  })

  it('extends the EXISTING trail rather than creating a second one', () => {
    assert.ok(AUDIT_MIGRATION.includes('family_portfolio_access_audit'))
    assert.ok(!/create table[\s\S]{0,80}module_grant_audit/i.test(AUDIT_MIGRATION))
    assert.ok(AUDIT_MIGRATION.includes("'module_grant'"))
    assert.ok(AUDIT_MIGRATION.includes('references public.app_modules(module_key)'))
  })

  it('binds module_key to the kind in BOTH directions', () => {
    assert.ok(AUDIT_MIGRATION.includes("field_changed = 'module_grant' and module_key is not null"))
    assert.ok(AUDIT_MIGRATION.includes("field_changed <> 'module_grant' and module_key is null"))
  })

  it('keeps the audit table service-role-write-only', () => {
    assert.ok(AUDIT_MIGRATION.includes('must have NO mutation policy'))
    assert.ok(AUDIT_MIGRATION.includes("has_table_privilege('authenticated', 'public.family_portfolio_access_audit', 'INSERT')"))
  })

  it('re-asserts the ceiling and the registry it must not touch', () => {
    assert.ok(AUDIT_MIGRATION.includes("nmi_portfolio_scopes(true, false, 'jaime')"))
    assert.ok(AUDIT_MIGRATION.includes('count(*) from public.app_modules'))
  })

  it('carries no financial value', () => {
    assert.ok(!/amount|notional|balance|price|value_clp/i.test(code(DIRECTORY)))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · F — the admin routes authorize before reading', () => {
  for (const [name, src] of [['users list', USERS_ROUTE], ['module write', MODULES_ROUTE]] as const) {
    it(`${name}: the administrator guard precedes the first service-role use`, () => {
      const c = code(src)
      const guard = c.indexOf('guardAdministrator()')
      const admin = c.indexOf('getSupabaseAdminClient()')
      assert.notEqual(guard, -1, 'no administrator guard')
      assert.notEqual(admin, -1, 'expected the service-role client')
      assert.ok(guard < admin, 'the guard must run BEFORE the service-role client is obtained')
    })

    it(`${name}: returns immediately on denial`, () => {
      assert.match(code(src), /const denied = await guardAdministrator\(\)\s*\n\s*if \(denied\) return denied/)
    })

    it(`${name}: never derives authority from user_metadata or a header`, () => {
      const c = code(src)
      assert.ok(!c.includes('user_metadata'))
      assert.ok(!c.includes("headers()"))
      assert.ok(!/searchParams\.get\(['"]user/.test(c))
    })

    it(`${name}: no module guard stands in for the administrator check`, () => {
      // A module grant answers "may I reach this", never "may I administer".
      assert.ok(!code(src).includes('guardModuleRead'))
    })
  }

  it('the list route selects a narrow column list, never *', () => {
    // R13.6F widened this by exactly the three lifecycle columns, which the
    // directory needs to tell Invited from Active from Disabled. The property is
    // unchanged — an explicit list, no wildcard — so it is asserted as a property
    // rather than as one frozen string that has to be retyped on every change.
    const m = USERS_ROUTE.match(/\.select\('([^']+)'\)/)
    assert.ok(m, 'the list route uses an explicit column list')
    const columns = m![1].split(',').map((c) => c.trim())
    assert.ok(!/\.select\(['"]\*['"]\)/.test(USERS_ROUTE), 'never select *')
    for (const required of [
      'id', 'email', 'display_name', 'username', 'role', 'portfolio_principal',
      'invited_at', 'activated_at', 'disabled_at',
    ]) {
      assert.ok(columns.includes(required), `${required} must be read`)
    }
    assert.ok(!columns.includes('preferences'), 'no column the console does not use')
  })

  it('the list route never returns a secret or preferences blob', () => {
    const c = code(USERS_ROUTE)
    for (const forbidden of ['password', 'access_token', 'refresh_token', 'preferences', 'service_role_key']) {
      assert.ok(!c.includes(forbidden), forbidden)
    }
  })

  it('a failed grant read is an error, never an empty access set', () => {
    // Rendering "nobody holds anything" would invite an administrator to revoke
    // access that was never actually granted away.
    assert.ok(USERS_ROUTE.includes('if (grantsRes.error)'))
    assert.match(USERS_ROUTE, /grantsRes\.error[\s\S]{0,200}status: 500/)
  })

  it('the write route takes a complete set and diffs it inside ONE transaction', () => {
    // R13.6F moved the diff from the route into PostgreSQL, deliberately.
    //
    // The old shape issued an INSERT, then a DELETE, then an audit INSERT as three
    // independent statements, and reported `audited: false` with a 200 when the
    // last one failed — so "access changed, audit missing" was a representable
    // outcome. `nmi_admin_update_access` performs the grant changes AND their
    // audit rows in one transaction, so the property asserted here is now the
    // stronger one: the route sends the complete desired set and lets the database
    // reconcile it atomically.
    assert.ok(MODULES_ROUTE.includes('nmi_admin_update_access'), 'writes through the transactional RPC')
    assert.ok(MODULES_ROUTE.includes('p_modules'), 'sends the complete desired set')
    // The separate statements are GONE — the route must not write grants itself.
    const c = code(MODULES_ROUTE)
    assert.ok(!/from\('user_module_grants'\)/.test(c), 'no direct grant table write remains')
    assert.ok(!/from\('family_portfolio_access_audit'\)/.test(c), 'no separate audit insert remains')
  })

  it('the write route writes nothing when nothing changed', () => {
    assert.match(MODULES_ROUTE, /if \(!changed\)[\s\S]{0,200}changed: false/)
  })

  it('the write route never widens a denial into a success', () => {
    // Every refusal — the route's own preconditions and the database's — returns
    // the refusal's status, never a 200.
    assert.match(MODULES_ROUTE, /target_not_found[\s\S]{0,80}status: 404/)
    assert.match(MODULES_ROUTE, /target_not_approved[\s\S]{0,80}status: 409/)
    assert.match(MODULES_ROUTE, /target_is_administrator[\s\S]{0,80}status: 409/)
    // An RPC refusal is classified, and its status is what is returned.
    assert.match(MODULES_ROUTE, /classifyRpcError\(error\)[\s\S]{0,220}status(,| )/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · G — /settings/users is refused server-side', () => {
  it('the page is a server component that checks administrator status first', () => {
    assert.ok(!USERS_PAGE.includes("'use client'"))
    assert.ok(USERS_PAGE.includes('callerIsPlatformAdministrator()'))
    assert.match(code(USERS_PAGE), /if \(!\(await callerIsPlatformAdministrator\(\)\)\) return/)
  })

  it('a denied caller never receives the console component', () => {
    const c = code(USERS_PAGE)
    const guard = c.indexOf('callerIsPlatformAdministrator')
    const render = c.indexOf('<UsersAccessClient')
    assert.ok(guard < render, 'the check must precede the console render')
  })

  it('the Settings entry hides for a non-administrator and is not the protection', () => {
    assert.ok(SETTINGS_CARD.includes('!access.isAdministrator) return null'))
    assert.ok(SETTINGS_CARD.includes('!ready'), 'must render nothing while access is unresolved')
  })

  it('the console never re-implements an authorization decision', () => {
    const c = code(CONSOLE)
    assert.ok(!c.includes('user_metadata'))
    assert.ok(!c.includes('getSupabaseAdminClient'))
    assert.ok(!c.includes('isAdministrator ='), 'must not compute administrator status locally')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · H — the checkbox grid mirrors stored rows', () => {
  it('never consults default_for_member', () => {
    // That column is provisioning metadata. Rendering it would draw a checkbox
    // meaning something the authorization layer does not believe. Compared
    // against comment-stripped source: several of these files EXPLAIN why they
    // do not use it, and an explanation must not fail the check it documents.
    // R13.6F — the LIST and WRITE paths still must never mention it: those decide
    // and report access, and a default has no standing there.
    for (const [name, src] of [['list', USERS_ROUTE], ['write', MODULES_ROUTE]] as const) {
      assert.ok(!code(src).includes('default_for_member'), name)
    }

    // The console now legitimately reads it in ONE place — pre-ticking the switches
    // on a NEW member's invitation form (§7). That is provisioning metadata used as
    // provisioning metadata. The property protected here is that it stays confined
    // to that: it appears only in the invite dialog, and never in the directory,
    // the manage dialog, or the shared access fieldset, where it could look like a
    // statement about what an EXISTING account holds.
    const invite = code(read('src/app/settings/users/InviteUserDialog.tsx'))
    assert.ok(invite.includes('defaultModulesForNewMember'), 'the invite form seeds from the helper')
    for (const f of [
      'src/app/settings/users/UsersAccessClient.tsx',
      'src/app/settings/users/ManageUserDialog.tsx',
      'src/app/settings/users/AccountAccessFields.tsx',
    ]) {
      assert.ok(!code(read(f)).includes('default_for_member'), f)
      assert.ok(!code(read(f)).includes('defaultModulesForNewMember'), f)
    }
  })

  it('a failed save re-reads authoritative state on every path', () => {
    // R13.6F moved the manage flow into its own dialog, whose draft is local state
    // re-seeded from the directory row each time it opens - so "discard the draft"
    // is now structural rather than an explicit reset. The property that matters is
    // unchanged and is what is asserted: no path through save() leaves the console
    // showing an optimistic value, because every one re-reads the server.
    const dialog = code(read('src/app/settings/users/ManageUserDialog.tsx'))
    const save = dialog.slice(dialog.indexOf('async function save()'))
    const body = save.slice(0, save.indexOf('\n  }'))
    assert.ok(body.includes('setError('), 'a failure is surfaced, never swallowed')
    const reloads = (body.match(/await reload\(\)/g) ?? []).length
    assert.ok(reloads >= 3, `every path re-reads authoritative state (found ${reloads})`)
  })

  it('offers no usable module switches for an administrator target', () => {
    // An administrator holds every module by role, so a switch there would imply a
    // grant that does not exist and is never consulted.
    const fields = code(read('src/app/settings/users/AccountAccessFields.tsx'))
    assert.match(fields, /disabled=\{[^}]*isAdmin[^}]*\}/, 'the switches are disabled for an administrator')
    assert.ok(fields.includes('adminBypassNote'), 'and the full-access reason is stated')
  })

  it('presents portfolio scope as a locked statement, never as controls', () => {
    // The ceiling is frozen, and the console must not appear to offer it for
    // editing. R13.6F renders it as the immutable ceiling plus the effective result.
    const fields = code(read('src/app/settings/users/AccountAccessFields.tsx'))
    assert.ok(fields.includes('ceilingLabel'), 'the immutable ceiling is stated')
    assert.ok(fields.includes('principalCeiling'), 'and it comes from the frozen rule')
    assert.ok(fields.includes('projectedPortfolioScopes'), 'the effective result is composed, not typed')
    // No control may be bound to a scope, anywhere on the console surface.
    assert.ok(!/type="checkbox"[\s\S]{0,200}portfolioScopes/.test(CONSOLE))
    assert.ok(!/portfolioScopes[\s\S]{0,200}type="checkbox"/.test(CONSOLE))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · I — navigation follows effective access', () => {
  it('Overview and Settings are always visible to an approved account', () => {
    const keys = visibleNavGroups(member([])).map((g) => g.key)
    assert.deepEqual(keys, ['overview', 'settings'])
  })

  it('an unresolved / unauthenticated snapshot shows no module', () => {
    const keys = visibleNavGroups(NO_ACCESS).map((g) => g.key)
    assert.deepEqual(keys, ['overview', 'settings'])
  })

  it('each module reveals exactly its own group', () => {
    const expected: Record<string, NavGroupKey> = {
      markets: 'markets',
      analysis: 'analysis',
      macro: 'macro',
      earnings: 'earnings',
      structured_notes: 'structuredNotes',
    }
    for (const [mod, key] of Object.entries(expected)) {
      const keys = visibleNavGroups(member([mod as ModuleKey])).map((g) => g.key)
      assert.ok(keys.includes(key), `${mod} should reveal ${key}`)
      // ...and nothing else beyond the always-on pair.
      assert.deepEqual(keys.filter((k) => k !== 'overview' && k !== 'settings'), [key])
    }
  })

  it('an administrator sees every group', () => {
    const admin: EffectiveAccess = {
      status: 'ok',
      isApproved: true,
      isAdministrator: true,
      modules: [...APP_MODULE_KEYS],
      portfolioScopes: ['main', 'jaime', 'andres', 'pablo', 'alternatives', 'admin'],
      principal: null,
    }
    assert.deepEqual(
      visibleNavGroups(admin).map((g) => g.key),
      navGroups.map((g) => g.key),
    )
  })

  it('Portfolio appears for portfolio OR alternatives, and routes accordingly', () => {
    const both = visibleNavGroups(member(['portfolio', 'alternatives'])).find((g) => g.key === 'portfolio')
    assert.equal(both?.href, '/portfolio')

    const onlyPortfolio = visibleNavGroups(member(['portfolio'])).find((g) => g.key === 'portfolio')
    assert.equal(onlyPortfolio?.href, '/portfolio')

    // The case the module split exists for: Alternatives alone must still be
    // reachable, and must NOT land on a personal-portfolio page.
    const onlyAlts = visibleNavGroups(member(['alternatives'])).find((g) => g.key === 'portfolio')
    assert.equal(onlyAlts?.href, '/portfolio/alternatives')

    assert.equal(visibleNavGroups(member([])).find((g) => g.key === 'portfolio'), undefined)
  })

  it('portfolioLandingHref is null only when neither module is held', () => {
    assert.equal(portfolioLandingHref(member([])), null)
    assert.equal(portfolioLandingHref(member(['markets'])), null)
    assert.equal(portfolioLandingHref(member(['alternatives'])), '/portfolio/alternatives')
  })

  it('never mutates the shared navGroups array', () => {
    const before = JSON.stringify(navGroups.map((g) => ({ k: g.key, h: g.href })))
    visibleNavGroups(member(['alternatives']))
    assert.equal(JSON.stringify(navGroups.map((g) => ({ k: g.key, h: g.href }))), before)
  })

  it('both nav surfaces render the FILTERED list — desktop rail and mobile drawer', () => {
    // Asserted by following the binding, not by checking that the word
    // `visibleNavGroups` appears somewhere. An earlier version of this test did
    // the latter and a deliberate break slipped through it: importing the helper
    // and then mapping over the unfiltered array satisfied every assertion while
    // showing every module to everyone.
    for (const f of ['src/components/layout/PrimaryNav.tsx', 'src/components/layout/MobileNavDrawer.tsx']) {
      const src = code(read(f))
      const renders = [...src.matchAll(/\{\s*([A-Za-z_$][\w$]*(?:\([^)]*\))?)\s*\.map\(\(group\)/g)]
      assert.equal(renders.length, 1, `${f}: expected exactly one group render`)
      const source = renders[0][1]
      const derived =
        source.startsWith('visibleNavGroups(') ||
        new RegExp(`const\\s+${source}\\s*=\\s*visibleNavGroups\\(`).test(src)
      assert.ok(derived, `${f}: the rendered list must come from visibleNavGroups, got \`${source}\``)
      // And the unfiltered array must not be reachable in the render path at all.
      assert.ok(!/\bnavGroups\b/.test(src.replace(/visibleNavGroups/g, '')), `${f} must not touch the raw navGroups`)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · J — the Portfolio ceiling still holds', () => {
  it('no grant configuration reaches a sibling portfolio', () => {
    // The whole (principal x arbitrary grant subset) matrix.
    const subsets: ModuleKey[][] = []
    const all = [...APP_MODULE_KEYS]
    for (let mask = 0; mask < 1 << all.length; mask++) {
      subsets.push(all.filter((_, i) => mask & (1 << i)))
    }
    for (const principal of ['jaime', 'andres', 'pablo'] as const) {
      const forbidden = (['jaime', 'andres', 'pablo'] as const).filter((p) => p !== principal)
      for (const grants of subsets) {
        const visible = portfolioVisibleScopes(
          { isApproved: true, isAdministrator: false, principal },
          { isApproved: true, isAdministrator: false, grants },
        )
        for (const f of forbidden) {
          assert.ok(!visible.includes(f), `${principal} must never reach ${f}`)
        }
        // And it is always a subset of the frozen ceiling.
        const ceiling = scopesFor({ isApproved: true, isAdministrator: false, principal })
        for (const s of visible) assert.ok(ceiling.includes(s), `${s} escaped the ceiling`)
      }
    }
  })

  it('no principal means no personal portfolio scope, whatever is granted', () => {
    const visible = portfolioVisibleScopes(
      { isApproved: true, isAdministrator: false, principal: null },
      { isApproved: true, isAdministrator: false, grants: [...APP_MODULE_KEYS] },
    )
    for (const p of ['jaime', 'andres', 'pablo']) assert.ok(!visible.includes(p as never))
  })

  it('the scopes API composes the mask, so sub-navigation follows grants', () => {
    assert.ok(SCOPES_ROUTE.includes('portfolioVisibleScopes'))
    assert.ok(SCOPES_ROUTE.includes('getCallerModuleAccess'))
    assert.ok(!/entitlement\.scopes\s*\n?\s*\.filter/.test(SCOPES_ROUTE), 'must not use the unmasked ceiling')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · K — Overview does not leak a denied module', () => {
  it('gates the private card FETCHES, not only their rendering', () => {
    assert.match(HOME, /if \(!accessReady \|\| !canNotes\) return/)
    assert.match(HOME, /if \(!accessReady \|\| !canPortfolio\) return/)
    assert.match(HOME, /if \(!accessReady \|\| !canMarkets\) return/)
  })

  it('omits the private cards entirely rather than showing a denial', () => {
    assert.ok(HOME.includes('{canNotes && ('))
    assert.ok(HOME.includes('{canPortfolio && ('))
    assert.ok(HOME.includes('{canMarkets && ('))
  })

  it('each gated effect re-runs when access resolves', () => {
    assert.ok(HOME.includes('}, [accessReady, canNotes])'))
    assert.ok(HOME.includes('}, [accessReady, canPortfolio])'))
    assert.ok(HOME.includes('}, [accessReady, canMarkets])'))
  })

  it('the access snapshot starts closed, so nothing flashes before it resolves', () => {
    const provider = read('src/components/providers/ModuleAccessProvider.tsx')
    assert.ok(provider.includes('useState<EffectiveAccess>(NO_ACCESS)'))
    assert.ok(provider.includes('ready: false'))
    assert.equal(NO_ACCESS.modules.length, 0)
    assert.equal(hasModule(NO_ACCESS, 'markets'), false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · L — /api/me/access answers about the caller only', () => {
  it('takes no user parameter of any kind', () => {
    const c = code(ME_ROUTE)
    assert.ok(!/params/.test(c), 'no route parameter')
    assert.ok(!/searchParams/.test(c), 'no query parameter')
    assert.ok(!c.includes('getSupabaseAdminClient'), 'own-row RLS only')
  })

  it('reports unavailability as its own status, never as an empty module set', () => {
    assert.ok(ME_ROUTE.includes("status: 'unavailable'"))
    assert.match(ME_ROUTE, /isAccessUnavailable\(resolved\.reason\)[\s\S]{0,200}unavailable/)
  })

  it('a non-ok payload grants nothing, whatever else it claims', () => {
    const forged = parseEffectiveAccess({
      status: 'unavailable',
      isApproved: true,
      isAdministrator: true,
      modules: [...APP_MODULE_KEYS],
      portfolioScopes: ['jaime', 'andres', 'pablo'],
      principal: 'jaime',
    })
    assert.equal(forged.isAdministrator, false)
    assert.deepEqual(forged.modules, [])
    assert.deepEqual(forged.portfolioScopes, [])
  })

  it('drops values this build does not recognise', () => {
    const parsed = parseEffectiveAccess({
      status: 'ok',
      isApproved: true,
      isAdministrator: false,
      modules: ['markets', 'pablo', 'portfolio_admin', 'nonsense'],
      portfolioScopes: ['main', 'not_a_scope'],
      principal: 'someone_else',
    })
    assert.deepEqual(parsed.modules, ['markets'])
    assert.deepEqual(parsed.portfolioScopes, ['main'])
    assert.equal(parsed.principal, null)
  })

  it('degrades to no access on a malformed body', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      assert.deepEqual(parseEffectiveAccess(bad), NO_ACCESS)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · M — Structured Notes tells the truth about why', () => {
  it('a 403 renders as an authorization answer, not as a failure', () => {
    for (const [name, src] of [['list', SN_LIST], ['detail', SN_DETAIL]] as const) {
      assert.ok(src.includes('res.status === 403'), `${name} must recognise a denial`)
      assert.ok(src.includes('not_authorized'), `${name} must render the denial state`)
    }
  })

  it('the list page keeps denial and failure mutually exclusive', () => {
    assert.match(SN_LIST, /notAuthorized \? 'not_authorized' as const/)
    // A denial must never also set the failure flag.
    assert.match(SN_LIST, /res\.status === 403.*setNotAuthorized\(true\); setLoadFailed\(false\)/)
  })

  it('a genuine failure still reaches the failure state, so it stays diagnosable', () => {
    assert.ok(SN_LIST.includes("setLoadFailed(true)"))
    assert.ok(SN_LIST.includes("loadFailed ? 'error' as const"))
  })

  it('not_authorized is a real state with copy in both languages', () => {
    const async = read('src/components/fable/AsyncState.tsx')
    assert.ok(async.includes("| 'not_authorized'"))
    const i18n = read('src/lib/i18n.ts')
    assert.equal((i18n.match(/not_authorized: \{ title:/g) ?? []).length, 2, 'EN and ES')
    assert.ok(i18n.includes('Not available to your account'))
    assert.ok(i18n.includes('No disponible para su cuenta'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · N — account status is not fabricated', () => {
  it('reports exactly the states the schema can express - now four', () => {
    // R13.6F INVERTS this, deliberately. It used to assert two states and the
    // ABSENCE of 'disabled', because the schema had one bit and a Disabled chip
    // would have been a label with nothing behind it. 20260817000000 added the
    // columns, so the same property - never show a state the schema cannot record
    // - is now asserted the other way round.
    assert.deepEqual([...ACCOUNT_STATUSES], ['active', 'invited', 'disabled', 'unprovisioned'])
    const migration = read('supabase/migrations/20260817000000_user_lifecycle_provisioning.sql')
    for (const column of ['invited_at', 'activated_at', 'disabled_at']) {
      assert.match(migration, new RegExp('add column if not exists\\s+' + column), column)
    }
  })

  it('matches the approval definition used by every authorization layer', () => {
    // R13.6F - status is derived from approval PLUS the lifecycle columns, so an
    // approved account only reads 'active' once it has actually been activated.
    assert.equal(
      accountStatusOf({ username: 'someone', activated_at: '2026-01-01T00:00:00.000Z' }),
      'active',
    )
    assert.equal(accountStatusOf({ username: 'someone', invited_at: '2026-01-01T00:00:00.000Z' }), 'invited')
    assert.equal(accountStatusOf({ username: 'someone', disabled_at: '2026-02-01T00:00:00.000Z' }), 'disabled')

    // Approval itself is still exactly the predicate every authorization layer uses.
    for (const blank of [{ username: '   ' }, { username: null }, null, undefined]) {
      assert.equal(accountUsableOf(blank), false, JSON.stringify(blank))
    }
    assert.equal(
      accountUsableOf({ username: 'someone', activated_at: '2026-01-01T00:00:00.000Z' }),
      true,
    )
  })

  it('disabled is no longer deferred - it is derived from a real column', () => {
      // R13.6F. This assertion previously required the directory to EXPLAIN why a
      // Disabled state was absent. It still PASSED after the lifecycle shipped -
      // `disabled_at` and the word "deferred" both happened to survive elsewhere
      // in the file - which made it a guard that no longer guarded anything.
      // Updated to assert what is now true, so it fails if the derivation is
      // ever removed.
      assert.match(DIRECTORY, /disabled_at/)
      assert.match(DIRECTORY, /accountStatus/, 'status is derived, not fabricated')
      const off = { username: 'x', activated_at: '2026-01-01T00:00:00.000Z', disabled_at: '2026-02-01T00:00:00.000Z' }
      assert.equal(accountStatusOf(off), 'disabled')
      assert.equal(accountUsableOf(off), false, 'and it actually denies, rather than being a label')
    })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('POST-R13.6CDE · O — no regression in the existing boundaries', () => {
  it('no new file under src/ writes user_profiles', () => {
    for (const f of [USERS_ROUTE, MODULES_ROUTE, ME_ROUTE, CONSOLE, USERS_PAGE, SETTINGS_CARD]) {
      if (!/from\(['"]user_profiles['"]\)/.test(f)) continue
      assert.ok(!/\.(insert|upsert|update)\(/.test(f), 'user_profiles stays CLI-write-only')
    }
  })

  it('role and principal ARE now written from the console, audited and guarded', () => {
    // R13.6F REVERSES this assertion, which is the point of the stage: the console
    // used to say "CLI only" for role and principal, and section 17 required that
    // to end.
    //
    // What replaces the old prohibition is not "anything goes" - it is that the
    // write goes through the one transactional, audited, administrator-checked
    // path, and that the last-administrator invariant sits underneath it.
    const dialog = code(read('src/app/settings/users/ManageUserDialog.tsx'))
    assert.match(dialog, /method: 'PUT'/, 'the console saves through PUT')
    assert.ok(dialog.includes('role'), 'role is editable')
    assert.ok(dialog.includes('principal'), 'principal is editable')
    assert.ok(!CONSOLE.includes('managedElsewhere'), 'the "CLI only" copy is gone')

    const accessRoute = code(read('src/app/api/admin/users/[id]/route.ts'))
    assert.ok(accessRoute.includes('nmi_admin_update_access'), 'through the transactional RPC')
    assert.ok(accessRoute.includes('resolveAccountShape'), 'validated and canonicalized first')

    // The MODULES-only endpoint still must not CHANGE either: it reads the current
    // values and passes them straight back, so a module edit cannot clear someone's
    // Portfolio principal as a side effect.
    assert.match(MODULES_ROUTE, /select\('role, portfolio_principal'\)/)
    assert.match(MODULES_ROUTE, /p_role: shapeRes\.data\.role/)
    assert.match(MODULES_ROUTE, /p_principal: currentPrincipal/)
    assert.ok(!/body\??\.role/.test(MODULES_ROUTE), 'never a role taken from the request body')
  })

  it('notification recipients never became a module checkbox', () => {
    assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes('notification_recipients'))
    assert.ok(!CONSOLE.includes('notification_recipients'))
    assert.equal(normalizeRequestedModules(['notification_recipients']), null)
  })

  it('the module registry is still exactly the seven grantable keys', () => {
    assert.deepEqual([...APP_MODULE_KEYS], [
      'markets', 'analysis', 'macro', 'earnings', 'portfolio', 'alternatives', 'structured_notes',
    ])
  })
})
