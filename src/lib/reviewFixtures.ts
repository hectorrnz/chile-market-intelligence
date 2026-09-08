// The ONE environment gate for owner-review fixtures.
//
// A review fixture is deterministic synthetic DATA served through a REAL route
// and rendered by a REAL page, so an owner can approve the shipped component
// on Preview without production holding the state being reviewed — and without
// anyone mutating production to create it. Structured Notes introduced the
// pattern (R13.7B2.1 § 27); the Family Portfolio import preview reuses it
// (R13.8C § 12). Both consult this function, so the two surfaces can never
// disagree about where fixtures exist.
//
// `VERCEL_ENV` is 'production' on the production deployment, 'preview' on a
// Preview one, and undefined locally. Deny-on-production rather than
// allow-on-preview, so an unset variable in some future runtime cannot silently
// open the surface — except locally, where there is no deployment at all.

export function reviewFixturesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV !== 'production'
}
