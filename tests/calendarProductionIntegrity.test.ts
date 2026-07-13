// Calendar production-integrity fix — regression tests.
//
// A read-only audit found that /macro/calendar rendered a schedule-driven
// SYNTHETIC table (deterministic pseudo-random forecast/actual/prior values,
// via mulberry32(hash(key+date)) in src/lib/data/calendar.ts) above the real
// FRED dates-only release calendar — including fabricated Chile rows that
// referenced BCCh/INE by name despite having no actual BCCh/INE backing. The
// same synthetic module also powered a "today's releases" widget on the Macro
// page. Both were removed from production; this file guards against either
// leaking back in, and confirms the real FRED calendar + the new honest Chile
// deferred-state both remain in place.
//
// Static source-code assertions (readFileSync), matching this repo's existing
// pattern (see tests/dataSourceAudit.test.ts) — no DOM/React renderer is used
// anywhere in this test suite.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const CALENDAR_PAGE = join(ROOT, 'src/app/macro/calendar/page.tsx')
const MACRO_PAGE = join(ROOT, 'src/app/macro/page.tsx')
const CALENDAR_SYNTHETIC_MODULE = join(ROOT, 'src/lib/data/calendar.ts')
const I18N = join(ROOT, 'src/lib/i18n.ts')
const FRED_CALENDAR_ROUTE = join(ROOT, 'src/app/api/macro/fred-release-calendar/route.ts')
const FRED_CALENDAR_CLIENT = join(ROOT, 'src/lib/providers/fredReleaseCalendarClient.ts')

