// R13.7 — One Pager benchmark instruments (doc 06 §§ 3-4).
//
// PURE / CLIENT-SAFE. No provider import — this exists precisely so a page can
// label a metric without importing server-only market code (the
// `yahooMacroSeries.ts` precedent).
//
// THE STANDING RULE IS ABSOLUTE: NEVER GUESS AN IDENTIFIER. An entry earns
// `verified: true` ONLY by reproducing the source's own derived rows (see the
// verification record below); until then it is a candidate and nothing more.
// A benchmark is never published from an unverified symbol — the Overview
// renders its metric as unavailable, and the resolver refuses to fetch at all
// (doc 06 § 4.3). Four entries are verified; `inretc1` is NOT, and its metrics
// therefore stay unavailable.
//
// VERIFICATION PROTOCOL (mirrors bcchSeriesManualMap.ts discipline):
// `npm run discover:onepager-benchmarks` fetches history per candidate and
// asserts non-empty series, plausible price band, and expected quote currency.
// The DECISIVE test — recomputing weekly returns under the 5-calendar-day
// alignment rule and reproducing the workbook's own hardcoded derived rows
// 77/78/79 — needs the private reference workbook, which never enters this
// repository; the operator runs it against that file outside the repo. Only
// after that comparison passes may `verified` flip to true.
//
// OPERATOR VERIFICATION RUN — 2026-08-10, against the private R13 reference
// workbook, over its full 82-week header (80 comparable week-over-week pairs,
// matching doc 06 § 3's own 80-pair analysis). Only non-sensitive metadata is
// recorded below: symbol, venue, currency, status, date, method, and agreement
// statistics. No portfolio or reference value is reproduced anywhere in this
// repository. Two independent checks per candidate:
//   (a) PRICE-LEVEL IDENTITY — the symbol's aligned close vs the workbook's own
//       PX_LAST row, which proves the symbol IS the instrument and cannot be
//       satisfied by compensating errors inside a composite;
//   (b) DERIVED-ROW REPRODUCTION — the decisive doc 06 § 4.3 test.
// One workbook column (week 2026-11-07 in column order) carries a corrupted
// pasted PX_LAST for BOTH ACWI (13 % off) and INRETC1 (~42x off) while its
// DERIVED rows still agree with Yahoo — consistent with doc 06 § 3's finding
// that rows 66-79 are independent hardcoded pastes, so one bad paste cannot
// propagate. It is a source-side artefact, not a symbol mismatch.
//
// Doc 06 § 3.1 (proven over all 80 week pairs in the source):
//   * `Bolsas Mundiales`   = ACWI weekly price return, ALONE — never an average
//   * `Promedio Renta Fija` = arithmetic mean of AGGG, GHYG, CEMB returns
//   * `Inretail`           = INRETC1 weekly price return
// SPX / EZU / URTH / EEM exist in the source as unused reference data and are
// deliberately NOT mapped here (doc 06 § 3.2).

export type BenchmarkRole = 'global_equity' | 'global_fixed_income_component' | 'inretail'

export interface OnePagerBenchmark {
  /** Stable id used by the resolver and the UI. */
  id: 'acwi' | 'aggg' | 'ghyg' | 'cemb' | 'inretc1'
  /** The source workbook's own Bloomberg-style label, verbatim. */
  sourceLabel: string
  role: BenchmarkRole
  /** Candidate resolution symbol — a GUESS until `verified` is true. */
  candidateSymbol: string
  /** All five instruments are USD-denominated (doc 06 § 4.5). */
  expectedCurrency: 'USD'
  /**
   * True ONLY after the operator verification run reproduced the workbook's own
   * derived rows from this symbol's history. Never flipped on "the symbol
   * returns plausible prices".
   */
  verified: boolean
  /** ISO date of the verification run that set `verified`, or null while unverified. */
  verifiedAt: string | null
  /** Exchange/venue the candidate symbol resolves to, once observed. */
  venue: string | null
  /** Quote currency AS REPORTED by the provider — null when the venue reports none. */
  observedCurrency: string | null
  notes: string
}

