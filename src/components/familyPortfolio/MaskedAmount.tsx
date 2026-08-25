'use client'

// R13.7 — THE Family Portfolio monetary renderer outside the hierarchical
// table (whose `amountCell` embeds the same chain in a <td>).
//
// One render path for every portfolio amount: unavailable → `—` (never 0,
// doc 02 § 9); available → `PrivacyValue(formatUsd(value))`, so no card,
// metric row, or context block can be added that forgets the privacy mask —
// the same reasoning that put `amountCell` in charge of the table.
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
   * R13.R3C.4 — render a CHANGE that prints as zero as `-` instead of `0`.
   *
   * Only ever for a change or a difference, never for a level: a holding worth
   * exactly nothing is a real state that must still print `0`, while a row that
   * did not move this week is better read as "nothing here".
   *
   * It lives in this component rather than at the call site so a zero change
   * cannot be dashed by one table and printed by another — and so the dash
   * still goes through the one guarded render path.
   *
   * PRIVACY: the dash shows through the mask, deliberately and consistently
   * with the rest of the module — the contributors chart already keeps relative
   * bar extents visible while masked, and the omitted-zero footnote already
   * NAMES the entities that did not move. "This row did not move" is not a
   * figure, and it is public here by existing design.
   */
  zeroDash?: boolean
  className?: string
}

export function MaskedAmount({
  value,
  masked,
  decimals = 0,
  signed = false,
  compact = false,
  compactUnit,
  zeroDash = false,
  className = '',
}: MaskedAmountProps) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={`text-muted-fg ${className}`}>—</span>
  }
  // A hyphen for "did not move", distinct from the em dash above for "could
  // not be compared". Measured on the RENDERED precision, so an amount too
  // small to show at this many decimals dashes rather than printing `0` — the
  // two are the same mark on screen, and claiming a difference the column
  // cannot show would be the misleading choice.
  if (zeroDash && roundsToZeroAt(value, compact ? 1 : decimals)) {
    return <span className={`text-muted-fg ${className}`}>-</span>
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
  const text = `${signed && value > 0 ? '+' : ''}${amount}`
  return (
    <PrivacyValue masked={masked} className={className}>
      {text}
    </PrivacyValue>
  )
}
