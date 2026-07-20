// 2026-07-20 — Platform-wide table source-footer convention.
//
// Standing rule (CLAUDE.md "Source Badge Rule"): every table names its real
// source at the BOTTOM, in exactly one shape — "Source: {name} as of {hh:mm |
// dd-mm}" — rendered through <TableSourceFooter>. Badges carry only a bare
// status word. Before this pass, several tabs still shipped hand-written
// footers with mode explanations, phase citations, and multi-clause source
// chains ("Baseline: static sample · Persisted via Supabase · Live overlay via
// Yahoo Finance on refresh"). These tests lock the cleanup in.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const I18N = readFileSync(join(ROOT, 'src/lib/i18n.ts'), 'utf8')

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

// Every page that renders at least one data table must render its source
// through the shared component — never a bare hand-written <p>.
const PAGES_WITH_TABLES = [
  'src/app/page.tsx',
  'src/app/stocks/page.tsx',
  'src/app/compare/page.tsx',
  'src/app/chart-builder/page.tsx',
  'src/app/earnings/page.tsx',
  'src/app/companies/[ticker]/page.tsx',
  'src/app/watchlist/page.tsx',
  'src/app/portfolio/page.tsx',
  'src/app/macro/page.tsx',
  'src/app/structured-notes/page.tsx',
  'src/app/structured-notes/[id]/page.tsx',
]

describe('every table-bearing page renders its source via TableSourceFooter', () => {
  for (const rel of PAGES_WITH_TABLES) {
    it(`${rel} uses TableSourceFooter`, () => {
      const src = read(rel)
      assert.ok(src.includes('TableSourceFooter'), `${rel} must render its source footer through the shared component`)
    })
  }
})

describe('the old page-level "data sourcing varies by section" note is gone', () => {
  it('the SourceNote component was deleted', () => {
    assert.ok(!existsSync(join(ROOT, 'src/components/ui/SourceNote.tsx')))
  })

  it('no page imports SourceNote', () => {
    for (const rel of PAGES_WITH_TABLES) {
      assert.ok(!read(rel).includes('SourceNote'), `${rel} must not import the removed SourceNote`)
    }
  })

  it('the common.mvpNote i18n key is removed (EN + ES)', () => {
    assert.ok(!I18N.includes('Data sourcing varies by section'))
    assert.ok(!I18N.includes('La fuente de datos varía según la sección'))
  })
})

describe('source names are plain names — no multi-clause chains or phase citations', () => {
  // Each of these was a real footer string on a live tab before this pass.
  const BANNED = [
    'Baseline: static sample',
    'Persisted via Supabase · Live overlay',
    'Static unless marked',
    'manual CSV interim bridge; automated CMF/FECU/XBRL ingestion planned) — otherwise',
    'see Market Data panel above',
    'see the source label/badge above',
    'Historical chart: static sample · Current price: see badge above',
    'Watchlist membership: persisted via Supabase',
    'Personal portfolio · Supabase · Pricing:',
  ]
  for (const phrase of BANNED) {
    it(`i18n no longer contains "${phrase.slice(0, 40)}…"`, () => {
      assert.ok(!I18N.includes(phrase))
    })
  }

  it('a footer source string never embeds its own "Source:" prefix (the component adds it)', () => {
    // The prefix comes from t.common.source inside TableSourceFooter — a source
    // value that also starts with "Source:" would render "Source: Source: …".
    for (const key of ['earningsSource', 'macroUsSource', 'ratesSource', 'fxSource']) {
      const m = I18N.match(new RegExp(`${key}:\\s+'([^']*)'`))
      assert.ok(m, `expected an EN ${key} entry`)
      assert.ok(!/^Source:/.test(m![1]), `${key} must not embed its own "Source:" prefix`)
      assert.ok(!/^Fuente:/.test(m![1]), `${key} must not embed its own "Fuente:" prefix`)
    }
  })
})

describe('one as-of per surface — the standalone "Updated … SCL" chip is gone', () => {
  // A separate chip fed by the static marketMeta.json commit timestamp sat next
  // to the badge on Stocks/Home/Company/Portfolio. It contradicted the footer's
  // as-of and reverted to a stale date after navigating away from a refreshed
  // page — the exact bug reported on 2026-07-20.
  for (const rel of ['src/app/stocks/page.tsx', 'src/app/page.tsx', 'src/app/companies/[ticker]/page.tsx', 'src/app/portfolio/page.tsx']) {
    it(`${rel} no longer renders a separate live-timestamp chip`, () => {
      const src = read(rel)
      assert.ok(!src.includes('formatLiveTimestamp'), `${rel} must not render its own timestamp chip`)
      assert.ok(!src.includes('t.common.marketUpdated'), `${rel} must not render a second "Updated" label`)
    })
  }

  it('Stocks derives one as-of from the data actually displayed (live, else persisted)', () => {
    const src = read('src/app/stocks/page.tsx')
    assert.ok(src.includes('const priceAsOf = live ? live.lastUpdated'))
    assert.ok(src.includes('asOf={priceAsOf}'))
  })
})

describe('structured notes — one source line, not four', () => {
  const LIST = read('src/app/structured-notes/page.tsx')
  const DETAIL = read('src/app/structured-notes/[id]/page.tsx')

  it('the raw toLocaleString "Live levels as of" line is replaced by the standard footer', () => {
    assert.ok(!LIST.includes('t.sn.pricesAsOf'))
    assert.ok(!I18N.includes('Live levels as of'))
    assert.ok(LIST.includes('<TableSourceFooter'))
  })

  it('the redundant provider label is removed — the footer names the provider once', () => {
    assert.ok(!I18N.includes('Yahoo Finance monitoring estimate'))
    assert.ok(!LIST.includes('providerLabel'))
  })

  it('the estimate disclaimer no longer repeats the provider name', () => {
    const m = I18N.match(/estimateDisclaimer: '([^']+)'/)
    assert.ok(m, 'expected an EN estimateDisclaimer')
    assert.ok(!/Yahoo/.test(m![1]), 'the provider is already named by the footer')
    assert.ok(/not an official calculation-agent determination/.test(m![1]), 'the honesty caveat itself must remain')
  })

  it('the monitoring line keeps only actionable exception counts', () => {
    for (const key of ['staleNoteCount', 'unsupportedUnderlyingCount', 'dueSoonCount', 'reviewRequiredCount']) {
      assert.ok(LIST.includes(key), `${key} warning must be preserved`)
    }
  })

  it('the detail page current-levels table names Yahoo Finance with a real as-of', () => {
    assert.ok(DETAIL.includes('<TableSourceFooter'))
    assert.ok(DETAIL.includes('t.sn.sourceMarket'))
    assert.ok(DETAIL.includes('p.asOf'), 'as-of must be derived from the actual price rows')
  })

  it('sn.sourceMarket is the bare provider name', () => {
    const m = I18N.match(/sourceMarket: '([^']+)'/)
    assert.ok(m)
    assert.equal(m![1], 'Yahoo Finance')
  })
})
