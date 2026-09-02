// POST-R13.6CDE.2 — MODULE ROUTE/API ENFORCEMENT + ACCESS LOOKUP CONSOLIDATION.
//
// Two defects are closed here, and this suite is what proves both.
//
// 1 · ONE GRANT ADMITTED THE WHOLE APPLICATION.
//     `moduleRoutes.ts` was written, tested and left with NO production
//     consumer. `decideRequestAccess` asked only "may this account ENTER" — so
//     an approved member granted `macro` alone reached Stocks, Compare,
//     Earnings, Portfolio and Structured Notes by typing their URLs, and every
//     API behind them. Navigation hid the links; nothing enforced them. This
//     suite asserts the enforcement route by route, in BOTH directions: the
//     member's own module is reachable, and every other module is refused.
//
// 2 · THREE SEQUENTIAL ROUND-TRIPS PER MEMBER REQUEST.
//     `auth.getUser()`, then `user_profiles`, then `user_module_grants`. The
//     last is gone: the grants are embedded in the profile read, so approval,
//     role and grants arrive as ONE state from ONE query. That is not only
//     faster — it removes the possibility of a single request authorizing
//     against two snapshots taken at two instants.
//
// BEHAVIOURAL FIRST. Almost everything below calls the REAL
// `decideRequestAccess` with injected lookups and asserts the real returned
// decision. Source scanning appears only where the property lives in the
// binding rather than in the decision (which client issues the query, whether a
// second query exists at all).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  decideRequestAccess,
  type IdentityVerifier,
} from '../src/lib/auth/requestAccess.ts'
import {
  parseAuthorizationRow,
  moduleAccessOf,
  AUTHORIZATION_STATE_SELECT,
  type AuthorizationStateLookup,
  type AuthorizationState,
} from '../src/lib/auth/authorizationState.ts'
import {
  resolvePathModule,
  bindingSatisfiedBy,
} from '../src/lib/auth/moduleRoutes.ts'
import { APP_MODULE_KEYS, type ModuleKey } from '../src/lib/auth/moduleAccess.ts'
import { classifyPath, requiresApprovedSession } from '../src/lib/auth/accessPolicy.ts'
import { ACCESS_DENIED_REASONS } from '../src/lib/auth/approval.ts'
import { scopesFor } from '../src/lib/portfolioAccess/entitlements.ts'
import { portfolioVisibleScopes } from '../src/lib/portfolioAccess/portfolioModuleComposition.ts'

/**
 * R13.6F — builds a complete `AuthorizationState`.
 *
 * The type gained `lifecycle`, `usable` and `status` when account lifecycle became
 * an authorization input. These cases were written to exercise the MODULE rules,
 * with approval as the gate, so each fixture is an ACTIVE account and says so
 * explicitly rather than relying on a default — a state that failed to declare its
 * lifecycle would be treated as never-activated and would deny for the wrong
 * reason, making every assertion below pass vacuously.
 */
function st(o: {
  userId: string
  approved: boolean
  role: string | null
  grants: readonly string[]
}): AuthorizationState {
  return {
    ...o,
    lifecycle: {
      approved: o.approved,
      invitedAt: null,
      activatedAt: '2026-01-01T00:00:00.000Z',
      disabledAt: null,
    },
    usable: o.approved,
    status: 'active',
  }
}


const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** Source with comments stripped, so a comment can never satisfy an assertion. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── fixtures ────────────────────────────────────────────────────────────────

const USER = { id: 'user-1' }
const verified: IdentityVerifier = async () => ({ user: USER })
const rejected: IdentityVerifier = async () => ({ user: null })

/** An approved member holding exactly these modules. */
const memberWith = (...grants: string[]): AuthorizationStateLookup => async () => ({
  ok: true,
  state: st({ userId: USER.id, approved: true, role: 'member', grants }),
})
/** An approved administrator, deliberately holding no grant rows. */
const admin: AuthorizationStateLookup = async () => ({
  ok: true,
  state: st({ userId: USER.id, approved: true, role: 'administrator', grants: [] }),
})
const storeFailed: AuthorizationStateLookup = async () => ({ ok: false })

async function outcome(path: string, lookup: AuthorizationStateLookup) {
  return decideRequestAccess(path, verified, lookup)
}
async function allowed(path: string, lookup: AuthorizationStateLookup): Promise<boolean> {
  return (await outcome(path, lookup)).outcome === 'allow'
}

// ── the surface map under test ──────────────────────────────────────────────
//
// Written out rather than derived from `moduleRoutes.ts`, on purpose: deriving
// the expectation from the thing under test would make every assertion below
// vacuously true. These are the routes the application actually serves, sorted
// into the module a reader would expect to own them.

