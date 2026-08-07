// R13.6 — pure week-selection rule for the member snapshot read.
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import — so
// the historical-week semantics are directly unit-testable instead of living
// inline in a route handler.
//
// THE RULE (doc 07 § 7.2, audit area 2): the input is the CURRENT publication
// per as_of_date — the repository's `is_current` filter, backed by the partial
// unique index, guarantees at most one entry per date, and superseded
// revisions never reach this function. Every historical date therefore stays
// selectable in its current revision; `is_current` is NEVER interpreted as
// "only the latest date in the lifecycle".
//
// `asOf` is untrusted input (a query parameter): it must EXACTLY match a
// published week or the selection fails with `week_not_found` — never a
// nearest-match, clamp, or closest-date guess. Omitted, the latest published
// week is selected by comparing the dates themselves (ISO date strings order
// lexicographically), not by trusting the caller's array order.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type WeekSelection<T> =
  | { ok: true; selected: T }
  | { ok: false; code: 'no_publications' | 'week_not_found' }

export function selectPublicationWeek<T extends { asOfDate: string }>(
  currentPublications: readonly T[],
  asOf: string | null,
): WeekSelection<T> {
  if (currentPublications.length === 0) return { ok: false, code: 'no_publications' }

  if (asOf !== null) {
    if (!ISO_DATE.test(asOf)) return { ok: false, code: 'week_not_found' }
    const match = currentPublications.find((p) => p.asOfDate === asOf)
    if (!match) return { ok: false, code: 'week_not_found' }
    return { ok: true, selected: match }
  }

  let latest = currentPublications[0]
  for (const p of currentPublications) {
    if (p.asOfDate > latest.asOfDate) latest = p
  }
  return { ok: true, selected: latest }
}
