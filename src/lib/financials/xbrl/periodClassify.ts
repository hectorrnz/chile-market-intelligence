// Phase 8C.2 — conservative XBRL period classification and target-period matching.
//
// A CMF XBRL instance carries facts on MANY contexts: the current period, one
// or more prior-year comparatives, and (for interim filings) both a cumulative
// year-to-date window AND a discrete-quarter window. Verified live against real
// COPEC filings:
//   Annual  (12/2023): p1_Duration 2023-01-01..2023-12-31 (current FY),
//                      p1_Instant 2023-12-31 (current year-end balance),
//                      p2_* = 2022 comparatives (must be ignored).
//   Interim (06/2024): p1_Duration 2024-01-01..2024-06-30 (current YTD, 6mo),
//                      p6         2024-04-01..2024-06-30 (current discrete Q2),
//                      p1_Instant 2024-06-30 (current balance),
//                      p2_*/p5/p7 = comparatives (must be ignored).
//
// So "take the first plain context" (the Phase 8C.1 placeholder) is unsafe — it
// could grab a prior-year comparative or a YTD figure where a discrete quarter
// was intended. This module matches each fact to the SPECIFIC context whose
// period corresponds to the filing's target period, and labels the period's
// cumulative/point-in-time nature honestly.
//
// Rules (do not weaken):
//   - Never derives a discrete quarter by subtracting YTD windows here — this
//     phase reports what the filing actually tags. If a discrete-quarter
//     context is present it is used directly; otherwise the interim income
//     figure is reported as year_to_date and labeled as such, never silently
//     relabeled "quarterly".
//   - Prior-year comparative contexts are excluded, never mixed in.
//   - Instant (balance-sheet) and duration (income/cash) contexts are never
//     conflated.
//
// Pure module (no imports beyond the local XBRL types) — directly unit-testable.

import type { XbrlContext } from './parseXbrl.ts'

/** The honest cumulative/point-in-time nature of a period's income/cash figures. Mirrors the DB `period_nature` column. */
export type PeriodNature = 'annual' | 'quarterly_discrete' | 'year_to_date' | 'instant' | 'unknown'

/** Coarse period_type kept compatible with the manual-CSV vocabulary so supersession still matches. */
export type CoarsePeriodType = 'quarterly' | 'annual' | 'ttm'

export interface TargetPeriod {
  fiscalYear: number
  /** 'Q1' | 'Q2' | 'Q3' | 'FY' */
  fiscalPeriod: string
  periodType: CoarsePeriodType
  /** ISO date the reporting period ends (year-end or quarter-end). */
  periodEndDate: string
  /** ISO date the income/cash duration begins (Jan 1 of the fiscal year for annual/YTD; quarter start for a discrete quarter). */
  periodStartDate: string
  periodNature: PeriodNature
  /** e.g. "12/2023" — the raw filing period label. */
  filingPeriodLabel: string
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Last calendar day of a quarter-end month (3,6,9,12), respecting leap years for... none of these (only 30/31), but computed generically. */
function monthEndDate(year: number, month: number): string {
  // month is 1-based; day 0 of next month = last day of this month.
  const d = new Date(Date.UTC(year, month, 0))
  return `${year}-${pad2(month)}-${pad2(d.getUTCDate())}`
}

/**
 * Builds the target period a CMF filing for (mm, aa) is about.
 *   mm=12 → annual FY (Jan 1 .. Dec 31), nature 'annual'.
 *   mm=03 → Q1 (Jan 1 .. Mar 31) — YTD and discrete are identical, nature 'quarterly_discrete'.
 *   mm=06 → Q2 (income is cumulative Jan 1 .. Jun 30), nature 'year_to_date'.
 *   mm=09 → Q3 (income is cumulative Jan 1 .. Sep 30), nature 'year_to_date'.
 * period_type stays quarterly/annual (never 'year_to_date') so supersession
 * still groups an XBRL Q2 with a manual_csv Q2.
 */
export function buildTargetPeriod(mm: string, aa: string): TargetPeriod | null {
  const month = Number(mm)
  const year = Number(aa)
  if (!Number.isInteger(month) || !Number.isInteger(year)) return null
  if (![3, 6, 9, 12].includes(month)) return null
  if (year < 1990 || year > 2100) return null

  const periodEndDate = monthEndDate(year, month)
  const periodStartDate = `${year}-01-01`
  const filingPeriodLabel = `${pad2(month)}/${year}`

  if (month === 12) {
    return { fiscalYear: year, fiscalPeriod: 'FY', periodType: 'annual', periodEndDate, periodStartDate, periodNature: 'annual', filingPeriodLabel }
  }
  const q = `Q${month / 3}`
  const nature: PeriodNature = month === 3 ? 'quarterly_discrete' : 'year_to_date'
  return { fiscalYear: year, fiscalPeriod: q, periodType: 'quarterly', periodEndDate, periodStartDate, periodNature: nature, filingPeriodLabel }
}

export type ContextRole = 'current_duration' | 'current_instant' | 'current_discrete_quarter' | 'comparative' | 'other'

export interface ClassifiedContext {
  context: XbrlContext
  role: ContextRole
}

/**
 * Classifies one context relative to a target period.
 *   current_duration        — a duration ending on the target period end and
 *                             starting Jan 1 of the fiscal year (the YTD/annual
 *                             income window).
 *   current_discrete_quarter— a duration ending on the target period end whose
 *                             length is ~one quarter (the discrete-quarter
 *                             window, present in interim filings).
 *   current_instant         — an instant on the target period end (balance sheet).
 *   comparative             — a duration/instant from a different (usually prior)
 *                             year — excluded from the current period.
 *   other                   — anything else (e.g. two-years-ago instant).
 */
export function classifyContext(context: XbrlContext, target: TargetPeriod): ContextRole {
  if (context.instant) {
    return context.instant === target.periodEndDate ? 'current_instant' : (context.instant.startsWith(String(target.fiscalYear)) ? 'other' : 'comparative')
  }
  if (context.startDate && context.endDate) {
    if (context.endDate !== target.periodEndDate) return 'comparative'
    // ends on the target period end
    if (context.startDate === target.periodStartDate) return 'current_duration'
    // a shorter window ending on the target end, starting later than Jan 1 → discrete quarter
    return 'current_discrete_quarter'
  }
  return 'other'
}

/**
 * Returns the set of context IDs that carry the CURRENT period's figures for a
 * target period: the current income/cash duration (YTD or annual) plus the
 * current period-end instant (balance sheet). Discrete-quarter and comparative
 * contexts are deliberately excluded here — a caller wanting discrete-quarter
 * figures asks for them explicitly (not implemented as a separate period this
 * phase; see module header).
 */
export function currentPeriodContextIds(contexts: XbrlContext[], target: TargetPeriod): { durationIds: Set<string>; instantIds: Set<string> } {
  const durationIds = new Set<string>()
  const instantIds = new Set<string>()
  for (const c of contexts) {
    const role = classifyContext(c, target)
    if (role === 'current_duration') durationIds.add(c.id)
    else if (role === 'current_instant') instantIds.add(c.id)
  }
  return { durationIds, instantIds }
}
