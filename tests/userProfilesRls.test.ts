// R1.5 — `public.user_profiles` approval integrity.
//
// WHAT RUNS HERE, AND WHAT DOES NOT.
//
// There is no local Supabase instance in this environment (the Supabase CLI is
// blocked by Windows security policy on this machine — see CLAUDE.md Phase 5B.1)
// and no service-role key is present, so RLS and privilege behaviour CANNOT be
// executed against a real database from this suite. Claiming otherwise would be
// false.
//
// So the coverage is split, honestly:
//   · STRUCTURAL — the migration is parsed and its policy reset, privileges,
//     schema qualification, postconditions and data-safety properties are
//     asserted.
//   · BEHAVIOURAL — the approval predicate and the per-request access decision
//     that consume this table are executed for real (see also
//     tests/accessControl.test.ts), so the application half of the boundary is
//     genuinely exercised.
//   · IN-DATABASE — the migration carries its OWN postcondition block that
//     raises an exception unless the final policy, table privileges and
//     column privileges are exactly as intended. That is the real proof of
//     items 3–12 below, and it executes when the migration is pushed. The tests
//     here assert those checks exist and are correct; they cannot run them.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isApprovedProfile } from '../src/lib/auth/approval.ts'
import {
  decideRequestAccess,
  type IdentityVerifier,
} from '../src/lib/auth/requestAccess.ts'
import type { AuthorizationStateLookup } from '../src/lib/auth/authorizationState.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const MIGRATION_DIR = 'supabase/migrations'
const MIGRATION_NAME = '20260730000000_user_profiles_admin_controlled_approval.sql'
const MIGRATION = read(`${MIGRATION_DIR}/${MIGRATION_NAME}`)
const PHASE_6A = read(`${MIGRATION_DIR}/20260701000000_auth_watchlist_foundation.sql`)
const DOC = read('docs/security_access_control.md')

/** SQL with `--` comments stripped, so prose never satisfies a code assertion. */
const SQL = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe('migration file conventions', () => {
  test('it sorts after every migration that preceded it and follows the naming convention', () => {
    // Written when this was the newest migration. Later phases legitimately add
    // newer ones (R7.1B.1 added 20260803000000_structured_notes_custodian.sql),
    // so the invariant that actually matters is forward-only ordering: nothing
    // that existed before it may sort after it. Every migration must also
    // follow the timestamp naming convention.
    const files = readdirSync(join(ROOT, MIGRATION_DIR)).filter((f) => f.endsWith('.sql')).sort()
    const idx = files.indexOf(MIGRATION_NAME)
    assert.ok(idx > -1, 'the migration must exist')
    for (const f of files.slice(0, idx)) {
      assert.ok(f < MIGRATION_NAME, `${f} must sort before ${MIGRATION_NAME}`)
    }
    for (const f of files) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/)
  })

  test('it is declared forward-only and re-runnable, not a SQL-Editor paste', () => {
    assert.match(MIGRATION, /Forward-only\. Re-runnable\./)
    // The repository manages database changes through supabase/migrations + the
    // CLI. This migration must not instruct anyone to paste it into the remote
    // SQL Editor (the convention older migrations used).
    assert.doesNotMatch(MIGRATION, /Apply via Supabase Dashboard/i)
    assert.match(MIGRATION, /NOT by pasting SQL into the remote SQL Editor/)
    assert.match(MIGRATION, /supabase db push --dry-run/)
  })

  test('it fails clearly if the expected table is absent', () => {
    assert.match(SQL, /raise exception/i)
    assert.match(MIGRATION, /public\.user_profiles not found/)
  })
})

// ── Blocker 3 · schema qualification ─────────────────────────────────────────

