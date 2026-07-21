// Client-safe fetch helper for live quarterly earnings results.
// Components call this to hit /api/earnings/results — never the resolver
// (server-only) directly. The type import is erased at compile time.

import type {
  EarningsResultsPayload,
  EarningsResultRow,
} from '@/lib/earnings/resolveEarningsResults'

export type { EarningsResultsPayload, EarningsResultRow }

export async function fetchEarningsResults(force = false): Promise<EarningsResultsPayload | null> {
  try {
    const res = await fetch(`/api/earnings/results${force ? '?force=1' : ''}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as EarningsResultsPayload
  } catch {
    return null
  }
}
