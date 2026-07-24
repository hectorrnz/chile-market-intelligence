'use client'

import type { ElementType, ReactNode, CSSProperties } from 'react'

/**
 * The seven Liquid Glass material tiers (design_principles.md §7.1), as one
 * reusable wrapper. Each variant maps to a Phase 1 `globals.css` utility
 * class — the opaque fallback fill, the `@supports`-gated blur, the
 * no-stacked-blur guard, and the print flattening all already live there.
 * This component never declares a color, blur radius, or shadow itself.
 */
export type GlassVariant =
  | 'auth'    // authentication panel glass
  | 'nav'     // navigation / header glass
  | 'kpi'     // floating KPI glass (capsules, chips)
  | 'card'    // standard analytical card glass
  | 'overlay' // elevated modal / drawer / menu glass
  | 'dense'   // near-opaque dense table surface (no blur — §8)
  | 'scrim'   // overlay scrim

const VARIANT_CLASS: Record<GlassVariant, string> = {
  auth: 'nv-glass-auth',
  nav: 'nv-glass-nav',
  kpi: 'nv-glass-kpi',
  card: 'nv-glass-card',
  overlay: 'nv-glass-overlay',
  dense: 'nv-surface-dense',
  scrim: 'nv-scrim',
}

interface GlassSurfaceProps {
  variant?: GlassVariant
  /** Render as a different element (e.g. 'section', 'article') — defaults to 'div'. */
  as?: ElementType
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export function GlassSurface({ variant = 'card', as: Tag = 'div', className = '', style, children }: GlassSurfaceProps) {
  const Component = Tag as ElementType
  return (
    <Component className={`${VARIANT_CLASS[variant]} ${className}`} style={style}>
      {children}
    </Component>
  )
}
