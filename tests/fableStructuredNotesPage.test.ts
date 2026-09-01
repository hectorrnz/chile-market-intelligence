// Phase R3 — Fable Structured Notes dashboard composition.
//
// Guards the /structured-notes re-skin: the page adopts the approved Fable
// §6 composition (capsule row → lifecycle legend chips → wide table with the
// barrier gauge) through the SHARED primitives, while every piece of NMI
// substance — API contracts, monitoring math, filters, sorting, states,
// source footer, canonical routing, R1.5 security — is preserved unchanged.
// Source-scan style (no rendering harness), matching the other fable*Page
// suites.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const PAGE = read('src/app/structured-notes/page.tsx')
const DETAIL = read('src/app/structured-notes/[id]/page.tsx')
const I18N = read('src/lib/i18n.ts')
const SHELL_GATE = read('src/components/layout/ShellGate.tsx')
const APP_SHELL = read('src/components/layout/AppShell.tsx')

// Strip comments so negative assertions test code, not prose.
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const PAGE_CODE = strip(PAGE)

describe('R3.1 — Fable dashboard composition on /structured-notes', () => {
  it('opens with the shared Fable PageHeader (first real consumer)', () => {
    assert.match(PAGE, /@\/components\/fable\/PageHeader/)
    assert.match(PAGE, /<PageHeader/)
    assert.match(PAGE, /title=\{t\.sn\.tag\}/)
  })

  it('renders the Fable capsule row on the KPI-glass tier with auto-fit columns', () => {
    assert.match(PAGE, /repeat\(auto-fit, minmax\(150px, 1fr\)\)/)
    assert.match(PAGE, /nv-glass-kpi/)
    assert.match(PAGE, /<StatCapsule/)
  })

  it('keeps ALL SEVEN existing NMI dashboard KPIs plus the Fable next-observation capsule', () => {
    for (const key of ['dashLive', 'dashSafe', 'dashWatch', 'dashAutocallable', 'dashBreached', 'dashCalled', 'dashNotional', 'dashNextObs']) {
      assert.ok(PAGE.includes(`t.sn.${key}`), `capsule ${key} must be present`)
    }
  })

  it('status capsules keep their click-to-filter behavior and legend tooltips', () => {
    assert.match(PAGE, /onClick=\{\(\) => focusStatus\('safe'\)\}/)
    assert.match(PAGE, /onClick=\{\(\) => focusStatus\('breached'\)\}/)
    assert.match(PAGE, /onClick=\{\(\) => setView\('archived'\)\}/)
    assert.match(PAGE, /title=\{t\.sn\.legendSafe\}/)
  })

  it('renders the Fable lifecycle legend as chips with the full sentences preserved (title + sr-only)', () => {
    for (const key of ['legendSafe', 'legendWatch', 'legendAutocallable', 'legendBreached']) {
      assert.ok(PAGE.includes(`t.sn.${key}`), `legend ${key} must be present`)
    }
    assert.match(PAGE, /title=\{l\.tip\}/)
    assert.match(PAGE, /sr-only/)
    assert.match(PAGE, /t\.sn\.clickHint/)
  })

  it('uses the signature BarrierGauge column on the Fable 0–130 scale semantics', () => {
    assert.match(PAGE, /@\/components\/fable\/BarrierGauge/)
    assert.match(PAGE, /<BarrierGauge\s+current=\{gaugeLevel\}\s+marks=\{gaugeMarks\}/)
    // worst-of level indexed to 100 at strike; knock-in + strike ticks
    assert.match(PAGE, /\(1 \+ perf\) \* 100/)
    assert.match(PAGE, /kind: 'knockIn' as const, level: n\.knockInBarrierPct \* 100/)
    assert.match(PAGE, /kind: 'strike' as const, level: 100/)
  })

  it('houses the table in the shared TableCard with card-level horizontal scroll', () => {
    assert.match(PAGE, /@\/components\/fable\/TableCard/)
    // density repair: the scroll floor is the column system's own sum
    assert.match(PAGE, /minWidth=\{COLS\.reduce\(\(a, b\) => a \+ b, 0\)\}/)
  })

  it('filters are Fable chips and the Live/Archived toggle is the shared SegmentedControl', () => {
    assert.match(PAGE, /@\/components\/fable\/Chip/)
    assert.match(PAGE, /<ChipSelect value=\{statusFilter\}/)
    assert.match(PAGE, /<ChipSelect value=\{issuerFilter\}/)
    assert.match(PAGE, /@\/components\/fable\/SegmentedControl/)
    assert.match(PAGE, /ariaLabel=\{t\.sn\.viewToggle\}/)
  })

  it('the composite NOTE cell shows product name over ISIN · underlyings — no identifier lost', () => {
    assert.match(PAGE, /\{n\.productName \|\| n\.isin \|\| '—'\}/)
    assert.match(PAGE, /<span className="font-mono">\{n\.isin\}<\/span>/)
    assert.match(PAGE, /n\.underlyings\.map\(\(u\) => u\.underlyingName\)\.join\(' \/ '\)/)
  })

  it('motion uses only the shared reduced-motion-gated wrappers — no bespoke animation', () => {
    assert.match(PAGE, /@\/components\/fable\/motion/)
    assert.match(PAGE, /<Reveal/)
    assert.ok(!/animation\s*:/.test(PAGE_CODE), 'no inline animation styles')
    assert.ok(!PAGE_CODE.includes('onMouseMove'), 'no pointer-position React state updates')
  })

  it('uses token-only styling — no raw Tailwind color scales, no bg-white/text-black', () => {
    assert.ok(!/bg-(gray|slate|zinc|emerald|red|blue|green)-\d/.test(PAGE_CODE))
    assert.ok(!PAGE_CODE.includes('bg-white') && !PAGE_CODE.includes('text-black'))
    // the only hex values are the pre-existing, analytically-justified chart palette
    const hexes = PAGE_CODE.match(/#[0-9A-Fa-f]{6}/g) ?? []
    const palette = PAGE_CODE.match(/const CHART_PALETTE = \[[^\]]*\]/)?.[0] ?? ''
    for (const h of hexes) assert.ok(palette.includes(h), `hex ${h} outside CHART_PALETTE`)
  })

  it('dense numeric columns center with tabular figures (final manual review; supersedes the earlier right-alignment)', () => {
    assert.match(PAGE, /text-center ui-number/)
    assert.ok(!PAGE_CODE.includes('text-right ui-number'), 'the interim right alignment is superseded by the density repair')
  })
})

