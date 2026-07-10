// Structured Notes — "called" notice helpers (pure).
//
// The scheduled monitoring cron (src/app/api/cron/structured-notes/snapshot)
// already moves a note to an ARCHIVED status (e.g. 'autocalled') automatically
// the day its autocall observation comes due and the barrier condition is met
// — no user action required. What was missing was surfacing that to the user:
// nothing on the page told them a note moved to Called since they last looked.
//
// These two pure functions back a localStorage-persisted "seen" list
// (per-browser, no new table/migration) on the Structured Notes page: any
// note in an archived status not yet in that list is "newly called" and
// triggers a dismissible banner. `seenIds === null` is the sentinel for "this
// browser has never initialized the list" — on first-ever load every
// already-called note is marked seen with no banner, so deploying this
// feature never floods the user with the book's entire call history.

import type { StructuredNote } from './types.ts'
import { ARCHIVED_STATUSES } from './types.ts'

/** Notes in an archived status (called/matured/cancelled/defaulted) whose id isn't in `seenIds` yet. Returns [] until the seen-list has been initialized (seenIds === null) — never floods on first load. */
export function findNewlyCalledNotes(notes: StructuredNote[], seenIds: string[] | null): StructuredNote[] {
  if (seenIds === null) return []
  const seen = new Set(seenIds)
  return notes.filter((n) => n.id && ARCHIVED_STATUSES.includes(n.status) && !seen.has(n.id))
}

/** All ids of notes currently in an archived status — used to seed the seen-list on first-ever load. */
export function archivedNoteIds(notes: StructuredNote[]): string[] {
  return notes.filter((n) => n.id && ARCHIVED_STATUSES.includes(n.status)).map((n) => n.id as string)
}

/** Union of a possibly-null seen-list with newly-seen ids, deduplicated. */
export function markNotesSeen(seenIds: string[] | null, noteIds: string[]): string[] {
  return [...new Set([...(seenIds ?? []), ...noteIds])]
}
