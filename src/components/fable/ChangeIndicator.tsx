'use client'

import { useLang } from '@/components/providers/LangProvider'

export type ChangeDirection = 'positive' | 'negative' | 'warning' | 'neutral' | 'unavailable'

function directionOf(value: number | null | undefined): ChangeDirection {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'unavailable'
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'neutral'
}

const COLOR: Record<ChangeDirection, string> = {
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  warning: 'var(--warning)',
  neutral: 'var(--muted-fg)',
  unavailable: 'var(--unavailable)',
}

// Glyph always pairs with color — direction is never conveyed by color alone.
const GLYPH: Record<ChangeDirection, string> = {
  positive: '▲',
  negative: '▼',
  warning: '●',
  neutral: '—',
  unavailable: '—',
}

interface ChangeIndicatorProps {
  /** Signed change (e.g. -1.8 for -1.8%). Direction is derived from its sign. */
  value: number | null | undefined
  /** Pre-formatted display text, e.g. "-1.8%". Falls back to the bare "Unavailable" word when omitted and the value is missing. */
  label?: string
  className?: string
}

export function ChangeIndicator({ value, label, className = '' }: ChangeIndicatorProps) {
  const { t } = useLang()
  const direction = directionOf(value)
  const text = label ?? (direction === 'unavailable' ? t.fable.kpi.unavailable : '')

  return (
    <span className={`ui-number inline-flex items-center gap-1 text-xs font-medium ${className}`} style={{ color: COLOR[direction] }}>
      <span aria-hidden="true">{GLYPH[direction]}</span>
      <span>{text}</span>
    </span>
  )
}
