'use client'

// Measures the active pill's position within its rail and returns a
// transform/width pair for a sliding indicator element (Fable "measured
// sliding active indicator", 380ms primary easing via the `.nv-indicator`
// utility in globals.css — which is already collapsed to .01ms under
// `prefers-reduced-motion: reduce`, so no extra reduced-motion handling is
// needed here).
//
// `remeasureToken` should combine every value that can change a pill's
// rendered width without changing `activeKey` (e.g. the current language) —
// pass something like `${pathname}|${lang}`.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface IndicatorRect {
  left: number
  width: number
}

export function useNavIndicator(activeKey: string | null | undefined, remeasureToken: string) {
  const railRef = useRef<HTMLElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLElement | null>>({})
  const [rect, setRect] = useState<IndicatorRect | null>(null)

  const measure = useCallback(() => {
    const rail = railRef.current
    const el = activeKey ? itemRefs.current[activeKey] : null
    if (!rail || !el) {
      setRect(null)
      return
    }
    const railRect = rail.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    setRect({ left: elRect.left - railRect.left + rail.scrollLeft, width: elRect.width })
  }, [activeKey])

  useLayoutEffect(() => {
    measure()
  }, [measure, remeasureToken])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const setItemRef = (key: string) => (el: HTMLElement | null) => {
    itemRefs.current[key] = el
  }

  return { railRef, setItemRef, rect }
}
