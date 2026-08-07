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

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const LAYOUT = 'src/app/family-portfolio/layout.tsx'
const OVERVIEW_PAGE = 'src/app/family-portfolio/page.tsx'
const PORTFOLIO_PAGE = 'src/app/family-portfolio/portfolio/page.tsx'
const WEEKLY_PAGE = 'src/app/family-portfolio/weekly-changes/page.tsx'
const ALTERNATIVES_PAGE = 'src/app/family-portfolio/alternatives/page.tsx'
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

/** Every CLIENT file Stage 6 added — pages, components, and the fetch helper. */
const CLIENT_FILES = [
  LAYOUT, OVERVIEW_PAGE, PORTFOLIO_PAGE, WEEKLY_PAGE, ALTERNATIVES_PAGE,
  PROVIDER, NAV, GATE, TABLE, WEEK_SELECTOR, DATA_HELPER,
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

  test('the placeholder pages render honest pending states, not early implementations', () => {
    for (const rel of [OVERVIEW_PAGE, WEEKLY_PAGE, ALTERNATIVES_PAGE]) {
      const src = read(rel)
      assert.match(src, /AsyncState/, `${rel} must use the shared async-state language`)
      assert.match(src, /kind="unavailable"/, `${rel} must render the unavailable state`)
      assert.match(src, /MemberGate/, `${rel} must gate on the caller's entitlement`)
      assert.ok(!/fetchFamilyPortfolioSnapshot|HierarchicalTable/.test(src),
        `${rel} must not fetch or render snapshot data`)
    }
  })

  test('the zero-scope caller gets a plain no-access state — loading, error and denied stay distinct', () => {
    const gate = read(GATE)
    assert.match(gate, /status === 'loading'/)
    assert.match(gate, /status === 'error'/)
    assert.match(gate, /status === 'denied' \|\| scopes\.length === 0/)
    assert.match(gate, /noAccess/)
  })

  test('the app-level primary navigation is deliberately untouched by Stage 6', () => {
    // Doc 08 Stage 6 owns MODULE navigation only; the static app-nav config
    // cannot express per-user entitlement, so a Family Portfolio entry there
    // is release wiring for a later stage, not part of this one.
    assert.ok(!read('src/lib/navigation.ts').includes('family-portfolio'))
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
    assert.match(page, /scopes\.filter\(\(s\) => s\.id !== 'alternatives'\)/)
    assert.match(page, /portfolioScopes\.some\(\(s\) => s\.id === requested\)/)
    assert.match(page, /router\.replace\(/)
    // An unentitled ?scope= resolves to the caller's own first scope — the
    // page never fetches the requested one.
    assert.match(page, /portfolioScopes\[0\]\?\.id \?\? null/)
  })

  test('a vanished selected week resets to latest instead of dead-ending', () => {
    assert.match(page, /week_not_found/)
    assert.match(page, /setAsOf\(null\)/)
  })

  test('every monetary value is privacy-masked', () => {
    assert.match(page, /usePrivacyMode\(\)/)
    assert.match(page, /PrivacyToggle/)
    const table = read(TABLE)
    assert.match(table, /PrivacyValue/)
    // The single amount-cell renderer wraps its value in PrivacyValue, so no
    // column can forget the mask.
    const amountCell = table.slice(table.indexOf('function amountCell'), table.indexOf('export function HierarchicalTable'))
    assert.match(amountCell, /PrivacyValue masked=\{masked\}/)
  })

  test('amountCell is the ONLY monetary renderer — no amount can bypass the mask (audit area 5)', () => {
    const table = read(TABLE)
    // In the table's CODE (comments stripped), `formatUsd` appears exactly
    // twice: the import and the single call inside amountCell's PrivacyValue
    // wrapper. A second call site would be an amount rendered outside the mask.
    assert.equal(codeOf(table).split('formatUsd').length - 1, 2,
      'formatUsd must have exactly one call site (inside amountCell) plus its import')
    const amountCell = table.slice(table.indexOf('function amountCell'), table.indexOf('export function HierarchicalTable'))
    assert.match(amountCell, /formatUsd\(value\)/)
    // All four dated value columns render through amountCell.
    assert.match(table, /\{amountCell\(row\.beginningOfYearValue, masked\)\}/)
    assert.match(table, /\{amountCell\(row\.previousValue, masked\)\}/)
    assert.match(table, /\{amountCell\(row\.value, masked\)\}/)
    assert.match(table, /\{amountCell\(row\.difference, masked, diffColor\)\}/)
    // No client file in the module formats an amount any other way, and no
    // title/tooltip carries a raw amount around the mask.
    for (const rel of CLIENT_FILES) {
      const src = codeOf(read(rel))
      assert.ok(!src.includes('toLocaleString'),
        `${rel} must not format an amount outside the shared formatters`)
      if (rel !== TABLE) {
        assert.ok(!src.includes('formatUsd'), `${rel} must not render amounts — only the table does`)
      }
      assert.ok(!/title=\{[^}]*(value|difference|formatUsd)/.test(src),
        `${rel} must not expose an amount through a title attribute`)
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
    assert.match(table, /value === null \?/)
    assert.match(table, />—</)
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
    for (const rel of [TABLE, NAV, WEEK_SELECTOR, GATE, PORTFOLIO_PAGE, OVERVIEW_PAGE, WEEKLY_PAGE, ALTERNATIVES_PAGE, LAYOUT]) {
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(codeOf(read(rel))),
        `${rel} must not hardcode a hex color`)
    }
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

  test('formatUsd: grouped Chilean-convention amount; unavailable is an em dash, never 0', () => {
    assert.equal(formatUsd(1234567), '1.234.567')
    assert.equal(formatUsd(-2500.75, 2), '-2.500,75')
    assert.equal(formatUsd(0), '0')
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
  test('the Chilean-equities /portfolio module is untouched', () => {
    const page = read('src/app/portfolio/page.tsx')
    assert.ok(!page.includes('familyPortfolio'))
    assert.ok(!page.includes('family-portfolio'))
  })

  test('the Stage-5 admin console was not redesigned — Stage 6 only navigates into it', () => {
    const admin = read('src/app/family-portfolio/admin/page.tsx')
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
