// Phase 5F — /macro/calendar re-skinned into the Fable institutional language.
// Phase R5 — deepened to full approved-Fable fidelity: the shared PageHeader
// (same baseline row as /macro and the R3/R4 routes) with the back link and
// scope sentence in its metadata, the no-consensus/deferred pills on the
// shared ChipLabel primitive, and — in the shared EconomicCalendarTable —
// the Fable releases-card anatomy: accent-2 date treatment and a visible
// localized importance chip replacing the color-only dot (the color mapping
// itself is unchanged; High keeps the platform-wide --negative signal, a
// documented departure from Fable's amber HIGH chip).
//
// The contract this file locks down: the page LOOKS different and NOTHING
// about what it shows or does changed. Every section, calendar column, FOMC
// column, Chile-deferred disclosure, source badge/footer, and async state is
// still there; the fetch calls and computed values are byte-for-byte the
// same; no API, provider, or business-logic file was touched.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const CALENDAR = 'src/app/macro/calendar/page.tsx'
const I18N = 'src/lib/i18n.ts'
const CALENDAR_TABLE = 'src/components/macro/EconomicCalendarTable.tsx'

const src = read(CALENDAR)
const i18n = read(I18N)

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

// ─── 1. Every section survives ────────────────────────────────────────────────

describe('Phase 5F — every Calendar section survives the re-skin', () => {
  it('keeps the "← Back to Macro" link and the page header (R5: shared Fable PageHeader, back link in the metadata row)', () => {
    assert.match(src, /href="\/macro"/)
    assert.match(src, /\{t\.cal\.back\}/)
    assert.match(src, /<PageHeader/)
    assert.match(src, /from '@\/components\/fable\/PageHeader'/)
    assert.match(src, /eyebrow=\{t\.macro\.tag\}/)
    assert.match(src, /title=\{t\.cal\.title\}/)
    assert.match(src, /\{t\.cal\.subtitle\}/)
    assert.ok(!src.includes('SectionHeader'), 'the pre-Fable SectionHeader is superseded by the shared PageHeader (R5)')
  })

  it('keeps the FRED release calendar card with its "no consensus" indicator', () => {
    assert.match(src, /title=\{t\.cal\.fredTitle\}/)
    assert.match(src, /t\.cal\.noConsensus/)
  })

  it('keeps the FOMC market-implied rate outlook card, conditionally rendered', () => {
    assert.match(src, /\{fomc && fomc\.status !== 'unavailable' && \(/)
    assert.match(src, /title=\{t\.cal\.fomcTitle\}/)
  })

  it('keeps the Chile deferred-calendar card', () => {
    assert.match(src, /title=\{t\.cal\.chileTitle\}/)
  })

  it('adds no invented KPI, hero, or summary metric to this route', () => {
    assert.ok(!src.includes('KpiHero'))
    assert.ok(!src.includes('KpiCapsule'))
    assert.ok(!src.includes('CurrentActions'))
  })
})

// ─── Calendar columns, filters, dates, actual/previous/forecast honesty ───────

describe('Phase 5F — every calendar column and its data honesty preserved', () => {
  const table = read(CALENDAR_TABLE)

  it('keeps all 7 columns in order (Date, Release, Metric, Actual, Previous, Source, Imp.)', () => {
    // `t.cal.imp}` (the header cell) — a bare `t.cal.imp` would first match the
    // R5 impLabel helper's `t.cal.impHigh` above the table markup.
    const order = ['t.cal.fredDate', 't.cal.fredRelease', 't.cal.metricCol', 't.cal.actualCol', 't.cal.previousCol', 't.cal.srcCol', 't.cal.imp}']
    const positions = order.map(k => table.indexOf(k))
    assert.ok(positions.every(p => p >= 0), 'a calendar column header is missing')
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `calendar column order changed at ${order[i]}`)
    }
  })

  it('event dates and release names are unchanged (real FRED data, sourceUrl-linked)', () => {
    assert.match(table, /\{r\.firstOfEvent \? r\.event\.date : ''\}/)
    assert.match(table, /href=\{r\.event\.sourceUrl\}/)
  })

  it('actual/previous values render honestly — pending, unavailable, or the real number, never fabricated', () => {
    assert.match(table, /pending \? <span className="text-muted-fg" title=\{t\.cal\.pendingTitle\}>\{t\.cal\.pending\}<\/span>/)
    assert.match(table, /m\.status === 'unavailable' \? <span className="text-muted-fg">—<\/span>/)
    assert.match(table, /m\.actualText \?\? fmtValue\(m\.actual, m\.unit, m\.decimals\)/)
  })

  it('no forecast/consensus field exists anywhere on this route (no free official source provides them)', () => {
    assert.doesNotMatch(src, /t\.cal\.forecast\b|t\.cal\.consensus\b/)
    assert.doesNotMatch(table, /forecast|consensus/i)
  })

  it('no filtering or sorting UI was invented — the table sorts by date, unchanged', () => {
    assert.match(table, /events\.slice\(\)\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\)/)
    assert.doesNotMatch(src, /t\.cal\.search\b|weekLabel|addDays/)
  })

  it('the originating-agency chip is preserved (provenance, restyled to a Fable pill)', () => {
    assert.match(table, /\{m\.originatingAgency\}/)
    assert.match(table, /title=\{t\.cal\.srcTitle\}/)
  })

  it('the importance classification is preserved with its color mapping — R5.1 encodes it as a relevance bar meter', () => {
    assert.match(table, /const impColor = \(imp: EnrichedFredCalendarEvent\['importance'\]\) =>/)
    // The color mapping itself is unchanged — High keeps --negative.
    assert.match(table, /imp === 'High' \? 'var\(--negative\)' : imp === 'Medium' \? 'var\(--warning\)' : 'var\(--muted-fg\)'/)
    // Not color-only: bar COUNT is the primary signal, plus a localized
    // accessible name, a title, and sr-only text.
    assert.match(table, /const impLabel = \(imp: EnrichedFredCalendarEvent\['importance'\]\) =>/)
    assert.match(table, /<RelevanceBars importance=\{r\.event\.importance\}\s*\/>/)
    assert.ok(!table.includes('w-2 h-2 rounded-full'), 'the color-only dot is gone')
  })
})

