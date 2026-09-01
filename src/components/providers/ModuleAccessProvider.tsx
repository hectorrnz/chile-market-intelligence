'use client'

// POST-R13.6CDE — one shared, app-wide snapshot of the caller's own access.
//
// Mounted once in `AppShell`, above the router outlet, exactly like
// `MarketDataProvider` and `MacroDataProvider`. Navigation, the Overview
// composition and the Settings entry all read it, so they cannot disagree with
// each other and the app makes ONE entitlement request per load rather than one
// per surface.
//
// PRESENTATION, NEVER PROTECTION. This decides what the browser DRAWS. Every
// route handler re-derives authorization from the database on its own request,
// with PostgreSQL RLS underneath — see `effectiveAccess.ts` for the full note.
//
// WHY IT STARTS CLOSED. `NO_ACCESS` until the fetch resolves, so the first paint
// shows Overview and Settings rather than every module briefly. Optimistically
// rendering the full navigation and retracting it a moment later would flash
// modules the caller may not reach, which is both a poor experience and a small
// information leak about what the product contains.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchEffectiveAccess } from '@/lib/data/effectiveAccess'
import { NO_ACCESS, hasModule, type EffectiveAccess } from '@/lib/auth/effectiveAccess'
import type { ModuleKey } from '@/lib/auth/moduleAccess'

export interface ModuleAccessContextValue {
  access: EffectiveAccess
  /** False until the first resolution completes. */
  ready: boolean
  /** True when the caller may reach `module`. False while still loading. */
  can: (module: ModuleKey) => boolean
}

const FALLBACK: ModuleAccessContextValue = {
  access: NO_ACCESS,
  ready: false,
  can: () => false,
}

const Ctx = createContext<ModuleAccessContextValue>(FALLBACK)

/**
 * The caller's access snapshot.
 *
 * Safe to call from a component rendered outside the provider — it returns the
 * closed fallback rather than throwing, so a surface that is ever mounted
 * without the shell degrades to showing less, not to crashing.
 */
export function useModuleAccess(): ModuleAccessContextValue {
  return useContext(Ctx)
}

export function ModuleAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<EffectiveAccess>(NO_ACCESS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void (async () => {
      const next = await fetchEffectiveAccess(controller.signal)
      if (cancelled) return
      setAccess(next)
      setReady(true)
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  return (
    <Ctx.Provider value={{ access, ready, can: (m) => hasModule(access, m) }}>
      {children}
    </Ctx.Provider>
  )
}
