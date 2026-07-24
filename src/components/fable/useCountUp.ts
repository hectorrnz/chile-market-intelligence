'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
function getReducedMotionSnapshot() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
function getReducedMotionServerSnapshot() {
  return false
}

/** Reads `prefers-reduced-motion: reduce`, hydration-safe (useSyncExternalStore — no setState-in-effect). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot)
}

/**
 * Animates a numeric value toward `value` over the Fable kpiCountUp spec
 * (650ms, ease-out cubic `1-(1-t)^3`). Renders the final value immediately —
 * no animation frame at all — whenever `enabled` is false, the user prefers
 * reduced motion, or the value isn't finite. A KPI is never unreadable while
 * it animates in: the displayed number only ever moves toward the real one.
 */
export function useCountUp(value: number, enabled = true): number {
  const reducedMotion = usePrefersReducedMotion()
  const animate = enabled && !reducedMotion && Number.isFinite(value)

  const [display, setDisplay] = useState(value)
  const [prevValue, setPrevValue] = useState(value)

  // Render-time previous-value pattern (see CLAUDE.md lint conventions) for
  // the no-animation path — no effect needed to just mirror the new value.
  if (!animate && value !== prevValue) {
    setPrevValue(value)
    setDisplay(value)
  }

  useEffect(() => {
    if (!animate || value === prevValue) return
    const from = display
    const to = value
    const duration = 650
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (to - from) * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
      else setPrevValue(to)
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, animate])

  return display
}