const MODULE_PAGES: Record<ModuleKey, readonly string[]> = {
  markets: ['/stocks', '/companies/SQM-B', '/watchlist'],
  analysis: ['/compare', '/chart-builder'],
  macro: ['/macro', '/macro/calendar'],
  earnings: ['/earnings'],
  portfolio: ['/portfolio', '/portfolio/holdings', '/portfolio/weekly-changes'],
  alternatives: [
    '/portfolio/alternatives',
    '/portfolio/alternatives/holdings',
    '/portfolio/alternatives/cash-flows',
  ],
  structured_notes: ['/structured-notes', '/structured-notes/note-1'],
}

const MODULE_APIS: Record<ModuleKey, readonly string[]> = {
  markets: [
    '/api/market/stocks',
    '/api/market/indices',
    '/api/market/stocks/SQM-B/history',
    '/api/watchlists',
    '/api/valuation/SQM-B',
  ],
  analysis: ['/api/compare', '/api/compare/history', '/api/financials/SQM-B/metrics'],
  macro: ['/api/macro', '/api/macro/yield-curve', '/api/macro/history/tpm'],
  earnings: ['/api/earnings', '/api/earnings/calendar', '/api/earnings/results'],
  portfolio: [
    '/api/family-portfolio/jaime/snapshot',
    '/api/family-portfolio/jaime/weeks',
    '/api/family-portfolio/overview/main',
    '/api/family-portfolio/weekly-changes/main',
    '/api/family-portfolio/presentation-settings',
  ],
  alternatives: ['/api/family-portfolio/alternatives'],
  structured_notes: [
    '/api/structured-notes',
    '/api/structured-notes/note-1',
    '/api/structured-notes/monitoring-status',
  ],
}

/** Platform infrastructure: reachable by anyone who passed the boundary. */
const ALWAYS_AVAILABLE = [
  '/',
  '/settings',
  '/api/me/access',
  '/api/news',
  '/api/notifications',
  '/api/health/ingestion',
] as const

/** ROLE capabilities. No module grant can ever satisfy these. */
const ADMIN_ONLY = [
  '/settings/users',
  '/settings/notifications',
  '/portfolio/admin',
  '/api/admin/users',
  '/api/notification-recipients',
  '/api/family-portfolio/admin/uploads',
] as const

/**
 * The one FAMILY entry point: reachable by holding EITHER Portfolio module.
 *
 * The Portfolio layout mounts it for the Alternatives pages too, and it returns
 * scopes that are already ceiling ∩ module mask, so widening the route widens
 * nothing else.
 */
const FAMILY_ANY = '/api/family-portfolio/scopes'

const surfacesOf = (m: ModuleKey) => [...MODULE_PAGES[m], ...MODULE_APIS[m]]
const ALL_MODULE_SURFACES = APP_MODULE_KEYS.flatMap(surfacesOf)

// ════════════════════════════════════════════════════════════════════════════
// 0 · PRECONDITION — the map is not vacuous
// ════════════════════════════════════════════════════════════════════════════

