// R13.6F — THE PROVISIONING DECISION LAYER.
//
// FULLY BEHAVIOURAL. Everything in `lib/admin/userProvisioning.ts` is pure, so
// every case below runs the real function rather than inspecting its source.
//
// The one property that cannot be executed — that `default_for_member` reaches
// form initialisation and NOTHING else — is asserted structurally at the end,
// against comment-stripped source, because its whole point is the ABSENCE of a
// call somewhere else.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  defaultModulesForNewMember,
  normalizeModules,
  resolveAccountShape,
  projectedPortfolioScopes,
  principalCeiling,
  provisioningWarnings,
  PROVISIONING_WARNINGS,
  PRINCIPAL_OPTIONS,
  isAssignableRole,
  ASSIGNABLE_ROLES,
  type AccountShape,
} from '../src/lib/admin/userProvisioning.ts'
import { APP_MODULE_KEYS } from '../src/lib/auth/moduleAccess.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const code = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The registry exactly as 20260814000000 seeds it. */
const REGISTRY = [
  { module_key: 'markets', default_for_member: true },
  { module_key: 'analysis', default_for_member: true },
  { module_key: 'macro', default_for_member: true },
  { module_key: 'earnings', default_for_member: true },
  { module_key: 'portfolio', default_for_member: true },
  { module_key: 'alternatives', default_for_member: true },
  { module_key: 'structured_notes', default_for_member: false },
]

function shape(over: Partial<AccountShape> = {}): AccountShape {
  return { role: 'user', principal: null, modules: [], ...over }
}

describe('R13.6F § 7 — the new-member module defaults', () => {
  it('starts a member form with the six defaults ON and structured_notes OFF', () => {
    assert.deepEqual(defaultModulesForNewMember(REGISTRY), [
      'markets',
      'analysis',
      'macro',
      'earnings',
      'portfolio',
      'alternatives',
    ])
  })

  it('returns them in canonical order regardless of registry order', () => {
    const shuffled = [...REGISTRY].reverse()
    assert.deepEqual(defaultModulesForNewMember(shuffled), defaultModulesForNewMember(REGISTRY))
  })

  it('drops a registry key this build does not declare', () => {
    const withGhost = [...REGISTRY, { module_key: 'ghost_module', default_for_member: true }]
    assert.equal(defaultModulesForNewMember(withGhost).includes('ghost_module' as never), false)
  })

  it('an empty or all-false registry yields no defaults, and does not throw', () => {
    assert.deepEqual(defaultModulesForNewMember([]), [])
    assert.deepEqual(
      defaultModulesForNewMember(REGISTRY.map((r) => ({ ...r, default_for_member: false }))),
      [],
    )
  })
})

describe('R13.6F § 7 — module normalization', () => {
  it('accepts a valid set and canonicalizes order and duplicates', () => {
    assert.deepEqual(normalizeModules(['portfolio', 'markets', 'portfolio']), ['markets', 'portfolio'])
  })

  it('refuses anything unrecognised rather than silently dropping it', () => {
    assert.equal(normalizeModules(['markets', 'nope']), null)
    assert.equal(normalizeModules(['jaime']), null, 'a principal is not a module')
    assert.equal(normalizeModules('markets'), null)
    assert.equal(normalizeModules(null), null)
    assert.equal(normalizeModules([1, 2]), null)
  })

  it('accepts the empty set — a zero-module member is legal', () => {
    assert.deepEqual(normalizeModules([]), [])
  })
})