// ─── Dates-only disclosure + FRED wiring ───────────────────────────────────────

describe('Phase 5F — dates-only disclosure and real FRED calendar wiring preserved', () => {
  it('still fetches the FRED release calendar for a 60-day window', () => {
    assert.match(src, /fetchFredReleaseCalendar\(60, ac\.signal\)/)
  })

  it('the enriched note explains dates vs. values are two distinct real sources, unchanged copy', () => {
    assert.match(src, /t\.cal\.enrichedNote/)
    const m = /enrichedNote: '([^']*)'/.exec(i18n)
    assert.ok(m)
    assert.match(m![1], /FRED release calendar/)
    assert.match(m![1], /FRED time-series/)
  })

  it('the "not configured" state is honestly distinct from "configured but empty"', () => {
    assert.match(src, /state=\{fred && !fred\.configured \? 'unavailable' : undefined\}/)
    assert.match(src, /stateMessage=\{t\.cal\.fredUnavailable\}/)
    assert.match(src, /emptyMessage=\{t\.cal\.fredEmpty\}/)
  })
})

// ─── FOMC outlook — actual/previous/forecast honesty ───────────────────────────

describe('Phase 5F — FOMC market-implied outlook preserved, never framed as CME FedWatch', () => {
  it('keeps all 5 FOMC columns in order (window, expected, below, in-range, above)', () => {
    const order = ['t.cal.fomcWindow', 't.cal.fomcExpected', 't.cal.fomcBelow', 't.cal.fomcInRange', 't.cal.fomcAbove']
    const positions = order.map(k => src.indexOf(k))
    assert.ok(positions.every(p => p >= 0), 'a FOMC column header is missing')
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `FOMC column order changed at ${order[i]}`)
    }
  })

  it('shows the current target range only when the provider actually returned one', () => {
    assert.match(src, /\{fomc\.currentTargetRange \? \(/)
  })

  it('renders an honest unavailable state when the quarters array is empty, never zero-filled probabilities', () => {
    assert.match(src, /state=\{fomc\.quarters\.length === 0 \? 'unavailable' : undefined\}/)
    assert.match(src, /stateMessage=\{t\.cal\.fomcOutlookUnavailable\}/)
  })

  it('expected rate and probabilities use the exact null-guarded formatters, never a fabricated value', () => {
    assert.match(src, /\{q\.expectedRatePct != null \? `\$\{q\.expectedRatePct\.toFixed\(2\)\}%` : '—'\}/)
    assert.match(src, /const pct = \(v: number \| null\) => \(v == null \? '—' : `\$\{v\.toFixed\(1\)\}%`\)/)
  })

  it('the disclaimer explicitly disclaims a per-meeting forecast and CME FedWatch, unchanged copy', () => {
    const m = /fomcNote:\s+'([^']*)'/.exec(i18n)
    assert.ok(m)
    assert.match(m![1], /NOT a per-meeting forecast/)
    assert.match(m![1], /NOT CME FedWatch/)
  })
})

