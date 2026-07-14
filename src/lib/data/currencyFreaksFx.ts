// DEPRECATED (FX Integrity Task) — NOT IMPORTED BY ANY PRODUCTION ROUTE OR
// PAGE. Superseded by src/lib/data/frankfurterFx.ts. Kept only for possible
// future reuse; see currencyFreaksFxProvider.ts's header for the full
// deprecation record.
//
// FX Data Task — client-safe fetch helper for the Macro / US forex table.
// Calls /api/macro/fx/us. Only a TYPE is imported from the provider layer —
// no server code (or CURRENCYFREAKS_API_KEY) reaches the browser bundle.

import type { UsForexTableResult } from '@/lib/providers/currencyFreaksFxProvider'

export async function fetchUsForexTable(signal?: AbortSignal): Promise<UsForexTableResult | null> {
  try {
    const res = await fetch('/api/macro/fx/us', { signal })
    if (!res.ok) return null
    return (await res.json()) as UsForexTableResult
  } catch {
    return null
  }
}
