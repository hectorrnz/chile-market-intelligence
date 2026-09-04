'use client'

import { useLang } from '@/components/providers/LangProvider'

export type BarrierKind = 'knockIn' | 'coupon' | 'autocall' | 'strike' | 'other'

export interface BarrierMark {
  kind: BarrierKind
  /** Level on the same scale as `current` (e.g. percent of strike — 100 = strike). */
  level: number
  label?: string
}

interface BarrierGaugeProps {
  /** Current level on the gauge's scale. `null` renders the honest unavailable state. */
  current: number | null
  /** Threshold marks — knock-in barrier, coupon barrier, autocall barrier, the strike line, etc. */
  marks: BarrierMark[]
  min?: number
  max?: number
  /** Accessible text equivalent. If omitted, a plain sentence is derived from the nearest knock-in mark — a pure display calculation only, never eligibility/business logic (that stays in src/lib/structuredNotes). */
  summary?: string
  width?: number
  height?: number
  className?: string
}

const KIND_COLOR: Record<BarrierKind, string> = {
  knockIn: 'var(--critical)',
  coupon: 'var(--warning)',
  autocall: 'var(--accent)',
  strike: 'var(--muted-fg)',
  other: 'var(--muted-fg)',
}

/** Pure display calculation — proximity-based color, mirroring the Fable spec's own thresholds (≥25% positive, 15-25% warning, <15% critical). No structured-note eligibility logic here. */
function proximityColor(current: number, marks: BarrierMark[]): string {
  const knockIns = marks.filter((m) => m.kind === 'knockIn')
  if (knockIns.length === 0) return 'var(--accent-2)'
  const nearest = Math.min(...knockIns.map((m) => Math.abs(current - m.level)))
  if (nearest < 15) return 'var(--critical)'
  if (nearest < 25) return 'var(--warning)'
  return 'var(--positive)'
}

/**
 * Reusable barrier/threshold gauge for structured notes and risk displays
 * (Fable "barrier gauge" — a 0–130 track with a barrier tick, a strike tick,
 * and a glowing current-level dot). Flat SVG, no 3D effects, no motion. The
 * accessible summary is always rendered as real visible text, not only an
 * aria-label, so the reading is never color-only.
 */
export function BarrierGauge({ current, marks, min = 0, max = 130, summary, width = 160, height = 28, className = '' }: BarrierGaugeProps) {
  const { t } = useLang()

  if (current === null || !Number.isFinite(current)) {
    return (
      <span className={`text-xs text-muted-fg ${className}`} role="img" aria-label={t.fable.barrier.unavailable}>
        {t.fable.barrier.unavailable}
      </span>
    )
  }

  const range = max - min || 1
  const toX = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / range) * width
  const dotColor = proximityColor(current, marks)

  const nearestKnockIn = marks
    .filter((m) => m.kind === 'knockIn')
    .sort((a, b) => Math.abs(current - a.level) - Math.abs(current - b.level))[0]
  const derivedSummary = nearestKnockIn
    ? `${t.fable.barrier.current} ${current.toFixed(1)} — ${(current - nearestKnockIn.level).toFixed(1)} ${t.fable.barrier.distance}`
    : `${t.fable.barrier.current} ${current.toFixed(1)}`
  const accessibleText = summary ?? derivedSummary

  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={accessibleText}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--border-strong)" strokeWidth={2.5} strokeLinecap="round" />
        {/* R13.7B2.2 § 8 — every mark names itself. An unlabelled vertical line
            on a normalized scale is unreadable: the owner review could not tell
            which tick was the knock-in, the coupon barrier or the call level.
            The <title> is the SVG-native tooltip; the visible legend beside the
            table carries the same names, so meaning is never hover-only. */}
        {marks.map((m, i) => (
          <line key={i} x1={toX(m.level)} x2={toX(m.level)} y1={height / 2 - 6} y2={height / 2 + 6} stroke={KIND_COLOR[m.kind]} strokeWidth={2}>
            {m.label ? <title>{m.label}</title> : null}
          </line>
        ))}
        <circle cx={toX(current)} cy={height / 2} r={4} fill={dotColor} stroke={dotColor} strokeOpacity={0.25} strokeWidth={5}>
          <title>{accessibleText}</title>
        </circle>
      </svg>
      <span className="ui-meta text-muted-fg">{accessibleText}</span>
    </span>
  )
}
