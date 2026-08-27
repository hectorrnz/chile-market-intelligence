'use client'

// R13.R4A — one Alternatives fetch for the whole sub-module.
//
// Dashboard, Holdings and Cash Flows are three ROUTES over ONE publication.
// Mounted in `alternatives/layout.tsx`, this provider fetches that publication
// once per module entry and holds it across sub-navigation, so moving between
// the three tabs re-renders instantly instead of re-issuing an identical
// `no-store` request and flashing a loading state on every click.
//
// This is the SAME pattern `FamilyPortfolioProvider` (R13.6) established one
// level up for the scopes response, and the same reasoning behind
// `MarketDataProvider`: state a route change would otherwise discard belongs
// above the router outlet, not inside a page.
//
// NO FINANCIAL LOGIC LIVES HERE. The provider transports the API's payload
// verbatim — every group, summary and subtotal in it was derived server-side
// by `alternativesView.ts`, and a page that narrows by filter re-runs those
// same pure functions. Nothing is recomputed, reshaped or defaulted on the way
// through; in particular a missing figure stays missing and never becomes 0.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  fetchFamilyPortfolioAlternatives,
  type FamilyPortfolioAlternativesResponse,
} from '@/lib/data/familyPortfolio'
import { EMPTY_FILTER, type AlternativesFilter } from '@/lib/familyPortfolio/alternativesView'

/** Resolution state of the single fetch. `denied` is a 403, kept distinct from a transport error. */
export type AlternativesOutcome = 'loading' | 'ready' | 'denied' | 'error'

interface AlternativesContextValue {
  outcome: AlternativesOutcome
  data: FamilyPortfolioAlternativesResponse | null
  /**
   * The sociedad / category / currency / event-type narrowing, SHARED by the
   * Holdings and Cash Flows views so drilling into one sociedad survives a tab
   * change — the workflow the split into three views exists to serve.
   *
   * The DASHBOARD deliberately ignores it: it is the book-level overview, and a
   * filtered overview presented as the whole book would misstate the position.
   * Both views that honour the filter keep their controls visible, so a narrowed
   * result is never a mystery.
   */
  filter: AlternativesFilter
  setFilter: (next: AlternativesFilter | ((prev: AlternativesFilter) => AlternativesFilter)) => void
}

const AlternativesContext = createContext<AlternativesContextValue>({
  outcome: 'loading',
  data: null,
  filter: EMPTY_FILTER,
  setFilter: () => {},
})

export function AlternativesProvider({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<AlternativesOutcome>('loading')
  const [data, setData] = useState<FamilyPortfolioAlternativesResponse | null>(null)
  const [filter, setFilter] = useState<AlternativesFilter>(EMPTY_FILTER)

  useEffect(() => {
    let cancelled = false
    fetchFamilyPortfolioAlternatives().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setData(result.data)
        setOutcome('ready')
      } else {
        // A 403 is an authorization ANSWER, not a failure to get one — the two
        // render different honest states and must never collapse together.
        setOutcome(result.status === 403 ? 'denied' : 'error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({ outcome, data, filter, setFilter }),
    [outcome, data, filter],
  )
  return <AlternativesContext.Provider value={value}>{children}</AlternativesContext.Provider>
}

export function useAlternatives(): AlternativesContextValue {
  return useContext(AlternativesContext)
}
