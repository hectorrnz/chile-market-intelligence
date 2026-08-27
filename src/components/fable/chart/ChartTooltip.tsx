'use client'

import type { ReactNode, Ref } from 'react'

interface ChartTooltipProps {
  left: number
  top?: number
  /**
   * Hard ceiling on the tooltip's own width (R13.R4A.4), for a caller that
   * knows how much room it actually has. Supplying it also releases
   * `nowrap` — a tooltip that would otherwise run past a narrow card's edge
   * wraps inside its box instead of being cut off by it. Omitted → the
   * unbounded single-line behaviour every existing chart already has.
   */
  maxWidth?: number
  /**
   * Measurement handle (R13.R4A.4). A caller that clamps its own `left` needs
   * the tooltip's rendered width to clamp BY; without it the clamp is an
   * estimate, and an estimate is what lets a tooltip clip.
   */
  innerRef?: Ref<HTMLDivElement>
  children: ReactNode
}

/**
 * Shared institutional tooltip surface for the SVG charts (LineChart,
 * CompareChart, FundamentalsChart, YieldCurveChart) — a near-opaque
 * analytical surface (dense text never sits on low-opacity glass, per
 * design_principles §8), Fable's menu-item radius, and the restrained card
 * shadow. Positioning stays each chart's own responsibility (every chart
 * already computes a clamped left offset so the tooltip never leaves the
 * viewport) — this component supplies only the shared visual treatment and
 * semantic tokens, never chart-specific layout.
 *
 * R13.R4A.4 adds two OPTIONAL affordances for a caller that wants to clamp
 * rather than estimate — `innerRef` (measure the rendered width) and
 * `maxWidth` (a ceiling, which also lets the text wrap instead of being cut
 * off). Both default to undefined, so every existing chart renders byte for
 * byte as before.
 */
export function ChartTooltip({ left, top = 2, maxWidth, innerRef, children }: ChartTooltipProps) {
  return (
    <div
      ref={innerRef}
      className="pointer-events-none absolute z-10 px-2 py-1.5"
      style={{
        left,
        top,
        transform: 'translateX(-50%)',
        maxWidth,
        whiteSpace: maxWidth === undefined ? 'nowrap' : 'normal',
        backgroundColor: 'var(--chart-tooltip-bg)',
        color: 'var(--chart-tooltip-fg)',
        border: '1px solid var(--chart-tooltip-border)',
        borderRadius: 'var(--radius-menu)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {children}
    </div>
  )
}
