// R13.1 — Family Portfolio entitlement and authorization foundation.
//
// WHAT RUNS HERE, AND WHAT DOES NOT.
//
// There is no local Supabase instance in this environment: Docker is not
// installed (so `supabase start` cannot run), psql is absent, there is no
// supabase/config.toml, and no service-role key is present. RLS, privilege and
// function behaviour therefore CANNOT be executed against a real database from
// this suite. Claiming otherwise would be false — the same honest split
// tests/userProfilesRls.test.ts established for R1.5.
//
// Coverage is split accordingly:
//   · BEHAVIOURAL — the TypeScript authorization rule, the scope guards and the
//     assignment guards are EXECUTED for real, including every negative case.
//   · PARITY      — the truth table embedded in the migration is parsed and
//     asserted row-for-row identical to the TypeScript truth table. The SQL side
//     of each row is then EXECUTED BY POSTGRES ITSELF at apply time by the
//     migration's own `do $$ … $$` postcondition block, which raises if
//     `nmi_portfolio_scopes()` disagrees. That block is the real in-database
//     proof; this file proves the two tables are the same table.
//   · STRUCTURAL  — the migration's constraints, policies, privileges, function
//     volatility/security settings and postconditions are asserted to exist and
//     to be correct.
//   · REGRESSION  — existing approval, access-policy and /portfolio behaviour is
//     re-exercised to prove R13.1 changed none of it.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  FAMILY_PORTFOLIO_SCOPES,
  PORTFOLIO_PRINCIPALS,
  APPLICATION_ROLES,
  scopesFor,
  canReadScope,
  canAdminister,
  entitlementFromProfile,
  isPortfolioPrincipal,
  isFamilyPortfolioScope,
  type FamilyPortfolioScope,
} from '../src/lib/portfolioAccess/entitlements.ts'
import {
  ENTITLEMENT_TRUTH_TABLE,
  INVALID_SCOPE_INPUTS,
} from '../src/lib/portfolioAccess/truthTable.ts'
import {
  decidePrincipalAssignment,
  buildAccessAuditEntry,
  normalizeStoredPrincipal,
} from '../src/lib/portfolioAccess/principalAssignment.ts'
import { isApprovedProfile } from '../src/lib/auth/approval.ts'
import { classifyPath, requiresApprovedSession } from '../src/lib/auth/accessPolicy.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * TypeScript source with comments removed. These modules document WHY a
 * dangerous pattern is avoided (e.g. "never read `user_metadata`"), so a
 * whole-file negative assertion would be satisfied by the very prose that
 * explains the safeguard. Assert against code.
 */
const codeOf = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

const MIGRATION_DIR = 'supabase/migrations'
const MIGRATION_NAME = '20260806000000_family_portfolio_entitlements.sql'
const MIGRATION = read(`${MIGRATION_DIR}/${MIGRATION_NAME}`)
/** SQL with `--` comments stripped, so prose can never satisfy a code assertion. */
const SQL = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const approved = (over: Partial<Parameters<typeof scopesFor>[0]> = {}) => ({
  isApproved: true,
  isAdministrator: false,
  principal: null as string | null,
  ...over,
})

// ─────────────────────────────────────────────────────────────────────────────
// 1 · The access matrix (requirements 1–6, 9–11)
// ─────────────────────────────────────────────────────────────────────────────

