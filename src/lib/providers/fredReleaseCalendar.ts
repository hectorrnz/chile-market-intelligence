// Phase 8D.1 — FRED release-date calendar orchestrator.
//
// SERVER-ONLY. Fetches upcoming/recent release dates for every curated
// allowlist entry (src/config/fredReleaseAllowlist.ts) in parallel, tags each
// with dates-only provenance, and returns a sorted, sanitized event list.
// Never invents consensus/actual/prior values — this is a genuinely different,
// narrower feature than the schedule-driven synthetic calendar
// (src/lib/data/calendar.ts), which stays unchanged and continues to serve
// its own purpose (a realistic recurring release schedule for UI/testing).

import { fetchFredReleaseDates, isFredCalendarConfigured } from './fredReleaseCalendarClient.ts'
import { FRED_RELEASE_ALLOWLIST, type FredReleaseCategory } from '../../config/fredReleaseAllowlist.ts'

export interface FredCalendarEvent {
  id: string
  date: string // YYYY-MM-DD
  releaseId: number
  /** FRED's own exact release name — provenance. */
  releaseName: string
  /** Curated display name. */
  name: string
  category: FredReleaseCategory
  region: 'US'
  importance: 'High' | 'Medium' | 'Low'
  source: string
  sourceUrl: string
  status: 'scheduled' | 'past'
  /** Always true — this calendar never carries a value, only a date. */
  datesOnly: true
  actual: null
  consensus: null
  prior: null
}

export interface FredCalendarResult {
  ok: boolean
  events: FredCalendarEvent[]
  reason?: string
  configured: boolean
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Resolves the dates-only FRED release calendar for an explicit [startIso, endIso]
 * window — used directly by the "current month" embed on the Macro page so
 * past-in-month releases (before today) still show, not just a fixed 7-day
 * lookback. `resolveFredReleaseCalendar` below is the narrower, existing
 * rolling-window convenience wrapper used by /macro/calendar.
 */
export async function resolveFredReleaseCalendarRange(startIso: string, endIso: string): Promise<FredCalendarResult> {
  if (!isFredCalendarConfigured()) {
    return { ok: false, events: [], reason: 'FRED_API_KEY not configured', configured: false }
  }

  const today = todayIso()

  const perRelease = await Promise.all(
    FRED_RELEASE_ALLOWLIST.map(async (entry) => {
      const res = await fetchFredReleaseDates(entry.releaseId, { start: startIso, end: endIso })
      return { entry, res }
    }),
  )

  const events: FredCalendarEvent[] = []
  let anySucceeded = false
  for (const { entry, res } of perRelease) {
    if (!res.ok) continue
    anySucceeded = true
    for (const d of res.data) {
      events.push({
        id: `${entry.releaseId}-${d.date}`,
        date: d.date,
        releaseId: entry.releaseId,
        releaseName: entry.fredReleaseName,
        name: entry.name,
        category: entry.category,
        region: 'US',
        importance: entry.importance,
        source: 'FRED (Federal Reserve Bank of St. Louis)',
        sourceUrl: `https://fred.stlouisfed.org/release?rid=${entry.releaseId}`,
        status: d.date >= today ? 'scheduled' : 'past',
        datesOnly: true,
        actual: null,
        consensus: null,
        prior: null,
      })
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))

  if (!anySucceeded) {
    return { ok: false, events: [], reason: 'All FRED release-date lookups failed', configured: true }
  }
  return { ok: true, events, configured: true }
}

/**
 * Resolves the dates-only FRED release calendar for a window from 7 days ago
 * (so recently-released events still show as context) through `daysAhead`.
 */
export async function resolveFredReleaseCalendar(daysAhead = 60): Promise<FredCalendarResult> {
  return resolveFredReleaseCalendarRange(addDaysIso(-7), addDaysIso(daysAhead))
}
