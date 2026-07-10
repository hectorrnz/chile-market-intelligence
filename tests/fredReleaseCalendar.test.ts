// Phase 8D.1 — Unit tests for the dates-only FRED release calendar.
// No live network calls — fetch is stubbed per-test where a network path is
// exercised; the "not configured" path needs no stub since it short-circuits
// before any fetch. FRED_API_KEY is temporarily unset/reset per test via
// try/finally so this file never depends on (or leaks) a real key.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { FRED_RELEASE_ALLOWLIST } from '../src/config/fredReleaseAllowlist.ts'
import {
  isFredCalendarConfigured,
  fetchFredReleaseDates,
} from '../src/lib/providers/fredReleaseCalendarClient.ts'
import { resolveFredReleaseCalendar } from '../src/lib/providers/fredReleaseCalendar.ts'

const ORIGINAL_KEY = process.env.FRED_API_KEY
const ORIGINAL_FETCH = globalThis.fetch

function restoreEnv() {
  if (ORIGINAL_KEY === undefined) delete process.env.FRED_API_KEY
  else process.env.FRED_API_KEY = ORIGINAL_KEY
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH
}

describe('FRED_RELEASE_ALLOWLIST — curated, no noisy releases', () => {
  it('every entry has a positive integer releaseId and non-empty names', () => {
    for (const e of FRED_RELEASE_ALLOWLIST) {
      assert.ok(Number.isInteger(e.releaseId) && e.releaseId > 0, `${e.name}: bad releaseId`)
      assert.ok(e.name.length > 0)
      assert.ok(e.fredReleaseName.length > 0)
      assert.ok(['High', 'Medium', 'Low'].includes(e.importance))
    }
  })

  it('release ids are unique (no duplicate curated entries)', () => {
    const ids = FRED_RELEASE_ALLOWLIST.map((e) => e.releaseId)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('excludes FOMC Press Release (101) and H.15 Selected Interest Rates (18) — verified noisy in live discovery', () => {
    const ids = FRED_RELEASE_ALLOWLIST.map((e) => e.releaseId)
    assert.ok(!ids.includes(101), 'release 101 (FOMC Press Release) must stay excluded — near-daily noise')
    assert.ok(!ids.includes(18), 'release 18 (H.15) must stay excluded — near-daily noise')
  })

  it('includes the core target releases (CPI, GDP, Employment Situation, Retail Sales)', () => {
    const names = FRED_RELEASE_ALLOWLIST.map((e) => e.fredReleaseName)
    assert.ok(names.includes('Consumer Price Index'))
    assert.ok(names.includes('Gross Domestic Product'))
    assert.ok(names.includes('Employment Situation'))
    assert.ok(names.includes('Advance Monthly Sales for Retail and Food Services'))
  })

  it('every category is one of the documented target categories', () => {
    const allowed = new Set([
      'Inflation', 'Labor', 'Monetary Policy', 'GDP/Growth',
      'Retail/Consumer', 'Housing', 'Trade', 'Industrial Production',
    ])
    for (const e of FRED_RELEASE_ALLOWLIST) {
      assert.ok(allowed.has(e.category), `${e.name}: unexpected category "${e.category}"`)
    }
  })
})

describe('isFredCalendarConfigured', () => {
  beforeEach(() => { delete process.env.FRED_API_KEY })
  afterEach(restoreEnv)

  it('is false with no FRED_API_KEY set', () => {
    assert.equal(isFredCalendarConfigured(), false)
  })

  it('is true once FRED_API_KEY is set', () => {
    process.env.FRED_API_KEY = 'fake-test-key-not-real'
    assert.equal(isFredCalendarConfigured(), true)
  })
})

describe('fetchFredReleaseDates — missing key path (no network)', () => {
  beforeEach(() => { delete process.env.FRED_API_KEY })
  afterEach(restoreEnv)

  it('returns ok:false without making a network call when FRED_API_KEY is unset', async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; throw new Error('should not be called') }) as typeof fetch
    try {
      const res = await fetchFredReleaseDates(10, { start: '2026-01-01', end: '2026-02-01' })
      assert.equal(res.ok, false)
      if (!res.ok) assert.match(res.reason, /FRED_API_KEY not configured/)
      assert.equal(fetchCalled, false)
    } finally {
      restoreFetch()
    }
  })
})

