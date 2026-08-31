'use client'

// R13.6 — Family Portfolio module navigation (doc 08 Stage 6; doc 05 § 7.2):
// `Overview · Portfolio · Weekly Changes · Alternatives · Admin`.
//
// Items are derived from the SERVER-FILTERED entitlement in
// FamilyPortfolioProvider — the browser never holds a scope it was not
// granted, so there is nothing here to "hide". `Admin` follows the
// administrator flag as a presentation convenience only: `/portfolio/admin`
// and every `/api/family-portfolio/admin/*` endpoint reject a
// non-administrator server-side regardless of what this renders.
//
// Same pill language and measured sliding indicator as the app's
// primary/secondary rails (`useNavIndicator`) — one visual system, no second
// invention. The rail scrolls internally on narrow viewports; it never widens
// the page.
//
// R13.R5C.4 — THE RAIL CARRIES THE SELECTED SCOPE. Overview, Portfolio and
// Weekly Changes all read `?scope=` from the URL, so linking to a bare path
// silently dropped the reader's choice and each landed on the caller's first
// scope: selecting Andrés on Summary and clicking Weekly Changes opened MAIN
// Weekly Changes. The rail now appends the same parameter those pages already
// read — the existing mechanism carried forward, not a second one.
//
// Alternatives and Admin never receive it: Alternatives is a SHARED
// publication and Admin is a console, and forcing a personal scope onto either
// would claim a filter neither has.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { useNavIndicator } from '@/components/layout/useNavIndicator'
import { ALTERNATIVES_ROOT } from '@/lib/familyPortfolio/alternativesRoutes'
import {
  ALTERNATIVES_SCOPE,
  PORTFOLIO_ADMIN,
  PORTFOLIO_HOLDINGS,
  PORTFOLIO_SUMMARY,
  PORTFOLIO_WEEKLY_CHANGES,
  SCOPE_PARAM,
  scopeHref,
  selectedScope,
} from '@/lib/familyPortfolio/portfolioScopeRoutes'
import { useFamilyPortfolio } from './FamilyPortfolioProvider'

interface ModuleNavItem {
  key: string
  /** The route itself — what the ACTIVE-state match reads. Never carries a query. */
  path: string
  /** What the link navigates to: `path`, plus the selected scope where one applies. */
  href: string
  label: string
}

export function FamilyPortfolioNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { t, lang } = useLang()
  const { status, scopes, isAdministrator } = useFamilyPortfolio()

  const hasPortfolioScope = scopes.some((s) => s.id !== ALTERNATIVES_SCOPE)
  const hasAlternatives = scopes.some((s) => s.id === ALTERNATIVES_SCOPE)

  // The reader's EXPLICIT, entitled choice, or null. Resolved against the same
  // server-granted list the pages use, so a hand-typed `?scope=` for a
  // portfolio this caller was not granted is dropped here and never linked on.
  // On Alternatives and Admin there is no `?scope=` to read, so this is null
  // and the rail links to bare paths exactly as it did before.
  const scope = selectedScope(searchParams.get(SCOPE_PARAM), scopes)

  const items: ModuleNavItem[] = []
  const scoped = (key: string, path: string, label: string): ModuleNavItem => ({
    key,
    path,
    href: scopeHref(path, scope),
    label,
  })
  const shared = (key: string, path: string, label: string): ModuleNavItem => ({
    key,
    path,
    href: path,
    label,
  })

  if (scopes.length > 0) {
    items.push(scoped('overview', PORTFOLIO_SUMMARY, t.fp.navOverview))
  }
  if (hasPortfolioScope) {
    items.push(scoped('portfolio', PORTFOLIO_HOLDINGS, t.fp.navPortfolio))
    items.push(scoped('weekly-changes', PORTFOLIO_WEEKLY_CHANGES, t.fp.navWeeklyChanges))
  }
  if (hasAlternatives) {
    items.push(shared('alternatives', ALTERNATIVES_ROOT, t.fp.navAlternatives))
  }
  if (isAdministrator) {
    items.push(shared('admin', PORTFOLIO_ADMIN, t.fp.navAdmin))
  }

  // Longest-prefix match so /portfolio (Overview) does not stay active
  // on every child route. Matched on `path`, never `href`: `usePathname()`
  // carries no query string, so comparing it against a scoped href would leave
  // every pill inactive the moment a scope was selected.
  const activeKey =
    items
      .filter((i) => pathname === i.path || pathname.startsWith(`${i.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0]?.key ?? null

  const { railRef, setItemRef, rect } = useNavIndicator(activeKey, `${pathname}|${lang}|${items.length}`)

  if (status !== 'ready' || items.length === 0) return null

  return (
    <nav
      aria-label={t.fp.navLabel}
      ref={railRef as React.RefObject<HTMLElement>}
      className="no-print relative flex items-center gap-0.5 mb-4 min-w-0 overflow-x-auto nv-scrollbar-hidden"
    >
      {rect && (
        <span
          aria-hidden
          className="absolute top-0 left-0 bottom-0 rounded-full nv-indicator"
          style={{
            transform: `translateX(${rect.left}px)`,
            width: rect.width,
            backgroundColor: 'var(--selected)',
          }}
        />
      )}
      {items.map((item) => {
        const active = item.key === activeKey
        return (
          <Link
            key={item.key}
            href={item.href}
            ref={setItemRef(item.key) as React.Ref<HTMLAnchorElement>}
            aria-current={active ? 'page' : undefined}
            className="relative z-10 shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs nv-transition"
            style={{
              color: active ? 'var(--foreground)' : 'var(--muted-fg)',
              fontWeight: active ? 600 : 500,
            }}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
