// Phase 8D.1 — Client-safe fetch helper for the FRED release calendar.
// Phase 8D.3 — events now carry actual/previous enrichment `metrics`.
// Only TYPE imports from the provider layer, so no server code or credentials
// reach the browser bundle (type-only imports are erased at build time).

import type { EnrichedFredCalendarEvent } from '@/lib/providers/calendarEnrichment'

export interface FredCalendarFetchResult {
  ok: boolean
  configured: boolean
  datesOnly: boolean
  /** Phase 8D.3 — true when events carry actual/previous `metrics`. */
  enriched?: boolean
  /** Always false — no free official consensus/forecast source. */
  consensusAvailable?: boolean
  events: EnrichedFredCalendarEvent[]
  reason?: string
}

export async function fetchFredReleaseCalendar(
  days = 60,
  signal?: AbortSignal,
): Promise<FredCalendarFetchResult | null> {
  try {
    const res = await fetch(`/api/macro/fred-release-calendar?days=${days}`, { signal })
    if (!res.ok) return null
    return (await res.json()) as FredCalendarFetchResult
  } catch {
    return null
  }
}
