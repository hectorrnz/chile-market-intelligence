// Phase 8D.1 — Client-safe fetch helper for the dates-only FRED release
// calendar. Only imports a TYPE from the provider layer, so no server code
// or credentials reach the browser bundle.

import type { FredCalendarEvent } from '@/lib/providers/fredReleaseCalendar'

export interface FredCalendarFetchResult {
  ok: boolean
  configured: boolean
  datesOnly: boolean
  events: FredCalendarEvent[]
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