describe('R3.2 — page stays inside the one authenticated AppShell', () => {
  it('/structured-notes is NOT a bare route — ShellGate keeps it under AppShell', () => {
    assert.ok(!SHELL_GATE.includes("'/structured-notes'"), 'must not join BARE_ROUTES')
    assert.match(APP_SHELL, /TopBar/)
  })

  it('mounts no second shell, TopBar, theme provider, or LangProvider of its own', () => {
    for (const banned of ['AppShell', 'TopBar', 'LangProvider>', 'ThemeProvider', 'login-santiago', 'AuthShell']) {
      assert.ok(!PAGE_CODE.includes(banned), `page must not mount ${banned}`)
    }
    assert.match(PAGE, /useLang\(\)/)
  })
})

describe('R3.3 — canonical routing preserved', () => {
  it('the detail route file still exists at /structured-notes/[id]', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/structured-notes/[id]/page.tsx')))
  })

  it('every dashboard note link and the row navigation target the canonical detail route', () => {
    assert.match(PAGE, /href=\{`\/structured-notes\/\$\{n\.id\}`\}/)
    assert.match(PAGE, /router\.push\(`\/structured-notes\/\$\{n\.id\}`\)/)
  })

  it('row navigation ignores clicks on interactive cells (checkbox, links, buttons)', () => {
    assert.match(PAGE, /closest\('a, button, input, label'\)/)
  })

  it('introduces no modal-only detail, duplicate route, or query-string replacement', () => {
    // R7.1B — the page now imports the shared ModalShell module for its
    // DestructiveConfirm delete gate. That is a confirmation dialog, not a
    // note-detail surface, so the rule this test protects (a modal may never
    // stand in for the canonical /structured-notes/[id] route) is unchanged
    // and is asserted directly below instead of by the import's absence.
    assert.ok(!/<ModalShell/.test(PAGE_CODE), 'no raw modal renders note detail')
    assert.ok(!PAGE_CODE.includes('DetailPanel'), 'no panel replacing the canonical route')
    assert.ok(!/\?note=|noteId=/.test(PAGE_CODE), 'no query-string detail navigation')
    assert.match(PAGE_CODE, /router\.push\(`\/structured-notes\/\$\{n\.id\}`\)/, 'rows still route to the canonical page')
    // The only dialog on this page is the destructive-confirmation gate.
    assert.match(PAGE_CODE, /<DestructiveConfirm/)
  })
})

