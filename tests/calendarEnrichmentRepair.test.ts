// R5.2 — Economic Calendar actual/previous enrichment repair.
//
// ROOT CAUSE (verified live, 2026-07-31): FRED's KEYLESS CSV graph endpoint
// (fred.stlouisfed.org/graph/fredgraph.csv) stopped serving programmatic
// requests — every request stalls until the caller's timeout (HTTP status 000,
// 0 bytes at 40s) from two independent clients (curl and Node fetch) under
// three different User-Agents, while the same machine reached Frankfurter,
// Yahoo and example.com normally and TCP:443 to FRED's own edge connected.
// Since `fetchFredSeries` was the single transport behind every enrichment
// metric, ALL of them degraded to `unavailable`. The release DATES kept
// working because they come from a different host (api.stlouisfed.org, keyed).
//
// REPAIR: `fetchFredSeries` now prefers FRED's official KEYED JSON
// observations API on api.stlouisfed.org (verified live returning real current
// data, ~300ms/series) when the server-only FRED_API_KEY is set, and keeps the
// CSV endpoint as the zero-env-var path and the fallback. Same official
// source; no new vendor, no scraping, no synthetic values.
//
// Every test below uses mocked source responses — no live external request.

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  parseFredObservations,
  parseFredCsv,
  isFredApiKeyConfigured,
  fetchFredObservationsApi,
  fetchFredSeries,
} from '../src/lib/providers/fredClient.ts'
import {
  buildEnrichedMetric,
  buildFomcMetric,
  enrichEventsWithCache,
  summarizeEnrichment,
  FOMC_RELEASE_ID,
  type EnrichedFredCalendarEvent,
} from '../src/lib/providers/calendarEnrichment.ts'
import { CALENDAR_ENRICHMENT_MAP } from '../src/config/calendarEnrichmentMap.ts'
import type { FredCalendarEvent } from '../src/lib/providers/fredReleaseCalendar.ts'
import type { FredSeriesPoint } from '../src/lib/providers/fredClient.ts'
import type { ProviderResult } from '../src/lib/providers/types.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const okSeries = (data: FredSeriesPoint[]): ProviderResult<FredSeriesPoint[]> => ({
  ok: true, data, source: 'FRED (Federal Reserve Bank of St. Louis)', lastUpdated: data[data.length - 1]?.date ?? '',
})

const evt = (over: Partial<FredCalendarEvent> = {}): FredCalendarEvent => ({
  id: 'e1', releaseId: 50, name: 'Employment Situation', date: '2026-07-02',
  category: 'Labor', importance: 'High', status: 'past',
  country: 'US', sourceUrl: 'https://fred.stlouisfed.org/releases',
  actual: null, consensus: null, prior: null, datesOnly: true,
  ...over,
} as FredCalendarEvent)

const monthly = (start: string, values: (number | null)[]): FredSeriesPoint[] => {
  const [y, m] = start.split('-').map(Number)
  return values.map((value, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    return { date: d.toISOString().slice(0, 10), value }
  })
}

// ── 1. Root cause: transport selection ──────────────────────────────────────

