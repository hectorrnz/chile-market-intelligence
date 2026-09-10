// POST-R13.8 FOLLOW-UP E — THE ONE PLACE EITHER CHANGES SURFACE IS NAMED.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// Weekly Changes and Compare are the SAME page composition over two different
// intervals. Weekly measures one source reporting week; Compare measures an
// arbitrary source-backed period. Everything else — the scope selector, the
// hero beside its reconciliation ledger, the two ranked panels, the hierarchy
// chart, the full listing, the cash toggle, the status block — is identical, and
// must STAY identical as either is restyled.
//
// The failure mode this file prevents is the obvious implementation: a
// `mode === 'period' ? 'Period …' : 'Weekly …'` ternary at every label site.
// Weekly Changes had thirteen of those before this pass, and the surface was
// still wrong in three places — the ranked panels, the hierarchy chart and the
// full listing all said "Weekly" over a five-month comparison, because a
// ternary only fixes the site somebody remembered.
//
// So the vocabulary is resolved ONCE, here, into a flat record. A shared
// component reads `labels.valueChange`; it never asks which mode it is in, and
// it cannot render the wrong interval's word for a figure. Adding a label means
// adding a field, which the compiler then demands for BOTH modes.
//
// ── WHAT BELONGS HERE, AND WHAT DOES NOT ────────────────────────────────────
//
// Labels only. No financial semantics whatsoever: not a value, not a date, not
// a window, not a rule about which rows are compared. Those live in the pure
// modules (`weeklyChanges.ts`, `periodPerformance.ts`) and in the API route.
// This module could be deleted and re-derived from the dictionary alone.
//
// Pure — the dictionary type is imported for its SHAPE only — so the whole
// contract is exercisable in a test without rendering anything.

import type { Translation } from '@/lib/i18n'

/**
 * WHICH INTERVAL THE SURFACE IS MEASURING.
 *
 * `weekly` — one source reporting week: the selected publication against the
 * week the workbook itself closed immediately before it. Never a range.
 *
 * `period` — two source-backed reporting dates the reader chose, with every
 * reporting interval between them accumulating into the flows and the result.
 *
 * There is deliberately no third member and no "auto": each surface declares
 * its own mode as a constant, so a page cannot drift into the other one's
 * vocabulary at run time.
 */
export type ChangesMode = 'weekly' | 'period'

/**
 * Every user-visible string that differs between the two surfaces.
 *
 * Flat and exhaustive on purpose. A nested or partial shape would let one mode
 * omit a field and fall back to the other's word, which is the exact defect the
 * module exists to make impossible.
 */
export interface ChangesLabels {
  /** The page's own title. */
  title: string
  /** The hero's headline: the whole interval's value change, as one amount. */
  valueChange: string
  /** The hero's rate, and the ledger's own return vocabulary. */
  returnLabel: string

  // ── the endpoint line above the sections ─────────────────────────────────
  /** Name of the OPENING endpoint ("Previous Published Week" / "From"). */
  openingLabel: string
  /** Name of the CLOSING endpoint ("This Week" / "To"). */
  closingLabel: string

  // ── the reconciliation ledger ────────────────────────────────────────────
  reconTitle: string
  reconOpening: string
  reconProfit: string
  reconFlow: string
  reconClosing: string
  reconNote: string

  // ── the ranked panels ────────────────────────────────────────────────────
  increasesTitle: string
  decreasesTitle: string
  noIncreases: string
  noDecreases: string
  rankNote: string
  cashWhy: string

  // ── the hierarchy chart ──────────────────────────────────────────────────
  hierarchyTitle: string
  hierarchySubtitle: string

  // ── the full listing ─────────────────────────────────────────────────────
  fullTableTitle: string
  fullTableNote: string
  /** The two VALUE columns of both tables. */
  colOpening: string
  colClosing: string

  // ── per-row unavailability, which names an endpoint ──────────────────────
  reasonMissingCurrent: string
  reasonMissingPrevious: string
  reasonMissingBoth: string

  // ── the persistent methodology note ──────────────────────────────────────
  methodologyLevel: string
  methodologyPair: string
  methodologyImpact: string
}

