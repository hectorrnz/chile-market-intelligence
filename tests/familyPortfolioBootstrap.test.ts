// R13.1.1A — Administrator bootstrap continuity.
//
// WHAT RUNS HERE, AND WHAT DOES NOT.
//
// BEHAVIOURAL — the role-change decision rules and the audit-entry builder are
// EXECUTED for real, including every denial path, the bootstrap window, and
// last-administrator protection.
//
// STRUCTURAL — the migration's audit amendment and the role-management CLI are
// asserted to exist and to be correct.
//
// NOT RUN HERE — PostgreSQL. There is no local Postgres in this environment (no
// Docker, no psql). The executable proof lives in
// supabase/tests/database/family_portfolio_entitlements_test.sql and runs in the
// workflow asserted by tests/familyPortfolioDbValidation.test.ts.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  decideRoleChange,
  buildRoleAuditEntry,
  isAssignableRole,
  normalizeStoredRole,
  ASSIGNABLE_ROLES,
} from '../src/lib/portfolioAccess/roleAssignment.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

const MIGRATION = read('supabase/migrations/20260806000000_family_portfolio_entitlements.sql')
const SQL = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const ADMIN = { userId: 'admin-1', isApproved: true, isAdministrator: true }

/** An ordinary (post-bootstrap) request with administrators already present. */
const ordinary = (over: Record<string, unknown> = {}) => ({
  bootstrapRequested: false,
  approvedAdministratorCount: 2,
  actor: ADMIN,
  targetUserId: 'target-1',
  targetExists: true,
  targetIsApproved: true,
  targetCurrentRole: 'user' as unknown,
  requestedRole: 'administrator' as unknown,
  ...over,
})

/** A bootstrap request in a world with no administrator at all. */
const bootstrap = (over: Record<string, unknown> = {}) => ({
  bootstrapRequested: true,
  approvedAdministratorCount: 0,
  actor: null,
  targetUserId: 'target-1',
  targetExists: true,
  targetIsApproved: true,
  targetCurrentRole: 'user' as unknown,
  requestedRole: 'administrator' as unknown,
  ...over,
})

// ---------------------------------------------------------------------------
// 1 - The gap this stage closes
// ---------------------------------------------------------------------------

describe('the deadlock R13.1 shipped with', () => {
  test('no src file and no migration writes user_profiles.role', () => {
    // If this ever changes, the bootstrap escape hatch is no longer the only
    // way a role can be created, and that must be a deliberate decision.
    assert.doesNotMatch(SQL, /update\s+public\.user_profiles[\s\S]{0,80}\brole\b\s*=/i)
    assert.doesNotMatch(SQL, /\binsert\s+into\s+public\.user_profiles\b/i)
  })

  test('assigning a principal still requires an administrator actor', () => {
    assert.match(read('src/lib/portfolioAccess/principalAssignment.ts'), /actor_not_administrator/)
  })

  test('a role-management CLI now exists to break the deadlock', () => {
    assert.ok(existsSync(join(ROOT, 'scripts/admin/setUserRole.ts')))
  })
})

// ---------------------------------------------------------------------------
// 2 - Bootstrap rules
// ---------------------------------------------------------------------------

