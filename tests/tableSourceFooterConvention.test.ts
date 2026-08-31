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
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { dict } from '../src/lib/i18n.ts'

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
  'src/app/macro/page.tsx',
  'src/app/structured-notes/page.tsx',
  'src/app/structured-notes/[id]/page.tsx',
  // R13.5/R13.6/R13.7 — Family Portfolio table-bearing pages.
  'src/app/portfolio/admin/page.tsx',
  'src/app/portfolio/holdings/page.tsx',
  'src/app/portfolio/page.tsx',
  // R13.R5G — the remaining R13 table-bearing surfaces.
  'src/app/portfolio/weekly-changes/page.tsx',
  'src/app/portfolio/alternatives/page.tsx',
  'src/app/portfolio/alternatives/holdings/page.tsx',
  'src/app/portfolio/alternatives/cash-flows/page.tsx',
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
    // Matched on the import/element, not the bare word: `irrSourceNote` is a
    // legitimate Alternatives caveat string that contains the same substring.
    for (const rel of PAGES_WITH_TABLES) {
      const src = read(rel)
      assert.ok(!/ui\/SourceNote/.test(src), `${rel} must not import the removed SourceNote`)
      assert.ok(!/<SourceNote\b/.test(src), `${rel} must not render the removed SourceNote`)
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
    // Superseded in R12: still exactly one as-of describing the data on
    // screen — but the live snapshot's time is claimed only when at least
    // one displayed row is actually overlaid (per-instrument coverage).
    const src = read('src/app/stocks/page.tsx')
    assert.ok(src.includes("const priceAsOf = live && coverage !== 'none' ? live.lastUpdated"))
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

// ─── R13.R5G · Family Portfolio publication surfaces ─────────────────────────
//
// R13 shipped six Portfolio surfaces after this convention was written and only
// three of them were listed above, so Weekly Changes and all three Alternatives
// surfaces published their source with nothing holding the shape in place. This
// block covers them, plus the two shared components that publish a footer of
// their own, and the properties the convention actually rests on: a plain
// source NAME, exactly one footer per table, and caveats kept out of the source
// string. It tests what the module already does — nothing here asked the UI to
// change.

const FP_TABLE_SURFACES = [
  'src/app/portfolio/weekly-changes/page.tsx',
  'src/app/portfolio/alternatives/page.tsx',
  'src/app/portfolio/alternatives/holdings/page.tsx',
  'src/app/portfolio/alternatives/cash-flows/page.tsx',
] as const

// Two shared components publish their own surface rather than delegating to a
// page: the Alternatives drilldown panels and the Summary's period value-change
// card. Both carry the convention themselves.
const FP_FOOTER_COMPONENTS = [
  'src/components/familyPortfolio/AlternativesDrilldowns.tsx',
  'src/components/familyPortfolio/PeriodValueChangeCard.tsx',
] as const

const FP_DIRS = ['src/app/portfolio', 'src/components/familyPortfolio'] as const

function fpFiles(): string[] {
  const out: string[] = []
  for (const dir of FP_DIRS) {
    for (const entry of readdirSync(join(ROOT, dir), { recursive: true }) as string[]) {
      const rel = [dir, ...String(entry).split(sep)].join('/')
      if (rel.endsWith('.tsx')) out.push(rel)
    }
  }
  return out.sort()
}

/**
 * The props text of every `<Name …>` opening tag in `src`, so "was this card
 * given a footer?" is answered per element rather than by comparing counts.
 */
function openingTags(src: string, name: string): string[] {
  const out: string[] = []
  const tag = `<${name}`
  let i = src.indexOf(tag)
  while (i >= 0) {
    let depth = 0
    let quote: string | null = null
    let j = i + tag.length
    for (; j < src.length; j++) {
      const c = src[j]
      if (quote !== null) {
        // 92 = backslash: an escaped quote does not close the string.
        if (c === quote && src.charCodeAt(j - 1) !== 92) quote = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    out.push(src.slice(i, j))
    i = src.indexOf(tag, j)
  }
  return out
}

describe('R13.R5G — every Family Portfolio publication surface names its source', () => {
  for (const rel of [...FP_TABLE_SURFACES, ...FP_FOOTER_COMPONENTS]) {
    it(`${rel} uses TableSourceFooter`, () => {
      assert.ok(read(rel).includes('<TableSourceFooter'), `${rel} must publish its source through the shared component`)
    })
  }

  it('every TableCard in the module is given a footer — none publishes a table anonymously', () => {
    const cards: string[] = []
    const missing: string[] = []
    for (const rel of fpFiles()) {
      for (const tag of openingTags(read(rel), 'TableCard')) {
        cards.push(rel)
        if (!/footer=\{/.test(tag)) missing.push(`${rel}: ${tag.slice(0, 80).replace(/\n/g, ' ')}`)
      }
    }
    assert.ok(cards.length >= 8, `expected the module's table cards, found ${cards.length}`)
    assert.deepEqual(missing, [], 'a TableCard with no footer slot')
  })

  it('no Family Portfolio surface hand-writes a source line beside the component', () => {
    for (const rel of fpFiles()) {
      const src = read(rel)
      // The one legitimate composition is the print sheet's string prop, which
      // is asserted below to be built from the same two dictionary keys.
      if (rel === 'src/app/portfolio/page.tsx') continue
      assert.ok(!/\{t\.common\.source\}:/.test(src), `${rel}: use TableSourceFooter, not a hand-written prefix`)
      assert.ok(!src.includes('SourceNote.tsx'), `${rel}: the removed page-level SourceNote must not return`)
    }
  })
})

describe('R13.R5G — the module publishes plain source names', () => {
  const NAMES = [
    dict.en.fp.portfolio.source,
    dict.en.fp.alternatives.source,
    dict.es.fp.portfolio.source,
    dict.es.fp.alternatives.source,
  ]

  it('the two workbooks are named, in both languages', () => {
    assert.deepEqual(NAMES, ['RESUMEN workbook', 'Alternatives workbook', 'Planilla RESUMEN', 'Planilla Alternatives'])
  })

  for (const name of ['RESUMEN workbook', 'Alternatives workbook', 'Planilla RESUMEN', 'Planilla Alternatives']) {
    it(`"${name}" is a bare name — no prefix, no chain, no status, no phase`, () => {
      // The component supplies "Source: "; a value that repeated it would
      // render "Source: Source: …".
      assert.ok(!/^(Source|Fuente):/.test(name))
      // A multi-clause chain ("Baseline: … · Persisted via … · Live overlay …")
      // is the exact shape this convention replaced.
      assert.ok(!name.includes(' · '), 'a source is one name, not a chain')
      assert.ok(!/Phase \d/.test(name), 'no phase citation')
      assert.ok(!/\b(static|persisted|live|badge|above)\b/i.test(name), 'status belongs to the badge, not the name')
      assert.ok(name.length <= 40, 'a source name, not a sentence')
    })
  }
})

describe('R13.R5G — caveats sit beside the source line, never inside it', () => {
  // CLAUDE.md: a genuine caveat that is not the source (an IRR derivation note,
  // a no-cross-currency-totals note, a sign convention) goes on its OWN line
  // next to the footer. `.nv-notes` is the stack that holds them, and the
  // source is always the first thing in it.
  it('the notes stack leads with the source footer', () => {
    let stacks = 0
    for (const rel of fpFiles()) {
      const src = read(rel)
      for (const m of src.matchAll(/<div className="nv-notes[^"]*"/g)) {
        // The stack's own extent. None of these nests a <div>, which the next
        // assertion checks rather than assumes — so "the first </div>" really
        // is this stack's close and the ordering below is about one element.
        const from = src.indexOf('>', m.index) + 1
        const to = src.indexOf('</div>', from)
        const stack = src.slice(from, to)
        assert.ok(to > from, `${rel}: unterminated nv-notes stack`)
        assert.ok(!stack.includes('<div'), `${rel}: a nested div would break this bound`)

        const footerAt = stack.indexOf('<TableSourceFooter')
        // A stack of pure context notes (the week-pair line, the cash-toggle
        // explanation) carries no source of its own — that is not a violation.
        if (footerAt < 0) continue
        stacks++
        const noteAt = stack.indexOf('<p className="ui-meta')
        assert.ok(noteAt < 0 || footerAt < noteAt, `${rel}: the source line must lead its notes stack`)
      }
    }
    assert.ok(stacks >= 4, `expected the module's notes stacks, found ${stacks}`)
  })

  it('the caveats themselves are separate strings, not appended to a source name', () => {
    const alt = dict.en.fp.alternatives as Record<string, unknown>
    for (const key of ['noCrossCurrencyNote', 'irrSourceNote', 'signNote']) {
      const v = alt[key]
      assert.equal(typeof v, 'string', `${key} must exist as its own line`)
      assert.ok(!String(v).includes(dict.en.fp.alternatives.source), `${key} must not restate the source`)
    }
  })
})

describe('R13.R5G — one as-of per surface, and it comes from the publication', () => {
  it('no Family Portfolio surface renders a second "Updated … SCL" chip', () => {
    for (const rel of fpFiles()) {
      const src = read(rel)
      assert.ok(!src.includes('formatLiveTimestamp'), `${rel}: no second timestamp chip`)
      assert.ok(!src.includes('t.common.marketUpdated'), `${rel}: no second "Updated" label`)
    }
  })

  it('each footer as-of is the publication timestamp the rows came from', () => {
    for (const rel of [...FP_TABLE_SURFACES, 'src/app/portfolio/page.tsx', 'src/app/portfolio/holdings/page.tsx']) {
      const src = read(rel)
      assert.match(
        src,
        /asOf=\{[^}]*publishedAt/,
        `${rel}: the as-of must be the publication's own timestamp`,
      )
    }
  })

  it('the print sheet composes its source line from the same two dictionary keys', () => {
    // Paper has no hook context, so this one is a string prop — but it is built
    // from `common.source` + `fp.portfolio.source`, so the wording can never
    // drift from what the screen shows.
    const src = read('src/app/portfolio/page.tsx')
    assert.ok(src.includes('sourceLine={`${t.common.source}: ${t.fp.portfolio.source}`}'))
    assert.ok(read('src/components/familyPortfolio/SummaryPrintSheet.tsx').includes('{sourceLine}'))
  })
})
