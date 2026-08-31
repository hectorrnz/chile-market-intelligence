import type { Lang, Translation } from '@/lib/i18n'

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
