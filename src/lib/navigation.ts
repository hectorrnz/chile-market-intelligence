import type { Lang, Translation } from '@/lib/i18n'
// Relative, with an explicit extension: this is a VALUE import, and
// `tests/usersAccessIntegration.test.ts` loads this module directly under Node's
// native test runner, which does not resolve the `@/` alias. (The `i18n` import
// above is type-only and therefore erased, so it may keep the alias.) Same
// convention as the news provider modules — see CLAUDE.md.
import type { ModuleKey } from './auth/moduleAccess.ts'
import { hasModule, portfolioLandingHref, type EffectiveAccess } from './auth/effectiveAccess.ts'

// Fable Phase 2 — top pill navigation model. Routes are organized into 8
// primary groups; a group with more than one destination exposes them via a
// contextual secondary pill row (see SecondaryNav) and the mobile drawer.
// Every existing NMI route stays reachable — this file only changes how
// routes are grouped/labeled for navigation, never which routes exist.

export type NavGroupKey =
  | 'overview'
  | 'markets'
  | 'analysis'
  | 'macro'
  | 'earnings'
  | 'portfolio'
  | 'structuredNotes'
  | 'settings'

export interface NavChild {
  key: string
  href: string
  /** Extra path prefixes that should also count as "this child is active" — e.g. a dynamic detail route with no nav entry of its own. */
  matchPrefixes?: string[]
  label: (t: Translation) => string
}

export interface NavGroup {
  key: NavGroupKey
  /** Primary destination — used as the group pill's own link. */
  href: string
  /**
   * Extra path prefixes that resolve to this group for active-state and page
   * title, WITHOUT becoming a navigable destination. R13.R1 § 2 uses this to
   * retire the legacy `/portfolio` module from navigation while keeping the
   * route itself reachable and correctly titled until a later cleanup stage.
   */
  matchPrefixes?: string[]
  icon: string
  label: (t: Translation) => string
  children?: NavChild[]
  /**
   * The module a caller must hold to SEE this group (POST-R13.6CDE).
   *
   * Absent means always visible to an approved account — true of exactly two
   * groups, Overview and Settings, both of which are deliberately not module
   * keys (see `moduleAccess.ts`). Overview stays visible but must omit content
   * belonging to modules the caller cannot reach; Settings is personal account
   * infrastructure.
   *
   * `portfolio` is the one group whose visibility is not a single key: it is a
   * FAMILY of destinations behind two independently-grantable modules, so it
   * declares neither and is resolved by `visibleNavGroups` instead.
   */
  module?: ModuleKey
}

export const navGroups: NavGroup[] = [
  {
    key: 'overview',
    href: '/',
    icon: 'home',
    label: (t) => t.nav.overview,
  },
  {
    key: 'markets',
    module: 'markets',
    href: '/stocks',
    icon: 'chart',
    label: (t) => t.nav.markets,
    children: [
      { key: 'stocks', href: '/stocks', matchPrefixes: ['/companies'], label: (t) => t.nav.stocks },
      { key: 'watchlist', href: '/watchlist', label: (t) => t.nav.watchlist },
    ],
  },
  {
    key: 'analysis',
    module: 'analysis',
    href: '/compare',
    icon: 'compare',
    label: (t) => t.nav.analysis,
    children: [
      { key: 'compare', href: '/compare', label: (t) => t.nav.compare },
      { key: 'charting', href: '/chart-builder', label: (t) => t.nav.charting },
    ],
  },
  {
    key: 'macro',
    module: 'macro',
    href: '/macro',
    icon: 'trending',
    label: (t) => t.nav.macro,
    children: [
      { key: 'macroIndicators', href: '/macro', label: (t) => t.nav.macroIndicators },
      { key: 'macroCalendar', href: '/macro/calendar', label: (t) => t.nav.macroCalendar },
    ],
  },
  {
    key: 'earnings',
    module: 'earnings',
    href: '/earnings',
    icon: 'document',
    label: (t) => t.nav.earnings,
  },
  {
    // POST-R13.5 — the R13 Portfolio module now OWNS `/portfolio`. R13.R1 § 2
    // pointed this item at `/family-portfolio` and kept `matchPrefixes:
    // ['/portfolio']` only so a bookmarked legacy-tracker URL still resolved to
    // the right title; the tracker is retired and the released product answers
    // that path directly, so the prefix is redundant and the href is canonical.
    // The old `/family-portfolio/*` URLs redirect (see `next.config.ts`) —
    // nothing in navigation names them.
    key: 'portfolio',
    href: '/portfolio',
    icon: 'portfolio',
    label: (t) => t.nav.portfolio,
  },
  {
    key: 'structuredNotes',
    module: 'structured_notes',
    href: '/structured-notes',
    icon: 'notes',
    label: (t) => t.nav.structuredNotes,
  },
  {
    // R9.2 — /settings is the canonical destination. `matchesPrefix` keeps
    // /settings/notifications resolving to this same group, so its active-nav
    // state and page title are unchanged.
    key: 'settings',
    href: '/settings',
    icon: 'settings',
    label: (t) => t.nav.settings,
  },
]

