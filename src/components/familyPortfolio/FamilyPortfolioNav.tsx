'use client'

// R13.6 — Family Portfolio module navigation (doc 08 Stage 6; doc 05 § 7.2):
// `Overview · Portfolio · Weekly Changes · Alternatives · Admin`.
//
// Items are derived from the SERVER-FILTERED entitlement in
// FamilyPortfolioProvider — the browser never holds a scope it was not
// granted, so there is nothing here to "hide". `Admin` follows the
// administrator flag as a presentation convenience only: `/family-portfolio/
// admin` and every `/api/family-portfolio/admin/*` endpoint reject a
// non-administrator server-side regardless of what this renders.
//
// Same pill language and measured sliding indicator as the app's
// primary/secondary rails (`useNavIndicator`) — one visual system, no second
// invention. The rail scrolls internally on narrow viewports; it never widens
// the page.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { useNavIndicator } from '@/components/layout/useNavIndicator'
import { useFamilyPortfolio } from './FamilyPortfolioProvider'

interface ModuleNavItem {
  key: string
  href: string
  label: string
}

export function FamilyPortfolioNav() {
  const pathname = usePathname()
  const { t, lang } = useLang()
  const { status, scopes, isAdministrator } = useFamilyPortfolio()

  const hasPortfolioScope = scopes.some((s) => s.id !== 'alternatives')
  const hasAlternatives = scopes.some((s) => s.id === 'alternatives')

  const items: ModuleNavItem[] = []
  if (scopes.length > 0) {
    items.push({ key: 'overview', href: '/family-portfolio', label: t.fp.navOverview })
  }
  if (hasPortfolioScope) {
    items.push({ key: 'portfolio', href: '/family-portfolio/portfolio', label: t.fp.navPortfolio })
    items.push({
      key: 'weekly-changes',
      href: '/family-portfolio/weekly-changes',
      label: t.fp.navWeeklyChanges,
    })
  }
  if (hasAlternatives) {
    items.push({
      key: 'alternatives',
      href: '/family-portfolio/alternatives',
      label: t.fp.navAlternatives,
    })
  }
  if (isAdministrator) {
    items.push({ key: 'admin', href: '/family-portfolio/admin', label: t.fp.navAdmin })
  }

  // Longest-prefix match so /family-portfolio (Overview) does not stay active
  // on every child route.
  const activeKey =
    items
      .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.key ?? null

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
