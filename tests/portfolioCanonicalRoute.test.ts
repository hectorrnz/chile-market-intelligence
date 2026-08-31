// POST-R13.5 — the Portfolio module moved from `/family-portfolio/*` onto the
// canonical `/portfolio/*`, and the Phase 6C/6D positions tracker that had been
// occupying that path was retired.
//
// TWO THINGS HAVE TO BE TRUE AT ONCE, and they pull in opposite directions:
//
//   1. Every bookmark under the old path still works. A family member who saved
//      `/family-portfolio/weekly-changes?scope=andres` must land on the same
//      view, for the same portfolio.
//   2. Moving a URL grants nobody anything. `?scope=` is how a scope is chosen,
//      so a redirect that carries it is also a redirect that carries an
//      *attacker-chosen* one — and the answer must be identical to what it was
//      before the move: the server decides, per request, from the caller's own
//      `user_profiles` row.
//
// Those are the two halves of this file. The authorization half is deliberately
// the larger one, and it is written against the SAME pure rule the API routes
// and PostgreSQL RLS both consume, not against a restatement of it.
//
// WHAT THIS FILE IS NOT. It is not a claim that a route file's existence
// authorizes anything: `accessPolicy.ts` is default-deny, so every one of these
// paths was private the moment it existed and stays private without an entry
// anywhere. That property is asserted below precisely because it is what makes
// the whole migration safe.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  scopesFor,
  canReadScope,
  canAdminister,
  type EntitlementInput,
} from '../src/lib/portfolioAccess/entitlements.ts'
import {
  classifyPath,
  requiresApprovedSession,
  deniesWithJson,
} from '../src/lib/auth/accessPolicy.ts'
import { buildLoginRedirectPath } from '../src/lib/auth/safeRedirect.ts'
import {
  PORTFOLIO_SUMMARY,
  PORTFOLIO_HOLDINGS,
  PORTFOLIO_WEEKLY_CHANGES,
  PORTFOLIO_ADMIN,
  SCOPE_AWARE_ROUTES,
  SCOPE_PARAM,
  scopeHref,
  selectedScope,
  activeScope,
} from '../src/lib/familyPortfolio/portfolioScopeRoutes.ts'
import {
  ALTERNATIVES_ROOT,
  ALTERNATIVES_HOLDINGS,
  ALTERNATIVES_CASH_FLOWS,
} from '../src/lib/familyPortfolio/alternativesRoutes.ts'
import { PORTFOLIO_LEGACY_REDIRECTS } from '../src/lib/routes/portfolioLegacyRedirects.ts'
import { navGroups, resolveActiveGroup, getPageTitle } from '../src/lib/navigation.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ═══════════════════════════════════════════════════════════════════════════
// The four callers, exactly as `user_profiles` stores them.
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN: EntitlementInput = { isApproved: true, isAdministrator: true, principal: null }
const JAIME: EntitlementInput = { isApproved: true, isAdministrator: false, principal: 'jaime' }
const ANDRES: EntitlementInput = { isApproved: true, isAdministrator: false, principal: 'andres' }
const PABLO: EntitlementInput = { isApproved: true, isAdministrator: false, principal: 'pablo' }
const NO_PRINCIPAL: EntitlementInput = { isApproved: true, isAdministrator: false, principal: null }
const UNAPPROVED: EntitlementInput = { isApproved: false, isAdministrator: true, principal: 'jaime' }

/** The canonical member-facing routes, in rail order. */
const CANONICAL_ROUTES = [
  PORTFOLIO_SUMMARY,
  PORTFOLIO_HOLDINGS,
  PORTFOLIO_WEEKLY_CHANGES,
  ALTERNATIVES_ROOT,
  ALTERNATIVES_HOLDINGS,
  ALTERNATIVES_CASH_FLOWS,
  PORTFOLIO_ADMIN,
] as const

/** Old URL -> the canonical one it must resolve to. */
const REDIRECT_MAP: readonly (readonly [string, string])[] = [
  ['/family-portfolio', '/portfolio'],
  ['/family-portfolio/portfolio', '/portfolio/holdings'],
  ['/family-portfolio/weekly-changes', '/portfolio/weekly-changes'],
  ['/family-portfolio/alternatives', '/portfolio/alternatives'],
  ['/family-portfolio/alternatives/holdings', '/portfolio/alternatives/holdings'],
  ['/family-portfolio/alternatives/cash-flows', '/portfolio/alternatives/cash-flows'],
  ['/family-portfolio/admin', '/portfolio/admin'],
]

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Entitlements — unchanged by the move, asserted route by route
// ═══════════════════════════════════════════════════════════════════════════

