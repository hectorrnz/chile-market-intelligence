'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getPageTitle } from '@/lib/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LangToggle } from '@/components/ui/LangToggle'
import { NevadaMark } from '@/components/ui/NevadaMark'
import { NotificationBell } from '@/components/ui/NotificationBell'
import { useAuthDisplay } from '@/lib/auth/useAuthDisplay'
import { useMobileNav } from '@/components/providers/MobileNavProvider'
import { PrimaryNav } from './PrimaryNav'

export function TopBar() {
  const pathname = usePathname()
  const { lang, t } = useLang()
  const { open, toggleNav } = useMobileNav()
  const { name: displayName, ready: authReady } = useAuthDisplay()
  const title = getPageTitle(pathname, lang, t)

  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  return (
    <header
      className="no-print min-h-14 shrink-0 flex px-3 sm:px-6 nv-glass-nav"
      style={{ borderBottom: '1px solid var(--nv-line)', color: 'var(--topbar-fg)' }}
    >
      {/* The same --content-max-w cap that governs <main> (AppShell) — header
          content and page content must share one gutter line above the cap.
          `flex-wrap` is what keeps the three regions from competing: the pill
          rail carries `basis-full`, so wherever it is visible it occupies its
          own line at full content width (Fable's two-row header) instead of
          being squeezed to a few pixels between the brand and the utilities.
          The header height follows intrinsically — `min-h-14` when the rail is
          hidden (below `lg`), taller once it wraps onto its own line. */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-3 py-2 w-full max-w-(--content-max-w) mx-auto min-w-0">
      {/* Left: mobile-nav trigger + brand + contextual title. `basis-0 grow`
          keeps its hypothetical size at zero so it can never force the utility
          cluster onto a second line; it grows into whatever the utilities
          leave and the page title truncates inside it. */}
      <div className="flex items-center gap-2.5 shrink min-w-0 grow basis-0">
        <button
          type="button"
          onClick={toggleNav}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="lg:hidden shrink-0 flex items-center justify-center w-9 h-9 -ml-1 rounded-md text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition"
          aria-label={open ? t.common.closeMenu : t.common.openMenu}
          title={open ? t.common.closeMenu : t.common.openMenu}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
            <path strokeLinecap="round" d="M3 5.5h14M3 10h14M3 14.5h14" />
          </svg>
        </button>

        <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="Inversiones Nevada">
          <NevadaMark variant="symbol" size={28} alt="" className="hidden sm:inline-block" />
          <span className="text-sm font-medium text-foreground whitespace-nowrap hidden md:inline">Inversiones Nevada</span>
        </Link>
        <span className="text-muted-fg text-sm hidden md:inline">/</span>
        <span className="text-sm text-foreground font-medium truncate">{title}</span>
      </div>

      {/* Right: search + icon controls + date + auth. The date and full
          brand text are the first to go on narrow viewports. */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('cmdk:open'))}
          className="flex items-center gap-2 h-9 px-2.5 sm:px-3 rounded-full text-sm text-muted-fg hover:text-foreground nv-transition"
          style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
          title={t.common.search}
        >
          <span>⌕</span>
          <span className="truncate hidden md:inline">{t.common.search}</span>
          <kbd className="border border-border rounded px-1.5 text-xs hidden xl:inline">⌘K</kbd>
        </button>

        <NotificationBell />
        <LangToggle />
        <ThemeToggle />

        <span className="text-sm text-muted-fg font-mono tabular-nums hidden xl:inline">{today}</span>

        {authReady &&
          (displayName ? (
            <div className="hidden lg:flex items-center gap-2 shrink-0 pl-2.5" style={{ borderLeft: '1px solid var(--nv-line)' }}>
              <span className="text-xs text-muted-fg truncate max-w-[120px]" title={displayName}>
                {displayName}
              </span>
              <a href="/logout" className="text-xs text-muted-fg hover:text-foreground nv-transition whitespace-nowrap">
                {t.auth.signOut}
              </a>
            </div>
          ) : (
            <Link
              href="/login"
              className="hidden lg:inline text-xs text-muted-fg hover:text-foreground nv-transition shrink-0 pl-2.5"
              style={{ borderLeft: '1px solid var(--nv-line)' }}
            >
              {t.auth.signIn}
            </Link>
          ))}
      </div>

      {/* The desktop pill rail, last in DOM order because it renders on its
          own line beneath the brand/utility row — visual order and tab order
          therefore agree. Hidden below `lg`, where the mobile drawer is the
          equivalent navigation surface. */}
      <PrimaryNav />
      </div>
    </header>
  )
}
