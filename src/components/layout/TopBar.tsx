'use client'

import { usePathname } from 'next/navigation'
import { getPageTitle } from '@/lib/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LangToggle } from '@/components/ui/LangToggle'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { NotificationBell } from '@/components/ui/NotificationBell'
import { useSidebar } from '@/components/providers/SidebarProvider'

export function TopBar() {
  const pathname = usePathname()
  const { lang, t } = useLang()
  const { collapsed, toggle } = useSidebar()
  const title = getPageTitle(pathname, lang, t)

  const today = new Date().toLocaleDateString(lang === 'es' ? 'es-CL' : 'en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  return (
    <header
      className="no-print h-14 shrink-0 flex items-center gap-4 px-6"
      style={{
        backgroundColor: 'var(--topbar)',
        borderBottom: '1px solid var(--topbar-border)',
        color: 'var(--topbar-fg)',
      }}
    >
      {/* Left: sidebar toggle + breadcrumb */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          onClick={toggle}
          className="shrink-0 flex items-center justify-center w-8 h-8 -ml-1 rounded-md text-muted-fg hover:text-foreground hover:bg-surface-2 transition-colors"
          aria-label={collapsed ? t.common.showSidebar : t.common.hideSidebar}
          title={collapsed ? t.common.showSidebar : t.common.hideSidebar}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
            <path strokeLinecap="round" d="M3 5.5h14M3 10h14M3 14.5h14" />
          </svg>
        </button>
        <BrandLogo className="h-9 w-auto shrink-0" />
        <span className="text-sm font-mono text-muted-fg uppercase tracking-wide">NMI</span>
        <span className="text-muted-fg text-sm">/</span>
        <span className="text-sm text-foreground font-medium">{title}</span>
      </div>

      {/* Center: wide search field */}
      <div className="flex-1 flex justify-center">
        <button
          onClick={() => window.dispatchEvent(new Event('cmdk:open'))}
          className="w-full max-w-2xl flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-surface-2 text-sm text-muted-fg hover:text-foreground hover:border-accent transition-colors"
          title={t.common.search}
        >
          <span>⌕</span>
          <span>{t.common.search}</span>
          <kbd className="border border-border rounded px-1.5 ml-auto text-xs">⌘K</kbd>
        </button>
      </div>

      {/* Right: toggles + date + status */}
      <div className="flex items-center gap-3 shrink-0">
        <NotificationBell />
        <LangToggle />
        <ThemeToggle />
        <span className="text-sm text-muted-fg font-mono tabular-nums">{today}</span>
      </div>
    </header>
  )
}
