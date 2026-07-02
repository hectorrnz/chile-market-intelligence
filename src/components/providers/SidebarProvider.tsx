'use client'

// Phase 6C — Sidebar collapse state, shared across TopBar (toggle) and Sidebar.
// Persisted so the user's choice sticks across sessions.

import { createContext, useContext } from 'react'
import { usePersistentState } from '@/lib/usePersistentState'

type SidebarCtx = { collapsed: boolean; toggle: () => void; setCollapsed: (v: boolean) => void }

const Ctx = createContext<SidebarCtx | null>(null)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = usePersistentState<boolean>('cmi.sidebarCollapsed', false)
  return (
    <Ctx.Provider value={{ collapsed, toggle: () => setCollapsed(!collapsed), setCollapsed }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSidebar(): SidebarCtx {
  const ctx = useContext(Ctx)
  if (!ctx) return { collapsed: false, toggle: () => {}, setCollapsed: () => {} }
  return ctx
}
