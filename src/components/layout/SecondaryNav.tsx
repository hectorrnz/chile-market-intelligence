'use client'

// Fable Phase 2 — contextual secondary pill row. Rendered only when the
// active primary group has more than one destination (Markets, Analysis,
// Macro). Also hosts the Macro Chile/US region control, migrated verbatim
// from the old Sidebar accordion: same persisted key (`cmi.macroRegion`),
// same `macro:region` window event, so the Macro page's own listener needs
// no change.
//
// Desktop-only (`hidden lg:flex`) — below `lg` the mobile drawer lists every
// group's children directly, so there is no separate secondary row to show.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/components/providers/LangProvider'
import { usePersistentState } from '@/lib/usePersistentState'
import { MACRO_REGIONS, resolveActiveChild, resolveActiveGroup } from '@/lib/navigation'
import { useNavIndicator } from './useNavIndicator'

export function SecondaryNav() {
  const pathname = usePathname()
  const { t, lang } = useLang()
  const group = resolveActiveGroup(pathname)
  const activeChild = resolveActiveChild(pathname, group)
  const [macroRegion, setMacroRegion] = usePersistentState<'CL' | 'US'>('cmi.macroRegion', 'CL')
  const { railRef, setItemRef, rect } = useNavIndicator(activeChild?.key ?? null, `${pathname}|${lang}`)

  if (!group?.children) return null

  const selectRegion = (rg: 'CL' | 'US') => {
    setMacroRegion(rg)
    window.dispatchEvent(new CustomEvent('macro:region', { detail: rg }))
  }

  return (
    <div
      className="no-print hidden lg:flex px-3 sm:px-6 py-2 nv-glass-nav"
      style={{ borderBottom: '1px solid var(--nv-line)' }}
    >
      {/* Same --content-max-w cap as TopBar and <main> — one gutter line. */}
      <div className="flex items-center gap-4 w-full max-w-(--content-max-w) mx-auto min-w-0">
      {/* Same containment rule as the primary rail: the child pills scroll
          inside their own region rather than pushing the region control off
          the row or widening the page. */}
      <nav aria-label={group.label(t)} ref={railRef as React.RefObject<HTMLElement>} className="relative flex items-center gap-0.5 min-w-0 overflow-x-auto nv-scrollbar-hidden">
        {rect && (
          <span
            aria-hidden
            className="absolute top-0 left-0 bottom-0 rounded-full nv-indicator"
            style={{ transform: `translateX(${rect.left}px)`, width: rect.width, backgroundColor: 'var(--selected)' }}
          />
        )}
        {group.children.map((child) => {
          const active = activeChild?.key === child.key
          return (
            <Link
              key={child.key}
              href={child.href}
              ref={setItemRef(child.key) as React.Ref<HTMLAnchorElement>}
              aria-current={active ? 'page' : undefined}
              className="relative z-10 shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-xs nv-transition"
              style={{ color: active ? 'var(--foreground)' : 'var(--muted-fg)', fontWeight: active ? 600 : 500 }}
            >
              {child.label(t)}
            </Link>
          )
        })}
      </nav>

      {group.key === 'macro' && (
        <div
          role="group"
          aria-label={t.common.macroRegion}
          className="flex items-center gap-0.5 ml-auto shrink-0 rounded-full p-0.5"
          style={{ backgroundColor: 'var(--surface-2)' }}
        >
          {MACRO_REGIONS.map(({ rg, label }) => (
            <button
              key={rg}
              type="button"
              onClick={() => selectRegion(rg)}
              aria-pressed={macroRegion === rg}
              className="px-2.5 py-1 rounded-full text-xs nv-transition"
              style={
                macroRegion === rg
                  ? { backgroundColor: 'var(--surface)', color: 'var(--foreground)', fontWeight: 600 }
                  : { color: 'var(--muted-fg)' }
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
