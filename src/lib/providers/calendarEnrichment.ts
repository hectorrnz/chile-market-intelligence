// Phase 8D.3 — Actual/previous enrichment for the FRED release calendar.
//
// SERVER-ONLY. Given the dates-only FRED release events, attaches per-release
// `metrics` carrying the latest published ACTUAL and PREVIOUS values, derived
// from verified FRED time-series (src/config/calendarEnrichmentMap.ts) via the
// shared transforms.ts logic. NEVER fabricates a value:
//   • a past release  → actual = latest published print, previous = prior print
//   • a scheduled     → actual = pending (null), previous = last published print
//   • no/failed data  → status 'unavailable', both null
//
// Consensus/forecast/surprise are never produced. The fetched source is always
// FRED; each metric records its `originatingAgency` (BLS/BEA/Census/Fed) as
// provenance only.

import { fetchFredSeries, type FredSeriesPoint } from './fredClient.ts'
import { transformSeries } from './transforms.ts'
import type { ProviderResult } from './types.ts'
import { CALENDAR_ENRICHMENT_MAP, enrichmentSeriesIds, type EnrichmentMetric } from '../../config/calendarEnrichmentMap.ts'
import type { FredCalendarEvent } from './fredReleaseCalendar.ts'

export type EnrichedMetricStatus = 'published' | 'pending' | 'unavailable'

export interface EnrichedMetric {
  key: string
  label: string
  unit: string
  decimals: number
  actual: number | null
  previous: number | null
  /** Observation period (YYYY-MM-DD) the actual value belongs to. */
  actualPeriod: string | null
  /** Observation period of the previous value. */
  previousPeriod: string | null
  status: EnrichedMetricStatus
  /** Consensus is never available (no free official source) — always null. */
  consensus: null
  /** The source actually fetched — always FRED. */
  source: string
  /** True producer of the underlying data (provenance only). */
  originatingAgency: EnrichmentMetric['originatingAgency']
}

export interface EnrichedFredCalendarEvent extends FredCalendarEvent {
  metrics: EnrichedMetric[]
}

const FETCH_SOURCE = 'FRED (Federal Reserve Bank of St. Louis)'

/** Fetcher signature — injectable so unit tests never touch the live network. */
export type SeriesFetcher = (seriesId: string) => Promise<ProviderResult<FredSeriesPoint[]>>

/** ~3 years back is enough for a monthly y/y base and several quarterly GDP prints. */
function enrichmentStartDate(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 3)
  return d.toISOString().slice(0, 10)
}

const defaultFetcher: SeriesFetcher = (seriesId) => fetchFredSeries(seriesId, { startDate: enrichmentStartDate() })

/** Fetches every mapped series once, in parallel. A failed series is kept as a failed result (→ unavailable). */
async function fetchSeriesCache(fetcher: SeriesFetcher): Promise<Map<string, ProviderResult<FredSeriesPoint[]>>> {
  const ids = enrichmentSeriesIds()
  const results = await Promise.all(
    ids.map(async (id): Promise<[string, ProviderResult<FredSeriesPoint[]>]> => {
      try {
        return [id, await fetcher(id)]
      } catch {
        return [id, { ok: false, reason: 'fetch threw' }]
      }
    }),
  )
  return new Map(results)
}

/** Builds one metric's enriched value for an event, given the (possibly failed) cached series. */
export function buildEnrichedMetric(
  metric: EnrichmentMetric,
  series: ProviderResult<FredSeriesPoint[]> | undefined,
  eventStatus: FredCalendarEvent['status'],
): EnrichedMetric {
  const base = {
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    decimals: metric.decimals,
    consensus: null as null,
    source: FETCH_SOURCE,
    originatingAgency: metric.originatingAgency,
  }
  const unavailable: EnrichedMetric = { ...base, actual: null, previous: null, actualPeriod: null, previousPeriod: null, status: 'unavailable' }

  if (!series || !series.ok) return unavailable
  const pts = transformSeries(series.data, metric.transform)
  if (pts.length === 0) return unavailable

  const latest = pts[pts.length - 1]
  const prior = pts.length >= 2 ? pts[pts.length - 2] : null

  if (eventStatus === 'past') {
    // The most recent published print corresponds to the most recent past release.
    return {
      ...base,
      actual: latest.value,
      actualPeriod: latest.date,
      previous: prior ? prior.value : null,
      previousPeriod: prior ? prior.date : null,
      status: 'published',
    }
  }
  // Scheduled/future: this release's actual is not yet published (pending);
  // "previous" is the last published print, which the upcoming release updates.
  return {
    ...base,
    actual: null,
    actualPeriod: null,
    previous: latest.value,
    previousPeriod: latest.date,
    status: 'pending',
  }
}

/** Attaches `metrics` to every event. Events for unmapped releases get an empty metrics array. */
export function enrichEventsWithCache(
  events: FredCalendarEvent[],
  cache: Map<string, ProviderResult<FredSeriesPoint[]>>,
): EnrichedFredCalendarEvent[] {
  return events.map((e) => {
    const metrics = (CALENDAR_ENRICHMENT_MAP[e.releaseId] ?? []).map((m) =>
      buildEnrichedMetric(m, cache.get(m.fredSeriesId), e.status),
    )
    return { ...e, metrics }
  })
}

/**
 * Enriches a list of FRED calendar events with actual/previous values. Robust:
 * any fetch failure degrades that metric to `unavailable` and never throws, so
 * the dates-only calendar always still renders.
 */
export async function resolveCalendarEnrichment(
  events: FredCalendarEvent[],
  fetcher: SeriesFetcher = defaultFetcher,
): Promise<EnrichedFredCalendarEvent[]> {
  if (events.length === 0) return []
  const cache = await fetchSeriesCache(fetcher)
  return enrichEventsWithCache(events, cache)
}

/** Summary counts for the post-close refresh cron / diagnostics. */
export interface EnrichmentSummary {
  eventsTotal: number
  metricsTotal: number
  published: number
  pending: number
  unavailable: number
  byAgency: Record<string, number>
}

export function summarizeEnrichment(events: EnrichedFredCalendarEvent[]): EnrichmentSummary {
  const summary: EnrichmentSummary = { eventsTotal: events.length, metricsTotal: 0, published: 0, pending: 0, unavailable: 0, byAgency: {} }
  for (const e of events) {
    for (const m of e.metrics) {
      summary.metricsTotal++
      summary[m.status]++
      summary.byAgency[m.originatingAgency] = (summary.byAgency[m.originatingAgency] ?? 0) + 1
    }
  }
  return summary
}
