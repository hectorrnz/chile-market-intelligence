'use client'

// Phase 6C — Sidebar collapse state, shared across TopBar (toggle) and Sidebar.
// Persisted so the user's choice sticks across sessions.
//
// Responsive audit 2026-07-21: below the lg breakpoint the sidebar no longer
// renders as a static column (it ate 208px of a phone viewport). Instead the
// TopBar hamburger opens it as an overlay drawer via `mobileOpen` — plain
// (non-persisted) state, since a drawer should never restore open on load.
// `toggle` is viewport-aware at click time: ≥lg flips the persisted collapse,
// <lg flips the drawer. matchMedia is only read inside the handler, so there
// is no SSR/hydration divergence.

import { createContext, useContext, useState } from 'react'
import { usePersistentState } from '@/lib/usePersistentState'

type SidebarCtx = {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (v: boolean) => void
  mobileOpen: boolean
  closeMobile: () => void
}

const Ctx = createContext<SidebarCtx | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = usePersistentState<boolean>('cmi.sidebarCollapsed', false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const toggle = () => {
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
    if (isDesktop) setCollapsed(!collapsed)
    else setMobileOpen(o => !o)
  }
  return (
    <Ctx.Provider value={{ collapsed, toggle, setCollapsed, mobileOpen, closeMobile: () => setMobileOpen(false) }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSidebar(): SidebarCtx {
  const ctx = useContext(Ctx)
  if (!ctx) return { collapsed: false, toggle: () => {}, setCollapsed: () => {}, mobileOpen: false, closeMobile: () => {} }
  return ctx
}
