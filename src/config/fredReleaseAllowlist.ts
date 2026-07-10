// Phase 8D.1 — Curated allowlist of FRED release IDs for the dates-only
// economic release calendar. Every entry's `releaseId` was verified live
// against FRED's official `/fred/releases` catalog (never guessed) — the
// `fredReleaseName` is FRED's own exact release name, kept for provenance so
// a reviewer can cross-check the id against https://fred.stlouisfed.org/release?rid=<id>.
//
// Not found in FRED's release catalog (searched, not guessed) — deliberately
// excluded rather than approximated:
//   - University of Michigan Consumer Sentiment (no matching release name)
//   - ISM Manufacturing/Services PMI (ISM's own index is not published as a
//     FRED "release" with a release-dates calendar; several unrelated regional
//     Fed "manufacturing outlook survey" releases exist but are not the ISM
//     national index most users mean by "ISM PMI")
//
// Verified live but EXCLUDED for a data-quality reason (Phase 8D.1 — never
// silently included noisy data): `/fred/release/dates` for release_id 101
// ("FOMC Press Release") and release_id 18 ("H.15 Selected Interest Rates")
// returns a release-date entry for essentially EVERY consecutive calendar day
// in the requested window (confirmed live: 53 and 36 hits respectively in a
// 45-day test window, spanning every single date) rather than discrete
// scheduled-event dates. This is a genuine FRED API/data-modeling quirk for
// these two releases specifically — not how the other 13 curated releases in
// this file behave (each returns a small number of correctly-spaced discrete
// dates, e.g. CPI/PPI/Retail Sales appear ~monthly as expected). Including
// them would make the calendar unusable (near-daily "events"). Deferred; not
// silently included and not further investigated this phase.

export type FredReleaseCategory =
  | 'Inflation' | 'Labor' | 'Monetary Policy' | 'GDP/Growth'
  | 'Retail/Consumer' | 'Housing' | 'Trade' | 'Industrial Production'

export interface FredReleaseAllowlistEntry {
  /** Official FRED release_id — verified live against /fred/releases. */
  releaseId: number
  /** Curated display name shown in the app. */
  name: string
  /** FRED's own exact release name — provenance/cross-check only. */
  fredReleaseName: string
  category: FredReleaseCategory
  /** Heuristic importance assigned internally by this app — not sourced from FRED. */
  importance: 'High' | 'Medium' | 'Low'
}

export const FRED_RELEASE_ALLOWLIST: FredReleaseAllowlistEntry[] = [
  { releaseId: 10, name: 'Consumer Price Index (CPI)', fredReleaseName: 'Consumer Price Index', category: 'Inflation', importance: 'High' },
  { releaseId: 46, name: 'Producer Price Index (PPI)', fredReleaseName: 'Producer Price Index', category: 'Inflation', importance: 'Medium' },
  { releaseId: 54, name: 'Personal Income and Outlays (incl. PCE)', fredReleaseName: 'Personal Income and Outlays', category: 'Inflation', importance: 'High' },
  { releaseId: 50, name: 'Employment Situation (Nonfarm Payrolls)', fredReleaseName: 'Employment Situation', category: 'Labor', importance: 'High' },
  { releaseId: 192, name: 'Job Openings and Labor Turnover Survey (JOLTS)', fredReleaseName: 'Job Openings and Labor Turnover Survey', category: 'Labor', importance: 'Medium' },
  { releaseId: 194, name: 'ADP National Employment Report', fredReleaseName: 'ADP National Employment Report', category: 'Labor', importance: 'Medium' },
  { releaseId: 53, name: 'Gross Domestic Product (GDP)', fredReleaseName: 'Gross Domestic Product', category: 'GDP/Growth', importance: 'High' },
  { releaseId: 9, name: 'Retail Sales', fredReleaseName: 'Advance Monthly Sales for Retail and Food Services', category: 'Retail/Consumer', importance: 'High' },
  { releaseId: 13, name: 'Industrial Production & Capacity Utilization', fredReleaseName: 'G.17 Industrial Production and Capacity Utilization', category: 'Industrial Production', importance: 'Medium' },
  { releaseId: 27, name: 'New Residential Construction (Housing Starts)', fredReleaseName: 'New Residential Construction', category: 'Housing', importance: 'Medium' },
  { releaseId: 97, name: 'New Residential Sales', fredReleaseName: 'New Residential Sales', category: 'Housing', importance: 'Low' },
  { releaseId: 291, name: 'Existing Home Sales', fredReleaseName: 'Existing Home Sales', category: 'Housing', importance: 'Medium' },
  { releaseId: 51, name: 'U.S. International Trade in Goods and Services', fredReleaseName: 'U.S. International Trade in Goods and Services', category: 'Trade', importance: 'Medium' },
  // FOMC Press Release (101) and H.15 Selected Interest Rates (18) deliberately
  // excluded — see the comment above (near-daily noise, not discrete dates).
]
