// R13.1.1A — Application-role management, including first-administrator bootstrap.
//
// SERVER-SIDE CLI ONLY. Lives outside src/app, so it is not part of the Next.js
// router and cannot be reached over HTTP by anyone — the same property that makes
// scripts/admin/provisionUser.ts and scripts/admin/assignPortfolioPrincipal.ts
// safe. There is deliberately NO route, server action, or browser control that
// mutates `user_profiles.role`.
//
// WHY THIS EXISTS
//   R13.1 made `user_profiles.role` the application-role authority but shipped no
//   writer for it, which deadlocked the module: every row defaults to 'user',
//   nothing wrote `role`, and assigning a portfolio principal requires an
//   administrator actor — so no administrator could ever exist.
//
// TWO MODES
//   --bootstrap   one-time, service-authorized creation of the FIRST
//                 administrator. Legal ONLY while no approved administrator
//                 exists; the escape hatch closes permanently once one does.
//                 Audited honestly as actor_kind='service_bootstrap' with a NULL
//                 actor_user_id — there is no application identity to name.
//   (default)     ordinary change, requiring an explicitly identified approved
//                 administrator actor (--actor).
//
// USAGE — plain `node`, exactly like every other script in this repo (Node 24
// strips TypeScript types natively). Deliberately NOT `npx tsx`, which would
// fetch an unpinned package from the network before running an administrative
// command holding the service-role key.
//
//   node scripts/admin/setUserRole.ts --list
//   node scripts/admin/setUserRole.ts --bootstrap --target <username> --write
//   node scripts/admin/setUserRole.ts --actor <admin> --target <user> --role administrator --write
//   node scripts/admin/setUserRole.ts --actor <admin> --target <user> --role user --write
//
//   Dry-run is the DEFAULT: without --write nothing is changed.
//
// SAFETY
//   · never logs a password, a service-role key, a Supabase URL, or an email
//   · never hardcodes a username, email, UUID, or production account
//   · never reads role information from browser/session metadata
//   · only 'user' and 'administrator' are accepted; unknown roles are refused
//   · the target must exist AND be approved
//   · an administrator cannot change their own role in either direction
//   · the last approved administrator cannot be demoted
//   · writes ONLY the `role` column — every other profile field is preserved
//   · every applied change writes an immutable audit row
//   · fails closed on every unexpected state

// @next/env is CJS — import via default (the pattern every other script uses).
import pkg from '@next/env'
import {
  decideRoleChange,
  buildRoleAuditEntry,
  isAssignableRole,
  ASSIGNABLE_ROLES,
} from '../../src/lib/portfolioAccess/roleAssignment.ts'
import { normalizeUsername } from '../../src/lib/auth/credentials.ts'

// Every ingestion script in this repo loads .env.local the same way. Omitting
// this is a real bug we have shipped before: --write silently ran with no
// credentials and failed with a generic row-count error.
pkg.loadEnvConfig(process.cwd())

interface Args {
  actor: string
  target: string
  role: string
  bootstrap: boolean
  list: boolean
  write: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { actor: '', target: '', role: '', bootstrap: false, list: false, write: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--actor') out.actor = argv[++i] ?? ''
    else if (a === '--target') out.target = argv[++i] ?? ''
    else if (a === '--role') out.role = argv[++i] ?? ''
    else if (a === '--bootstrap') out.bootstrap = true
    else if (a === '--list') out.list = true
    else if (a === '--write') out.write = true
  }
  return out
}

