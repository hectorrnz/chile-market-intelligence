// R13.R5C.4 — the selected portfolio survives navigation between Portfolio views.
//
// THE DEFECT. Summary, Holdings and Weekly Changes each derive their scope from
// `?scope=` in the URL — a sound, URL-backed mechanism. The module rail linked
// to BARE paths, so every sub-tab click dropped the parameter and each page fell
// back to the caller's first scope: "Andrés → Weekly Changes" opened MAIN.
//
// THE FIX is to carry the parameter that already exists, so this suite is mostly
// BEHAVIOURAL: `portfolioScopeRoutes.ts` is pure, and the two functions below
// compose it exactly as the rail and the pages do, which lets each of the
// owner's journeys be walked click by click rather than asserted about.
//
// The structural half then pins that the app really is composed that way — that
// the rail scopes exactly the three views, leaves Alternatives and Admin alone,
// matches its active pill on the PATH, and that no page kept a private copy of
// the derivation.
//
// NO PRIVATE DATA. Every scope id below is a public route value.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ALTERNATIVES_SCOPE,
  PORTFOLIO_HOLDINGS,
  PORTFOLIO_SUMMARY,
  PORTFOLIO_WEEKLY_CHANGES,
  SCOPE_AWARE_ROUTES,
  SCOPE_PARAM,
  activeScope,
  portfolioScopesOf,
  scopeHref,
  selectedScope,
} from '../src/lib/familyPortfolio/portfolioScopeRoutes.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NAV = 'src/components/familyPortfolio/FamilyPortfolioNav.tsx'
const LAYOUT = 'src/app/portfolio/layout.tsx'
const SUMMARY = 'src/app/portfolio/page.tsx'
const HOLDINGS = 'src/app/portfolio/holdings/page.tsx'
const WEEKLY = 'src/app/portfolio/weekly-changes/page.tsx'
const SCOPE_PAGES = [SUMMARY, HOLDINGS, WEEKLY]

/** A caller entitled to everything — the shape `/api/family-portfolio/scopes` returns. */
const ALL = [
  { id: 'main' },
  { id: 'jaime' },
  { id: 'andres' },
  { id: 'pablo' },
  { id: ALTERNATIVES_SCOPE },
]

const BASE = 'https://nmi.test'
const paramOf = (url: string) => new URL(url, BASE).searchParams.get(SCOPE_PARAM)

/**
 * What the module rail renders for one item, given the URL the reader is on.
 * Mirrors `FamilyPortfolioNav`'s `scoped()` / `shared()` split, which test 14
 * pins to exactly these routes.
 */
function railHref(currentUrl: string, target: string, scopes: { id: string }[] = ALL): string {
  const scope = selectedScope(paramOf(currentUrl), scopes)
  return (SCOPE_AWARE_ROUTES as readonly string[]).includes(target)
    ? scopeHref(target, scope)
    : target
}

/** What the page at a URL then renders. Mirrors all three pages' derivation. */
function pageScope(url: string, scopes: { id: string }[] = ALL): string | null {
  return activeScope(paramOf(url), scopes)
}

/** Walk a journey: start at a URL, optionally pick a scope, then click through the rail. */
function journey(start: string, steps: Array<{ pick?: string; go?: string }>) {
  let url = start
  const seen: string[] = [pageScope(url) ?? 'none']
  for (const step of steps) {
    // Picking a scope is `router.replace(scopeHref(currentPath, next))`.
    if (step.pick !== undefined) {
      url = scopeHref(new URL(url, BASE).pathname, step.pick)
      seen.push(pageScope(url) ?? 'none')
    }
    if (step.go !== undefined) {
      url = railHref(url, step.go)
      seen.push(pageScope(url) ?? 'none')
    }
  }
  return { url, seen }
}

