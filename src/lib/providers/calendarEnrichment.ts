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
  /**
   * Pre-formatted display strings, set only when a metric's value is not a
   * single number the unit-based formatter can render — e.g. the FOMC policy
   * band is a RANGE ("3.50%–3.75%"), not a scalar. When present the UI shows
   * these verbatim; `actual`/`previous` still carry a representative number
   * (the range's upper bound) for any numeric consumer.
   */
  actualText?: string | null
  previousText?: string | null
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

// FOMC meetings (FRED release id 101) are handled specially: the "value" is the
// policy target RANGE (a band, not a scalar), and the FRED target-range series
// are daily constants — so the generic latest/prior enrichment can't express
// them. These two series carry the current band (lower/upper limits).
export const FOMC_RELEASE_ID = 101
const FOMC_LOWER_SERIES = 'DFEDTARL'
const FOMC_UPPER_SERIES = 'DFEDTARU'

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
  // Include the FOMC target-range series alongside the mapped enrichment series
  // so a single deduped fetch pass covers everything.
  const ids = [...new Set([...enrichmentSeriesIds(), FOMC_LOWER_SERIES, FOMC_UPPER_SERIES])]
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

/** Last observation with a finite value at or before `dateIso`. */
function valueAsOf(points: FredSeriesPoint[], dateIso: string): number | null {
  let found: number | null = null
  for (const p of points) {
    if (p.date > dateIso) break
    if (p.value != null && Number.isFinite(p.value)) found = p.value
  }
  return found
}

/** Latest finite observation in the series. */
function latestValue(points: FredSeriesPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].value != null && Number.isFinite(points[i].value!)) return points[i].value!
  }
  return null
}

function shiftIso(dateIso: string, days: number): string {
  return new Date(new Date(`${dateIso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

const rangeText = (lo: number, hi: number): string => `${lo.toFixed(2)}%–${hi.toFixed(2)}%`

/**
 * Builds the FOMC policy-band metric for one meeting event. The value is a RANGE
 * from FRED's daily target-range series (DFEDTARL/DFEDTARU):
 *   • scheduled meeting → actual pending; previous = the current band going in.
 *   • past meeting      → actual = the band set at the meeting (effective the day
 *     after the announcement, so read a couple of days out); previous = the band
 *     in effect the day before. A "hold" correctly yields identical bands.
 * Never fabricates: if either series is missing/failed, the metric is unavailable.
 */
export function buildFomcMetric(
  event: FredCalendarEvent,
  lower: ProviderResult<FredSeriesPoint[]> | undefined,
  upper: ProviderResult<FredSeriesPoint[]> | undefined,
): EnrichedMetric {
  const base = {
    key: 'fed-funds-target',
    label: 'Fed Funds Target Range',
    unit: '%',
    decimals: 2,
    consensus: null as null,
    source: FETCH_SOURCE,
    originatingAgency: 'Federal Reserve' as EnrichmentMetric['originatingAgency'],
  }
  const unavailable: EnrichedMetric = {
    ...base, actual: null, previous: null, actualText: null, previousText: null,
    actualPeriod: null, previousPeriod: null, status: 'unavailable',
  }
  if (!lower?.ok || !upper?.ok) return unavailable

  if (event.status === 'past') {
    const after = shiftIso(event.date, 2)
    const before = shiftIso(event.date, -1)
    const loNew = valueAsOf(lower.data, after)
    const hiNew = valueAsOf(upper.data, after)
    const loOld = valueAsOf(lower.data, before)
    const hiOld = valueAsOf(upper.data, before)
    if (loNew == null || hiNew == null) return unavailable
    return {
      ...base,
      actual: hiNew,
      previous: hiOld,
      actualText: rangeText(loNew, hiNew),
      previousText: loOld != null && hiOld != null ? rangeText(loOld, hiOld) : null,
      actualPeriod: after,
      previousPeriod: loOld != null ? before : null,
      status: 'published',
    }
  }

  // Scheduled/future: the new band isn't set yet; "previous" is the current band.
  const loNow = latestValue(lower.data)
  const hiNow = latestValue(upper.data)
  if (loNow == null || hiNow == null) return unavailable
  return {
    ...base,
    actual: null,
    previous: hiNow,
    actualText: null,
    previousText: rangeText(loNow, hiNow),
    actualPeriod: null,
    previousPeriod: null,
    status: 'pending',
  }
}

/** Attaches `metrics` to every event. Events for unmapped releases get an empty metrics array. */
export function enrichEventsWithCache(
  events: FredCalendarEvent[],
  cache: Map<string, ProviderResult<FredSeriesPoint[]>>,
): EnrichedFredCalendarEvent[] {
  return events.map((e) => {
    if (e.releaseId === FOMC_RELEASE_ID) {
      return { ...e, metrics: [buildFomcMetric(e, cache.get(FOMC_LOWER_SERIES), cache.get(FOMC_UPPER_SERIES))] }
    }
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
