// Manually-curated FOMC meeting / policy-rate-decision dates.
//
// NOT sourced from FRED's release-dates endpoint: release_id 101 ("FOMC Press
// Release") returns a near-daily noise bug — confirmed live 2026-07-20, even
// with `include_release_dates_with_no_data=false` (199 "release dates" for a
// single year, essentially every calendar day) — the exact issue documented
// in fredReleaseAllowlist.ts's own exclusion note. There is no other
// FOMC-specific release in FRED's catalog with clean discrete dates (checked
// live against the full /fred/releases list — only H.15 and G.13 rate-series
// releases exist alongside it, neither of which is a meeting-date calendar).
//
// These dates were transcribed from the Federal Reserve Board's own official
// public calendar (https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm,
// fetched live 2026-07-20 — the page itself is stamped "Last Update: July 08,
// 2026") — a genuine, official, already-published schedule, not a guess. This
// is a periodically-refreshed manual list, the same pattern as
// FRED_RELEASE_ALLOWLIST and bcchSeriesManualMap.ts: never a live scrape at
// runtime, consistent with this project's standing no-scraping policy.
// Re-transcribe from the same URL every 6–12 months (the Fed typically
// publishes ~2 years ahead; "tentative until confirmed at the meeting
// immediately preceding it" per the page's own note for the furthest-out
// entries).
//
// Decision date = the SECOND day of each two-day meeting (when the policy
// statement / rate decision is announced). The August 22, 2025 "notation
// vote" is a procedural vote, not a rate-decision meeting, and is deliberately
// excluded.

export interface FomcMeetingDate {
  /** Decision/announcement date (2nd day of the 2-day meeting). YYYY-MM-DD. */
  date: string
  /** True for a meeting that includes a Summary of Economic Projections (the "dot plot"). */
  hasProjections: boolean
}

export const FOMC_MEETING_DATES: FomcMeetingDate[] = [
  // 2025
  { date: '2025-01-29', hasProjections: false },
  { date: '2025-03-19', hasProjections: true },
  { date: '2025-05-07', hasProjections: false },
  { date: '2025-06-18', hasProjections: true },
  { date: '2025-07-30', hasProjections: false },
  { date: '2025-09-17', hasProjections: true },
  { date: '2025-10-29', hasProjections: false },
  { date: '2025-12-10', hasProjections: true },
  // 2026
  { date: '2026-01-28', hasProjections: false },
  { date: '2026-03-18', hasProjections: true },
  { date: '2026-04-29', hasProjections: false },
  { date: '2026-06-17', hasProjections: true },
  { date: '2026-07-29', hasProjections: false },
  { date: '2026-09-16', hasProjections: true },
  { date: '2026-10-28', hasProjections: false },
  { date: '2026-12-09', hasProjections: true },
  // 2027 — "tentative until confirmed" per the Fed's own page for entries this far out.
  { date: '2027-01-27', hasProjections: false },
  { date: '2027-03-17', hasProjections: true },
  { date: '2027-04-28', hasProjections: false },
  { date: '2027-06-09', hasProjections: true },
  { date: '2027-07-28', hasProjections: false },
  { date: '2027-09-15', hasProjections: true },
  { date: '2027-10-27', hasProjections: false },
  { date: '2027-12-08', hasProjections: true },
]