// ─── Chile calendar — honest deferred disclosure, no fabrication ──────────────

describe('Phase 5F — Chile calendar limitation stays honest, no fabricated rows', () => {
  it('renders the Chile title, deferred pill, and unavailable disclosure', () => {
    assert.match(src, /t\.cal\.chileTitle/)
    assert.match(src, /t\.cal\.chileDeferred/)
    assert.match(src, /t\.cal\.chileUnavailable/)
  })

  it('the Chile card always shows the unavailable state — never a table with fabricated rows', () => {
    assert.match(src, /state="unavailable"/)
    assert.match(src, /stateMessage=\{t\.cal\.chileUnavailable\}/)
  })

  it('the EN disclosure copy states no verified source exists, unchanged', () => {
    const m = /chileUnavailable:\s*'([^']*)'/.exec(i18n)
    assert.ok(m)
    assert.match(m![1], /No free, stable, structured official release-date source/i)
  })

  it('renders no Chile-country synthetic event row (no e.country reference)', () => {
    assert.doesNotMatch(src, /e\.country/)
  })

  it('never imports the deleted synthetic schedule-driven calendar module', () => {
    assert.doesNotMatch(src, /from ['"]@\/lib\/data\/calendar['"]/)
    assert.doesNotMatch(src, /getCalendarForWeek|searchUpcoming|weekStartOf|getEventsForDay/)
  })
})

// ─── Source badges and footers ─────────────────────────────────────────────────

describe('Phase 5F — source footers preserved', () => {
  it('keeps 2 TableSourceFooter instances (FRED calendar, FOMC) — Chile deferred has none (no real source)', () => {
    assert.equal(count(src, '<TableSourceFooter'), 2)
  })

  it('the FRED footer as-of derives from the latest fetched event date, unchanged', () => {
    assert.match(src, /const latestAsOf = events\.reduce\(\(max, e\) => \(e\.date > max \? e\.date : max\), ''\)/)
  })

  it('the FOMC footer names the real resolved provider source and observation date, unchanged', () => {
    assert.match(src, /<TableSourceFooter source=\{fomc\.source\} asOf=\{fomc\.observationDate \|\| null\}/)
  })
})

// ─── API / data dependencies unchanged ─────────────────────────────────────────

