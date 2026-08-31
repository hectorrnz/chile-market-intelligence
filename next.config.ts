import type { NextConfig } from 'next'
import path from 'path'
import { PORTFOLIO_LEGACY_REDIRECTS } from './src/lib/routes/portfolioLegacyRedirects'

/**
 * POST-R13.5 — the Family Portfolio module moved from `/family-portfolio/*` to
 * `/portfolio/*` once the Phase 6C/6D positions tracker that had been occupying
 * `/portfolio` was retired.
 *
 * The redirect table itself lives in `src/lib/routes/portfolioLegacyRedirects.ts`
 * so the test suite can resolve real paths through it — see that file for why
 * the ordering matters, why no destination may carry a query, and why a
 * redirect grants nobody anything.
 *
 * Platform-level 308s rather than seven page modules calling `redirect()`:
 * no bundle, no component, nothing to drift out of step with the real routes.
 */
const nextConfig: NextConfig = {
  turbopack: {
    // Tell Turbopack this project's root, silencing the multi-lockfile warning.
    root: path.resolve(__dirname),
  },

  async redirects() {
    return [...PORTFOLIO_LEGACY_REDIRECTS]
  },
}

export default nextConfig
