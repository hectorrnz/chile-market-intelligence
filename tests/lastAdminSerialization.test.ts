// D0C — THE LAST-ADMINISTRATOR GUARD IS SERIALISED, AND THE INVITATION DEAD END
// IS CLOSED.
//
// TWO HALVES, AND THIS IS THE ONE THAT CANNOT EXECUTE SQL. The guard is a
// PostgreSQL trigger and the defect it fixes is a write skew between two
// transactions, so the real proof is necessarily elsewhere:
//
//   · supabase/tests/database/last_administrator_serialization_test.sql pins the
//     structure against real PostgreSQL on every migration chain;
//   · scripts/ci/lastAdminRaceProof.ts drives two genuinely separate backends
//     through the interleaving, reproducing the defect with the pre-D0C guard
//     before proving the shipped one refuses it.
//
// What this file adds is the guarantee that those two exist, are wired into the
// gate that actually runs, and are not vacuous — plus the ordinary behavioural
// coverage of the invite-link message, which is plain TypeScript.
//
// Every migration assertion below states a PROPERTY, never a literal line of SQL.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

const MIGRATION = 'supabase/migrations/20260824000000_last_administrator_serialization.sql'
const LIFECYCLE_MIGRATION = 'supabase/migrations/20260817000000_user_lifecycle_provisioning.sql'
const RACE_PROOF = 'scripts/ci/lastAdminRaceProof.ts'
const PGTAP = 'supabase/tests/database/last_administrator_serialization_test.sql'
const WORKFLOW = '.github/workflows/r13-family-portfolio-db-validation.yml'
const CALLBACK = 'src/app/auth/callback/route.ts'
const LOGIN = 'src/app/(auth)/login/page.tsx'
const I18N = 'src/lib/i18n.ts'

/** Migration text with `--` comments removed, so prose can never satisfy a test. */
function sqlOnly(path: string): string {
  return read(path)
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
}

/**
 * The body of one `create or replace function`, up to its `$$;` terminator.
 *
 * Necessary because this migration also carries a postcondition block that
 * INSPECTS function source, so it legitimately contains the very strings some
 * assertions below must not find inside a function body. Matching against the
 * whole file would conflate the check with the thing being checked.
 */