describe('Phase 5F — API and data dependencies untouched', () => {
  it('fetches through the same 2 client-safe helpers, never a raw fetch or a server-only import', () => {
    assert.match(src, /import \{ fetchFredReleaseCalendar, type FredCalendarFetchResult \} from '@\/lib\/data\/fredCalendar'/)
    assert.match(src, /import \{ fetchFomcExpectations, type FomcExpectationsResult \} from '@\/lib\/data\/fomcExpectations'/)
    assert.ok(!src.includes("fetch('/api"))
    assert.ok(!/from '@\/lib\/providers\//.test(src))
    assert.ok(!/from '@\/lib\/db\//.test(src))
  })
})

// ─── Fable visual language ─────────────────────────────────────────────────────

describe('Phase 5F — Fable visual language applied via shared primitives', () => {
  it('uses the shared analytical TableCard for all 3 cards', () => {
    assert.match(src, /from '@\/components\/fable\/TableCard'/)
    assert.equal(count(src, '<TableCard'), 3)
  })

  it('puts the dense calendar/FOMC tables on the near-opaque surface, never on blurred glass', () => {
    const tableCard = read('src/components/fable/TableCard.tsx')
    assert.match(tableCard, /variant="dense"/)
    assert.ok(!src.includes('nv-glass-card'), 'the page never applies glass directly to table content')
  })

  it('the shared EconomicCalendarTable uses tokenised row hover and a near-opaque header', () => {
    const table = read(CALENDAR_TABLE)
    assert.match(table, /nv-row-hover nv-transition/)
    assert.match(table, /backgroundColor: 'var\(--surface-table\)'/)
    assert.ok(!table.includes('bg-surface-2'), 'the old header background token is gone')
  })

  it('the calendar table empty state routes through the shared AsyncState component', () => {
    const table = read(CALENDAR_TABLE)
    assert.match(table, /from '@\/components\/fable\/AsyncState'/)
    assert.match(table, /<AsyncState kind="empty" message=\{emptyMessage\}\s*\/>/)
  })

  it('restyles the pills (no-consensus, deferred) to the shared Fable ChipLabel primitive (R5 — no hand-rolled chip recipe left)', () => {
    assert.match(src, /from '@\/components\/fable\/Chip'/)
    assert.equal(count(src, '<ChipLabel>'), 2)
    assert.ok(!src.includes("backgroundColor: 'var(--nv-chip)'"), 'the inline chip recipe is superseded by ChipLabel')
  })

  it('uses the tokenised table-cell type scale on the FOMC table', () => {
    assert.match(src, /fontSize: 'var\(--fs-table-cell\)'/)
  })

  it('hardcodes no hex colour and no raw Tailwind colour scale', () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), 'contains a hardcoded hex colour')
    assert.ok(
      !/\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(src),
      'uses a raw Tailwind colour scale',
    )
  })

  it('uses no purple anywhere on this route (reserved for the Review token)', () => {
    assert.ok(!/--chart-review|--review\b/.test(src))
  })
})

// ─── Motion ─────────────────────────────────────────────────────────────────────

describe('Phase 5F — motion is restrained and reduced-motion safe', () => {
  it('uses only the shared CSS reveal primitive, with the Fable stagger cadence', () => {
    assert.match(src, /<Reveal>/)
    assert.match(src, /<Reveal delayMs=\{70\}>/)
    assert.match(src, /<Reveal delayMs=\{130\}>/)
    assert.match(src, /<Reveal delayMs=\{190\}>/)
    assert.match(src, /from '@\/components\/fable\/motion'/)
  })

  it('never animates a value continuously — no count-up on this route', () => {
    assert.ok(!src.includes('countUp'))
    assert.ok(!src.includes('ContentPulse'))
  })

  it('introduces no page-local keyframes or animation utility', () => {
    assert.ok(!src.includes('@keyframes'))
    assert.ok(!/animation:/.test(src))
  })

  it('the reveal primitive collapses to its final state under reduced motion (shared global rule, unchanged)', () => {
    const css = read('src/app/globals.css')
    const block = css.slice(css.indexOf('prefers-reduced-motion'))
    assert.match(block, /\.nv-reveal[^}]*\n?[^}]*opacity:\s*1\s*!important/s)
  })
})

// ─── Accessibility ───────────────────────────────────────────────────────────

describe('Phase 5F — accessibility', () => {
  it('uses semantic table markup with scoped headers and captions', () => {
    const table = read(CALENDAR_TABLE)
    assert.ok(count(table, 'scope="col"') >= 7)
    assert.match(table, /<caption className="sr-only">/)
    assert.ok(count(src, 'scope="col"') >= 5, 'FOMC table headers must be scoped too')
  })

  it('the FOMC table has its own accessible caption', () => {
    assert.match(src, /<caption className="sr-only">\{t\.cal\.fomcTitle\}<\/caption>/)
  })

  it('the calendar release link is real anchor text, not an icon-only control', () => {
    const table = read(CALENDAR_TABLE)
    assert.match(table, /<a href=\{r\.event\.sourceUrl\} target="_blank" rel="noopener noreferrer"/)
  })
})

// ─── Responsive ──────────────────────────────────────────────────────────────

describe('Phase 5F — responsive guarantees', () => {
  it('keeps the full-width page container with no page-level max-width', () => {
    assert.match(src, /<div className="w-full space-y-4">/)
    assert.ok(!src.includes('max-w-screen-xl'))
  })

  it('scrolls the calendar and FOMC tables inside their card via TableCard minWidth (closes the pre-existing no-min-w gap)', () => {
    assert.match(src, /minWidth=\{720\}/)
    assert.match(src, /minWidth=\{480\}/)
    assert.match(read('src/components/fable/TableCard.tsx'), /overflow-x-auto/)
  })

  it('reintroduces no root min-width', () => {
    const css = read('src/app/globals.css')
    assert.doesNotMatch(css, /html\s*\{[^}]*min-width/s)
  })
})

