// POST-R13.6B.1 — Structured Notes + notification recipient hardening.
//
// WHAT THIS FILE CAN AND CANNOT PROVE
// ───────────────────────────────────
// This is the STATIC half. It proves the decision rule, the route wiring, and
// the shape of the migration. It CANNOT prove what a real member can do against
// real PostgreSQL — RLS, GRANT/REVOKE and role sessions are not exercised by
// reading source text, and a test that pretended otherwise would be the most
// dangerous kind of green.
//
// The executable half is supabase/tests/database/sensitive_surface_hardening_test.sql,
// run by `supabase test db` in the isolated CI database. It deliberately bypasses
// every Next.js route and drives the database as `anon`, `authenticated` and
// `service_role` through the real auth.uid() path. Both halves are required; the
// division is intentional and neither is redundant.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  APP_MODULE_KEYS,
  canAccessModule,
  decideModuleAccess,
  MODULE_DENIAL_REASONS,
  type ModuleAccessInput,
} from '../src/lib/auth/moduleAccess.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const MIGRATION = read('supabase/migrations/20260815000000_sensitive_surface_hardening.sql')
const PGTAP = read('supabase/tests/database/sensitive_surface_hardening_test.sql')
const GUARD = read('src/lib/auth/moduleApiGuard.ts')
const RESOLVER = read('src/lib/auth/getModuleAccess.ts')

/** Strips `--` line comments so a source scan cannot be satisfied by prose. */
const sqlCode = (s: string) =>
  s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

/**
 * Strips TypeScript comments.
 *
 * Required for the NEGATIVE scans below: these files DOCUMENT why they never
 * read `user_metadata`, so scanning the raw text would fail on the very comment
 * that records the rule. Only executable code may be asserted against.
 */
const tsCode = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

const MIGRATION_CODE = sqlCode(MIGRATION)

// The five tables the application writes through the caller's own session.
const GROUP_A = [
  'structured_notes',
  'structured_note_underlyings',
  'structured_note_observations',
  'structured_note_allocations',
  'structured_note_extraction_runs',
]
// The three written only by the scheduled cron through the service role.
const GROUP_B = [
  'structured_note_price_snapshots',
  'structured_note_monitoring_runs',
  'structured_note_extracted_fields',
]

// Route -> handler -> expected guard. Derived from the audit of which client each
// handler uses and what it does, not from the file names.
const READ_GUARDS = ['guardModuleRead', 'guardModuleReadWithCapability']
const ROUTES: { path: string; handlers: Record<string, 'read' | 'admin'> }[] = [
  { path: 'src/app/api/structured-notes/route.ts', handlers: { GET: 'read' } },
  { path: 'src/app/api/structured-notes/monitoring-status/route.ts', handlers: { GET: 'read' } },
  { path: 'src/app/api/structured-notes/[id]/route.ts', handlers: { GET: 'read', PATCH: 'admin', DELETE: 'admin' } },
  { path: 'src/app/api/structured-notes/[id]/allocations/route.ts', handlers: { GET: 'read', POST: 'admin' } },
  { path: 'src/app/api/structured-notes/[id]/allocations/[allocationId]/route.ts', handlers: { DELETE: 'admin' } },
  { path: 'src/app/api/structured-notes/extract/route.ts', handlers: { POST: 'admin' } },
  { path: 'src/app/api/structured-notes/import/route.ts', handlers: { POST: 'admin' } },
  { path: 'src/app/api/notification-recipients/route.ts', handlers: { GET: 'admin', POST: 'admin' } },
  { path: 'src/app/api/notification-recipients/[id]/route.ts', handlers: { PATCH: 'admin', DELETE: 'admin' } },
]

