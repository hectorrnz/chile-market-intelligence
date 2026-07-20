'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { navItems } from '@/lib/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { useAuthDisplay } from '@/lib/auth/useAuthDisplay'
import { useSidebar } from '@/components/providers/SidebarProvider'

// Minimal stroke-based SVG icons — no icon library
function NavIcon({ name }: { name: string }) {
  const icons: Record<string, React.ReactNode> = {
    home: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9.5L10 3l7 6.5V17a.5.5 0 01-.5.5H13v-4.5h-6V17.5H3.5A.5.5 0 013 17V9.5z" />
      </svg>
    ),
    chart: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 14l4.5-5 3 3L14 6l4 4" />
        <path strokeLinecap="round" d="M2 17h16" />
      </svg>
    ),
    trending: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 13l4-5 3 3 4-5.5 3 2.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 7h4v4" />
      </svg>
    ),
    document: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 2.5h7l3.5 3.5V17a.5.5 0 01-.5.5h-10A.5.5 0 014.5 17V3a.5.5 0 01.5-.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2.5V6.5H16" />
        <path strokeLinecap="round" d="M7 10h6M7 13h4" />
      </svg>
    ),
    star: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 2l2 5.5h5.5l-4.5 3.5 1.5 5.5L10 13.5 5.5 16.5 7 11 2.5 7.5H8L10 2z" />
      </svg>
    ),
    compare: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <rect x="3" y="4" width="5" height="12" rx="1" />
        <rect x="12" y="8" width="5" height="8" rx="1" />
      </svg>
    ),
    gf: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" d="M3 17h14" />
        <rect x="4" y="10" width="2.5" height="5" rx="0.5" />
        <rect x="8.75" y="7" width="2.5" height="8" rx="0.5" />
        <rect x="13.5" y="12" width="2.5" height="3" rx="0.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7l5-3 4 2 4-3" />
      </svg>
    ),
    portfolio: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.5a1.5 1.5 0 011.5-1.5h11a1.5 1.5 0 011.5 1.5V15a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15V6.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 5V4a1 1 0 011-1h4a1 1 0 011 1v1" />
        <path strokeLinecap="round" d="M3 9.5h14" />
      </svg>
    ),
    notes: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3.5h7l3 3V16a1 1 0 01-1 1H5a1 1 0 01-1-1V4.5a1 1 0 011-1z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5V6a1 1 0 001 1h2" />
        <path strokeLinecap="round" d="M6.5 10.5h7M6.5 13h5" />
      </svg>
    ),
  }
  return <>{icons[name] ?? null}</>
}

const MACRO_REGIONS: { rg: 'CL' | 'US'; label: string }[] = [
  { rg: 'CL', label: 'Chile' },
  { rg: 'US', label: 'US' },
]