// ─── Localisation ────────────────────────────────────────────────────────────

describe('Phase 5F — English and Spanish complete', () => {
  it('adds no hardcoded visible English string to the page', () => {
    const literals = src.match(/>[A-Za-z][A-Za-z .,'()/-]{3,}</g) ?? []
    assert.deepEqual(literals, [], `unlocalised literal(s): ${literals.join(' | ')}`)
  })

  it('adds no hardcoded English string in a title/aria-label attribute', () => {
    const attrLiterals = [...src.matchAll(/(?:title|aria-label)="([A-Za-z][A-Za-z .,'()/-]{2,})"/g)].map(m => m[1])
    assert.deepEqual(attrLiterals, [], `unlocalised attribute string(s): ${attrLiterals.join(' | ')}`)
  })

  it('every t.cal.* key referenced by the page exists in both dictionaries', () => {
    const keys = [...new Set([...src.matchAll(/t\.cal\.(\w+)/g)].map(m => m[1]))]
    for (const key of keys) {
      assert.ok(count(i18n, `${key}:`) >= 2, `t.cal.${key} must exist in both dict.en and dict.es`)
    }
  })

  it('every t.cal.* key referenced by EconomicCalendarTable exists in both dictionaries', () => {
    const table = read(CALENDAR_TABLE)
    const keys = [...new Set([...table.matchAll(/t\.cal\.(\w+)/g)].map(m => m[1]))]
    for (const key of keys) {
      assert.ok(count(i18n, `${key}:`) >= 2, `t.cal.${key} must exist in both dict.en and dict.es`)
    }
  })
})

// ─── Scope ───────────────────────────────────────────────────────────────────

describe('Phase 5F — scope held', () => {
  it('imports no server-only db/financials module', () => {
    assert.ok(!/from '@\/lib\/db\//.test(src))
    assert.ok(!/from '@\/lib\/financials\//.test(src))
  })

  it('adds no runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
      '@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2',
    ])
  })

  it('redesigns no page outside its own phase', () => {
    // `/earnings` was removed from this list in Phase 5G, `/portfolio` in
    // Phase 5H, and `/structured-notes` in Phase R3, each migrated to
    // `TableCard` under its own brief — real phase boundaries moving, not a
    // relaxed assertion. They are guarded by
    // `tests/fableEarningsPage.test.ts` / `tests/fablePortfolioPage.test.ts` /
    // `tests/fableStructuredNotesPage.test.ts`.
    // `/` (Home) was removed from this list in Phase R10 — migrated to
    // `TableCard` under its own brief; a real phase boundary moving, not a
    // relaxed assertion. It is guarded by `tests/fableHomePage.test.ts`.
    assert.ok(existsSync(join(ROOT, 'src/app/page.tsx')), 'src/app/page.tsx must still exist')
  })

  it('leaves access control to the shared policy (Calendar is now private)', async () => {
    // R1.5 made Nevada Market Intelligence default-deny: middleware no longer
    // carries PROTECTED_PAGES/PROTECTED_API, and this route is now PRIVATE like
    // every other application page. The original intent of this test — that the
    // page phase itself changed no access rule — is preserved by asserting the
    // route's classification comes from the shared policy.
    const { classifyPath } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/macro/calendar'), 'private_page')
    assert.ok(!read('src/middleware.ts').includes("'/macro/calendar'"), 'never named in middleware')
  })

  it('changes no API contract from the page', () => {
    assert.ok(!src.includes("fetch('/api"))
  })
})

// ─── Phase R5 — approved-Fable deepening ──────────────────────────────────────

describe('Phase R5 — /macro/calendar joins the shared Fable header family', () => {
  const table = read(CALENDAR_TABLE)

  it('the header family matches /macro and R3/R4 (PageHeader eyebrow/title/metadata anatomy)', () => {
    assert.match(src, /metadata=\{/)
    assert.match(read('src/components/fable/PageHeader.tsx'), /ui-page-title/)
  })

  it('route navigation stays real links — the back link in the metadata plus the shell pill rail', () => {
    assert.match(src, /metadata=\{[\s\S]{0,300}?href="\/macro"/, 'the header metadata carries the back link')
    const nav = read('src/lib/navigation.ts')
    assert.match(nav, /href: '\/macro\/calendar'/)
  })

  it('the date column carries the Fable releases-card treatment (accent-2, 650) — chronology anchored, chronological sort untouched', () => {
    assert.match(table, /text-accent-2/)
    assert.match(table, /fontWeight: 650/)
    assert.match(table, /events\.slice\(\)\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\)/)
  })

  it('the relevance labels are localized in both dictionaries and never fabricated beyond the existing High/Medium/Low model', () => {
    for (const key of ['impHigh:', 'impMedium:', 'impLow:', 'impTitle:', 'relevanceLabel:']) {
      assert.ok(count(i18n, key) >= 2, `${key} must be present in dict.en and dict.es`)
    }
    // The meter renders only the three classifications the allowlist model
    // defines — no importance filter and no new importance values.
    const allowlist = read('src/config/fredReleaseAllowlist.ts')
    assert.match(allowlist, /importance: 'High' \| 'Medium' \| 'Low'/)
  })

  it('no browser-native dialog is introduced on this route', () => {
    assert.ok(!/window\.(confirm|alert|prompt)\(/.test(src))
    assert.ok(!/window\.(confirm|alert|prompt)\(/.test(table))
  })
})

// ─── Phase R5.1 — relevance bar meter ─────────────────────────────────────────

describe('Phase R5.1 — relevance is encoded as a compact Fable bar meter', () => {
  const table = read(CALENDAR_TABLE)

  it('maps exactly the three real levels to 1/2/3 filled bars — no invented fourth level', () => {
    assert.match(table, /const FILLED: Record<EnrichedFredCalendarEvent\['importance'\], number> = \{ Low: 1, Medium: 2, High: 3 \}/)
    assert.match(table, /const BAR_HEIGHT = \[5, 8, 11\]/)
    assert.match(table, /i < filled/)
    const allowlist = read('src/config/fredReleaseAllowlist.ts')
    assert.match(allowlist, /importance: 'High' \| 'Medium' \| 'Low'/)
    assert.ok(!/Critical|Severe|VeryHigh/.test(table), 'no fabricated importance level')
  })

  it('is never color-only: bar count is the signal, plus aria-label, title and sr-only text', () => {
    assert.match(table, /role="img"/)
    assert.match(table, /aria-label=\{name\}/)
    assert.match(table, /const name = `\$\{t\.cal\.relevanceLabel\}: \$\{impLabel\(importance\)\}`/)
    assert.match(table, /title=\{`\$\{name\} · \$\{t\.cal\.impTitle\}`\}/)
    assert.match(table, /<span className="sr-only">\{impLabel\(importance\)\}<\/span>/)
    assert.match(table, /aria-hidden="true"/)
  })

  it('uses Fable tokens only — no hardcoded hex, no raw Tailwind colour scale, unfilled track via color-mix', () => {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(table), 'contains a hardcoded hex colour')
    assert.ok(
      !/\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(table),
      'uses a raw Tailwind colour scale',
    )
    assert.match(table, /color-mix\(in oklab, var\(--muted-fg\) 24%, transparent\)/)
  })

  it('keeps rows calm and stable — fixed meter height, compact bar width, dense radius, no motion', () => {
    assert.match(table, /className="inline-flex items-end gap-\[2px\] h-3 align-middle"/)
    assert.match(table, /className="block w-\[3px\] rounded-xs"/)
    assert.ok(!/animate-|transition-|@keyframes/.test(table), 'the meter introduces no motion')
  })

  it('the word chip it replaces is gone, and the column narrowed to fit the meter', () => {
    assert.ok(!table.includes('h-6 px-2.5 rounded-full text-xs font-medium whitespace-nowrap'), 'the importance word chip is gone')
    assert.match(table, /ui-table-header text-muted-fg w-16">\{t\.cal\.imp\}/)
  })

  it('chronology, ordering and every other column are untouched by the repair', () => {
    assert.match(table, /events\.slice\(\)\.sort\(\(a, b\) => a\.date\.localeCompare\(b\.date\)\)/)
    assert.match(table, /\{r\.firstOfEvent \? <RelevanceBars/)
    assert.match(table, /m\.actualText \?\? fmtValue\(m\.actual, m\.unit, m\.decimals\)/)
    assert.match(table, /\{m\.originatingAgency\}/)
  })
})
