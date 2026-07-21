// Client-safe fetch helper for the live CMF earnings calendar.
// Components call this to hit /api/earnings/calendar — never the provider
// (server-only) directly. The type import is erased at compile time.

import type {
  EarningsCalendarResult,
  EarningsCalendarEvent,
} from '@/lib/providers/earnings/earningsCalendarProvider'

export type { EarningsCalendarResult, EarningsCalendarEvent }

export async function fetchEarningsCalendar(): Promise<EarningsCalendarResult | null> {
  try {
    const res = await fetch('/api/earnings/calendar', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as EarningsCalendarResult
  } catch {
    return null
  }
}

/** Events whose report date falls within [today, today + days]. Client-safe pure helper. */
export function upcomingWithinDays(
  events: EarningsCalendarEvent[],
  days: number,
  now: Date = new Date(),
): EarningsCalendarEvent[] {
  const todayIso = now.toISOString().slice(0, 10)
  const endIso = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)
  return events
    .filter((e) => e.reportDate >= todayIso && e.reportDate <= endIso)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
}
