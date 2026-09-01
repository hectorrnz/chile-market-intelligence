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
  accountStatusOf,
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
const CONSOLE = read('src/app/settings/users/UsersAccessClient.tsx')
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
    assert.ok(USERS_ROUTE.includes("select('id, email, display_name, username, role, portfolio_principal')"))
    assert.ok(!/\.select\(['"]\*['"]\)/.test(USERS_ROUTE))
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

  it('the write route takes a complete set and diffs server-side', () => {
    assert.ok(MODULES_ROUTE.includes('decideGrantChange'))
    assert.ok(MODULES_ROUTE.includes('decision.toGrant'))
    assert.ok(MODULES_ROUTE.includes('decision.toRevoke'))
  })

  it('the write route writes nothing when nothing changed', () => {
    assert.match(MODULES_ROUTE, /if \(!decision\.changed\)[\s\S]{0,160}changed: false/)
  })

  it('the write route never widens a denial into a success', () => {
    assert.match(MODULES_ROUTE, /if \(!decision\.allowed\)[\s\S]{0,200}status: DENIAL_STATUS/)
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
    for (const [name, src] of [['console', CONSOLE], ['list', USERS_ROUTE], ['write', MODULES_ROUTE]] as const) {
      assert.ok(!code(src).includes('default_for_member'), name)
    }
  })

  it('a failed save discards the draft and re-reads authoritative state', () => {
    const save = CONSOLE.slice(CONSOLE.indexOf('async function save()'))
    const body = save.slice(0, save.indexOf('\n  }'))
    assert.ok(body.includes("setSaveState('error')"))
    // Every error path must clear the draft AND reload.
    assert.equal((body.match(/setDraft\(null\)/g) ?? []).length >= 3, true)
    assert.equal((body.match(/await reload\(\)/g) ?? []).length >= 3, true)
  })

  it('offers no module checkboxes for an administrator target', () => {
    assert.match(CONSOLE, /open\.isAdministrator \? \([\s\S]{0,300}adminBypassNote/)
  })

  it('presents portfolio scope as a locked statement, never as controls', () => {
    assert.ok(CONSOLE.includes('portfolioLocked'))
    // No checkbox may be bound to a portfolio scope.
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
  it('reports only the two states the schema can express', () => {
    assert.deepEqual([...ACCOUNT_STATUSES], ['active', 'pending'])
    assert.ok(!DIRECTORY.includes("'disabled'"), 'no disabled state without a column that records one')
  })

  it('matches the approval definition used by every authorization layer', () => {
    assert.equal(accountStatusOf({ username: 'someone' }), 'active')
    assert.equal(accountStatusOf({ username: '   ' }), 'pending')
    assert.equal(accountStatusOf({ username: null }), 'pending')
    assert.equal(accountStatusOf(null), 'pending')
    assert.equal(accountStatusOf(undefined), 'pending')
  })

  it('records why disabled is absent rather than leaving it unexplained', () => {
    assert.match(DIRECTORY, /disabled_at/)
    assert.match(DIRECTORY, /deferred/i)
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

  it('role and principal are displayed, never written, from the console', () => {
    assert.ok(CONSOLE.includes('managedElsewhere'))
    assert.ok(!/method: 'PUT'[\s\S]{0,200}(role|principal)/.test(CONSOLE))
    assert.ok(!MODULES_ROUTE.includes("'role'"), 'the module route must not write a role')
    assert.ok(!MODULES_ROUTE.includes('portfolio_principal'))
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
