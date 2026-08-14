'use client'

// R13.6 — module-level entitlement context for the Family Portfolio shell.
//
// PRESENTATION, NEVER PROTECTION (doc 05 § 2.1 layer 4). This provider holds
// what /api/family-portfolio/scopes returned for THIS caller — the server
// already omitted every unentitled scope, so nothing here filters anything.
// The navigation and the pages render from it; every data request behind them
// is independently re-authorized server-side, and PostgreSQL RLS re-derives
// the same verdict again. A caller who tampers with this state changes only
// what their own browser draws.
//
// One fetch per module entry: the layout mounts this once, so the nav and the
// page share a single scopes request instead of racing two.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  fetchFamilyPortfolioScopes,
  type FamilyPortfolioScopeInfo,
} from '@/lib/data/familyPortfolio'

export type FamilyPortfolioStatus = 'loading' | 'ready' | 'denied' | 'error'

export interface FamilyPortfolioContextValue {
  status: FamilyPortfolioStatus
  /** The caller's entitled data scopes, server-filtered. Empty when denied. */
  scopes: FamilyPortfolioScopeInfo[]
  isAdministrator: boolean
}

const FamilyPortfolioContext = createContext<FamilyPortfolioContextValue>({
  status: 'loading',
  scopes: [],
  isAdministrator: false,
})

export function useFamilyPortfolio(): FamilyPortfolioContextValue {
  return useContext(FamilyPortfolioContext)
}

export function FamilyPortfolioProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<FamilyPortfolioContextValue>({
    status: 'loading',
    scopes: [],
    isAdministrator: false,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const result = await fetchFamilyPortfolioScopes()
      if (cancelled) return
      if (!result.ok) {
        // 401 = not an approved session (middleware normally intercepts the
        // page first, so this is a belt-and-braces state); anything else is a
        // genuine error, reported as such rather than shown as "no access".
        setValue({
          status: result.status === 401 || result.status === 403 ? 'denied' : 'error',
          scopes: [],
          isAdministrator: false,
        })
        return
      }
      setValue({
        status: 'ready',
        scopes: result.data.scopes,
        isAdministrator: result.data.isAdministrator === true,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <FamilyPortfolioContext.Provider value={value}>{children}</FamilyPortfolioContext.Provider>
  )
}
