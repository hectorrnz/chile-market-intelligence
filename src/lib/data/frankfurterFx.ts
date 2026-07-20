// FX Integrity Task — client-safe fetch helper for the Macro / US forex
// table. Calls /api/macro/fx/us. Only a TYPE is imported from the provider
// layer — no server code reaches the browser bundle.

import type { UsForexTableResult } from '@/lib/providers/frankfurterFxProvider'

export async function fetchUsForexTable(
  signal?: AbortSignal,
  /** Set only for an explicit Update Data click — bypasses the 6h server-side
   *  cache that otherwise made Update appear to do nothing. */
  force = false,
): Promise<UsForexTableResult | null> {
  try {
    const res = await fetch(`/api/macro/fx/us${force ? '?force=1' : ''}`, { signal })
    if (!res.ok) return null
    return (await res.json()) as UsForexTableResult
  } catch {
    return null
  }
}