describe('access matrix', () => {
  test('an administrator receives every Family Portfolio scope', () => {
    const scopes = scopesFor(approved({ isAdministrator: true }))
    assert.deepEqual(scopes, ['main', 'jaime', 'andres', 'pablo', 'alternatives', 'admin'])
    for (const s of FAMILY_PORTFOLIO_SCOPES) {
      assert.equal(canReadScope(approved({ isAdministrator: true }), s), true, `admin denied ${s}`)
    }
  })

  test('an administrator keeps every scope regardless of principal', () => {
    for (const p of [...PORTFOLIO_PRINCIPALS, null]) {
      assert.deepEqual(
        scopesFor(approved({ isAdministrator: true, principal: p })),
        ['main', 'jaime', 'andres', 'pablo', 'alternatives', 'admin'],
        `administrator with principal ${String(p)}`,
      )
    }
  })

  test('jaime receives exactly main, jaime and alternatives', () => {
    assert.deepEqual(scopesFor(approved({ principal: 'jaime' })), ['main', 'jaime', 'alternatives'])
  })

  test('andres receives exactly main, andres and alternatives', () => {
    assert.deepEqual(scopesFor(approved({ principal: 'andres' })), ['main', 'andres', 'alternatives'])
  })

  test('pablo receives exactly main, pablo and alternatives', () => {
    assert.deepEqual(scopesFor(approved({ principal: 'pablo' })), ['main', 'pablo', 'alternatives'])
  })

  test('an approved non-administrator with a null principal receives no scopes', () => {
    assert.deepEqual(scopesFor(approved({ principal: null })), [])
  })

  test('an unapproved user receives no scopes, even as an administrator', () => {
    assert.deepEqual(scopesFor({ isApproved: false, isAdministrator: false, principal: 'jaime' }), [])
    assert.deepEqual(scopesFor({ isApproved: false, isAdministrator: true, principal: null }), [])
    assert.deepEqual(scopesFor({ isApproved: false, isAdministrator: true, principal: 'pablo' }), [])
  })

  test('no principal can reach a sibling scope', () => {
    const siblings: Record<string, FamilyPortfolioScope[]> = {
      jaime: ['andres', 'pablo'],
      andres: ['jaime', 'pablo'],
      pablo: ['jaime', 'andres'],
    }
    for (const [principal, forbidden] of Object.entries(siblings)) {
      const input = approved({ principal })
      for (const scope of forbidden) {
        assert.equal(canReadScope(input, scope), false, `${principal} reached ${scope}`)
      }
      // ...and never the admin scope.
      assert.equal(canReadScope(input, 'admin'), false, `${principal} reached admin`)
      // ...but always their own, main and alternatives.
      assert.equal(canReadScope(input, principal), true)
      assert.equal(canReadScope(input, 'main'), true)
      assert.equal(canReadScope(input, 'alternatives'), true)
    }
  })

  test('the admin scope is reachable only through the role dimension', () => {
    for (const p of [...PORTFOLIO_PRINCIPALS, null, 'administrator']) {
      assert.equal(canReadScope(approved({ principal: p }), 'admin'), false, `principal ${String(p)}`)
    }
    assert.equal(canReadScope(approved({ isAdministrator: true }), 'admin'), true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Invalid principals and unknown scopes (requirements 7, 8, 23)
// ─────────────────────────────────────────────────────────────────────────────

describe('invalid input is denied', () => {
  test('"administrator" is not a valid portfolio principal', () => {
    assert.equal(isPortfolioPrincipal('administrator'), false)
    assert.equal((PORTFOLIO_PRINCIPALS as readonly string[]).includes('administrator'), false)
    assert.deepEqual(scopesFor(approved({ principal: 'administrator' })), [])
  })

  test('unknown, malformed and non-string principals yield no scopes', () => {
    for (const p of ['nope', '', ' jaime', 'JAIME', 'jaime;--', '*', null, undefined]) {
      assert.deepEqual(scopesFor(approved({ principal: p as string | null })), [], `principal ${String(p)}`)
    }
  })

  test('unknown scope names are denied for every caller, including an administrator', () => {
    const callers = [
      approved({ isAdministrator: true }),
      approved({ principal: 'jaime' }),
      approved({ principal: null }),
      { isApproved: false, isAdministrator: false, principal: null },
    ]
    for (const caller of callers) {
      for (const bad of INVALID_SCOPE_INPUTS) {
        assert.equal(canReadScope(caller, bad), false, `accepted scope ${JSON.stringify(bad)}`)
      }
    }
  })

  test('scopesFor never returns a scope outside the canonical registry', () => {
    const cases = [
      approved({ isAdministrator: true }),
      ...PORTFOLIO_PRINCIPALS.map((p) => approved({ principal: p })),
      approved({ principal: null }),
      { isApproved: false, isAdministrator: true, principal: 'jaime' },
    ]
    for (const c of cases) {
      for (const s of scopesFor(c)) {
        assert.ok(isFamilyPortfolioScope(s), `leaked non-canonical scope ${s}`)
      }
    }
  })

  test('a returned scope array cannot mutate the module tables', () => {
    const first = scopesFor(approved({ principal: 'jaime' }))
    first.push('admin' as FamilyPortfolioScope)
    assert.deepEqual(scopesFor(approved({ principal: 'jaime' })), ['main', 'jaime', 'alternatives'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3 · SQL ↔ TypeScript parity (requirement 18)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the migration's own truth table from its postcondition block. Parsing
 * the real migration — not a copy — is what makes this a parity check rather
 * than a restatement.
 */
function parseMigrationTruthTable(): {
  isApproved: boolean | null
  isAdministrator: boolean | null
  principal: string | null
  expected: string[]
}[] {
  const block = /select \* from \(values([\s\S]*?)\) as t\(is_approved, is_admin, principal, expected\)/.exec(SQL)
  assert.ok(block, 'the migration must embed a truth-table VALUES list')
  const rows: {
    isApproved: boolean | null
    isAdministrator: boolean | null
    principal: string | null
    expected: string[]
  }[] = []

  const lit = (t: string): boolean | null => (t === 'true' ? true : t === 'false' ? false : null)

  for (const m of block[1].matchAll(
    /\(\s*(true|false|null)\s*,\s*(true|false|null)\s*,\s*(null|'[^']*')\s*,\s*(array\[[^\]]*\](?:::text\[\])?)\s*\)/g,
  )) {
    const scopes = [...m[4].matchAll(/'([^']+)'/g)].map((s) => s[1])
    rows.push({
      isApproved: lit(m[1]),
      isAdministrator: lit(m[2]),
      principal: m[3] === 'null' ? null : m[3].slice(1, -1),
      expected: scopes,
    })
  }
  return rows
}

describe('SQL and TypeScript authorization parity', () => {
  test('every TypeScript truth-table row produces its expected scope set', () => {
    for (const c of ENTITLEMENT_TRUTH_TABLE) {
      const got = scopesFor({
        isApproved: c.isApproved as boolean,
        isAdministrator: c.isAdministrator as boolean,
        principal: c.principal,
      })
      assert.deepEqual(got, [...c.expected], `TypeScript case: ${c.name}`)
    }
  })

  test('the migration embeds the same truth table, row for row', () => {
    const sqlRows = parseMigrationTruthTable()
    assert.equal(
      sqlRows.length,
      ENTITLEMENT_TRUTH_TABLE.length,
      `migration has ${sqlRows.length} truth-table rows, TypeScript has ${ENTITLEMENT_TRUTH_TABLE.length}`,
    )
    ENTITLEMENT_TRUTH_TABLE.forEach((ts, i) => {
      const sql = sqlRows[i]
      assert.equal(sql.isApproved, ts.isApproved, `row ${i} (${ts.name}): is_approved`)
      assert.equal(sql.isAdministrator, ts.isAdministrator, `row ${i} (${ts.name}): is_admin`)
      assert.equal(sql.principal, ts.principal, `row ${i} (${ts.name}): principal`)
      assert.deepEqual(sql.expected, [...ts.expected], `row ${i} (${ts.name}): expected scopes`)
    })
  })

  test('the truth table covers every required authorization case', () => {
    const names = ENTITLEMENT_TRUTH_TABLE.map((c) => c.name).join(' | ')
    for (const required of [
      'administrator, null principal',
      'administrator, jaime principal',
      'administrator, andres principal',
      'administrator, pablo principal',
      'jaime principal',
      'andres principal',
      'pablo principal',
      'approved non-administrator, null principal',
      'unknown principal value',
      'unapproved user',
      'revoked administrator',
    ]) {
      assert.ok(names.includes(required), `truth table is missing a case for: ${required}`)
    }
  })

  test('the migration executes the truth table in-database and raises on mismatch', () => {
    assert.match(SQL, /got\s*:=\s*public\.nmi_portfolio_scopes\(/)
    assert.match(SQL, /if got is distinct from c\.expected then/)
    assert.match(SQL, /raise exception[\s\S]{0,200}nmi_portfolio_scopes/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Migration structure and database security (requirements 7, 12–14, 17)
// ─────────────────────────────────────────────────────────────────────────────

describe('migration file conventions', () => {
  test('it sorts after every migration that preceded it', () => {
    // Written when R13.1 was the newest migration; R13.2 legitimately adds a
    // newer one. Asserting "nothing before it sorts after it" over a SORTED
    // list would be tautological and would catch nothing, so this asserts the
    // properties that can actually be violated:
    //   - every filename follows the timestamp convention;
    //   - no two migrations share a timestamp (the real forward-only hazard —
    //     two stages colliding on one prefix makes apply order undefined);
    //   - the R13 migrations sort in their documented stage order.
    const all = readdirSync(join(ROOT, MIGRATION_DIR)).filter((f) => f.endsWith('.sql')).sort()
    assert.ok(all.includes(MIGRATION_NAME), 'the R13.1 migration must exist')

    for (const f of all) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/)

    const stamps = all.map((f) => f.slice(0, 14))
    assert.equal(new Set(stamps).size, stamps.length,
      `two migrations share a timestamp prefix: ${stamps.join(', ')}`)

    // Each R13 stage must sort strictly after the stage it builds on.
    const r13 = all.filter((f) => f.includes('family_portfolio'))
    for (let i = 1; i < r13.length; i++) {
      assert.ok(r13[i] > r13[i - 1], `${r13[i]} must sort after ${r13[i - 1]}`)
    }
    assert.equal(r13[0], MIGRATION_NAME, 'R13.1 must remain the first Family Portfolio migration')
  })

  test('it is schema-qualified and idempotent', () => {
    assert.match(SQL, /add column if not exists portfolio_principal/)
    assert.match(SQL, /create table if not exists public\.family_portfolio_access_audit/)
    assert.match(SQL, /create or replace function public\.nmi_portfolio_scopes/)
    // No unqualified public DDL on the tables it touches.
    assert.doesNotMatch(SQL, /alter table user_profiles\b/)
  })

  test('it creates no financial, upload, snapshot or storage object', () => {
    for (const forbidden of [
      /storage\.buckets/i,
      /storage\.objects/i,
      /create\s+bucket/i,
      /portfolio_snapshot/i,
      /portfolio_source_uploads/i,
      /alternatives_holdings/i,
      /alternatives_events/i,
      /portfolio_publications/i,
    ]) {
      assert.doesNotMatch(SQL, forbidden, `R13.1 must not create ${forbidden}`)
    }
  })

  test('it inserts, updates and deletes no row', () => {
    assert.doesNotMatch(SQL, /\binsert\s+into\b/i)
    assert.doesNotMatch(SQL, /\bupdate\s+public\.user_profiles\b/i)
    assert.doesNotMatch(SQL, /\bdelete\s+from\b/i)
  })
})

describe('portfolio_principal persistence', () => {
  test('the column is nullable with a CHECK admitting exactly the three principals', () => {
    assert.match(SQL, /portfolio_principal is null or portfolio_principal in \('jaime', 'andres', 'pablo'\)/)
  })

  test('the CHECK does not admit "administrator"', () => {
    const check = /user_profiles_portfolio_principal_check[\s\S]*?check \(([\s\S]*?)\);/.exec(SQL)
    assert.ok(check, 'principal CHECK constraint must exist')
    assert.doesNotMatch(check[1], /administrator/)
  })

  test('a postcondition asserts the column stayed nullable — a principal is not mandatory', () => {
    assert.match(SQL, /must remain nullable/)
  })

  test('the role column is constrained to exactly user and administrator', () => {
    assert.match(SQL, /check \(role in \('user', 'administrator'\)\)/)
    // The TypeScript role set and the database CHECK must not drift apart.
    const check = /check \(role in \(([^)]*)\)\)/.exec(SQL)![1]
    const sqlRoles = [...check.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    assert.deepEqual(sqlRoles, [...APPLICATION_ROLES].sort())
  })

  test('it refuses to normalize an unexpected role value, failing loudly instead', () => {
    assert.match(SQL, /role is null or role not in \('user', 'administrator'\)/)
    assert.match(SQL, /will not guess a normalization/)
  })
})

describe('authorization functions', () => {
  test('the canonical rule is pure and immutable so it can be asserted directly', () => {
    const fn = /create or replace function public\.nmi_portfolio_scopes[\s\S]*?\$\$;/.exec(SQL)
    assert.ok(fn)
    assert.match(fn[0], /\bimmutable\b/)
    assert.doesNotMatch(fn[0], /security definer/)
  })

  test('every SECURITY DEFINER function pins search_path', () => {
    const definers = [...SQL.matchAll(/create or replace function (public\.nmi_\w+)\([^)]*\)[\s\S]*?\$\$;/g)]
      .filter((m) => /security definer/.test(m[0]))
    assert.ok(definers.length >= 3, 'expected the identity-resolving helpers to be SECURITY DEFINER')
    for (const d of definers) {
      assert.match(d[0], /set search_path = ''/, `${d[1]} does not pin search_path`)
    }
    // ...and a postcondition proves it in-database too.
    assert.match(SQL, /does not pin search_path/)
  })

  test('identity-resolving helpers take no client-supplied role or principal', () => {
    assert.match(SQL, /create or replace function public\.nmi_current_portfolio_scopes\(\)/)
    assert.match(SQL, /create or replace function public\.nmi_is_administrator\(\)/)
    assert.match(SQL, /where p\.id = \(select auth\.uid\(\)\)/)
  })

  test('administrator status derives from the role column only', () => {
    const fn = /create or replace function public\.nmi_is_administrator[\s\S]*?\$\$;/.exec(SQL)
    assert.ok(fn)
    assert.match(fn[0], /p\.role = 'administrator'/)
    assert.doesNotMatch(fn[0], /portfolio_principal/)
    assert.doesNotMatch(fn[0], /email|user_metadata|raw_app_meta_data/)
  })

  test('a revoked account loses administrator status immediately', () => {
    const fn = /create or replace function public\.nmi_is_administrator[\s\S]*?\$\$;/.exec(SQL)
    assert.match(fn![0], /username/)
  })

  test('anon cannot execute the helpers', () => {
    assert.match(SQL, /revoke all on function public\.nmi_current_portfolio_scopes\(\)\s+from public, anon/)
    assert.match(SQL, /revoke all on function public\.nmi_is_administrator\(\)\s+from public, anon/)
    assert.match(SQL, /grant execute on function public\.nmi_can_access_scope\(text\)\s+to authenticated, service_role/)
  })

  test('a reusable RLS predicate exists for later R13 tables', () => {
    assert.match(SQL, /create or replace function public\.nmi_can_access_scope\(requested_scope text\)/)
    assert.match(SQL, /requested_scope = any \(public\.nmi_current_portfolio_scopes\(\)\)/)
    assert.match(SQL, /requested_scope is not null/)
  })

  test('no placeholder financial table was created to attach a policy to', () => {
    const creates = [...SQL.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1])
    assert.deepEqual(creates, ['family_portfolio_access_audit'])
  })
})

describe('access-change audit table', () => {
  test('it records the required fields and nothing sensitive', () => {
    for (const col of ['target_user_id', 'actor_user_id', 'field_changed', 'previous_value', 'new_value', 'changed_at']) {
      assert.match(SQL, new RegExp(`\\b${col}\\b`), `audit table is missing ${col}`)
    }
    for (const forbidden of [/password/i, /session_token/i, /service_role_key/i, /secret/i, /workbook/i]) {
      const table = /create table if not exists public\.family_portfolio_access_audit\s*\([\s\S]*?\n\);/.exec(SQL)
      assert.ok(table, 'the audit table definition must be parseable')
      assert.doesNotMatch(table[0], forbidden)
    }
  })

  test('non-administrators cannot alter audit records — no write policy exists at all', () => {
    const policies = [...SQL.matchAll(/create policy "([^"]+)"\s+on public\.family_portfolio_access_audit\s+for (\w+)/g)]
    assert.deepEqual(policies.map((p) => p[2]), ['select'])
    assert.match(SQL, /revoke all privileges on table public\.family_portfolio_access_audit from public, anon, authenticated/)
    assert.match(SQL, /grant all privileges on table public\.family_portfolio_access_audit to service_role/)
  })

  test('only administrators may read the trail', () => {
    assert.match(SQL, /for select\s+to authenticated\s+using \(public\.nmi_is_administrator\(\)\)/)
  })

  test('postconditions assert anon and authenticated hold no write privilege', () => {
    assert.match(SQL, /has_table_privilege\('authenticated', 'public\.family_portfolio_access_audit', priv\)/)
    assert.match(SQL, /has_table_privilege\('anon', 'public\.family_portfolio_access_audit', priv\)/)
  })
})

describe('the R1.5 user_profiles posture is preserved', () => {
  test('the migration adds no write policy or write grant on user_profiles', () => {
    assert.doesNotMatch(SQL, /create policy[\s\S]{0,120}on public\.user_profiles/)
    assert.doesNotMatch(SQL, /grant (insert|update|delete)[^;]*on table public\.user_profiles/i)
  })

  test('a postcondition proves authenticated cannot write role or principal', () => {
    assert.match(SQL, /authenticated regained EFFECTIVE % on user_profiles/)
    assert.match(SQL, /has_column_privilege\('authenticated', 'public\.user_profiles', 'role', priv\)/)
    assert.match(SQL, /has_column_privilege\('authenticated', 'public\.user_profiles', 'portfolio_principal', priv\)/)
  })

  test('authenticated keeps SELECT, which the approval lookup depends on', () => {
    assert.match(SQL, /authenticated lost SELECT on user_profiles/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Administrator assignment guards (requirements 12–15)
// ─────────────────────────────────────────────────────────────────────────────

describe('administrator-controlled assignment', () => {
  const ADMIN = { userId: 'admin-1', isApproved: true, isAdministrator: true }
  const base = {
    actor: ADMIN,
    targetUserId: 'target-1',
    targetExists: true,
    currentPrincipal: null as unknown,
    requestedPrincipal: 'jaime' as unknown,
  }

  test('an administrator can assign a principal', () => {
    const d = decidePrincipalAssignment(base)
    assert.equal(d.allowed, true)
    assert.deepEqual(d, {
      allowed: true, targetUserId: 'target-1', previousValue: null, newValue: 'jaime', changed: true,
    })
  })

  test('an administrator can change a principal', () => {
    const d = decidePrincipalAssignment({ ...base, currentPrincipal: 'jaime', requestedPrincipal: 'pablo' })
    assert.equal(d.allowed && d.previousValue, 'jaime')
    assert.equal(d.allowed && d.newValue, 'pablo')
    assert.equal(d.allowed && d.changed, true)
  })

  test('an administrator can clear a principal', () => {
    const d = decidePrincipalAssignment({ ...base, currentPrincipal: 'andres', requestedPrincipal: null })
    assert.equal(d.allowed && d.newValue, null)
    assert.equal(d.allowed && d.changed, true)
  })

  test('a no-op assignment is allowed but reports no change', () => {
    const d = decidePrincipalAssignment({ ...base, currentPrincipal: 'jaime', requestedPrincipal: 'jaime' })
    assert.equal(d.allowed && d.changed, false)
    assert.equal(buildAccessAuditEntry(d, ADMIN.userId), null, 'a no-op must write no audit row')
  })

  test('a non-administrator cannot assign or clear a principal', () => {
    for (const requested of ['jaime', null]) {
      const d = decidePrincipalAssignment({
        ...base,
        actor: { userId: 'user-9', isApproved: true, isAdministrator: false },
        requestedPrincipal: requested,
      })
      assert.deepEqual(d, { allowed: false, code: 'actor_not_administrator' })
    }
  })

  test('an unapproved or unknown actor cannot assign', () => {
    assert.deepEqual(
      decidePrincipalAssignment({ ...base, actor: { userId: 'a', isApproved: false, isAdministrator: true } }),
      { allowed: false, code: 'actor_not_approved' },
    )
    for (const id of [null, undefined, '', '   ']) {
      assert.deepEqual(
        decidePrincipalAssignment({ ...base, actor: { userId: id, isApproved: true, isAdministrator: true } }),
        { allowed: false, code: 'actor_unknown' },
      )
    }
  })

  test('a user cannot alter their own principal — self-assignment is refused', () => {
    const d = decidePrincipalAssignment({ ...base, targetUserId: ADMIN.userId })
    assert.deepEqual(d, { allowed: false, code: 'self_assignment_forbidden' })
  })

  test('self-assignment is refused even when clearing', () => {
    assert.deepEqual(
      decidePrincipalAssignment({ ...base, targetUserId: ADMIN.userId, requestedPrincipal: null }),
      { allowed: false, code: 'self_assignment_forbidden' },
    )
  })

  test('an invalid principal is rejected, including "administrator"', () => {
    for (const p of ['administrator', 'ADMIN', 'nope', '', 'jaime;--', 42, {}]) {
      assert.deepEqual(
        decidePrincipalAssignment({ ...base, requestedPrincipal: p }),
        { allowed: false, code: 'invalid_principal' },
        `accepted principal ${JSON.stringify(p)}`,
      )
    }
  })

  test('a missing target is refused', () => {
    assert.deepEqual(
      decidePrincipalAssignment({ ...base, targetExists: false }),
      { allowed: false, code: 'target_not_found' },
    )
    for (const t of [null, undefined, '', 7]) {
      assert.deepEqual(
        decidePrincipalAssignment({ ...base, targetUserId: t }),
        { allowed: false, code: 'invalid_target' },
      )
    }
  })

  test('the actor is authorized before the request is examined', () => {
    // A non-administrator gets an actor-level denial, never target_not_found —
    // an unauthorized caller must learn nothing about the target.
    const d = decidePrincipalAssignment({
      ...base,
      actor: { userId: 'user-9', isApproved: true, isAdministrator: false },
      targetExists: false,
      requestedPrincipal: 'bogus',
    })
    assert.deepEqual(d, { allowed: false, code: 'actor_not_administrator' })
  })

  test('an applied change produces a complete audit entry', () => {
    const d = decidePrincipalAssignment({ ...base, currentPrincipal: 'jaime', requestedPrincipal: 'andres' })
    assert.deepEqual(buildAccessAuditEntry(d, ADMIN.userId), {
      target_user_id: 'target-1',
      actor_user_id: ADMIN.userId,
      field_changed: 'portfolio_principal',
      previous_value: 'jaime',
      new_value: 'andres',
    })
  })

  test('a denied change never produces an audit entry', () => {
    const denials = [
      { ...base, actor: { userId: 'u', isApproved: true, isAdministrator: false } },
      { ...base, targetUserId: ADMIN.userId },
      { ...base, requestedPrincipal: 'administrator' },
      { ...base, targetExists: false },
    ]
    for (const req of denials) {
      const d = decidePrincipalAssignment(req)
      assert.equal(d.allowed, false)
      assert.equal(buildAccessAuditEntry(d, ADMIN.userId), null, 'a denial must not be auditable as a success')
    }
  })

  test('the audit entry can only ever describe portfolio_principal', () => {
    const d = decidePrincipalAssignment(base)
    assert.equal(buildAccessAuditEntry(d, ADMIN.userId)!.field_changed, 'portfolio_principal')
  })

  test('a malformed stored principal is normalized rather than trusted', () => {
    assert.equal(normalizeStoredPrincipal('administrator'), null)
    assert.equal(normalizeStoredPrincipal('JAIME'), null)
    assert.equal(normalizeStoredPrincipal('pablo'), 'pablo')
  })
})

describe('the assignment executor is a CLI, never HTTP-reachable', () => {
  const CLI_PATH = 'scripts/admin/assignPortfolioPrincipal.ts'
  const CLI = read(CLI_PATH)
  const CODE = codeOf(CLI)

  test('it lives outside src/app, like the existing provisioning script', () => {
    assert.ok(existsSync(join(ROOT, CLI_PATH)))
    assert.ok(existsSync(join(ROOT, 'scripts/admin/provisionUser.ts')), 'it extends the existing admin workflow')
    assert.equal(existsSync(join(ROOT, 'src/lib/portfolioAccess/assignPrincipal.ts')), false,
      'assignment must not live under src/ — no src file may write user_profiles')
  })

  test('no file under src/ writes user_profiles — the standing invariant is intact', () => {
    // Mirrors tests/accessControl.test.ts § D. Restated here so an R13 change
    // that reintroduces a src-side write fails in this suite too.
    const stack: string[] = [join(ROOT, 'src')]
    const offenders: string[] = []
    while (stack.length) {
      const dir = stack.pop()!
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else if (/\.tsx?$/.test(entry.name)) {
          const src = readFileSync(full, 'utf8')
          if (/from\(['"]user_profiles['"]\)/.test(src) && /\.(insert|upsert|update)\(/.test(src)) {
            offenders.push(full)
          }
        }
      }
    }
    assert.deepEqual(offenders, [])
  })

  test('it writes only portfolio_principal — role is unreachable, so nobody can be elevated', () => {
    const updates = [...CODE.matchAll(/\.update\(\{([^}]*)\}\)/g)].map((m) => m[1].trim())
    assert.deepEqual(updates, ['portfolio_principal: decision.newValue'])
    assert.doesNotMatch(CODE, /field_changed:\s*'role'/)
    assert.doesNotMatch(CODE, /update\([^)]*\brole\b/)
  })

  test('it requires a named administrator actor so the audit trail is meaningful', () => {
    assert.match(CODE, /--actor <admin-username> is required/)
    assert.match(CODE, /isAdministrator: actorRow\?\.role === 'administrator'/)
  })

  test('dry-run is the default; --write is an explicit opt-in', () => {
    assert.match(CODE, /if \(!args\.write\)/)
    assert.match(CODE, /Re-run with --write to apply/)
  })

  test('it applies the pure decision rules rather than re-implementing them', () => {
    assert.match(CODE, /decidePrincipalAssignment\(/)
    assert.match(CODE, /buildAccessAuditEntry\(/)
  })

  test('a failed audit write is reported as a failure, never as a clean success', () => {
    assert.match(CODE, /audit row FAILED to write/)
  })

  test('it never logs a secret, key, URL or email', () => {
    assert.doesNotMatch(CODE, /console\.log\([^)]*(?:SERVICE_ROLE|apiKey|password|email)/i)
    assert.doesNotMatch(CODE, /process\.env\.[A-Z_]*KEY/)
  })
})

describe('entitlement resolution reads the database, never client input', () => {
  const SRC = read('src/lib/portfolioAccess/getEntitlement.ts')
  const CODE = codeOf(SRC)

  test('it uses the user-session client, not the service-role client', () => {
    assert.match(CODE, /getSupabaseUserClient/)
    assert.doesNotMatch(CODE, /getSupabaseAdminClient/)
  })

  test('it reads the three inputs from the caller own row', () => {
    assert.match(CODE, /\.select\('username, role, portfolio_principal'\)/)
    assert.match(CODE, /\.eq\('id', user\.id\)/)
  })

  test('it never reads an authorization claim from session metadata', () => {
    assert.doesNotMatch(CODE, /user_metadata|app_metadata|raw_app_meta_data/)
  })

  test('every failure path is fail-closed', () => {
    assert.match(SRC, /if \(!user\) return DENIED/)
    assert.match(SRC, /if \(!client\) return DENIED/)
    assert.match(SRC, /if \(error \|\| !data\) return \{ \.\.\.DENIED/)
    assert.match(SRC, /scopes: \[\]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6 · entitlementFromProfile + approval agreement (requirement 19)
// ─────────────────────────────────────────────────────────────────────────────

describe('profile mapping', () => {
  test('approval agrees exactly with the platform approval predicate', () => {
    const rows = [
      { username: 'hector', role: 'user', portfolio_principal: null },
      { username: '   ', role: 'user', portfolio_principal: null },
      { username: '', role: 'user', portfolio_principal: null },
      { username: null, role: 'administrator', portfolio_principal: null },
      { username: ' jaime ', role: 'user', portfolio_principal: 'jaime' },
    ]
    for (const r of rows) {
      assert.equal(
        entitlementFromProfile(r).isApproved,
        isApprovedProfile(r),
        `approval disagreed for username ${JSON.stringify(r.username)}`,
      )
    }
  })

  test('a null or missing profile is fully denied', () => {
    for (const p of [null, undefined]) {
      const e = entitlementFromProfile(p)
      assert.deepEqual(e, { isApproved: false, isAdministrator: false, principal: null })
      assert.deepEqual(scopesFor(e), [])
    }
  })

  test('only the exact role string "administrator" confers administration', () => {
    for (const role of ['Administrator', 'ADMIN', 'admin', 'superuser', '', null, undefined]) {
      const e = entitlementFromProfile({ username: 'u', role: role as string, portfolio_principal: null })
      assert.equal(e.isAdministrator, false, `role ${String(role)} was treated as administrator`)
      assert.equal(canAdminister(e), false)
    }
    assert.equal(entitlementFromProfile({ username: 'u', role: 'administrator' }).isAdministrator, true)
  })

  test('a malformed stored principal is normalized to null, not trusted', () => {
    for (const p of ['administrator', 'JAIME', 'nope', '']) {
      assert.equal(entitlementFromProfile({ username: 'u', role: 'user', portfolio_principal: p }).principal, null)
    }
  })

  test('canAdminister requires approval as well as the role', () => {
    assert.equal(canAdminister({ isApproved: false, isAdministrator: true, principal: null }), false)
    assert.equal(canAdminister({ isApproved: true, isAdministrator: true, principal: null }), true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7 · database.types.ts reconciliation (requirement 22)
// ─────────────────────────────────────────────────────────────────────────────

describe('database.types.ts matches verified migration authority', () => {
  const TYPES = read('src/lib/supabase/database.types.ts')
  const profileBlock = /user_profiles: \{[\s\S]*?\n      \}/.exec(TYPES)![0]
  const allMigrations = readdirSync(join(ROOT, MIGRATION_DIR))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read(`${MIGRATION_DIR}/${f}`))
    .join('\n')

  test('role and preferences are present — both created by 20260701000000', () => {
    assert.match(allMigrations, /role\s+text not null default 'user'/)
    assert.match(allMigrations, /preferences\s+jsonb not null default '\{\}'/)
    assert.match(profileBlock, /\brole: string\b/)
    assert.match(profileBlock, /\bpreferences: Json\b/)
  })

  test('avatar_url is absent — no migration in the chain creates it', () => {
    assert.doesNotMatch(allMigrations, /avatar_url/, 'a migration now creates avatar_url; restore it to the types')
    // Declarations only: the reconciliation note in database.types.ts names the
    // removed column in prose, and prose must not satisfy or fail a code check.
    assert.doesNotMatch(profileBlock, /^\s*avatar_url\??:/m, 'avatar_url is still declared on user_profiles')
    const declarations = [...TYPES.matchAll(/^\s*avatar_url\??:/gm)]
    assert.equal(declarations.length, 0, 'avatar_url is still declared somewhere in the generated types')
  })

  test('portfolio_principal is declared and matches this migration', () => {
    assert.match(profileBlock, /portfolio_principal: string \| null/)
    assert.match(SQL, /add column if not exists portfolio_principal text/)
  })

  test('the authorization columns are not writable through the generated Insert/Update types', () => {
    const insertUpdate = /Insert: \{[\s\S]*?\}\s*Update: \{[\s\S]*?\}/.exec(profileBlock)![0]
    assert.doesNotMatch(insertUpdate, /\brole\?/)
    assert.doesNotMatch(insertUpdate, /portfolio_principal\?/)
  })

  test('the audit table is declared', () => {
    assert.match(TYPES, /family_portfolio_access_audit: \{/)
    assert.match(TYPES, /export type FamilyPortfolioAccessAuditRow/)
  })

  test('every declared user_profiles column has migration authority', () => {
    const declared = [...profileBlock.matchAll(/^\s{10}(\w+):/gm)].map((m) => m[1])
    const authorized = ['id', 'username', 'email', 'display_name', 'role', 'preferences', 'portfolio_principal', 'created_at', 'updated_at']
    for (const col of declared) {
      assert.ok(authorized.includes(col), `${col} has no migration authority`)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8 · Regression: nothing existing was changed (requirements 19–21)
// ─────────────────────────────────────────────────────────────────────────────

describe('existing behaviour is unchanged', () => {
  test('the approval predicate still governs platform access', () => {
    assert.equal(isApprovedProfile({ username: 'hector' }), true)
    assert.equal(isApprovedProfile({ username: '  ' }), false)
    assert.equal(isApprovedProfile(null), false)
  })

  test('default-deny routing is untouched and still protects /portfolio', () => {
    assert.equal(requiresApprovedSession('/portfolio'), true)
    assert.equal(classifyPath('/portfolio'), 'private_page')
    assert.equal(classifyPath('/api/portfolios'), 'private_api')
    assert.equal(classifyPath('/login'), 'public_page')
    assert.equal(classifyPath('/api/auth/login'), 'public_api')
  })

  test('future family-portfolio routes are private by default with no allowlist entry', () => {
    for (const p of [
      '/family-portfolio',
      '/family-portfolio/portfolio',
      '/family-portfolio/weekly-changes',
      '/family-portfolio/alternatives',
      '/family-portfolio/admin',
    ]) {
      assert.equal(classifyPath(p), 'private_page', `${p} must be private`)
    }
    assert.equal(classifyPath('/api/family-portfolio/scopes'), 'private_api')
    const POLICY = read('src/lib/auth/accessPolicy.ts')
    assert.doesNotMatch(POLICY, /family-portfolio/, 'family-portfolio must never appear on an allowlist')
  })

  test('the existing Chilean-equities /portfolio module was not modified by R13.1', () => {
    for (const f of [
      'src/app/portfolio/page.tsx',
      'src/lib/portfolio/valuation.ts',
      'src/lib/portfolio/transactions.ts',
      'src/lib/db/repositories/portfolioRepository.ts',
    ]) {
      assert.ok(existsSync(join(ROOT, f)), `${f} must still exist`)
      assert.doesNotMatch(read(f), /portfolioAccess|portfolio_principal|nmi_portfolio_scopes/,
        `${f} must not depend on R13.1 entitlements`)
    }
  })

  test('no Family Portfolio page or client-facing route exists yet', () => {
    // R13.1 added no route at all. R13.2 adds the administrator upload API and
    // NOTHING else — no page, no UI, and none of the client-facing scope
    // endpoints (doc 05 § 7.4), which belong to Stages 5-9. Narrowed rather than
    // deleted, so premature scope still fails here.
    assert.equal(existsSync(join(ROOT, 'src/app/family-portfolio')), false,
      'no Family Portfolio page may exist before Stage 6')

    const apiRoot = join(ROOT, 'src/app/api/family-portfolio')
    if (!existsSync(apiRoot)) return

    const routes: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name === 'route.ts') routes.push(full.replace(apiRoot, '').replace(/\\/g, '/'))
      }
    }
    walk(apiRoot)

    // Every route present must live under the administrator upload surface.
    for (const r of routes) {
      assert.match(r, /^\/admin\/uploads(\/\[id\])?\/route\.ts$/,
        `unexpected Family Portfolio route for this stage: ${r}`)
    }
    for (const forbidden of ['/scopes', '/snapshot', '/weekly-changes', '/overview', '/alternatives']) {
      assert.ok(!routes.some((r) => r.includes(forbidden)),
        `${forbidden} is a later-stage route and must not exist yet`)
    }
  })

  test('username + password authentication is untouched', () => {
    const login = read('src/app/api/auth/login/route.ts')
    assert.doesNotMatch(login, /portfolio_principal|portfolioAccess|nmi_/)
  })

  test('middleware still gates on approval alone and was not given a role dependency', () => {
    const mw = read('src/middleware.ts')
    assert.match(mw, /\.select\('id, username'\)/)
    assert.doesNotMatch(mw, /portfolio_principal|nmi_is_administrator/)
  })
})
