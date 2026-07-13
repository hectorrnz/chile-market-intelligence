// Phase 8D.3 — Release-to-source mapping for actual/previous enrichment of the
// FRED dates-only economic release calendar.
//
// The RELEASE DATES come from FRED's Releases API (src/lib/providers/
// fredReleaseCalendar.ts). The ACTUAL/PREVIOUS VALUES for each release are
// derived from a FRED time-series (the same keyless CSV endpoint fredClient.ts
// already uses for US macro), transformed via the shared transforms.ts logic.
//
// WHY FRED (and not BLS/BEA/Census directly): every series id below was
// VERIFIED LIVE against FRED's public CSV endpoint (Phase 8D.3 — real Jun/2026
// data returned for each) — never guessed, matching the project's standing
// never-guess-an-identifier rule. FRED redistributes the BLS/BEA/Census/Fed
// primary data verbatim; fetching it from FRED with verified ids is more
// reliable than standing up three new keyed agency API clients with unverified
// series/table/line-code mappings in a single phase. Direct BLS/BEA/Census API
// integration was assessed and DEFERRED for that reason (see
// docs/macro_market_source_coverage.md §11). The `originatingAgency` field
// below records the true producer for provenance/labeling; the value we
// actually FETCH is always FRED, and the UI labels it as such — we never claim
// to have called BLS/BEA/Census directly.
//
// Consensus/forecast/surprise are intentionally ABSENT everywhere — no free
// official source provides them, and this is not a vendor-style calendar.
//
// ⚠️ POLICY: never add a series id that has not been confirmed to return real,
// current, plausible data from FRED's CSV endpoint. ADP (release 194) was
// evaluated (FRED series NPPTTL) and EXCLUDED — its latest observation is 2022
// (stale/discontinued on FRED) — so ADP calendar rows carry no actual/previous.

import type { Transform } from '../lib/providers/transforms.ts'

/** The agency that PRODUCES the data (provenance). The data is FETCHED from FRED regardless. */
export type OriginatingAgency = 'BLS' | 'BEA' | 'Census' | 'Federal Reserve' | 'FRED'

export interface EnrichmentMetric {
  /** Stable id, unique within a release (used for React keys + tests). */
  key: string
  /** Curated short display label, e.g. 'CPI y/y'. */
  label: string
  /** Verified FRED series id the value is derived from. */
  fredSeriesId: string
  /** How the displayed value is derived from the series (shared transforms.ts). */
  transform: Transform
  /** Display unit for the value ('%', 'K' = thousands, '$M' = millions USD, '' = index/level). */
  unit: string
  decimals: number
  /** True producer of the underlying data — provenance only; the fetch source is always FRED. */
  originatingAgency: OriginatingAgency
}

