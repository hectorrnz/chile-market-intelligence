// R1.5 — Administrator-only user provisioning / revocation.
//
// SERVER-SIDE CLI ONLY. This file lives outside src/app, so it is not part of the
// Next.js router and cannot be reached over HTTP by anyone. It reads the
// service-role key from the existing server environment via the existing
// getSupabaseAdminClient() — no new secret, no new env var, and nothing is ever
// echoed to the terminal.
//
// It exists because public self-registration was removed in R1.5. A usable
// Nevada Market Intelligence account needs TWO records (see
// src/lib/auth/approval.ts):
//
//   1. an `auth.users` row       — Supabase Auth identity, holds the password
//   2. a `user_profiles` row     — `username` (UNIQUE, the approval marker),
//                                  `email` (recovery + username→Auth lookup),
//                                  `display_name`
//
// Creating only the Auth user — e.g. inviting someone from the Supabase
// Dashboard — produces an identity that CANNOT sign in (username resolution
// fails) and is refused a session at /auth/callback. That is the intended
// fail-closed behaviour, and it is why provisioning is scripted rather than
// hand-assembled.
//
// USAGE — plain `node`, exactly like every other script in this repo (Node 24
// strips TypeScript types natively). Deliberately NOT `npx tsx`: `tsx` is not a
// dependency of this project (`npm ls tsx` → empty), so `npx tsx` would silently
// fetch an unpinned package from the network before running an administrative
// command that holds the service-role key. Never introduce that.
//
//   node scripts/admin/provisionUser.ts --username <name> --email <address> \
//        [--display-name "<name>"] [--password-stdin] [--write]
//   node scripts/admin/provisionUser.ts --username <name> --revoke --write
//
//   Dry-run is the DEFAULT: without --write nothing is created or changed.
//   Without --password-stdin a cryptographically random temporary password is
//   generated and printed ONCE, for the administrator to hand over out-of-band.
//   With --password-stdin the password is read from stdin so it never appears in
//   argv or shell history.
//
// SAFETY
//   · never logs a password, a service-role key, or any Supabase URL
//   · validates every input with the same validators the login flow uses
//   · refuses to hijack a username already held by a different user
//   · reports partial creation explicitly (Auth user created / profile written)
//     so a failed run can be finished or cleaned up deliberately
//   · --revoke clears the approval marker; it does NOT delete data
//
// R13.1 — PROVISIONING IS STEP ONE OF TWO FOR A FAMILY MEMBER.
// This script establishes platform access (the approval marker). It deliberately
// does NOT grant Family Portfolio access: a newly provisioned account has
// `portfolio_principal = null` and therefore sees no family portfolio at all —
// the intended fail-closed default. Entitlement is a separate, separately-audited
// administrative step:
//
//   node scripts/admin/assignPortfolioPrincipal.ts \
//        --actor <admin-username> --target <username> --principal <jaime|andres|pablo> --write
//
// Administrative capability itself (`user_profiles.role = 'administrator'`) is
// granted by neither script — it is set deliberately through the service-role
// path, so no command here can elevate anyone. See
// docs/portfolio-r13/05-authorization-and-data-architecture.md § 2.2a.

import { randomBytes } from 'node:crypto'
// @next/env is CJS — import via default (the pattern every other script uses).
import pkg from '@next/env'
import {
  normalizeUsername,
  isValidUsername,
  isValidPassword,
  isValidEmail,
  isValidDisplayName,
} from '../../src/lib/auth/credentials.ts'

// Every ingestion script in this repo loads .env.local the same way. Omitting
// this is a real bug we have shipped before: --write silently ran with no
// credentials and failed with a generic row-count error.
pkg.loadEnvConfig(process.cwd())

interface Args {
  username: string
  email: string
  displayName: string
  revoke: boolean
  write: boolean
  passwordStdin: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    username: normalizeUsername(get('--username') ?? ''),
    email: (get('--email') ?? '').trim().toLowerCase(),
    displayName: (get('--display-name') ?? '').trim(),
    revoke: argv.includes('--revoke'),
    write: argv.includes('--write'),
    passwordStdin: argv.includes('--password-stdin'),
  }
}

