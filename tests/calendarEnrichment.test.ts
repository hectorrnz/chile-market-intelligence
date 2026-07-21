// Phase 8D.3 — Calendar actual/previous enrichment tests.
//
// Pure/mocked only — NO live network. FRED fetches are injected via a stub
// SeriesFetcher so the tests are deterministic and offline.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformSeries, deriveValueChange } from '../src/lib/providers/transforms.ts'
import {
  CALENDAR_ENRICHMENT_MAP,
  enrichmentSeriesIds,
  type OriginatingAgency,
} from '../src/config/calendarEnrichmentMap.ts'
import {
  buildEnrichedMetric,
  buildFomcMetric,
  enrichEventsWithCache,
  resolveCalendarEnrichment,
  summarizeEnrichment,
  FOMC_RELEASE_ID,
  type SeriesFetcher,
} from '../src/lib/providers/calendarEnrichment.ts'
import type { FredCalendarEvent } from '../src/lib/providers/fredReleaseCalendar.ts'
import type { FredSeriesPoint } from '../src/lib/providers/fredClient.ts'
import type { ProviderResult } from '../src/lib/providers/types.ts'

const ROOT = join(import.meta.dirname, '..')

// ── level-diff transform (NFP) ───────────────────────────────────────────────

test('level-diff transform: absolute period-over-period change of a level series', () => {
  const pts = [
    { date: '2026-04-01', value: 158798 },
    { date: '2026-05-01', value: 158927 },
    { date: '2026-06-01', value: 158984 },
  ]
  const series = transformSeries(pts, 'level-diff')
  // First point has no prior → dropped; then +129, +57.
  assert.deepEqual(series, [
    { date: '2026-05-01', value: 129 },
    { date: '2026-06-01', value: 57 },
  ])
})

test('level-diff via deriveValueChange: value is latest diff, never the raw level', () => {
  const pts = [
    { date: '2026-04-01', value: 158798 },
    { date: '2026-05-01', value: 158927 },
    { date: '2026-06-01', value: 158984 },
  ]
  const d = deriveValueChange(pts, 'level-diff')
  assert.equal(d?.value, 57) // +57K, NOT 158984
  assert.equal(d?.asOf, '2026-06-01')
})

test('level-diff with a single observation yields no derivable point', () => {
  assert.deepEqual(transformSeries([{ date: '2026-06-01', value: 158984 }], 'level-diff'), [])
})

// ── enrichment map shape ─────────────────────────────────────────────────────

const AGENCIES: OriginatingAgency[] = ['BLS', 'BEA', 'Census', 'Federal Reserve', 'FRED']
const TRANSFORMS = new Set(['none', 'yoy', 'mom', 'level-to-yoy', 'bp-to-pct', 'level-diff'])

test('every mapped metric has a well-formed, non-guessed shape', () => {
  for (const [releaseId, metrics] of Object.entries(CALENDAR_ENRICHMENT_MAP)) {
    assert.ok(Number.isFinite(Number(releaseId)), 'release id numeric')
    assert.ok(metrics.length > 0)
    const keys = new Set<string>()
    for (const m of metrics) {
      assert.ok(m.key && !keys.has(m.key), `metric keys unique within release ${releaseId}`)
      keys.add(m.key)
      assert.ok(m.fredSeriesId.length > 0, 'has a FRED series id')
      assert.ok(TRANSFORMS.has(m.transform), `transform ${m.transform} is known`)
      assert.ok(AGENCIES.includes(m.originatingAgency), 'agency in enum')
      assert.ok(typeof m.unit === 'string')
      assert.ok(Number.isInteger(m.decimals) && m.decimals >= 0)
    }
  }
})

test('multi-metric releases expose >1 metric (CPI, Employment Situation, PCE)', () => {
  assert.equal(CALENDAR_ENRICHMENT_MAP[10].length, 2) // CPI y/y + m/m
  assert.equal(CALENDAR_ENRICHMENT_MAP[50].length, 2) // NFP + unemployment
  assert.equal(CALENDAR_ENRICHMENT_MAP[54].length, 2) // PCE + core PCE
})