describe('R5.2 — transport selection (keyed observations API primary, CSV preserved)', () => {
  const originalKey = process.env.FRED_API_KEY
  const originalFetch = globalThis.fetch
  afterEach(() => {
    if (originalKey === undefined) delete process.env.FRED_API_KEY
    else process.env.FRED_API_KEY = originalKey
    globalThis.fetch = originalFetch
  })

  it('uses the keyed observations API host when FRED_API_KEY is set', async () => {
    process.env.FRED_API_KEY = 'test-key-not-real'
    const urls: string[] = []
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url))
      return new Response(JSON.stringify({ observations: [{ date: '2026-06-01', value: '4.2' }, { date: '2026-05-01', value: '4.3' }] }), { status: 200 })
    }) as typeof fetch
    const res = await fetchFredSeries('UNRATE', { startDate: '2023-01-01' })
    assert.equal(res.ok, true)
    assert.equal(urls.length, 1)
    assert.match(urls[0], /^https:\/\/api\.stlouisfed\.org\/fred\/series\/observations\?/)
    assert.match(urls[0], /series_id=UNRATE/)
    assert.match(urls[0], /observation_start=2023-01-01/)
  })

  it('falls back to the keyless CSV endpoint when the keyed request fails — a key problem never removes the source', async () => {
    process.env.FRED_API_KEY = 'test-key-not-real'
    const urls: string[] = []
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url))
      if (String(url).includes('api.stlouisfed.org')) return new Response('nope', { status: 500 })
      return new Response('observation_date,UNRATE\n2026-06-01,4.2\n', { status: 200 })
    }) as typeof fetch
    const res = await fetchFredSeries('UNRATE')
    assert.equal(res.ok, true)
    assert.equal(urls.length, 2)
    assert.match(urls[1], /^https:\/\/fred\.stlouisfed\.org\/graph\/fredgraph\.csv\?/)
  })

  it('with NO key configured it behaves exactly as before — CSV only, zero env vars still supported', async () => {
    delete process.env.FRED_API_KEY
    assert.equal(isFredApiKeyConfigured(), false)
    const urls: string[] = []
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url))
      return new Response('observation_date,UNRATE\n2026-06-01,4.2\n', { status: 200 })
    }) as typeof fetch
    const res = await fetchFredSeries('UNRATE')
    assert.equal(res.ok, true)
    assert.deepEqual(urls.map((u) => new URL(u).host), ['fred.stlouisfed.org'])
  })

  it('the API key never appears in a failure reason (it is a query param — it must not leak into logs or responses)', async () => {
    process.env.FRED_API_KEY = 'super-secret-key-value'
    globalThis.fetch = (async () => new Response('denied', { status: 403 })) as typeof fetch
    const viaApi = await fetchFredObservationsApi('UNRATE')
    assert.equal(viaApi.ok, false)
    assert.ok(!JSON.stringify(viaApi).includes('super-secret-key-value'))
    assert.match(viaApi.reason!, /HTTP 403/)
  })

  it('returns a structured failure (never throws) when the key is absent on the API-only path', async () => {
    delete process.env.FRED_API_KEY
    const res = await fetchFredObservationsApi('UNRATE')
    assert.equal(res.ok, false)
    assert.match(res.reason!, /not configured/i)
  })

  it('the client is server-only: the key is read from a non-public env var and never NEXT_PUBLIC_', () => {
    const src = read('src/lib/providers/fredClient.ts')
    assert.match(src, /process\.env\.FRED_API_KEY/)
    assert.ok(!src.includes('NEXT_PUBLIC_FRED_API_KEY'))
    assert.ok(!/console\.(log|warn|error)/.test(src), 'never logs (the URL carries the key)')
  })
})

// ── 2. Observation parsing (JSON transport) ─────────────────────────────────

describe('R5.2 — keyed observations parsing matches the CSV contract', () => {
  it('parses real-shaped observations into normalized points', () => {
    const pts = parseFredObservations({
      observations: [
        { date: '2026-05-01', value: '4.3' },
        { date: '2026-06-01', value: '4.2' },
      ],
    })
    assert.deepEqual(pts, [{ date: '2026-05-01', value: 4.3 }, { date: '2026-06-01', value: 4.2 }])
  })

  it('missing observations ("." marker) become null, NOT zero', () => {
    const pts = parseFredObservations({ observations: [{ date: '2026-06-01', value: '.' }] })
    assert.equal(pts[0].value, null)
    assert.notEqual(pts[0].value, 0)
  })

  it('a genuine zero stays zero and never becomes unavailable', () => {
    const pts = parseFredObservations({ observations: [{ date: '2026-06-01', value: '0.0' }] })
    assert.equal(pts[0].value, 0)
    assert.notEqual(pts[0].value, null)
  })

  it('negative values (e.g. trade balance) survive intact', () => {
    const pts = parseFredObservations({ observations: [{ date: '2026-05-01', value: '-77585' }] })
    assert.equal(pts[0].value, -77585)
  })

  it('a malformed entry is skipped, never fatal; a non-numeric value is null', () => {
    const pts = parseFredObservations({ observations: [{ date: 'nope', value: '1' }, { date: '2026-06-01', value: 'x' }] })
    assert.equal(pts.length, 1)
    assert.equal(pts[0].value, null)
  })

  it('a non-observations payload yields an empty series rather than throwing', () => {
    assert.deepEqual(parseFredObservations({}), [])
    assert.deepEqual(parseFredObservations(null), [])
  })

  it('both transports produce identical points for the same data', () => {
    const fromCsv = parseFredCsv('observation_date,UNRATE\n2026-05-01,4.3\n2026-06-01,.\n')
    const fromApi = parseFredObservations({ observations: [{ date: '2026-05-01', value: '4.3' }, { date: '2026-06-01', value: '.' }] })
    assert.deepEqual(fromApi, fromCsv)
  })
})

