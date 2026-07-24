'use client'

import type { ReactNode } from 'react'

interface ChartTooltipProps {
  left: number
  top?: number
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
 */
export function ChartTooltip({ left, top = 2, children }: ChartTooltipProps) {
  return (
    <div
      className="pointer-events-none absolute z-10 px-2 py-1.5"
      style={{
        left,
        top,
        transform: 'translateX(-50%)',
        whiteSpace: 'nowrap',
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