describe('fetchFredReleaseDates — mocked success/failure (no live network)', () => {
  beforeEach(() => { process.env.FRED_API_KEY = 'fake-test-key-not-real' })
  afterEach(() => { restoreEnv(); restoreFetch() })

  it('parses a well-formed release_dates response into FredReleaseDate[]', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        release_dates: [
          { release_id: 10, date: '2026-07-14' },
          { release_id: 10, date: '2026-08-12' },
        ],
      }),
    })) as unknown as typeof fetch

    const res = await fetchFredReleaseDates(10, { start: '2026-01-01', end: '2026-12-31' })
    assert.equal(res.ok, true)
    if (res.ok) {
      assert.deepEqual(res.data, [
        { releaseId: 10, date: '2026-07-14' },
        { releaseId: 10, date: '2026-08-12' },
      ])
      assert.match(res.source, /FRED/)
    }
  })

  it('filters out malformed dates rather than throwing', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        release_dates: [
          { release_id: 10, date: 'not-a-date' },
          { release_id: 10, date: '2026-07-14' },
        ],
      }),
    })) as unknown as typeof fetch

    const res = await fetchFredReleaseDates(10, { start: '2026-01-01', end: '2026-12-31' })
    assert.equal(res.ok, true)
    if (res.ok) assert.deepEqual(res.data, [{ releaseId: 10, date: '2026-07-14' }])
  })

  it('returns ok:false on a non-2xx HTTP response', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch
    const res = await fetchFredReleaseDates(10, { start: '2026-01-01', end: '2026-12-31' })
    assert.equal(res.ok, false)
    if (!res.ok) assert.match(res.reason, /HTTP 429/)
  })
})

describe('resolveFredReleaseCalendar', () => {
  afterEach(() => { restoreEnv(); restoreFetch() })

  it('returns configured:false and an empty event list when FRED_API_KEY is unset (no network attempted)', async () => {
    delete process.env.FRED_API_KEY
    let fetchCalled = false
    globalThis.fetch = (async () => { fetchCalled = true; throw new Error('should not be called') }) as typeof fetch
    const result = await resolveFredReleaseCalendar(60)
    assert.equal(result.configured, false)
    assert.equal(result.ok, false)
    assert.deepEqual(result.events, [])
    assert.equal(fetchCalled, false)
  })

  it('every returned event is dates-only: actual/consensus/prior are always null', async () => {
    process.env.FRED_API_KEY = 'fake-test-key-not-real'
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ release_dates: [{ release_id: 10, date: '2026-07-14' }] }),
    })) as unknown as typeof fetch

    const result = await resolveFredReleaseCalendar(60)
    assert.equal(result.configured, true)
    assert.equal(result.ok, true)
    assert.ok(result.events.length > 0)
    for (const e of result.events) {
      assert.equal(e.actual, null)
      assert.equal(e.consensus, null)
      assert.equal(e.prior, null)
      assert.equal(e.datesOnly, true)
      assert.equal(e.region, 'US')
    }
  })

  it('marks events before today as "past" and events today-or-later as "scheduled"', async () => {
    process.env.FRED_API_KEY = 'fake-test-key-not-real'
    const farFuture = '2099-01-01'
    const farPast = '2000-01-01'
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        release_dates: [
          { release_id: 10, date: farPast },
          { release_id: 10, date: farFuture },
        ],
      }),
    })) as unknown as typeof fetch

    const result = await resolveFredReleaseCalendar(60)
    const past = result.events.find((e) => e.date === farPast)
    const scheduled = result.events.find((e) => e.date === farFuture)
    assert.equal(past?.status, 'past')
    assert.equal(scheduled?.status, 'scheduled')
  })

  it('reports ok:false when every release lookup fails (all HTTP errors)', async () => {
    process.env.FRED_API_KEY = 'fake-test-key-not-real'
    globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    const result = await resolveFredReleaseCalendar(60)
    assert.equal(result.configured, true)
    assert.equal(result.ok, false)
    assert.deepEqual(result.events, [])
  })
})

describe('No client-side exposure of FRED_API_KEY (hygiene)', () => {
  it('the client-safe fetch helper (src/lib/data/fredCalendar.ts) never reads FRED_API_KEY directly', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/lib/data/fredCalendar.ts', import.meta.url), 'utf8')
    assert.ok(!src.includes('FRED_API_KEY'), 'the client-safe helper must never reference the key')
    assert.ok(!src.includes('NEXT_PUBLIC_FRED'), 'must never be exposed via a NEXT_PUBLIC_ variable')
  })

  it('the API route never echoes the key or a raw FRED payload', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/app/api/macro/fred-release-calendar/route.ts', import.meta.url), 'utf8')
    assert.ok(!src.includes('process.env.FRED_API_KEY'), 'the route must not read the key directly — only the provider layer should')
  })

  it('no NEXT_PUBLIC_FRED_API_KEY reference exists anywhere in the app source', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const root = fileURLToPath(new URL('../src', import.meta.url))
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(full))
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
      }
      return out
    }
    for (const file of walk(root)) {
      const content = fs.readFileSync(file, 'utf8')
      assert.ok(!content.includes('NEXT_PUBLIC_FRED_API_KEY'), `${file} must never reference NEXT_PUBLIC_FRED_API_KEY`)
    }
  })
})