// ── 3. Actual / previous population ─────────────────────────────────────────

describe('R5.2 — past releases populate Actual and Previous', () => {
  const unrate = CALENDAR_ENRICHMENT_MAP[50].find((m) => m.key === 'unemployment-rate')!
  const cpiYoy = CALENDAR_ENRICHMENT_MAP[10].find((m) => m.key === 'cpi-yoy')!
  const cpiMom = CALENDAR_ENRICHMENT_MAP[10].find((m) => m.key === 'cpi-mom')!
  const nfp = CALENDAR_ENRICHMENT_MAP[50].find((m) => m.key === 'nonfarm-payrolls')!
  const gdp = CALENDAR_ENRICHMENT_MAP[53][0]

  it('a monthly level metric maps the latest print to Actual and the prior print to Previous', () => {
    const m = buildEnrichedMetric(unrate, okSeries(monthly('2026-04-01', [4.4, 4.3, 4.2])), 'past')
    assert.equal(m.status, 'published')
    assert.equal(m.actual, 4.2)
    assert.equal(m.actualPeriod, '2026-06-01')
    assert.equal(m.previous, 4.3)
    assert.equal(m.previousPeriod, '2026-05-01')
  })

  it('a future release has no Actual, but keeps a real Previous', () => {
    const m = buildEnrichedMetric(unrate, okSeries(monthly('2026-04-01', [4.4, 4.3, 4.2])), 'scheduled')
    assert.equal(m.status, 'pending')
    assert.equal(m.actual, null)
    assert.equal(m.actualPeriod, null)
    assert.equal(m.previous, 4.2)
    assert.equal(m.previousPeriod, '2026-06-01')
  })

  it('a quarterly metric (GDP) maps to quarterly observation periods, not monthly', () => {
    const pts = [
      { date: '2025-10-01', value: 2.4 }, { date: '2026-01-01', value: 2.1 }, { date: '2026-04-01', value: 1.5 },
    ]
    const m = buildEnrichedMetric(gdp, okSeries(pts), 'past')
    assert.equal(m.actual, 1.5)
    assert.equal(m.actualPeriod, '2026-04-01')
    assert.equal(m.previousPeriod, '2026-01-01')
    const monthsApart = (a: string, b: string) => {
      const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number)
      return (by - ay) * 12 + (bm - am)
    }
    assert.equal(monthsApart(m.previousPeriod!, m.actualPeriod!), 3, 'consecutive quarterly periods')
  })

  it('a y/y metric derives from the same-month base a year earlier (approved transform)', () => {
    const pts = monthly('2025-06-01', [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 103])
    const m = buildEnrichedMetric(cpiYoy, okSeries(pts), 'past')
    assert.equal(m.status, 'published')
    assert.ok(Math.abs(m.actual! - 3) < 1e-9, `expected ~3% y/y, got ${m.actual}`)
    assert.equal(m.actualPeriod, '2026-06-01')
  })

  it('an m/m metric derives from the immediately preceding month (approved transform)', () => {
    const m = buildEnrichedMetric(cpiMom, okSeries(monthly('2026-04-01', [100, 100, 102])), 'past')
    assert.ok(Math.abs(m.actual! - 2) < 1e-9, `expected ~2% m/m, got ${m.actual}`)
  })

  it('the NFP headline is the month-over-month CHANGE (level-diff), never the raw level', () => {
    const m = buildEnrichedMetric(nfp, okSeries(monthly('2026-04-01', [158_800, 158_927, 158_984])), 'past')
    assert.equal(m.actual, 57)
    assert.equal(m.previous, 127)
    assert.ok(m.actual! < 1000, 'must be a change in thousands, not the ~159,000 level')
  })

  it('a series with no derivable period is honestly unavailable, never a fabricated value', () => {
    // A single observation gives y/y no base at all → the transform drops it.
    const m = buildEnrichedMetric(cpiYoy, okSeries(monthly('2026-06-01', [100])), 'past')
    assert.equal(m.status, 'unavailable')
    assert.equal(m.actual, null)
    assert.equal(m.unavailableReason, 'period-not-found')
  })

  it('the fetch window requests ~3 years, so a y/y metric always has a true same-month base in production', () => {
    // Guards the pre-existing `yearAgo` behaviour: it picks the NEAREST
    // available base, which is only equal to the same month a year earlier
    // when the series actually spans a year — which the enrichment fetch
    // window guarantees. Documented as a latent edge, not introduced here.
    const src = read('src/lib/providers/calendarEnrichment.ts')
    assert.match(src, /d\.setFullYear\(d\.getFullYear\(\) - 3\)/)
  })
})

