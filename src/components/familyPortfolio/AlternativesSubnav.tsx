'use client'

// R13.R4A — the Alternatives sub-navigation: `Dashboard · Holdings · Cash Flows`.
//
// SAME VISUAL SYSTEM AS EVERY OTHER RAIL IN THE APP. Pills with a measured
// sliding indicator via `useNavIndicator` — the identical mechanism behind the
// primary rail, the Family Portfolio module rail and `SegmentedControl`. No
// second navigation language is introduced for a sub-level.
//
// R13.R4A visual pass — CONTAINED, NOT OPEN. The module rail above this one is
// an OPEN rail (bare pills on the page surface). Rendering the sub-level in
// the identical open dress made two same-weight rails stack, competing for the
// same reading. This rail therefore wears the system's CONTAINED variant — the
// `SegmentedControl` recipe: a chip-material track (`--nv-chip` /
// `--nv-chipbd`), a `--surface` sliding indicator, short pills — which the
// app already uses everywhere a control is subordinate to the page around it.
// Same mechanism, same tokens, same motion; only the tier differs. R13.R4A.1
// gives the pills a half-step more padding than the bare control recipe
// (px-3.5 / py-1.5): these are NAVIGATION targets hit on every visit, not a
// setting toggled once, so they earn the larger hit area while keeping the
// contained dress.
//
// REAL ROUTES, NOT IN-PAGE TABS. Each view is its own URL, so it is
// linkable, bookmarkable, and reachable by the back button — the standing
// "canonical routes stay canonical" rule. The parent rail's longest-prefix
// match already keeps `Alternatives` highlighted on every child route, so the
// two levels compose without either needing to know about the other.
//
// The rail scrolls internally on narrow viewports and never widens the page,
// matching `FamilyPortfolioNav`.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { useNavIndicator } from '@/components/layout/useNavIndicator'
import {
  ALTERNATIVES_CASH_FLOWS,
  ALTERNATIVES_HOLDINGS,
  ALTERNATIVES_ROOT,
} from '@/lib/familyPortfolio/alternativesRoutes'

export function AlternativesSubnav() {
  const pathname = usePathname()
  const { t, lang } = useLang()
  const a = t.fp.alternatives

  const items = [
    { key: 'dashboard', href: ALTERNATIVES_ROOT, label: a.navDashboard },
    { key: 'holdings', href: ALTERNATIVES_HOLDINGS, label: a.navHoldings },
    { key: 'cash-flows', href: ALTERNATIVES_CASH_FLOWS, label: a.navCashFlows },
  ]

  // Longest-prefix match, so the Dashboard (the bare root) does not stay active
  // on its own children.
  const activeKey =
    items
      .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
      .sort((x, y) => y.href.length - x.href.length)[0]?.key ?? 'dashboard'

  const { railRef, setItemRef, rect } = useNavIndicator(activeKey, `${pathname}|${lang}`)

  return (
    <nav
      aria-label={a.subnavLabel}
      ref={railRef as React.RefObject<HTMLElement>}
      className="no-print relative inline-flex max-w-full items-center gap-0.5 rounded-full p-0.5 overflow-x-auto nv-scrollbar-hidden"
      style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
    >
      {rect && (
        <span
          aria-hidden
          className="absolute top-0.5 left-0 bottom-0.5 rounded-full nv-indicator"
          style={{
            transform: `translateX(${rect.left}px)`,
            width: rect.width,
            backgroundColor: 'var(--surface)',
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
            className="relative z-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs nv-transition"
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