/** Returns the body of one exported handler, up to the next export. */
function handlerBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`)
  assert.notEqual(start, -1, `handler ${name} not found`)
  const rest = src.slice(start)
  const next = rest.indexOf('\nexport async function ', 1)
  return next === -1 ? rest : rest.slice(0, next)
}

// Identities used across the matrix.
const ADMIN: ModuleAccessInput = { isApproved: true, isAdministrator: true, grants: [] }
const GRANTED: ModuleAccessInput = { isApproved: true, isAdministrator: false, grants: ['structured_notes', 'markets'] }
const UNGRANTED: ModuleAccessInput = { isApproved: true, isAdministrator: false, grants: ['markets', 'portfolio'] }
const UNAPPROVED: ModuleAccessInput = { isApproved: false, isAdministrator: false, grants: ['structured_notes'] }

describe('POST-R13.6B.1 — the access matrix the owner locked', () => {
  it('a granted member READS Structured Notes', () => {
    assert.equal(canAccessModule(GRANTED, 'structured_notes'), true)
  })

  it('an ungranted member is denied, and holding OTHER modules does not help', () => {
    assert.equal(canAccessModule(UNGRANTED, 'structured_notes'), false)
    assert.equal(canAccessModule(UNGRANTED, 'markets'), true)
    assert.equal(
      decideModuleAccess(UNGRANTED, 'structured_notes').reason,
      MODULE_DENIAL_REASONS.noGrant,
    )
  })

  it('an unapproved account is denied despite holding the grant', () => {
    assert.equal(canAccessModule(UNAPPROVED, 'structured_notes'), false)
    assert.equal(
      decideModuleAccess(UNAPPROVED, 'structured_notes').reason,
      MODULE_DENIAL_REASONS.notApproved,
    )
  })

  it('an administrator reads without holding any grant row', () => {
    assert.deepEqual(ADMIN.grants, [])
    assert.equal(canAccessModule(ADMIN, 'structured_notes'), true)
  })

  it('THE central rule: a grant is a READ right, never a write right', () => {
    // The module rule cannot express "may write" at all — mutation authority is
    // `isAdministrator`, a different field entirely. A granted member holding
    // every module in the registry is still not an administrator.
    const everyModule: ModuleAccessInput = {
      isApproved: true,
      isAdministrator: false,
      grants: [...APP_MODULE_KEYS],
    }
    assert.equal(canAccessModule(everyModule, 'structured_notes'), true)
    assert.equal(everyModule.isAdministrator, false)
    assert.equal(ADMIN.isAdministrator, true)
  })
})

describe('POST-R13.6B.1 — every route is guarded, with the RIGHT guard', () => {
  for (const { path, handlers } of ROUTES) {
    const src = read(path)

    for (const [name, kind] of Object.entries(handlers)) {
      it(`${path.replace('src/app/api/', '')} ${name} uses the ${kind} guard`, () => {
        const body = handlerBody(src, name)
        if (kind === 'admin') {
          assert.ok(
            body.includes('guardAdministrator()'),
            `${name} must call guardAdministrator()`,
          )
          assert.ok(
            !READ_GUARDS.some((g) => body.includes(`${g}(`)),
            `${name} is a mutation — a module grant must never authorise it`,
          )
        } else {
          assert.ok(
            READ_GUARDS.some((g) => body.includes(`${g}('structured_notes')`)),
            `${name} must gate on the structured_notes module`,
          )
        }
      })

      it(`${path.replace('src/app/api/', '')} ${name} guards BEFORE touching data`, () => {
        const body = handlerBody(src, name)
        const guardAt = Math.min(
          ...['guardAdministrator', 'guardModuleRead', 'guardModuleReadWithCapability']
            .map((g) => body.indexOf(g))
            .filter((i) => i >= 0),
        )
        const clientAt = body.indexOf('getSupabaseUserClient')
        assert.ok(guardAt > 0, 'no guard found')
        if (clientAt >= 0) {
          assert.ok(
            guardAt < clientAt,
            'the guard must run before a database client is obtained',
          )
        }
      })
    }
  }

  it('no notification-recipient route treats the list as a grantable module', () => {
    for (const p of [
      'src/app/api/notification-recipients/route.ts',
      'src/app/api/notification-recipients/[id]/route.ts',
    ]) {
      const src = read(p)
      assert.ok(!src.includes('guardModuleRead'), `${p} must not use a module guard`)
      assert.ok(!src.includes('notification_recipients\''), `${p} must not name a module key`)
    }
  })

  it('the recipient list is not, and cannot become, a module key', () => {
    assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes('notification_recipients'))
    const registry = read('supabase/migrations/20260814000000_module_entitlements.sql')
    assert.ok(!/\(\s*'notification_recipients'\s*,/.test(registry))
    assert.ok(MIGRATION_CODE.includes("module_key = 'notification_recipients'"))
    assert.ok(MIGRATION.includes('must never be a grantable module'))
  })
})

describe('POST-R13.6B.1 — the guard helpers fail closed', () => {
  it('the read guard and the admin guard are different decisions', () => {
    assert.ok(GUARD.includes('canAccessModule(access, module)'))
    assert.ok(GUARD.includes('isAdministrator ? null : administratorForbiddenJson()'))
    // The administrator guard must never consult a grant set.
    // Bound the slice to THIS function: the capability helper defined after it
    // legitimately calls canAccessModule, and an unbounded slice would swallow it.
    const from = GUARD.indexOf('export async function guardAdministrator')
    const to = GUARD.indexOf('export async function', from + 10)
    const adminFn = to === -1 ? GUARD.slice(from) : GUARD.slice(from, to)
    assert.ok(adminFn.includes('guardAdministrator'), 'the slice must not be empty')
    assert.ok(!adminFn.includes('canAccessModule'), 'the admin guard must not consult grants')
  })

  it('both denials are 403 with no payload fragment and no caching', () => {
    assert.ok(GUARD.includes('status: 403'))
    assert.ok(GUARD.includes('NO_STORE_HEADERS'))
    assert.ok(GUARD.includes("moduleNotGranted: 'module_not_granted'"))
    assert.ok(GUARD.includes("administratorRequired: 'administrator_required'"))
  })

  it('the resolver reads the database, never client-supplied claims', () => {
    assert.ok(RESOLVER.includes("from('user_profiles')"))
    assert.ok(RESOLVER.includes("from('user_module_grants')"))
    assert.ok(RESOLVER.includes('getSupabaseUserClient'))
    // Negative scans read CODE only — this file documents why it avoids
    // user_metadata, and the comment must not be what fails the test.
    const code = tsCode(RESOLVER)
    assert.ok(code.includes("from('user_profiles')"), 'the code scan must not be vacuous')
    // user_metadata is writable by the user through the anon key.
    assert.ok(!code.includes('user_metadata'))
    // The service-role client would bypass the own-row RLS this read relies on.
    assert.ok(!code.includes('getSupabaseAdminClient'))
    assert.ok(!code.includes('headers()'))
  })

  it('every failure path denies rather than defaulting to an empty grant set', () => {
    assert.ok(RESOLVER.includes('if (!user) return DENIED'))
    assert.ok(RESOLVER.includes('if (!client) return DENIED'))
    assert.ok(RESOLVER.includes('if (grantRes.error) return { ...DENIED, userId: user.id }'))
    assert.ok(RESOLVER.includes('isApproved: false'))
  })

  it('capability and denial come from ONE resolution, so they cannot disagree', () => {
    const fn = GUARD.slice(GUARD.indexOf('export async function guardModuleReadWithCapability'))
    assert.equal((fn.match(/getCallerModuleAccess\(\)/g) ?? []).length, 1)
    assert.ok(fn.includes('canManage: false'))
  })
})

describe('POST-R13.6B.1 — the migration closes the actual exposure', () => {
  it('drops EVERY pre-existing policy rather than named ones', () => {
    // `sn_shared_select` and friends were created in a loop; a named drop list
    // would miss anything an older phase left behind.
    assert.ok(MIGRATION_CODE.includes('from pg_catalog.pg_policies'))
    assert.ok(MIGRATION_CODE.includes('drop policy %I'))
  })

  it('asserts the permissive shared-book shape is gone', () => {
    assert.ok(MIGRATION_CODE.includes("like '%uid() IS NOT NULL%'"))
    assert.ok(MIGRATION.includes('permissive auth.uid()-is-not-null policy still present'))
  })

  it('gates every Structured Notes SELECT on the module predicate', () => {
    assert.ok(MIGRATION_CODE.includes("nmi_can_access_module(''structured_notes'')"))
    assert.ok(MIGRATION_CODE.includes('sn_module_select'))
    for (const t of [...GROUP_A, ...GROUP_B]) {
      assert.ok(MIGRATION_CODE.includes(`'${t}'`), `${t} must be hardened`)
    }
  })

  it('gates every Structured Notes mutation on administrator status', () => {
    // Checked PER POLICY, not by a global "nmi_is_administrator appears
    // somewhere" scan. A non-vacuity run proved the global form is too weak: it
    // stays green when a single verb is switched to the module predicate while
    // the other two still mention the administrator function.
    for (const name of ['sn_admin_insert', 'sn_admin_update', 'sn_admin_delete']) {
      const at = MIGRATION_CODE.indexOf(`"${name}"`)
      assert.notEqual(at, -1, `${name} missing`)
      // The policy statement runs to its terminating `, t);`.
      const end = MIGRATION_CODE.indexOf(', t);', at)
      assert.notEqual(end, -1, `${name} statement is malformed`)
      const stmt = MIGRATION_CODE.slice(at, end)
      assert.ok(
        stmt.includes('nmi_is_administrator()'),
        `${name} must be gated on administrator status`,
      )
      assert.ok(
        !stmt.includes('nmi_can_access_module'),
        `${name} must NOT consult a module grant — a grant is a read right`,
      )
    }
    // And proves the same thing in-database, per verb, at apply time.
    assert.ok(MIGRATION.includes('has no administrator-gated % policy'))
    assert.ok(MIGRATION.includes('a grant is not a write right'))
  })

  it('the recipient policies are administrator-gated per verb, not in aggregate', () => {
    for (const verb of ['select', 'insert', 'update', 'delete']) {
      const name = `notification_recipients_admin_${verb}`
      const at = MIGRATION_CODE.indexOf(name)
      assert.notEqual(at, -1, `${name} missing`)
      const end = MIGRATION_CODE.indexOf(';', at)
      const stmt = MIGRATION_CODE.slice(at, end)
      assert.ok(stmt.includes('nmi_is_administrator()'), `${name} must be administrator-gated`)
      assert.ok(!stmt.includes('nmi_can_access_module'), `${name} must not consult a module grant`)
    }
  })

  it('cron-owned tables get NO mutation policy and NO mutation privilege', () => {
    assert.ok(MIGRATION.includes('must have no mutation policy'))
    assert.ok(MIGRATION.includes('authenticated has % on cron-owned public.%'))
    // The grant of mutation verbs is scoped to group A only.
    assert.ok(MIGRATION_CODE.includes('grant insert, update, delete on table public.%I to authenticated'))
  })

  it('revokes the inherited default privileges before granting anything back', () => {
    assert.ok(MIGRATION_CODE.includes('revoke all privileges on table public.%I from public, anon, authenticated'))
    assert.ok(MIGRATION_CODE.includes('revoke all privileges on table public.notification_recipients from public, anon, authenticated'))
    // Column ACLs survive a table-level revoke.
    assert.ok(MIGRATION_CODE.includes('pg_attribute'))
    assert.ok(MIGRATION_CODE.includes('attacl is not null'))
  })

  it('proves anon has no EFFECTIVE privilege, not merely no policy', () => {
    assert.ok(MIGRATION_CODE.includes("has_table_privilege('anon'"))
    assert.ok(MIGRATION_CODE.includes("has_any_column_privilege('anon'"))
    assert.ok(MIGRATION.includes('anon has EFFECTIVE % on public.%'))
  })

  it('keeps the administrator flow working through the session client', () => {
    // Every Structured Notes and recipient route writes as `authenticated`, so
    // removing that privilege would break administrators rather than secure them.
    assert.ok(MIGRATION.includes('administrator writes go through the session client'))
    assert.ok(MIGRATION.includes('admin management would break'))
    assert.ok(MIGRATION.includes('the read path would break'))
  })

  it('makes notification_recipients administrator-only for ALL FOUR verbs', () => {
    for (const p of [
      'notification_recipients_admin_select',
      'notification_recipients_admin_insert',
      'notification_recipients_admin_update',
      'notification_recipients_admin_delete',
    ]) {
      assert.ok(MIGRATION_CODE.includes(p), `${p} missing`)
    }
    assert.ok(MIGRATION.includes('expected exactly 4 policies on notification_recipients'))
    assert.ok(MIGRATION.includes('must not be governed by a module grant'))
  })

  it('preserves service-role delivery', () => {
    assert.ok(MIGRATION_CODE.includes('grant all privileges on table public.notification_recipients to service_role'))
    assert.ok(MIGRATION_CODE.includes('grant all privileges on table public.%I to service_role'))
    assert.ok(MIGRATION.includes('notification delivery would break'))
  })
})

describe('POST-R13.6B.1 — what the migration must NOT do', () => {
  it('does not touch personal notification state', () => {
    // notification_reads is the member's OWN read markers, already correctly
    // scoped. Hardening the shared address book must not take it away.
    const ddl = MIGRATION_CODE.match(
      /^\s*(?:create policy|drop policy|alter table|grant|revoke)\b[^;]*;/gim,
    ) ?? []
    assert.ok(ddl.length > 0, 'the DDL scan must not be vacuous')
    for (const stmt of ddl) {
      assert.ok(!/notification_reads/.test(stmt), `must not alter notification_reads: ${stmt.trim()}`)
      assert.ok(!/public\.notifications\b/.test(stmt), `must not alter notifications: ${stmt.trim()}`)
      assert.ok(!/user_profiles/.test(stmt), `must not alter user_profiles: ${stmt.trim()}`)
      assert.ok(!/user_module_grants|app_modules/.test(stmt), `must not alter the module foundation: ${stmt.trim()}`)
      assert.ok(!/family_portfolio|portfolio_/.test(stmt), `must not alter Family Portfolio objects: ${stmt.trim()}`)
    }
    // And asserts the preservation positively.
    assert.ok(MIGRATION.includes('notification_reads lost its per-user policy'))
  })

  it('does not redefine any entitlement function', () => {
    assert.ok(!/create or replace function/i.test(MIGRATION_CODE))
    assert.ok(!/drop function/i.test(MIGRATION_CODE))
  })

  it('re-asserts the frozen Portfolio ceiling and the 7-module registry', () => {
    assert.ok(MIGRATION_CODE.includes("nmi_portfolio_scopes(true, false, 'jaime')"))
    assert.ok(MIGRATION.includes('the Family Portfolio ceiling changed'))
    assert.ok(MIGRATION.includes('expected 7 modules'))
  })

  it('contains no credential, secret or real identity', () => {
    assert.ok(!/service_role_key|SUPABASE_SERVICE_ROLE|anon_key|password/i.test(MIGRATION))
    assert.ok(!/@inevada\.cl/i.test(MIGRATION + PGTAP))
  })
})

describe('POST-R13.6B.1 — the executable half covers the bypass path', () => {
  it('drives the database as every relevant role', () => {
    for (const r of ['as_anon', 'as_user', 'as_service']) {
      assert.ok(PGTAP.includes(`pg_temp.${r}`), `${r} helper missing`)
    }
    assert.ok(PGTAP.includes("set local role authenticated"))
    assert.ok(PGTAP.includes("set local role anon"))
    assert.ok(PGTAP.includes('request.jwt.claims'))
  })

  it('covers all four verbs for a granted member', () => {
    assert.ok(PGTAP.includes('a granted member CAN read the notes book'))
    assert.ok(PGTAP.includes('a granted member CANNOT insert a structured note'))
    assert.ok(PGTAP.includes('no member UPDATE reached the note'))
    assert.ok(PGTAP.includes('no member DELETE reached the notes book'))
  })

  it('proves the RLS-refused UPDATE/DELETE by re-reading, not by expecting a throw', () => {
    // An RLS-filtered UPDATE/DELETE touches zero rows WITHOUT raising, so a
    // throws_ok there would fail and an "it did not throw" assertion would be
    // vacuous. The suite must re-read the row as a privileged role instead.
    assert.ok(PGTAP.includes('the value is untouched'))
    assert.ok(PGTAP.includes('no member UPDATE reached the sociedad allocation'))
    assert.ok(/select pg_temp\.as_service\(\);\s*\n\s*\nselect is\(\(select product_name/.test(PGTAP))
  })

  it('covers the ungranted member, the unapproved account and anon', () => {
    assert.ok(PGTAP.includes('an ungranted member sees NO structured notes'))
    assert.ok(PGTAP.includes('an UNAPPROVED account sees nothing despite holding the grant'))
    assert.ok(PGTAP.includes('anon cannot read structured_notes'))
    assert.ok(PGTAP.includes('anon cannot read recipient addresses'))
  })

  it('proves a member holding EVERY module still cannot reach recipients', () => {
    assert.ok(PGTAP.includes('a member holding EVERY module still cannot read recipient addresses'))
    assert.ok(PGTAP.includes('from public.app_modules m'))
  })

  it('proves the administrator flow and service-role delivery still work', () => {
    assert.ok(PGTAP.includes('an administrator CAN insert a structured note'))
    assert.ok(PGTAP.includes('the administrator UPDATE actually took effect'))
    assert.ok(PGTAP.includes('the administrator DELETE actually took effect'))
    assert.ok(PGTAP.includes('an administrator CAN read the recipient list'))
    assert.ok(PGTAP.includes('service_role can still read recipients for delivery'))
    assert.ok(PGTAP.includes('service_role can still write price snapshots'))
  })

  it('proves personal notification state survives the hardening', () => {
    assert.ok(PGTAP.includes('an ordinary member still reads the in-app notification feed'))
    assert.ok(PGTAP.includes('can still mark their OWN notification read'))
  })

  it('uses only throwaway fixtures', () => {
    assert.ok(PGTAP.includes('rollback;'))
    assert.ok(!/@(gmail|inevada|outlook)\./i.test(PGTAP))
    const emails = PGTAP.match(/[a-z0-9._-]+@[a-z0-9.-]+/gi) ?? []
    for (const e of emails) assert.ok(e.endsWith('.invalid'), `non-throwaway address: ${e}`)
  })
})

describe('POST-R13.6B.1 — the production backfill audit is read-only', () => {
  const AUDIT = read('scripts/admin/auditModuleGrantBackfill.ts')
  const code = tsCode(AUDIT)

  it('has no write path of any kind', () => {
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      assert.ok(!code.includes(verb), `the audit must never call ${verb}`)
    }
    assert.ok(code.includes(".select('id, username, role')"), 'the read must not be vacuous')
  })

  it('refuses write-shaped arguments rather than accepting them as a mode', () => {
    assert.ok(code.includes("'--write'"))
    assert.ok(code.includes('refusing to run'))
    assert.ok(code.includes('process.exitCode = 2'))
  })

  it('never reads or prints an email address', () => {
    assert.ok(!code.includes('email'))
  })

  it('answers the four questions the closure stage must ask', () => {
    assert.ok(AUDIT.includes('approved members (non-admin)'))
    assert.ok(AUDIT.includes('rows it would create'))
    assert.ok(AUDIT.includes('would target an administrator'))
    assert.ok(AUDIT.includes('would target an unapproved user'))
    assert.ok(AUDIT.includes('current access preserved'))
  })

  it('is a CLI outside the router, so it is unreachable over HTTP', () => {
    assert.ok(!AUDIT.includes('NextResponse'))
    assert.ok(!AUDIT.includes('export async function GET'))
  })
})

describe('POST-R13.6B.1 — the UI cannot offer what the API refuses', () => {
  const LIST = read('src/app/structured-notes/page.tsx')
  const DETAIL = read('src/app/structured-notes/[id]/page.tsx')
  const CARD = read('src/app/settings/NotificationRecipientsCard.tsx')

  it('the list page takes canManage from the API and defaults to read-only', () => {
    assert.ok(LIST.includes('setCanManage(json.canManage === true)'))
    assert.ok(LIST.includes('useState(false)'))
    assert.ok(LIST.includes('{canManage && ('))
    assert.ok(LIST.includes('disabled={calledBusy || !canManage}'))
  })

  it('the detail page hides delete and makes the allocation editor read-only', () => {
    assert.ok(DETAIL.includes('const canManage = data?.canManage === true'))
    assert.ok(DETAIL.includes('readOnly={!canManage}'))
    assert.ok(DETAIL.includes('{canManage && ('))
    assert.ok(DETAIL.includes('readOnly?: boolean'))
  })

  it('an ungranted member gets the honest error state, never a false empty book', () => {
    // The 403 now returned by the API flows into the pre-existing load-failure
    // path, which deliberately does NOT render "no structured notes yet".
    assert.ok(LIST.includes('if (!res.ok) { setNotes([]); setLoadFailed(true); return }'))
    assert.ok(DETAIL.includes('if (!res.ok) { setLoadFailed(true); return }'))
  })

  it('the recipients card renders nothing for a non-administrator', () => {
    assert.ok(CARD.includes("if (res.status === 403)"))
    assert.ok(CARD.includes("setLoadState('forbidden')"))
    assert.ok(CARD.includes("if (loadState === 'forbidden') return null"))
    // The early-out must sit after every hook, or hook order would change.
    assert.ok(CARD.indexOf("if (loadState === 'forbidden') return null") > CARD.lastIndexOf('useEffect('))
  })

  it('the client flag is documented as presentation, never protection', () => {
    // Both pages must record that the flag is a courtesy, not the boundary — the
    // comment is what stops a later reader treating it as authorization. The
    // wording wraps across comment lines, so compare against a collapsed form.
    for (const [name, src] of [['list', LIST], ['detail', DETAIL]] as const) {
      const collapsed = src.replace(/\s*\n\s*(\/\/)?\s*/g, ' ')
      assert.ok(
        /presentation, never protection/i.test(collapsed) || /never the boundary/i.test(collapsed),
        `the ${name} page must document that canManage is presentation, not protection`,
      )
    }
  })
})
