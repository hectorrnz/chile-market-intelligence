'use client'

import { usePersistentState } from '@/lib/usePersistentState'

/**
 * App-wide privacy-mode preference. Persists through the SAME localStorage
 * mechanism as every other `cmi.*` UI preference in this app (no new
 * persistence layer, no API call, nothing sent to the server). Toggling it
 * only changes what is rendered — it never mutates the underlying value.
 */
export function usePrivacyMode(): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  return usePersistentState<boolean>('cmi.privacyMode', false)
}
