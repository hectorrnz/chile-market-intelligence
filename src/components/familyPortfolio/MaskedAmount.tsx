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
import { formatUsd } from '@/lib/formatters'

interface MaskedAmountProps {
  value: number | null
  masked: boolean
  decimals?: number
  className?: string
}

export function MaskedAmount({ value, masked, decimals = 0, className = '' }: MaskedAmountProps) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={`text-muted-fg ${className}`}>—</span>
  }
  return (
    <PrivacyValue masked={masked} className={className}>
      {formatUsd(value, decimals)}
    </PrivacyValue>
  )
}