describe('POST-R13.5 · the route move grants nothing', () => {
  test('an administrator still reaches every scope', () => {
    assert.deepEqual(scopesFor(ADMIN), ['main', 'jaime', 'andres', 'pablo', 'alternatives', 'admin'])
    for (const s of ['main', 'jaime', 'andres', 'pablo', 'alternatives', 'admin']) {
      assert.ok(canReadScope(ADMIN, s), `administrator must read ${s}`)
    }
    assert.ok(canAdminister(ADMIN))
  })

  // The load-bearing isolation rule, stated once per brother so a failure names
  // exactly which wall came down.
  const PRINCIPALS = [
    { name: 'jaime', who: JAIME, own: 'jaime', others: ['andres', 'pablo'] },
    { name: 'andres', who: ANDRES, own: 'andres', others: ['jaime', 'pablo'] },
    { name: 'pablo', who: PABLO, own: 'pablo', others: ['jaime', 'andres'] },
  ] as const

  for (const { name, who, own, others } of PRINCIPALS) {
    test(`${name} reaches Main, ${own} and Alternatives — and nothing else`, () => {
      assert.deepEqual(scopesFor(who), ['main', own, 'alternatives'])
      for (const allowed of ['main', own, 'alternatives']) {
        assert.ok(canReadScope(who, allowed), `${name} must read ${allowed}`)
      }
      for (const forbidden of others) {
        assert.ok(!canReadScope(who, forbidden), `${name} must NEVER read ${forbidden}`)
      }
      assert.ok(!canReadScope(who, 'admin'), `${name} must never reach the admin scope`)
      assert.ok(!canAdminister(who), `${name} is not an administrator`)
    })
  }

  test('an approved account with no principal has no personal portfolio at all', () => {
    assert.deepEqual(scopesFor(NO_PRINCIPAL), [])
    for (const s of ['main', 'jaime', 'andres', 'pablo', 'alternatives', 'admin']) {
      assert.ok(!canReadScope(NO_PRINCIPAL, s))
    }
  })

  test('approval is the outer gate — an unapproved administrator has nothing', () => {
    assert.deepEqual(scopesFor(UNAPPROVED), [])
    assert.ok(!canAdminister(UNAPPROVED))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2 · A forged ?scope= on a canonical URL
// ═══════════════════════════════════════════════════════════════════════════

describe('POST-R13.5 · a hand-typed ?scope= on the new path fails exactly as before', () => {
  // The scenario named in the brief: Pablo opens `/portfolio?scope=jaime`.
  const forged = ['jaime', 'andres', 'pablo', 'admin', 'main']

  test('canReadScope refuses every scope the caller was not granted', () => {
    for (const scope of forged) {
      const allowed = scopesFor(PABLO).includes(scope as never)
      assert.equal(
        canReadScope(PABLO, scope),
        allowed,
        `pablo + ?scope=${scope} must be ${allowed ? 'allowed' : 'refused'}`,
      )
    }
    assert.ok(!canReadScope(PABLO, 'jaime'), 'the reported attack must fail')
    assert.ok(!canReadScope(JAIME, 'pablo'))
    assert.ok(!canReadScope(ANDRES, 'jaime'))
  })

  test('a malformed, empty or exotic scope value is refused, never coerced', () => {
    const entitled = [{ id: 'main' }, { id: 'jaime' }, { id: 'alternatives' }]
    for (const junk of [
      '', ' ', 'MAIN', 'Jaime', 'jaime ', '../jaime', 'jaime%00', 'admin;--',
      '__proto__', 'constructor', 'toString', 'null', 'undefined',
    ]) {
      assert.ok(!canReadScope(JAIME, junk), `${JSON.stringify(junk)} must be refused`)
      assert.equal(selectedScope(junk, entitled), null, `${JSON.stringify(junk)} must not select`)
    }
    for (const junk of [null, undefined, 0, 1, true, {}, [], ['jaime']]) {
      assert.ok(!canReadScope(JAIME, junk), `${JSON.stringify(junk)} must be refused`)
    }
  })

  test('an unentitled ?scope= resolves AWAY rather than dead-ending — and is never linked on', () => {
    // Presentation, not protection: the page still renders the caller's own
    // default rather than an error, and the rail links to a bare path so the
    // forged value cannot propagate into the next URL.
    const pabloScopes = [{ id: 'main' }, { id: 'pablo' }, { id: 'alternatives' }]
    assert.equal(activeScope('jaime', pabloScopes), 'main', 'falls back to the caller own first scope')
    assert.equal(selectedScope('jaime', pabloScopes), null, 'never treated as an explicit choice')
    assert.equal(scopeHref(PORTFOLIO_SUMMARY, selectedScope('jaime', pabloScopes)), PORTFOLIO_SUMMARY)
  })

  test('reload cannot broaden access — the decision is a pure function of the stored profile', () => {
    // Nothing in the resolution reads a URL, header, cookie or cached list, so
    // repeating a request cannot produce a different answer.
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(scopesFor(PABLO), ['main', 'pablo', 'alternatives'])
      assert.ok(!canReadScope(PABLO, 'jaime'))
    }
    const before = scopesFor(JAIME)
    before.push('pablo' as never)
    assert.deepEqual(scopesFor(JAIME), ['main', 'jaime', 'alternatives'], 'the table is never aliased out')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Direct URL entry, and the redirect, are both gated
// ═══════════════════════════════════════════════════════════════════════════

describe('POST-R13.5 · every canonical route is private by default-deny', () => {
  test('each new route is a private page, and each is a redirect destination too', () => {
    for (const route of CANONICAL_ROUTES) {
      assert.equal(classifyPath(route), 'private_page', `${route} must be private`)
      assert.ok(requiresApprovedSession(route), `${route} must require a session`)
      assert.ok(!deniesWithJson(route), `${route} denies by redirect, not JSON`)
    }
  })

  test('a deep or hand-crafted sibling path under /portfolio is private too', () => {
    for (const p of [
      '/portfolio/holdings/anything',
      '/portfolio/admin/publications/1',
      '/portfolio/alternatives/cash-flows',
      '/portfolio/../portfolio/admin',
      '/portfolio/%2e%2e/admin',
    ]) {
      assert.ok(requiresApprovedSession(p), `${p} must be gated`)
    }
    // ...while a merely similarly-spelled sibling is NOT silently treated as a
    // member of the module (segment-aware matching, not startsWith).
    assert.equal(classifyPath('/portfoliofoo'), 'private_page', 'still private by default-deny')
  })

  test('the OLD path is gated as well — the redirect is not the only thing standing there', () => {
    // next.config redirects run before middleware, so an old URL is normally
    // answered with a 308 and never reaches a handler. If that redirect were
    // ever removed, default-deny still refuses the path: nothing about this
    // migration depends on the redirect for protection.
    for (const [oldPath] of REDIRECT_MAP) {
      assert.equal(classifyPath(oldPath), 'private_page', `${oldPath} must stay private`)
      assert.ok(requiresApprovedSession(oldPath))
    }
  })

  test('no Portfolio path — old or new — appears on any allowlist', () => {
    const POLICY = read('src/lib/auth/accessPolicy.ts')
    assert.doesNotMatch(POLICY, /portfolio/i, 'the policy must never name a Portfolio route')
  })

  test('a login redirect carries the CANONICAL destination and manufactures no entitlement', () => {
    // `next=` is a destination, never a claim. It survives the safe-redirect
    // validator only as an internal path, and the entitlement is re-derived from
    // the profile on the request that follows.
    assert.equal(
      buildLoginRedirectPath('/portfolio/weekly-changes?scope=andres'),
      '/login?next=%2Fportfolio%2Fweekly-changes%3Fscope%3Dandres',
    )
    // A forged scope in `next=` is preserved as text and refused as authorization.
    assert.ok(!canReadScope(PABLO, 'andres'))
    // And an external destination smuggled through the old path is still refused.
    for (const hostile of [
      '//evil.example/portfolio',
      'https://evil.example/portfolio',
      '/\\evil.example',
    ]) {
      const built = buildLoginRedirectPath(hostile)
      assert.ok(!built.includes('evil.example'), `${hostile} must not be reflected`)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4 · API authorization is server-side and unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe('POST-R13.5 · the API surface did not move and did not weaken', () => {
  const API_ROOT = join(ROOT, 'src/app/api/family-portfolio')

  const routeFiles = (): string[] => {
    const out: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name === 'route.ts') out.push(full.replace(ROOT + '\\', '').replace(/\\/g, '/'))
      }
    }
    walk(API_ROOT)
    return out.sort()
  }

  test('the API namespace is deliberately NOT renamed with the page routes', () => {
    // Renaming `/api/family-portfolio/**` would be a second migration with its
    // own risk and no user-visible benefit: nobody bookmarks an API path, and
    // the read model and publication semantics are untouched by this stage.
    assert.ok(existsSync(API_ROOT), 'the API namespace must still exist')
    assert.ok(!existsSync(join(ROOT, 'src/app/api/portfolio')), 'no parallel API namespace appeared')
    assert.ok(!existsSync(join(ROOT, 'src/app/api/portfolios')), 'the legacy tracker API is retired')
  })

  test('every route still passes the private-API guard first', () => {
    const files = routeFiles()
    assert.ok(files.length >= 14, `expected the full API surface, saw ${files.length}`)
    for (const f of files) {
      assert.match(read(f), /guardPrivateApi\(\)/, `${f} must guard the session`)
      assert.equal(classifyPath('/' + f.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '')), 'private_api')
    }
  })

  test('every scope-bearing route re-derives the entitlement server-side', () => {
    for (const f of [
      'src/app/api/family-portfolio/[scope]/snapshot/route.ts',
      'src/app/api/family-portfolio/[scope]/weeks/route.ts',
      'src/app/api/family-portfolio/overview/[scope]/route.ts',
      'src/app/api/family-portfolio/weekly-changes/[scope]/route.ts',
      'src/app/api/family-portfolio/alternatives/route.ts',
    ]) {
      const src = read(f)
      assert.match(src, /getFamilyPortfolioEntitlement\(\)/, `${f} must resolve the caller's own entitlement`)
      assert.match(src, /canReadScope\(/, `${f} must check the requested scope`)
      // The scope arrives as untrusted route input, never as a trusted claim.
      assert.doesNotMatch(src, /headers\(\)\.get\(['"]x-/i, `${f} must not read a scope from a header`)
    }
  })

  test('the entitlement never comes from client-controlled state', () => {
    const resolver = read('src/lib/portfolioAccess/getEntitlement.ts')
    assert.match(resolver, /getSupabaseUserClient/, 'own-row RLS authorises the read')
    // The file's header legitimately explains WHY user_metadata is unusable, so
    // scan the code rather than the prose.
    const code = resolver.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(code, /user_metadata/, 'user_metadata is user-writable and can never be a claim')
    assert.doesNotMatch(code, /createAdminClient|service_role|SERVICE_ROLE/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5 · The redirects themselves — evaluated, not just read
// ═══════════════════════════════════════════════════════════════════════════

describe('POST-R13.5 · every old URL still resolves, with its query intact', () => {
  // Resolve the config the way Next.js does rather than grepping the file: an
  // ordering mistake between the specific Holdings rule and the catch-all is
  // invisible to a text scan and is exactly the bug that would silently send
  // every Holdings bookmark to a 404.
  // `next.config.ts` cannot be imported here (it uses `__dirname`, which only
  // exists once Next's own loader compiles it), so the table lives in a pure
  // module both it and this file read. The config is asserted to consume that
  // module rather than re-declaring its own copy.
  const loadRedirects = async () => [...PORTFOLIO_LEGACY_REDIRECTS]

  /** Next.js path-to-regexp semantics, narrowed to the two forms used here. */
  const matchRule = (rule: { source: string; destination: string }, path: string): string | null => {
    if (rule.source.endsWith('/:path*')) {
      const base = rule.source.slice(0, -'/:path*'.length)
      if (path === base) return rule.destination.replace('/:path*', '')
      if (!path.startsWith(base + '/')) return null
      return rule.destination.replace('/:path*', '/' + path.slice(base.length + 1))
    }
    return rule.source === path ? rule.destination : null
  }

  const resolve = (rules: { source: string; destination: string }[], path: string): string | null => {
    for (const rule of rules) {
      const hit = matchRule(rule, path)
      if (hit !== null) return hit
    }
    return null
  }

  test('next.config consumes the shared table rather than declaring its own', () => {
    const cfg = readFileSync(join(ROOT, 'next.config.ts'), 'utf8')
    assert.match(cfg, /PORTFOLIO_LEGACY_REDIRECTS/)
    assert.match(cfg, /async redirects\(\)/)
    // No second, drifting copy of any old path inside the config itself.
    assert.doesNotMatch(cfg.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, ''), /source:/)
  })

  test('each old route resolves to its canonical replacement, in declared order', async () => {
    const rules = await loadRedirects()
    for (const [from, to] of REDIRECT_MAP) {
      assert.equal(resolve(rules, from), to, `${from} must redirect to ${to}`)
    }
  })

  test('Holdings is the renamed segment, and its rule wins over the catch-all', async () => {
    const rules = await loadRedirects()
    // The specific rule must come first, or `/family-portfolio/portfolio` maps
    // to `/portfolio/portfolio`, which does not exist.
    const specific = rules.findIndex((r) => r.source === '/family-portfolio/portfolio')
    const catchAll = rules.findIndex((r) => r.source === '/family-portfolio/:path*')
    assert.ok(specific > -1 && catchAll > -1, 'both rules must exist')
    assert.ok(specific < catchAll, 'the Holdings rule must precede the catch-all')
    assert.notEqual(resolve(rules, '/family-portfolio/portfolio'), '/portfolio/portfolio')
    assert.ok(!existsSync(join(ROOT, 'src/app/portfolio/portfolio')), 'no doubled segment exists to catch it')
  })

  test('every redirect is permanent, and none of them loops', async () => {
    const rules = await loadRedirects()
    for (const rule of rules) {
      assert.equal(rule.permanent, true, `${rule.source} must be a permanent redirect`)
    }
    // A destination that is itself a source is a loop. Check the resolved
    // destination of every old URL, and then that the destination resolves to
    // nothing further.
    for (const [, to] of REDIRECT_MAP) {
      assert.equal(resolve(rules, to), null, `${to} must be a terminal destination`)
    }
    for (const route of CANONICAL_ROUTES) {
      assert.equal(resolve(rules, route), null, `${route} must never redirect`)
    }
  })

  test('the query string is carried through — no destination declares one of its own', async () => {
    const rules = await loadRedirects()
    // Next.js forwards the incoming query whenever the destination has none.
    // `?scope=` IS the scope mechanism, so a destination query here would
    // silently drop every bookmarked portfolio selection.
    for (const rule of rules) {
      assert.ok(!rule.destination.includes('?'), `${rule.source} must not pin a query`)
      assert.ok(!rule.source.includes('?'), `${rule.source} must match on path only`)
    }
  })

  test('a bookmarked scoped URL lands on the same view, for the same portfolio', async () => {
    const rules = await loadRedirects()
    // Simulate the forwarding rule: path redirects, query rides along.
    const follow = (url: string) => {
      const [path, query] = url.split('?')
      const to = resolve(rules, path)
      return to === null ? url : query ? `${to}?${query}` : to
    }
    assert.equal(
      follow('/family-portfolio/weekly-changes?scope=andres'),
      '/portfolio/weekly-changes?scope=andres',
    )
    assert.equal(follow('/family-portfolio?scope=pablo'), '/portfolio?scope=pablo')
    assert.equal(follow('/family-portfolio/portfolio?scope=jaime'), '/portfolio/holdings?scope=jaime')
    // ...and the carried scope is still only a REQUEST. Andrés keeps it; Pablo
    // does not, on exactly the same URL.
    assert.ok(canReadScope(ANDRES, 'andres'))
    assert.ok(!canReadScope(PABLO, 'andres'))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6 · The route map, the pages behind it, and the navigation
// ═══════════════════════════════════════════════════════════════════════════

describe('POST-R13.5 · the canonical route map is real and consistently named', () => {
  test('every canonical route has a page file behind it', () => {
    const PAGES: readonly (readonly [string, string])[] = [
      [PORTFOLIO_SUMMARY, 'src/app/portfolio/page.tsx'],
      [PORTFOLIO_HOLDINGS, 'src/app/portfolio/holdings/page.tsx'],
      [PORTFOLIO_WEEKLY_CHANGES, 'src/app/portfolio/weekly-changes/page.tsx'],
      [ALTERNATIVES_ROOT, 'src/app/portfolio/alternatives/page.tsx'],
      [ALTERNATIVES_HOLDINGS, 'src/app/portfolio/alternatives/holdings/page.tsx'],
      [ALTERNATIVES_CASH_FLOWS, 'src/app/portfolio/alternatives/cash-flows/page.tsx'],
      [PORTFOLIO_ADMIN, 'src/app/portfolio/admin/page.tsx'],
    ]
    for (const [route, file] of PAGES) {
      assert.ok(existsSync(join(ROOT, file)), `${route} needs ${file}`)
      // The file path and the URL must agree, or one of them is a typo.
      assert.equal('/' + file.replace(/^src\/app\//, '').replace(/\/page\.tsx$/, ''), route)
    }
    // The module shell wraps them all.
    assert.ok(existsSync(join(ROOT, 'src/app/portfolio/layout.tsx')))
  })

  test('the route constants are the ONLY place a Portfolio path is spelled', () => {
    // Every page path lives in one of the two route modules. A literal anywhere
    // else is how a link and its target drift apart.
    assert.deepEqual([...SCOPE_AWARE_ROUTES], ['/portfolio', '/portfolio/holdings', '/portfolio/weekly-changes'])
    const nav = read('src/components/familyPortfolio/FamilyPortfolioNav.tsx')
    assert.doesNotMatch(nav, /'\/portfolio/, 'the rail must name constants, not literals')
    assert.match(nav, /PORTFOLIO_ADMIN/)
    assert.match(nav, /ALTERNATIVES_ROOT/)
  })

  test('active-tab matching is longest-prefix, so a child never lights up Summary as well', () => {
    // The rail sorts candidates by path length and takes the longest. Reproduced
    // here against the real constants so a new route with an overlapping prefix
    // fails loudly.
    const items = [
      { key: 'overview', path: PORTFOLIO_SUMMARY },
      { key: 'portfolio', path: PORTFOLIO_HOLDINGS },
      { key: 'weekly-changes', path: PORTFOLIO_WEEKLY_CHANGES },
      { key: 'alternatives', path: ALTERNATIVES_ROOT },
      { key: 'admin', path: PORTFOLIO_ADMIN },
    ]
    const activeKey = (pathname: string) =>
      items
        .filter((i) => pathname === i.path || pathname.startsWith(`${i.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0]?.key ?? null

    assert.equal(activeKey('/portfolio'), 'overview')
    assert.equal(activeKey('/portfolio/holdings'), 'portfolio')
    assert.equal(activeKey('/portfolio/weekly-changes'), 'weekly-changes')
    assert.equal(activeKey('/portfolio/alternatives'), 'alternatives')
    assert.equal(activeKey('/portfolio/alternatives/holdings'), 'alternatives')
    assert.equal(activeKey('/portfolio/alternatives/cash-flows'), 'alternatives')
    assert.equal(activeKey('/portfolio/admin'), 'admin')
    assert.equal(activeKey('/stocks'), null)
  })

  test('primary navigation names the canonical route once, and the old one never', () => {
    const hrefs = navGroups.flatMap((g) => [g.href, ...(g.children ?? []).map((c) => c.href)])
    assert.ok(hrefs.includes('/portfolio'))
    assert.ok(!hrefs.includes('/family-portfolio'))
    assert.equal(hrefs.filter((h) => h === '/portfolio').length, 1)
    // Every canonical route resolves to the Portfolio group and its title.
    for (const route of CANONICAL_ROUTES) {
      assert.equal(resolveActiveGroup(route)?.key, 'portfolio', `${route} must resolve to Portfolio`)
    }
    assert.equal(getPageTitle('/portfolio', 'en', dict.en), dict.en.nav.portfolio)
    assert.equal(getPageTitle('/portfolio', 'es', dict.es), dict.es.nav.portfolio)
  })

  test('the scope parameter survives a rail click — Back and Forward stay URL-backed', () => {
    // The rail appends the selection to the path it links to, so history holds a
    // complete state and Back returns to the portfolio the reader was viewing
    // rather than to whatever the default resolves to.
    const entitled = [{ id: 'main' }, { id: 'andres' }, { id: 'alternatives' }]
    const scope = selectedScope('andres', entitled)
    assert.equal(scope, 'andres')
    assert.equal(scopeHref(PORTFOLIO_WEEKLY_CHANGES, scope), '/portfolio/weekly-changes?scope=andres')
    assert.equal(scopeHref(PORTFOLIO_HOLDINGS, scope), '/portfolio/holdings?scope=andres')
    // No selection keeps the bare path, so a default is never pinned into history.
    assert.equal(scopeHref(PORTFOLIO_SUMMARY, null), '/portfolio')
    assert.equal(SCOPE_PARAM, 'scope')
    // Alternatives and Admin take no scope: forcing one would claim a filter
    // neither surface has.
    assert.ok(!SCOPE_AWARE_ROUTES.includes(ALTERNATIVES_ROOT as never))
    assert.ok(!SCOPE_AWARE_ROUTES.includes(PORTFOLIO_ADMIN as never))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7 · The legacy tracker is retired, and nothing points at it
// ═══════════════════════════════════════════════════════════════════════════

describe('POST-R13.5 · the Phase 6C/6D positions tracker is fully retired', () => {
  test('its page, API, repositories and pure modules are all gone', () => {
    for (const f of [
      'src/app/api/portfolios',
      'src/lib/portfolio',
      'src/lib/portfolio/valuation.ts',
      'src/lib/portfolio/transactions.ts',
      'src/lib/db/repositories/portfolioRepository.ts',
      'src/lib/db/repositories/portfolioTransactionRepository.ts',
    ]) {
      assert.ok(!existsSync(join(ROOT, f)), `${f} must be retired`)
    }
  })

  test('no source file still imports or fetches any of it', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(e.name)) {
          const src = readFileSync(full, 'utf8')
          const rel = full.replace(ROOT + '\\', '').replace(/\\/g, '/')
          // Comments legitimately narrate the retirement; only real code counts.
          const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
          if (/from '@\/lib\/portfolio\/(valuation|transactions)'/.test(code)) hits.push(`${rel}: valuation/transactions import`)
          if (/portfolioRepository|portfolioTransactionRepository/.test(code)) hits.push(`${rel}: retired repository`)
          if (/fetch\((['"`])\/api\/portfolios/.test(code)) hits.push(`${rel}: fetches the retired API`)
        }
      }
    }
    walk(join(ROOT, 'src'))
    assert.deepEqual(hits, [], 'the retired tracker must have no surviving consumer')
  })

  test('the DATA it wrote is untouched — this stage removed code, not records', () => {
    // The migrations that created portfolios / portfolio_positions /
    // portfolio_transactions / portfolio_cash_ledger are deliberately left in
    // place: deleting a UI is reversible, dropping a table is not, and no
    // instruction here authorized touching hosted data.
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    assert.ok(
      migrations.some((m) => m.includes('portfolio_foundation')),
      'the tracker migration must remain',
    )
    assert.ok(
      migrations.some((m) => m.includes('portfolio_transactions_cash_ledger')),
      'the ledger migration must remain',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8 · No stale reference to the old page space survives in production code
// ═══════════════════════════════════════════════════════════════════════════

describe('POST-R13.5 · nothing in src still names the old page space', () => {
  test('every remaining occurrence is either the API namespace or a dated history note', () => {
    // A stale LINK is the failure mode; a comment recording where the module
    // used to live is documentation. This separates the two by requiring the
    // note to be a comment AND to say so.
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(e.name)) {
          const rel = full.replace(ROOT + '\\', '').replace(/\\/g, '/')
          const src = readFileSync(full, 'utf8')
          src.split('\n').forEach((line, i) => {
            if (!line.includes('family-portfolio')) return
            if (line.includes('api/family-portfolio')) return          // the API namespace, unchanged
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return                // a comment
            // The compatibility table is the ONE place that must still name the
            // old paths — that is what it is for.
            if (rel === 'src/lib/routes/portfolioLegacyRedirects.ts') return
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
          })
        }
      }
    }
    walk(join(ROOT, 'src'))
    assert.deepEqual(offenders, [], 'a live reference to the superseded path survives')
  })

  test('no JSX href, Link or router call in src targets the old path', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(e.name)) {
          const rel = full.replace(ROOT + '\\', '').replace(/\\/g, '/')
          const code = readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
          if (/href=["'{][^"'}]*\/family-portfolio/.test(code)) offenders.push(`${rel}: href`)
          if (/router\.(push|replace)\(['"`]\/family-portfolio/.test(code)) offenders.push(`${rel}: router`)
          if (/redirect\(['"`]\/family-portfolio/.test(code)) offenders.push(`${rel}: redirect`)
        }
      }
    }
    walk(join(ROOT, 'src'))
    assert.deepEqual(offenders, [], 'a navigation target still points at the superseded path')
  })
})