function fail(message: string): never {
  console.error(`✖ ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const { getSupabaseAdminClient } = await import('../../src/lib/supabase/admin.ts')
  const admin = getSupabaseAdminClient()
  if (!admin) {
    fail('Supabase admin client is not configured. Set the server-side Supabase environment variables in .env.local.')
  }

  type ProfileRow = {
    id: string
    username: string | null
    role: string | null
    portfolio_principal: string | null
  }
  const db = admin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: ProfileRow | null; error: { message: string } | null }>
        }
        order: (c: string) => Promise<{ data: ProfileRow[] | null; error: { message: string } | null }>
      }
      update: (v: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
      }
      insert: (v: object) => Promise<{ error: { message: string } | null }>
    }
  }

  const COLS = 'id, username, role, portfolio_principal'

  // Every profile, read once. The approved-administrator COUNT is the pivot on
  // which bootstrap legality turns, so it is derived from real rows, never from
  // a flag, an env var, or an argument.
  const { data: allRows, error: listError } = await db.from('user_profiles').select(COLS).order('username')
  if (listError) fail(`Could not read user_profiles: ${listError.message}`)

  const rows = allRows ?? []
  const isApproved = (r: ProfileRow) => (r.username ?? '').trim().length > 0
  const approvedAdministrators = rows.filter((r) => r.role === 'administrator' && isApproved(r))

  if (args.list) {
    console.log('username             role           portfolio_principal')
    console.log('───────────────────  ─────────────  ───────────────────')
    for (const r of rows) {
      console.log(
        `${(r.username ?? '(none)').padEnd(19)}  ${(r.role ?? 'user').padEnd(13)}  ${r.portfolio_principal ?? '(none)'}`,
      )
    }
    console.log(`\napproved administrators: ${approvedAdministrators.length}`)
    if (approvedAdministrators.length === 0) {
      console.log('→ no administrator exists yet; bootstrap mode is available:')
      console.log('  node scripts/admin/setUserRole.ts --bootstrap --target <username> --write')
    }
    return
  }

  if (!args.target) fail('--target <username> is required.')
  if (args.bootstrap && args.actor) {
    fail('--bootstrap and --actor are mutually exclusive: a bootstrap has no application administrator actor.')
  }
  if (args.bootstrap && args.role && args.role !== 'administrator') {
    fail('--bootstrap creates an administrator; --role cannot request anything else.')
  }
  const requestedRole = args.bootstrap ? 'administrator' : args.role
  if (!isAssignableRole(requestedRole)) {
    fail(`Invalid --role "${args.role}". Valid values: ${ASSIGNABLE_ROLES.join(', ')}.`)
  }
  if (!args.bootstrap && !args.actor) {
    fail('--actor <admin-username> is required, so the audit trail names a real administrator. ' +
      'Use --bootstrap only when no administrator exists yet.')
  }

  const targetUsername = normalizeUsername(args.target)
  const targetRow = rows.find((r) => (r.username ?? '').toLowerCase() === targetUsername.toLowerCase()) ?? null

  const actorUsername = args.actor ? normalizeUsername(args.actor) : ''
  const actorRow = actorUsername
    ? rows.find((r) => (r.username ?? '').toLowerCase() === actorUsername.toLowerCase()) ?? null
    : null

  const decision = decideRoleChange({
    bootstrapRequested: args.bootstrap,
    approvedAdministratorCount: approvedAdministrators.length,
    actor: args.bootstrap
      ? null
      : {
          userId: actorRow?.id ?? null,
          isApproved: actorRow ? isApproved(actorRow) : false,
          isAdministrator: actorRow?.role === 'administrator',
        },
    targetUserId: targetRow?.id ?? null,
    targetExists: Boolean(targetRow),
    targetIsApproved: targetRow ? isApproved(targetRow) : false,
    targetCurrentRole: targetRow?.role ?? 'user',
    requestedRole,
  })

  if (!decision.allowed) {
    const explain: Record<string, string> = {
      invalid_role: `Invalid role. Valid values: ${ASSIGNABLE_ROLES.join(', ')}.`,
      invalid_target: `No account matches --target "${targetUsername}".`,
      target_not_found: `No account matches --target "${targetUsername}".`,
      target_not_approved:
        `"${targetUsername}" is not an approved account. Provision it first with scripts/admin/provisionUser.ts — ` +
        `an unapproved account must never hold a role.`,
      bootstrap_not_available:
        `Bootstrap is unavailable: ${approvedAdministrators.length} approved administrator(s) already exist. ` +
        `Use --actor <admin-username> --role administrator instead.`,
      bootstrap_required:
        'No approved administrator exists, so there is nobody to act. Run with --bootstrap to create the first one.',
      actor_unknown: `No account matches --actor "${actorUsername}".`,
      actor_not_approved: `--actor "${actorUsername}" is not an approved account.`,
      actor_not_administrator: `--actor "${actorUsername}" is not an administrator. Role changes are administrator-only.`,
      self_role_change_forbidden:
        'An administrator may not change their own role, in either direction. Ask another administrator.',
      last_administrator_protected:
        'Refusing to demote the last approved administrator — that would leave the platform with no way to manage access. ' +
        'Promote another administrator first.',
    }
    fail(explain[decision.code] ?? `Refused: ${decision.code}`)
  }

  if (!decision.changed) {
    console.log(`• ${targetUsername} already has role = ${decision.newValue}. Nothing to do.`)
    return
  }

  console.log(`${args.write ? '→' : '(dry run)'} ${targetUsername}: role ${decision.previousValue} → ${decision.newValue}`)
  console.log(`   authorized as: ${decision.actorKind}${decision.actorKind === 'administrator' ? ` (${actorUsername})` : ' (service-authorized, no application actor)'}`)
  if (decision.actorKind === 'service_bootstrap') {
    console.log('   NOTE: this is the one-time first-administrator bootstrap. It becomes unavailable once applied.')
  }

  if (!args.write) {
    console.log('\nNothing was changed. Re-run with --write to apply.')
    return
  }

  const { error: updateError } = await db
    .from('user_profiles')
    .update({ role: decision.newValue })
    .eq('id', decision.targetUserId)
  if (updateError) fail(`Update failed: ${updateError.message}`)

  const entry = buildRoleAuditEntry(decision, actorRow?.id ?? null)
  if (entry) {
    const { error: auditError } = await db.from('family_portfolio_access_audit').insert(entry)
    if (auditError) {
      fail(
        `The role was changed but the audit row FAILED to write: ${auditError.message}. ` +
          `Re-check state with --list and record this change manually.`,
      )
    }
  }

  console.log('✔ Applied and audited.')
  if (decision.newValue === 'administrator') {
    console.log('\nNext: assign Family Portfolio entitlements with')
    console.log('  node scripts/admin/assignPortfolioPrincipal.ts --actor <admin> --target <user> --principal <jaime|andres|pablo> --write')
  }
}

main().catch((e) => {
  // Never echo a raw error object: it can carry connection details.
  fail(e instanceof Error ? e.message : 'Unexpected failure.')
})
