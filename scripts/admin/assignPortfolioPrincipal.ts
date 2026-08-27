// R13.1 — Administrator-only Family Portfolio principal assignment.
//
// SERVER-SIDE CLI ONLY. This file lives outside src/app, so it is not part of
// the Next.js router and cannot be reached over HTTP by anyone — the same
// property that makes scripts/admin/provisionUser.ts safe. It extends that
// existing administrative workflow rather than creating a parallel
// user-management system.
//
// WHY A CLI AND NOT AN API ROUTE
//   · 20260730000000 revoked every write privilege on `user_profiles` from
//     `authenticated`, so a legitimate assignment must use the service-role
//     client — and a service-role write must never sit behind an HTTP handler
//     in this app.
//   · tests/accessControl.test.ts enforces that NO file under src/ writes
//     `user_profiles`. R13.1 keeps that invariant exactly as it is.
//
// The decision rules are pure and live in
// src/lib/portfolioAccess/principalAssignment.ts, where they are executed
// directly by tests. This file is only the I/O around them.
//
// USAGE — plain `node`, exactly like every other script in this repo (Node 24
// strips TypeScript types natively). Deliberately NOT `npx tsx`, which would
// fetch an unpinned package from the network before running an administrative
// command holding the service-role key.
//
//   node scripts/admin/assignPortfolioPrincipal.ts \
//        --actor <admin-username> --target <username> --principal jaime [--write]
//   node scripts/admin/assignPortfolioPrincipal.ts \
//        --actor <admin-username> --target <username> --clear [--write]
//   node scripts/admin/assignPortfolioPrincipal.ts --list
//
//   Dry-run is the DEFAULT: without --write nothing is changed.
//
// SAFETY
//   · never logs a password, a service-role key, a Supabase URL, or an email
//   · the ACTOR must be an approved administrator in the database — possessing
//     the key is not by itself treated as an identity, because the audit trail
//     must name a real person
//   · refuses self-assignment
//   · writes ONLY `portfolio_principal`; there is no code path here that writes
//     `role`, so this command can never elevate anyone
//   · every applied change writes an immutable audit row

// @next/env is CJS — import via default (the pattern every other script uses).
import pkg from '@next/env'
import {
  decidePrincipalAssignment,
  buildAccessAuditEntry,
} from '../../src/lib/portfolioAccess/principalAssignment.ts'
import { PORTFOLIO_PRINCIPALS, isPortfolioPrincipal } from '../../src/lib/portfolioAccess/entitlements.ts'
import { normalizeUsername } from '../../src/lib/auth/credentials.ts'

// Every ingestion script in this repo loads .env.local the same way. Omitting
// this is a real bug we have shipped before: --write silently ran with no
// credentials and failed with a generic row-count error.
pkg.loadEnvConfig(process.cwd())

