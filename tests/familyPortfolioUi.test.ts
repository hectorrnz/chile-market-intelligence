// R13.6 — Family Portfolio module shell + Portfolio UI (doc 08 Stage 6).
//
// Structural and unit tests over the Stage-6 surface: the module shell and
// navigation, the three client read endpoints, the read repository's
// two-client split, the Portfolio page's honest states, privacy masking,
// scope-name leakage, responsive conventions and the `/portfolio`
// (Chilean-equities) non-interference boundary.
//
// Run with: npm test  (Node 24 strips the TS types natively — no toolchain)

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { dict } from '../src/lib/i18n.ts'
import { formatUsd, formatIsoDateLabel } from '../src/lib/formatters.ts'
import { selectPublicationWeek } from '../src/lib/familyPortfolio/memberRead.ts'
import { PALETTE_TOKENS } from '../src/lib/familyPortfolio/allocationSettings.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const LAYOUT = 'src/app/portfolio/layout.tsx'
const OVERVIEW_PAGE = 'src/app/portfolio/page.tsx'
const PORTFOLIO_PAGE = 'src/app/portfolio/holdings/page.tsx'
const WEEKLY_PAGE = 'src/app/portfolio/weekly-changes/page.tsx'
const ALTERNATIVES_PAGE = 'src/app/portfolio/alternatives/page.tsx'
const SCOPES_ROUTE = 'src/app/api/family-portfolio/scopes/route.ts'
const WEEKS_ROUTE = 'src/app/api/family-portfolio/[scope]/weeks/route.ts'
const SNAPSHOT_ROUTE = 'src/app/api/family-portfolio/[scope]/snapshot/route.ts'
const READ_REPO = 'src/lib/db/repositories/familyPortfolioReadRepository.ts'
const PROVIDER = 'src/components/familyPortfolio/FamilyPortfolioProvider.tsx'
const NAV = 'src/components/familyPortfolio/FamilyPortfolioNav.tsx'
const GATE = 'src/components/familyPortfolio/MemberGate.tsx'
const TABLE = 'src/components/familyPortfolio/HierarchicalTable.tsx'
const WEEK_SELECTOR = 'src/components/familyPortfolio/WeekSelector.tsx'
const DATA_HELPER = 'src/lib/data/familyPortfolio.ts'
// R13.7 additions.
const MASKED_AMOUNT = 'src/components/familyPortfolio/MaskedAmount.tsx'
const DONUT = 'src/components/familyPortfolio/AllocationDonut.tsx'
const FRESHNESS = 'src/components/familyPortfolio/DualFreshnessBadge.tsx'
// R13.8 additions. R13.R3C retired `ValueChangeWaterfall` and
// `DivergingBarChart` — both superseded by the shared Contributors and
// Detractors system, which joins this list in their place so the module's
// privacy, hex-colour and no-toLocaleString hygiene applies to it too.
const RECON_STATUS = 'src/components/familyPortfolio/ReconciliationStatus.tsx'
const CONTRIB_CHART = 'src/components/familyPortfolio/ContributionChart.tsx'
const CONTRIB_MODAL = 'src/components/familyPortfolio/ContributionBreakdownModal.tsx'
const PERIOD_CARD = 'src/components/familyPortfolio/PeriodValueChangeCard.tsx'

// R13.R2 additions — the recomposed Summary's presentation components. They
// join CLIENT_FILES so the module's privacy, hex-colour and no-toLocaleString
// hygiene applies to them from the day they ship, not from whenever someone
// remembers to add them.
const STRIP = 'src/components/familyPortfolio/PerformanceMarketsStrip.tsx'
const SNAPSHOT_CARD = 'src/components/familyPortfolio/WeeklySnapshotCard.tsx'
const ALLOC_PANEL = 'src/components/familyPortfolio/AllocationPanel.tsx'
const ALLOC_SETTINGS = 'src/components/familyPortfolio/AllocationSettingsDialog.tsx'
const EVO_CHART = 'src/components/familyPortfolio/PortfolioEvolutionChart.tsx'

// R13.R4A additions — Alternatives became three views over one publication, so
// the sub-module's own shell, shared state and presentation components join
// CLIENT_FILES and inherit the module's privacy, hex-colour and
// no-toLocaleString hygiene from the day they ship. `EventTimeline` was retired
// in the same pass: its month-banded list is superseded by the Cash Flows
// ledger table, and its chip/label/legend helpers moved to the chrome module,
// which takes its place here.
const ALT_LAYOUT = 'src/app/portfolio/alternatives/layout.tsx'
const ALT_HOLDINGS = 'src/app/portfolio/alternatives/holdings/page.tsx'
const ALT_CASHFLOWS = 'src/app/portfolio/alternatives/cash-flows/page.tsx'
const ALT_PROVIDER = 'src/components/familyPortfolio/AlternativesProvider.tsx'
const ALT_SUBNAV = 'src/components/familyPortfolio/AlternativesSubnav.tsx'
const ALT_FILTERS = 'src/components/familyPortfolio/AlternativesFilters.tsx'
const ALT_CHROME = 'src/components/familyPortfolio/AlternativesEventChrome.tsx'
const ALT_CHART = 'src/components/familyPortfolio/AlternativesCashFlowChart.tsx'
// R13.R4A.1 — the two drill-down dialogs join the module's client surface, so
// they inherit its privacy, hex-colour and no-inline-formatting hygiene.
const ALT_DRILLDOWNS = 'src/components/familyPortfolio/AlternativesDrilldowns.tsx'