// ── 4. Failure isolation and status semantics ───────────────────────────────

describe('R5.2 — failure classes stay distinguishable, never collapsed', () => {
  const unrate = CALENDAR_ENRICHMENT_MAP[50].find((m) => m.key === 'unemployment-rate')!

  it('a never-fetched series is source-unavailable; a failed fetch is source-error', () => {
    assert.equal(buildEnrichedMetric(unrate, undefined, 'past').unavailableReason, 'source-unavailable')
    assert.equal(buildEnrichedMetric(unrate, { ok: false, reason: 'timeout' }, 'past').unavailableReason, 'source-error')
  })

  it('a successful metric carries no unavailableReason (diagnostic field is failure-only)', () => {
    const m = buildEnrichedMetric(unrate, okSeries(monthly('2026-05-01', [4.3, 4.2])), 'past')
    assert.equal(m.unavailableReason, undefined)
  })

  it('one unavailable metric never erases an available sibling in the same event', () => {
    const cache = new Map<string, ProviderResult<FredSeriesPoint[]>>([
      ['UNRATE', okSeries(monthly('2026-05-01', [4.3, 4.2]))],
      ['PAYEMS', { ok: false, reason: 'source down' }],
    ])
    const [enriched] = enrichEventsWithCache([evt()], cache)
    assert.equal(enriched.metrics.length, 2)
    const byKey = Object.fromEntries(enriched.metrics.map((m) => [m.key, m]))
    assert.equal(byKey['unemployment-rate'].status, 'published')
    assert.equal(byKey['unemployment-rate'].actual, 4.2)
    assert.equal(byKey['nonfarm-payrolls'].status, 'unavailable')
  })

  it('a total source failure still returns every event (dates never disappear) — distinct from an empty calendar', () => {
    const events = enrichEventsWithCache([evt(), evt({ id: 'e2', releaseId: 10, name: 'CPI', date: '2026-07-14' })], new Map())
    assert.equal(events.length, 2)
    assert.ok(events.every((e) => e.metrics.every((m) => m.status === 'unavailable')))
    assert.notDeepEqual(events, [])
  })

  it('an unmapped release keeps zero metrics rather than fabricated ones (ADP / Existing Home Sales)', () => {
    const [adp] = enrichEventsWithCache([evt({ releaseId: 194, name: 'ADP National Employment Report' })], new Map())
    assert.deepEqual(adp.metrics, [])
    assert.ok(!(194 in CALENDAR_ENRICHMENT_MAP), 'ADP stays excluded — its FRED series is stale')
    assert.ok(!(291 in CALENDAR_ENRICHMENT_MAP), 'Existing Home Sales stays excluded — NAR, not a government agency')
  })
})