// ───────────────────────────────────────────────────────────────────────────
// 1 · The owner's journeys, walked click by click
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.4 § 2 — the selected portfolio survives a sub-tab change', () => {
  test('1 · Main Summary → Weekly Changes stays Main', () => {
    const { url, seen } = journey(PORTFOLIO_SUMMARY, [{ go: PORTFOLIO_WEEKLY_CHANGES }])
    assert.deepEqual(seen, ['main', 'main'])
    // No selection was made, so nothing is pinned into the URL — the default
    // stays the default, exactly as before this change.
    assert.equal(url, PORTFOLIO_WEEKLY_CHANGES)
  })

  test('2 · Andrés Summary → Weekly Changes stays Andrés', () => {
    const { url, seen } = journey(PORTFOLIO_SUMMARY, [
      { pick: 'andres' },
      { go: PORTFOLIO_WEEKLY_CHANGES },
    ])
    assert.deepEqual(seen, ['main', 'andres', 'andres'])
    assert.equal(url, '/portfolio/weekly-changes?scope=andres')
  })

  test('3 · Andrés Weekly Changes → Summary stays Andrés', () => {
    const { url, seen } = journey('/portfolio/weekly-changes?scope=andres', [
      { go: PORTFOLIO_SUMMARY },
    ])
    assert.deepEqual(seen, ['andres', 'andres'])
    assert.equal(url, '/portfolio?scope=andres')
  })

  test('4 · Andrés Weekly Changes → Holdings stays Andrés', () => {
    const { seen } = journey('/portfolio/weekly-changes?scope=andres', [
      { go: PORTFOLIO_HOLDINGS },
    ])
    assert.deepEqual(seen, ['andres', 'andres'])
  })

  test('5 · Pablo Summary → Holdings → Weekly Changes stays Pablo', () => {
    const { url, seen } = journey(PORTFOLIO_SUMMARY, [
      { pick: 'pablo' },
      { go: PORTFOLIO_HOLDINGS },
      { go: PORTFOLIO_WEEKLY_CHANGES },
    ])
    assert.deepEqual(seen, ['main', 'pablo', 'pablo', 'pablo'])
    assert.equal(url, '/portfolio/weekly-changes?scope=pablo')
  })

  test('6 · Pablo Holdings → Summary stays Pablo', () => {
    const { seen } = journey('/portfolio/holdings?scope=pablo', [{ go: PORTFOLIO_SUMMARY }])
    assert.deepEqual(seen, ['pablo', 'pablo'])
  })

  test('7 · Jaime Weekly Changes → Holdings stays Jaime', () => {
    const { seen } = journey('/portfolio/weekly-changes?scope=jaime', [
      { go: PORTFOLIO_HOLDINGS },
    ])
    assert.deepEqual(seen, ['jaime', 'jaime'])
  })

  test('8 · Jaime Summary → Holdings → Weekly Changes → Summary is Jaime throughout', () => {
    const { url, seen } = journey(PORTFOLIO_SUMMARY, [
      { pick: 'jaime' },
      { go: PORTFOLIO_HOLDINGS },
      { go: PORTFOLIO_WEEKLY_CHANGES },
      { go: PORTFOLIO_SUMMARY },
    ])
    assert.deepEqual(seen, ['main', 'jaime', 'jaime', 'jaime', 'jaime'])
    assert.equal(url, '/portfolio?scope=jaime')
  })

  test('9 · every ordered pair of the three views preserves every scope', () => {
    // The four journeys above by name; this is the same claim exhaustively.
    for (const scope of ['main', 'jaime', 'andres', 'pablo']) {
      for (const from of SCOPE_AWARE_ROUTES) {
        for (const to of SCOPE_AWARE_ROUTES) {
          const start = scopeHref(from, scope)
          assert.equal(pageScope(railHref(start, to)), scope, `${scope}: ${from} → ${to}`)
        }
      }
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2 · Reload, direct entry, Back/Forward, new tab
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.4 § 3 — the scope lives in the URL, so the browser handles it', () => {
  test('10 · a direct link opens the portfolio it names', () => {
    assert.equal(pageScope('/portfolio?scope=pablo'), 'pablo')
    assert.equal(pageScope('/portfolio/holdings?scope=jaime'), 'jaime')
    assert.equal(pageScope('/portfolio/weekly-changes?scope=andres'), 'andres')
  })

  test('11 · reload and a new tab resolve identically — the state is the URL', () => {
    // Nothing is read from memory, so the same string always yields the same
    // scope: a reload, a duplicated tab and a pasted link cannot disagree.
    const url = '/portfolio/weekly-changes?scope=andres'
    assert.equal(pageScope(url), pageScope(url))
    assert.equal(pageScope(url), 'andres')
  })

  test('12 · Back and Forward work because each step is its own entry', () => {
    // A rail click is a `Link` (a push), so the history stack holds the URLs
    // below and replaying them backwards restores each scope.
    const history = [
      scopeHref(PORTFOLIO_SUMMARY, 'andres'),
      railHref(scopeHref(PORTFOLIO_SUMMARY, 'andres'), PORTFOLIO_HOLDINGS),
      railHref(scopeHref(PORTFOLIO_HOLDINGS, 'andres'), PORTFOLIO_WEEKLY_CHANGES),
    ]
    assert.deepEqual(history.map((u) => pageScope(u)), ['andres', 'andres', 'andres'])
    assert.deepEqual([...history].reverse().map((u) => pageScope(u)), ['andres', 'andres', 'andres'])
    // Selecting a scope on a page is a REPLACE, so the rail's own history is
    // not polluted by a selector click.
    assert.match(read(SUMMARY), /router\.replace\(scopeHref\(PORTFOLIO_SUMMARY, next\)/)
    assert.match(read(HOLDINGS), /router\.replace\(scopeHref\(PORTFOLIO_HOLDINGS, next\)/)
    assert.match(read(WEEKLY), /router\.replace\(scopeHref\(PORTFOLIO_WEEKLY_CHANGES, next\)/)
  })

  test('13 · no second, competing scope mechanism was introduced', () => {
    // A remembered scope in React state or in the provider would disagree with
    // the URL the first time a reader used Back or opened a new tab.
    const provider = code(read('src/components/familyPortfolio/FamilyPortfolioProvider.tsx'))
    assert.doesNotMatch(provider, /scope[A-Za-z]*\s*[:=]\s*(useState|null|'')/i)
    assert.doesNotMatch(provider, /localStorage|usePersistentState/)
    assert.doesNotMatch(code(read(NAV)), /useState|localStorage|usePersistentState/)
    for (const p of SCOPE_PAGES) {
      assert.doesNotMatch(code(read(p)), /useState<[^>]*>\(\s*['"](main|jaime|andres|pablo)/, p)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3 · Where the scope is carried, and where it is not
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.4 § 4 — scope boundaries', () => {
  test('14 · the rail scopes exactly the three views, and no others', () => {
    const nav = code(read(NAV))
    const scoped = [...nav.matchAll(/scoped\('([^']+)', ([A-Z_]+),/g)].map((m) => [m[1], m[2]])
    assert.deepEqual(scoped, [
      ['overview', 'PORTFOLIO_SUMMARY'],
      ['portfolio', 'PORTFOLIO_HOLDINGS'],
      ['weekly-changes', 'PORTFOLIO_WEEKLY_CHANGES'],
    ])
    const sharedItems = [...nav.matchAll(/shared\('([^']+)',/g)].map((m) => m[1])
    assert.deepEqual(sharedItems, ['alternatives', 'admin'])
    assert.equal(SCOPE_AWARE_ROUTES.length, 3)
  })

  test('15 · Alternatives and Admin never receive a personal scope', () => {
    // Alternatives is a SHARED publication and Admin is a console; forcing a
    // principal onto either would claim a filter neither has.
    for (const target of ['/portfolio/alternatives', '/portfolio/admin']) {
      assert.equal(railHref('/portfolio?scope=pablo', target), target)
      assert.ok(!(SCOPE_AWARE_ROUTES as readonly string[]).includes(target))
    }
  })

  test('16 · Alternatives and Admin semantics are untouched by this pass', () => {
    // Neither reads the parameter, and neither was given a scope selector.
    for (const p of [
      'src/app/portfolio/alternatives/page.tsx',
      'src/app/portfolio/alternatives/holdings/page.tsx',
      'src/app/portfolio/alternatives/cash-flows/page.tsx',
      'src/app/portfolio/alternatives/layout.tsx',
      'src/app/portfolio/admin/page.tsx',
    ]) {
      assert.doesNotMatch(code(read(p)), /portfolioScopeRoutes/, p)
      assert.doesNotMatch(code(read(p)), /searchParams\.get\('scope'\)/, p)
    }
  })

  test('17 · a personal scope is not persisted across a shared surface', () => {
    // Leaving for Alternatives leaves the parameter behind, so coming back
    // lands on the default. Remembering it would be the invented persistence
    // § 4 rules out, and would fight the URL on Back.
    const away = railHref('/portfolio?scope=pablo', '/portfolio/alternatives')
    assert.equal(away, '/portfolio/alternatives')
    assert.equal(pageScope(railHref(away, PORTFOLIO_SUMMARY)), 'main')
    // The reader's own Back button still restores it, because the scoped URL is
    // a real history entry.
    assert.equal(pageScope('/portfolio?scope=pablo'), 'pablo')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 4 · Access — presentation, never protection
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.4 § 5 — a URL cannot grant a scope', () => {
  test('18 · an unentitled scope resolves away instead of being honoured', () => {
    const jaimeOnly = [{ id: 'jaime' }]
    assert.equal(selectedScope('pablo', jaimeOnly), null, 'not an explicit selection')
    assert.equal(activeScope('pablo', jaimeOnly), 'jaime', 'falls back to the caller’s own scope')
    assert.equal(pageScope('/portfolio?scope=pablo', jaimeOnly), 'jaime')
  })

  test('19 · …and is never carried onward by the rail', () => {
    // A hand-typed scope this caller was not granted is dropped at the link, so
    // the tampered value does not spread across the module.
    const jaimeOnly = [{ id: 'jaime' }]
    assert.equal(
      railHref('/portfolio?scope=pablo', PORTFOLIO_WEEKLY_CHANGES, jaimeOnly),
      PORTFOLIO_WEEKLY_CHANGES,
    )
  })

  test('20 · an invalid or malformed scope fails safely', () => {
    for (const bad of [null, undefined, '', '   ', 'MAIN', 'main ', '../admin', 'alternatives']) {
      assert.equal(selectedScope(bad as string | null, ALL), null, String(bad))
      assert.equal(activeScope(bad as string | null, ALL), 'main', String(bad))
    }
    // Alternatives is not a portfolio scope, so it can never be selected as one.
    assert.deepEqual(portfolioScopesOf(ALL).map((s) => s.id), ['main', 'jaime', 'andres', 'pablo'])
  })

  test('21 · a caller with no portfolio scope resolves to nothing, not to Main', () => {
    assert.equal(activeScope('main', [{ id: ALTERNATIVES_SCOPE }]), null)
    assert.equal(activeScope(null, []), null)
  })

  test('22 · a scope value is encoded, never interpolated raw', () => {
    assert.equal(scopeHref(PORTFOLIO_SUMMARY, 'a b&c=d'), '/portfolio?scope=a%20b%26c%3Dd')
    assert.equal(scopeHref(PORTFOLIO_SUMMARY, null), PORTFOLIO_SUMMARY)
  })

  test('23 · the server-side entitlement checks are untouched', () => {
    // The client decides what a link says; the API and RLS decide what is
    // returned. Both are unchanged by this pass.
    for (const p of [
      'src/app/api/family-portfolio/overview/[scope]/route.ts',
      'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts',
      'src/app/api/family-portfolio/[scope]/snapshot/route.ts',
    ]) {
      assert.match(read(p), /canReadScope/, p)
    }
    // And the routing module grants nothing — no fetch, no entitlement call.
    const routes = read('src/lib/familyPortfolio/portfolioScopeRoutes.ts')
    assert.doesNotMatch(routes, /^import /m, 'the routing module stays dependency-free')
    assert.doesNotMatch(routes, /fetch\(|supabase/i)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 5 · The rail itself
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.4 § 6 — the rail carries the scope and still highlights correctly', () => {
  test('24 · the active pill is matched on the PATH, never the scoped href', () => {
    // `usePathname()` carries no query string, so matching against a scoped
    // href would leave every pill inactive the moment a scope was selected.
    const nav = code(read(NAV))
    assert.match(nav, /pathname === i\.path \|\| pathname\.startsWith\(`\$\{i\.path\}\/`\)/)
    assert.match(nav, /sort\(\(a, b\) => b\.path\.length - a\.path\.length\)/)
    assert.doesNotMatch(nav, /pathname === i\.href/)
    assert.doesNotMatch(nav, /b\.href\.length/)
  })

  test('25 · the item shape keeps path and href apart', () => {
    const nav = read(NAV)
    assert.match(nav, /interface ModuleNavItem \{[\s\S]*?path: string[\s\S]*?href: string[\s\S]*?\}/)
    assert.match(code(nav), /href: scopeHref\(path, scope\)/)
    assert.match(code(nav), /const scope = selectedScope\(searchParams\.get\(SCOPE_PARAM\), scopes\)/)
  })

  test('26 · the rail is inside a Suspense boundary, like every page that reads the query', () => {
    const layout = read(LAYOUT)
    assert.match(layout, /<Suspense fallback=\{null\}>\s*<FamilyPortfolioNav \/>\s*<\/Suspense>/)
    for (const p of SCOPE_PAGES) assert.match(read(p), /<Suspense/, p)
  })

  test('27 · all three pages read ONE derivation — no page kept a private copy', () => {
    for (const p of SCOPE_PAGES) {
      const src = code(read(p))
      assert.match(src, /portfolioScopeRoutes/, p)
      assert.match(src, /resolveActiveScope\(searchParams\.get\(SCOPE_PARAM\), scopes\)/, p)
      assert.match(src, /portfolioScopesOf\(scopes\)/, p)
      // The duplicated inline derivation is gone from every one of them.
      assert.doesNotMatch(src, /scopes\.filter\(\(s\) => s\.id !== 'alternatives'\)/, p)
      assert.doesNotMatch(src, /portfolioScopes\.some\(\(s\) => s\.id === requested\)/, p)
      assert.doesNotMatch(src, /\?scope=\$\{encodeURIComponent/, p)
    }
  })

  test('28 · the route constants are spelled once', () => {
    // A path written in two files is how a link and its target drift apart.
    assert.equal(PORTFOLIO_SUMMARY, '/portfolio')
    assert.equal(PORTFOLIO_HOLDINGS, '/portfolio/holdings')
    assert.equal(PORTFOLIO_WEEKLY_CHANGES, '/portfolio/weekly-changes')
    // R13.R5C.1's route decision is unchanged: /portfolio stays
    // canonical and the legacy /portfolio collision is not reopened.
    for (const r of SCOPE_AWARE_ROUTES) assert.match(r, /^\/portfolio/)
    for (const p of [NAV, ...SCOPE_PAGES]) {
      assert.doesNotMatch(code(read(p)), /href="\/portfolio"/, p)
    }
  })
})