/** Every CLIENT file the module ships — pages, components, the fetch helper. */
const CLIENT_FILES = [
  LAYOUT, OVERVIEW_PAGE, PORTFOLIO_PAGE, WEEKLY_PAGE, ALTERNATIVES_PAGE,
  PROVIDER, NAV, GATE, TABLE, WEEK_SELECTOR, DATA_HELPER,
  MASKED_AMOUNT, DONUT, FRESHNESS,
  RECON_STATUS, CONTRIB_CHART, CONTRIB_MODAL, PERIOD_CARD,
  STRIP, SNAPSHOT_CARD, ALLOC_PANEL, ALLOC_SETTINGS, EVO_CHART,
  ALT_LAYOUT, ALT_HOLDINGS, ALT_CASHFLOWS,
  ALT_PROVIDER, ALT_SUBNAV, ALT_FILTERS, ALT_CHROME, ALT_CHART, ALT_DRILLDOWNS,
]

/** Strips comments so hygiene regexes cannot be tripped by prose. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Shell and navigation anatomy
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · module shell', () => {
  test('the shell exists: layout + five pages, provider mounted once', () => {
    for (const rel of [LAYOUT, OVERVIEW_PAGE, PORTFOLIO_PAGE, WEEKLY_PAGE, ALTERNATIVES_PAGE]) {
      assert.ok(existsSync(join(ROOT, rel)), `${rel} must exist`)
    }
    const layout = read(LAYOUT)
    assert.match(layout, /FamilyPortfolioProvider/)
    assert.match(layout, /FamilyPortfolioNav/)
  })

  test('navigation items derive from the server-filtered scopes response, never a static scope list', () => {
    const nav = read(NAV)
    assert.match(nav, /useFamilyPortfolio\(\)/)
    // The nav knows the STRUCTURAL scope id `alternatives` (a module surface),
    // but no principal identity: those ids and names must never be hardcoded
    // into any client file. (Checked repo-wide in the leakage section below.)
    assert.match(nav, /isAdministrator/)
    // Admin follows the administrator flag, not a scope value.
    assert.match(nav, /if \(isAdministrator\) \{/)
    // Containment: the rail scrolls internally, never widening the page.
    assert.match(nav, /overflow-x-auto/)
    assert.match(nav, /aria-current/)
    assert.match(nav, /aria-label/)
  })

  test('every member surface is now a real implementation behind the member gate', () => {
    // R13.7 graduated the Overview; R13.8 graduated Weekly Changes; R13.9
    // graduated Alternatives — no placeholder page remains.
    // R13.R4A — Alternatives is three views over one publication, so the fetch
    // and the member gate live in its own sub-module shell, once, rather than
    // being repeated in each view.
    assert.match(read(ALT_PROVIDER), /fetchFamilyPortfolioAlternatives/,
      'Alternatives fetches its real read model')
    assert.match(read(ALT_LAYOUT), /MemberGate/)
    for (const rel of [ALTERNATIVES_PAGE, ALT_HOLDINGS, ALT_CASHFLOWS, ALT_LAYOUT]) {
      const src = read(rel)
      assert.ok(!src.includes('kind="unavailable"'), `${rel}: the placeholder state is gone`)
      assert.ok(!/fetchFamilyPortfolioSnapshot|HierarchicalTable/.test(src),
        `${rel}: Alternatives renders its own model, never the snapshot table`)
    }
    const overview = read(OVERVIEW_PAGE)
    // R13.R2 § 10 — the Summary serves the caller's own personal portfolio as
    // well as Main, so the scope is DERIVED from the entitled list rather than
    // hardcoded. The property asserted is unchanged (this is the real page,
    // reading through the real client helper); only the argument moved.
    assert.match(overview, /fetchFamilyPortfolioOverview\(activeScope\)/,
      'the Summary is the real page and reads whichever entitled scope is active')
    // R13.R5C.4 — the derivation moved into the module's one shared rule
    // (`portfolioScopeRoutes.ts`), which the rail and all three scope-aware
    // views now call. The property asserted is unchanged: options come from the
    // SERVER-FILTERED entitlement, never a client list.
    assert.match(overview, /const portfolioScopes = portfolioScopesOf\(scopes\)/,
      'scope options come from the SERVER-FILTERED entitlement, never a client list')
    assert.match(overview, /MemberGate/)
    const weekly = read(WEEKLY_PAGE)
    assert.match(weekly, /fetchFamilyPortfolioWeeklyChanges/,
      'Weekly Changes is now the real Stage-8 page')
    assert.match(weekly, /MemberGate/)
  })

  test('the zero-scope caller gets a plain no-access state — loading, error and denied stay distinct', () => {
    const gate = read(GATE)
    assert.match(gate, /status === 'loading'/)
    assert.match(gate, /status === 'error'/)
    assert.match(gate, /status === 'denied' \|\| scopes\.length === 0/)
    assert.match(gate, /noAccess/)
  })

  // SUPERSEDED BY R13.R1 § 2, deliberately. Stage 6 deferred app-level wiring
  // ("release wiring for a later stage"); R13.R1 IS that stage — the primary
  // Portfolio item now opens `/portfolio`. The property that still
  // matters is the one Stage 6 was actually protecting: the static app-nav
  // config cannot express per-user entitlement, so it must carry no
  // authorization logic and no per-scope destination. Module navigation
  // (`FamilyPortfolioNav`) remains the only entitlement-aware rail.
  test('the app-level primary navigation carries no entitlement logic', () => {
    const nav = read('src/lib/navigation.ts')
    assert.ok(nav.includes('/portfolio'), 'R13.R1 § 2: the module is the Portfolio destination')
    for (const forbidden of ['isAdministrator', 'entitle', 'scopes', 'canRead', 'auth']) {
      assert.ok(!nav.includes(forbidden), `navigation.ts must not reference ${forbidden}`)
    }
    // No per-principal destination may appear in the static config.
    assert.ok(!/portfolio\/(jaime|andres|pablo)/i.test(nav))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Scope-name leakage
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · unentitled principals never reach the browser', () => {
  test('no client file carries a principal identity — names or scope ids', () => {
    // Doc 07 § 7: for Jaime, "Andrés's and Pablo's names never reach the
    // browser". Scope display labels are therefore SERVER-supplied per caller;
    // a static client-side map would ship every name to every user.
    for (const rel of CLIENT_FILES) {
      const src = codeOf(read(rel))
      assert.ok(!/jaime|andres|andrés|pablo/i.test(src),
        `${rel} must not hardcode a principal identity`)
    }
  })

  test('the fp i18n block carries no principal identity in either language', () => {
    for (const lang of ['en', 'es'] as const) {
      const block = JSON.stringify(dict[lang].fp)
      assert.ok(!/jaime|andres|andrés|pablo/i.test(block),
        `dict.${lang}.fp must not name a principal`)
    }
  })

  test('scope display labels live in the scopes route, server-side only', () => {
    const route = read(SCOPES_ROUTE)
    assert.match(route, /SCOPE_LABELS/)
    assert.ok(!route.includes("'use client'"))
  })

  test('the scopes route returns only the caller\'s scopes and filters the admin capability out of the list', () => {
    const route = read(SCOPES_ROUTE)
    assert.match(route, /entitlement\.scopes\s*\n?\s*\.filter\(\(s\) => s !== 'admin'\)/)
    assert.ok(!/FAMILY_PORTFOLIO_SCOPES/.test(codeOf(route)),
      'the response must be built from the caller\'s entitlement, never the full scope universe')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Server authorization order on the read endpoints
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · read-endpoint authorization', () => {
  for (const [name, rel] of [['weeks', WEEKS_ROUTE], ['snapshot', SNAPSHOT_ROUTE]] as const) {
    test(`${name}: approved session → explicit canReadScope → only then any database read`, () => {
      const src = read(rel)
      const guard = src.indexOf('guardPrivateApi()')
      const scopeCheck = src.indexOf('canReadScope(')
      const dbRead = src.indexOf('listCurrentPublications(')
      assert.ok(guard > 0 && scopeCheck > guard && dbRead > scopeCheck,
        `${rel} must authorize before it reads`)
      assert.match(src, /not_authorized/)
      assert.match(src, /403/)
    })

    test(`${name}: nodejs runtime, force-dynamic, no-store`, () => {
      const src = read(rel)
      assert.match(src, /export const runtime = 'nodejs'/)
      assert.match(src, /export const dynamic = 'force-dynamic'/)
      assert.match(src, /no-store/)
    })

    test(`${name}: never names the service-role key or echoes a driver message`, () => {
      const src = codeOf(read(rel))
      assert.ok(!/SERVICE_ROLE|service_role/.test(src))
      assert.ok(!/\berror\.message\b/.test(src))
    })
  }

  test('scopes: guarded, no-store, nodejs', () => {
    const src = read(SCOPES_ROUTE)
    assert.match(src, /guardPrivateApi\(\)/)
    assert.match(src, /export const runtime = 'nodejs'/)
    assert.match(src, /no-store/)
  })

  test('snapshot: the entitlement decision precedes the portfolio-scope shape check', () => {
    // An unentitled caller must learn nothing — not even that this endpoint
    // only serves portfolio scopes.
    const src = read(SNAPSHOT_ROUTE)
    assert.ok(src.indexOf('canReadScope(') < src.indexOf('PORTFOLIO_SCOPES.has(scope)'))
  })

  test('snapshot: asOf must exactly match a current published week — never a nearest-match guess', () => {
    const src = read(SNAPSHOT_ROUTE)
    assert.match(src, /week_not_found/)
    assert.match(src, /selectPublicationWeek\(spine\.publications, asOf\)/)
  })

  test('neither read route forwards Stage-5 operational metadata to a member', () => {
    // The spine's metadata jsonb also carries publish-time operational fields
    // (detected date, override flag, classification count); the routes forward
    // only asOfDate/revision/publishedAt (+ parserVersion and the two column
    // dates on snapshot). The administrator note is never even selected.
    for (const rel of [WEEKS_ROUTE, SNAPSHOT_ROUTE]) {
      const src = codeOf(read(rel))
      assert.ok(!/dateOverridden|detectedAsOfDate|administratorClassifiedEvents|adminNote|admin_note|published_by|upload_id/.test(src),
        `${rel} must not surface Stage-5 operational metadata`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3b · Historical-week semantics (audit area 2) — behavioural, on the pure rule
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · selectPublicationWeek', () => {
  // The repository hands this function the CURRENT revision per as_of_date
  // (`is_current` filter; the partial unique index makes one-per-date a
  // database guarantee, runtime-proven by pgTAP). These fixtures mirror that
  // contract: four historical weeks, one of them on its second revision.
  const WEEKS = [
    { asOfDate: '2026-07-17', revision: 1 },
    { asOfDate: '2026-07-24', revision: 1 },
    { asOfDate: '2026-07-31', revision: 2 }, // revision 1 exists but is superseded — never in this input
    { asOfDate: '2026-08-07', revision: 1 },
  ]

  test('several historical as_of_dates coexist and each stays selectable in its current revision', () => {
    for (const w of WEEKS) {
      const r = selectPublicationWeek(WEEKS, w.asOfDate)
      assert.ok(r.ok)
      assert.equal(r.selected.asOfDate, w.asOfDate)
      assert.equal(r.selected.revision, w.revision)
    }
    // The revised date serves revision 2 — the superseded revision is not in
    // the current set at all, so it cannot be selected by any input.
    const revised = selectPublicationWeek(WEEKS, '2026-07-31')
    assert.ok(revised.ok)
    assert.equal(revised.selected.revision, 2)
  })

  test('is_current is never read as "only the latest date": omitted asOf selects the latest BY DATE, others remain reachable', () => {
    // Shuffled input — the rule compares the dates themselves rather than
    // trusting the caller's array order.
    const shuffled = [WEEKS[2], WEEKS[0], WEEKS[3], WEEKS[1]]
    const latest = selectPublicationWeek(shuffled, null)
    assert.ok(latest.ok)
    assert.equal(latest.selected.asOfDate, '2026-08-07')
    const historical = selectPublicationWeek(shuffled, '2026-07-17')
    assert.ok(historical.ok)
    assert.equal(historical.selected.asOfDate, '2026-07-17')
  })

  test('a forged or non-published date is refused — never a nearest-match fallback', () => {
    for (const bogus of [
      '2026-07-30', // between two published weeks — the nearest-match trap
      '2026-08-08', // one day past the latest
      '2020-01-01',
      '2026-7-31', // malformed
      'latest',
      "2026-07-31' OR 1=1",
    ]) {
      const r = selectPublicationWeek(WEEKS, bogus)
      assert.deepEqual(r, { ok: false, code: 'week_not_found' }, `must refuse ${bogus}`)
    }
  })

  test('an empty publication set is its own honest state, distinct from a wrong date', () => {
    assert.deepEqual(selectPublicationWeek([], null), { ok: false, code: 'no_publications' })
    assert.deepEqual(selectPublicationWeek([], '2026-08-07'), { ok: false, code: 'no_publications' })
  })

  test('the rule is pure — no Supabase, Next, or environment import', () => {
    const src = read('src/lib/familyPortfolio/memberRead.ts')
    assert.ok(!src.includes('@supabase'))
    assert.ok(!src.includes('next/'))
    assert.ok(!src.includes('process.env'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Read repository: two clients, current-only, no drafts
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · read repository', () => {
  const repo = read(READ_REPO)

  test('server-only, and says so', () => {
    assert.match(repo, /SERVER-ONLY/)
    assert.ok(!repo.trimStart().startsWith("'use client'"))
  })

  test('the publication spine read is metadata-only and current-only', () => {
    assert.match(repo, /\.eq\('is_current', true\)/)
    // The spine select carries ids, dates, versions and metadata — never a
    // financial column (none exists on the table; asserting the select list
    // keeps it that way).
    assert.match(repo, /select\('id, as_of_date, revision, published_at, parser_version, metadata'\)/)
  })

  test('snapshot rows are read through the USER-SESSION client so RLS is the authority', () => {
    const rowsSection = repo.slice(repo.indexOf('export async function getSnapshotRowsForScope'))
    assert.match(rowsSection, /getSupabaseUserClient\(\)/)
    assert.ok(!rowsSection.includes('getSupabaseAdminClient'),
      'row reads must never use the service-role client')
  })

  test('no draft, upload or storage surface is reachable from the member read path', () => {
    // Scans CODE only — the module header legitimately explains, in prose,
    // that it touches no storage object.
    const repoCode = codeOf(repo)
    for (const forbidden of ['portfolio_source_uploads', 'portfolio_upload_findings', '.storage', 'draftReview', 'loadDraft', 'UPLOAD_BUCKET']) {
      assert.ok(!repoCode.includes(forbidden), `read repository must not touch ${forbidden}`)
    }
    const snapshotRoute = read(SNAPSHOT_ROUTE)
    assert.ok(!snapshotRoute.includes('portfolioPublicationRepository'),
      'the member snapshot route must not import the administrator repository')
    assert.ok(!snapshotRoute.includes('draftReview'))
  })

  test('unavailable is never zero: no value field is coalesced anywhere on the read path', () => {
    for (const rel of [READ_REPO, SNAPSHOT_ROUTE, TABLE, PORTFOLIO_PAGE, DATA_HELPER]) {
      const src = codeOf(read(rel))
      assert.ok(!/(value|difference|previousValue|beginningOfYearValue)\s*(\?\?|\|\|)\s*0/.test(src),
        `${rel} must not coalesce an unavailable value to 0`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Client import graph
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · client boundary', () => {
  test('no client file imports a repository or a Supabase client', () => {
    for (const rel of CLIENT_FILES) {
      const src = read(rel)
      assert.ok(!src.includes('@/lib/db/'), `${rel} must not import a repository`)
      assert.ok(!src.includes('supabase'), `${rel} must not import a Supabase client`)
      assert.ok(!src.includes('portfolioAccess/getEntitlement'),
        `${rel} must not import the server-side entitlement resolver`)
    }
  })

  test('pages reach the server only through the /api fetch helper', () => {
    assert.match(read(PROVIDER), /fetchFamilyPortfolioScopes/)
    assert.match(read(PORTFOLIO_PAGE), /fetchFamilyPortfolioSnapshot/)
    assert.match(read(DATA_HELPER), /\/api\/family-portfolio\//)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Portfolio page: honest states, privacy, provenance, conventions
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · portfolio page', () => {
  const page = read(PORTFOLIO_PAGE)

  test('loading, error, denied, no-publication and empty-scope are distinct states', () => {
    assert.match(page, /noPublication/)
    assert.match(page, /emptyScope/)
    assert.match(page, /loadError/)
    assert.match(page, /notAuthorized/)
    assert.match(page, /'loading'/)
  })

  test('the scope selector renders only entitled scopes and syncs through the URL', () => {
    // R13.R5C.4 — the three clauses this test used to read inline now live in
    // `portfolioScopeRoutes.ts`, shared with the module rail so a link cannot
    // resolve a scope differently from the page it opens. Both halves are
    // asserted: that Holdings reads the shared rule, and that the rule itself
    // still says what this test was defending.
    assert.match(page, /const portfolioScopes = portfolioScopesOf\(scopes\)/)
    assert.match(page, /resolveActiveScope\(searchParams\.get\(SCOPE_PARAM\), scopes\)/)
    assert.match(page, /router\.replace\(scopeHref\(/)
    const routes = read('src/lib/familyPortfolio/portfolioScopeRoutes.ts')
    assert.match(routes, /portfolioScopesOf\(scopes\)\.some\(\(s\) => s\.id === requested\)/)
    // An unentitled ?scope= resolves to the caller's own first scope — the
    // page never fetches the requested one.
    assert.match(routes, /portfolioScopesOf\(scopes\)\[0\]\?\.id \?\? null/)
  })

  test('a vanished selected week resets to latest instead of dead-ending', () => {
    assert.match(page, /week_not_found/)
    assert.match(page, /setAsOf\(null\)/)
  })

  test('every monetary value is privacy-masked', () => {
    assert.match(page, /usePrivacyMode\(\)/)
    assert.match(page, /PrivacyToggle/)
    // R13.R5C.2 — the table no longer wraps `PrivacyValue` itself: it renders
    // through `MaskedAmount`, the module's one guarded renderer, which does.
    // That is a STRONGER guarantee than the one this test used to make — there
    // is now a single implementation of the masked-amount chain in the module
    // rather than two that have to agree.
    const table = read(TABLE)
    const amountCell = table.slice(table.indexOf('function amountCell'), table.indexOf('export function HierarchicalTable'))
    assert.match(amountCell, /<MaskedAmount value=\{value\} masked=\{masked\} \/>/)
    assert.match(read(MASKED_AMOUNT), /<PrivacyValue masked=\{masked\}/)
  })

  test('every monetary render path is privacy-guarded — no amount can bypass the mask (audit area 5)', () => {
    const table = read(TABLE)
    // R13.R5C.2 — the invariant tightened from "exactly one call site" to
    // "NONE": the table formats no amount of its own at all, so there is
    // nothing left that could render outside the mask.
    assert.equal(codeOf(table).split('formatUsd').length - 1, 0,
      'the table must not format an amount itself — MaskedAmount owns that')
    const amountCell = table.slice(table.indexOf('function amountCell'), table.indexOf('export function HierarchicalTable'))
    assert.match(amountCell, /<MaskedAmount value=\{value\} masked=\{masked\} \/>/)
    // All four dated value columns render through amountCell.
    assert.match(table, /\{amountCell\(row\.beginningOfYearValue, masked\)\}/)
    assert.match(table, /\{amountCell\(row\.previousValue, masked\)\}/)
    assert.match(table, /\{amountCell\(row\.value, masked\)\}/)
    // R13.R2 defensive repair: the Difference column renders the DERIVED
    // figure (`This Week − Previous Week`, via the shared invariant), not the
    // persisted one — but through the SAME single guarded `amountCell`, so the
    // privacy property this test exists for is unchanged.
    assert.match(table, /amountCell\(\s*\n?\s*diff\.displayed,\s*\n?\s*masked,/)
    assert.ok(!/amountCell\(row\.difference/.test(table),
      'the persisted difference must not be rendered')

    // R13.7 — MaskedAmount is the shared renderer outside the table: its
    // formatter calls sit inside PrivacyValue, and null renders an em dash.
    const maskedAmount = read(MASKED_AMOUNT)
    const maskedCode = codeOf(maskedAmount)
    // R13.R2F4 — there are now TWO formatters (the full grouped amount and the
    // chart-axis compact form), so the invariant is stated per-formatter rather
    // than as a single total: each is imported once and called once, and BOTH
    // calls feed the one `text` that PrivacyValue wraps. `formatUsd` is counted
    // on a word boundary so `formatUsdCompactM` cannot inflate it — which is
    // exactly how the looser total-count version of this check first failed.
    const occurrences = (src: string, name: string) =>
      (src.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length
    assert.equal(occurrences(maskedCode, 'formatUsd'), 2, 'formatUsd: one import + one call site')
    assert.equal(occurrences(maskedCode, 'formatUsdCompactM'), 2, 'formatUsdCompactM: one import + one call site')
    // R13.R3C.2 — THREE formatters now, still ONE guarded chain: the full
    // grouped amount, the print-axis form (`145,5M`) and the
    // contributors-chart form (`5M` / `-98K`). Adding a fourth without routing
    // it through this ternary would fail the occurrence counts above.
    assert.equal(
      occurrences(maskedCode, 'formatUsdCompactUnit'),
      2,
      'formatUsdCompactUnit: one import + one call site',
    )
    assert.match(maskedAmount, /compact === 'unit'\s*\?\s*formatUsdCompactUnit\(value, compactUnit\)/)
    assert.match(maskedAmount, /:\s*compact\s*\?\s*formatUsdCompactM\(value\)/)
    assert.match(maskedAmount, /:\s*formatUsd\(value, decimals\)/)
    // R13.8: the single call site also carries the optional signed prefix, and
    // R13.R5C.1 § 2 the optional `US$` currency mark. Both are assembled HERE,
    // inside the component, precisely so a call site can never build a marked
    // amount out of a prefix plus an unmasked number — the property this whole
    // test exists to defend.
    assert.match(
      maskedAmount,
      /const text = `\$\{signed && value > 0 \? '\+' : ''\}\$\{currency \? 'US\$ ' : ''\}\$\{amount\}`/,
    )
    // R13.R5C.3 — the mask now wraps a TERNARY rather than `text` alone: the
    // zero mark became the other arm, so it too is guarded. Both arms are
    // inside the one `PrivacyValue`, which is the property this test defends.
    assert.match(maskedAmount, /<PrivacyValue masked=\{masked\}[^>]*>\s*\{zero \? [\s\S]*?: text\}/)
    assert.match(maskedAmount, />—</)
    // The compact form is reachable ONLY through this component — a caller
    // that formatted an axis label itself would print an unmasked amount.
    for (const f of ['SummaryPrintSheet.tsx', 'AllocationDonut.tsx', 'HierarchicalTable.tsx']) {
      assert.ok(
        !/formatUsdCompactM/.test(read(`src/components/familyPortfolio/${f}`)),
        `${f} must not format a compact amount itself`,
      )
    }

    // The Summary page's own formatUsd uses are each privacy-safe by
    // construction. R13.R2 removed the KpiHero (its figures now render through
    // MaskedAmount in the Weekly Snapshot and the evolution headline) and
    // replaced the generic LineChart with PortfolioEvolutionChart; the
    // INVARIANT is unchanged and is what is asserted — the chart, whose axis
    // and tooltip text carry raw amounts, mounts ONLY in the unmasked branch,
    // and masking replaces it whole. The one unguarded formatUsd is the PUBLIC
    // InRetail closing price passed to the markets strip: market data, not
    // family wealth.
    const overview = read(OVERVIEW_PAGE)
    assert.match(overview, /\) : masked \? \(/)
    const chartAt = overview.indexOf('<PortfolioEvolutionChart')
    const maskGuardAt = overview.indexOf(') : masked ? (')
    assert.ok(maskGuardAt > 0 && chartAt > maskGuardAt,
      'the evolution chart must render only in the unmasked branch')
    // The masked branch itself exposes nothing: no chart, no formatter, no
    // amount — only the shared PrivacyValue placeholder.
    const maskedBranch = overview.slice(maskGuardAt, chartAt)
    assert.match(maskedBranch, /<PrivacyValue masked/)
    assert.ok(!/formatUsd|PortfolioEvolutionChart|formatValue/.test(maskedBranch),
      'the masked branch must not format or mount any amount-bearing element')
    // Every portfolio amount on the page still renders through the one guarded
    // component; the strip and donut are covered by their own assertions below.
    assert.match(overview, /<MaskedAmount/)

    // Everywhere else: no direct amount formatting, no toLocaleString, and no
    // title/tooltip carrying a raw amount around the mask.
    // R13.8: the Weekly Changes page joins for the SAME two guarded shapes the
    // Overview was admitted for — a KpiHero `formatValue` (masked by the
    // hero's own PrivacyValue) and a LineChart `valueFormatter` mounted only
    // while unmasked. Its dedicated privacy tests assert exactly that.
    // R13.R2 admits two more, each for a specific, argued reason:
    //   * STRIP formats the PUBLIC InRetail closing price (`formatUsd(v, 2)`)
    //     — market data anyone can look up, which MaskedAmount's own header
    //     excludes from masking by policy. It renders no portfolio amount.
    //   * DONUT formats a slice's value label, but only inside a branch gated
    //     on `!wantsValue || maskedEffective`, so an amount is unreachable
    //     while the page is masked (asserted directly below).
    const MAY_FORMAT_AMOUNTS = new Set([TABLE, MASKED_AMOUNT, OVERVIEW_PAGE, WEEKLY_PAGE, STRIP, DONUT])
    for (const rel of CLIENT_FILES) {
      const src = codeOf(read(rel))
      assert.ok(!src.includes('toLocaleString'),
        `${rel} must not format an amount outside the shared formatters`)
      if (!MAY_FORMAT_AMOUNTS.has(rel)) {
        assert.ok(!src.includes('formatUsd'),
          `${rel} must not render amounts — only the approved renderers do`)
      }
      assert.ok(!/title=\{[^}]*(value|difference|formatUsd)/.test(src),
        `${rel} must not expose an amount through a title attribute`)
    }
  })

  test('EXHAUSTIVE: no monetary value escapes the hero mask through any KpiHero slot', () => {
    // Doc 06 defines the hero from the TOTAL value, the weekly NMI-derived
    // portfolio-value difference, the weekly return and the YTD return. Two of
    // those are AMOUNTS; both must obey the same privacy state, through every
    // slot KpiHero renders — headline, change capsule, minis, accessible label,
    // title attribute, and any DOM that stays mounted while masked.
    const hero = read('src/components/fable/KpiHero.tsx')
    const overview = read(OVERVIEW_PAGE)
    const heroCode = codeOf(hero)

    // 1 · The headline amount is masked.
    assert.match(heroCode, /<PrivacyValue masked=\{privacyMasked\}>/)

    // 2 · A monetary mini is masked by the hero's OWN state — not a second flag
    //     a caller could set inconsistently with the headline.
    assert.match(heroCode, /m\.sensitive \? <PrivacyValue masked=\{privacyMasked\}>\{m\.value\}<\/PrivacyValue> : m\.value/)
    assert.ok(!/masked=\{m\./.test(heroCode),
      'a mini must never carry its own independent masked state')

    // 3 · Nothing in KpiHero leaks a value through a title/tooltip/aria label.
    assert.ok(!/title=/.test(heroCode), 'KpiHero must not put any value in a title attribute')
    assert.ok(!/aria-label=\{[^}]*(value|display|m\.value)/.test(heroCode),
      'KpiHero must not put a value in an accessible label')

    // 4 · While masked, PrivacyValue does not render children AT ALL, so no
    //     raw amount remains in hidden mounted DOM, the a11y tree, or the
    //     clipboard. (Not a blur/opacity treatment.)
    const privacy = codeOf(read('src/components/fable/PrivacyValue.tsx'))
    const maskedBranch = privacy.slice(privacy.indexOf('return ('))
    assert.ok(!maskedBranch.includes('{children}'),
      'the masked branch must not render children in any form')
    assert.ok(!/filter:|blur|opacity/.test(privacy), 'masking must not be a visual-only treatment')

    // 5 · R13.R2 removed the KpiHero from the SUMMARY (it remains in use on
    //     Weekly Changes, which is why 1-4 above still guard it). Every
    //     monetary field the hero used to carry — the portfolio value, the
    //     weekly difference, the InRetail impact, the allocation residual —
    //     now renders through MaskedAmount, the single guarded path, and an
    //     unavailable figure stays a plain em dash inside it.
    assert.ok(!/KpiHero/.test(overview),
      'the Summary no longer routes amounts through KpiHero — MaskedAmount is the path')
    assert.ok((overview.match(/<MaskedAmount/g) ?? []).length >= 4,
      'the Summary renders its amounts through MaskedAmount')
    for (const m of overview.match(/<MaskedAmount[\s\S]{0,200}?\/>/g) ?? []) {
      assert.match(m, /masked=\{masked\}/,
        'every MaskedAmount must bind to the page mask, never a second flag')
    }

    // 6 · Percentages use formatRatioPct and are NOT masked (the standing
    //     policy for non-wealth figures); an amount never rides a ratio slot.
    assert.match(overview, /formatRatioPct\(/)

    // 7 · formatUsd appears on the page exactly THREE times, each audited:
    //       (a) the import;
    //       (b) the evolution chart's `formatValue`, which mounts only in the
    //           unmasked branch (asserted above);
    //       (c) R13.R2C — the print sheet's MARKET metric mapping, which
    //           formats a public benchmark CLOSING PRICE. That is not a
    //           portfolio amount: masking hides the family's wealth, not a
    //           listed price, and `PerformanceMarketsStrip` already gives the
    //           same field the same treatment on screen. Every PORTFOLIO amount
    //           on the sheet goes through MaskedAmount instead.
    //     A fourth use must fail this test rather than ship an amount outside
    //     the mask.
    assert.equal(codeOf(overview).split('formatUsd').length - 1, 3,
      'formatUsd occurrences on the Summary changed — re-audit each against the mask')
    // (c) audited in place: the only new use is the price branch of the market
    // mapping, never an amount branch.
    //
    // PASS 4 § 4 put weekly and year-to-date P&L AMOUNTS into that same band.
    // They are deliberately NOT formatted here: `printMetric` returns an
    // `amount` NUMBER for them and the sheet renders it through MaskedAmount,
    // so the third occurrence is still the price branch and still the only one.
    assert.match(overview, /m\.kind === 'price'\s*\?\s*formatUsd\(m\.value!?, 2\)/)
    assert.match(codeOf(overview), /if \(m\.kind === 'amount'\) \{\s*\n?\s*return \{ key: m\.key, label, amount:/,
      'a portfolio amount must leave printMetric as a number, never as formatted text')
    // And the print sheet formats no amount of its own.
    const sheet = codeOf(read('src/components/familyPortfolio/SummaryPrintSheet.tsx'))
    assert.ok(!/formatUsd|toLocaleString|Intl\./.test(sheet),
      'the print sheet must not format an amount itself — MaskedAmount is the path')
    for (const m of sheet.match(/<MaskedAmount[\s\S]{0,160}?\/>/g) ?? []) {
      assert.match(m, /masked=\{masked\}/,
        'every printed amount must bind to the SAME page mask, never a second flag')
    }
  })

  test('the Difference column\'s NMI derivation is disclosed beside the footer (audit area 3)', () => {
    assert.match(page, /t\.fp\.portfolio\.diffNote/)
    for (const lang of ['en', 'es'] as const) {
      assert.ok(dict[lang].fp.portfolio.diffNote.length > 0)
    }
  })

  test('provenance is visible: source footer, publication timestamp, revision and parser version', () => {
    assert.match(page, /TableSourceFooter/)
    assert.match(page, /source=\{t\.fp\.portfolio\.source\}/)
    assert.match(page, /snapshot\?\.publishedAt/)
    assert.match(page, /snapshot\.revision/)
    assert.match(page, /snapshot\.parserVersion/)
  })

  test('the footer source is a plain name in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const source = dict[lang].fp.portfolio.source
      assert.ok(source.length > 0 && !source.includes('·') && !/Phase|Etapa|badge/.test(source),
        `dict.${lang}.fp.portfolio.source must be a plain source name`)
    }
  })

  test('responsive conventions: card-level scroll with a min width, w-full page root', () => {
    assert.match(page, /minWidth=\{760\}/)
    assert.match(page, /className="w-full"/)
    assert.ok(!page.includes('max-w-screen'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Hierarchical table semantics
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · hierarchical table', () => {
  const table = read(TABLE)

  test('the tree is built from the ingested parent keys — never reshaped or regrouped', () => {
    assert.match(table, /parentRowKey/)
    assert.match(table, /childrenOf/)
    // A dangling parent degrades to a root rather than dropping the row.
    assert.match(table, /present\.has\(row\.parentRowKey\)/)
  })

  test('expand/collapse is keyboard-accessible and labelled', () => {
    assert.match(table, /aria-expanded=\{!isCollapsed\}/)
    assert.match(table, /aria-label=/)
    assert.match(table, /<button/)
  })

  test('a null value renders as an em dash, never 0', () => {
    // R13.R5C.2 — the branch moved into `MaskedAmount` with the rest of the
    // chain. The property is unchanged and now holds for the whole module at
    // once: unavailable is `—`, and a value that IS zero is a different mark.
    const amount = read(MASKED_AMOUNT)
    assert.match(amount, /if \(value === null \|\| !Number\.isFinite\(value\)\)/)
    assert.match(amount, />—</)
    assert.doesNotMatch(codeOf(table), /value === null/, 'the table must not re-implement it')
  })

  test('a column with no recorded source date is headed without one — never inferred', () => {
    assert.match(table, /\{date &&/)
  })

  test('the difference column is the parse-time NMI derivation — the component never recomputes it', () => {
    assert.match(table, /row\.difference/)
    assert.ok(!/row\.value\s*-\s*row\.previousValue/.test(codeOf(table)),
      'the table must render the ingested difference, not recompute one')
  })

  test('no hardcoded colors — semantic tokens only', () => {
    for (const rel of [TABLE, NAV, WEEK_SELECTOR, GATE, PORTFOLIO_PAGE, OVERVIEW_PAGE, WEEKLY_PAGE, ALTERNATIVES_PAGE, LAYOUT, MASKED_AMOUNT, DONUT, FRESHNESS, STRIP, SNAPSHOT_CARD, ALLOC_PANEL, ALLOC_SETTINGS, EVO_CHART]) {
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(codeOf(read(rel))),
        `${rel} must not hardcode a hex color`)
    }
    // R13.R2 § 14 made the donut's palette administrator-selectable, so it no
    // longer names `--fp-slice-` literally: it resolves a token NAME through
    // `paletteTokenAt`, which is exactly what keeps a colour outside the
    // approved set unrepresentable. Assert THAT, plus the property the old
    // literal stood for — every palette token declared for both themes.
    const donut = read(DONUT)
    assert.match(donut, /paletteTokenAt\(settings\.palette, i\)/,
      'slice colour must resolve through the curated palette map, never a literal')
    assert.ok(!/--positive|--negative|--warning/.test(donut),
      'identity colour must never borrow a signal token')
    const css = read('src/app/globals.css')
    for (const token of Object.values(PALETTE_TOKENS).flat()) {
      assert.ok((css.match(new RegExp(`${token}:`, 'g')) ?? []).length >= 2,
        `${token} needs a light AND a dark value in globals.css`)
    }
    // The two evolution series are identity colours too, both themed, and
    // neither is a signal token — a falling portfolio is not an error (§ 5).
    for (const token of ['--fp-series-incl', '--fp-series-excl']) {
      assert.ok((css.match(new RegExp(`${token}:`, 'g')) ?? []).length >= 2,
        `${token} needs a light AND a dark value in globals.css`)
    }
    assert.ok(!/--negative|--positive/.test(codeOf(read(EVO_CHART))),
      'the evolution chart must not colour a series with a signal token')
  })

  test('no forbidden attribution vocabulary anywhere on the Stage-6 surface (doc 07 § 4.3)', () => {
    const FORBIDDEN = /performance attribution|performance contribution|contribution to return|selection effect|allocation effect|active return|\balpha\b/i
    for (const rel of CLIENT_FILES) {
      assert.ok(!FORBIDDEN.test(read(rel)), `${rel} must not use attribution vocabulary`)
    }
    for (const lang of ['en', 'es'] as const) {
      assert.ok(!FORBIDDEN.test(JSON.stringify(dict[lang].fp)))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · i18n parity and formatters
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · i18n and formatting', () => {
  test('the fp block has identical key shapes in EN and ES', () => {
    const shape = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object' ? shape(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
      )
    assert.deepEqual(shape(dict.en.fp).sort(), shape(dict.es.fp).sort())
  })

  test('formatUsd: grouped Chilean-convention amount; zero is the zero mark, unavailable the em dash', () => {
    assert.equal(formatUsd(1234567), '1.234.567')
    assert.equal(formatUsd(-2500.75, 2), '-2.500,75')
    // R13.R5C.2 — was `'0'`. The owner's Portfolio-wide contract. The em dash
    // still means ONLY "no value could be established", so the two states a
    // reader must never confuse stay two different marks.
    assert.equal(formatUsd(0), '-')
    assert.equal(formatUsd(-0), '-')
    assert.equal(formatUsd(0.4), '-', 'below the rendered precision reads as it renders')
    assert.equal(formatUsd(0.4, 2), '0,40', '…and is a real figure once the column can show it')
    assert.equal(formatUsd(null), '—')
    assert.equal(formatUsd(undefined), '—')
    assert.equal(formatUsd(Number.NaN), '—')
    assert.equal(formatUsd(Infinity), '—')
  })

  test('formatIsoDateLabel reads the date off the string — no timezone day-shift is possible', () => {
    assert.equal(formatIsoDateLabel('2026-08-13'), '13-08-2026')
    assert.equal(formatIsoDateLabel('2026-01-01'), '01-01-2026')
    // Malformed input passes through untouched rather than being guessed at.
    assert.equal(formatIsoDateLabel('2026-13-01'), '2026-13-01')
    assert.equal(formatIsoDateLabel('not-a-date'), 'not-a-date')
    assert.equal(formatIsoDateLabel('2026-08-13T10:00:00Z'), '2026-08-13T10:00:00Z')
  })

  test('no module client file passes a date through new Date() — no timezone day-shift path exists', () => {
    for (const rel of CLIENT_FILES) {
      assert.ok(!codeOf(read(rel)).includes('new Date'), `${rel} must not construct a Date`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Non-interference and stage boundaries
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.6 · boundaries', () => {
  // POST-R13.5 — inverted for the same reason as its sibling in
  // familyPortfolioAlternatives: the two products no longer coexist on one URL
  // space, because only one of them is left.
  test('the Chilean-equities positions tracker is retired', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/api/portfolios')))
    assert.ok(!existsSync(join(ROOT, 'src/lib/portfolio')))
  })

  test('the Stage-5 admin console was not redesigned — Stage 6 only navigates into it', () => {
    const admin = read('src/app/portfolio/admin/page.tsx')
    // The console keeps its own composition; the shell's nav wraps it from the
    // layout, so the page itself needed no change.
    assert.ok(!admin.includes('FamilyPortfolioNav'))
    assert.ok(!admin.includes('MemberGate'))
  })

  test('no client file under the module imports the publication or upload repositories', () => {
    const dir = join(ROOT, 'src/components/familyPortfolio')
    for (const entry of readdirSync(dir)) {
      const src = read(`src/components/familyPortfolio/${entry}`)
      assert.ok(!src.includes('portfolioPublicationRepository'), entry)
      assert.ok(!src.includes('portfolioUploadRepository'), entry)
    }
  })
})
