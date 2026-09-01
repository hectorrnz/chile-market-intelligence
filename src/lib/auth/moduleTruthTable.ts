// POST-R13.6B — THE shared module-authorization truth table.
//
// This is the single specification of module access. It exists in exactly two
// executable places, and this file is the one that proves they agree:
//
//   · PostgreSQL — `supabase/migrations/20260814000000_module_entitlements.sql`
//     embeds the same table in a `do $$ … $$` postcondition block that calls
//     `public.nmi_module_allowed(...)` for every row and RAISES if a result
//     differs. That block executes inside Postgres when the migration is applied,
//     so it is real in-database proof, not a static claim.
//
//   · TypeScript — `src/lib/auth/moduleAccess.ts`.
//
// `tests/moduleEntitlements.test.ts` runs every row against the TypeScript
// implementation AND parses the migration's block to assert the two tables are
// row-for-row identical. A divergence fails the migration at apply time and
// fails the suite at test time.
//
// This mirrors `src/lib/portfolioAccess/truthTable.ts` deliberately: one proven
// pattern, applied twice, rather than a second invented one.
//
// PURE MODULE — no imports beyond types, so tests can load it directly.

export interface ModuleTruthTableCase {
  /** Human-readable case name, used in assertion messages. */
  readonly name: string
  /** `null` models a NULL input on the SQL side. */
  readonly isApproved: boolean | null
  readonly isAdministrator: boolean | null
  /** Whether an explicit `user_module_grants` row exists for this module. */
  readonly hasGrant: boolean | null
  /** Whether the requested module is a declared `app_modules` key. */
  readonly moduleKnown: boolean | null
  readonly expected: boolean
}

/**
 * Order matters: it is compared positionally against the migration's own table,
 * so the two stay legible side by side during review.
 *
 * The four inputs are deliberately the DECIDED facts, not raw strings: whether a
 * grant row exists, and whether the module is declared. Both sides resolve those
 * facts the same way — TypeScript through `isModuleKey` + array membership,
 * PostgreSQL through a foreign key and an `exists` lookup — and this table then
 * pins the rule that combines them.
 */
export const MODULE_TRUTH_TABLE: readonly ModuleTruthTableCase[] = [
  // ── Administrators hold every declared module by role, grant or not ───────
  { name: 'administrator, no grant row, known module', isApproved: true, isAdministrator: true, hasGrant: false, moduleKnown: true, expected: true },
  { name: 'administrator, grant row present, known module', isApproved: true, isAdministrator: true, hasGrant: true, moduleKnown: true, expected: true },
  // …but never an undeclared one. Role is not a wildcard over unknown keys.
  { name: 'administrator, unknown module', isApproved: true, isAdministrator: true, hasGrant: false, moduleKnown: false, expected: false },
  { name: 'administrator, unknown module even with a grant row', isApproved: true, isAdministrator: true, hasGrant: true, moduleKnown: false, expected: false },

  // ── Members require an EXPLICIT grant row ─────────────────────────────────
  { name: 'member with an explicit grant', isApproved: true, isAdministrator: false, hasGrant: true, moduleKnown: true, expected: true },
  { name: 'member with no grant row is denied', isApproved: true, isAdministrator: false, hasGrant: false, moduleKnown: true, expected: false },
  { name: 'member, unknown module, no grant', isApproved: true, isAdministrator: false, hasGrant: false, moduleKnown: false, expected: false },
  { name: 'member, unknown module, grant row present', isApproved: true, isAdministrator: false, hasGrant: true, moduleKnown: false, expected: false },

  // ── Approval is the outer gate, exactly as in the Portfolio ceiling ───────
  { name: 'unapproved member with a grant', isApproved: false, isAdministrator: false, hasGrant: true, moduleKnown: true, expected: false },
  { name: 'unapproved member without a grant', isApproved: false, isAdministrator: false, hasGrant: false, moduleKnown: true, expected: false },
  { name: 'revoked administrator with a grant', isApproved: false, isAdministrator: true, hasGrant: true, moduleKnown: true, expected: false },
  { name: 'revoked administrator without a grant', isApproved: false, isAdministrator: true, hasGrant: false, moduleKnown: true, expected: false },

  // ── NULL inputs must not widen access ────────────────────────────────────
  { name: 'null approval is not approval', isApproved: null, isAdministrator: false, hasGrant: true, moduleKnown: true, expected: false },
  { name: 'null approval does not save an administrator', isApproved: null, isAdministrator: true, hasGrant: true, moduleKnown: true, expected: false },
  { name: 'null administrator flag falls through to the grant', isApproved: true, isAdministrator: null, hasGrant: true, moduleKnown: true, expected: true },
  { name: 'null administrator flag with no grant is denied', isApproved: true, isAdministrator: null, hasGrant: false, moduleKnown: true, expected: false },
  { name: 'null grant flag is not a grant', isApproved: true, isAdministrator: false, hasGrant: null, moduleKnown: true, expected: false },
  { name: 'null module-known flag is not a declared module', isApproved: true, isAdministrator: false, hasGrant: true, moduleKnown: null, expected: false },
]

/**
 * Module names that must always be denied when supplied by a caller.
 *
 * The first four are the load-bearing ones: `main`, `jaime`, `andres` and
 * `pablo` are Portfolio SCOPES, never module keys. If any of them ever resolved
 * as a module, a grant row could name another family member's portfolio — the
 * exact crossing the ceiling exists to prevent. They are unrepresentable in the
 * database (no `app_modules` row to reference), and denied here too.
 */
export const INVALID_MODULE_INPUTS: readonly unknown[] = [
  'main',
  'jaime',
  'andres',
  'pablo',
  'admin',
  'portfolio_admin',
  'notification_recipients',
  'overview',
  'settings',
  'news',
  'watchlist',
  'MARKETS',
  'Markets',
  'markets ',
  'structured-notes',
  '',
  '*',
  'markets;--',
  null,
  undefined,
  42,
  {},
  ['markets'],
]