function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}`)
  assert.ok(start >= 0, `${name} must be defined`)
  const end = sql.indexOf('$$;', start)
  assert.ok(end > start, `${name} must terminate`)
  return sql.slice(start, end)
}

describe('D0C · A — the serialisation migration exists and is additive', () => {
  const sql = sqlOnly(MIGRATION)

  it('adds no table, no column and no policy', () => {
    assert.doesNotMatch(sql, /create\s+table/i)
    assert.doesNotMatch(sql, /add\s+column/i)
    assert.doesNotMatch(sql, /create\s+policy/i)
    assert.doesNotMatch(sql, /drop\s+policy/i)
  })

  it('does not drop or recreate the trigger, so the attachment is never briefly absent', () => {
    assert.doesNotMatch(sql, /drop\s+trigger/i)
    assert.doesNotMatch(sql, /create\s+trigger/i)
  })

  it('leaves the already-applied lifecycle migration untouched', () => {
    // The guarantee is about the FILE, not about this migration's text: an applied
    // migration is immutable, and editing one is how a chain silently diverges
    // between a fresh database and Production.
    const lifecycle = read(LIFECYCLE_MIGRATION)
    assert.match(lifecycle, /create trigger user_profiles_last_administrator_guard/)
    assert.doesNotMatch(lifecycle, /nmi_lock_administrator_population/)
  })

  it('is ordered after every migration already applied to Production', () => {
    const stamp = Number.parseInt(MIGRATION.replace(/\D/g, '').slice(0, 14), 10)
    assert.ok(stamp > 20260823000000, 'must sort after the newest applied migration')
  })
})

describe('D0C · B — the lock is the right kind, in the right place', () => {
  const sql = sqlOnly(MIGRATION)

  it('is transaction-scoped, never session-scoped', () => {
    const helper = functionBody(sql, 'nmi_lock_administrator_population')
    assert.match(helper, /pg_catalog\.pg_advisory_xact_lock\(/)
    assert.doesNotMatch(helper, /pg_catalog\.pg_advisory_lock\(/)
  })

  it('is taken through ONE named helper rather than a hand-rolled key per caller', () => {
    const helper = functionBody(sql, 'nmi_lock_administrator_population')
    const guard = functionBody(sql, 'nmi_guard_last_administrator')
    assert.match(guard, /perform public\.nmi_lock_administrator_population\(\)/)
    // The guard must not build its own key: two different keys would serialise
    // against nothing while reading as though they serialised against each other.
    assert.doesNotMatch(guard, /pg_advisory_xact_lock/)
    assert.match(helper, /hashtext\('nmi_administrator_population'\)/)
  })

  it('is taken BEFORE the decisive count, which is the whole correctness argument', () => {
    const body = functionBody(sql, 'nmi_guard_last_administrator')
    const lockAt = body.indexOf('nmi_lock_administrator_population')
    const countAt = body.indexOf('select count(*)')
    assert.ok(lockAt > 0, 'the guard must take the lock')
    assert.ok(countAt > 0, 'the guard must count the remaining population')
    assert.ok(lockAt < countAt, 'the lock must precede the count')
  })

  it('is taken only AFTER both early returns, so ordinary edits never serialise', () => {
    const body = functionBody(sql, 'nmi_guard_last_administrator')
    const lockAt = body.indexOf('nmi_lock_administrator_population')
    assert.ok(lockAt > 0, 'the guard must take the lock')
    assert.ok(body.indexOf('if not v_was_active_admin then') < lockAt)
    assert.ok(body.indexOf('if v_is_active_admin then') < lockAt)
  })

  it('pins its search_path and denies the key to every client role', () => {
    assert.match(sql, /create or replace function public\.nmi_lock_administrator_population[\s\S]{0,200}set search_path = ''/)
    assert.match(
      sql,
      /revoke all on function public\.nmi_lock_administrator_population\(\) from public, anon, authenticated/,
    )
  })

  it('proves its own claims in the database at apply time', () => {
    // A postcondition block that RAISES is the only assertion that travels with
    // the migration to every environment it is applied in.
    assert.match(sql, /raise exception 'nmi_guard_last_administrator does not take the population lock'/)
    assert.match(sql, /raise exception 'the population lock is taken AFTER the decisive count'/)
    assert.match(sql, /raise exception 'the last-administrator guard trigger is no longer attached'/)
  })
})

describe('D0C · C — the existing semantics are unchanged', () => {
  const sql = sqlOnly(MIGRATION)

  it('keeps the bare, stable refusal token', () => {
    assert.match(sql, /raise exception 'last_administrator'/)
    // No name, no id, no count: the loser of a race learns nothing about who the
    // remaining administrator is.
    const raise = sql.slice(sql.indexOf("raise exception 'last_administrator'"))
    assert.doesNotMatch(raise.slice(0, 400), /old\.username|old\.email|v_others/)
  })

  it('does not redefine usability, approval, activation or the disabled state', () => {
    assert.doesNotMatch(sql, /create or replace function public\.nmi_profile_usable/)
    assert.doesNotMatch(sql, /create or replace function public\.nmi_is_administrator/)
    assert.doesNotMatch(sql, /create or replace function public\.nmi_can_access_module/)
    assert.doesNotMatch(sql, /create or replace function public\.nmi_current_portfolio_scopes/)
  })

  it('still tests the resulting POPULATION rather than the identity of the caller', () => {
    const body = sql.slice(sql.indexOf('create or replace function public.nmi_guard_last_administrator'))
    assert.match(body, /where p\.id <> old\.id/)
    assert.match(body, /public\.nmi_profile_usable\(p\.username::text, p\.activated_at, p\.disabled_at\)/)
    assert.doesNotMatch(body, /auth\.uid\(\)/)
  })
})

describe('D0C · D — the concurrency proof is real, and non-vacuous', () => {
  const proof = read(RACE_PROOF)

  it('opens two independent connections rather than simulating a race', () => {
    assert.match(proof, /spawn/)
    assert.match(proof, /Promise\.all\(/)
    assert.match(proof, /pg_sleep/)
  })

  it('reinstalls the PRE-D0C guard first, so the defect is demonstrated before it is fixed', () => {
    const start = proof.indexOf('const UNSERIALISED_GUARD')
    assert.ok(start > 0, 'the control guard must be defined')
    const body = proof.slice(start, proof.indexOf('end $fn$;', start))
    // The control must be the old body: same decision, and NO lock.
    assert.match(body, /select count\(\*\) into v_others/)
    assert.match(body, /raise exception 'last_administrator'/)
    assert.doesNotMatch(body, /nmi_lock_administrator_population/)
  })

  it('fails when the control does not reproduce the race', () => {
    assert.match(proof, /the old guard leaves ZERO active administrators/)
    assert.match(proof, /activeAdmins === 0/)
  })

  it('restores the shipped guard by re-applying the migration itself, not a copy', () => {
    assert.match(proof, new RegExp(MIGRATION.replace(/[/.]/g, '\\$&')))
  })

  it('asserts one commit, one refusal, and one surviving administrator', () => {
    assert.match(proof, /fixed\.activeAdmins === 1/)
    assert.match(proof, /fixed\.committed === 1/)
    assert.match(proof, /fixed\.refused === 1/)
  })

  it('refuses to run against anything but a local loopback database', () => {
    // The guard is a regex in the script, so the source carries its escapes.
    assert.match(proof, /127\\\.0\\\.0\\\.1\|localhost/)
    assert.match(proof, /refusing to run/)
  })

  it('counts administrators with the SAME predicate the guard uses', () => {
    assert.match(proof, /public\.nmi_profile_usable\(p\.username::text, p\.activated_at, p\.disabled_at\)/)
  })

  it('counts the WHOLE table, not just its own fixtures', () => {
    // The guard counts every administrator, so a proof that counted only its own
    // rows could report a population the guard itself disagrees with.
    const count = proof.slice(proof.indexOf('const COUNT_ACTIVE_ADMINS'))
    const body = count.slice(0, count.indexOf('`\n', count.indexOf('`') + 1))
    assert.doesNotMatch(body, /ADMIN_A|ADMIN_B|MEMBER_C/)
  })

  it('isolates the population first, and refuses to continue if it cannot', () => {
    // Earlier steps in the same workflow commit administrator rows. With a third
    // administrator present neither racing transaction removes the last one, so
    // every assertion would pass for the wrong reason. This is what the first CI
    // run of this script actually hit.
    assert.match(proof, /NEUTRALISE_OTHER_ADMINS/)
    assert.match(proof, /id not in \('\$\{ADMIN_A\}', '\$\{ADMIN_B\}'\)/)
    assert.match(proof, /baseline === 2/)
    assert.match(proof, /the population under test is exactly the two fixture administrators/)
  })
})

describe('D0C · E — the gate actually runs it', () => {
  const workflow = read(WORKFLOW)

  it('runs the race proof in the isolated-database workflow', () => {
    assert.match(workflow, /node scripts\/ci\/lastAdminRaceProof\.ts/)
  })

  it('runs it AFTER pgTAP, because it commits fixtures a second connection must see', () => {
    assert.ok(workflow.indexOf('supabase test db') < workflow.indexOf('lastAdminRaceProof'))
  })

  it('gates this branch family on push, so a migration cannot land ungated', () => {
    assert.match(workflow, /- 'feat\/d0-\*\*'/)
  })

  it('ships the pgTAP suite that keeps the structure pinned on every chain', () => {
    const pgtap = read(PGTAP)
    assert.match(pgtap, /nmi_lock_administrator_population/)
    assert.match(pgtap, /has_trigger\('public', 'user_profiles', 'user_profiles_last_administrator_guard'/)
    assert.match(pgtap, /last_administrator/)
    assert.match(pgtap, /rollback;\s*$/)
  })
})

describe('D0C · F — an invitation that cannot be redeemed says so', () => {
  const callback = read(CALLBACK)
  const login = read(LOGIN)
  const i18n = read(I18N)

  it('answers a failed INVITE redemption with its own code', () => {
    assert.match(callback, /error=invite_link_invalid/)
  })

  it('does not repurpose that code for a failed password recovery or code exchange', () => {
    // The generic path must survive: only an invite-type OTP gets the new code.
    assert.match(callback, /hasOtp && otpType === 'invite'/)
    assert.match(callback, /error=callback_failed/)
  })

  it('says nothing about WHY the token failed', () => {
    const branch = callback.slice(callback.indexOf("hasOtp && otpType === 'invite'"))
    assert.doesNotMatch(branch.slice(0, 400), /expired|already_used|superseded/i)
  })

  it('maps the code to a message on the one screen the invitee can reach', () => {
    assert.match(login, /case 'invite_link_invalid':/)
    assert.match(login, /t\.auth\.errInviteLinkInvalid/)
  })

  it('tells them to ask for a new invitation rather than to sign in again', () => {
    const en = i18n.slice(i18n.indexOf('errInviteLinkInvalid'))
    assert.match(en.slice(0, 300), /new invitation/i)
    assert.doesNotMatch(en.slice(0, 300), /sign in again/i)
  })

  it('carries both languages', () => {
    const occurrences = i18n.split('errInviteLinkInvalid').length - 1
    assert.equal(occurrences, 2, 'exactly one English and one Spanish entry')
    assert.match(i18n, /errInviteLinkInvalid: 'Este enlace de invitación/)
  })

  it('does not disturb the surrounding error vocabulary', () => {
    for (const code of [
      'not_authorized',
      'account_disabled',
      'account_not_activated',
      'no_platform_access',
      'module_not_granted',
      'administrator_required',
    ]) {
      assert.match(login, new RegExp(`case '${code}':`), `${code} must still be mapped`)
    }
  })
})
