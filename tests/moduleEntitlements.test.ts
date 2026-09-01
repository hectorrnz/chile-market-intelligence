// POST-R13.6B — module entitlement substrate.
//
// WHAT RUNS HERE, AND WHAT DOES NOT.
//
// There is no local Supabase instance in this environment: Docker is not
// installed, psql is absent, and no service-role key is present. RLS, privilege
// and function behaviour therefore CANNOT be executed against a real database
// from this suite. Claiming otherwise would be false — the same honest split
// tests/familyPortfolioEntitlements.test.ts established for R13.1.
//
// Coverage is split accordingly:
//   · BEHAVIOURAL — the TypeScript module rule, the route binding and the
//     Portfolio composition are EXECUTED for real, including every negative case
//     and an exhaustive subset property over all 128 grant combinations.
//   · PARITY      — the truth table embedded in the migration is parsed and
//     asserted row-for-row identical to the TypeScript truth table. The SQL side
//     of each row is then EXECUTED BY POSTGRES ITSELF at apply time by the
//     migration's own `do $$ … $$` postcondition block, which raises if
//     `nmi_module_allowed()` disagrees. That block is the real in-database
//     proof; this file proves the two tables are the same table.
//   · STRUCTURAL  — the migration's registry, foreign keys, policies, privileges
//     and postconditions are asserted to exist and to be correct.
//   · REGRESSION  — the frozen R13.1 Portfolio ceiling and the R1.5 access
//     policy are re-exercised to prove POST-R13.6B changed neither.
//
// The EXECUTABLE database half lives in
// supabase/tests/database/module_entitlements_test.sql, run by the isolated
// PostgreSQL workflow against a clean migration chain.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  APP_MODULE_KEYS,
  MODULE_DENIAL_REASONS,
  canAccessModule,
  decideModuleAccess,
  isModuleKey,
  moduleAccessFromProfile,
  modulesFor,
  type ModuleAccessInput,
  type ModuleKey,
} from '../src/lib/auth/moduleAccess.ts'
import {
  MODULE_TRUTH_TABLE,
  INVALID_MODULE_INPUTS,
} from '../src/lib/auth/moduleTruthTable.ts'
import {
  moduleForPath,
  resolvePathModule,
  DECLARED_MODULE_ROUTE_BASES,
} from '../src/lib/auth/moduleRoutes.ts'
import { AUTHORIZATION_STATE_SELECT } from '../src/lib/auth/authorizationState.ts'
import {
  portfolioVisibleScopes,
  canViewScopeWithModules,
} from '../src/lib/portfolioAccess/portfolioModuleComposition.ts'
import {
  FAMILY_PORTFOLIO_SCOPES,
  PORTFOLIO_PRINCIPALS,
  scopesFor,
  type FamilyPortfolioScope,
  type EntitlementInput,
} from '../src/lib/portfolioAccess/entitlements.ts'
import { classifyPath } from '../src/lib/auth/accessPolicy.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * TypeScript source with comments removed. These modules document WHY a
 * dangerous pattern is avoided, so a whole-file negative assertion would be
 * satisfied by the very prose that explains the safeguard. Assert against code.
 */
const codeOf = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

const MIGRATION_NAME = '20260814000000_module_entitlements.sql'
const MIGRATION = read(`supabase/migrations/${MIGRATION_NAME}`)
/** SQL with `--` comments stripped, so prose can never satisfy a code assertion. */
const SQL = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const POLICY_SRC = read('src/lib/auth/moduleAccess.ts')
const ROUTES_SRC = read('src/lib/auth/moduleRoutes.ts')
const COMPOSITION_SRC = read('src/lib/portfolioAccess/portfolioModuleComposition.ts')

/** An approved member holding the given grants. */
const member = (grants: readonly unknown[] = []): ModuleAccessInput => ({
  isApproved: true,
  isAdministrator: false,
  grants,
})
/** An approved administrator, deliberately with NO grant rows. */
const admin = (grants: readonly unknown[] = []): ModuleAccessInput => ({
  isApproved: true,
  isAdministrator: true,
  grants,
})
const ALL_GRANTS: readonly ModuleKey[] = APP_MODULE_KEYS

const entitle = (over: Partial<EntitlementInput> = {}): EntitlementInput => ({
  isApproved: true,
  isAdministrator: false,
  principal: null,
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────
// 1 · THE MODULE RULE — executed
// ─────────────────────────────────────────────────────────────────────────────

describe('module registry shape', () => {
  test('exactly the seven grantable keys, in canonical order', () => {
    assert.deepEqual(APP_MODULE_KEYS, [
      'markets',
      'analysis',
      'macro',
      'earnings',
      'portfolio',
      'alternatives',
      'structured_notes',
    ])
  })

  test('no PERSONAL or administrative Portfolio scope is a module key', () => {
    // The load-bearing one. If a personal scope ever became a module key, a
    // grant row could name another family member's portfolio.
    //
    // `alternatives` is deliberately BOTH a scope and a module, and that is
    // safe: it is SHARED family data already present in every principal's
    // ceiling, so granting it adds nothing the ceiling did not already allow.
    // The three personal principals, `main` and `admin` must never appear.
    for (const scope of ['main', 'jaime', 'andres', 'pablo', 'admin'] as const) {
      assert.ok(
        (FAMILY_PORTFOLIO_SCOPES as readonly string[]).includes(scope),
        `${scope} must still be a real Portfolio scope for this test to mean anything`,
      )
      assert.ok(
        !(APP_MODULE_KEYS as readonly string[]).includes(scope),
        `${scope} is a Portfolio scope and must never be a module key`,
      )
    }
    for (const principal of PORTFOLIO_PRINCIPALS) {
      assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes(principal))
    }
    // The only scope that may also be a module.
    assert.equal(
      FAMILY_PORTFOLIO_SCOPES.filter((s) => (APP_MODULE_KEYS as readonly string[]).includes(s))
        .join(','),
      'alternatives',
    )
  })

  test('no role capability is a module key', () => {
    for (const k of ['portfolio_admin', 'notification_recipients', 'admin']) {
      assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes(k), `${k} is a role capability`)
    }
  })

  test('always-available surfaces are not modules', () => {
    for (const k of ['overview', 'settings', 'news', 'watchlist']) {
      assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes(k))
    }
  })

  test('isModuleKey narrows and rejects everything else', () => {
    for (const k of APP_MODULE_KEYS) assert.equal(isModuleKey(k), true)
    for (const bad of INVALID_MODULE_INPUTS) assert.equal(isModuleKey(bad), false, `${String(bad)}`)
  })
})

