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
import { formatUsd, formatUsdCompactM } from '@/lib/formatters'

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
   * R13.R2F4 § 2 — render at chart-axis length (`145,5M`) instead of the full
   * grouped amount. Added HERE rather than at the call site so a printed
   * y-axis label goes through the SAME guarded path as every other amount in
   * the module: an axis is not a loophole around the privacy mask.
   */
  compact?: boolean
  className?: string
}

export function MaskedAmount({
  value,
  masked,
  decimals = 0,
  signed = false,
  compact = false,
  className = '',
}: MaskedAmountProps) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={`text-muted-fg ${className}`}>—</span>
  }
  // Still exactly one guarded render path — both formatters live inside this
  // component, and the sign prefix wraps whichever one applies, so the privacy
  // audit's single-call-site invariant keeps holding.
  const amount = compact ? formatUsdCompactM(value) : formatUsd(value, decimals)
  const text = `${signed && value > 0 ? '+' : ''}${amount}`
  return (
    <PrivacyValue masked={masked} className={className}>
      {text}
    </PrivacyValue>
  )
}
