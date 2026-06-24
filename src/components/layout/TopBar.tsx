'use client'

import { usePathname } from 'next/navigation'
import { getPageTitle } from '@/lib/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LangToggle } from '@/components/ui/LangToggle'

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
      className="no-print h-10 shrink-0 flex items-center justify-between px-6"
      style={{
        backgroundColor: 'var(--topbar)',
        borderBottom: '1px solid var(--topbar-border)',
        color: 'var(--topbar-fg)',
      }}
    >
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-fg uppercase tracking-wide">CMI</span>
        <span className="text-muted-fg text-xs">/</span>
        <span className="text-xs text-foreground font-medium">{title}</span>
      </div>

      {/* Right: search + toggles + date + status */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.dispatchEvent(new Event('cmdk:open'))}
          className="flex items-center gap-2 h-6 px-2 rounded border border-border bg-surface-2 text-xs text-muted-fg hover:text-foreground hover:border-accent transition-colors"
          title={t.common.search}
        >
          <span>⌕</span>
          <span className="hidden md:inline">{t.common.searchBtn}</span>
          <kbd className="border border-border rounded px-1 ml-1">⌘K</kbd>
        </button>
        <LangToggle />
        <ThemeToggle />
        <span className="text-xs text-muted-fg font-mono tabular-nums">{today}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-fg">
          <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
          {t.topbar.mvp}
        </span>
      </div>
    </header>
  )
}