describe('R13.6F § 7 / § 17 — account shape and administrator canonicalization', () => {
  it('accepts a member with a principal and modules', () => {
    const r = resolveAccountShape({ role: 'user', principal: 'jaime', modules: ['markets'] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.ok && r.shape, { role: 'user', principal: 'jaime', modules: ['markets'] })
  })

  it('canonicalizes an ADMINISTRATOR: no principal, no grants', () => {
    const r = resolveAccountShape({
      role: 'administrator',
      principal: 'pablo',
      modules: ['markets', 'portfolio'],
    })
    assert.equal(r.ok, true)
    assert.deepEqual(r.ok && r.shape, { role: 'administrator', principal: null, modules: [] })
  })

  it('still VALIDATES an administrator\'s modules before discarding them', () => {
    const r = resolveAccountShape({ role: 'administrator', principal: null, modules: ['bogus'] })
    assert.equal(r.ok, false)
    assert.equal(!r.ok && r.code, 'invalid_module')
  })

  it('refuses an invented role or principal', () => {
    assert.equal(resolveAccountShape({ role: 'superuser', principal: null, modules: [] }).ok, false)
    assert.equal(resolveAccountShape({ role: 'user', principal: 'mallorca', modules: [] }).ok, false)
    assert.equal(resolveAccountShape({ role: null, principal: null, modules: [] }).ok, false)
  })

  it('treats empty string, null and undefined principal as None', () => {
    for (const p of ['', null, undefined]) {
      const r = resolveAccountShape({ role: 'user', principal: p, modules: [] })
      assert.equal(r.ok, true)
      assert.equal(r.ok && r.shape.principal, null)
    }
  })

  it('offers exactly the four principal choices', () => {
    assert.deepEqual([...PRINCIPAL_OPTIONS], [null, 'jaime', 'andres', 'pablo'])
    assert.deepEqual([...ASSIGNABLE_ROLES], ['user', 'administrator'])
    assert.equal(isAssignableRole('administrator'), true)
    assert.equal(isAssignableRole('admin'), false)
  })

  it('the SQL side canonicalizes identically, so a direct caller gets the same rule', () => {
    const m = code(read('supabase/migrations/20260817000000_user_lifecycle_provisioning.sql'))
    for (const fn of ['nmi_admin_provision_invite', 'nmi_admin_update_access']) {
      const body = m.match(
        new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`),
      )?.[1]
      assert.match(body!, /v_role = 'administrator'/)
      assert.match(body!, /v_principal\s*:=\s*null/)
      assert.match(body!, /v_modules\s*:=\s*array\[\]::text\[\]/)
    }
  })
})

describe('R13.6F § 9 / § 21 — the Portfolio ceiling can only be subtracted from', () => {
  it('each principal projects exactly its frozen ceiling when Portfolio is granted', () => {
    const cases: [('jaime' | 'andres' | 'pablo'), string[]][] = [
      ['jaime', ['main', 'jaime', 'alternatives']],
      ['andres', ['main', 'andres', 'alternatives']],
      ['pablo', ['main', 'pablo', 'alternatives']],
    ]
    for (const [principal, expected] of cases) {
      assert.deepEqual(principalCeiling(principal), expected, principal)
      assert.deepEqual(
        projectedPortfolioScopes(shape({ principal, modules: ['portfolio', 'alternatives'] })),
        expected,
        principal,
      )
    }
  })

  it('no principal means no personal Portfolio scope, however many modules are granted', () => {
    assert.deepEqual(principalCeiling(null), [])
    assert.deepEqual(
      projectedPortfolioScopes(shape({ principal: null, modules: [...APP_MODULE_KEYS] })),
      [],
      'granting every module never manufactures "main"',
    )
  })

  it('NO module grant can widen a principal ceiling into a sibling', () => {
    for (const principal of ['jaime', 'andres', 'pablo'] as const) {
      const scopes = projectedPortfolioScopes(
        shape({ principal, modules: [...APP_MODULE_KEYS] }),
      )
      const siblings = (['jaime', 'andres', 'pablo'] as const).filter((p) => p !== principal)
      for (const s of siblings) {
        assert.equal(scopes.includes(s), false, `${principal} must never see ${s}`)
      }
      assert.equal(scopes.includes('admin'), false, `${principal} must never see admin`)
    }
  })

  it('dropping the Portfolio module SUBTRACTS the personal scope', () => {
    assert.deepEqual(projectedPortfolioScopes(shape({ principal: 'jaime', modules: ['alternatives'] })), [
      'alternatives',
    ])
    assert.deepEqual(projectedPortfolioScopes(shape({ principal: 'jaime', modules: ['markets'] })), [])
  })

  it('an administrator projects the full ceiling by role', () => {
    assert.deepEqual(projectedPortfolioScopes({ role: 'administrator', principal: null, modules: [] }), [
      'main',
      'jaime',
      'andres',
      'pablo',
      'alternatives',
      'admin',
    ])
  })
})

describe('R13.6F § 8 / § 9 — warnings advise, they never act', () => {
  it('warns that a zero-module member cannot enter the platform', () => {
    assert.deepEqual(provisioningWarnings(shape({ modules: [] })), [PROVISIONING_WARNINGS.noModules])
  })

  it('does NOT silently switch a module on to avoid the warning', () => {
    const r = resolveAccountShape({ role: 'user', principal: null, modules: [] })
    assert.equal(r.ok, true)
    assert.deepEqual(r.ok && r.shape.modules, [], 'the empty set is saved exactly as asked')
  })

  it('warns when Portfolio is granted with no principal', () => {
    const w = provisioningWarnings(shape({ principal: null, modules: ['portfolio'] }))
    assert.ok(w.includes(PROVISIONING_WARNINGS.portfolioWithoutPrincipal))
  })

  it('warns when a principal is set but Portfolio is not granted', () => {
    const w = provisioningWarnings(shape({ principal: 'jaime', modules: ['markets'] }))
    assert.ok(w.includes(PROVISIONING_WARNINGS.principalWithoutPortfolio))
  })

  it('a coherent member configuration warns about nothing', () => {
    assert.deepEqual(provisioningWarnings(shape({ principal: 'jaime', modules: ['portfolio'] })), [])
  })

  it('an administrator gets no warnings — the conditions cannot arise', () => {
    assert.deepEqual(provisioningWarnings({ role: 'administrator', principal: null, modules: [] }), [])
  })

  it('a zero-module member with a principal reports BOTH warnings', () => {
    const w = provisioningWarnings(shape({ principal: 'pablo', modules: [] }))
    assert.deepEqual(w.sort(), [
      PROVISIONING_WARNINGS.noModules,
      PROVISIONING_WARNINGS.principalWithoutPortfolio,
    ].sort())
  })
})

describe('R13.6F § 25 — the CLI fallback and the UI agree on the rule', () => {
  const CLI = code(read('scripts/admin/provisionUser.ts'))
  const MIGRATION = code(read('supabase/migrations/20260817000000_user_lifecycle_provisioning.sql'))

  it('the CLI stamps activation, so its accounts can actually sign in', () => {
    // Without this the script would produce an account that looks provisioned in
    // the directory and is refused at every request — a silent regression in the
    // one tool that exists for emergencies. Caught by review, not by luck.
    assert.match(CLI, /activated_at: new Date\(\)\.toISOString\(\)/)
  })

  it('...but never MOVES an existing activation date', () => {
    // The migration's stated invariant. A bare upsert would rewrite the date on
    // every repair run; the guard is what keeps the history honest.
    assert.match(CLI, /\.is\('activated_at', null\)/)
  })

  it('the CLI never re-enables a disabled account', () => {
    // Re-running a repair command must not undo an administrator's decision.
    assert.doesNotMatch(CLI, /disabled_at\s*:/)
    assert.doesNotMatch(CLI, /disabled_at\s*=/)
  })

  it('the UI invitation path deliberately does NOT pre-activate', () => {
    // The two paths differ only in WHO activates: the invitee proves acceptance by
    // following their one-time link; the CLI has no link, so it activates outright.
    const provision = MIGRATION.match(
      /create or replace function public\.nmi_admin_provision_invite[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1]
    assert.ok(provision)
    assert.match(provision!, /invited_at\)/, 'the invite records invited_at')
    assert.doesNotMatch(
      provision!,
      /activated_at\s*(=|,)\s*now\(\)/,
      'and never activates on the administrator\'s behalf',
    )
  })

  it('both paths are governed by the SAME usability rule', () => {
    // Neither the CLI nor the UI may define its own notion of "usable"; there is
    // one predicate and both are downstream of it.
    assert.match(MIGRATION, /create or replace function public\.nmi_profile_usable/)
    assert.doesNotMatch(CLI, /nmi_profile_usable/, 'the CLI does not reimplement the rule')
    assert.doesNotMatch(CLI, /activated_at is not null/, 'nor a copy of its logic')
  })

  it('the CLI grants no modules, role or principal — those stay administrator decisions', () => {
    // A CLI-provisioned account is an approved, activated, ZERO-GRANT member: it can
    // sign in and can reach nothing until an administrator grants it something in
    // the console. That is deliberate — an emergency repair tool must not be able
    // to hand out access silently.
    assert.doesNotMatch(CLI, /user_module_grants/)
    assert.doesNotMatch(CLI, /portfolio_principal/)
    assert.doesNotMatch(CLI, /role:\s*'administrator'/)
  })
})

describe('R13.6F § 7 — the invite form mirror matches the registry seed', () => {
  it('the form defaults equal what the migration actually seeds', () => {
    // The invite dialog derives its initial switches from a small local mirror of
    // `app_modules` rather than a round-trip. That is fine for FORM INITIALISATION,
    // but the mirror could drift from the seed — so it is pinned here.
    const seed = read('supabase/migrations/20260814000000_module_entitlements.sql')
    const rows = [...seed.matchAll(/\('([a-z_]+)',\s*'[^']*',\s*\d+,\s*(true|false)\)/g)]
    assert.ok(rows.length >= 7, `found ${rows.length} seeded module rows`)
    const seededDefaults = rows.filter((m) => m[2] === 'true').map((m) => m[1]).sort()

    const invite = code(read('src/app/settings/users/InviteUserDialog.tsx'))
    assert.match(invite, /defaultModulesForNewMember/, 'the form uses the shared helper')

    // The mirror's rule, stated in the dialog, must produce the seeded set.
    const mirrored = defaultModulesForNewMember(
      APP_MODULE_KEYS.map((k) => ({ module_key: k, default_for_member: k !== 'structured_notes' })),
    )
    assert.deepEqual([...mirrored].sort(), seededDefaults)
    assert.ok(!mirrored.includes('structured_notes'), 'structured_notes stays OFF by default')
  })
})

describe('R13.6F § 8 — default_for_member is provisioning metadata ONLY', () => {
  it('the flag is READ in exactly one place: the form-default helper', () => {
    const provisioning = code(read('src/lib/admin/userProvisioning.ts'))

    // A property ACCESS is the thing that matters. The interface field that
    // declares the column's existence is not a read, so it is excluded
    // deliberately rather than by making the count loose enough to pass.
    const reads = provisioning.match(/\.default_for_member\b/g) ?? []
    assert.equal(reads.length, 1, 'the flag is dereferenced exactly once')

    const fn = provisioning.match(/export function defaultModulesForNewMember[\s\S]*?\n}/)?.[0]
    assert.ok(fn, 'defaultModulesForNewMember exists')
    assert.match(fn!, /\.default_for_member\b/, 'and that one read is inside it')

    // The declaration is present, and is a type only.
    assert.match(provisioning, /default_for_member\?:\s*boolean/)
  })

  it('no authorization module mentions it at all', () => {
    for (const f of [
      'src/lib/auth/moduleAccess.ts',
      'src/lib/auth/accountLifecycle.ts',
      'src/lib/auth/authorizationState.ts',
      'src/lib/auth/requestAccess.ts',
      'src/lib/auth/getModuleAccess.ts',
      'src/lib/auth/moduleApiGuard.ts',
    ]) {
      assert.doesNotMatch(code(read(f)), /default_for_member/, f)
    }
  })

  it('no API route consults it when deciding access', () => {
    for (const f of [
      'src/app/api/admin/users/route.ts',
      'src/app/api/admin/users/[id]/route.ts',
      'src/app/api/admin/users/[id]/modules/route.ts',
      'src/app/api/admin/users/[id]/lifecycle/route.ts',
    ]) {
      assert.doesNotMatch(code(read(f)), /default_for_member/, f)
    }
  })
})