test('NFP uses PAYEMS level-diff (monthly change, never raw level)', () => {
  const nfp = CALENDAR_ENRICHMENT_MAP[50].find((m) => m.key === 'nonfarm-payrolls')
  assert.equal(nfp?.fredSeriesId, 'PAYEMS')
  assert.equal(nfp?.transform, 'level-diff')
  assert.equal(nfp?.unit, 'K')
})

test('ADP (194) and Existing Home Sales (291) have no enrichment (stale/non-govt) — never fabricated', () => {
  assert.equal(CALENDAR_ENRICHMENT_MAP[194], undefined)
  assert.equal(CALENDAR_ENRICHMENT_MAP[291], undefined)
})

test('enrichmentSeriesIds dedupes shared series (CPIAUCSL used by both CPI metrics)', () => {
  const ids = enrichmentSeriesIds()
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids')
  assert.equal(ids.filter((id) => id === 'CPIAUCSL').length, 1)
  assert.ok(ids.includes('PAYEMS') && ids.includes('A191RL1Q225SBEA'))
})

// ── buildEnrichedMetric ──────────────────────────────────────────────────────

const cpiMetric = CALENDAR_ENRICHMENT_MAP[10][0] // cpi-yoy CPIAUCSL yoy
function okSeries(pts: FredSeriesPoint[]): ProviderResult<FredSeriesPoint[]> {
  return { ok: true, data: pts, source: 'FRED', lastUpdated: pts[pts.length - 1]?.date ?? '' }
}

// 14 monthly index points (2025-01 … 2026-02) so yoy is derivable for the last two.
const cpiPts: FredSeriesPoint[] = Array.from({ length: 14 }, (_, i) => ({
  date: new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 10),
  value: 300 + i, // steadily rising index level
}))

test('past event → published: actual = latest print, previous = prior print', () => {
  const m = buildEnrichedMetric(cpiMetric, okSeries(cpiPts), 'past')
  assert.equal(m.status, 'published')
  assert.ok(m.actual != null && m.previous != null)
  assert.ok(m.actualPeriod && m.previousPeriod && m.actualPeriod > m.previousPeriod)
  assert.equal(m.consensus, null)
  assert.equal(m.source, 'FRED (Federal Reserve Bank of St. Louis)')
})

test('scheduled event → pending: actual null, previous = last published print', () => {
  const m = buildEnrichedMetric(cpiMetric, okSeries(cpiPts), 'scheduled')
  assert.equal(m.status, 'pending')
  assert.equal(m.actual, null)
  assert.equal(m.actualPeriod, null)
  assert.ok(m.previous != null && m.previousPeriod != null)
})

test('failed series → unavailable, both values null', () => {
  const m = buildEnrichedMetric(cpiMetric, { ok: false, reason: 'boom' }, 'past')
  assert.equal(m.status, 'unavailable')
  assert.equal(m.actual, null)
  assert.equal(m.previous, null)
})

test('missing series in cache → unavailable', () => {
  const m = buildEnrichedMetric(cpiMetric, undefined, 'past')
  assert.equal(m.status, 'unavailable')
})

test('enriched metric never carries a forecast/surprise/consensus value field', () => {
  const m = buildEnrichedMetric(cpiMetric, okSeries(cpiPts), 'past')
  assert.equal(m.consensus, null)
  assert.ok(!('forecast' in m))
  assert.ok(!('surprise' in m))
})

// ── enrichEventsWithCache + summarize ────────────────────────────────────────

function ev(releaseId: number, date: string, status: FredCalendarEvent['status']): FredCalendarEvent {
  return {
    id: `${releaseId}-${date}`, date, releaseId, releaseName: 'x', name: 'x',
    category: 'Inflation', region: 'US', importance: 'High',
    source: 'FRED', sourceUrl: 'https://fred', status,
    datesOnly: true, actual: null, consensus: null, prior: null,
  }
}