/** Recursively lists every .ts/.tsx file under src/app (production routes/pages). */
function listAppFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listAppFiles(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('synthetic calendar module — isolated from every production route/page', () => {
  it('no file under src/app/** imports from src/lib/data/calendar', () => {
    const appFiles = listAppFiles(join(ROOT, 'src/app'))
    const offenders = appFiles.filter((f) => /from ['"]@\/lib\/data\/calendar['"]/.test(readFileSync(f, 'utf8')))
    assert.deepEqual(offenders, [], `these production files still import the synthetic calendar: ${offenders.join(', ')}`)
  })
  it('the synthetic module itself is explicitly marked test/demo-only, not for production import', () => {
    const src = readFileSync(CALENDAR_SYNTHETIC_MODULE, 'utf8')
    assert.match(src, /TEST\/DEMO-ONLY/)
    assert.match(src, /NOT IMPORTED BY ANY PRODUCTION ROUTE OR PAGE/)
  })
})

describe('/macro/calendar — no fabricated data in production', () => {
  const src = readFileSync(CALENDAR_PAGE, 'utf8')

  it('does not import the synthetic schedule-driven generator', () => {
    assert.doesNotMatch(src, /from ['"]@\/lib\/data\/calendar['"]/)
    assert.doesNotMatch(src, /getCalendarForWeek|searchUpcoming|weekStartOf|getEventsForDay/)
  })
  it('renders no fabricated forecast/consensus columns (Phase 8D.3 adds REAL actual/previous, never forecast/consensus)', () => {
    // The removed synthetic table used t.cal.forecast/actual/prior. Phase 8D.3's
    // enrichment uses distinct keys (actualCol/previousCol) fed by real FRED
    // time-series — but consensus/forecast must never appear.
    assert.doesNotMatch(src, /t\.cal\.forecast\b|t\.cal\.consensus\b/)
  })
  it('renders no week-navigation or free-text search controls (only relevant to the removed synthetic table)', () => {
    assert.doesNotMatch(src, /t\.cal\.search\b|weekLabel|addDays/)
  })
})

describe('/macro/calendar — real FRED dates-only calendar preserved', () => {
  const src = readFileSync(CALENDAR_PAGE, 'utf8')

  it('still fetches the FRED release calendar', () => {
    assert.match(src, /fetchFredReleaseCalendar/)
  })
  it('shows no-consensus labeling (Phase 8D.3 enriched note names FRED + originating agencies, disclaims consensus)', () => {
    assert.match(src, /t\.cal\.noConsensus/)
    assert.match(src, /t\.cal\.enrichedNote/)
  })
  it('never fabricates actual/consensus/prior for the FRED section (the type itself forbids it)', () => {
    const providerSrc = readFileSync(join(ROOT, 'src/lib/providers/fredReleaseCalendar.ts'), 'utf8')
    assert.match(providerSrc, /actual:\s*null/)
    assert.match(providerSrc, /consensus:\s*null/)
    assert.match(providerSrc, /prior:\s*null/)
  })
})

describe('/macro/calendar — Chile deferred state', () => {
  const src = readFileSync(CALENDAR_PAGE, 'utf8')

  it('renders an honest Chile deferred/unavailable block, not fabricated rows', () => {
    assert.match(src, /t\.cal\.chileTitle/)
    assert.match(src, /t\.cal\.chileDeferred/)
    assert.match(src, /t\.cal\.chileUnavailable/)
  })
  it('does not render any Chile-country synthetic event row (CL badge from the old table)', () => {
    assert.doesNotMatch(src, /e\.country/)
  })
})

describe('i18n — Chile deferred copy present, no BCCh/INE data fabrication claim', () => {
  const src = readFileSync(I18N, 'utf8')

  it('defines chileTitle/chileDeferred/chileUnavailable in both EN and ES', () => {
    const enMatches = src.match(/chileUnavailable:/g) ?? []
    assert.equal(enMatches.length, 2, 'expected exactly one EN + one ES chileUnavailable entry')
  })
  it('the EN Chile-unavailable copy states no verified source exists, and does not promise fake dates', () => {
    const m = /chileUnavailable:\s*'([^']*)'/.exec(src)
    assert.ok(m, 'chileUnavailable key not found')
    assert.match(m![1], /unavailable/i)
    assert.match(m![1], /No free, stable, structured official release-date source/i)
  })
  it('removed the now-dead synthetic-table-only cal.* keys (search/today/next/results/noResults/noToday/time/country/event/forecast/actual/prior)', () => {
    // These were only ever consumed by the removed synthetic table (or the
    // removed Macro-page widget) — confirm they're gone so they can't silently
    // come back and get wired into a new fabricated table.
    const calBlockMatch = /cal:\s*\{[\s\S]*?\n {4}\},/.exec(src)
    assert.ok(calBlockMatch)
    const calBlock = calBlockMatch![0]
    for (const deadKey of ['search:', 'today:', 'next:', 'results:', 'noResults:', 'noToday:', 'time:', 'country:', 'event:', 'forecast:', 'actual:', 'prior:']) {
      assert.doesNotMatch(calBlock, new RegExp(`\\n\\s*${deadKey}`), `dead key "${deadKey}" reappeared in the cal i18n block`)
    }
  })
})

describe('Macro page — synthetic "today\'s releases" widget removed', () => {
  const src = readFileSync(MACRO_PAGE, 'utf8')

  it('no longer imports the synthetic calendar module', () => {
    assert.doesNotMatch(src, /from ['"]@\/lib\/data\/calendar['"]/)
  })
  it('no longer renders a forecast/actual/prior table', () => {
    assert.doesNotMatch(src, /t\.cal\.forecast|t\.cal\.actual\b|t\.cal\.prior\b/)
  })
  it('still links out to the full calendar page (the real FRED + Chile-deferred surface)', () => {
    assert.match(src, /href="\/macro\/calendar"/)
    assert.match(src, /t\.macro\.viewFull/)
  })
})

describe('FRED_API_KEY — remains server-only (unchanged by this fix)', () => {
  it('the release-calendar client never reads a NEXT_PUBLIC_-prefixed key', () => {
    const src = readFileSync(FRED_CALENDAR_CLIENT, 'utf8')
    assert.doesNotMatch(src, /NEXT_PUBLIC_FRED_API_KEY/)
    assert.match(src, /process\.env\.FRED_API_KEY/)
  })
  it('the API route never reads the env var directly (delegates entirely to resolveFredReleaseCalendar)', () => {
    const src = readFileSync(FRED_CALENDAR_ROUTE, 'utf8')
    assert.doesNotMatch(src, /process\.env\./)
  })
  it("the route's JSON response only ever includes sanitized fields — no key or raw-payload field", () => {
    const src = readFileSync(FRED_CALENDAR_ROUTE, 'utf8')
    const jsonBlocks = [...src.matchAll(/NextResponse\.json\(\s*\{([\s\S]*?)\}\s*[,)]/g)].map((m) => m[1])
    assert.ok(jsonBlocks.length > 0, 'expected at least one NextResponse.json({...}) call')
    const allowed = ['ok', 'configured', 'datesOnly', 'enriched', 'consensusAvailable', 'events', 'reason']
    for (const block of jsonBlocks) {
      const fieldNames = [...block.matchAll(/^\s*(?:\.\.\.\()?(\w+)\s*:/gm)].map((m) => m[1])
      for (const f of fieldNames) {
        assert.ok(allowed.includes(f), `unexpected response field "${f}" — verify it isn't leaking the key or a raw payload`)
      }
    }
  })
  it('no client-safe fetch helper (src/lib/data/*) references FRED_API_KEY directly', () => {
    const src = readFileSync(join(ROOT, 'src/lib/data/fredCalendar.ts'), 'utf8')
    assert.doesNotMatch(src, /FRED_API_KEY/)
  })
})
