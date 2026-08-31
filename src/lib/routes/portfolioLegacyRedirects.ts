// POST-R13.5 — the compatibility redirects for the Portfolio module's previous
// URLs, in ONE place.
//
// The module shipped on `/family-portfolio/*` only because `/portfolio` was
// still occupied by the Phase 6C/6D positions tracker. That tracker is retired
// and the released product answers `/portfolio` directly, so the old paths
// survive purely for bookmarks and browser history.
//
// WHY THIS IS A MODULE AND NOT AN ARRAY LITERAL INSIDE `next.config.ts`.
// A redirect table that nothing can read is a redirect table nothing can test:
// the one mistake that matters here — the order of the Holdings rule relative
// to the catch-all — is invisible to a source scan and produces a 404 rather
// than an error. `tests/portfolioCanonicalRoute.test.ts` imports this table and
// resolves real paths through it, which is only possible if the table is not
// buried in a config file that needs Next's own loader to evaluate.
//
// ORDER IS SIGNIFICANT. Next.js evaluates `redirects()` in array order, and
// `/family-portfolio/portfolio` is the one path whose final segment CHANGED
// NAME (`portfolio` -> `holdings`). Its specific rule must precede the
// catch-all, which would otherwise map it to `/portfolio/portfolio` — a route
// that does not exist.
//
// QUERY PRESERVATION IS THE POINT, NOT A DETAIL. Next.js forwards the incoming
// query string whenever the destination declares none of its own, so a saved
// `/family-portfolio/weekly-changes?scope=andres` arrives at the canonical path
// with `?scope=andres` intact. `?scope=` IS the scope mechanism, so a redirect
// that dropped it would silently land every bookmark on the caller's first
// portfolio instead of the one they saved. No destination below carries a
// query, and none may gain one.
//
// THIS GRANTS NOTHING. `redirects()` runs before middleware, so an old URL is
// answered with a 308 and never reaches a handler; the destination is gated by
// the same default-deny policy as every other private page, and the scope in a
// forwarded query is re-authorized per request against the caller's own
// `user_profiles` row. A redirect moves a reader, it never entitles one.
//
// Pure data, no imports — `next.config.ts` and the test suite both read it.

export interface PortfolioLegacyRedirect {
  source: string
  destination: string
  permanent: boolean
}

export const PORTFOLIO_LEGACY_REDIRECTS: readonly PortfolioLegacyRedirect[] = [
  // Holdings — the only renamed segment. MUST stay above the catch-all.
  {
    source: '/family-portfolio/portfolio',
    destination: '/portfolio/holdings',
    permanent: true,
  },
  // Every other old sub-route maps one-to-one: weekly-changes, admin,
  // alternatives, alternatives/holdings, alternatives/cash-flows.
  {
    source: '/family-portfolio/:path*',
    destination: '/portfolio/:path*',
    permanent: true,
  },
  // The module root — Summary.
  {
    source: '/family-portfolio',
    destination: '/portfolio',
    permanent: true,
  },
]
