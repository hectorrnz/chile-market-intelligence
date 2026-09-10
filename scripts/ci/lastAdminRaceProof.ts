// D0C - PROOF THAT THE LAST-ADMINISTRATOR GUARD SERIALISES, RUN AGAINST REAL
// POSTGRESQL WITH TWO GENUINELY SEPARATE BACKENDS.
//
// WHY THIS IS NOT A pgTAP TEST
// ----------------------------
// pgTAP runs one session inside one transaction that is rolled back at the end.
// A write skew is, by definition, a property of TWO transactions that cannot see
// each other, so a single-session suite can express every SEQUENTIAL last-admin
// case - and `user_lifecycle_test.sql` does - while being structurally unable to
// express the one that actually broke. This script opens two real connections and
// interleaves them.
//
// WHAT IT PROVES, IN THIS ORDER
// -----------------------------
//   A. CONTROL. With the PRE-D0C guard reinstalled - the same body, minus the one
//      lock statement - the interleaving below leaves ZERO active administrators.
//      If this phase does NOT reproduce the defect, the whole proof is vacuous
//      and the script fails rather than reporting a green it did not earn.
//   B. FIXED. With the shipped D0C guard, the identical interleaving leaves
//      EXACTLY ONE active administrator: one transaction commits and the other is
//      refused with the ordinary `last_administrator` token.
//   C. Two DIFFERENT removal kinds racing each other - a demote against a disable
//      - are serialised just the same, because the lock is keyed on the
//      population and not on the operation.
//   D. Harmless concurrent edits do not queue behind the lock and do not trip the
//      guard.
//   E. Promoting one account while demoting another is safe in both orders.
//   F. The lock is transaction-scoped: nothing is left held once the run ends.
//
// THE INTERLEAVING
// ----------------
//   t=0.0  T1  begin; update A (guard runs); ... holds the transaction open
//   t=1.5  T2  begin; update B (guard runs)
//   t=4.0  T1  commit
//          T2  commit
//
// Under the pre-D0C guard, T2's count at t=1.5 cannot see T1's uncommitted
// demotion, so it observes A as an active administrator and allows the removal of
// the only other one. Under D0C, T2 blocks on the population lock at t=1.5,
// resumes when T1 commits at t=4.0, re-counts against a fresh snapshot, and
// refuses.
//
// HERMETIC. Reads its connection string from `supabase status -o json`, which
// describes the disposable local stack the workflow started. It contains no
// production URL, no production key and no secret of any kind, and it refuses to
// run against anything that is not a local loopback database.

import { execFileSync, spawn } from 'node:child_process'

const ADMIN_A = 'd0c11111-1111-1111-1111-111111111111'
const ADMIN_B = 'd0c22222-2222-2222-2222-222222222222'
const MEMBER_C = 'd0c33333-3333-3333-3333-333333333333'

/** Seconds T1 holds its transaction open, and when T2 makes its attempt. */
const T1_HOLD_SECONDS = 4
const T2_START_SECONDS = 1.5

const MIGRATION = 'supabase/migrations/20260824000000_last_administrator_serialization.sql'

let failures = 0
let checks = 0

function check(ok: boolean, label: string, detail = ''): void {
  checks++
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
// Reaching the disposable database
// ---------------------------------------------------------------------------

function localDbUrl(): string {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  const status = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<string, unknown>
  const url = status.DB_URL
  if (typeof url !== 'string' || !url) {
    throw new Error('`supabase status -o json` exposed no DB_URL')
  }
  // A hard refusal to point this at anything but the local stack. The script
  // creates and destroys administrator rows; it must never be able to do that
  // anywhere real, however it is invoked.
  if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)) {
    throw new Error('DB_URL is not a local loopback database - refusing to run')
  }
  return url
}

interface Psql {
  readonly argv: readonly string[]
  readonly how: string
}

/**
 * `psql` on the runner if it is installed, otherwise the one inside the stack's
 * own database container. Both reach the same PostgreSQL; only the path differs.
 */