/**
 * The nav groups a caller may SEE, with the Portfolio group's href resolved to a
 * destination they can actually reach (POST-R13.6CDE).
 *
 * NAVIGATION HIDING IS NOT SECURITY, and nothing here pretends otherwise. Every
 * route and API re-derives its own answer server-side, with PostgreSQL RLS
 * underneath. This exists so the product does not advertise modules the caller
 * cannot open — a pill that 403s on click is worse than no pill.
 *
 * PORTFOLIO IS A FAMILY, NOT A DESTINATION. `portfolio` and `alternatives` are
 * independently grantable, so the group appears when EITHER is held, and its
 * href points at the first destination the caller may reach. A member holding
 * only `alternatives` therefore still has a coherent route to it, instead of a
 * Portfolio pill that lands on a personal-portfolio page and denies them.
 * Dropping the group whenever `portfolio` was absent would have made
 * `alternatives` silently useless on its own, contradicting the module split.
 *
 * Returns a NEW array of new group objects — `navGroups` itself is never
 * mutated, so a second caller with different access is unaffected.
 */
export function visibleNavGroups(access: EffectiveAccess): NavGroup[] {
  const out: NavGroup[] = []
  for (const group of navGroups) {
    if (group.key === 'portfolio') {
      const href = portfolioLandingHref(access)
      if (href) out.push({ ...group, href })
      continue
    }
    // No declared module means always-available (Overview, Settings).
    if (!group.module || hasModule(access, group.module)) out.push(group)
  }
  return out
}

/** The Macro group's Chile/US region sub-control — shared by SecondaryNav and MobileNavDrawer. */
export const MACRO_REGIONS: { rg: 'CL' | 'US'; label: string }[] = [
  { rg: 'CL', label: 'Chile' },
  { rg: 'US', label: 'US' },
]

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/'
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/** All path candidates a group is reachable from — its own href plus every child's href/matchPrefixes. */
function groupCandidates(group: NavGroup): string[] {
  const childHrefs = group.children?.flatMap((c) => [c.href, ...(c.matchPrefixes ?? [])]) ?? []
  return [group.href, ...(group.matchPrefixes ?? []), ...childHrefs]
}

/** Resolves which top-level nav group a pathname belongs to (longest-prefix match wins). */
export function resolveActiveGroup(pathname: string): NavGroup | undefined {
  let best: { group: NavGroup; len: number } | undefined
  for (const group of navGroups) {
    for (const href of groupCandidates(group)) {
      if (matchesPrefix(pathname, href) && href.length > (best?.len ?? -1)) {
        best = { group, len: href.length }
      }
    }
  }
  return best?.group
}

/** Resolves which child of a group a pathname belongs to (longest-prefix match wins). Undefined if the group has no children or none match. */
export function resolveActiveChild(pathname: string, group: NavGroup | undefined): NavChild | undefined {
  if (!group?.children) return undefined
  let best: { child: NavChild; len: number } | undefined
  for (const child of group.children) {
    for (const href of [child.href, ...(child.matchPrefixes ?? [])]) {
      if (matchesPrefix(pathname, href) && href.length > (best?.len ?? -1)) {
        best = { child, len: href.length }
      }
    }
  }
  return best?.child
}

export function getPageTitle(pathname: string, _lang: Lang, t: Translation): string {
  if (pathname.startsWith('/companies/')) {
    const ticker = pathname.split('/')[2]?.toUpperCase()
    return ticker ? `${t.stocks.tag} · ${ticker}` : t.stocks.tag
  }
  const group = resolveActiveGroup(pathname)
  if (!group) return 'Nevada Market Intelligence'
  const child = resolveActiveChild(pathname, group)
  return child ? child.label(t) : group.label(t)
}