describe('every statement is schema-qualified — no reliance on search_path', () => {
  test('no bare `user_profiles` reference survives in executable SQL', () => {
    // Allow the catalog filters (`c.relname = 'user_profiles'`, `tablename =
    // 'user_profiles'`) which are string literals, not table references.
    const withoutLiterals = SQL.replace(/'user_profiles'/g, "'<literal>'")
    const bare = [...withoutLiterals.matchAll(/(^|[^.\w])user_profiles/g)]
    assert.equal(bare.length, 0, `found ${bare.length} unqualified reference(s) to user_profiles`)
  })

  test('table, policy, grant, revoke, alter and comment statements all name public.user_profiles', () => {
    for (const stmt of [
      /alter table public\.user_profiles enable row level security/,
      /create policy "users_own_profile_select" on public\.user_profiles/,
      /revoke all privileges on table public\.user_profiles/,
      /grant select on table public\.user_profiles/,
      /grant all privileges on table public\.user_profiles/,
      /comment on table public\.user_profiles is/,
      /comment on column public\.user_profiles\.username is/,
    ]) {
      assert.match(SQL, stmt, `missing schema-qualified statement: ${stmt}`)
    }
  })

  test('dynamic statements are schema-qualified too', () => {
    assert.match(SQL, /drop policy %I on public\.user_profiles/)
    assert.match(SQL, /revoke all privileges \(%I\) on table public\.user_profiles/)
  })

  test('catalog lookups are schema-scoped', () => {
    assert.doesNotMatch(SQL, /from pg_policies\b/, 'use pg_catalog.pg_policies')
    const policyQueries = [...SQL.matchAll(/pg_catalog\.pg_policies[\s\S]{0,160}/g)].map((m) => m[0])
    assert.ok(policyQueries.length >= 2)
    for (const q of policyQueries) {
      assert.match(q, /schemaname = 'public'/, 'every pg_policies read must filter on schema')
    }
  })
})

// ── Blocker 2 · complete policy reset ────────────────────────────────────────

