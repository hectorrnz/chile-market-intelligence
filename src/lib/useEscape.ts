import { useEffect } from 'react'

/**
 * Calls `onClose` when the user presses Escape, while `active` is true.
 * Used by modal dialogs so keyboard users can dismiss them.
 */
export function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onClose])
}