// ── 5. FOMC range semantics ─────────────────────────────────────────────────

describe('R5.2 — FOMC target range keeps range semantics', () => {
  const band = (lo: number, hi: number) => ({
    lower: okSeries([{ date: '2026-07-27', value: lo }, { date: '2026-07-31', value: lo }]),
    upper: okSeries([{ date: '2026-07-27', value: hi }, { date: '2026-07-31', value: hi }]),
  })

  it('a past meeting renders a RANGE, never an invented midpoint', () => {
    const { lower, upper } = band(3.5, 3.75)
    const m = buildFomcMetric(evt({ releaseId: FOMC_RELEASE_ID, date: '2026-07-29', name: 'FOMC' }), lower, upper)
    assert.equal(m.status, 'published')
    assert.equal(m.actualText, '3.50%–3.75%')
    assert.equal(m.actual, 3.75, 'numeric consumers get the upper bound, not a midpoint')
    assert.notEqual(m.actual, 3.625)
  })

  it('a scheduled meeting is pending with the current band as previous', () => {
    const { lower, upper } = band(3.5, 3.75)
    const m = buildFomcMetric(evt({ releaseId: FOMC_RELEASE_ID, date: '2026-12-09', status: 'scheduled' }), lower, upper)
    assert.equal(m.status, 'pending')
    assert.equal(m.actualText, null)
    assert.equal(m.previousText, '3.50%–3.75%')
  })

  it('a missing target-range series is honestly unavailable with a diagnostic reason', () => {
    const m = buildFomcMetric(evt({ releaseId: FOMC_RELEASE_ID }), undefined, undefined)
    assert.equal(m.status, 'unavailable')
    assert.equal(m.unavailableReason, 'source-unavailable')
    assert.equal(m.actualText, null)
  })
})

// ── 6. Contract, integrity and presentation guarantees ──────────────────────