describe('policy reset removes EVERY pre-existing policy, not a guessed list', () => {
  test('policies are enumerated from the catalog and dropped dynamically', () => {
    assert.match(SQL, /for pol in\s+select policyname\s+from pg_catalog\.pg_policies/)
    assert.match(SQL, /execute format\('drop policy %I on public\.user_profiles', pol\.policyname\)/)
  })

  test('identifiers are quoted with %I, so an odd policy name cannot break or inject', () => {
    const dynamicDrops = [...SQL.matchAll(/execute format\('drop policy[^']*'/g)].map((m) => m[0])
    assert.ok(dynamicDrops.length >= 1)
    for (const d of dynamicDrops) assert.match(d, /%I/, 'identifier must be %I-quoted')
    assert.doesNotMatch(SQL, /drop policy '\s*\|\|/, 'no string concatenation of identifiers')
  })

  test('it does NOT rely on a finite list of guessed policy names', () => {
    // The Phase 6A names must not be hard-coded as the removal mechanism.
    assert.doesNotMatch(SQL, /drop policy if exists "users_own_profile_(insert|update|delete)"/)
  })

  test('the Phase 6A policies it supersedes really existed (the finding is real)', () => {
    for (const name of ['users_own_profile_select', 'users_own_profile_insert', 'users_own_profile_update']) {
      assert.match(PHASE_6A, new RegExp(`create policy "${name}" on user_profiles`), `${name} must exist in Phase 6A`)
    }
  })

  test('exactly one policy is created, and it is the SELECT policy', () => {
    const created = [...SQL.matchAll(/create policy "([^"]+)" on public\.user_profiles\s+for (\w+)/g)]
      .map((m) => ({ name: m[1], op: m[2].toLowerCase() }))
    assert.deepEqual(created, [{ name: 'users_own_profile_select', op: 'select' }])
  })

  test('the created policy is authenticated-only, own-row, with no WITH CHECK', () => {
    const policy = SQL.match(/create policy "users_own_profile_select" on public\.user_profiles[\s\S]*?;/)
    assert.ok(policy)
    assert.match(policy[0], /for select/)
    assert.match(policy[0], /to authenticated/)
    assert.match(policy[0], /using \(auth\.uid\(\) = id\)/)
    assert.doesNotMatch(policy[0], /with check/)
  })

  test('no broad policy is created', () => {
    assert.doesNotMatch(SQL, /using\s*\(\s*true\s*\)/i)
    assert.doesNotMatch(SQL, /with check\s*\(\s*true\s*\)/i)
    assert.doesNotMatch(SQL, /auth\.uid\(\) is not null/, 'shared-book style access is wrong for this table')
  })

  test('RLS is (re-)enabled and never disabled', () => {
    assert.match(SQL, /alter table public\.user_profiles enable row level security/)
    assert.doesNotMatch(SQL, /disable row level security/)
  })
})

// ── Blocker 1 · fail-closed privileges ───────────────────────────────────────

describe('table privileges are established fail-closed', () => {
  test('ALL privileges are revoked from PUBLIC, anon and authenticated first', () => {
    const revoke = SQL.match(/revoke all privileges on table public\.user_profiles from ([^;]+);/)
    assert.ok(revoke, 'a blanket table revoke must exist')
    const targets = revoke[1].split(',').map((s) => s.trim())
    assert.deepEqual(targets.sort(), ['anon', 'authenticated', 'public'])
  })

  test('the blanket revoke is what covers REFERENCES and TRIGGER', () => {
    // A DML-only revoke list would silently leave REFERENCES/TRIGGER behind.
    assert.doesNotMatch(
      SQL,
      /revoke insert, update, delete, truncate on table/,
      'the partial DML revoke must be gone',
    )
    assert.match(MIGRATION, /REFERENCES,\s*\n?--\s*TRIGGER|REFERENCES,? TRIGGER/,
      'the header must record that REFERENCES/TRIGGER are covered')
  })

  test('only SELECT is granted back to authenticated', () => {
    const grants = [...SQL.matchAll(/grant ([^;]*) on table public\.user_profiles to authenticated/g)]
      .map((m) => m[1].trim())
    assert.deepEqual(grants, ['select'])
  })

  test('nothing is ever granted to anon or PUBLIC', () => {
    assert.doesNotMatch(SQL, /grant [^;]*on table public\.user_profiles to [^;]*\banon\b/)
    assert.doesNotMatch(SQL, /grant [^;]*on table public\.user_profiles to [^;]*\bpublic\b/)
  })

  test('service_role keeps full privileges for provisioning', () => {
    assert.match(SQL, /grant all privileges on table public\.user_profiles to service_role/)
  })

  test('column-level grants are revoked too — a table REVOKE does not remove them', () => {
    assert.match(SQL, /revoke all privileges \(%I\) on table public\.user_profiles from public, anon, authenticated/)
    assert.match(SQL, /pg_catalog\.pg_attribute/, 'columns are enumerated from the catalog')
    assert.match(SQL, /not att\.attisdropped/, 'dropped columns are skipped')
    assert.match(MIGRATION, /attacl/, 'and the reason is recorded')
  })
})

// ── Postconditions ───────────────────────────────────────────────────────────

describe('the migration proves its own final state', () => {
  const POST = SQL.slice(SQL.lastIndexOf('do $$', SQL.indexOf('policy_count')))

  test('it asserts exactly one policy exists', () => {
    assert.match(POST, /expected exactly 1 policy on public\.user_profiles/)
  })

  test('it asserts the policy name, command, role, predicate and absent WITH CHECK', () => {
    assert.match(POST, /pol\.policyname <> 'users_own_profile_select'/)
    assert.match(POST, /pol\.cmd <> 'SELECT'/)
    assert.match(POST, /pol\.roles is distinct from array\['authenticated'\]::name\[\]/)
    assert.match(POST, /pol\.qual !~ 'auth\\\.uid\\\(\\\)\\s\*=\\s\*id'/)
    assert.match(POST, /pol\.with_check is not null/)
  })

  test('it asserts RLS is enabled', () => {
    assert.match(POST, /relrowsecurity/)
    assert.match(POST, /row level security is not enabled/)
  })

  test('it asserts PUBLIC and anon hold no table privilege', () => {
    assert.match(POST, /PUBLIC\/anon still hold table privileges/)
    assert.match(POST, /a\.grantee = 0/, 'grantee 0 is PUBLIC')
  })

  test('it asserts authenticated holds exactly SELECT', () => {
    assert.match(POST, /authenticated privileges = %, expected exactly SELECT/)
    assert.match(POST, /bad is distinct from 'SELECT'/)
  })

  test('it asserts no column-level INSERT, UPDATE or REFERENCES survives', () => {
    assert.match(POST, /column-level grants survive/)
    assert.match(POST, /a\.privilege_type in \('INSERT', 'UPDATE', 'REFERENCES'\)/)
  })

  test('it asserts service_role can still provision', () => {
    assert.match(POST, /service_role must retain at least SELECT, INSERT and UPDATE/)
  })

  test('privilege checks use aclexplode, not information_schema, so they do not depend on the runner', () => {
    assert.match(POST, /aclexplode\(c\.relacl\)/)
    assert.match(POST, /aclexplode\(att\.attacl\)/)
    assert.doesNotMatch(POST, /information_schema/)
  })

  test('a NULL policy predicate fails the postcondition (fail-closed)', () => {
    // `null !~ pattern` evaluates to NULL, not true, so a bare regex test would
    // silently accept a policy with no USING clause.
    assert.match(POST, /pol\.qual is null or pol\.qual !~/)
    assert.match(POST, /coalesce\(pol\.qual, '\(null\)'\)/, 'and reports it legibly')
  })

  test('it asserts the sole policy is PERMISSIVE', () => {
    assert.match(POST, /pol\.permissive <> 'PERMISSIVE'/)
  })
})

// ── Effective access, ownership and role attributes ──────────────────────────

describe('the migration proves EFFECTIVE access, not only direct ACL entries', () => {
  const POST = SQL.slice(SQL.lastIndexOf('do $$', SQL.indexOf('policy_count')))

  test('it keeps the direct ACL checks as well — both layers are present', () => {
    assert.match(POST, /aclexplode\(c\.relacl\)/, 'direct table ACL')
    assert.match(POST, /aclexplode\(att\.attacl\)/, 'direct column ACL')
    assert.match(POST, /has_table_privilege\(/, 'effective table access')
    assert.match(POST, /has_any_column_privilege\(/, 'effective column access')
  })

  test('anon is proven to have NO effective table privilege of any kind', () => {
    const loop = POST.slice(POST.indexOf("has_table_privilege('anon'") - 400, POST.indexOf("has_table_privilege('anon'") + 300)
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      assert.match(loop, new RegExp(`'${priv}'`), `anon check must cover ${priv}`)
    }
    assert.match(POST, /anon has EFFECTIVE % on public\.user_profiles \(inherited or owned\)/)
  })

  test('authenticated is proven to have effective SELECT and no effective write', () => {
    assert.match(POST, /if not has_table_privilege\('authenticated', 'public\.user_profiles', 'SELECT'\)/)
    assert.match(POST, /authenticated must retain effective SELECT/)

    // The forbidden set for `authenticated` is exactly the six non-SELECT
    // privileges — SELECT is intentional and must not appear in it.
    const forbidden = POST.match(
      /foreach priv in array (array\[[^\]]*\]) loop[\s\S]{0,240}?authenticated has EFFECTIVE/,
    )
    assert.ok(forbidden, 'the authenticated write-privilege loop must exist')
    assert.equal(forbidden[1], "array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']")
    assert.match(POST, /authenticated has EFFECTIVE % on public\.user_profiles \(inherited or owned\)/)
  })

  test('effective column privileges are checked for both roles, excluding the intentional SELECT', () => {
    assert.match(POST, /foreach role_name in array array\['anon','authenticated'\]/)
    assert.match(POST, /foreach priv in array array\['INSERT','UPDATE','REFERENCES'\]/)
    assert.match(POST, /has_any_column_privilege\(role_name::name, 'public\.user_profiles', priv\)/,
      'the role must be cast to `name` so function resolution cannot fail at push time')
    assert.match(POST, /has EFFECTIVE column-level % on public\.user_profiles/)
    // A column-level SELECT ban would break the approval lookup.
    assert.doesNotMatch(POST, /has_any_column_privilege\([^)]*'SELECT'\)/)
  })

  test('neither ordinary application role owns the table', () => {
    assert.match(POST, /join pg_catalog\.pg_roles r on r\.oid = c\.relowner/)
    assert.match(POST, /if bad in \('anon', 'authenticated'\)/)
    assert.match(POST, /ownership bypasses object privileges/)
  })

  test('neither ordinary application role holds BYPASSRLS or SUPERUSER', () => {
    assert.match(POST, /rolbypassrls or rolsuper/)
    assert.match(POST, /must not hold BYPASSRLS or SUPERUSER/)
    const guarded = POST.match(/foreach role_name in array array\['anon','authenticated'\][\s\S]*?must not hold BYPASSRLS/)
    assert.ok(guarded, 'the check must cover both anon and authenticated')
  })

  test('the migration never grants BYPASSRLS to anything', () => {
    assert.doesNotMatch(SQL, /alter role/i)
    assert.doesNotMatch(SQL, /bypassrls\s*;|with bypassrls/i)
  })

  test('service_role is proven to retain its RLS-bypass capability', () => {
    assert.match(POST, /rolname = 'service_role' and \(rolbypassrls or rolsuper\)/)
    assert.match(POST, /service_role must retain BYPASSRLS/)
    assert.match(POST, /provisionUser\.ts depends on it/)
  })

  test('the effective checks add no data-changing SQL', () => {
    // Strip single-quoted literals first: the privilege arrays legitimately
    // contain 'TRUNCATE', 'INSERT' and friends as *names being checked*.
    const executable = POST.replace(/'[^']*'/g, "''")
    assert.doesNotMatch(executable, /\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b/i)
    assert.doesNotMatch(executable, /\bgrant\b|\brevoke\b/i, 'postconditions must only observe')
  })

  test('the final policy is still the only policy created', () => {
    const created = [...SQL.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1])
    assert.deepEqual(created, ['users_own_profile_select'])
  })
})

// ── Data safety ──────────────────────────────────────────────────────────────

describe('data safety — no existing row is touched', () => {
  test('the migration performs no DML on user_profiles', () => {
    assert.doesNotMatch(SQL, /\binsert into\b/i)
    assert.doesNotMatch(SQL, /\bupdate public\.user_profiles\b/i)
    assert.doesNotMatch(SQL, /\bdelete from\b/i)
    assert.doesNotMatch(SQL, /\btruncate\s+(table\s+)?public\.user_profiles\b/i)
  })

  test('the table is not recreated and its shape is untouched', () => {
    assert.doesNotMatch(SQL, /drop table/i)
    assert.doesNotMatch(SQL, /create table/i)
    assert.doesNotMatch(SQL, /alter table public\.user_profiles\s+(add|drop|alter|rename) column/i)
    assert.doesNotMatch(SQL, /drop (constraint|index|trigger)/i)
  })

  test('it introduces no new access table, role hierarchy, status enum or claims', () => {
    assert.doesNotMatch(SQL, /create type|create table|app_metadata|custom_claim|user_metadata/i)
    assert.doesNotMatch(SQL, /add column\s+(status|role|is_admin|approved)/i)
  })

  test('it documents the boundary on the table itself', () => {
    assert.match(SQL, /comment on table public\.user_profiles is/)
    assert.match(MIGRATION, /administrator-controlled access boundary/i)
    assert.match(SQL, /comment on column public\.user_profiles\.username is/)
    assert.match(MIGRATION, /do not grant anon or authenticated any privilege beyond SELECT/i)
  })
})

// ── Application alignment ────────────────────────────────────────────────────

describe('the application still matches the surviving policy', () => {
  test('every session-client read of user_profiles is own-row scoped', () => {
    for (const file of ['src/middleware.ts', 'src/lib/auth/getUser.ts', 'src/app/auth/callback/route.ts']) {
      const src = read(file)
      const idx = src.indexOf("from('user_profiles')")
      assert.ok(idx > 0, `${file} must read user_profiles`)
      const query = src.slice(idx, idx + 400)
      assert.match(query, /\.eq\('id',/, `${file} must filter on id (own row)`)
      assert.doesNotMatch(query, /\.eq\('username',/, `${file} must not do a cross-row lookup with a session client`)
    }
  })

  test('the cross-row username lookup runs only on the service-role client', () => {
    const login = read('src/app/api/auth/login/route.ts')
    assert.match(login, /getSupabaseAdminClient/)
    const idx = login.indexOf("from('user_profiles')")
    assert.match(login.slice(idx, idx + 300), /\.eq\('username', username\)/)
  })

  test('no application file writes user_profiles from a user session', () => {
    for (const file of ['src/middleware.ts', 'src/lib/auth/getUser.ts', 'src/app/auth/callback/route.ts',
      'src/app/api/auth/login/route.ts']) {
      assert.doesNotMatch(read(file), /from\('user_profiles'\)[\s\S]{0,200}\.(insert|upsert|update|delete)\(/,
        `${file} must not write user_profiles`)
    }
  })

  test('provisioning and revocation write through the service-role client only', () => {
    const script = read('scripts/admin/provisionUser.ts')
    assert.match(script, /getSupabaseAdminClient/)
    assert.match(script, /\.upsert\(/, 'provisioning writes the approval record')
    assert.match(script, /update\(\{ username: null \}\)/, 'revocation clears the marker')
    assert.doesNotMatch(script, /getSupabaseUserClient/, 'never a session client')
  })

  test('no client bundle can reach the service-role key', () => {
    for (const file of ['src/middleware.ts', 'src/lib/auth/getUser.ts', 'src/lib/auth/apiGuard.ts',
      'src/lib/auth/approval.ts', 'src/lib/auth/requestAccess.ts', 'src/app/(auth)/login/page.tsx']) {
      assert.doesNotMatch(read(file), /SERVICE_ROLE|getSupabaseAdminClient/, `${file}`)
    }
  })
})

// ── Behavioural: the application half of the boundary, executed for real ──────

describe('approval semantics the migration protects (behavioural)', () => {
  const verified: IdentityVerifier = async () => ({ user: { id: 'user-1' } })
  // POST-R13.6CDE.2 — one authorization state, one query. These cases are about
  // the APPROVAL MARKER, so they hold role and grants constant at values that
  // satisfy every later layer: an administrator, entitled to enter and to reach
  // any mapped surface. Only the marker varies, so only the marker can be what
  // flips the decision. Module entitlement itself is exercised in
  // tests/moduleRequestEnforcement.test.ts.
  const state = (username: string | null): AuthorizationStateLookup => async () => ({
    ok: true,
    state: {
      userId: 'user-1',
      approved: typeof username === 'string' && username.trim().length > 0,
      role: 'administrator',
      grants: [],
    },
  })
  const approved = state('someone')
  const revoked = state(null)
  const deletedRow: AuthorizationStateLookup = async () => ({ ok: true, state: null })

  test('presence of the marker is what grants access', () => {
    assert.ok(isApprovedProfile({ id: 'u', username: 'someone' }))
    assert.ok(!isApprovedProfile({ id: 'u', username: null }))
    assert.ok(!isApprovedProfile(null))
  })

  test('per-request browser approval still works after the migration model', async () => {
    assert.equal((await decideRequestAccess('/portfolio', verified, approved)).outcome, 'allow')
    const denied = await decideRequestAccess('/portfolio', verified, revoked)
    assert.deepEqual(denied, { outcome: 'deny', reason: 'not_approved', status: 403, json: false })
  })

  test('per-request API approval still works after the migration model', async () => {
    assert.equal((await decideRequestAccess('/api/market/stocks', verified, approved)).outcome, 'allow')
    const denied = await decideRequestAccess('/api/market/stocks', verified, deletedRow)
    assert.deepEqual(denied, { outcome: 'deny', reason: 'not_approved', status: 403, json: true })
  })

  test('revocation still takes effect on the next request, with no expiry wait', async () => {
    let cleared = false
    const lookup: AuthorizationStateLookup = async (uid) => state(cleared ? null : 'someone')(uid)
    assert.equal((await decideRequestAccess('/api/market/stocks', verified, lookup)).outcome, 'allow')
    cleared = true // administrator ran --revoke; the token is unchanged and still valid
    assert.equal((await decideRequestAccess('/api/market/stocks', verified, lookup)).outcome, 'deny')
  })

  test('a user who could once self-restore now cannot: the app offers no write path', () => {
    for (const f of ['src/middleware.ts', 'src/lib/auth/getUser.ts', 'src/app/auth/callback/route.ts']) {
      assert.doesNotMatch(read(f), /username:\s*['"`]/, `${f} must not set a username`)
    }
  })
})

// ── Documentation ────────────────────────────────────────────────────────────

describe('deployment and rollback documentation', () => {
  test('the doc records the former unsafe policies verbatim', () => {
    assert.match(DOC, /users_own_profile_insert/)
    assert.match(DOC, /users_own_profile_update/)
    assert.match(DOC, /for insert with check \(auth\.uid\(\) = id\)/)
  })

  test('the doc names this migration and states the final policies and grants', () => {
    assert.match(DOC, new RegExp(MIGRATION_NAME.replace(/\./g, '\\.')))
    assert.match(DOC, /Final RLS policies/i)
    assert.match(DOC, /Final table grants/i)
    assert.match(DOC, /\bPUBLIC\b/, 'PUBLIC must appear in the final grant table')
  })

  test('the doc uses the migration/CLI workflow, not the remote SQL Editor', () => {
    assert.match(DOC, /supabase migration list/)
    assert.match(DOC, /supabase db push --dry-run/)
    assert.match(DOC, /supabase db push\b/)
    // The §2b deployment section must forbid, not instruct, the SQL-Editor
    // paste — and must order the CLI steps correctly.
    const section = DOC.slice(DOC.indexOf('## 2b'), DOC.indexOf('## 3 ·'))
    assert.match(section, /Do \*\*not\*\* paste this\s*\n?migration into the remote SQL Editor/)
    assert.doesNotMatch(section, /Apply via Supabase Dashboard/i)
    const steps = ['supabase projects list', 'supabase migration list', 'supabase db push --dry-run', 'supabase db push\n']
    let cursor = -1
    for (const step of steps) {
      const at = section.indexOf(step, cursor + 1)
      assert.ok(at > cursor, `deployment steps out of order at: ${step}`)
      cursor = at
    }
  })

  test('the doc gives catalog queries to verify the result afterwards', () => {
    assert.match(DOC, /pg_policies/)
    assert.match(DOC, /aclexplode|has_table_privilege|column_privileges/)
    assert.match(DOC, /relrowsecurity/)
  })

  test('rollback is documented and states plainly what it restores', () => {
    assert.match(DOC, /### .*Rollback/i)
    assert.match(DOC, /restores the self-approval/i)
  })

  test('public signup remains recorded as a separate external control, verified true', () => {
    assert.match(DOC, /Mandatory Supabase deployment settings/i)
    assert.match(DOC, /disable_signup/)
    assert.match(DOC, /`true` — \*\*control satisfied\*\*/)
  })

  test('the doc contains no key material or real identities', () => {
    assert.doesNotMatch(DOC, /eyJ[A-Za-z0-9_-]{10,}/)
    assert.doesNotMatch(DOC, /mesainversiones|@inevada\.cl/i)
  })
})
