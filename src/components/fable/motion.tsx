'use client'

import type { CSSProperties, ReactNode } from 'react'

// Thin React wrappers over the Phase 1 motion utilities already declared in
// globals.css (.nv-reveal / .nv-pop / .nv-slide-in / .nv-content-pulse) — no
// animation library, pure CSS. Every one of those classes is already
// reduced-motion-gated by the global `@media (prefers-reduced-motion:
// reduce)` block (globals.css §8), which forces `animation-duration: .01ms`
// and, for reveal/pop/slide-in specifically, renders the final visible state
// outright — so no component here needs its own reduced-motion branch, and
// none can ever remain hidden when motion is disabled.

interface MotionWrapperProps {
  children: ReactNode
  className?: string
}

interface RevealProps extends MotionWrapperProps {
  /** Stagger delay in ms, mapped to the `--nv-reveal-delay` CSS var .nv-reveal already reads. */
  delayMs?: number
}

/** Section reveal — communicates page/section entrance and hierarchy. */
export function Reveal({ children, className = '', delayMs }: RevealProps) {
  const style = delayMs !== undefined ? ({ '--nv-reveal-delay': `${delayMs}ms` } as CSSProperties) : undefined
  return (
    <div className={`nv-reveal ${className}`} style={style}>
      {children}
    </div>
  )
}

/** Overlay/menu pop-in — a transient surface appearing (dropdowns, command palette). */
export function Pop({ children, className = '' }: MotionWrapperProps) {
  return <div className={`nv-pop ${className}`}>{children}</div>
}

/** Drawer/panel slide-in from an edge — navigation/continuity. */
export function SlideIn({ children, className = '' }: MotionWrapperProps) {
  return <div className={`nv-slide-in ${className}`}>{children}</div>
}

interface ContentPulseProps extends MotionWrapperProps {
  /** Re-triggers the one-shot pulse only when this key actually changes (e.g. a currency code, a period, a privacy-mode flag). */
  pulseKey?: string | number
}

/** Content pulse — a brief one-shot cue on a currency/period/privacy/value change (430ms, design_principles §12.1). Distinct from the ambient `.nv-pulse` loop. */
export function ContentPulse({ children, className = '', pulseKey }: ContentPulseProps) {
  return (
    <span key={pulseKey} className={`inline-block nv-content-pulse ${className}`}>
      {children}
    </span>
  )
}

/** Overlay transition — semantic alias of `Pop` for scrims/dialogs entering. */
export const OverlayTransition = Pop

/** Value-change transition — semantic alias of `ContentPulse` for a single changing value (a price, a KPI, a toggled currency). */
export const ValueChangeTransition = ContentPulse