/**
 * The vocabulary for one surface.
 *
 * Both branches read the SAME dictionary — `t.fp.weeklyChanges` — because the
 * two surfaces are one feature with one namespace. The period strings are not a
 * second copy of the weekly ones: several are shared verbatim (the impact
 * definition, the cash rule's economics) precisely because they do not depend on
 * the interval, and duplicating those would let the two drift apart.
 */
export function changesLabels(mode: ChangesMode, t: Translation): ChangesLabels {
  const w = t.fp.weeklyChanges
  const o = t.fp.overview
  const p = t.fp.portfolio

  if (mode === 'period') {
    return {
      title: w.customTitle,
      valueChange: w.periodValueChange,
      returnLabel: w.periodReturn,

      openingLabel: w.compareFrom,
      closingLabel: w.compareTo,

      reconTitle: w.periodReconTitle,
      reconOpening: w.periodFromLabel,
      reconProfit: w.periodProfit,
      reconFlow: w.periodFlow,
      reconClosing: w.periodToLabel,
      reconNote: w.periodReconNote,

      increasesTitle: w.periodIncreasesTitle,
      decreasesTitle: w.periodDecreasesTitle,
      noIncreases: w.periodNoIncreases,
      noDecreases: w.periodNoDecreases,
      rankNote: w.periodRankNote,
      // The economics of the cash rule are the same in both modes — Caja y
      // Equivalentes absorbs money on its way in or out — but the sentence
      // names WHEN, so the period surface says "period" rather than "week".
      cashWhy: w.periodCashWhy,

      hierarchyTitle: w.periodHierarchyTitle,
      hierarchySubtitle: w.periodContribution,

      fullTableTitle: w.periodFullTableTitle,
      fullTableNote: w.fullTableNote,
      colOpening: p.colFrom,
      colClosing: p.colTo,

      reasonMissingCurrent: w.periodReasonMissingCurrent,
      reasonMissingPrevious: w.periodReasonMissingPrevious,
      reasonMissingBoth: w.periodReasonMissingBoth,

      methodologyLevel: w.periodMethodologyLevel,
      methodologyPair: w.periodMethodologyPair,
      // NOT shared, though the MEASURE is the same. The weekly sentence names
      // its denominator "the previous week's portfolio total", which is exact
      // there and wrong over a five-month range; the period one names the From
      // date. Sharing the sentence would have put a week back on this surface
      // through the one field that looked interval-independent.
      methodologyImpact: w.periodMethodologyImpact,
    }
  }

  return {
    title: w.title,
    valueChange: w.weeklyValueChange,
    returnLabel: o.weeklyReturn,

    openingLabel: w.previousWeekLabel,
    closingLabel: w.thisWeekLabel,

    reconTitle: w.flowReconTitle,
    reconOpening: w.previousValueLabel,
    reconProfit: o.weeklyProfit,
    reconFlow: w.flowLabel,
    reconClosing: w.endingValueLabel,
    reconNote: w.flowReconNote,

    increasesTitle: w.increasesTitle,
    decreasesTitle: w.decreasesTitle,
    noIncreases: w.noIncreases,
    noDecreases: w.noDecreases,
    rankNote: w.rankNote,
    cashWhy: w.cashWhy,

    hierarchyTitle: w.hierarchyTitle,
    hierarchySubtitle: w.contribution,

    fullTableTitle: w.fullTableTitle,
    fullTableNote: w.fullTableNote,
    colOpening: p.colPrev,
    colClosing: p.colThis,

    reasonMissingCurrent: w.reasonMissingCurrent,
    reasonMissingPrevious: w.reasonMissingPrevious,
    reasonMissingBoth: w.reasonMissingBoth,

    methodologyLevel: w.methodologyLevel,
    methodologyPair: w.methodologyPair,
    methodologyImpact: w.methodologyImpact,
  }
}

/**
 * The words this project treats as WEEKLY vocabulary, lower-cased.
 *
 * Exported so the regression suite can assert the period surface uses none of
 * them, in either language, rather than each test inventing its own list and
 * quietly checking a shorter one.
 */
export const WEEKLY_VOCABULARY = [
  'weekly',
  'this week',
  'previous week',
  'semanal',
  'esta semana',
  'semana anterior',
] as const