test('unmapped release → empty metrics array (dates-only, honest)', () => {
  const cache = new Map<string, ProviderResult<FredSeriesPoint[]>>()
  const [e] = enrichEventsWithCache([ev(194, '2026-07-15', 'scheduled')], cache)
  assert.deepEqual(e.metrics, [])
})

test('summarizeEnrichment counts published/pending/unavailable and per-agency', () => {
  const cache = new Map<string, ProviderResult<FredSeriesPoint[]>>([
    ['CPIAUCSL', okSeries(cpiPts)],
  ])
  const enriched = enrichEventsWithCache([ev(10, '2026-01-10', 'past')], cache)
  const s = summarizeEnrichment(enriched)
  assert.equal(s.eventsTotal, 1)
  assert.equal(s.metricsTotal, 2) // CPI y/y + m/m
  assert.equal(s.published, 2)
  assert.equal(s.pending, 0)
  assert.equal(s.byAgency.BLS, 2)
})

// ── resolveCalendarEnrichment (injected fetcher, offline) ─────────────────────

test('resolveCalendarEnrichment: empty events → empty result (no fetches)', async () => {
  let called = 0
  const fetcher: SeriesFetcher = async () => { called++; return okSeries(cpiPts) }
  const out = await resolveCalendarEnrichment([], fetcher)
  assert.deepEqual(out, [])
  assert.equal(called, 0)
})

test('resolveCalendarEnrichment: a fetcher that THROWS for one series degrades to unavailable, never crashes', async () => {
  const fetcher: SeriesFetcher = async (id) => {
    if (id === 'PAYEMS') throw new Error('network down')
    return okSeries(cpiPts)
  }
  const events = [ev(10, '2026-01-10', 'past'), ev(50, '2026-01-09', 'past')]
  const out = await resolveCalendarEnrichment(events, fetcher)
  const employment = out.find((e) => e.releaseId === 50)!
  const nfp = employment.metrics.find((m) => m.key === 'nonfarm-payrolls')!
  assert.equal(nfp.status, 'unavailable') // PAYEMS threw
  // CPI still resolved fine from the non-throwing series.
  const cpi = out.find((e) => e.releaseId === 10)!
  assert.ok(cpi.metrics.every((m) => m.status === 'published'))
})

// ── FOMC policy-band enrichment (release 101) ────────────────────────────────

// Daily target-range series: band was 4.00–4.25% until 2026-06-19, then cut to
// 3.50–3.75% effective 2026-06-19 (announced at the 2026-06-17 meeting).
const dfedtarl: FredSeriesPoint[] = [
  { date: '2026-06-16', value: 4.00 },
  { date: '2026-06-17', value: 4.00 },
  { date: '2026-06-18', value: 4.00 },
  { date: '2026-06-19', value: 3.50 },
  { date: '2026-07-20', value: 3.50 },
]
const dfedtaru: FredSeriesPoint[] = [
  { date: '2026-06-16', value: 4.25 },
  { date: '2026-06-17', value: 4.25 },
  { date: '2026-06-18', value: 4.25 },
  { date: '2026-06-19', value: 3.75 },
  { date: '2026-07-20', value: 3.75 },
]

test('buildFomcMetric: scheduled meeting → actual pending, previous = current band', () => {
  const m = buildFomcMetric(ev(FOMC_RELEASE_ID, '2026-07-29', 'scheduled'), okSeries(dfedtarl), okSeries(dfedtaru))
  assert.equal(m.status, 'pending')
  assert.equal(m.actual, null)
  assert.equal(m.actualText, null)
  assert.equal(m.previousText, '3.50%–3.75%')
  assert.equal(m.label, 'Fed Funds Target Range')
  assert.equal(m.originatingAgency, 'Federal Reserve')
})