describe('R3.4 — no Fable mock structured-note content', () => {
  it('none of the Fable prototype sample notes/issuers/valuations appear', () => {
    for (const mock of [
      'Autocall Worst-of US Tech', 'Reverse Convertible SQM', 'Memory Coupon EURO STOXX',
      'Capital Protected S&P 500', 'Worst-of Chilean Banks', 'Autocall Copper Miners',
      'J.P. Morgan', 'Morgan Stanley', 'Citigroup', 'Santander', 'UBS',
      'Sample data', 'sample data', '112.4', '91.3', '104.8', '108.2', '96.7', '109.4',
    ]) {
      assert.ok(!PAGE.includes(mock), `Fable mock content "${mock}" must not enter production`)
    }
  })

  it('all note data still comes from the real API, never a local fixture', () => {
    assert.match(PAGE, /fetch\('\/api\/structured-notes', \{ cache: 'no-store' \}\)/)
    assert.ok(!/from '.*fixtures/.test(PAGE), 'no fixture import')
    assert.ok(!/const NOTES\s*=/.test(PAGE_CODE), 'no embedded note records')
  })
})

describe('R3.5 — API contracts and monitoring/workbook logic unchanged', () => {
  it('the page still calls exactly the pre-R3 endpoints', () => {
    assert.match(PAGE, /fetch\('\/api\/structured-notes\/monitoring-status', \{ cache: 'no-store' \}\)/)
    assert.match(PAGE, /fetch\('\/api\/structured-notes\/extract', \{ method: 'POST', body: form \}\)/)
    assert.match(PAGE, /fetch\('\/api\/structured-notes\/import', \{/)
    assert.match(PAGE, /fetch\(`\/api\/structured-notes\/\$\{noteId\}`, \{/)
    assert.match(PAGE, /body: JSON\.stringify\(\{ status: called \? 'autocalled' : 'active' \}\)/)
  })

  it('every structured-notes API route file still exists', () => {
    for (const rel of [
      'src/app/api/structured-notes/route.ts',
      'src/app/api/structured-notes/[id]/route.ts',
      'src/app/api/structured-notes/extract/route.ts',
      'src/app/api/structured-notes/import/route.ts',
      'src/app/api/structured-notes/monitoring-status/route.ts',
    ]) {
      assert.ok(existsSync(join(ROOT, rel)), `${rel} must exist`)
    }
  })

  it('the dashboard math still lives in src/lib/structuredNotes — the page imports types only', () => {
    const dashboard = read('src/lib/structuredNotes/dashboard.ts')
    assert.match(dashboard, /export function computeNoteMetrics/)
    assert.match(dashboard, /export function buildBookDashboard/)
    assert.match(PAGE, /import type \{ NoteDashboardMetrics, BookSummary \} from '@\/lib\/structuredNotes\/dashboard'/)
    assert.ok(!PAGE_CODE.includes("from '@/lib/providers"), 'never imports a server-only provider')
    assert.ok(!PAGE_CODE.includes('supabase'), 'never touches Supabase directly')
  })

  it('the barrier-proximity coloring is display-only and documented as such', () => {
    // distanceTone mirrors the Fable thresholds; the eligibility math stays in lib
    assert.match(PAGE, /function distanceTone/)
    assert.match(PAGE, /Never feeds\s+\* any eligibility\/business logic/)
    assert.ok(!PAGE_CODE.includes('calculateCouponEligibility'), 'no business calc re-implemented on the page')
  })
})

describe('R3.6 — real-data states preserved and honest', () => {
  it('loading, error, empty and populated states all exist, via the shared AsyncState kinds', () => {
    // AMENDED by POST-R13.6CDE: a FIFTH state joined the four. An authorization
    // denial used to render as `error` ("Something went wrong"), which invited
    // the user to retry something that could never succeed. Asserted as an
    // ordered chain rather than one literal so the branches stay distinguishable.
    // Whitespace-normalised: the chain is formatted across several lines.
    const flat = PAGE.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ')
    for (const branch of [
      "const tableState = loading ? 'loading' as const",
      ": notAuthorized ? 'not_authorized' as const",
      ": loadFailed ? 'error' as const",
      ": shown.length === 0 ? 'empty' as const",
    ]) {
      assert.ok(flat.includes(branch), `missing branch: ${branch}`)
    }
    assert.match(PAGE, /stateMessage=\{tableState === 'empty' \? t\.sn\.empty : undefined\}/)
  })

  it('a failed initial load renders the error state, never the empty-book copy', () => {
    assert.match(PAGE, /setNotes\(\[\]\); setNotAuthorized\(false\); setLoadFailed\(true\)/)
  })

  it('a DENIAL is not rendered as a failure, and never as a confirmed-empty book', () => {
    // The two are mutually exclusive at the point of assignment, so the page can
    // never claim both, and a denied caller never sees "no structured notes yet".
    assert.match(PAGE, /res\.status === 403.*setNotAuthorized\(true\); setLoadFailed\(false\)/)
    assert.ok(!/res\.status === 403.*setLoadFailed\(true\)/.test(PAGE))
  })

  it('the source footer keeps the real provider and the book-level as-of timestamp', () => {
    assert.match(PAGE, /<TableSourceFooter source=\{t\.sn\.sourceMarket\} asOf=\{summary\?\.pricesAsOf \?\? null\}/)
  })

  it('monitoring exception counts from the scheduled job are all still surfaced', () => {
    for (const key of ['staleNoteCount', 'unsupportedUnderlyingCount', 'dueSoonCount', 'reviewRequiredCount']) {
      assert.ok(PAGE.includes(key), `${key} warning must be preserved`)
    }
    assert.match(PAGE, /fallbackProviderUsed/)
    assert.match(PAGE, /providerDisagreement/)
  })

  it('the upload → extract → review → import workflow survives intact', () => {
    assert.match(PAGE, /accept="application\/pdf"/)
    assert.match(PAGE, /t\.sn\.reviewState\[preview\.reviewState\]/)
    assert.match(PAGE, /disabled=\{busy \|\| preview\.errors\.length > 0\}/)
    assert.match(PAGE, /t\.sn\.extractError/)
    assert.match(PAGE, /t\.sn\.importError/)
  })

  it('the near-observation highlight and archived-view column swap are preserved', () => {
    assert.match(PAGE, /daysToNextObservation != null && m\.daysToNextObservation <= 7/)
    assert.match(PAGE, /view === 'archived'/)
    assert.match(PAGE, /t\.sn\.colArchivedAt/)
  })

  it('sorting still covers issuer, issued, status and next-observation with aria-sort', () => {
    for (const key of ["'issued'", "'issuer'", "'status'", "'next'"]) {
      assert.ok(PAGE.includes(`sortKey === ${key}`) || PAGE.includes(`toggleSort(${key})`), `sort key ${key}`)
    }
    assert.match(PAGE, /aria-sort=\{active \? \(dir === 'asc' \? 'ascending' : 'descending'\) : undefined\}/)
  })
})

describe('R3.7 — localization and accessibility', () => {
  it('adds the new R3 keys in BOTH dictionaries and hardcodes no visible copy', () => {
    for (const key of ['pageMeta:', 'colNote:', 'colLevel:', 'dashNextObs:', 'clickHint:', 'viewToggle:']) {
      const count = I18N.split(key).length - 1
      assert.ok(count >= 2, `${key} must exist in EN and ES (found ${count})`)
    }
    assert.ok(I18N.includes("'Próxima observación'"))
    assert.ok(I18N.includes("'Ciclo de vida, barreras y observaciones'"))
  })

  it('form controls carry accessible names', () => {
    assert.match(PAGE, /aria-label=\{t\.sn\.upload\}/)
    assert.match(PAGE, /aria-label=\{t\.sn\.filterStatus\}/)
    assert.match(PAGE, /aria-label=\{t\.sn\.filterIssuer\}/)
    assert.match(PAGE, /aria-label=\{`\$\{t\.sn\.colCalled\}: \$\{n\.productName\}`\}/)
  })

  it('the file input is focusable (sr-only, not display:none) with a focus-within ring on its label', () => {
    assert.match(PAGE, /type="file" accept="application\/pdf" onChange=\{handleFile\} className="sr-only"/)
    assert.match(PAGE, /focus-within:outline-2/)
  })

  it('the table keeps semantics: caption, scoped headers, real buttons for sort', () => {
    assert.match(PAGE, /<caption className="sr-only">\{t\.sn\.tag\}<\/caption>/)
    assert.match(PAGE, /scope="col"/)
    assert.match(PAGE, /<button\s+type="button"\s+onClick=\{onClick\}/)
  })

  it('status is never conveyed by color alone — pills and capsules carry label text', () => {
    assert.match(PAGE, /riskLabel\(m\.riskStatus\)/)
    assert.match(PAGE, /the label text always names the status/)
  })
})

describe('R3.8 — R1.5 security boundary untouched', () => {
  it('/structured-notes and its APIs remain private under the shared default-deny policy', async () => {
    const { classifyPath, PUBLIC_PAGE_PATHS } = await import('../src/lib/auth/accessPolicy.ts')
    assert.equal(classifyPath('/structured-notes'), 'private_page')
    assert.equal(classifyPath('/structured-notes/some-id'), 'private_page')
    assert.equal(classifyPath('/api/structured-notes'), 'private_api')
    assert.equal(classifyPath('/api/structured-notes/extract'), 'private_api')
    assert.deepEqual([...PUBLIC_PAGE_PATHS], ['/login', '/forgot-password', '/auth/reset-password'])
  })

  it('no registration surface returned and the middleware is not named per-route', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/api/auth/register')), 'register route stays absent')
    assert.ok(!read('src/middleware.ts').includes("'/structured-notes'"), 'route never named in middleware')
  })
})

describe('R3.9 — phase boundary: the detail page joined the Fable family in R4', () => {
  // The pre-R4 form of this describe asserted the detail page had NOT been
  // redesigned. R4 is that page's re-skin phase, so the boundary moves — the
  // real phase boundary advancing, not a relaxed assertion (same precedent as
  // the 5F/5H guard-list updates). The full R4 contract lives in
  // tests/fableStructuredNoteDetailPage.test.ts.
  it('the detail page now uses the shared Fable composition', () => {
    assert.match(DETAIL, /@\/components\/fable\/PageHeader/)
    assert.ok(!DETAIL.includes('SectionHeader'), 'the pre-Fable SectionHeader is superseded on this route')
  })

  it('the detail page keeps its monitoring-estimate disclaimer (secondRoundFixes contract)', () => {
    assert.match(DETAIL, /t\.sn\.monitoring\.estimateDisclaimer/)
  })
})

// ── R3 manual-validation repair (post-R3 visual refinement, same phase) ─────────

describe('R3.R1 — triage-first table order', () => {
  const thead = PAGE.slice(PAGE.indexOf('<thead>'), PAGE.indexOf('</thead>'))

  it('status and next observation lead; the administrative Called checkbox moves last', () => {
    const order = ['colStatus', 'colNext', 'colNote', 'colIssuer', 'colLevel', 'colDistance', 'colWorst', 'colCoupon', 'colKnockIn', 'colIssued', 'colNotional', 'colCalled']
    let last = -1
    for (const key of order) {
      const i = thead.indexOf(`t.sn.${key}`)
      assert.ok(i > last, `t.sn.${key} must appear after the previous column (found at ${i}, previous at ${last})`)
      last = i
    }
  })

  it('the archived-view column swap stays in the same early slot', () => {
    assert.ok(thead.indexOf('t.sn.colArchivedAt') < thead.indexOf('t.sn.colNote'))
  })

  it('the NOTE column is width-capped (via the column system) with the full name and identifiers revealed on hover', () => {
    assert.match(PAGE, /title=\{n\.productName \|\| n\.isin \|\| undefined\}/)
    assert.match(PAGE, /title=\{noteSub \|\| undefined\}/)
    // the hover line carries the same content as the visible (truncated) line
    assert.match(PAGE, /const noteSub = \[n\.isin, n\.underlyings\.map\(\(u\) => u\.underlyingName\)\.join\(' \/ '\)\]\.filter\(Boolean\)\.join\(' · '\)/)
  })
})

describe('R3.R3 — table-density repair: compact desktop column system', () => {
  it('uses table-layout: fixed with an explicit COLS colgroup — no browser auto-sizing', () => {
    assert.match(PAGE, /tableLayout: 'fixed'/)
    assert.match(PAGE, /<colgroup>/)
    assert.match(PAGE, /\{COLS\.map\(\(w, i\) => <col key=\{i\} style=\{\{ width: w \}\} \/>\)\}/)
  })

  it('the column system adapts to the wider Spanish status pill and the archived-view header', () => {
    assert.match(PAGE, /lang === 'es' \? 150 : 118/)
    assert.match(PAGE, /view === 'archived' \? 130 : 120/)
  })

  it('the requested columns center header and cells; Status and Note stay left; the gauge centers', () => {
    const thead = PAGE.slice(PAGE.indexOf('<thead>'), PAGE.indexOf('</thead>'))
    // centered sortable headers: Next obs, Issuer, Issued
    assert.equal((thead.match(/align="center"/g) ?? []).length, 3)
    // centered plain headers: Archived-as-of, Level, Distance, Worst, Coupon,
    // Knock-in, Notional, Called — plus (R7.1B) the far-right Actions header,
    // whose label is sr-only because the column holds one icon-only control.
    assert.equal((thead.match(/text-center/g) ?? []).length, 9)
    assert.match(thead, /<span className="sr-only">\{t\.sn\.colActions\}<\/span>/)
    // Status header stays left (no align override), Note header explicit left
    assert.match(thead, /label=\{t\.sn\.colStatus\} sortTitle=\{t\.sn\.sortBy\} active=\{sortKey === 'status'\} arrow=\{sortArrow\('status'\)\} onClick=\{\(\) => toggleSort\('status'\)\} dir=\{sortDir\} \/>/)
    assert.match(thead, /text-left`\} style=\{thBg\}>\{t\.sn\.colNote\}/)
    // gauge cell centered
    assert.match(PAGE, /text-center`\}>\s*<BarrierGauge/)
  })

  it('the two long headers wrap deliberately instead of forcing wide columns', () => {
    assert.match(PAGE, /const thBaseWrap = .*whitespace-normal leading-tight/)
    assert.match(PAGE, /thBaseWrap\} text-center`\} style=\{thBg\}>\{t\.sn\.colDistance\}/)
    assert.match(PAGE, /thBaseWrap\} text-center`\} style=\{thBg\}>\{t\.sn\.colCoupon\}/)
  })

  it('underlying tickers drop the redundant Bloomberg market qualifier for display only', () => {
    assert.match(PAGE, /function shortUnderlying/)
    // strips only a RECOGNIZED trailing qualifier (optional exchange code)
    assert.match(PAGE, /\^\(\\S\+\)\\s\+\(\?:\[A-Z\]\{2\}\\s\+\)\?\(\?:Index\|Equity\|Curncy\|Comdty\|Govt\|Corp\)\$/)
    assert.match(PAGE, /return m \? m\[1\] : name/)
    // applied to the Worst cell and the NOTE underlyings line
    assert.match(PAGE, /\{shortUnderlying\(m\.worstPerformer\.underlyingName\)\}/)
    assert.match(PAGE, /n\.underlyings\.map\(\(u\) => shortUnderlying\(u\.underlyingName\)\)\.join\(' \/ '\)/)
    // the stored value is untouched: hover titles and the extraction review
    // still show the verbatim term-sheet ticker
    assert.match(PAGE, /title=\{m\.worstPerformer\.underlyingName\}/)
    assert.match(PAGE, /const noteSub = \[n\.isin, n\.underlyings\.map\(\(u\) => u\.underlyingName\)/)
    assert.match(PAGE, /value=\{preview\.note\.underlyings\.map\(\(u\) => u\.underlyingName\)\.join\(', '\)\}/)
    // never feeds symbol resolution
    assert.ok(!PAGE_CODE.includes('yahooSymbolForUnderlying'))
  })

  it('percent, date and notional values never truncate silently — text cells truncate with full-value titles', () => {
    // issuer, worst-performer name and notional carry truncate + title reveals
    assert.match(PAGE, /title=\{n\.issuerDisplayName \?\? undefined\}/)
    assert.match(PAGE, /title=\{m\.worstPerformer\.underlyingName\}/)
    // R11 supersedes the notional half of this assertion. The notional is one
    // of the six documented PRIVATE amounts, and a `title` tooltip repeating it
    // verbatim would hand the raw value straight past Privacy Mode's mask — the
    // exact leak shape `tests/r11ConsistencySweep.test.ts` now bans. The cell
    // still truncates safely; it just reveals through the privacy boundary
    // rather than a raw tooltip. Issuer and worst-performer (both public
    // identifiers, asserted above) keep their title reveals unchanged.
    assert.doesNotMatch(PAGE, /title=\{`\$\{n\.currency\} \$\{fmtNum\(m\?\.currentNotional \?\? 0\)\}`\}/)
    assert.match(PAGE, /<PrivacyValue masked=\{masked\} className="block">/)
    // the worst-performer % is shrink-proof next to its truncating name
    assert.match(PAGE, /ui-number shrink-0/)
  })

  it('the gauge stays readable in its column — 140px track plus a compact single-line reading', () => {
    assert.match(PAGE, /width=\{140\}/)
    assert.match(PAGE, /summary=\{gaugeLevel !== null \? `\$\{t\.fable\.barrier\.current\} \$\{gaugeLevel\.toFixed\(1\)\}` : undefined\}/)
  })

  it('keeps overflow contained at the card, never the page', () => {
    const tableCard = read('src/components/fable/TableCard.tsx')
    assert.match(tableCard, /overflow-x-auto/)
    assert.ok(!PAGE_CODE.includes('min-width: 1200px'), 'no page-level min-width')
    assert.ok(!PAGE_CODE.includes('overflow-x-visible'), 'no overflow escape hatch')
  })
})

describe('R3.R2 — Fable-native exposure cards', () => {
  const bar = PAGE.slice(PAGE.indexOf('function BarChart'), PAGE.indexOf('function Donut'))
  const donut = PAGE.slice(PAGE.indexOf('function Donut'))

  it('both cards share the Fable header with a localized TOTAL anchor (EN + ES)', () => {
    assert.match(PAGE, /<ExposureHeader/)
    assert.match(PAGE, /function ExposureHeader/)
    const count = I18N.split('totalLabel:').length - 1
    assert.ok(count >= 2, `totalLabel must exist in EN and ES (found ${count})`)
  })

  it('issuer exposure is a ranked list on the chip track with a uniform accent fill', () => {
    assert.match(bar, /backgroundColor: 'var\(--nv-chip\)'/)
    assert.match(bar, /backgroundColor: 'var\(--accent\)'/)
    assert.ok(!bar.includes('CHART_PALETTE'), 'per-issuer palette colors falsely implied a link with the entity donut')
    // exact values and shares stay printed on every row
    assert.match(bar, /\{pct\.toFixed\(1\)\}%/)
    assert.match(bar, /fmtNum\(d\.value\)/)
  })

  it('the entity donut gains gapped segments, a center total, and a hover-linked legend', () => {
    assert.match(donut, /const gap = positive\.length > 1 \? 1\.6 : 0/)
    assert.match(donut, /\{totalLabel\}/)
    assert.match(donut, /onMouseEnter=\{\(\) => setHi\(s\.label\)\}/)
    assert.match(donut, /opacity=\{hi && hi !== s\.label \? 0\.3 : 1\}/)
    // legend still prints every exact value and share
    assert.match(donut, /fmtNum\(s\.value\)/)
    assert.match(donut, /\(s\.frac \* 100\)\.toFixed\(1\)/)
  })

  it('hover emphasis stays lightweight — no pointer-position state, no chart library', () => {
    assert.ok(!PAGE_CODE.includes('onMouseMove'))
    assert.ok(!/from 'recharts'|from 'chart\.js'|from 'd3'/.test(PAGE), 'no chart dependency')
  })
})