describe('R5.2 — data-integrity and contract guarantees hold', () => {
  it('consensus is structurally null on every metric, published or not', () => {
    const cache = new Map<string, ProviderResult<FredSeriesPoint[]>>([['UNRATE', okSeries(monthly('2026-05-01', [4.3, 4.2]))]])
    const [e] = enrichEventsWithCache([evt()], cache)
    assert.ok(e.metrics.every((m) => m.consensus === null))
    const src = read('src/lib/providers/calendarEnrichment.ts')
    assert.ok(!/forecast|surprise|beatMiss/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), 'no forecast/surprise machinery')
  })

  it('the endpoint stays date-only and never claims consensus availability', () => {
    const route = read('src/app/api/macro/fred-release-calendar/route.ts')
    assert.match(route, /datesOnly: true/)
    assert.match(route, /consensusAvailable: false/)
  })

  it('no release time is fabricated — events carry a date only', () => {
    const provider = read('src/lib/providers/fredReleaseCalendar.ts')
    assert.ok(!/releaseTime|\btime:\s*'/.test(provider))
  })

  it('no hardcoded production release value was introduced anywhere in the repaired path', () => {
    const strip = (s: string) => s.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
    for (const f of ['src/lib/providers/fredClient.ts', 'src/lib/providers/calendarEnrichment.ts', 'src/config/calendarEnrichmentMap.ts']) {
      const code = strip(read(f))
      assert.ok(!/158984|4\.2\b.*actual|3\.46/.test(code), `${f} must not embed a real observation value`)
    }
  })

  it('only official FRED hosts are contacted — no unofficial or vendor calendar source', () => {
    const client = read('src/lib/providers/fredClient.ts')
    const hosts = [...client.matchAll(/https:\/\/([a-z.]+)\//g)].map((m) => m[1])
    for (const h of hosts) {
      assert.ok(h.endsWith('stlouisfed.org') || h.endsWith('vercel.app'), `unexpected host ${h}`)
    }
    assert.ok(!/investing\.com|forexpros|tradingeconomics|fedwatch/i.test(client))
  })

  it('source labelling still names FRED as the fetched source on every metric', () => {
    const cache = new Map<string, ProviderResult<FredSeriesPoint[]>>([['UNRATE', okSeries(monthly('2026-05-01', [4.3, 4.2]))]])
    const [e] = enrichEventsWithCache([evt()], cache)
    assert.ok(e.metrics.every((m) => m.source === 'FRED (Federal Reserve Bank of St. Louis)'))
    assert.equal(e.metrics[0].originatingAgency, 'BLS', 'originating agency stays provenance-only')
  })

  it('enrichment never reorders events — chronology is the calendar table\'s own guarantee', () => {
    const events = enrichEventsWithCache(
      [evt({ id: 'a', date: '2026-07-02', importance: 'Low' }), evt({ id: 'b', date: '2026-07-14', importance: 'High' })],
      new Map(),
    )
    assert.deepEqual(events.map((e) => e.id), ['a', 'b'])
    const table = read('src/components/macro/EconomicCalendarTable.tsx')
    assert.match(table, /events\.slice\(\)\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\)/)
  })

  it('the R5/R5.1 presentation is untouched — relevance bars and honest unavailable rendering remain', () => {
    const table = read('src/components/macro/EconomicCalendarTable.tsx')
    assert.match(table, /<RelevanceBars importance=\{r\.event\.importance\}\s*\/>/)
    assert.match(table, /const FILLED: Record<EnrichedFredCalendarEvent\['importance'\], number> = \{ Low: 1, Medium: 2, High: 3 \}/)
    // populated values render; unavailable stays an explicit em dash / pending word
    assert.match(table, /m\.actualText \?\? fmtValue\(m\.actual, m\.unit, m\.decimals\)/)
    assert.match(table, /m\.status === 'unavailable' \? <span className="text-muted-fg">—<\/span>/)
    assert.match(table, /pending \? <span className="text-muted-fg" title=\{t\.cal\.pendingTitle\}>\{t\.cal\.pending\}<\/span>/)
  })

  it('Chile releases are still never fabricated', () => {
    const page = read('src/app/macro/calendar/page.tsx')
    assert.match(page, /t\.cal\.chileUnavailable/)
    assert.ok(!/from ['"]@\/lib\/data\/calendar['"]/.test(page))
  })

  it('the summary counts every status so a regression is visible in the cron diagnostics', () => {
    const cache = new Map<string, ProviderResult<FredSeriesPoint[]>>([['UNRATE', okSeries(monthly('2026-05-01', [4.3, 4.2]))]])
    const s = summarizeEnrichment(enrichEventsWithCache([evt()], cache) as EnrichedFredCalendarEvent[])
    assert.equal(s.published + s.pending + s.unavailable, s.metricsTotal)
    assert.equal(s.published, 1)
    assert.equal(s.unavailable, 1)
  })
})

// ── 7. Cache behaviour ──────────────────────────────────────────────────────

describe('R5.2 — no stale "unavailable" can be cached', () => {
  it('the calendar route is force-dynamic, so a failed enrichment is never retained', () => {
    const route = read('src/app/api/macro/fred-release-calendar/route.ts')
    assert.match(route, /export const dynamic = 'force-dynamic'/)
  })

  it('both FRED transports send cache: no-store, so a stalled response cannot be replayed', () => {
    const client = read('src/lib/providers/fredClient.ts')
    assert.equal(client.split("cache: 'no-store'").length - 1, 2, 'CSV and observations transports both bypass the fetch cache')
  })

  it('enrichment holds no module-level result cache — the series map is built per call', () => {
    const src = read('src/lib/providers/calendarEnrichment.ts')
    assert.match(src, /const cache = await fetchSeriesCache\(fetcher\)/)
    assert.ok(!/^(const|let)\s+\w*[Cc]ache\w*\s*=\s*new Map/m.test(src), 'no module-scope cache to go stale')
  })
})