function resolvePsql(url: string): Psql {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' })
    return { argv: ['psql', url], how: 'psql on the runner' }
  } catch {
    const names = execFileSync('docker', ['ps', '--filter', 'name=supabase_db', '--format', '{{.Names}}'], {
      encoding: 'utf8',
    })
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
    if (names.length === 0) throw new Error('no psql on PATH and no supabase_db container found')
    return {
      argv: ['docker', 'exec', '-i', names[0], 'psql', 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'],
      how: `psql inside ${names[0]}`,
    }
  }
}

interface RunResult {
  readonly ok: boolean
  readonly stdout: string
  readonly stderr: string
}

/** Runs a script to completion, synchronously. Used for setup and assertions. */
function sql(psql: Psql, script: string): RunResult {
  const [cmd, ...rest] = psql.argv
  try {
    const stdout = execFileSync(cmd, [...rest, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], {
      input: script,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { ok: true, stdout: stdout.trim(), stderr: '' }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string }
    return { ok: false, stdout: (err.stdout ?? '').trim(), stderr: (err.stderr ?? '').trim() }
  }
}

/** Starts a script and resolves when it finishes. Used for the racing halves. */
function sqlAsync(psql: Psql, script: string): Promise<RunResult> {
  const [cmd, ...rest] = psql.argv
  return new Promise((resolve) => {
    const child = spawn(cmd, [...rest, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('close', (code) => resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.stdin.end(script)
  })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CREATE_IDENTITIES = `
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), now()
from (values
  ('${ADMIN_A}'::uuid, 'd0c_admin_a@test.invalid'),
  ('${ADMIN_B}'::uuid, 'd0c_admin_b@test.invalid'),
  ('${MEMBER_C}'::uuid, 'd0c_member_c@test.invalid')
) as u(id, email)
on conflict (id) do nothing;
`

/**
 * Puts the world back to exactly two active administrators and one member.
 *
 * DELIBERATELY NOT delete-then-insert. Deleting both administrators is exactly
 * the thing the guard exists to refuse, so a reset built that way would be
 * blocked by the feature under test the second time it ran. Restoring an account
 * INTO the administrator set is never refused, so the reset promotes first and
 * only then demotes the member - an order in which no step can ever empty the
 * set. The insert is separate because INSERT does not fire the guard at all.
 */
const RESET_FIXTURES = `
insert into public.user_profiles
  (id, username, email, display_name, role, portfolio_principal, invited_at, activated_at, disabled_at) values
  ('${ADMIN_A}', 'd0c_admin_a', 'd0c_admin_a@test.invalid', 'D0C Admin A', 'administrator', null, null, now(), null),
  ('${ADMIN_B}', 'd0c_admin_b', 'd0c_admin_b@test.invalid', 'D0C Admin B', 'administrator', null, null, now(), null),
  ('${MEMBER_C}', 'd0c_member_c', 'd0c_member_c@test.invalid', 'D0C Member C', 'user', null, null, now(), null)
on conflict (id) do nothing;

update public.user_profiles
   set role = 'administrator', username = 'd0c_admin_a', activated_at = now(), disabled_at = null
 where id = '${ADMIN_A}';
update public.user_profiles
   set role = 'administrator', username = 'd0c_admin_b', activated_at = now(), disabled_at = null
 where id = '${ADMIN_B}';
update public.user_profiles
   set role = 'user', username = 'd0c_member_c', activated_at = now(), disabled_at = null
 where id = '${MEMBER_C}';
`

/**
 * The count this whole stage exists to keep above zero, expressed with the SAME
 * predicate the guard uses rather than a simplified re-statement of it.
 *
 * Deliberately GLOBAL rather than scoped to the fixtures: the guard counts every
 * administrator in the table, so a proof that counted only its own rows would
 * report a healthy population the guard itself would disagree with.
 */
const COUNT_ACTIVE_ADMINS = `
select count(*) from public.user_profiles p
where p.role = 'administrator'
  and public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at);
`

/**
 * ISOLATION, AND WHY THE PROOF IS WORTHLESS WITHOUT IT.
 *
 * Earlier steps in this workflow commit their own rows into `user_profiles`, and
 * at least one of them is an active administrator. The guard counts the WHOLE
 * table, so with a third administrator present neither racing transaction is ever
 * removing the last one — both are legitimately allowed, no refusal is expected,
 * and every assertion below would pass or fail for reasons that have nothing to
 * do with serialisation. The first run of this script proved exactly that: the
 * control committed both demotions and still left an administrator standing.
 *
 * So the population under test is reduced to the two fixtures. This runs AFTER
 * they are inserted, which is what makes it legal: demoting the leftovers is
 * permitted precisely because A and B already exist to take their place.
 */
const NEUTRALISE_OTHER_ADMINS = `
update public.user_profiles set role = 'user'
 where role = 'administrator'
   and id not in ('${ADMIN_A}', '${ADMIN_B}');
`

/**
 * The PRE-D0C guard, restored verbatim from 20260817000000 apart from the single
 * `perform public.nmi_lock_administrator_population();` line D0C added. This is
 * the control, and installing it is what makes the proof non-vacuous.
 */
const UNSERIALISED_GUARD = `
create or replace function public.nmi_guard_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_was_active_admin boolean;
  v_is_active_admin  boolean;
  v_others           integer;
begin
  v_was_active_admin :=
    old.role = 'administrator'
    and public.nmi_profile_usable(old.username::text, old.activated_at, old.disabled_at);
  if not v_was_active_admin then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    v_is_active_admin := false;
  else
    v_is_active_admin :=
      new.role = 'administrator'
      and public.nmi_profile_usable(new.username::text, new.activated_at, new.disabled_at);
  end if;
  if v_is_active_admin then
    return new;
  end if;
  select count(*) into v_others
  from public.user_profiles p
  where p.id <> old.id
    and p.role = 'administrator'
    and public.nmi_profile_usable(p.username::text, p.activated_at, p.disabled_at);
  if v_others = 0 then
    raise exception 'last_administrator'
      using errcode = 'raise_exception';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $fn$;
`

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

function removalScript(holdSeconds: number, startDelay: number, statement: string): string {
  const wait = startDelay > 0 ? `select pg_sleep(${startDelay});\n` : ''
  const hold = holdSeconds > 0 ? `select pg_sleep(${holdSeconds});\n` : ''
  return `${wait}begin;\n${statement}\n${hold}commit;\n`
}

interface RaceOutcome {
  readonly t1: RunResult
  readonly t2: RunResult
  readonly activeAdmins: number
  readonly committed: number
  readonly refused: number
}

async function race(psql: Psql, t1Statement: string, t2Statement: string): Promise<RaceOutcome> {
  const reset = sql(psql, RESET_FIXTURES)
  if (!reset.ok) throw new Error(`fixture reset failed, the race would prove nothing: ${reset.stderr}`)
  const [t1, t2] = await Promise.all([
    sqlAsync(psql, removalScript(T1_HOLD_SECONDS, 0, t1Statement)),
    sqlAsync(psql, removalScript(0, T2_START_SECONDS, t2Statement)),
  ])
  const counted = sql(psql, COUNT_ACTIVE_ADMINS)
  const activeAdmins = Number.parseInt(counted.stdout, 10)
  return {
    t1,
    t2,
    activeAdmins,
    committed: [t1, t2].filter((r) => r.ok).length,
    refused: [t1, t2].filter((r) => !r.ok && /last_administrator/.test(r.stderr)).length,
  }
}

const DEMOTE_A = `update public.user_profiles set role = 'user' where id = '${ADMIN_A}';`
const DEMOTE_B = `update public.user_profiles set role = 'user' where id = '${ADMIN_B}';`
const DISABLE_B = `update public.user_profiles set disabled_at = now() where id = '${ADMIN_B}';`

async function main(): Promise<void> {
  const url = localDbUrl()
  const psql = resolvePsql(url)
  console.log(`D0C last-administrator race proof - ${psql.how}\n`)

  const identities = sql(psql, CREATE_IDENTITIES)
  if (!identities.ok) throw new Error(`could not create the fixture identities: ${identities.stderr}`)

  const seeded = sql(psql, RESET_FIXTURES)
  if (!seeded.ok) throw new Error(`could not seed the fixtures: ${seeded.stderr}`)

  const neutralised = sql(psql, NEUTRALISE_OTHER_ADMINS)
  if (!neutralised.ok) throw new Error(`could not isolate the population: ${neutralised.stderr}`)

  // Asserted, not assumed. If a later change to this workflow leaves another
  // administrator behind, this fails loudly here rather than quietly turning
  // every assertion below into a test of nothing.
  const baseline = Number.parseInt(sql(psql, COUNT_ACTIVE_ADMINS).stdout, 10)
  check(
    baseline === 2,
    'the population under test is exactly the two fixture administrators',
    `activeAdmins=${baseline}; another step in this workflow left an administrator behind`,
  )
  if (baseline !== 2) {
    console.error('cannot prove anything about a last-administrator rule without knowing who the administrators are')
    process.exit(1)
  }
  console.log('')

  // -- A . CONTROL ---------------------------------------------------------
  console.log('A . control: the PRE-D0C guard permits the write skew')
  const installed = sql(psql, UNSERIALISED_GUARD)
  check(installed.ok, 'the unserialised guard is installed for the control', installed.stderr)
  const control = await race(psql, DEMOTE_A, DEMOTE_B)
  check(
    control.committed === 2,
    'both concurrent demotions commit under the old guard',
    `committed=${control.committed} t1=${control.t1.stderr} t2=${control.t2.stderr}`,
  )
  check(
    control.activeAdmins === 0,
    'the old guard leaves ZERO active administrators - the defect is real',
    `activeAdmins=${control.activeAdmins}`,
  )
  if (control.activeAdmins !== 0) {
    console.error(
      '\nThe control did not reproduce the race, so nothing below would mean anything.\n' +
        'Either the timing window is too narrow on this runner, or the guard being\n' +
        'restored is no longer the pre-D0C one. Failing rather than reporting green.',
    )
  }

  // -- restore the shipped guard by re-applying the migration itself --------
  console.log('\n    restoring the shipped D0C guard by re-applying the migration')
  const [cmd, ...rest] = psql.argv
  let restored = false
  let restoreErr = ''
  try {
    execFileSync(cmd, [...rest, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', MIGRATION], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    restored = true
  } catch (e) {
    restoreErr = String((e as { stderr?: string }).stderr ?? e)
  }
  check(restored, 'the D0C migration re-applies cleanly, postconditions included', restoreErr)
  if (!restored) {
    console.error('cannot continue without the shipped guard')
    process.exit(1)
  }

  // -- B . FIXED -----------------------------------------------------------
  console.log('\nB . the D0C guard serialises the same interleaving')
  const fixed = await race(psql, DEMOTE_A, DEMOTE_B)
  check(fixed.activeAdmins === 1, 'exactly one active administrator survives', `activeAdmins=${fixed.activeAdmins}`)
  check(fixed.committed === 1, 'exactly one transaction commits', `committed=${fixed.committed}`)
  check(
    fixed.refused === 1,
    'the other is refused with the ordinary last_administrator token',
    `refused=${fixed.refused} t1=${fixed.t1.stderr} t2=${fixed.t2.stderr}`,
  )

  // -- C . TWO DIFFERENT REMOVAL KINDS -------------------------------------
  console.log('\nC . a demote racing a disable is serialised just the same')
  const mixed = await race(psql, DEMOTE_A, DISABLE_B)
  check(mixed.activeAdmins === 1, 'exactly one active administrator survives', `activeAdmins=${mixed.activeAdmins}`)
  check(mixed.refused === 1, 'the loser is refused with last_administrator', `refused=${mixed.refused}`)

  // -- D . HARMLESS EDITS ARE NOT SERIALISED OR REFUSED ---------------------
  console.log('\nD . harmless concurrent edits neither queue nor trip the guard')
  const benign = await race(
    psql,
    `update public.user_profiles set display_name = 'A renamed' where id = '${ADMIN_A}';`,
    `update public.user_profiles set display_name = 'C renamed' where id = '${MEMBER_C}';`,
  )
  check(benign.committed === 2, 'both edits commit', `committed=${benign.committed}`)
  check(benign.activeAdmins === 2, 'both administrators are untouched', `activeAdmins=${benign.activeAdmins}`)

  // A rename of an administrator must not wait on the population lock. T1 holds
  // the lock for the whole hold window while removing an administrator; if the
  // rename queued behind it, this would take at least that long.
  console.log('\n    and a rename does not wait on the population lock')
  sql(psql, RESET_FIXTURES)
  const started = Date.now()
  // Timed INDIVIDUALLY, not through Promise.all. Awaiting the pair would measure
  // whichever finished last, which is the removal by construction - the first
  // version of this check did exactly that and reported the rename taking 4.06s
  // when it had in fact finished seconds earlier.
  const removal = sqlAsync(psql, removalScript(T1_HOLD_SECONDS, 0, DEMOTE_A))
  const renamed = await sqlAsync(
    psql,
    removalScript(0, T2_START_SECONDS, `update public.user_profiles set display_name = 'B renamed' where id = '${ADMIN_B}';`),
  )
  const renameFinishedAt = (Date.now() - started) / 1000
  await removal
  check(renamed.ok, 'the administrator rename commits', renamed.stderr)
  check(
    renameFinishedAt < T1_HOLD_SECONDS,
    'the rename finished before the removal released the lock, so it never took it',
    `rename finished at ${renameFinishedAt.toFixed(2)}s, removal holds until ${T1_HOLD_SECONDS}s`,
  )

  // -- E . PROMOTION RACING A REMOVAL ---------------------------------------
  console.log('\nE . promoting one account while demoting another is safe')
  const promote = await race(
    psql,
    DEMOTE_A,
    `update public.user_profiles set role = 'administrator' where id = '${MEMBER_C}';`,
  )
  check(
    promote.activeAdmins >= 1,
    'the population never empties',
    `activeAdmins=${promote.activeAdmins}`,
  )

  // -- F . NOTHING IS LEFT HELD ---------------------------------------------
  // Asked by TAKING the key rather than by counting rows in pg_locks: the local
  // stack's own services hold advisory locks of their own, so a bare count would
  // be measuring Realtime rather than this guard. `pg_try_advisory_xact_lock`
  // answers false if anyone still holds THIS key, and releases immediately.
  console.log('\nF . the lock is transaction-scoped and nothing is stranded')
  const free = sql(
    psql,
    `select pg_try_advisory_xact_lock(hashtext('nmi_administrator_population'), hashtext('active'));`,
  )
  check(
    free.stdout === 't',
    'the population key is free after every committed, refused and aborted transaction',
    `pg_try_advisory_xact_lock returned "${free.stdout}"`,
  )

  // -- G . THE SEQUENTIAL INVARIANTS STILL HOLD -----------------------------
  // pgTAP already covers these, and they are re-proven here because D0C replaced
  // the function body: a serialisation change that quietly weakened an ordinary
  // sequential refusal would be a worse outcome than the race it fixed.
  console.log('\nG . the sequential refusals are unchanged')
  sql(psql, RESET_FIXTURES)

  const firstRemoval = sql(psql, DEMOTE_A)
  check(firstRemoval.ok, 'with two administrators, the FIRST demotion succeeds', firstRemoval.stderr)

  const secondRemoval = sql(psql, DEMOTE_B)
  check(
    !secondRemoval.ok && /last_administrator/.test(secondRemoval.stderr),
    'the SECOND demotion is refused - one administrator always remains',
  )

  const disableLast = sql(psql, DISABLE_B)
  check(
    !disableLast.ok && /last_administrator/.test(disableLast.stderr),
    'disabling the final administrator is refused',
  )

  const deleteLast = sql(psql, `delete from public.user_profiles where id = '${ADMIN_B}';`)
  check(
    !deleteLast.ok && /last_administrator/.test(deleteLast.stderr),
    'deleting the final administrator at table level is refused',
  )

  const unapproveLast = sql(psql, `update public.user_profiles set username = null where id = '${ADMIN_B}';`)
  check(
    !unapproveLast.ok && /last_administrator/.test(unapproveLast.stderr),
    'clearing the final administrator approval is refused',
  )

  // -- cleanup --------------------------------------------------------------
  // Removes everything the guard permits to be removed. ADMIN_B necessarily
  // stays: it is the last administrator, and the four refusals just above are
  // precisely why. The stack is disposable, and no later step reads this table.
  sql(psql, `delete from public.user_profiles where id in ('${ADMIN_A}', '${MEMBER_C}');`)
  sql(psql, `delete from auth.users where id in ('${ADMIN_A}', '${MEMBER_C}');`)

  console.log(`\n${checks - failures}/${checks} checks passed`)
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