describe('first-administrator bootstrap', () => {
  test('it is allowed only when NO approved administrator exists', () => {
    const d = decideRoleChange(bootstrap())
    assert.equal(d.allowed, true)
    assert.equal(d.allowed && d.actorKind, 'service_bootstrap')
    assert.equal(d.allowed && d.newValue, 'administrator')
    assert.equal(d.allowed && d.changed, true)
  })

  test('it closes permanently once an administrator exists', () => {
    for (const n of [1, 2, 7]) {
      assert.deepEqual(
        decideRoleChange(bootstrap({ approvedAdministratorCount: n })),
        { allowed: false, code: 'bootstrap_not_available' },
        `bootstrap must be refused with ${n} administrator(s)`,
      )
    }
  })

  test('the target must exist and be approved', () => {
    assert.deepEqual(decideRoleChange(bootstrap({ targetExists: false })), { allowed: false, code: 'target_not_found' })
    assert.deepEqual(
      decideRoleChange(bootstrap({ targetIsApproved: false })),
      { allowed: false, code: 'target_not_approved' },
    )
  })

  test('an invalid target is refused', () => {
    for (const t of [null, undefined, '', '   ', 42]) {
      assert.deepEqual(decideRoleChange(bootstrap({ targetUserId: t })), { allowed: false, code: 'invalid_target' })
    }
  })

  test('it cannot grant a role outside the constrained set', () => {
    for (const r of ['superuser', 'ADMIN', 'root', '', null, 42]) {
      assert.deepEqual(decideRoleChange(bootstrap({ requestedRole: r })), { allowed: false, code: 'invalid_role' })
    }
  })

  test('an ordinary change is impossible while no administrator exists, and says so', () => {
    assert.deepEqual(
      decideRoleChange(ordinary({ approvedAdministratorCount: 0 })),
      { allowed: false, code: 'bootstrap_required' },
    )
  })

  test('bootstrap never infers the target from anything - it is always explicit', () => {
    const cli = codeOf(read('scripts/admin/setUserRole.ts'))
    // No environment, git, hostname or OS-user derived identity.
    assert.doesNotMatch(cli, /process\.env\.(USER|USERNAME|LOGNAME)/)
    assert.doesNotMatch(cli, /os\.userInfo|hostname\(|git\s+config/)
    assert.doesNotMatch(cli, /@[a-z0-9-]+\.(cl|com|net)\b/i, 'no email domain heuristic')
    assert.match(cli, /--target <username> is required/)
  })
})

// ---------------------------------------------------------------------------
// 3 - Ordinary administrator role management
// ---------------------------------------------------------------------------

describe('ordinary administrator role changes', () => {
  test('an approved administrator can promote another user', () => {
    const d = decideRoleChange(ordinary())
    assert.equal(d.allowed, true)
    assert.equal(d.allowed && d.actorKind, 'administrator')
  })

  test('an approved administrator can demote another administrator when others remain', () => {
    const d = decideRoleChange(ordinary({ targetCurrentRole: 'administrator', requestedRole: 'user' }))
    assert.equal(d.allowed, true)
    assert.equal(d.allowed && d.newValue, 'user')
  })

  test('a non-administrator actor is rejected', () => {
    assert.deepEqual(
      decideRoleChange(ordinary({ actor: { userId: 'u', isApproved: true, isAdministrator: false } })),
      { allowed: false, code: 'actor_not_administrator' },
    )
  })

  test('an unapproved or unknown actor is rejected', () => {
    assert.deepEqual(
      decideRoleChange(ordinary({ actor: { userId: 'a', isApproved: false, isAdministrator: true } })),
      { allowed: false, code: 'actor_not_approved' },
    )
    for (const id of [null, undefined, '', '  ']) {
      assert.deepEqual(
        decideRoleChange(ordinary({ actor: { userId: id, isApproved: true, isAdministrator: true } })),
        { allowed: false, code: 'actor_unknown' },
      )
    }
    assert.deepEqual(decideRoleChange(ordinary({ actor: null })), { allowed: false, code: 'actor_unknown' })
  })

  test('an administrator cannot change their OWN role in either direction', () => {
    assert.deepEqual(
      decideRoleChange(ordinary({ targetUserId: ADMIN.userId, requestedRole: 'administrator' })),
      { allowed: false, code: 'self_role_change_forbidden' },
    )
    assert.deepEqual(
      decideRoleChange(ordinary({ targetUserId: ADMIN.userId, targetCurrentRole: 'administrator', requestedRole: 'user' })),
      { allowed: false, code: 'self_role_change_forbidden' },
    )
  })

  test('the actor is authorized BEFORE the request is examined', () => {
    // A non-administrator must not learn whether the target exists.
    assert.deepEqual(
      decideRoleChange(
        ordinary({
          actor: { userId: 'u', isApproved: true, isAdministrator: false },
          targetExists: false,
          requestedRole: 'bogus',
        }),
      ),
      { allowed: false, code: 'actor_not_administrator' },
    )
  })

  test('the target must be approved - an unusable account never holds a role', () => {
    assert.deepEqual(
      decideRoleChange(ordinary({ targetIsApproved: false })),
      { allowed: false, code: 'target_not_approved' },
    )
  })

  test('a no-op change is allowed but writes nothing', () => {
    const d = decideRoleChange(ordinary({ targetCurrentRole: 'administrator', requestedRole: 'administrator' }))
    assert.equal(d.allowed && d.changed, false)
    assert.equal(buildRoleAuditEntry(d, ADMIN.userId), null)
  })
})

// ---------------------------------------------------------------------------
// 4 - Last-administrator protection
// ---------------------------------------------------------------------------

describe('last-administrator protection', () => {
  test('the final approved administrator cannot be demoted', () => {
    assert.deepEqual(
      decideRoleChange(
        ordinary({
          approvedAdministratorCount: 1,
          actor: { userId: 'other-admin', isApproved: true, isAdministrator: true },
          targetCurrentRole: 'administrator',
          requestedRole: 'user',
        }),
      ),
      { allowed: false, code: 'last_administrator_protected' },
    )
  })

  test('demotion is allowed once a second administrator exists', () => {
    const d = decideRoleChange(
      ordinary({ approvedAdministratorCount: 2, targetCurrentRole: 'administrator', requestedRole: 'user' }),
    )
    assert.equal(d.allowed, true)
  })

  test('protection does not block promoting a non-administrator', () => {
    const d = decideRoleChange(ordinary({ approvedAdministratorCount: 1, targetCurrentRole: 'user' }))
    assert.equal(d.allowed, true, 'promotion must stay possible even with one administrator')
  })

  test('demoting the last administrator can never re-open the deadlock', () => {
    // The two mechanisms compose: demotion is blocked at 1, and bootstrap is
    // blocked above 0, so the count can never reach 0 through this workflow.
    const demote = decideRoleChange(
      ordinary({
        approvedAdministratorCount: 1,
        actor: { userId: 'x', isApproved: true, isAdministrator: true },
        targetCurrentRole: 'administrator',
        requestedRole: 'user',
      }),
    )
    assert.equal(demote.allowed, false)
    assert.deepEqual(
      decideRoleChange(bootstrap({ approvedAdministratorCount: 1 })),
      { allowed: false, code: 'bootstrap_not_available' },
    )
  })
})

// ---------------------------------------------------------------------------
// 5 - Honest audit actor semantics
// ---------------------------------------------------------------------------

describe('audit actor representation', () => {
  test('an administrator change names its actor', () => {
    const d = decideRoleChange(ordinary())
    assert.deepEqual(buildRoleAuditEntry(d, ADMIN.userId), {
      target_user_id: 'target-1',
      actor_user_id: ADMIN.userId,
      actor_kind: 'administrator',
      field_changed: 'role',
      previous_value: 'user',
      new_value: 'administrator',
    })
  })

  test('a bootstrap records NO application actor, never the target', () => {
    const d = decideRoleChange(bootstrap())
    const entry = buildRoleAuditEntry(d, 'target-1')
    assert.equal(entry!.actor_user_id, null, 'the target must never be recorded as the actor')
    assert.equal(entry!.actor_kind, 'service_bootstrap')
    assert.equal(entry!.target_user_id, 'target-1')
  })

  test('a denied change never produces an audit entry', () => {
    const denials = [
      ordinary({ actor: { userId: 'u', isApproved: true, isAdministrator: false } }),
      ordinary({ targetUserId: ADMIN.userId }),
      ordinary({ requestedRole: 'root' }),
      ordinary({ approvedAdministratorCount: 1, targetCurrentRole: 'administrator', requestedRole: 'user' }),
      bootstrap({ approvedAdministratorCount: 3 }),
    ]
    for (const req of denials) {
      const d = decideRoleChange(req)
      assert.equal(d.allowed, false)
      assert.equal(buildRoleAuditEntry(d, ADMIN.userId), null, 'a denial must not be auditable as a success')
    }
  })

  test('the audit entry can only ever describe role', () => {
    assert.equal(buildRoleAuditEntry(decideRoleChange(ordinary()), ADMIN.userId)!.field_changed, 'role')
  })

  test('role helpers normalize defensively', () => {
    assert.equal(normalizeStoredRole('administrator'), 'administrator')
    for (const v of ['Administrator', 'root', '', null, undefined, 7]) {
      assert.equal(normalizeStoredRole(v), 'user', `unexpected stored role ${String(v)} must degrade to user`)
    }
    assert.equal(isAssignableRole('administrator'), true)
    assert.equal(isAssignableRole('ADMIN'), false)
    assert.deepEqual([...ASSIGNABLE_ROLES], ['user', 'administrator'])
  })
})

// ---------------------------------------------------------------------------
// 6 - Migration amendment (audit actor columns)
// ---------------------------------------------------------------------------

describe('audit schema amendment', () => {
  test('actor_user_id is nullable and actor_kind exists with both kinds', () => {
    assert.match(SQL, /actor_user_id\s+uuid\s+references auth\.users\(id\)/)
    assert.doesNotMatch(SQL, /actor_user_id\s+uuid\s+not null/)
    assert.match(SQL, /actor_kind\s+text\s+not null[\s\S]{0,140}check \(actor_kind in \('administrator', 'service_bootstrap'\)\)/)
  })

  test('a CHECK binds actor_kind to actor_user_id so neither kind can be misrepresented', () => {
    assert.match(SQL, /actor_kind = 'administrator'\s+and actor_user_id is not null/)
    assert.match(SQL, /actor_kind = 'service_bootstrap' and actor_user_id is null/)
  })

  test('a postcondition proves the constraint exists and actor_user_id stayed nullable', () => {
    assert.match(SQL, /family_portfolio_access_audit_actor_check is missing/)
    assert.match(SQL, /recorded honestly/)
  })

  test('the amendment stays inside the single R13.1 migration', () => {
    // The guarantee being protected is that R13.1.1A recorded its audit-schema
    // amendment INSIDE the R13.1 migration rather than adding a second one of
    // its own. R13.2 then legitimately adds its own upload/storage migration —
    // it is a separate stage, and R13.1 is now pushed, so amending it in place
    // would no longer be legal. Both facts are asserted explicitly, so a stray
    // extra migration still fails here.
    // Scoped to R13.1's own window rather than "everything after R13.0". A
    // later stage legitimately adds its own migration (R13.2 did), and that is
    // not a defect — but a SECOND migration belonging to R13.1/R13.1.1A is.
    // Bounding the window keeps the guarantee without dating the test.
    const R13_1_WINDOW_START = '20260804'
    const R13_2_START = '20260807000000'

    const all = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
    const inR13_1Window = all.filter((f) => f > R13_1_WINDOW_START && f < R13_2_START)
    assert.deepEqual(inR13_1Window, ['20260806000000_family_portfolio_entitlements.sql'],
      'R13.1.1A must amend the R13.1 migration in place, never add a second one')
  })

  test('field_changed still accepts role, which the bootstrap writes', () => {
    assert.match(SQL, /field_changed in \('portfolio_principal', 'role'\)/)
  })
})

// ---------------------------------------------------------------------------
// 7 - The role-management CLI
// ---------------------------------------------------------------------------

describe('setUserRole CLI', () => {
  const CODE = codeOf(read('scripts/admin/setUserRole.ts'))

  test('it is a CLI outside src/, never HTTP-reachable', () => {
    assert.ok(existsSync(join(ROOT, 'scripts/admin/setUserRole.ts')))
    assert.equal(existsSync(join(ROOT, 'src/app/api/admin')), false)
    // No src file may write user_profiles - restated so a regression fails here too.
    const stack: string[] = [join(ROOT, 'src')]
    const offenders: string[] = []
    while (stack.length) {
      const dir = stack.pop()!
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) stack.push(full)
        else if (/\.tsx?$/.test(e.name)) {
          const s = readFileSync(full, 'utf8')
          if (/from\(['"]user_profiles['"]\)/.test(s) && /\.(insert|upsert|update)\(/.test(s)) offenders.push(full)
        }
      }
    }
    assert.deepEqual(offenders, [])
  })

  test('it writes ONLY the role column', () => {
    const updates = [...CODE.matchAll(/\.update\(\{([^}]*)\}\)/g)].map((m) => m[1].trim())
    assert.deepEqual(updates, ['role: decision.newValue'])
  })

  test('dry-run is the default and --write is an explicit opt-in', () => {
    assert.match(CODE, /if \(!args\.write\)/)
    assert.match(CODE, /Re-run with --write to apply/)
  })

  test('bootstrap and actor are mutually exclusive', () => {
    assert.match(CODE, /--bootstrap and --actor are mutually exclusive/)
  })

  test('the administrator count comes from real rows, never a flag', () => {
    assert.match(CODE, /approvedAdministrators\s*=\s*rows\.filter/)
    assert.match(CODE, /approvedAdministratorCount: approvedAdministrators\.length/)
  })

  test('it applies the pure decision rules rather than re-implementing them', () => {
    assert.match(CODE, /decideRoleChange\(/)
    assert.match(CODE, /buildRoleAuditEntry\(/)
  })

  test('a failed audit write is reported as a failure, never a clean success', () => {
    assert.match(CODE, /audit row FAILED to write/)
  })

  test('it never prints or reads a secret, key, password or token', () => {
    assert.doesNotMatch(CODE, /console\.log\([^)]*(?:SERVICE_ROLE|apiKey|password|token|secret)/i)
    assert.doesNotMatch(CODE, /process\.env\.[A-Z_]*(KEY|SECRET|PASSWORD|TOKEN)/)
  })

  test('no username, email or UUID is hardcoded', () => {
    assert.doesNotMatch(CODE, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    assert.doesNotMatch(CODE, /@[a-z0-9-]+\.(cl|com|net)\b/i)
  })

  test('provisionUser points at the entitlement step so the workflow is coherent', () => {
    assert.match(read('scripts/admin/provisionUser.ts'), /assignPortfolioPrincipal\.ts/)
  })
})
