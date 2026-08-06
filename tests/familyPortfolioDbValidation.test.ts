// R13.1.1A — The isolated database-validation harness.
//
// WHAT RUNS HERE, AND WHAT DOES NOT.
//
// STRUCTURAL ONLY. This file asserts that the harness exists and is correctly
// and safely configured: supabase/config.toml carries no project reference or
// credential, the pgTAP suite covers the required ground, and the GitHub Actions
// workflow is hermetic with a pinned CLI.
//
// It does NOT execute PostgreSQL. There is no local Postgres in this environment
// (no Docker, no psql). The executable proof lives in
// supabase/tests/database/family_portfolio_entitlements_test.sql and runs on a
// disposable GitHub-hosted runner.
//
// **Creating the workflow is not validation.** R13.1.1 stays incomplete until
// that workflow has actually RUN and PASSED on the committed branch, and R13.2
// stays blocked until then. Nothing in this file may be read as evidence that
// the database behaved correctly.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------------------------------------
// 1 - supabase/config.toml is local-only
// ---------------------------------------------------------------------------

describe('supabase/config.toml is local-only', () => {
  const CFG = read('supabase/config.toml')

  test('it exists and declares no real project reference', () => {
    // A Supabase project ref is exactly 20 lowercase letters.
    const projectId = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(CFG)
    assert.ok(projectId, 'config.toml needs a project_id (the local container prefix)')
    assert.doesNotMatch(projectId[1], /^[a-z]{20}$/, 'project_id must not be a real Supabase project ref')
  })

  test('it contains no credential, production URL, or linked-project metadata', () => {
    assert.doesNotMatch(CFG, /supabase\.co/i)
    assert.doesNotMatch(CFG, /eyJ[A-Za-z0-9_-]{10,}/)
    assert.doesNotMatch(CFG, /^\s*(password|jwt_secret|service_role_key|anon_key)\s*=/im)
  })

  test('auth stays enabled - the entitlement tests depend on auth.uid()', () => {
    const authBlock = /\[auth\]([\s\S]*?)(\n\[|$)/.exec(CFG)
    assert.ok(authBlock)
    assert.match(authBlock[1], /enabled\s*=\s*true/)
  })

  test('public signup is disabled, mirroring the production posture', () => {
    assert.match(CFG, /enable_signup\s*=\s*false/)
  })

  test('the Postgres major version is pinned so CI matches production', () => {
    assert.match(CFG, /major_version\s*=\s*\d+/)
  })

  test('supabase/.temp is not committed', () => {
    assert.equal(existsSync(join(ROOT, 'supabase/.temp')), false)
  })
})

// ---------------------------------------------------------------------------
// 2 - The executable pgTAP suite
// ---------------------------------------------------------------------------

describe('executable pgTAP suite', () => {
  const T_PATH = 'supabase/tests/database/family_portfolio_entitlements_test.sql'
  const T = read(T_PATH)

  test('it exists at the conventional Supabase path', () => {
    assert.ok(existsSync(join(ROOT, T_PATH)))
  })

  test('it runs in a transaction that is rolled back, leaving no residue', () => {
    assert.match(T, /^begin;/m)
    assert.match(T, /rollback;\s*$/)
    assert.match(T, /select (?:no_plan\(\)|plan\(\d+\))/)
    assert.match(T, /select \* from finish\(\)/)
  })

  test('it carries a substantial number of real assertions', () => {
    // A count, not a plan: this environment cannot execute pgTAP, so asserting
    // an exact plan number would be a guess. This guards against the suite being
    // gutted while still passing.
    const assertions = (T.match(/^\s*select (?:is|isnt|ok|throws_ok|lives_ok|has_column|hasnt_column|col_is_null|col_not_null|col_default_is|has_table|has_function)\(/gm) ?? []).length
    assert.ok(assertions >= 90, `expected a substantial pgTAP suite, found ${assertions} assertions`)
  })

  test('it exercises the migration constraints', () => {
    assert.match(T, /portfolio_principal REJECTS administrator/)
    assert.match(T, /role rejects an unknown value/)
    assert.match(T, /portfolio_principal is nullable/)
    assert.match(T, /avatar_url has no migration authority/)
  })

  test('it exercises function security', () => {
    assert.match(T, /pins search_path/)
    assert.match(T, /anon CANNOT execute nmi_current_portfolio_scopes/)
    assert.match(T, /is IMMUTABLE/)
    assert.match(T, /takes NO parameters/)
    assert.match(T, /no nmi_\* function is owned by anon or authenticated/)
  })

  test('it exercises the full access matrix through the real auth.uid() path', () => {
    assert.match(T, /request\.jwt\.claims/)
    assert.match(T, /set local role authenticated/)
    for (const s of ['ADMIN \\(null principal\\)', 'JAIME', 'ANDRES', 'PABLO', 'UNAPPROVED']) {
      assert.match(T, new RegExp(s), `access matrix is missing ${s}`)
    }
    assert.match(T, /JAIME cannot reach ANDRES/)
    assert.match(T, /ANDRES cannot reach JAIME/)
    assert.match(T, /PABLO cannot reach JAIME/)
    assert.match(T, /unknown scope denied/)
  })

  test('it exercises profile-mutation security against real RLS', () => {
    assert.match(T, /a user CANNOT change their OWN role/)
    // SQL doubles an apostrophe to escape it, so the literal reads `user''s`.
    assert.match(T, /a user CANNOT change ANOTHER user''s role/)
    assert.match(T, /CANNOT insert an authorization-bearing profile row/)
    assert.match(T, /the service-role administrative path CAN change a role/)
  })

  test('it exercises audit security, including honest bootstrap representation', () => {
    assert.match(T, /authenticated CANNOT insert audit rows/)
    assert.match(T, /authenticated CANNOT update audit rows/)
    assert.match(T, /authenticated CANNOT delete audit rows/)
    assert.match(T, /an ordinary user reads NO audit rows/)
    assert.match(T, /a bootstrap row CANNOT name an application actor/)
    assert.match(T, /recorded honestly/)
  })

  test('it uses only throwaway .invalid identities, never a production one', () => {
    const emails = [...T.matchAll(/'([^']*@[^']*)'/g)].map((m) => m[1])
    assert.ok(emails.length > 0)
    for (const e of emails) assert.match(e, /@test\.invalid$/, `non-throwaway identity: ${e}`)
    assert.doesNotMatch(T, /inevada|mesainversiones/i)
  })

  test('it contains no financial fixture', () => {
    assert.doesNotMatch(T, /portfolio_snapshot|holdings|market_value|net_asset/i)
  })
})

// ---------------------------------------------------------------------------
// 3 - The GitHub Actions workflow
// ---------------------------------------------------------------------------

describe('GitHub Actions database-validation workflow', () => {
  const WF_PATH = '.github/workflows/r13-family-portfolio-db-validation.yml'
  const WF = read(WF_PATH)

  test('it exists and is triggered manually, on PRs, and on the feature branch', () => {
    assert.ok(existsSync(join(ROOT, WF_PATH)))
    assert.match(WF, /workflow_dispatch/)
    assert.match(WF, /pull_request:/)
    assert.match(WF, /feat\/portfolio-r13/)
  })

  test('the Supabase CLI version is PINNED, never latest or floating', () => {
    const pinned = /SUPABASE_CLI_VERSION:\s*'([\d.]+)'/.exec(WF)
    assert.ok(pinned, 'the CLI version must be pinned in one place')
    assert.match(pinned[1], /^\d+\.\d+\.\d+$/)
    assert.doesNotMatch(WF, /version:\s*['"]?latest/i)
    // ...and it matches the devDependency the repository already pins.
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> }
    assert.equal(
      pkg.devDependencies.supabase.replace(/^[\^~]/, ''),
      pinned[1],
      'the workflow CLI pin must match the supabase devDependency',
    )
  })

  test('it verifies at runtime that the CLI really is the pinned version', () => {
    assert.match(WF, /Expected pinned Supabase CLI/)
  })

  test('it needs no secret and cannot reach production', () => {
    // No secret is CONSUMED. `${{ secrets.* }}` is the only way a workflow can
    // read one; the workflow's own fail-closed guard mentions `project_id` in a
    // grep pattern, which is a safety check rather than a secret use.
    assert.doesNotMatch(WF, /\$\{\{\s*secrets\./, 'the workflow must consume no repository secret')
    assert.doesNotMatch(WF, /SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|SERVICE_ROLE_KEY/i)
    assert.doesNotMatch(WF, /supabase link/)
    assert.match(WF, /permissions:\s*\n\s*contents: read/)
  })

  test('it fails closed if a linked project or committed env file appears', () => {
    assert.match(WF, /supabase\/\.temp is present/)
    assert.match(WF, /appears to reference a real Supabase project ref/)
  })

  test('it applies the full migration chain from a clean database and runs pgTAP', () => {
    assert.match(WF, /supabase start/)
    assert.match(WF, /supabase db reset/)
    assert.match(WF, /supabase test db/)
  })

  test('it runs the TypeScript half of the parity contract too', () => {
    assert.match(WF, /familyPortfolioEntitlements\.test\.ts/)
  })

  test('it always tears the stack down, even after failure', () => {
    assert.match(WF, /if: always\(\)[\s\S]{0,140}supabase stop/)
  })

  test('it uploads no artifact and dumps no database', () => {
    assert.doesNotMatch(WF, /upload-artifact/)
    assert.doesNotMatch(WF, /db dump|pg_dump/)
  })

  test('it installs dependencies from the lockfile', () => {
    assert.match(WF, /npm ci/)
  })

  test('the production workflows are untouched and still present', () => {
    for (const f of ['refresh-market-data.yml', 'refresh-earnings-calendar.yml', 'sync-data-to-branches.yml']) {
      assert.ok(existsSync(join(ROOT, '.github/workflows', f)), `${f} must still exist`)
    }
  })
})

// ---------------------------------------------------------------------------
// 4 - The harness is not itself validation
// ---------------------------------------------------------------------------

describe('validation status is stated honestly', () => {
  const DOC = read('docs/portfolio-r13/05-authorization-and-data-architecture.md')
  const PLAN = read('docs/portfolio-r13/08-implementation-test-release-plan.md')

  test('the architecture doc records that PostgreSQL execution has not happened', () => {
    assert.match(DOC, /NOT PERFORMED/)
    assert.match(DOC, /Creating this workflow is not validation/i)
  })

  test('both docs state that R13.2 stays blocked until the workflow passes', () => {
    assert.match(DOC, /R13\.2 remains blocked|R13\.2 must not depend/i)
    assert.match(PLAN, /R13\.2 must not begin until/i)
  })

  test('the plan records the static/executed boundary', () => {
    assert.match(PLAN, /Proven only by the workflow/i)
  })
})
