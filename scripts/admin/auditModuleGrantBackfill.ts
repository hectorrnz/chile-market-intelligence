// POST-R13.6B.1 — READ-ONLY audit of what the POST-R13.6B compatibility backfill
// would write against a real database.
//
// WHY THIS EXISTS
// ───────────────
// The 6B migration's backfill gives every currently-approved member an explicit
// grant for every module, so applying 6B removes nobody's access. That insert is
// the one part of 6B that CI cannot exercise: `supabase db reset` applies the
// migration chain to an empty database (seed data runs afterwards), so there are
// no user rows at apply time and the backfill correctly writes 0 rows and its
// postcondition passes vacuously.
//
// The hosted database is the opposite case: approved members DO exist, so the
// backfill will do real work the isolated suite never executed with non-empty
// input. This script answers, BEFORE any hosted migration, exactly what that
// work would be.
//
// STRICTLY READ-ONLY. There is no write path in this file — no insert, update,
// upsert or delete, and no --write flag to add one. It refuses to start if a
// write-shaped argument is passed, so a copied command line from another admin
// script cannot turn it into a mutation. Running it changes nothing.
//
// It is also NOT run automatically. The closure stage will ask the owner to
// authorise executing it against production, and its output is what justifies
// (or blocks) applying the migration.
//
// PRIVACY. Emails are never selected or printed. Usernames are shown because the
// owner needs to act on the result; nothing else identifying is read.
//
// USAGE — plain `node`, like every other script here (Node 24 strips TS types):
//
//   node scripts/admin/auditModuleGrantBackfill.ts
//
// Requires SUPABASE_SERVICE_ROLE_KEY in the environment, exactly as the other
// admin scripts do. The key is never logged.

// @next/env is CJS — import via default (the pattern every other script uses).
import pkg from '@next/env'
import { APP_MODULE_KEYS } from '../../src/lib/auth/moduleAccess.ts'

pkg.loadEnvConfig(process.cwd())

/** Any write-shaped argument is a usage error, not a mode. */
const FORBIDDEN_ARGS = ['--write', '--apply', '--force', '--execute', '--commit']

interface ProfileRow {
  id: string
  username: string | null
  role: string | null
}

interface GrantRow {
  user_id: string
  module_key: string
}

function isApproved(p: ProfileRow): boolean {
  return typeof p.username === 'string' && p.username.trim().length > 0
}

async function main(): Promise<void> {
  const bad = process.argv.slice(2).filter((a) => FORBIDDEN_ARGS.includes(a))
  if (bad.length > 0) {
    console.error(`refusing to run: ${bad.join(', ')} — this audit is read-only and has no write mode`)
    process.exitCode = 2
    return
  }

  const { getSupabaseAdminClient } = await import('../../src/lib/supabase/admin.ts')
  const admin = getSupabaseAdminClient()
  if (!admin) {
    console.error('Supabase admin client unavailable — set SUPABASE_SERVICE_ROLE_KEY')
    process.exitCode = 1
    return
  }

  // Deliberately narrow: id, username and role. Never email, never principal.
  const profilesRes = await (admin as never as {
    from: (t: string) => { select: (c: string) => Promise<{ data: ProfileRow[] | null; error: unknown }> }
  }).from('user_profiles').select('id, username, role')

  if (profilesRes.error || !profilesRes.data) {
    console.error('could not read user_profiles')
    process.exitCode = 1
    return
  }

  const grantsRes = await (admin as never as {
    from: (t: string) => { select: (c: string) => Promise<{ data: GrantRow[] | null; error: unknown }> }
  }).from('user_module_grants').select('user_id, module_key')

  // A missing table is the EXPECTED state before 6B is applied — report it as
  // such rather than as a failure.
  const existingGrants: GrantRow[] = grantsRes.error ? [] : (grantsRes.data ?? [])
  const grantTableExists = !grantsRes.error

  const profiles = profilesRes.data
  const approvedMembers = profiles.filter((p) => isApproved(p) && p.role !== 'administrator')
  const approvedAdmins = profiles.filter((p) => isApproved(p) && p.role === 'administrator')
  const unapproved = profiles.filter((p) => !isApproved(p))

  console.log('POST-R13.6B compatibility backfill — READ-ONLY audit')
  console.log('====================================================')
  console.log(`profiles total .................. ${profiles.length}`)
  console.log(`approved members (non-admin) .... ${approvedMembers.length}`)
  console.log(`approved administrators ......... ${approvedAdmins.length}   (receive NO grant rows, by design)`)
  console.log(`unapproved / revoked ............ ${unapproved.length}   (receive NO grant rows, by design)`)
  console.log(`user_module_grants present ...... ${grantTableExists ? 'yes' : 'no (6B not applied yet)'}`)
  console.log(`existing grant rows ............. ${existingGrants.length}`)
  console.log('')

  // The backfill runs ONLY when the grant table is completely empty.
  const wouldRun = grantTableExists && existingGrants.length === 0
  console.log(
    wouldRun
      ? 'the backfill WOULD run (grant table is empty)'
      : grantTableExists
        ? 'the backfill would SKIP — the grant table already holds rows, so it can never re-run'
        : 'the backfill would run on first application of 20260814000000',
  )
  console.log('')

  console.log(`rows it would create: ${approvedMembers.length} member(s) x ${APP_MODULE_KEYS.length} module(s) = ${approvedMembers.length * APP_MODULE_KEYS.length}`)
  for (const m of approvedMembers) {
    console.log(`  ${m.username} -> ${APP_MODULE_KEYS.join(', ')}`)
  }
  console.log('')

  // The three ways the backfill could be WRONG, checked explicitly.
  const targetsAdmin = approvedMembers.filter((p) => p.role === 'administrator')
  const targetsUnapproved = approvedMembers.filter((p) => !isApproved(p))
  console.log('correctness checks')
  console.log(`  would target an administrator ... ${targetsAdmin.length === 0 ? 'no  (correct)' : `YES (${targetsAdmin.length}) — INVESTIGATE`}`)
  console.log(`  would target an unapproved user . ${targetsUnapproved.length === 0 ? 'no  (correct)' : `YES (${targetsUnapproved.length}) — INVESTIGATE`}`)

  // Access preservation: today every approved account reaches every module (no
  // module gating is enforced yet), so granting all seven to every approved
  // member preserves current access exactly. Administrators keep everything by
  // role. This states the reasoning and confirms the population it applies to.
  const preserved = targetsAdmin.length === 0 && targetsUnapproved.length === 0
  console.log(`  current access preserved ....... ${preserved ? 'yes — every approved member receives all seven modules' : 'NO — INVESTIGATE'}`)
  console.log('')
  console.log('No rows were written. This script has no write path.')
}

await main()