describe('the module rule', () => {
  test('every truth-table row produces its expected answer', () => {
    for (const c of MODULE_TRUTH_TABLE) {
      const input: ModuleAccessInput = {
        // The truth table models the DECIDED facts; reconstruct an input that
        // produces them. `hasGrant` becomes a real grant row for a real module.
        isApproved: c.isApproved as boolean,
        isAdministrator: c.isAdministrator as boolean,
        grants: c.hasGrant === true ? ['markets'] : [],
      }
      // Named `requested`, not `module`: `@next/next/no-assign-module-variable`
      // forbids declaring a variable called `module`.
      const requested = c.moduleKnown === true ? 'markets' : 'not_a_real_module'
      assert.equal(canAccessModule(input, requested), c.expected, c.name)
    }
  })

  test('an approved member with an explicit grant is allowed', () => {
    assert.equal(canAccessModule(member(['macro']), 'macro'), true)
    const d = decideModuleAccess(member(['macro']), 'macro')
    assert.deepEqual(d, { allowed: true, reason: null })
  })

  test('an approved member without a grant is denied, with a reason', () => {
    const d = decideModuleAccess(member(['macro']), 'structured_notes')
    assert.equal(d.allowed, false)
    assert.equal(d.reason, MODULE_DENIAL_REASONS.noGrant)
  })

  test('an administrator holds every module with no grant rows at all', () => {
    for (const m of APP_MODULE_KEYS) {
      assert.equal(canAccessModule(admin(), m), true, m)
    }
    assert.deepEqual(modulesFor(admin()), [...APP_MODULE_KEYS])
  })

  test('an unapproved account is denied every module, administrator included', () => {
    const revokedAdmin: ModuleAccessInput = {
      isApproved: false,
      isAdministrator: true,
      grants: ALL_GRANTS,
    }
    for (const m of APP_MODULE_KEYS) {
      assert.equal(canAccessModule(revokedAdmin, m), false, m)
      assert.equal(decideModuleAccess(revokedAdmin, m).reason, MODULE_DENIAL_REASONS.notApproved)
    }
    assert.deepEqual(modulesFor(revokedAdmin), [])
  })

  test('approval is checked BEFORE the module is known — an unapproved caller learns nothing', () => {
    // The denial reason for an unapproved caller must not reveal whether the
    // module they asked about exists.
    const unapproved: ModuleAccessInput = { isApproved: false, isAdministrator: false, grants: [] }
    assert.equal(decideModuleAccess(unapproved, 'macro').reason, MODULE_DENIAL_REASONS.notApproved)
    assert.equal(decideModuleAccess(unapproved, 'nope').reason, MODULE_DENIAL_REASONS.notApproved)
  })

  test('every malformed or non-module input is denied', () => {
    for (const bad of INVALID_MODULE_INPUTS) {
      assert.equal(canAccessModule(member(ALL_GRANTS), bad), false, `member: ${String(bad)}`)
      assert.equal(canAccessModule(admin(), bad), false, `admin: ${String(bad)}`)
    }
  })

  test('a grant naming a Portfolio scope confers nothing', () => {
    // Unrepresentable in the database (no app_modules row to reference), and
    // inert here too: the module being asked about is validated first.
    const forged = member(['main', 'jaime', 'andres', 'pablo', 'admin'])
    for (const scope of FAMILY_PORTFOLIO_SCOPES) {
      assert.equal(canAccessModule(forged, scope), false, scope)
    }
    assert.deepEqual(modulesFor(forged), [])
  })

  test('a non-array or missing grant set is denied, never thrown on', () => {
    for (const grants of [null, undefined, 'markets', 42, {}] as unknown[]) {
      const input = { isApproved: true, isAdministrator: false, grants } as ModuleAccessInput
      assert.equal(canAccessModule(input, 'markets'), false, String(grants))
    }
  })

  test('modulesFor returns a fresh array a caller cannot use to mutate state', () => {
    const first = modulesFor(admin())
    first.push('markets')
    assert.deepEqual(modulesFor(admin()), [...APP_MODULE_KEYS])
  })

  test('moduleAccessFromProfile matches the approval predicate exactly', () => {
    assert.equal(moduleAccessFromProfile(null, null).isApproved, false)
    assert.equal(moduleAccessFromProfile({ username: '   ' }, []).isApproved, false)
    assert.equal(moduleAccessFromProfile({ username: 'jaime' }, []).isApproved, true)
    assert.equal(
      moduleAccessFromProfile({ username: 'a', role: 'administrator' }, []).isAdministrator,
      true,
    )
    // Anything other than exactly 'administrator' is a member. Fail-closed.
    for (const role of ['Administrator', 'ADMIN', 'admin', 'user', '', null]) {
      assert.equal(moduleAccessFromProfile({ username: 'a', role }, []).isAdministrator, false)
    }
    // Malformed grant rows are dropped rather than trusted.
    const acc = moduleAccessFromProfile({ username: 'a' }, [
      { module_key: 'macro' },
      { module_key: null },
      { module_key: '' },
      {} as { module_key?: string | null },
    ])
    assert.deepEqual(acc.grants, ['macro'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2 · DEFAULTS ARE NOT AUTHORIZATION (requirement 11)
// ─────────────────────────────────────────────────────────────────────────────

describe('provisioning defaults are never runtime authorization', () => {
  test('default_for_member = true + NO grant row is DENIED for a member', () => {
    // `markets` is default_for_member = true in the registry. A member with no
    // grant row must still be denied — the default describes what a NEW
    // invitation starts from, not what an existing account may reach.
    assert.match(SQL, /\('markets',\s*'Markets',\s*10,\s*true\)/)
    assert.equal(canAccessModule(member([]), 'markets'), false)
    assert.equal(decideModuleAccess(member([]), 'markets').reason, MODULE_DENIAL_REASONS.noGrant)
  })

  test('default_for_member = false + an explicit grant row is ALLOWED', () => {
    assert.match(SQL, /\('structured_notes',\s*'Structured Notes',\s*70,\s*false\)/)
    assert.equal(canAccessModule(member(['structured_notes']), 'structured_notes'), true)
  })

  test('the policy engine never references the default at all', () => {
    // Structural, not stylistic: if `default_for_member` ever appears in the
    // rule, provisioning metadata has become an implicit permission.
    assert.doesNotMatch(codeOf(POLICY_SRC), /default_for_member|defaultForMember/)
    assert.doesNotMatch(codeOf(COMPOSITION_SRC), /default_for_member|defaultForMember/)
  })

  test('the SQL rule never references the default either', () => {
    const fn = /create or replace function public\.nmi_module_allowed[\s\S]*?\$\$;/.exec(SQL)
    assert.ok(fn, 'nmi_module_allowed must exist')
    assert.doesNotMatch(fn[0], /default_for_member/)
    const grants = /create or replace function public\.nmi_can_access_module[\s\S]*?\$\$;/.exec(SQL)
    assert.ok(grants)
    assert.doesNotMatch(grants[0], /default_for_member/)
  })

  test('the registry column is documented as provisioning metadata only', () => {
    assert.match(
      MIGRATION,
      /comment on column public\.app_modules\.default_for_member is[\s\S]*?NEVER consulted at authorization time/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3 · FUTURE-MODULE DEFAULT DENY (requirement 12)
// ─────────────────────────────────────────────────────────────────────────────

describe('future modules and routes are denied until declared AND granted', () => {
  test('an undeclared module key is denied for members and administrators alike', () => {
    for (const future of ['reports', 'tax', 'risk_engine', 'brand_new_module']) {
      assert.equal(canAccessModule(member(ALL_GRANTS), future), false, future)
      assert.equal(canAccessModule(admin(), future), false, future)
      assert.equal(
        decideModuleAccess(member([]), future).reason,
        MODULE_DENIAL_REASONS.unknownModule,
      )
    }
  })

  test('a grant row for an undeclared module still allows nothing', () => {
    // Belt and braces: the FK makes this unstorable, and the rule ignores it.
    assert.equal(canAccessModule(member(['reports']), 'reports'), false)
  })

  test('an unmapped route resolves to unmapped, which callers must deny', () => {
    for (const p of [
      '/some-new-page',
      '/api/some-new-endpoint',
      '/reports',
      '/api/reports/summary',
      '/portfolioX',
      '/macrofoo',
    ]) {
      assert.equal(resolvePathModule(p).kind, 'unmapped', p)
      assert.equal(moduleForPath(p), null, p)
    }
  })

  test('a new app_modules row grants nobody anything until an explicit grant exists', () => {
    // Expressed against the rule itself: adding a key to the registry changes
    // `moduleKnown`, never `hasGrant`.
    const knownButUngranted = MODULE_TRUTH_TABLE.find(
      (c) => c.isApproved === true && c.isAdministrator === false
        && c.moduleKnown === true && c.hasGrant === false,
    )
    assert.ok(knownButUngranted, 'the truth table must cover known-module-without-grant')
    assert.equal(knownButUngranted.expected, false)
  })

  test('the migration seeds the registry but writes no grant for an administrator', () => {
    const backfill = /insert into public\.user_module_grants[\s\S]*?;/.exec(SQL)
    assert.ok(backfill, 'the compatibility backfill must exist')
    assert.match(backfill[0], /role is distinct from 'administrator'/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4 · ROUTE BINDING
// ─────────────────────────────────────────────────────────────────────────────

describe('route to module binding', () => {
  const cases: [string, string][] = [
    ['/', 'always_available'],
    ['/settings', 'always_available'],
    ['/api/news', 'always_available'],
    ['/api/notifications', 'always_available'],
    ['/api/notifications/abc/read', 'always_available'],
    ['/settings/notifications', 'administrator_only'],
    ['/api/notification-recipients', 'administrator_only'],
    ['/api/notification-recipients/7', 'administrator_only'],
    ['/portfolio/admin', 'administrator_only'],
    ['/api/family-portfolio/admin/uploads', 'administrator_only'],
    ['/stocks', 'module'],
    ['/companies/SQM-B', 'module'],
    ['/watchlist', 'module'],
    ['/api/market/stocks', 'module'],
    ['/compare', 'module'],
    ['/chart-builder', 'module'],
    ['/macro/calendar', 'module'],
    ['/earnings', 'module'],
    ['/portfolio', 'module'],
    ['/portfolio/holdings', 'module'],
    ['/portfolio/weekly-changes', 'module'],
    ['/portfolio/alternatives', 'module'],
    ['/portfolio/alternatives/cash-flows', 'module'],
    ['/structured-notes/42', 'module'],
  ]

  for (const [path, kind] of cases) {
    test(`${path} -> ${kind}`, () => {
      assert.equal(resolvePathModule(path).kind, kind)
    })
  }

  test('specificity beats authoring order — admin and alternatives win over portfolio', () => {
    // The bug this prevents: a more general entry shadowing a more specific one,
    // which downgrades an administrative path to a member module silently.
    assert.equal(resolvePathModule('/portfolio/admin').kind, 'administrator_only')
    assert.equal(moduleForPath('/portfolio/alternatives'), 'alternatives')
    assert.equal(moduleForPath('/portfolio/alternatives/holdings'), 'alternatives')
    assert.equal(moduleForPath('/portfolio'), 'portfolio')
    assert.equal(moduleForPath('/portfolio/holdings'), 'portfolio')
    assert.equal(resolvePathModule('/api/family-portfolio/admin').kind, 'administrator_only')
    assert.equal(moduleForPath('/api/family-portfolio/alternatives'), 'alternatives')
    // POST-R13.6CDE.2 INVERTED this. `/api/family-portfolio/scopes` is the
    // Portfolio LAYOUT's scope resolver, mounted for the Alternatives pages
    // too, so binding it to `portfolio` alone would have denied it to an
    // alternatives-only member — breaking § 7's "Alternatives surfaces allowed"
    // under `portfolio=false, alternatives=true`. It is a `module_any` family
    // entry point, and it widens reach to the ROUTE only: the route already
    // returns `portfolioVisibleScopes`, i.e. the principal ceiling already
    // intersected with the module mask, so no scope leaks with it.
    const scopes = resolvePathModule('/api/family-portfolio/scopes')
    assert.equal(scopes.kind, 'module_any')
    assert.deepEqual(
      scopes.kind === 'module_any' ? [...scopes.modules] : [],
      ['portfolio', 'alternatives'],
    )
    assert.equal(moduleForPath('/api/family-portfolio/scopes'), null,
      'a family surface has no single owning module')
    // Everything else in the family stays portfolio DATA, bound to `portfolio`.
    assert.equal(moduleForPath('/api/family-portfolio/overview/main'), 'portfolio')
    assert.equal(moduleForPath('/api/family-portfolio/jaime/snapshot'), 'portfolio')
    assert.equal(moduleForPath('/api/family-portfolio/weekly-changes/main'), 'portfolio')
    assert.equal(resolvePathModule('/settings/notifications').kind, 'administrator_only')
    assert.equal(resolvePathModule('/settings').kind, 'always_available')
  })

  test('the root binding is an EXACT match, never a blanket prefix', () => {
    // `'/'` treated as an ordinary prefix would match every path and turn the
    // Overview entry into an application-wide allow.
    assert.equal(resolvePathModule('/').kind, 'always_available')
    assert.equal(resolvePathModule('/stocks').kind, 'module')
    assert.equal(resolvePathModule('/anything-undeclared').kind, 'unmapped')
  })

  test('matching is segment-aware — a sibling path never inherits a module', () => {
    for (const p of ['/macrofoo', '/stocksX', '/portfolioZ', '/api/marketing']) {
      assert.equal(resolvePathModule(p).kind, 'unmapped', p)
    }
  })

  test('malformed input is unmapped rather than thrown on', () => {
    for (const p of ['', null, undefined, 42] as unknown[]) {
      assert.equal(resolvePathModule(p as string).kind, 'unmapped')
    }
  })

  test('every declared base is a private path under the R1.5 access policy', () => {
    // A module must never be bound to a public, session-mint or bearer path —
    // that would gate something the session policy deliberately exempts, or
    // imply a module owns a pre-session route.
    for (const base of DECLARED_MODULE_ROUTE_BASES) {
      const cls = classifyPath(base)
      assert.ok(
        cls === 'private_page' || cls === 'private_api',
        `${base} classified as ${cls}`,
      )
    }
  })

  test('every real page and API route the app serves is declared', () => {
    // Guards against a module binding silently missing a surface that exists.
    const surfaces = [
      '/', '/stocks', '/companies/X', '/compare', '/chart-builder', '/macro',
      '/macro/calendar', '/earnings', '/watchlist', '/settings',
      '/settings/notifications', '/structured-notes', '/structured-notes/1',
      '/portfolio', '/portfolio/holdings', '/portfolio/weekly-changes',
      '/portfolio/alternatives', '/portfolio/alternatives/holdings',
      '/portfolio/alternatives/cash-flows', '/portfolio/admin',
      '/api/market/stocks', '/api/valuation/X', '/api/watchlists',
      '/api/compare', '/api/financials/X/metrics', '/api/macro',
      '/api/earnings/results', '/api/news', '/api/notifications',
      '/api/notification-recipients', '/api/health/ingestion',
      '/api/structured-notes', '/api/family-portfolio/scopes',
      '/api/family-portfolio/alternatives', '/api/family-portfolio/admin/uploads',
    ]
    for (const s of surfaces) {
      assert.notEqual(resolvePathModule(s).kind, 'unmapped', `${s} is undeclared`)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5 · PORTFOLIO CEILING COMPOSITION (requirement 8)
// ─────────────────────────────────────────────────────────────────────────────

describe('module grants compose with the Portfolio ceiling', () => {
  test('the owner-specified examples resolve exactly', () => {
    const jaime = entitle({ principal: 'jaime' })
    assert.deepEqual(
      portfolioVisibleScopes(jaime, member(['portfolio', 'alternatives'])),
      ['main', 'jaime', 'alternatives'],
    )
    assert.deepEqual(portfolioVisibleScopes(jaime, member(['portfolio'])), ['main', 'jaime'])
    // Alternatives is a separate module over SHARED family data, so it stands
    // alone. This is the documented composition, not an accident.
    assert.deepEqual(portfolioVisibleScopes(jaime, member(['alternatives'])), ['alternatives'])
    assert.deepEqual(portfolioVisibleScopes(jaime, member([])), [])
  })

  test('an administrator keeps the full ceiling regardless of grants', () => {
    const a = entitle({ isAdministrator: true })
    assert.deepEqual(portfolioVisibleScopes(a, admin()), [...FAMILY_PORTFOLIO_SCOPES])
    assert.deepEqual(portfolioVisibleScopes(a, admin(ALL_GRANTS)), [...FAMILY_PORTFOLIO_SCOPES])
  })

  test('THE invariant: visible is always a subset of the ceiling, for every combination', () => {
    // Exhaustive over role x principal x every one of the 2^7 grant subsets.
    const principals: (string | null)[] = [...PORTFOLIO_PRINCIPALS, null, 'nope', 'administrator']
    const subsets: ModuleKey[][] = []
    for (let mask = 0; mask < 1 << APP_MODULE_KEYS.length; mask++) {
      subsets.push(APP_MODULE_KEYS.filter((_, i) => mask & (1 << i)))
    }
    let checked = 0
    for (const isAdministrator of [true, false]) {
      for (const isApproved of [true, false]) {
        for (const principal of principals) {
          const ent = entitle({ isApproved, isAdministrator, principal })
          const ceiling = scopesFor(ent)
          for (const grants of subsets) {
            const visible = portfolioVisibleScopes(ent, {
              isApproved,
              isAdministrator,
              grants,
            })
            for (const s of visible) {
              assert.ok(
                ceiling.includes(s),
                `grants=[${grants}] principal=${principal} leaked ${s} outside the ceiling`,
              )
            }
            checked++
          }
        }
      }
    }
    assert.equal(checked, 2 * 2 * 6 * 128)
  })

  test('a member can NEVER resolve to a sibling principal, whatever the grants', () => {
    const forbidden: Record<string, FamilyPortfolioScope[]> = {
      jaime: ['andres', 'pablo'],
      andres: ['jaime', 'pablo'],
      pablo: ['jaime', 'andres'],
    }
    for (const principal of PORTFOLIO_PRINCIPALS) {
      const ent = entitle({ principal })
      // Every grant, plus forged grants naming the sibling scopes directly.
      const forged = member([...ALL_GRANTS, 'jaime', 'andres', 'pablo', 'main', 'admin'])
      const visible = portfolioVisibleScopes(ent, forged)
      for (const bad of forbidden[principal]) {
        assert.ok(!visible.includes(bad), `${principal} must never see ${bad}`)
      }
      assert.ok(!visible.includes('admin'), `${principal} must never see the admin scope`)
    }
  })

  test('a corrupted or fully populated grant table cannot cross the ceiling', () => {
    const jaime = entitle({ principal: 'jaime' })
    const everything = member(FAMILY_PORTFOLIO_SCOPES.concat(APP_MODULE_KEYS as unknown as FamilyPortfolioScope[]))
    assert.deepEqual(portfolioVisibleScopes(jaime, everything), ['main', 'jaime', 'alternatives'])
  })

  test('an unapproved caller sees nothing, whatever the grants', () => {
    const ent = entitle({ isApproved: false, principal: 'jaime' })
    const acc: ModuleAccessInput = { isApproved: false, isAdministrator: false, grants: ALL_GRANTS }
    assert.deepEqual(portfolioVisibleScopes(ent, acc), [])
    assert.equal(canViewScopeWithModules(ent, acc, 'main'), false)
  })

  test('canViewScopeWithModules is never less restrictive than the ceiling', () => {
    const jaime = entitle({ principal: 'jaime' })
    const acc = member(['portfolio'])
    assert.equal(canViewScopeWithModules(jaime, acc, 'jaime'), true)
    assert.equal(canViewScopeWithModules(jaime, acc, 'alternatives'), false) // module withheld
    assert.equal(canViewScopeWithModules(jaime, acc, 'andres'), false) // ceiling
    for (const bad of [null, undefined, 42, {}, ['main'], '', 'main ', 'MAIN']) {
      assert.equal(canViewScopeWithModules(jaime, acc, bad), false, String(bad))
    }
  })

  test('composition filters the ceiling and never builds up from the mask', () => {
    // Reversing the operands would be the bug that makes grants additive.
    assert.match(codeOf(COMPOSITION_SRC), /ceiling\.filter\(/)
    assert.doesNotMatch(codeOf(COMPOSITION_SRC), /mask\.filter\(/)
  })

  test('the frozen ceiling module is not modified by this stage', () => {
    // entitlements.ts is FROZEN: it is mirrored in SQL and asserted by an
    // in-database truth table that runs at migration apply time. Composition
    // happens ABOVE it, so it must know nothing about modules or grants.
    const ent = read('src/lib/portfolioAccess/entitlements.ts')
    assert.doesNotMatch(ent, /moduleAccess|user_module_grants|canAccessModule|app_modules/)
    assert.doesNotMatch(codeOf(ent), /\bimport\b(?![^\n]*['"]\.\/)/)
    // …and its behaviour is byte-for-behaviour what R13.1 shipped.
    assert.deepEqual(scopesFor(entitle({ principal: 'jaime' })), ['main', 'jaime', 'alternatives'])
    assert.deepEqual(scopesFor(entitle({ principal: 'andres' })), ['main', 'andres', 'alternatives'])
    assert.deepEqual(scopesFor(entitle({ principal: 'pablo' })), ['main', 'pablo', 'alternatives'])
    assert.deepEqual(scopesFor(entitle({ isAdministrator: true })), [...FAMILY_PORTFOLIO_SCOPES])
    assert.deepEqual(scopesFor(entitle({ isApproved: false, isAdministrator: true })), [])
    // The dependency direction is one-way: composition imports the ceiling,
    // never the reverse. A cycle here would mean the ceiling could be influenced
    // by grant state.
    assert.match(COMPOSITION_SRC, /from '\.\/entitlements\.ts'/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6 · SQL ↔ TypeScript PARITY (requirement 10)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the migration's own truth table from its postcondition block. Parsing
 * the real migration — not a copy — is what makes this a parity check rather
 * than a restatement.
 */
function parseMigrationTruthTable(): {
  isApproved: boolean | null
  isAdministrator: boolean | null
  hasGrant: boolean | null
  moduleKnown: boolean | null
  expected: boolean | null
}[] {
  const block =
    /select \* from \(values([\s\S]*?)\) as t\(is_approved, is_admin, has_grant, module_known, expected\)/.exec(SQL)
  assert.ok(block, 'the migration must embed a truth-table VALUES list')
  const lit = (t: string): boolean | null => (t === 'true' ? true : t === 'false' ? false : null)
  const rows = []
  for (const m of block[1].matchAll(
    /\(\s*(true|false|null)\s*,\s*(true|false|null)\s*,\s*(true|false|null)\s*,\s*(true|false|null)\s*,\s*(true|false|null)\s*\)/g,
  )) {
    rows.push({
      isApproved: lit(m[1]),
      isAdministrator: lit(m[2]),
      hasGrant: lit(m[3]),
      moduleKnown: lit(m[4]),
      expected: lit(m[5]),
    })
  }
  return rows
}

describe('SQL and TypeScript module parity', () => {
  test('the migration embeds the same truth table, row for row', () => {
    const sqlRows = parseMigrationTruthTable()
    assert.equal(
      sqlRows.length,
      MODULE_TRUTH_TABLE.length,
      `migration has ${sqlRows.length} rows, TypeScript has ${MODULE_TRUTH_TABLE.length}`,
    )
    MODULE_TRUTH_TABLE.forEach((ts, i) => {
      const sql = sqlRows[i]
      assert.equal(sql.isApproved, ts.isApproved, `row ${i} (${ts.name}) is_approved`)
      assert.equal(sql.isAdministrator, ts.isAdministrator, `row ${i} (${ts.name}) is_admin`)
      assert.equal(sql.hasGrant, ts.hasGrant, `row ${i} (${ts.name}) has_grant`)
      assert.equal(sql.moduleKnown, ts.moduleKnown, `row ${i} (${ts.name}) module_known`)
      assert.equal(sql.expected, ts.expected, `row ${i} (${ts.name}) expected`)
    })
  })

  test('the migration executes the truth table in-database and raises on mismatch', () => {
    assert.match(SQL, /got := public\.nmi_module_allowed\(/)
    assert.match(SQL, /raise exception[\s\S]{0,200}nmi_module_allowed/)
  })

  test('the truth table covers every required authorization case', () => {
    const names = MODULE_TRUTH_TABLE.map((c) => c.name).join(' | ')
    for (const required of [
      'administrator, no grant row',
      'member with an explicit grant',
      'member with no grant row is denied',
      'unknown module',
      'unapproved',
      'revoked administrator',
      'null approval',
      'null grant flag',
      'null module-known flag',
    ]) {
      assert.ok(names.includes(required), `truth table is missing a case for: ${required}`)
    }
  })

  test('the SQL rule and the TypeScript rule have the same fail-closed shape', () => {
    const fn = /create or replace function public\.nmi_module_allowed[\s\S]*?\$\$;/.exec(SQL)![0]
    assert.match(fn, /when is_approved is not true\s+then false/)
    assert.match(fn, /when module_known is not true then false/)
    assert.match(fn, /when is_admin is true\s+then true/)
    assert.match(fn, /else has_grant is true/)
    assert.match(fn, /set search_path = ''/)
    assert.match(fn, /immutable/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7 · MIGRATION STRUCTURE, PRIVILEGES AND RLS
// ─────────────────────────────────────────────────────────────────────────────

describe('migration structure', () => {
  test('both tables are created idempotently', () => {
    assert.match(SQL, /create table if not exists public\.app_modules/)
    assert.match(SQL, /create table if not exists public\.user_module_grants/)
  })

  test('the registry is seeded with exactly the seven keys and the owner defaults', () => {
    for (const [key, dflt] of [
      ['markets', 'true'],
      ['analysis', 'true'],
      ['macro', 'true'],
      ['earnings', 'true'],
      ['portfolio', 'true'],
      ['alternatives', 'true'],
      ['structured_notes', 'false'],
    ] as const) {
      assert.match(SQL, new RegExp(`\\('${key}',[^)]*${dflt}\\)`), `${key} default ${dflt}`)
    }
    // And the assertion in the migration pins the exact set.
    assert.match(SQL, /alternatives,analysis,earnings,macro,markets,portfolio,structured_notes/)
  })

  test('the seeded rows are EXACTLY the seven keys — parsed, not merely matched', () => {
    // The in-database postcondition catches a rogue seed row when the migration
    // is applied. This catches it here too, so a mistake surfaces in the ordinary
    // suite rather than only on a machine that can run PostgreSQL.
    const insert =
      /insert into public\.app_modules \(module_key, label, display_order, default_for_member\) values([\s\S]*?)on conflict/.exec(SQL)
    assert.ok(insert, 'the registry seed must exist')
    const seeded: string[] = [...insert[1].matchAll(/\(\s*'([a-z_]+)'/g)].map((m) => m[1]).sort()
    // The direct negative first — this is the property that matters, and running
    // it before `deepEqual` keeps `seeded` a plain string[] (deepEqual carries an
    // `asserts actual is T` signature that would otherwise narrow it to ModuleKey).
    for (const forbidden of ['main', 'jaime', 'andres', 'pablo', 'admin', 'portfolio_admin']) {
      assert.ok(!seeded.includes(forbidden), `${forbidden} must never be seeded as a module`)
    }
    assert.deepEqual(seeded, [...APP_MODULE_KEYS].sort())
  })

  test('module_key is a foreign key into the registry — unknown modules unstorable', () => {
    assert.match(
      SQL,
      /module_key\s+text\s+not null references public\.app_modules\(module_key\)/,
    )
  })

  test('duplicate grants are impossible via a composite primary key', () => {
    assert.match(SQL, /primary key \(user_id, module_key\)/)
  })

  test('grants cascade from the profile, so deleting a user removes their access', () => {
    assert.match(
      SQL,
      /user_id\s+uuid\s+not null references public\.user_profiles\(id\) on delete cascade/,
    )
  })

  test('a Portfolio scope can never be seeded as a module key', () => {
    assert.match(
      SQL,
      /where module_key in \('main', 'jaime', 'andres', 'pablo', 'admin'\)/,
    )
    assert.match(SQL, /a grant could then cross the principal ceiling/)
  })

  test('role capabilities are asserted absent from the registry', () => {
    assert.match(SQL, /where module_key in \('portfolio_admin', 'notification_recipients'\)/)
  })

  test('RLS is enabled and policies are fully reset before being created', () => {
    assert.match(SQL, /alter table public\.app_modules\s+enable row level security/)
    assert.match(SQL, /alter table public\.user_module_grants enable row level security/)
    assert.match(SQL, /from pg_catalog\.pg_policies[\s\S]*?drop policy/)
  })

  test('a member may read only their OWN grants', () => {
    assert.match(
      SQL,
      /create policy "user_module_grants_own_select"[\s\S]*?for select[\s\S]*?using \(\(select auth\.uid\(\)\) = user_id\)/,
    )
  })

  test('there is NO insert, update or delete policy for authenticated on either table', () => {
    const policies = [...SQL.matchAll(/create policy "([^"]+)" on public\.(app_modules|user_module_grants)[\s\S]*?;/g)]
    assert.equal(policies.length, 2, 'exactly two policies')
    for (const p of policies) {
      assert.match(p[0], /for select/)
      assert.doesNotMatch(p[0], /for (insert|update|delete|all)/)
    }
  })

  test('privileges are revoked first, then minimally re-granted', () => {
    assert.match(SQL, /revoke all privileges on table public\.app_modules\s+from public, anon, authenticated/)
    assert.match(SQL, /revoke all privileges on table public\.user_module_grants from public, anon, authenticated/)
    assert.match(SQL, /grant select on table public\.app_modules\s+to authenticated/)
    assert.match(SQL, /grant select on table public\.user_module_grants to authenticated/)
    assert.match(SQL, /grant all privileges on table public\.app_modules\s+to service_role/)
    assert.match(SQL, /grant all privileges on table public\.user_module_grants to service_role/)
  })

  test('column-level privileges are stripped too', () => {
    // A table-level REVOKE does not clear pg_attribute.attacl.
    assert.match(SQL, /revoke all privileges \(%I\) on table public\.%I from public, anon, authenticated/)
  })

  test('postconditions assert authenticated holds no effective DML', () => {
    assert.match(SQL, /has_table_privilege\('authenticated', 'public\.' \|\| tbl, priv\)/)
    assert.match(SQL, /a member could grant themselves a module/)
  })

  test('the SECURITY DEFINER functions pin search_path and exclude anon', () => {
    for (const fn of ['nmi_current_module_grants', 'nmi_can_access_module']) {
      const m = new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?\\$\\$;`).exec(SQL)
      assert.ok(m, `${fn} must exist`)
      assert.match(m[0], /security definer/)
      assert.match(m[0], /set search_path = ''/)
    }
    assert.match(SQL, /revoke all on function public\.nmi_can_access_module\(text\)\s+from public, anon/)
    assert.match(SQL, /grant execute on function public\.nmi_can_access_module\(text\)\s+to authenticated, service_role/)
    assert.match(SQL, /SECURITY DEFINER function\(s\) without a pinned search_path/)
  })

  test('the migration guards that the frozen Portfolio ceiling still exists and is unchanged', () => {
    assert.match(SQL, /nmi_can_access_scope is missing/)
    assert.match(
      SQL,
      /public\.nmi_portfolio_scopes\(true, false, 'jaime'\)[\s\S]*?array\['main','jaime','alternatives'\]/,
    )
    assert.match(SQL, /the Family Portfolio ceiling changed/)
  })

  test('the migration does not touch the ceiling, Structured Notes or notification policies', () => {
    // 6B.1 owns the Structured Notes / notification hardening. Doing it here
    // would put the one behaviour-changing step inside an additive migration.
    assert.doesNotMatch(SQL, /create or replace function public\.nmi_portfolio_scopes/)
    assert.doesNotMatch(SQL, /create or replace function public\.nmi_can_access_scope/)
    // `structured_notes` appears as a REGISTRY KEY, which is correct. What must
    // not appear is any statement against the structured-note or notification
    // TABLES — that hardening is POST-R13.6B.1's, kept separately reviewable.
    assert.doesNotMatch(SQL, /public\.structured_note/)
    assert.doesNotMatch(SQL, /public\.notification_recipients/)
    // Scan only statements that START a line with a DDL/privilege verb, so the
    // table name `user_module_grants` cannot itself match the word "grant", and
    // a `references public.user_profiles(id)` foreign key inside a CREATE TABLE
    // — which is required, not a modification — is not mistaken for one.
    const ddl = [...SQL.matchAll(/^\s*(?:create policy|drop policy|alter table|grant|revoke)\b[^;]*;/gim)]
      .map((m) => m[0])
    assert.ok(ddl.length > 0, 'the scan must actually find statements')
    for (const s of ddl) {
      assert.doesNotMatch(
        s,
        /structured_note|notification_recipient|user_profiles/i,
        `POST-R13.6B must not touch that object: ${s.slice(0, 90)}`,
      )
    }
    assert.doesNotMatch(SQL, /alter table public\.user_profiles/)
  })

  test('no user is provisioned, invited or fabricated', () => {
    assert.doesNotMatch(SQL, /insert into auth\.users/)
    assert.doesNotMatch(SQL, /insert into public\.user_profiles/)
    assert.doesNotMatch(SQL, /update public\.user_profiles/)
    for (const name of ['jaime@', 'andres@', 'pablo@', 'generateLink', 'invite']) {
      assert.doesNotMatch(SQL, new RegExp(name, 'i'), `${name} must not appear`)
    }
  })

  test('no secret, key or credential appears anywhere in the migration', () => {
    assert.doesNotMatch(MIGRATION, /service_role_key|SUPABASE_SERVICE_ROLE|anon_key|password|secret\s*=/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8 · COMPATIBILITY BACKFILL
// ─────────────────────────────────────────────────────────────────────────────

describe('compatibility backfill', () => {
  test('it grants every registered module to every approved member', () => {
    const block = /if exists \(select 1 from public\.user_module_grants\)[\s\S]*?end \$\$;/.exec(SQL)
    assert.ok(block, 'the backfill block must exist')
    assert.match(block[0], /cross join public\.app_modules/)
    assert.match(block[0], /nullif\(btrim\(p\.username::text\), ''\) is not null/)
  })

  test('it preserves Structured Notes for EXISTING members despite the new default', () => {
    // The asymmetry the owner specified: existing members keep it via an
    // explicit row; a new member starts without it.
    const block = /if exists \(select 1 from public\.user_module_grants\)[\s\S]*?end \$\$;/.exec(SQL)![0]
    // The backfill selects the whole registry, so structured_notes is included
    // and is not filtered out anywhere in the block.
    assert.match(block, /from public\.user_profiles p\s*\n\s*cross join public\.app_modules m/)
    assert.doesNotMatch(block, /module_key\s*(<>|!=)\s*'structured_notes'/)
    assert.doesNotMatch(block, /default_for_member/)
  })

  test('it never fires again once any grant exists — a migration must not re-grant', () => {
    // The failure mode this prevents: re-applying the chain after POST-R13.6C
    // silently restoring a module an administrator deliberately revoked.
    assert.match(SQL, /if exists \(select 1 from public\.user_module_grants\) then[\s\S]*?return;/)
  })

  test('administrators are deliberately given no rows', () => {
    const block = /if exists \(select 1 from public\.user_module_grants\)[\s\S]*?end \$\$;/.exec(SQL)![0]
    assert.match(block, /p\.role is distinct from 'administrator'/)
  })

  test('a postcondition proves no approved member was left without grants', () => {
    assert.match(SQL, /approved member\(s\) have no module grants/)
  })

  test('granted_by is nullable and documented as having no actor for the backfill', () => {
    assert.match(SQL, /granted_by uuid\s+references auth\.users\(id\) on delete set null/)
    assert.match(
      MIGRATION,
      /comment on column public\.user_module_grants\.granted_by is[\s\S]*?compatibility backfill, which had no application actor/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9 · NOT WIRED YET, AND NO SECURITY REGRESSION
// ─────────────────────────────────────────────────────────────────────────────

describe('POST-R13.6B is substrate only', () => {
  // SUPERSEDED by POST-R13.6CDE.1, the stage this deferral named. Inverted
  // rather than deleted, so the same boundary is guarded from the other side:
  // middleware must consume THE shared module rule — not a second, divergent
  // copy of it — and must fail closed when the grant store cannot be read.
  test('middleware now consumes the module policy, and only the shared rule', () => {
    const mw = read('src/middleware.ts')
    // POST-R13.6CDE.2 — the grants are EMBEDDED in the one authorization read
    // rather than fetched separately, so the assertion follows them into the
    // shared select constant. The gate still reads the store itself.
    assert.match(mw, /AUTHORIZATION_STATE_SELECT/, 'the gate must read the authorization state itself')
    assert.match(AUTHORIZATION_STATE_SELECT, /user_module_grants\(module_key\)/)
    // It composes `canEnterPlatform` through the shared decision table rather
    // than re-deriving entitlement inline.
    assert.match(mw, /decideRequestAccess/)
    assert.doesNotMatch(mw, /default_for_member/, 'defaults are never authorization')
    const decision = read('src/lib/auth/requestAccess.ts')
    assert.match(decision, /from '\.\/moduleAccess\.ts'/)
    assert.match(decision, /canEnterPlatform/)
    // A missing or unreadable store must never open the gate.
    assert.match(decision, /!resolved\.ok[\s\S]{0,300}outcome: 'deny'/)
  })

  // POST-R13.6CDE.2 — the SECOND layer. `moduleRoutes.ts` had no production
  // consumer through POST-R13.6CDE.1, which is why one grant reached every
  // private surface. The decision must now resolve the requested path through
  // that same table, and must do so via the shared predicate rather than
  // re-implementing the four-way binding match inline.
  test('the request decision resolves the requested path through the route table', () => {
    const decision = read('src/lib/auth/requestAccess.ts')
    assert.match(decision, /from '\.\/moduleRoutes\.ts'/)
    assert.match(decision, /resolvePathModule\(pathname\)/)
    assert.match(decision, /bindingSatisfiedBy\(binding, access\)/)
    // The two Step-B denials are distinct, and neither is `no_platform_access`:
    // being refused ONE module is not being refused the platform.
    assert.match(decision, /'administrator_required'/)
    assert.match(decision, /'module_not_granted'/)
  })

  // SUPERSEDED by POST-R13.6CDE, which is the stage this deferral named.
  // Inverted rather than deleted: the same boundary is now guarded from the
  // other side — navigation must consume the module rule, and must consume THAT
  // rule rather than inventing a second one.
  test('navigation now consumes the module rule, and only that rule', () => {
    const nav = read('src/lib/navigation.ts')
    assert.match(nav, /moduleAccess|effectiveAccess/, 'navigation must be entitlement-aware')
    assert.match(nav, /visibleNavGroups/)
    // It composes the shared helpers; it must not re-derive access itself.
    assert.doesNotMatch(nav, /user_module_grants|isApproved\s*===|role\s*===/)
    assert.doesNotMatch(nav, /from 'next|@supabase|process\.env/, 'still a pure config module')
  })

  test('no route handler consumes it yet', () => {
    for (const f of [
      'src/lib/auth/apiGuard.ts',
      'src/lib/portfolioAccess/getEntitlement.ts',
    ]) {
      assert.doesNotMatch(read(f), /moduleAccess|canAccessModule|user_module_grants/)
    }
  })

  test('the policy engine is pure — no Next.js, Supabase or environment import', () => {
    for (const src of [POLICY_SRC, ROUTES_SRC, COMPOSITION_SRC]) {
      assert.doesNotMatch(src, /from 'next|@supabase|process\.env/)
    }
  })

  test('authorization never reads client-controlled metadata', () => {
    for (const src of [POLICY_SRC, ROUTES_SRC, COMPOSITION_SRC]) {
      assert.doesNotMatch(codeOf(src), /user_metadata|app_metadata|headers\(|cookies\(/)
    }
  })

  test('the R1.5 default-deny session policy is unchanged', () => {
    assert.equal(classifyPath('/login'), 'public_page')
    assert.equal(classifyPath('/portfolio'), 'private_page')
    assert.equal(classifyPath('/api/family-portfolio/scopes'), 'private_api')
    assert.equal(classifyPath('/api/cron/ingest-bcch-macro'), 'bearer_auth_api')
    assert.equal(classifyPath('/some-future-page'), 'private_page')
  })

  test('approval semantics are unchanged — only the stale comment was corrected', () => {
    const approval = read('src/lib/auth/approval.ts')
    assert.match(approval, /username\.length > 0/)
    // The claim that `role` is unread was true at R1.5 and false since R13.1.
    assert.doesNotMatch(approval, /is read\s*\n?\/\/ NOWHERE in the codebase/)
    assert.match(approval, /APPROVAL ITSELF IS STILL PRESENCE-BASED/)
  })
})
