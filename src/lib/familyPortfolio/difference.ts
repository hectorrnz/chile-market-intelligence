// R13.R2 (defensive consistency repair) — THE one rule for a displayed
// week-over-week Difference.
//
// PURE MODULE, and deliberately the narrowest one in the module: no Next.js,
// Supabase, environment or filesystem import, and nothing about layout. It is
// imported by the pure composition layer (`overview.ts`) AND by a client
// component (`HierarchicalTable.tsx`), so it must stay safe on both sides.
//
// THE CONTRACT (owner-confirmed):
//
//     displayed Difference  =  displayed This Week − displayed Previous Week
//
// The workbook's `Diferencia` column is never a data source — the parser has
// never ingested it (parseResumen.ts § header rule 2, doc 02 § 4), and reads it
// only as a cross-check. The PERSISTED `metadata.difference` is likewise a
// reconciliation artifact: it records what the parser derived at publish time,
// and it may corroborate the displayed arithmetic but may never replace it.
//
// WHY THIS EXISTS AT ALL, given the persisted figure is itself `value − prev`.
// Three surfaces used to render that stored number directly — the Weekly
// Snapshot, the Overview hero, and the Holdings/weekly-close table's Difference
// column — each trusting the writer with no check at the read boundary. Today
// they agree: across all 102 current publications, 17,011 rows carry both
// anchors and every one satisfies the identity exactly (worst relative
// deviation 0). But "the writer is currently correct" is not the same property
// as "the arithmetic on screen is internally consistent", and only the second
// one survives a legacy publication, a manual correction, or a future parser
// change. This module makes the second property structural, and turns any
// disagreement into a VISIBLE reconciliation state instead of a silent
// override.
//
// UNAVAILABLE IS NEVER ZERO (doc 02 § 9). A missing anchor yields a null
// Difference, never 0 — and never the persisted figure standing in for the
// subtraction it can no longer be checked against.

/**
 * Absolute and relative tolerances for every reconciliation comparison in the
 * Family Portfolio module. Declared HERE, once, and imported by `overview.ts`'s
 * allocation residual check, so the two can never drift apart.
 */
export const RECON_ABS_TOLERANCE = 0.01
export const RECON_REL_TOLERANCE = 1e-6

/**
 * `reconciled`     — a persisted figure exists and matches the displayed
 *                    arithmetic within tolerance
 * `mismatch`       — a persisted figure exists and DISAGREES; the displayed
 *                    value is still the arithmetic, and the surface says so
 * `not_comparable` — nothing to compare: either an anchor is unavailable (so
 *                    there is no displayed Difference) or no persisted figure
 *                    was recorded. Deliberately NOT called "unavailable": the
 *                    Difference itself may be perfectly available while the
 *                    cross-check simply is not.
 */
export type DifferenceReconciliation = 'reconciled' | 'mismatch' | 'not_comparable'

export interface ResolvedDifference {
  /** current − previous, from the values ACTUALLY DISPLAYED. Null when either is absent. */
  displayed: number | null
  /** The persisted cross-check figure, retained for audit. NEVER rendered as the Difference. */
  persisted: number | null
  status: DifferenceReconciliation
}

function finite(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** True when two figures agree inside the module's standard tolerance. */
export function agreesWithinTolerance(a: number, b: number): boolean {
  const tolerance = Math.max(RECON_ABS_TOLERANCE, Math.abs(a) * RECON_REL_TOLERANCE)
  return Math.abs(a - b) <= tolerance
}

/**
 * THE shared invariant. Every surface that shows a week-over-week Difference
 * resolves it through this function, so one field can never carry two display
 * semantics.
 *
 *   A. both anchors available        → displayed = current − previous
 *   B. either anchor unavailable     → displayed = null (never 0, never the
 *                                       persisted figure)
 *   C. persisted agrees              → `reconciled`
 *   D. persisted disagrees           → `mismatch` (displayed stays the
 *                                       arithmetic; the surface warns)
 *   E. persisted absent / incomparable → `not_comparable`
 */
export function resolveDisplayedDifference(
  current: number | null | undefined,
  previous: number | null | undefined,
  persisted: number | null | undefined,
): ResolvedDifference {
  const c = finite(current)
  const p = finite(previous)
  const stored = finite(persisted)

  // B — no displayed subtraction is possible. The persisted figure is retained
  // for audit but is NOT promoted to the display, and cannot be checked against
  // anything, so there is no reconciliation verdict to give.
  if (c === null || p === null) {
    return { displayed: null, persisted: stored, status: 'not_comparable' }
  }

  // A — the displayed values are the only inputs.
  const displayed = c - p
  if (!Number.isFinite(displayed)) {
    return { displayed: null, persisted: stored, status: 'not_comparable' }
  }

  // E — nothing recorded to compare against.
  if (stored === null) return { displayed, persisted: null, status: 'not_comparable' }

  // C / D — the arithmetic wins either way; only the verdict changes.
  return {
    displayed,
    persisted: stored,
    status: agreesWithinTolerance(displayed, stored) ? 'reconciled' : 'mismatch',
  }
}