describe('preconditions', () => {
  it('every surface under test is a private path the gate actually covers', () => {
    for (const p of [...ALL_MODULE_SURFACES, ...ALWAYS_AVAILABLE, ...ADMIN_ONLY, FAMILY_ANY]) {
      assert.equal(requiresApprovedSession(p), true, `${p} must be gated`)
      const cls = classifyPath(p)
      assert.ok(cls === 'private_page' || cls === 'private_api', `${p} classified ${cls}`)
    }
  })

  it('the matrix covers all seven modules with both pages and APIs', () => {
    for (const m of APP_MODULE_KEYS) {
      assert.ok(MODULE_PAGES[m].length > 0, `${m} has no page under test`)
      assert.ok(MODULE_APIS[m].length > 0, `${m} has no API under test`)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 1 · PRE-CHANGE DEFECT, STATED AS A PROPERTY (§1)
// ════════════════════════════════════════════════════════════════════════════

describe('the defect this stage closes', () => {
  it('holding ONE module no longer admits every other module', async () => {
    // The pre-change behaviour, expressed as the thing that must now be false:
    // a single grant reaching the whole application.
    const macroOnly = memberWith('macro')
    const reached = []
    for (const p of ALL_MODULE_SURFACES) {
      if (await allowed(p, macroOnly)) reached.push(p)
    }
    assert.deepEqual(
      reached.sort(),
      [...surfacesOf('macro')].sort(),
      'a macro-only member must reach macro surfaces and nothing else',
    )
  })

  it('the route table now has a production consumer', () => {
    // It had none through POST-R13.6CDE.1, which is precisely why one grant
    // reached everything. Asserted against the decision, not a comment.
    const decision = code(read('src/lib/auth/requestAccess.ts'))
    assert.match(decision, /from '\.\/moduleRoutes\.ts'/)
    assert.match(decision, /resolvePathModule\(pathname\)/)
    assert.match(decision, /bindingSatisfiedBy\(binding, access\)/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2 · THE FULL GRANT-STATE MATRIX (§12)
// ════════════════════════════════════════════════════════════════════════════

describe('grant-state matrix — every module, both directions', () => {
  for (const held of APP_MODULE_KEYS) {
    const lookup = memberWith(held)

    it(`${held} ONLY — enters the platform`, async () => {
      assert.equal(await allowed('/', lookup), true)
    })

    it(`${held} ONLY — reaches Overview and personal Settings`, async () => {
      for (const p of ALWAYS_AVAILABLE) {
        assert.equal(await allowed(p, lookup), true, `${p} must stay available`)
      }
    })

    it(`${held} ONLY — reaches every ${held} page and API`, async () => {
      for (const p of surfacesOf(held)) {
        assert.equal(await allowed(p, lookup), true, `${p} must be reachable on a ${held} grant`)
      }
    })

    it(`${held} ONLY — is refused every OTHER module's pages and APIs`, async () => {
      for (const other of APP_MODULE_KEYS) {
        if (other === held) continue
        for (const p of surfacesOf(other)) {
          const d = await outcome(p, lookup)
          assert.equal(d.outcome, 'deny', `${p} must be refused on a ${held}-only grant`)
          assert.equal(
            d.outcome === 'deny' && d.reason,
            'module_not_granted',
            `${p} must be refused as a module denial, not a platform denial`,
          )
        }
      }
    })

    it(`${held} ONLY — is refused every administrator-only surface`, async () => {
      for (const p of ADMIN_ONLY) {
        const d = await outcome(p, lookup)
        assert.equal(d.outcome, 'deny', p)
        assert.equal(d.outcome === 'deny' && d.reason, 'administrator_required', p)
      }
    })
  }

  it('ALL SEVEN — reaches every module surface, and still no admin surface', async () => {
    const everything = memberWith(...APP_MODULE_KEYS)
    for (const p of [...ALL_MODULE_SURFACES, ...ALWAYS_AVAILABLE, FAMILY_ANY]) {
      assert.equal(await allowed(p, everything), true, p)
    }
    for (const p of ADMIN_ONLY) {
      const d = await outcome(p, everything)
      assert.equal(d.outcome, 'deny', `${p} — a full grant set is not a role`)
      assert.equal(d.outcome === 'deny' && d.reason, 'administrator_required', p)
    }
  })

  it('ZERO — is refused everything, at the PLATFORM boundary rather than per module', async () => {
    const none = memberWith()
    for (const p of [...ALL_MODULE_SURFACES, ...ALWAYS_AVAILABLE, ...ADMIN_ONLY, FAMILY_ANY]) {
      const d = await outcome(p, none)
      assert.equal(d.outcome, 'deny', p)
      // The distinction matters to the administrator reading it: "grant them
      // anything" versus "grant them this one thing".
      assert.equal(d.outcome === 'deny' && d.reason, 'no_platform_access', p)
    }
  })

  it('ADMIN WITH ZERO — reaches every surface, module and administrative alike', async () => {
    for (const p of [...ALL_MODULE_SURFACES, ...ALWAYS_AVAILABLE, ...ADMIN_ONLY, FAMILY_ANY]) {
      assert.equal(await allowed(p, admin), true, `${p} must be reachable by role`)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3 · THE FIVE NAMED CROSS-MODULE CASES (§12 "at minimum directly prove")
// ════════════════════════════════════════════════════════════════════════════

describe('the named cross-module denials', () => {
  it('a macro-only member cannot access Markets', async () => {
    const m = memberWith('macro')
    for (const p of surfacesOf('markets')) assert.equal(await allowed(p, m), false, p)
    assert.equal(await allowed('/macro', m), true, 'their own module still works')
  })

  it('a markets-only member cannot access Macro', async () => {
    const m = memberWith('markets')
    for (const p of surfacesOf('macro')) assert.equal(await allowed(p, m), false, p)
    assert.equal(await allowed('/stocks', m), true)
  })

  it('a portfolio-only member cannot access Alternatives', async () => {
    const m = memberWith('portfolio')
    for (const p of surfacesOf('alternatives')) assert.equal(await allowed(p, m), false, p)
    for (const p of surfacesOf('portfolio')) assert.equal(await allowed(p, m), true, p)
  })

  it('an alternatives-only member cannot access personal or main Portfolio', async () => {
    const m = memberWith('alternatives')
    for (const p of surfacesOf('portfolio')) assert.equal(await allowed(p, m), false, p)
    for (const p of surfacesOf('alternatives')) assert.equal(await allowed(p, m), true, p)
    // The one shared entry point stays reachable, or the Alternatives pages
    // could not resolve their own scope list.
    assert.equal(await allowed(FAMILY_ANY, m), true, 'the family scope resolver is shared')
  })

  it('a structured-notes-only member cannot access any unrelated module', async () => {
    const m = memberWith('structured_notes')
    for (const other of APP_MODULE_KEYS) {
      if (other === 'structured_notes') continue
      for (const p of surfacesOf(other)) assert.equal(await allowed(p, m), false, p)
    }
    for (const p of surfacesOf('structured_notes')) assert.equal(await allowed(p, m), true, p)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4 · PORTFOLIO / ALTERNATIVES — THE FOUR COMBINATIONS (§7)
// ════════════════════════════════════════════════════════════════════════════

describe('Portfolio and Alternatives are independent grants', () => {
  const CASES: [string, string[], boolean, boolean][] = [
    ['both', ['portfolio', 'alternatives'], true, true],
    ['portfolio only', ['portfolio'], true, false],
    ['alternatives only', ['alternatives'], false, true],
    ['neither', ['macro'], false, false],
  ]

  for (const [label, grants, portfolioReachable, altReachable] of CASES) {
    it(`${label} — Portfolio ${portfolioReachable ? 'available' : 'denied'}, Alternatives ${altReachable ? 'available' : 'denied'}`, async () => {
      const m = memberWith(...grants)
      for (const p of surfacesOf('portfolio')) {
        assert.equal(await allowed(p, m), portfolioReachable, p)
      }
      for (const p of surfacesOf('alternatives')) {
        assert.equal(await allowed(p, m), altReachable, p)
      }
    })
  }

  it('the family scope resolver follows EITHER module, and neither is enough for the other', async () => {
    assert.equal(await allowed(FAMILY_ANY, memberWith('portfolio')), true)
    assert.equal(await allowed(FAMILY_ANY, memberWith('alternatives')), true)
    assert.equal(await allowed(FAMILY_ANY, memberWith('macro')), false)
  })

  it('the immutable principal ceiling still binds AFTER module authorization', () => {
    // A member who passes the module gate still sees only their own ceiling,
    // and the composition can only ever narrow it. Exhaustive over every
    // principal × every grant subset.
    for (const principal of ['jaime', 'andres', 'pablo'] as const) {
      const entitlement = { isApproved: true, isAdministrator: false, principal }
      const ceiling = scopesFor(entitlement)
      for (let mask = 0; mask < 1 << APP_MODULE_KEYS.length; mask += 1) {
        const grants = APP_MODULE_KEYS.filter((_, i) => (mask >> i) & 1)
        const visible = portfolioVisibleScopes(
          entitlement,
          moduleAccessOf(st({ userId: 'u', approved: true, role: 'member', grants })),
        )
        for (const s of visible) {
          assert.ok(ceiling.includes(s), `${principal} saw ${s}, outside the ceiling`)
        }
        const siblings = (['jaime', 'andres', 'pablo'] as const).filter((x) => x !== principal)
        for (const sib of siblings) {
          assert.ok(!visible.includes(sib), `${principal} reached ${sib}'s personal portfolio`)
        }
      }
    }
  })

  it('no grant set can reach a sibling portfolio through the ROUTE layer either', async () => {
    // The route gate is coarse — `/api/family-portfolio/**` is one module — so
    // the scope check inside each handler is what separates principals. This
    // asserts the layering explicitly: passing the module gate is necessary, and
    // is deliberately NOT sufficient.
    const full = memberWith(...APP_MODULE_KEYS)
    assert.equal(await allowed('/api/family-portfolio/andres/snapshot', full), true,
      'the module gate does not know about principals')
    const handler = read('src/app/api/family-portfolio/[scope]/snapshot/route.ts')
    assert.match(handler, /canReadScope\(entitlement\.input, scope\)/,
      'the handler must still refuse a scope outside the ceiling')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 5 · STRUCTURED NOTES (§8)
// ════════════════════════════════════════════════════════════════════════════

describe('Structured Notes keeps its read/mutate split', () => {
  it('a member holding structured_notes reaches the page and the read API', async () => {
    const m = memberWith('structured_notes')
    assert.equal(await allowed('/structured-notes', m), true)
    assert.equal(await allowed('/api/structured-notes', m), true)
    assert.equal(await allowed('/api/structured-notes/monitoring-status', m), true)
  })

  it('a member without it is refused the route AND the read API', async () => {
    const m = memberWith('macro')
    assert.equal(await allowed('/structured-notes', m), false)
    assert.equal(await allowed('/api/structured-notes', m), false)
  })

  it('mutations stay administrator-only, and a module grant cannot satisfy that', () => {
    // The route gate cannot express "GET yes, POST no" — it is path-based — so
    // the mutation guard stays where POST-R13.6B.1 put it, inside each handler.
    // A grant reaching the path is exactly why that guard must remain.
    for (const f of [
      'src/app/api/structured-notes/extract/route.ts',
      'src/app/api/structured-notes/import/route.ts',
      'src/app/api/structured-notes/[id]/allocations/[allocationId]/route.ts',
    ]) {
      assert.match(read(f), /guardAdministrator\(\)/, `${f} must guard mutations by role`)
    }
    const detail = read('src/app/api/structured-notes/[id]/route.ts')
    assert.match(detail, /guardModuleReadWithCapability\('structured_notes'\)/)
    assert.match(detail, /guardAdministrator\(\)/)
  })

  it('the 6B.1 database policy is untouched by this stage', () => {
    const sql = read('supabase/migrations/20260815000000_sensitive_surface_hardening.sql')
    assert.match(sql, /nmi_can_access_module\('structured_notes'\)/)
    assert.match(sql, /nmi_is_administrator\(\)/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 6 · API DENIALS ARE JSON, PAGE DENIALS ARE REDIRECTS (§6)
// ════════════════════════════════════════════════════════════════════════════

describe('denial shape follows the ROUTE, never the reason', () => {
  it('every module API denial is JSON with a 403 and a distinct reason', async () => {
    const m = memberWith('macro')
    for (const other of APP_MODULE_KEYS) {
      if (other === 'macro') continue
      for (const p of MODULE_APIS[other]) {
        const d = await outcome(p, m)
        assert.equal(d.outcome === 'deny' && d.json, true, `${p} must answer JSON`)
        assert.equal(d.outcome === 'deny' && d.status, 403, p)
      }
    }
  })

  it('every module PAGE denial is a redirect, never JSON', async () => {
    const m = memberWith('macro')
    for (const other of APP_MODULE_KEYS) {
      if (other === 'macro') continue
      for (const p of MODULE_PAGES[other]) {
        const d = await outcome(p, m)
        assert.equal(d.outcome === 'deny' && d.json, false, `${p} must redirect`)
      }
    }
  })

  it('an API is never redirected to the HTML landing page, whatever the reason', async () => {
    const cases: [string, AuthorizationStateLookup][] = [
      ['/api/macro', memberWith('markets')],       // module_not_granted
      ['/api/admin/users', memberWith('markets')], // administrator_required
      ['/api/macro', memberWith()],                // no_platform_access
      ['/api/macro', storeFailed],                 // access_unavailable
    ]
    for (const [p, lookup] of cases) {
      const d = await outcome(p, lookup)
      assert.equal(d.outcome, 'deny', p)
      assert.equal(d.outcome === 'deny' && d.json, true, `${p} must stay JSON`)
    }
    // And the binding honours it: `json` comes from the route class, computed
    // before any reason exists.
    const src = code(read('src/lib/auth/requestAccess.ts'))
    const body = src.slice(src.indexOf('export async function decideRequestAccess'))
    assert.ok(
      body.indexOf('const json = deniesWithJson(pathname)') < body.indexOf('verifyIdentity()'),
      'the route class must be decided before any authorization reasoning',
    )
  })

  it('the six denial reasons are distinct wire codes', () => {
    const codes = [
      ACCESS_DENIED_REASONS.unauthenticated,
      ACCESS_DENIED_REASONS.notApproved,
      ACCESS_DENIED_REASONS.noPlatformAccess,
      ACCESS_DENIED_REASONS.moduleNotGranted,
      ACCESS_DENIED_REASONS.administratorRequired,
      ACCESS_DENIED_REASONS.accessUnavailable,
    ]
    assert.equal(new Set(codes).size, codes.length, 'no two reasons may share a code')
    assert.deepEqual(codes, [
      'unauthenticated',
      'not_authorized',
      'no_platform_access',
      'module_not_granted',
      'administrator_required',
      'module_access_unavailable',
    ])
  })

  it('middleware maps every reason to a code and to a login message', () => {
    const mw = read('src/middleware.ts')
    // Typed `Record<DenialReason, string>`, so a new reason cannot be added
    // without a code — the compiler enforces exhaustiveness here.
    assert.match(mw, /const REASON_TO_CODE: Record<DenialReason, string>/)
    for (const key of ['moduleNotGranted', 'administratorRequired']) {
      assert.ok(mw.includes(`ACCESS_DENIED_REASONS.${key}`), `${key} must be mapped`)
    }
    const login = read('src/app/(auth)/login/page.tsx')
    assert.match(login, /case 'module_not_granted':/)
    assert.match(login, /case 'administrator_required':/)
    for (const lang of ['en', 'es'] as const) {
      const i18n = read('src/lib/i18n.ts')
      assert.ok(i18n.includes('errModuleNotGranted'), `${lang} message missing`)
      assert.ok(i18n.includes('errAdministratorRequired'), `${lang} message missing`)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 7 · FUTURE-MODULE DEFAULT DENY (§11)
// ════════════════════════════════════════════════════════════════════════════

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** `src/app/macro/calendar/page.tsx` → `/macro/calendar`; route groups stripped. */
function fileToRoutePath(absFile: string): string | null {
  const rel = relative(join(ROOT, 'src/app'), absFile).split(sep).join('/')
  if (!/(^|\/)(page|route)\.tsx?$/.test(rel)) return null
  const base = rel.replace(/(^|\/)(page|route)\.tsx?$/, '')
  const segments = base
    .split('/')
    .filter((s) => s.length > 0 && !(s.startsWith('(') && s.endsWith(')')))
  return `/${segments.map((s) => (s.startsWith('[') ? 'x' : s)).join('/')}`
}

const DISCOVERED = [
  ...new Set(
    walk(join(ROOT, 'src/app'))
      .filter((f) => /[/\\](page|route)\.tsx?$/.test(f))
      .map(fileToRoutePath)
      .filter((p): p is string => p !== null),
  ),
].sort()

describe('an unclassified private surface is unreachable', () => {
  it('route discovery is not vacuous', () => {
    assert.ok(DISCOVERED.length >= 60, `found only ${DISCOVERED.length} routes`)
    for (const p of ['/', '/stocks', '/api/macro', '/api/admin/users']) {
      assert.ok(DISCOVERED.includes(p), `discovery missed ${p}`)
    }
  })

  it('EVERY private route the app serves today is deliberately classified', () => {
    // The completeness guard. A private surface left unmapped denies everyone,
    // administrators included — which is the correct default and a terrible
    // surprise, so it must be caught here rather than in production.
    const unmapped = DISCOVERED.filter(
      (p) => requiresApprovedSession(p) && resolvePathModule(p).kind === 'unmapped',
    )
    assert.deepEqual(unmapped, [], `undeclared private surfaces: ${unmapped.join(', ')}`)
  })

  it('a route added later is denied until it is classified — administrators included', async () => {
    for (const p of ['/reports', '/api/reports/summary', '/api/some-new-endpoint', '/settings/billing']) {
      assert.equal(resolvePathModule(p).kind, 'unmapped', p)
      for (const lookup of [memberWith(...APP_MODULE_KEYS), admin]) {
        const d = await outcome(p, lookup)
        assert.equal(d.outcome, 'deny', `${p} must be unreachable until classified`)
      }
    }
  })

  it('a sibling path never inherits a neighbouring module', async () => {
    const everything = memberWith(...APP_MODULE_KEYS)
    for (const p of ['/macrofoo', '/stocksX', '/portfolioZ', '/api/marketing', '/settingsx']) {
      assert.equal(resolvePathModule(p).kind, 'unmapped', p)
      assert.equal(await allowed(p, everything), false, p)
    }
  })

  it('the administrator console is not swallowed by always-available /settings', () => {
    // `/settings/users` sits under a base bound to `always_available`. Without
    // its own entry the longest-base sort would resolve it there and the table
    // would call the administrator console reachable by every member.
    assert.equal(resolvePathModule('/settings').kind, 'always_available')
    assert.equal(resolvePathModule('/settings/users').kind, 'administrator_only')
    assert.equal(resolvePathModule('/settings/notifications').kind, 'administrator_only')
  })

  it('bindingSatisfiedBy denies an unmapped binding for every possible caller', () => {
    for (const access of [
      moduleAccessOf(st({ userId: 'u', approved: true, role: 'administrator', grants: [] })),
      moduleAccessOf(st({ userId: 'u', approved: true, role: 'member', grants: [...APP_MODULE_KEYS] })),
    ]) {
      assert.equal(bindingSatisfiedBy({ kind: 'unmapped' }, access), false)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 8 · THE CONSOLIDATED AUTHORIZATION LOOKUP (§9, §13)
// ════════════════════════════════════════════════════════════════════════════

describe('authorization state — one query, one snapshot', () => {
  it('a private request costs exactly one identity call and one data query', async () => {
    for (const [label, lookup] of [
      ['member, one grant', memberWith('macro')],
      ['member, zero grants', memberWith()],
      ['administrator, zero grants', admin],
    ] as [string, AuthorizationStateLookup][]) {
      let identityCalls = 0
      let queries = 0
      const countingIdentity: IdentityVerifier = async () => {
        identityCalls += 1
        return { user: USER }
      }
      const countingLookup: AuthorizationStateLookup = async (uid) => {
        queries += 1
        return lookup(uid)
      }
      await decideRequestAccess('/macro', countingIdentity, countingLookup)
      assert.equal(identityCalls, 1, `${label}: exactly one verified-auth call`)
      assert.equal(queries, 1, `${label}: exactly one authorization-state query`)
    }
  })

  it('an administrator pays the same one query — no separate grant read exists', async () => {
    // POST-R13.6CDE.1 skipped a SECOND read for administrators. There is no
    // second read to skip now, and § 9 accepts the administrator receiving the
    // joined grant data: removing a round-trip beats micro-optimizing an unused
    // small relation.
    let queries = 0
    const counting: AuthorizationStateLookup = async (uid) => {
      queries += 1
      return admin(uid)
    }
    assert.equal((await decideRequestAccess('/', verified, counting)).outcome, 'allow')
    assert.equal(queries, 1)
  })

  it('no code path issues a second module-grant query', () => {
    for (const f of ['src/middleware.ts', 'src/lib/auth/getModuleAccess.ts']) {
      assert.doesNotMatch(
        code(read(f)),
        /from\('user_module_grants'\)/,
        `${f} must embed the grants, not query them separately`,
      )
      assert.match(read(f), /AUTHORIZATION_STATE_SELECT/, `${f} must use the shared select`)
    }
  })

  it('the one query is explicit-column, own-row, and never service-role', () => {
    assert.doesNotMatch(AUTHORIZATION_STATE_SELECT, /\*/, 'never select *')
    assert.match(AUTHORIZATION_STATE_SELECT, /\busername\b/)
    assert.match(AUTHORIZATION_STATE_SELECT, /\brole\b/)
    assert.match(AUTHORIZATION_STATE_SELECT, /user_module_grants\(module_key\)/)
    for (const f of ['src/middleware.ts', 'src/lib/auth/getModuleAccess.ts']) {
      const src = code(read(f))
      assert.doesNotMatch(src, /getSupabaseAdminClient|SERVICE_ROLE|service_role/, f)
      assert.doesNotMatch(src, /user_metadata/, f)
    }
    assert.match(code(read('src/middleware.ts')), /\.eq\('id', userId\)/)
    assert.match(code(read('src/lib/auth/getModuleAccess.ts')), /\.eq\('id', user\.id\)/)
  })

  it('the embed is backed by a real foreign key, which is what makes it legal', () => {
    // PostgREST can only embed across a declared relationship, and RLS applies
    // to the embedded resource independently — so the join discloses nothing a
    // separate own-row read could not.
    const sql = read('supabase/migrations/20260814000000_module_entitlements.sql')
    assert.match(sql, /user_id\s+uuid\s+not null references public\.user_profiles\(id\)/)
    assert.match(sql, /using \(\(select auth\.uid\(\)\) = user_id\)/)
    assert.match(sql, /grant select on table public\.user_module_grants\s+to authenticated/)
  })
})

describe('parseAuthorizationRow — the fail-closed parse (§13)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: USER.id,
    username: 'member-1',
    role: 'member',
    // R13.6F — an ACTIVE account. The lifecycle columns are authorization inputs
    // now, and a fixture that omitted them would parse as never-activated: every
    // assertion here would still pass, but for the wrong reason.
    invited_at: null,
    activated_at: '2026-01-01T00:00:00.000Z',
    disabled_at: null,
    user_module_grants: [{ module_key: 'macro' }],
    ...over,
  })

  it('a missing profile row is an ANSWER, not a failure', () => {
    for (const v of [null, undefined]) {
      const r = parseAuthorizationRow(USER.id, v)
      assert.equal(r.ok, true)
      assert.equal(r.ok && r.state, null)
    }
  })

  it('an unapproved profile parses, and carries no approval', () => {
    for (const username of [null, '', '   ', 42 as unknown as string]) {
      const r = parseAuthorizationRow(USER.id, row({ username }))
      assert.equal(r.ok && r.state?.approved, false)
    }
  })

  it('an administrator with zero grants parses cleanly', () => {
    const r = parseAuthorizationRow(USER.id, row({ role: 'administrator', user_module_grants: [] }))
    assert.equal(r.ok, true)
    assert.equal(r.ok && r.state?.approved, true)
    assert.deepEqual(r.ok && r.state ? [...r.state.grants] : null, [])
    assert.equal(moduleAccessOf(r.ok && r.state ? r.state : st({ userId: '', approved: false, role: null, grants: [] })).isAdministrator, true)
  })

  it('a member with one grant parses that grant and only that grant', () => {
    const r = parseAuthorizationRow(USER.id, row())
    assert.deepEqual(r.ok && r.state ? [...r.state.grants] : null, ['macro'])
  })

  it('a member with zero grants is approved and holds nothing', () => {
    const r = parseAuthorizationRow(USER.id, row({ user_module_grants: [] }))
    assert.equal(r.ok && r.state?.approved, true)
    assert.deepEqual(r.ok && r.state ? [...r.state.grants] : null, [])
  })

  it('a MISSING grant relation is a failure, never an empty grant set', () => {
    // This is the property that keeps a database-behind-its-code from looking
    // identical to a deliberate denial. PostgREST errors when the relation is
    // absent; if it ever returned the parent row without the embed, the absent
    // key must still refuse rather than be read as "holds nothing".
    for (const bad of [undefined, null, 'nope', 42, {}]) {
      const r = parseAuthorizationRow(USER.id, row({ user_module_grants: bad }))
      assert.equal(r.ok, false, `embed ${JSON.stringify(bad)} must be a failure`)
      assert.ok(!('state' in r), 'a failure carries no state to be mistaken for an answer')
    }
  })

  it('…and the DECISION it produces is 503, not a 403 blaming the member', async () => {
    // The consequence, asserted end to end through the real decision. Reading a
    // missing relation as "holds nothing" would answer `no_platform_access` —
    // telling a correctly-provisioned member their administrator had revoked
    // everything, when the truth is that this deployment's database is behind
    // its code. Same refusal, completely different thing to go and fix.
    const throughParse: AuthorizationStateLookup = async (uid) =>
      parseAuthorizationRow(uid, {
        id: uid,
        username: 'member-1',
        role: 'member',
        // The un-migrated shape: the parent row arrives, the embed does not.
      })
    for (const p of ['/', '/macro', '/api/macro']) {
      const d = await outcome(p, throughParse)
      assert.equal(d.outcome, 'deny', p)
      assert.equal(d.outcome === 'deny' && d.reason, 'access_unavailable', p)
      assert.equal(d.outcome === 'deny' && d.status, 503, p)
      assert.notEqual(d.outcome === 'deny' && d.reason, 'no_platform_access', p)
    }
  })

  it('the parse has no branch that answers with a state on a non-array embed', () => {
    const src = code(read('src/lib/auth/authorizationState.ts'))
    const fn = src.slice(src.indexOf('export function parseAuthorizationRow'))
    const guard = fn.indexOf('Array.isArray(embedded)')
    assert.ok(guard > 0, 'the embed shape must be checked')
    // Between the guard and the end of that line there must be a failure, and
    // no state construction.
    const branch = fn.slice(guard, fn.indexOf('\n', guard) + 1)
    assert.match(branch, /\{ ok: false \}/)
    assert.doesNotMatch(branch, /state:/)
  })

  it('a malformed grant ROW is dropped, which can only ever reduce access', () => {
    const r = parseAuthorizationRow(
      USER.id,
      row({ user_module_grants: [{ module_key: 'macro' }, {}, null, 42, { module_key: '' }, { module_key: 7 }] }),
    )
    assert.equal(r.ok, true)
    assert.deepEqual(r.ok && r.state ? [...r.state.grants] : null, ['macro'])
  })

  it('a non-string role is null, so it can never be administrator', () => {
    for (const role of [null, undefined, 7, {}, ['administrator']]) {
      const r = parseAuthorizationRow(USER.id, row({ role }))
      assert.equal(r.ok && r.state?.role, null)
      assert.equal(
        moduleAccessOf(r.ok && r.state ? r.state : st({ userId: '', approved: false, role: null, grants: [] })).isAdministrator,
        false,
      )
    }
  })

  it('an unapproved state is never administrator, whatever the role column says', () => {
    const access = moduleAccessOf(st({ userId: 'u', approved: false, role: 'administrator', grants: [] }))
    assert.equal(access.isAdministrator, false)
  })

  it('a store failure denies every caller, at 503, with no permissive fallback', async () => {
    for (const p of ['/', '/settings', '/macro', '/api/macro', '/api/admin/users']) {
      const d = await outcome(p, storeFailed)
      assert.equal(d.outcome, 'deny', p)
      assert.equal(d.outcome === 'deny' && d.reason, 'access_unavailable', p)
      assert.equal(d.outcome === 'deny' && d.status, 503, p)
    }
  })

  it('a store failure and an empty grant set stay distinguishable', async () => {
    const failed = await outcome('/macro', storeFailed)
    const empty = await outcome('/macro', memberWith())
    assert.notDeepEqual(failed, empty)
    assert.equal(failed.outcome === 'deny' && failed.status, 503)
    assert.equal(empty.outcome === 'deny' && empty.status, 403)
  })

  it('the parse module is pure — no framework, Supabase or environment import', () => {
    assert.doesNotMatch(
      read('src/lib/auth/authorizationState.ts'),
      /from 'next|@supabase|process\.env/,
    )
  })

  it('no lookup is issued at all for an unverified caller', async () => {
    let queries = 0
    const counting: AuthorizationStateLookup = async (uid) => {
      queries += 1
      return admin(uid)
    }
    await decideRequestAccess('/api/macro', rejected, counting)
    assert.equal(queries, 0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 9 · OVERVIEW COMPOSITION FOLLOWS THE SAME RULE (§4)
// ════════════════════════════════════════════════════════════════════════════

describe('Overview stays available and filters its own content', () => {
  it('Overview and Settings are always-available, never grantable modules', () => {
    assert.equal(resolvePathModule('/').kind, 'always_available')
    assert.equal(resolvePathModule('/settings').kind, 'always_available')
    assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes('overview'))
    assert.ok(!(APP_MODULE_KEYS as readonly string[]).includes('settings'))
  })

  it('the Overview portfolio card follows the `portfolio` module alone', () => {
    // It reads /api/family-portfolio/overview/<scope>, which serves main and the
    // three personal scopes and 404s on `alternatives` — so an alternatives-only
    // member could never populate it, and must not request it.
    const page = code(read('src/app/page.tsx'))
    assert.match(page, /const canPortfolio = can\('portfolio'\)\s*$/m)
    assert.doesNotMatch(page, /can\('portfolio'\) \|\| can\('alternatives'\)/)
    const route = read('src/app/api/family-portfolio/overview/[scope]/route.ts')
    assert.match(route, /isMain && !isPersonal/, 'the route serves main and personal scopes only')
  })

  it('a member reaching Overview never issues a request for a module they lack', () => {
    // Every module-scoped fetch on the page is gated on the access snapshot, so
    // the denial is avoided rather than absorbed.
    const page = code(read('src/app/page.tsx'))
    for (const guard of ['!accessReady || !canPortfolio', '!accessReady || !canNotes', '!accessReady || !canMarkets']) {
      assert.ok(page.includes(guard), `missing fetch guard: ${guard}`)
    }
  })
})
