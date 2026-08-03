'use client'

// Fable Phase 2 — accessible mobile navigation drawer (below `lg`). Replaces
// the old Sidebar mobile overlay, and adds everything that overlay was
// missing: Escape-to-close, a focus trap, focus restored to the hamburger
// trigger on close, and a body-scroll lock while open. Closes on backdrop
// click and on navigation, same as before.
//
// Every group's children are always shown (no accordion) so every
// destination is reachable in a single drawer open, per the requirement that
// no destination sit behind multiple interactions. The Macro Chile/US region
// control is included here too, writing the same persisted key and
// dispatching the same window event as SecondaryNav/the old Sidebar.
//
// R7.1A — the drawer surface is the shared Tier-5 `nv-glass-overlay`, whose
// blurred fill is now the near-opaque `--nv-overlay-fill` (≥ .92 alpha, both
// themes): page headings/values must never remain readable through the open
// drawer. Layering follows the documented scale in globals.css (drawer +
// scrim at z-[80], above the un-z-indexed header and all page content, below
// the z-[90] dialogs and z-[100] palette). The username lives in a dedicated
// identity section at the drawer foot — see the comment there.

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { useAuthDisplay } from '@/lib/auth/useAuthDisplay'
import { useEscape } from '@/lib/useEscape'
import { useMobileNav } from '@/components/providers/MobileNavProvider'
import { MACRO_REGIONS, navGroups, resolveActiveChild, resolveActiveGroup } from '@/lib/navigation'
import { NavIcon } from './NavIcon'
import { NevadaMark } from '@/components/ui/NevadaMark'

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled])'

export function MobileNavDrawer() {
  const pathname = usePathname()
  const { t } = useLang()
  const { open, closeNav, returnFocusRef } = useMobileNav()
  const { name: displayName, ready: authReady } = useAuthDisplay()
  const [macroRegion, setMacroRegion] = usePersistentState<'CL' | 'US'>('cmi.macroRegion', 'CL')
  const drawerRef = useRef<HTMLDivElement>(null)
  const wasOpenRef = useRef(open)

  const activeGroup = resolveActiveGroup(pathname)
  const activeChild = resolveActiveChild(pathname, activeGroup)

  useEscape(open, closeNav)

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // Focus the first focusable element on open, and trap Tab/Shift+Tab inside
  // the drawer while it's open.
  useEffect(() => {
    if (!open) return
    const container = drawerRef.current
    if (!container) return
    const getFocusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const focusId = setTimeout(() => getFocusable()[0]?.focus(), 0)
    function onKeydown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    container.addEventListener('keydown', onKeydown)
    return () => {
      clearTimeout(focusId)
      container.removeEventListener('keydown', onKeydown)
    }
  }, [open])

  // Restore focus to whatever triggered the drawer (the hamburger button)
  // once it closes.
  useEffect(() => {
    if (wasOpenRef.current && !open) returnFocusRef.current?.focus()
    wasOpenRef.current = open
  }, [open, returnFocusRef])

  const selectRegion = (rg: 'CL' | 'US') => {
    setMacroRegion(rg)
    window.dispatchEvent(new CustomEvent('macro:region', { detail: rg }))
  }

  if (!open) return null

  return (
    <div className="no-print fixed inset-0 z-[80] lg:hidden">
      <div className="nv-scrim absolute inset-0" onClick={closeNav} aria-hidden="true" />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.common.mobileNav}
        className="nv-glass-overlay nv-slide-in absolute inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col overflow-y-auto rounded-none"
      >
        <div className="h-14 shrink-0 flex items-center gap-2 px-4" style={{ borderBottom: '1px solid var(--nv-line)' }}>
          <NevadaMark variant="symbol" size={26} alt="" />
          <span className="text-sm font-medium text-foreground truncate">Inversiones Nevada</span>
          <button
            type="button"
            onClick={closeNav}
            aria-label={t.common.closeMenu}
            title={t.common.closeMenu}
            className="ml-auto shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-muted-fg hover:text-foreground hover:bg-surface-2 nv-transition"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <nav aria-label={t.common.primaryNav} className="flex-1 py-2">
          {navGroups.map((group) => {
            const groupActive = activeGroup?.key === group.key
            return (
              <div key={group.key}>
                <Link
                  href={group.href}
                  onClick={closeNav}
                  aria-current={groupActive ? 'page' : undefined}
                  className="flex items-center gap-3 min-h-11 px-4 text-sm nv-transition"
                  style={
                    groupActive
                      ? { color: 'var(--foreground)', fontWeight: 600, backgroundColor: 'var(--selected)' }
                      : { color: 'var(--muted-fg)' }
                  }
                >
                  <NavIcon name={group.icon} />
                  <span>{group.label(t)}</span>
                </Link>

                {group.children && (
                  <div className="pb-1">
                    {group.children.map((child) => {
                      const childActive = activeChild?.key === child.key
                      return (
                        <Link
                          key={child.key}
                          href={child.href}
                          onClick={closeNav}
                          aria-current={childActive ? 'page' : undefined}
                          className="flex items-center gap-2 min-h-11 pl-11 pr-4 text-sm nv-transition"
                          style={childActive ? { color: 'var(--foreground)', fontWeight: 600 } : { color: 'var(--muted-fg)' }}
                        >
                          <span
                            className="inline-block w-1 h-1 rounded-full shrink-0"
                            style={{ backgroundColor: childActive ? 'var(--accent)' : 'var(--muted-fg)' }}
                          />
                          {child.label(t)}
                        </Link>
                      )
                    })}

                    {group.key === 'macro' && (
                      <div role="group" aria-label={t.common.macroRegion} className="flex items-center gap-1 pl-11 pr-4 py-1">
                        {MACRO_REGIONS.map(({ rg, label }) => (
                          <button
                            key={rg}
                            type="button"
                            onClick={() => selectRegion(rg)}
                            aria-pressed={macroRegion === rg}
                            className="min-h-9 px-2.5 rounded-full text-xs nv-transition"
                            style={
                              macroRegion === rg
                                ? { backgroundColor: 'var(--surface-2)', color: 'var(--foreground)', fontWeight: 600 }
                                : { color: 'var(--muted-fg)' }
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* R7.1A — dedicated identity section. The pre-R7.1A drawer squeezed
            the username into a one-line truncating strip under the drawer
            header (hard to read, and — on the old translucent surface — it
            visually blended with page text underneath). It now has its own
            block: an eyebrow label, the username allowed to wrap to two lines
            (full value always available via title), and sign-out as a
            visually distinct chip on its own row. The divider is the block's
            top border only — it never crosses text. */}
        <div className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid var(--nv-line)' }}>
          {authReady &&
            (displayName ? (
              <div className="min-w-0 space-y-2">
                <div className="min-w-0">
                  <div className="ui-micro-label text-muted-fg">{t.auth.signedInAs}</div>
                  <div className="text-sm font-medium text-foreground break-words line-clamp-2" title={displayName}>
                    {displayName}
                  </div>
                </div>
                <a
                  href="/logout"
                  className="inline-flex items-center h-8 px-3 rounded-full text-xs text-muted-fg hover:text-foreground nv-transition"
                  style={{ backgroundColor: 'var(--nv-chip)', border: '1px solid var(--nv-chipbd)' }}
                >
                  {t.auth.signOut}
                </a>
              </div>
            ) : (
              <Link href="/login" onClick={closeNav} className="text-xs text-muted-fg hover:text-foreground nv-transition">
                {t.auth.signIn}
              </Link>
            ))}
        </div>
      </div>
    </div>
  )
}