export function Sidebar() {
  const pathname = usePathname()
  const { t } = useLang()
  const { name: displayName, ready: authReady } = useAuthDisplay()
  const { collapsed } = useSidebar()
  const onMacro = pathname.startsWith('/macro')
  const [macroOpen, setMacroOpen] = useState(onMacro)
  const [macroRegion, setMacroRegion] = usePersistentState<'CL' | 'US'>('cmi.macroRegion', 'CL')

  // Auto-expand the Macro accordion when navigating onto a macro route (render-time).
  const [prevOnMacro, setPrevOnMacro] = useState(onMacro)
  if (onMacro !== prevOnMacro) { setPrevOnMacro(onMacro); if (onMacro) setMacroOpen(true) }

  const selectRegion = (rg: 'CL' | 'US') => {
    setMacroRegion(rg)
    window.dispatchEvent(new CustomEvent('macro:region', { detail: rg }))
    setMacroOpen(true)
  }

  // Collapsed: hide the sidebar entirely; the TopBar hamburger brings it back.
  if (collapsed) return null

  return (
    <aside
      className="no-print w-52 shrink-0 h-full flex flex-col"
      style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-fg)', borderRight: '1px solid var(--sidebar-border)' }}
    >
      {/* Brand */}
      <div
        className="h-14 shrink-0 flex flex-col justify-center px-4"
        style={{ borderBottom: '1px solid var(--sidebar-border)' }}
      >
        <div
          className="text-sm font-mono font-semibold tracking-wider uppercase"
          style={{ color: 'var(--sidebar-accent)' }}
        >
          NMI
        </div>
        <div className="text-xs mt-0.5 leading-tight" style={{ color: 'var(--sidebar-muted)' }}>
          Nevada Market Intelligence
        </div>
        {displayName && (
          <div
            className="text-xs mt-1 leading-tight truncate"
            style={{ color: 'var(--sidebar-accent)' }}
            title={displayName}
          >
            {displayName}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {navItems.map((item) => {
          const isActive = item.key === 'home' ? pathname === '/' : pathname.startsWith(item.href)
          const label = t.nav[item.key]

          // Macro is an expandable item with a Chile / US sub-menu
          if (item.key === 'macro') {
            return (
              <div key={item.href}>
                <div
                  className="flex items-center border-l-2 transition-colors hover:bg-[var(--sidebar-active)]"
                  style={isActive
                    ? { borderLeftColor: 'var(--sidebar-accent)', backgroundColor: 'var(--sidebar-active)', color: 'var(--sidebar-fg)' }
                    : { borderLeftColor: 'transparent', color: 'var(--sidebar-muted)' }}
                >
                  <Link href="/macro" onClick={() => setMacroOpen(true)} className="flex-1 flex items-center gap-2.5 py-2 pl-3.5 pr-2 text-xs">
                    <span style={{ color: isActive ? 'var(--sidebar-accent)' : 'currentColor' }}><NavIcon name={item.icon} /></span>
                    <span>{label}</span>
                  </Link>
                  <button onClick={() => setMacroOpen(o => !o)} className="px-2.5 self-stretch flex items-center" aria-label="Toggle macro regions" style={{ color: 'var(--sidebar-muted)' }}>
                    <span style={{ display: 'inline-block', transform: macroOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s', fontSize: '10px' }}>▸</span>
                  </button>
                </div>
                {macroOpen && (
                  <div className="pb-1">
                    {MACRO_REGIONS.map(({ rg, label: rl }) => {
                      const active = onMacro && macroRegion === rg
                      return (
                        <Link key={rg} href="/macro" onClick={() => selectRegion(rg)}
                          className="flex items-center gap-2 py-1.5 pl-10 pr-4 text-xs border-l-2 transition-colors hover:bg-[var(--sidebar-active)] hover:text-[var(--sidebar-fg)]"
                          style={active
                            ? { borderLeftColor: 'var(--sidebar-accent)', backgroundColor: 'var(--sidebar-active)', color: 'var(--sidebar-fg)' }
                            : { borderLeftColor: 'transparent', color: 'var(--sidebar-muted)' }}>
                          <span className="inline-block w-1 h-1 rounded-full" style={{ backgroundColor: active ? 'var(--sidebar-accent)' : 'var(--sidebar-muted)' }} />
                          {rl}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          return (
            <Link
              key={item.href}
              href={item.soon ? '#' : item.href}
              aria-current={isActive ? 'page' : undefined}
              style={
                isActive
                  ? { borderLeftColor: 'var(--sidebar-accent)', backgroundColor: 'var(--sidebar-active)', color: 'var(--sidebar-fg)' }
                  : { borderLeftColor: 'transparent', color: 'var(--sidebar-muted)' }
              }
              className={[
                'flex items-center gap-2.5 py-2 pl-3.5 pr-4 text-xs border-l-2 transition-colors',
                item.soon ? 'opacity-40 pointer-events-none' : 'hover:bg-[var(--sidebar-active)] hover:text-[var(--sidebar-fg)]',
              ].join(' ')}
            >
              <span style={{ color: isActive ? 'var(--sidebar-accent)' : 'currentColor' }}>
                <NavIcon name={item.icon} />
              </span>
              <span>{label}</span>
              {item.soon && (
                <span className="ml-auto text-xs" style={{ color: 'var(--sidebar-muted)' }}>
                  {t.nav.soon}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{
          borderTop: '1px solid var(--sidebar-border)',
          color: 'var(--sidebar-muted)',
        }}
      >
        <span className="text-xs font-mono">v0.1.0 · mvp</span>
        {authReady && (
          displayName ? (
            <a
              href="/logout"
              className="text-xs hover:text-[var(--sidebar-fg)] transition-colors"
              style={{ color: 'var(--sidebar-muted)' }}
            >
              {t.auth.signOut}
            </a>
          ) : (
            <Link
              href="/login"
              className="text-xs hover:text-[var(--sidebar-fg)] transition-colors"
              style={{ color: 'var(--sidebar-muted)' }}
            >
              {t.auth.signIn}
            </Link>
          )
        )}
      </div>
    </aside>
  )
}
