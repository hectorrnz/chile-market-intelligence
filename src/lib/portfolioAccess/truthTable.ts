// R13.1 — THE shared authorization truth table.
//
// This is the single specification of Family Portfolio access. It exists in
// exactly two executable places, and this file is the one that proves they
// agree:
//
//   · PostgreSQL — `supabase/migrations/20260806000000_family_portfolio_entitlements.sql`
//     embeds the same table in a `do $$ … $$` postcondition block that calls
//     `public.nmi_portfolio_scopes(...)` for every row and RAISES if a result
//     differs. That block executes inside Postgres when the migration is pushed,
//     so it is real in-database proof, not a static claim.
//
//   · TypeScript — `src/lib/portfolioAccess/entitlements.ts`.
//
// `tests/familyPortfolioEntitlements.test.ts` runs every row against the
// TypeScript implementation AND parses the migration's block to assert the two
// tables are row-for-row identical. A divergence fails the migration at apply
// time and fails the suite at test time.
//
// PURE MODULE — no imports beyond types, so tests can load it directly.

import type { FamilyPortfolioScope } from './entitlements.ts'

export interface TruthTableCase {
  /** Human-readable case name, used in assertion messages. */
  readonly name: string
  /** `null` models a NULL input on the SQL side. */
  readonly isApproved: boolean | null
  readonly isAdministrator: boolean | null
  readonly principal: string | null
  /** Expected scopes, in canonical order. */
  readonly expected: readonly FamilyPortfolioScope[]
}

const ALL: readonly FamilyPortfolioScope[] = [
  'main',
  'jaime',
  'andres',
  'pablo',
  'alternatives',
  'admin',
]

/**
 * Order matters: it is compared positionally against the migration's own table,
 * so the two stay legible side by side during review.
 */
export const ENTITLEMENT_TRUTH_TABLE: readonly TruthTableCase[] = [
  // ── Administrators: every scope, regardless of principal ───────────────────
  { name: 'administrator, null principal', isApproved: true, isAdministrator: true, principal: null, expected: ALL },
  { name: 'administrator, jaime principal', isApproved: true, isAdministrator: true, principal: 'jaime', expected: ALL },
  { name: 'administrator, andres principal', isApproved: true, isAdministrator: true, principal: 'andres', expected: ALL },
  { name: 'administrator, pablo principal', isApproved: true, isAdministrator: true, principal: 'pablo', expected: ALL },

  // ── Family principals: main + own + alternatives, never a sibling ──────────
  { name: 'jaime principal', isApproved: true, isAdministrator: false, principal: 'jaime', expected: ['main', 'jaime', 'alternatives'] },
  { name: 'andres principal', isApproved: true, isAdministrator: false, principal: 'andres', expected: ['main', 'andres', 'alternatives'] },
  { name: 'pablo principal', isApproved: true, isAdministrator: false, principal: 'pablo', expected: ['main', 'pablo', 'alternatives'] },

  // ── Approved but unentitled ───────────────────────────────────────────────
  { name: 'approved non-administrator, null principal', isApproved: true, isAdministrator: false, principal: null, expected: [] },
  { name: 'unknown principal value', isApproved: true, isAdministrator: false, principal: 'nope', expected: [] },
  { name: 'principal "ADMINISTRATOR" (upper) confers nothing', isApproved: true, isAdministrator: false, principal: 'ADMINISTRATOR', expected: [] },
  { name: 'principal "administrator" confers nothing', isApproved: true, isAdministrator: false, principal: 'administrator', expected: [] },

  // ── Unapproved / revoked: approval is the outer gate ──────────────────────
  { name: 'unapproved user, null principal', isApproved: false, isAdministrator: false, principal: null, expected: [] },
  { name: 'unapproved user with a principal', isApproved: false, isAdministrator: false, principal: 'jaime', expected: [] },
  { name: 'revoked administrator with a principal', isApproved: false, isAdministrator: true, principal: 'jaime', expected: [] },
  { name: 'revoked administrator, null principal', isApproved: false, isAdministrator: true, principal: null, expected: [] },

  // ── NULL inputs must not widen access ─────────────────────────────────────
  { name: 'null approval is not approval', isApproved: null, isAdministrator: false, principal: 'jaime', expected: [] },
  { name: 'null administrator flag falls through to the principal', isApproved: true, isAdministrator: null, principal: 'jaime', expected: ['main', 'jaime', 'alternatives'] },
]

/** Scope names that must always be denied when supplied by a caller. */
export const INVALID_SCOPE_INPUTS: readonly unknown[] = [
  'administrator',
  'ADMIN',
  'Main',
  'main ',
  '',
  'jaime;--',
  '*',
  'family',
  null,
  undefined,
  42,
  {},
  ['main'],
]
