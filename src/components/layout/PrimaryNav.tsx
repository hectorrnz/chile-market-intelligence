'use client'

// Fable Phase 2 — the desktop top pill rail (glass sliding-indicator nav).
// Text-only pills, matching the Fable reference (icons are reserved for the
// mobile drawer, where they aid scanning a longer vertical list). Hidden
// below `lg`; the mobile drawer is the equivalent below that breakpoint.
//
// The rail itself scrolls horizontally within its own container rather than
// wrapping or forcing the page wider — Fable's own spec calls the pill rail
// "horizontally scrollable, scrollbar hidden" even at desktop widths, which
// is what keeps 8 groups usable at 1024/1280px without page-level overflow.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { navGroups, resolveActiveGroup } from '@/lib/navigation'
import { useNavIndicator } from './useNavIndicator'

export function PrimaryNav() {
  const pathname = usePathname()
  const { t, lang } = useLang()
  const activeGroup = resolveActiveGroup(pathname)
  const { railRef, setItemRef, rect } = useNavIndicator(activeGroup?.key ?? null, `${pathname}|${lang}`)

  return (
    <nav
      aria-label={t.common.primaryNav}
      ref={railRef as React.RefObject<HTMLElement>}
      className="hidden lg:flex relative items-center gap-0.5 min-w-0 flex-1 rounded-full pl-1 pr-2.5 py-1 overflow-x-auto nv-scrollbar-hidden"
      style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
    >
      {rect && (
        <span
          aria-hidden
          className="absolute top-1 left-0 bottom-1 rounded-full nv-indicator"
          style={{ transform: `translateX(${rect.left}px)`, width: rect.width, backgroundColor: 'var(--surface)' }}
        />
      )}
      {navGroups.map((group) => {
        const active = activeGroup?.key === group.key
        return (
          <Link
            key={group.key}
            href={group.href}
            ref={setItemRef(group.key) as React.Ref<HTMLAnchorElement>}
            aria-current={active ? 'page' : undefined}
            className="relative z-10 shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs nv-transition"
            style={{ color: active ? 'var(--foreground)' : 'var(--muted-fg)', fontWeight: active ? 600 : 500 }}
          >
            {group.label(t)}
          </Link>
        )
      })}
    </nav>
  )
}
