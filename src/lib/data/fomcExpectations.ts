// Client-safe fetch helper for the FOMC market-implied rate outlook.
// Components call this to hit /api/macro/fomc-expectations — never the provider
// (server-only) directly. Type import is erased at compile time.

import type {
  FomcExpectationsResult,
  FomcQuarterOutlook,
} from '@/lib/providers/fomc/fomcExpectations'

export type { FomcExpectationsResult, FomcQuarterOutlook }

export async function fetchFomcExpectations(): Promise<FomcExpectationsResult | null> {
  try {
    const res = await fetch('/api/macro/fomc-expectations', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as FomcExpectationsResult
  } catch {
    return null
  }
}
