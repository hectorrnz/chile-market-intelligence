'use client'

// Fable Phase 2 — replaces SidebarProvider. The shell no longer has a
// collapsible desktop column (the primary nav is a top pill rail that is
// always visible at lg+), so the only state left to own is whether the
// mobile navigation drawer is open. Plain (non-persisted) state — a drawer
// should never restore open on load.
//
// `returnFocusRef` captures the element focused at the moment the drawer
// opens (the hamburger button) so MobileNavDrawer can restore focus to it
// when the drawer closes — required for accessible modal-drawer behavior.

import { createContext, useContext, useRef, useState } from 'react'

type MobileNavCtx = {
  open: boolean
  openNav: () => void
  closeNav: () => void
  toggleNav: () => void
  returnFocusRef: React.MutableRefObject<HTMLElement | null>
}

const Ctx = createContext<MobileNavCtx | null>(null)

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const openNav = () => {
    if (typeof document !== 'undefined') {
      returnFocusRef.current = document.activeElement as HTMLElement | null
    }
    setOpen(true)
  }
  const closeNav = () => setOpen(false)
  const toggleNav = () => (open ? closeNav() : openNav())

  return (
    <Ctx.Provider value={{ open, openNav, closeNav, toggleNav, returnFocusRef }}>
      {children}
    </Ctx.Provider>
  )
}

export function useMobileNav(): MobileNavCtx {
  const ctx = useContext(Ctx)
  if (!ctx) {
    return { open: false, openNav: () => {}, closeNav: () => {}, toggleNav: () => {}, returnFocusRef: { current: null } }
  }
  return ctx
}