/** URL-safe random password. Printed once, never stored or logged elsewhere. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (!isValidUsername(args.username)) {
    fail('--username is required and must be a valid username.')
  }

  const { getSupabaseAdminClient } = await import('../../src/lib/supabase/admin.ts')
  const admin = getSupabaseAdminClient()
  if (!admin) {
    fail('Supabase service-role credentials are not configured in this environment.')
  }

  // Minimal typed views over the two tables. Supabase's generated types exceed
  // TypeScript's instantiation depth on user-scoped tables (the documented
  // workaround used across this codebase).
  const table = admin as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { id: string; username: string | null } | null }>
        }
      }
      upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
      update: (row: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>
      }
    }
  }

  // ── Revocation ──────────────────────────────────────────────────────────────
  if (args.revoke) {
    const { data: existing } = await table
      .from('user_profiles').select('id, username').eq('username', args.username).maybeSingle()
    if (!existing) fail('No approved profile found for that username. Nothing to revoke.')

    console.log(`Revoking approval for username "${args.username}" (profile ${existing.id}).`)
    console.log('This clears the approval marker so sign-in and any future session mint fail.')
    console.log('It does NOT delete portfolios, watchlists, or structured notes.')
    if (!args.write) {
      console.log('\nDRY RUN — pass --write to apply.')
      return
    }

    const { error } = await table.from('user_profiles').update({ username: null }).eq('id', existing.id)
    if (error) fail(`Failed to clear the approval marker: ${error.message}`)

    console.log('\n✓ Approval revoked.')
    console.log('  To revoke an ACTIVE session as well, ban or delete the user in')
    console.log('  Supabase Dashboard → Authentication → Users (this invalidates the')
    console.log('  refresh token immediately; see docs/security_access_control.md).')
    return
  }

  // ── Provisioning ────────────────────────────────────────────────────────────
  if (!isValidEmail(args.email)) {
    fail('--email is required and must be a valid address (used for recovery only).')
  }
  const displayName = args.displayName || args.username
  if (!isValidDisplayName(displayName)) fail('--display-name is not valid.')

  const password = args.passwordStdin ? await readStdin() : generatePassword()
  if (!isValidPassword(password)) {
    fail('The supplied password does not meet the password policy.')
  }

  // Refuse to move a username that already belongs to somebody else.
  const { data: holder } = await table
    .from('user_profiles').select('id, username').eq('username', args.username).maybeSingle()

  console.log('Provisioning plan')
  console.log(`  username      : ${args.username}`)
  console.log(`  display name  : ${displayName}`)
  console.log('  email         : (supplied, not echoed)')
  console.log(`  password      : ${args.passwordStdin ? 'read from stdin' : 'generated (shown once on success)'}`)
  console.log('  records       : auth.users + user_profiles (username/email/display_name)')
  if (holder) console.log(`  NOTE          : an existing profile already holds this username (${holder.id}).`)

  if (!args.write) {
    console.log('\nDRY RUN — pass --write to create the account.')
    return
  }

  // 1. Auth identity. Reuse an existing identity for this email if present, so a
  //    re-run repairs a partially-provisioned account instead of failing.
  let authUserId: string | null = null
  let createdAuthUser = false

  for (let page = 1; page <= 5 && !authUserId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) break
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === args.email)
    if (match) authUserId = match.id
    if (data.users.length < 200) break
  }

  if (authUserId) {
    if (holder && holder.id !== authUserId) {
      fail('That username is already held by a different account. Choose another username.')
    }
    const { error } = await admin.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: true,
      user_metadata: { username: args.username, display_name: displayName },
    })
    if (error) fail(`Failed to update the existing Auth identity: ${error.message}`)
  } else {
    if (holder) {
      fail('That username is already held by a different account. Choose another username.')
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: args.email,
      password,
      email_confirm: true,
      user_metadata: { username: args.username, display_name: displayName },
    })
    if (error || !data?.user) fail(`Failed to create the Auth identity: ${error?.message ?? 'unknown error'}`)
    authUserId = data.user.id
    createdAuthUser = true
  }

  // 2. Approval record. Without this the account cannot sign in at all.
  const { error: profileError } = await table.from('user_profiles').upsert(
    { id: authUserId, username: args.username, email: args.email, display_name: displayName },
    { onConflict: 'id' },
  )

  if (profileError) {
    console.error('\n✗ PARTIAL PROVISIONING')
    console.error(`  Auth identity: ${createdAuthUser ? 'CREATED' : 'updated'} (${authUserId})`)
    console.error('  Approval record: NOT WRITTEN —', profileError.message)
    console.error('  The account cannot sign in yet. Re-run this command to finish it,')
    console.error('  or delete the Auth user in the Supabase Dashboard to roll back.')
    process.exit(1)
  }

  console.log('\n✓ Account provisioned and approved.')
  console.log(`  Auth identity  : ${createdAuthUser ? 'created' : 'updated'} (${authUserId})`)
  console.log('  Approval record: written')
  console.log(`  Sign in at /login with username "${args.username}".`)
  if (!args.passwordStdin) {
    console.log('\n  TEMPORARY PASSWORD (shown once — hand over out-of-band, then have')
    console.log('  the user change it via Forgot password):')
    console.log(`\n    ${password}\n`)
  }
}

main().catch((err: unknown) => {
  // Never surface a stack trace that might carry a connection string.
  console.error('✗ Provisioning failed:', err instanceof Error ? err.message : 'unknown error')
  process.exit(1)
})
