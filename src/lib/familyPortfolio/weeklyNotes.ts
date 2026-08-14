// R13.R2C §§ 8-12 — the Weekly Notes domain rules.
//
// PURE MODULE. No Next.js, Supabase, environment or filesystem import — the
// standing convention for anything the node test runner loads directly.
//
// WHY THESE RULES DO NOT LIVE IN `publication.ts`. A weekly note is not part of
// the publication lifecycle: it neither gates a publish nor participates in the
// revision chain. `normalizeCommentary` next door governs the ONE commentary
// DOCUMENT per (publication, scope); this governs a LIST of independent note
// items. Sharing a validator would quietly couple two models the R13.R2C audit
// deliberately kept apart.
//
// MAIN ONLY IS A PRODUCT RULE (§ 7). The owner wants notes on the Main
// portfolio and explicitly does not want them invented for the personal scopes
// to make a layout symmetrical. The rule is enforced HERE, once, so the read
// path, the write path and the print composition cannot disagree about it. The
// table's own scope CHECK is deliberately wider — widening the product later is
// then a one-line change here rather than a migration.

/** Mirrors the table's `length(body) <= 4000` CHECK exactly. */
export const MAX_WEEKLY_NOTE_LENGTH = 4000

/** The scopes that carry Weekly Notes as a product. */
export const NOTE_SCOPES: readonly string[] = ['main']

export function scopeHasWeeklyNotes(scope: string): boolean {
  return NOTE_SCOPES.includes(scope)
}

/**
 * R13.R2 PASS 4 § 1 — "the table is not there yet" is a DIFFERENT ANSWER from
 * "the write failed".
 *
 * `20260813000000_family_portfolio_weekly_notes.sql` is written but deliberately
 * unapplied during owner review, so every read and every write to that table
 * fails at the database. Flattening that into a generic failure produced the two
 * dishonest states the owner hit: a read that reported an EMPTY WEEK (so the
 * panel said "no note has been written"), and a save that reported only "the
 * note could not be saved", with no reason a reader could act on.
 *
 * PostgREST answers `PGRST205` (unknown table in its schema cache) and
 * PostgreSQL answers `42P01` (undefined_table). The message is matched only as a
 * last resort, because an error string is not an API. Nothing here retries,
 * creates, or works around the missing table — it is reported, and the interface
 * says so plainly.
 *
 * Lives in the PURE module rather than the repository so it is directly
 * testable against the real error shape, without loading a Supabase client.
 */
export function isSchemaMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return /could not find the table|relation .* does not exist/i.test(message)
}

/**
 * R13.R2 PASS 4 § 1 — HTTP status for a Weekly Notes persistence failure.
 *
 * `schema_missing` is deliberately a 503 beside `not_configured`, not a 500:
 * the request was valid and the caller was authorized — the SERVICE cannot
 * accept notes yet because `20260813000000_family_portfolio_weekly_notes.sql`
 * has not been applied. A 500 would read as "something broke", which is exactly
 * the misdiagnosis this pass removes. The code travels to the client as itself
 * so the panel can name the real blocker.
 */
export function weeklyNoteFailureStatus(code: string): number {
  if (code === 'not_found') return 404
  return code === 'not_configured' || code === 'schema_missing' ? 503 : 500
}

export type WeeklyNoteRejection = 'empty' | 'too_long'

/**
 * Trims and validates a submitted note body.
 *
 * Returns the trimmed text — never the raw input — so trailing whitespace can
 * never be what pushes a body past the limit, and never what makes an
 * "empty-looking" note pass. The database re-applies both bounds in its own
 * CHECK, so this is the early, well-worded gate rather than the only one.
 */
export function normalizeWeeklyNote(
  body: unknown,
): { ok: true; body: string } | { ok: false; code: WeeklyNoteRejection } {
  if (typeof body !== 'string') return { ok: false, code: 'empty' }
  const trimmed = body.trim()
  if (trimmed.length === 0) return { ok: false, code: 'empty' }
  if (trimmed.length > MAX_WEEKLY_NOTE_LENGTH) return { ok: false, code: 'too_long' }
  return { ok: true, body: trimmed }
}

export interface WeeklyNote {
  id: string
  body: string
  displayOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * THE display order, applied identically wherever notes are rendered — the
 * screen, the print sheet, and the tests.
 *
 * `display_order` first, then `created_at`, then `id`. The last key is what
 * makes the order TOTAL: two notes written inside the same clock tick still
 * have exactly one ordering, so the list cannot reshuffle between renders.
 */
export function sortWeeklyNotes(notes: readonly WeeklyNote[]): WeeklyNote[] {
  return [...notes].sort(
    (a, b) =>
      a.displayOrder - b.displayOrder ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/**
 * The `display_order` a NEW note should take: one past the highest in use, so
 * an added note lands at the end of the list rather than colliding with an
 * existing position. Never derived from the array length — a list with a
 * tombstoned note in the middle would then reuse a live note's position.
 */
export function nextDisplayOrder(notes: readonly WeeklyNote[]): number {
  let max = -1
  for (const n of notes) {
    if (Number.isFinite(n.displayOrder) && n.displayOrder > max) max = n.displayOrder
  }
  return max + 1
}
