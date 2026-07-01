'use client'

import { usePathname } from 'next/navigation'
import { getPageTitle } from '@/lib/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LangToggle } from '@/components/ui/LangToggle'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { AuthStatus } from '@/components/ui/AuthStatus'

export function TopBar() {
  const pathname = usePathname()
  const { lang, t } = useLang()
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
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2.5 shrink-0">
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
        <AuthStatus />
        <LangToggle />
        <ThemeToggle />
        <span className="text-sm text-muted-fg font-mono tabular-nums">{today}</span>
        <span className="flex items-center gap-1.5 text-sm text-muted-fg">
          <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
          {t.topbar.mvp}
        </span>
      </div>
    </header>
  )
}
