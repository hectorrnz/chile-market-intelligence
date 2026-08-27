// R13.R5C.4 — the scope-aware Portfolio routes, and the ONE rule for reading a
// scope out of a URL.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
// `?scope=` was already the canonical, URL-backed mechanism: Summary, Holdings
// and Weekly Changes each DERIVE their active scope from the query string
// against the server-granted list, with no local copy to fall out of sync. What
// was missing is that the module rail linked to bare paths, so every sub-tab
// click dropped the parameter and each page fell back to the caller's first
// scope — "Andrés → Weekly Changes" landed on Main.
//
// The fix is to carry the existing parameter, not to add a second mechanism. A
// remembered "current scope" in React state or the provider would be exactly
// that second mechanism, and it would disagree with the URL the first time a
// reader used Back, opened a link in a new tab, or reloaded.
//
// So the derivation moves here, once, and the rail and all three pages read it.
// Four copies of `scopes.some((s) => s.id === requested) ? … : …` is how one of
// them eventually resolves a scope differently from its own navigation.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
// Alternatives is a SHARED publication with its own semantics, and Admin is a
// console — neither takes a scope, and neither appears below. A personal scope
// must not be forced onto a surface that does not have one.
//
// ── THIS IS PRESENTATION, NEVER PROTECTION (doc 05 § 2.1) ───────────────────
// `entitled` is the server-filtered scopes response. A hand-typed `?scope=` for
// a portfolio this caller was not granted is not in that list, so it resolves
// away here and is never linked onward — and behind this, the API's
// `canReadScope` check and PostgreSQL RLS refuse it again. Nothing in this file
// grants anything; it only decides what a link says.
//
// Pure strings and pure functions, no imports — a page module could export a
// constant, but a second page importing it would pull that whole route's bundle
// in behind it (the `alternativesRoutes.ts` precedent).

/** The scope that is a SHARED publication rather than one of the four principals. */
export const ALTERNATIVES_SCOPE = 'alternatives'

/** The query parameter every scope-aware Portfolio view already reads. */
export const SCOPE_PARAM = 'scope'

export const PORTFOLIO_SUMMARY = '/family-portfolio'
export const PORTFOLIO_HOLDINGS = '/family-portfolio/portfolio'
export const PORTFOLIO_WEEKLY_CHANGES = '/family-portfolio/weekly-changes'

/**
 * The three views a Main / Jaime / Andrés / Pablo selection survives across.
 * Alternatives and Admin are deliberately absent — see the header.
 */
export const SCOPE_AWARE_ROUTES = [
  PORTFOLIO_SUMMARY,
  PORTFOLIO_HOLDINGS,
  PORTFOLIO_WEEKLY_CHANGES,
] as const

/** Anything carrying an `id` — the scopes response, or a bare id list in a test. */
type ScopeLike = { id: string }

/** The entitled PORTFOLIO scopes: the caller's principals, without Alternatives. */
export function portfolioScopesOf<T extends ScopeLike>(scopes: readonly T[]): T[] {
  return scopes.filter((s) => s.id !== ALTERNATIVES_SCOPE)
}

/**
 * The scope the reader has EXPLICITLY selected — present in the URL and granted
 * to this caller — or `null` when there is none.
 *
 * Distinct from `activeScope` on purpose. A link carries only an explicit
 * choice: with no selection the rail keeps linking to bare paths, so the
 * default stays the default and a `?scope=main` is never pinned into a URL the
 * reader did not ask for.
 */
export function selectedScope(
  requested: string | null | undefined,
  scopes: readonly ScopeLike[],
): string | null {
  if (typeof requested !== 'string' || requested === '') return null
  return portfolioScopesOf(scopes).some((s) => s.id === requested) ? requested : null
}

/**
 * The scope a PAGE renders — the explicit selection, else the caller's own
 * first scope. An unentitled or unknown `?scope=` resolves here rather than
 * dead-ending, and nothing is ever fetched for the requested one.
 */
export function activeScope(
  requested: string | null | undefined,
  scopes: readonly ScopeLike[],
): string | null {
  return selectedScope(requested, scopes) ?? portfolioScopesOf(scopes)[0]?.id ?? null
}

/**
 * A scope-aware route that carries the selection, when there is one to carry.
 *
 * `null` yields the bare path, which is what makes the no-selection case
 * byte-identical to the behaviour before R13.R5C.4.
 */
export function scopeHref(path: string, scope: string | null): string {
  return scope === null
    ? path
    : `${path}?${SCOPE_PARAM}=${encodeURIComponent(scope)}`
}