interface Args {
  actor: string
  target: string
  principal: string | null
  clear: boolean
  list: boolean
  write: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { actor: '', target: '', principal: null, clear: false, list: false, write: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--actor') out.actor = argv[++i] ?? ''
    else if (a === '--target') out.target = argv[++i] ?? ''
    else if (a === '--principal') out.principal = argv[++i] ?? ''
    else if (a === '--clear') out.clear = true
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

  // Imported lazily so `--help`-style misuse never constructs an admin client.
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
    display_name: string | null
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
      // `object`, not Record<string, unknown>: an interface (AccessAuditEntry)
      // has no implicit index signature, so Record<> would reject it.
      insert: (v: object) => Promise<{ error: { message: string } | null }>
    }
  }

  const PROFILE_COLS = 'id, username, role, portfolio_principal, display_name'

  // ── --list : show current entitlements. Reads only; prints no email. ────────
  if (args.list) {
    const { data, error } = await db.from('user_profiles').select(PROFILE_COLS).order('username')
    if (error) fail(`Could not read user_profiles: ${error.message}`)
    console.log('username             role           portfolio_principal')
    console.log('───────────────────  ─────────────  ───────────────────')
    for (const r of data ?? []) {
      console.log(
        `${(r.username ?? '(none)').padEnd(19)}  ${(r.role ?? 'user').padEnd(13)}  ${r.portfolio_principal ?? '(none)'}`,
      )
    }
    return
  }

  if (!args.actor) fail('--actor <admin-username> is required, so the audit trail names a real administrator.')
  if (!args.target) fail('--target <username> is required.')
  if (!args.clear && args.principal === null) {
    fail(`Provide --principal <${PORTFOLIO_PRINCIPALS.join('|')}> or --clear.`)
  }
  if (args.clear && args.principal !== null) fail('--principal and --clear are mutually exclusive.')
  if (!args.clear && !isPortfolioPrincipal(args.principal)) {
    fail(`Invalid principal "${args.principal}". Valid values: ${PORTFOLIO_PRINCIPALS.join(', ')}. ` +
      `"administrator" is a ROLE, not a principal, and is deliberately not accepted.`)
  }

  const actorUsername = normalizeUsername(args.actor)
  const targetUsername = normalizeUsername(args.target)

  const { data: actorRow, error: actorErr } = await db
    .from('user_profiles').select(PROFILE_COLS).eq('username', actorUsername).maybeSingle()
  if (actorErr) fail(`Could not read the acting administrator: ${actorErr.message}`)

  const { data: targetRow, error: targetErr } = await db
    .from('user_profiles').select(PROFILE_COLS).eq('username', targetUsername).maybeSingle()
  if (targetErr) fail(`Could not read the target user: ${targetErr.message}`)

  const decision = decidePrincipalAssignment({
    actor: {
      userId: actorRow?.id ?? null,
      isApproved: (actorRow?.username ?? '').trim().length > 0,
      isAdministrator: actorRow?.role === 'administrator',
    },
    targetUserId: targetRow?.id ?? null,
    targetExists: Boolean(targetRow),
    currentPrincipal: targetRow?.portfolio_principal ?? null,
    requestedPrincipal: args.clear ? null : args.principal,
  })

  if (!decision.allowed) {
    const explain: Record<string, string> = {
      actor_unknown: `No account matches --actor "${actorUsername}".`,
      actor_not_approved: `--actor "${actorUsername}" is not an approved account.`,
      actor_not_administrator: `--actor "${actorUsername}" is not an administrator. Assignments are administrator-only.`,
      invalid_target: `No account matches --target "${targetUsername}".`,
      target_not_found: `No account matches --target "${targetUsername}".`,
      invalid_principal: 'The requested principal is not a valid value.',
      self_assignment_forbidden:
        'An administrator may not assign or clear their own portfolio principal. Ask another administrator.',
    }
    fail(explain[decision.code] ?? `Refused: ${decision.code}`)
  }

  const from = decision.previousValue ?? '(none)'
  const to = decision.newValue ?? '(none)'

  if (!decision.changed) {
    console.log(`• ${targetUsername} already has portfolio_principal = ${to}. Nothing to do.`)
    return
  }

  console.log(`${args.write ? '→' : '(dry run)'} ${targetUsername}: portfolio_principal ${from} → ${to}`)
  console.log(`   actor: ${actorUsername}`)

  if (!args.write) {
    console.log('\nNothing was changed. Re-run with --write to apply.')
    return
  }

  const { error: updateError } = await db
    .from('user_profiles')
    .update({ portfolio_principal: decision.newValue })
    .eq('id', decision.targetUserId)
  if (updateError) fail(`Update failed: ${updateError.message}`)

  const entry = buildAccessAuditEntry(decision, actorRow!.id)
  if (entry) {
    const { error: auditError } = await db.from('family_portfolio_access_audit').insert(entry)
    if (auditError) {
      fail(
        `The principal was changed but the audit row FAILED to write: ${auditError.message}. ` +
          `Re-check state with --list and record this change manually.`,
      )
    }
  }

  console.log('✔ Applied and audited.')
}

main().catch((e) => {
  // Never echo a raw error object: it can carry connection details.
  fail(e instanceof Error ? e.message : 'Unexpected failure.')
})