export const ONE_PAGER_BENCHMARKS: readonly OnePagerBenchmark[] = [
  {
    id: 'acwi',
    sourceLabel: 'ACWI US EQUITY',
    role: 'global_equity',
    candidateSymbol: 'ACWI',
    expectedCurrency: 'USD',
    verified: true,
    verifiedAt: '2026-08-10',
    venue: 'NASDAQ (US)',
    observedCurrency: 'USD',
    notes:
      'VERIFIED 2026-08-10. Global equity is ACWI ALONE (doc 06 § 3.1: 80/80 week pairs; the five-instrument average was rejected 0/80). Price-level identity vs the reference PX_LAST row: 82 weeks, median relative deviation 2.3e-8, p95 5.2e-8 (one corrupted source column excepted — see header). Decisive derived-row reproduction: 80/80 week pairs agree to <= 1e-6, median 2.8e-8, max 9.9e-8 — floating-point-level agreement, i.e. the same instrument and the same close.',
  },
  {
    id: 'aggg',
    sourceLabel: 'AGGG LN Equity',
    role: 'global_fixed_income_component',
    candidateSymbol: 'AGGG.L',
    expectedCurrency: 'USD',
    verified: true,
    verifiedAt: '2026-08-10',
    venue: 'London Stock Exchange',
    observedCurrency: 'USD',
    notes:
      'VERIFIED 2026-08-10. The London listing was doc 06 § 4.3\'s specific currency concern: the venue quote currency is CONFIRMED USD by provider metadata, not assumed. Price-level identity vs the reference PX_LAST row: 81 weeks, median relative deviation 2.6e-8, p95 5.3e-8, max 2.5e-3 (a single week, consistent with a rounded pasted source price). Its leg is computable in 81/81 weeks; the composite it belongs to is verified as a whole below.',
  },
  {
    id: 'ghyg',
    sourceLabel: 'GHYG US Equity',
    role: 'global_fixed_income_component',
    candidateSymbol: 'GHYG',
    expectedCurrency: 'USD',
    verified: true,
    verifiedAt: '2026-08-10',
    venue: 'NYSE Arca (US)',
    observedCurrency: 'USD',
    notes:
      'VERIFIED 2026-08-10. Price-level identity vs the reference PX_LAST row: 81 weeks, median relative deviation 2.7e-8, max 1.1e-4 — every week inside source-rounding scale, zero outliers above 1e-3. Leg computable in 81/81 weeks; composite verified as a whole below.',
  },
  {
    id: 'cemb',
    sourceLabel: 'CEMB US Equity',
    role: 'global_fixed_income_component',
    candidateSymbol: 'CEMB',
    expectedCurrency: 'USD',
    verified: true,
    verifiedAt: '2026-08-10',
    venue: 'NASDAQ (US)',
    observedCurrency: 'USD',
    notes:
      'VERIFIED 2026-08-10. Price-level identity vs the reference PX_LAST row: 81 weeks, median relative deviation 2.7e-8, max 1.1e-4 — every week inside source-rounding scale, zero outliers above 1e-3. Leg computable in 81/81 weeks. COMPOSITE (mean of AGGG.L, GHYG, CEMB) reproduces the reference derived row in 80/80 week pairs: 76/80 <= 1e-4, 78/80 <= 5e-4, 80/80 <= 1e-3, median 1.5e-5, max 8.4e-4. The three-leg arithmetic mean is therefore verified AS A CONSTRUCTION, not merely leg-by-leg.',
  },
  {
    id: 'inretc1',
    sourceLabel: 'INRETC1 PE Equity',
    role: 'inretail',
    candidateSymbol: 'INRETC1.LM',
    expectedCurrency: 'USD',
    verified: false,
    verifiedAt: null,
    venue: 'Bolsa de Valores de Lima',
    observedCurrency: null,
    notes:
      'UNVERIFIED after the 2026-08-10 operator run — the verification was PERFORMED and did not pass, which is a different thing from not having been attempted. Identity is largely established: price-level agreement with the reference PX_LAST row is exact (median relative deviation 1.4e-8) on 72 of 80 weeks, and the derived row reproduces to <= 1e-6 in 65 of 76 comparable pairs. Two findings block promotion. (1) CURRENCY: the venue reports NO quote currency at all, so USD rests on inference from price agreement rather than the venue\'s own declaration — doc 06 § 4.3 requires it confirmed. (2) COVERAGE: Lima history is genuinely incomplete — one reference week has no aligned bar within the 5-day window, and on further weeks there is no bar on the reference date itself, so the alignment rule falls back 1-2 days and the recomputed weekly return misses the reference by more than 0.5 pp in 3 of 76 weeks (max 1.30e-2, i.e. 1.30 percentage points). A silently 1.3-pp-wrong published return is precisely what this gate exists to prevent, so InRetail price and variation continue to render unavailable. NOTE: the InRetail PORTFOLIO-VALUE impact metric is unaffected — doc 06 § 3.3 derives it from published snapshots and it needs no market feed at all.',
  },
] as const

export function getBenchmark(id: OnePagerBenchmark['id']): OnePagerBenchmark {
  const found = ONE_PAGER_BENCHMARKS.find((b) => b.id === id)
  if (!found) throw new Error(`unknown one-pager benchmark: ${id}`)
  return found
}

/** The three fixed-income components, in the source's own order. */
export const FIXED_INCOME_COMPONENT_IDS = ['aggg', 'ghyg', 'cemb'] as const