test('buildFomcMetric: past meeting → actual = band set at meeting, previous = band going in', () => {
  const m = buildFomcMetric(ev(FOMC_RELEASE_ID, '2026-06-17', 'past'), okSeries(dfedtarl), okSeries(dfedtaru))
  assert.equal(m.status, 'published')
  assert.equal(m.actualText, '3.50%–3.75%')  // read a couple days out (effective 06-19)
  assert.equal(m.previousText, '4.00%–4.25%') // day before the meeting
})

test('buildFomcMetric: missing series → unavailable, never fabricated', () => {
  const m = buildFomcMetric(ev(FOMC_RELEASE_ID, '2026-07-29', 'scheduled'), undefined, okSeries(dfedtaru))
  assert.equal(m.status, 'unavailable')
  assert.equal(m.actualText, null)
  assert.equal(m.previousText, null)
})

test('enrichEventsWithCache: FOMC event (101) gets a policy-band metric, not empty metrics', () => {
  const cache = new Map<string, ProviderResult<FredSeriesPoint[]>>([
    ['DFEDTARL', okSeries(dfedtarl)],
    ['DFEDTARU', okSeries(dfedtaru)],
  ])
  const [e] = enrichEventsWithCache([ev(FOMC_RELEASE_ID, '2026-07-29', 'scheduled')], cache)
  assert.equal(e.metrics.length, 1)
  assert.equal(e.metrics[0].key, 'fed-funds-target')
  assert.equal(e.metrics[0].previousText, '3.50%–3.75%')
})

// ── cron route + hygiene (source assertions) ─────────────────────────────────

const CRON_ROUTE = join(ROOT, 'src/app/api/cron/refresh-calendar-enrichment/route.ts')
const MAP_FILE = join(ROOT, 'src/config/calendarEnrichmentMap.ts')
const ENRICH_FILE = join(ROOT, 'src/lib/providers/calendarEnrichment.ts')
const CLIENT_HELPER = join(ROOT, 'src/lib/data/fredCalendar.ts')
const VERCEL = join(ROOT, 'vercel.json')

test('cron route is Bearer CRON_SECRET protected and 500s without the secret', () => {
  const src = readFileSync(CRON_ROUTE, 'utf8')
  assert.match(src, /Bearer \$\{secret\}/)
  assert.match(src, /CRON_SECRET/)
  assert.match(src, /status:\s*401/)
})

test('cron route never returns FRED_API_KEY or a raw payload', () => {
  const src = readFileSync(CRON_ROUTE, 'utf8')
  assert.doesNotMatch(src, /FRED_API_KEY/)
  assert.match(src, /summarizeEnrichment/)
})

test('vercel.json schedules the weekday post-close refresh at 30 22 * * 1-5', () => {
  const json = JSON.parse(readFileSync(VERCEL, 'utf8')) as { crons: Array<{ path: string; schedule: string }> }
  const cron = json.crons.find((c) => c.path === '/api/cron/refresh-calendar-enrichment')
  assert.ok(cron, 'refresh-calendar-enrichment cron present')
  assert.equal(cron!.schedule, '30 22 * * 1-5')
})

test('no server-side FRED key is referenced by the enrichment map, resolver, or client helper', () => {
  assert.doesNotMatch(readFileSync(MAP_FILE, 'utf8'), /FRED_API_KEY/)
  assert.doesNotMatch(readFileSync(ENRICH_FILE, 'utf8'), /FRED_API_KEY/)
  assert.doesNotMatch(readFileSync(CLIENT_HELPER, 'utf8'), /FRED_API_KEY/)
})

test('enrichment map documents the FRED-normalized / BLS-BEA-Census-deferred decision', () => {
  const src = readFileSync(MAP_FILE, 'utf8')
  assert.match(src, /VERIFIED LIVE/)
  assert.match(src, /never guessed|never-guess/i)
  assert.match(src, /DEFERRED/)
})
