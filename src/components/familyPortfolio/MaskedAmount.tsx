'use client'

// R13.7 — THE Family Portfolio monetary renderer outside the hierarchical
// table (whose `amountCell` embeds the same chain in a <td>).
//
// One render path for every portfolio amount, in this order (R13.R5C.3):
//
//   1. unavailable  → `—`, ahead of the mask (never 0, doc 02 § 9)
//   2. masked       → `•••••`, ahead of BOTH marks and every figure
//   3. zero         → `-`
//   4. otherwise    → the formatted amount
//
// Steps 2-4 are one expression: the marks are computed as CHILDREN of
// `PrivacyValue`, which renders no child at all while it masks. So no card,
// metric row, or context block can be added that forgets the privacy mask, and
// none can be added that slips a mark past it — the same reasoning that put
// `amountCell` in charge of the table.
//
// Public market data (a benchmark price, a return percentage) is NOT rendered
// through this component: masking hides the family's wealth, not the closing
// price of a listed ETF anyone can look up.

import { PrivacyValue } from '@/components/fable/PrivacyValue'
import {
  formatUsd,
  formatUsdCompactM,
  formatUsdCompactUnit,
  roundsToZeroAt,
  type CompactUnit,
} from '@/lib/formatters'

interface MaskedAmountProps {
  value: number | null
  masked: boolean
  decimals?: number
  /**
   * R13.8 — prefix a `+` on positive CHANGE amounts (a negative already
   * carries the locale minus sign). Kept INSIDE this component so a signed
   * dollar change still has exactly one guarded render path — never a second,
   * unmasked formatter.
   */
  signed?: boolean
  /**
   * Render at chart length instead of the full grouped amount. Added HERE
   * rather than at the call site so a chart label goes through the SAME
   * guarded path as every other amount in the module: an axis is not a
   * loophole around the privacy mask.
   *
   *  · `true`   — R13.R2F4 § 2, the PRINT axis form: one decimal, always
   *               millions (`145,5M`), so a portfolio-level axis's stacked
   *               labels stay directly comparable.
   *  · `'unit'` — R13.R3C.2, the CONTRIBUTORS chart form: a whole number and a
   *               unit that follows the value (`5M`, `-98K`), because a
   *               component's change spans orders of magnitude across periods.
   */
  compact?: boolean | 'unit'
  /**
   * R13.R3C.2 — force the unit of a `compact="unit"` render, so a whole AXIS
   * reads in one unit (see `compactUnitForStep`). Omitted, each value picks
   * its own — right for a lone figure such as a tooltip amount.
   */
  compactUnit?: CompactUnit
  /**
   * Render an amount that prints as zero as `-` instead of `0`.
   *
   * R13.R5C.2 — DEFAULTS TO TRUE, and is now an opt-OUT. R13.R3C.4 introduced
   * it as an opt-in for CHANGE columns only, on the reasoning that a level
   * worth exactly nothing is a real state that should still print `0`. The
   * owner's rule is simpler and literal: every user-visible numeric zero in the
   * Portfolio product shows the zero mark, levels included — a liquidated
   * holding, an undrawn commitment of nothing, a reconciliation that leaves
   * nothing over. Making it the default is what removes the per-call-site
   * decision that got that carve-out wrong.
   *
   * The value itself is untouched. A zero passed here still sums, reconciles
   * and sets chart geometry exactly as before; only its rendering changes.
   *
   * THE ONE REASON TO PASS `false`: a chart SCALE ANNOTATION. An axis tick is
   * not a value — a contributors axis reading `-2M · - · 2M` is unreadable, and
   * the mark sits one glyph away from the minus signs around it.
   *
   * PRIVACY OUTRANKS IT (R13.R5C.3). The mark is computed as the CHILD of
   * `PrivacyValue`, never ahead of it, so a masked zero reads `•••••` exactly
   * like a masked nine-figure amount. R13.R5C.2 returned it early, which turned
   * "this figure is exactly zero" into the one fact the mask could not hide —
   * and a portfolio holding nothing is precisely a fact about the family's
   * holdings. See the render below for why the ordering is structural rather
   * than a `masked` test of its own.
   */
  zeroDash?: boolean
  /**
   * R13.R5C.1 § 2 — prefix the ISO-disambiguated currency mark `US$`.
   *
   * Reserved for the AUM / PORTFOLIO-VALUE figure of a scope — the one number
   * a reader may quote out of context, and the one place the unit has to be
   * unmistakable. Every scope in this book reports in USD, but the workbook,
   * the market context and the reader's own frame of reference are Chilean, so
   * a bare `143.677.987` invites being read as pesos. `US$` rather than `$`
   * for exactly that reason.
   *
   * NOT applied to the dense tables: a unit repeated in every cell of a
   * four-column hierarchy is noise, and those columns already sit under a
   * scope whose value is marked.
   *
   * It lives INSIDE this component, like the three formatters, so the marked
   * amount still has exactly one guarded render path and cannot be assembled
   * at a call site out of a prefix plus an unmasked number.
   */
  currency?: boolean
  className?: string
}

export function MaskedAmount({
  value,
  masked,
  decimals = 0,
  signed = false,
  compact = false,
  compactUnit,
  zeroDash = true,
  currency = false,
  className = '',
}: MaskedAmountProps) {
  // UNAVAILABLE stays ahead of the mask, unchanged since R13.7: `—` says no
  // figure could be established, which is a statement about the SOURCE, not
  // about the family's wealth — there is nothing here for the mask to hide, and
  // a bulleted placeholder would falsely imply a withheld amount exists.
  if (value === null || !Number.isFinite(value)) {
    return <span className={`text-muted-fg ${className}`}>—</span>
  }
  // Still exactly one guarded render path — ALL THREE formatters live inside
  // this component, and the sign prefix wraps whichever one applies, so the
  // privacy audit's single-call-site invariant keeps holding.
  const amount =
    compact === 'unit'
      ? formatUsdCompactUnit(value, compactUnit)
      : compact
        ? formatUsdCompactM(value)
        : formatUsd(value, decimals)
  // The mark sits after any sign, so a signed marked amount reads `+US$ 1.234`
  // rather than splitting the unit off its own figure. In practice the two
  // props do not meet — `currency` marks levels, `signed` marks changes — but
  // the order is fixed here rather than left to whichever call site pairs them
  // first.
  const text = `${signed && value > 0 ? '+' : ''}${currency ? 'US$ ' : ''}${amount}`
  // The zero mark, distinct from the em dash above. Measured on the RENDERED
  // precision, so an amount too small to show at this many decimals dashes
  // rather than printing `0` — the two are the same mark on screen, and
  // claiming a difference the column cannot show would be the misleading
  // choice. `compact` renders at one decimal, hence its own test.
  //
  // R13.R5C.3 — IT IS A CHILD OF `PrivacyValue`, NOT A BRANCH AHEAD OF IT, and
  // that placement IS the precedence rule. `PrivacyValue` renders no child at
  // all when it masks, so the ordering cannot be got wrong here or drift later;
  // an early `if (masked)` test would have been weaker, because it would miss
  // the case that gate exists for — the hydration window in which the stored
  // preference is not yet known and `masked` is still its unsafe default.
  //
  // Computing the mark inside the child is also what keeps the compact forms
  // honest: `formatUsdCompactUnit` deliberately prints a numeric `0` for an
  // axis gridline, and a data value must never reach it.
  const zero = zeroDash && roundsToZeroAt(value, compact ? 1 : decimals)
  return (
    <PrivacyValue masked={masked} className={className}>
      {zero ? <span className="text-muted-fg">-</span> : text}
    </PrivacyValue>
  )
}