// releaseId → one or more metrics. releaseId matches FRED_RELEASE_ALLOWLIST.
export const CALENDAR_ENRICHMENT_MAP: Record<number, EnrichmentMetric[]> = {
  // CPI (release 10) — CPIAUCSL index level → y/y and m/m % change.
  10: [
    { key: 'cpi-yoy', label: 'CPI y/y', fredSeriesId: 'CPIAUCSL', transform: 'yoy', unit: '%', decimals: 1, originatingAgency: 'BLS' },
    { key: 'cpi-mom', label: 'CPI m/m', fredSeriesId: 'CPIAUCSL', transform: 'mom', unit: '%', decimals: 1, originatingAgency: 'BLS' },
  ],
  // PPI (release 46) — PPIFIS (final demand) index level → y/y and m/m.
  46: [
    { key: 'ppi-yoy', label: 'PPI y/y', fredSeriesId: 'PPIFIS', transform: 'yoy', unit: '%', decimals: 1, originatingAgency: 'BLS' },
    { key: 'ppi-mom', label: 'PPI m/m', fredSeriesId: 'PPIFIS', transform: 'mom', unit: '%', decimals: 1, originatingAgency: 'BLS' },
  ],
  // Personal Income and Outlays / PCE (release 54) — headline + core PCE price index → y/y.
  54: [
    { key: 'pce-yoy', label: 'PCE price index y/y', fredSeriesId: 'PCEPI', transform: 'yoy', unit: '%', decimals: 1, originatingAgency: 'BEA' },
    { key: 'core-pce-yoy', label: 'Core PCE y/y', fredSeriesId: 'PCEPILFE', transform: 'yoy', unit: '%', decimals: 1, originatingAgency: 'BEA' },
  ],
  // Employment Situation (release 50) — multi-metric: NFP monthly change + unemployment rate.
  50: [
    { key: 'nonfarm-payrolls', label: 'Nonfarm Payrolls (m/m chg)', fredSeriesId: 'PAYEMS', transform: 'level-diff', unit: 'K', decimals: 0, originatingAgency: 'BLS' },
    { key: 'unemployment-rate', label: 'Unemployment Rate', fredSeriesId: 'UNRATE', transform: 'none', unit: '%', decimals: 1, originatingAgency: 'BLS' },
  ],
  // JOLTS (release 192) — job openings level (thousands).
  192: [
    { key: 'job-openings', label: 'Job Openings', fredSeriesId: 'JTSJOL', transform: 'none', unit: 'K', decimals: 0, originatingAgency: 'BLS' },
  ],
  // GDP (release 53) — real GDP q/q, annualized % change (already a rate, not a level).
  53: [
    { key: 'gdp-qoq-saar', label: 'Real GDP q/q (SAAR)', fredSeriesId: 'A191RL1Q225SBEA', transform: 'none', unit: '%', decimals: 1, originatingAgency: 'BEA' },
  ],
  // Retail Sales (release 9) — advance retail & food services level ($M) → m/m %.
  9: [
    { key: 'retail-sales-mom', label: 'Retail Sales m/m', fredSeriesId: 'RSAFS', transform: 'mom', unit: '%', decimals: 1, originatingAgency: 'Census' },
  ],
  // Industrial Production (release 13) — G.17, a Federal Reserve release. Index → m/m %.
  13: [
    { key: 'industrial-production-mom', label: 'Industrial Production m/m', fredSeriesId: 'INDPRO', transform: 'mom', unit: '%', decimals: 1, originatingAgency: 'Federal Reserve' },
  ],
  // Housing Starts (release 27) — level, thousands SAAR.
  27: [
    { key: 'housing-starts', label: 'Housing Starts (SAAR)', fredSeriesId: 'HOUST', transform: 'none', unit: 'K', decimals: 0, originatingAgency: 'Census' },
  ],
  // New Residential Sales (release 97) — new one-family houses sold, thousands SAAR.
  97: [
    { key: 'new-home-sales', label: 'New Home Sales (SAAR)', fredSeriesId: 'HSN1F', transform: 'none', unit: 'K', decimals: 0, originatingAgency: 'Census' },
  ],
  // U.S. International Trade in Goods and Services (release 51) — balance ($M, negative = deficit).
  51: [
    { key: 'trade-balance', label: 'Trade Balance', fredSeriesId: 'BOPGSTB', transform: 'none', unit: '$M', decimals: 0, originatingAgency: 'BEA' },
  ],
  // Existing Home Sales (release 291), New Residential Construction extras, ADP (194) — no
  // enrichment: ADP's FRED series (NPPTTL) is stale (2022); Existing Home Sales is NAR data
  // (not a govt agency) and is left dates-only this phase. Those rows show actual/previous
  // as unavailable rather than a fabricated or stale number.
}

/** Every unique FRED series id referenced by the map (for deduped fetching). */
export function enrichmentSeriesIds(): string[] {
  const ids = new Set<string>()
  for (const metrics of Object.values(CALENDAR_ENRICHMENT_MAP)) {
    for (const m of metrics) ids.add(m.fredSeriesId)
  }
  return [...ids]
}
