'use client'

// 2026-07-20 — Platform-wide live market snapshot.
//
// Previously each page (Home, Stocks, Company, Portfolio) held its own local
// `useState<LiveSnapshot | null>`, populated only when that page's own Update
// button was clicked. Next.js unmounts a page component on route change, so
// that state — and the "Live" badge it drove — was lost the moment the user
// navigated away, even seconds after a successful refresh. Clicking Update
// only ever updated the one open tab, never the rest of the app.
//
// This provider is mounted once in AppShell, above the router outlet, so it
// survives client-side navigation. `refresh()` is the single fetch every
// page's Update button now calls — one click updates every page that reads
// `live` from `useMarketData()`, and the result keeps showing "Live" no
// matter which tab is open next.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { fetchLiveSnapshot, type LiveSnapshot } from '@/lib/data/marketLiveData'

interface MarketDataContextValue {
  live: LiveSnapshot | null
  refreshing: boolean
  /** Fetches a fresh snapshot and updates `live` for every consumer. Safe to
   *  call from multiple pages concurrently — a refresh already in flight is
   *  reused rather than duplicated. */
  refresh: () => Promise<void>
}

const MarketDataContext = createContext<MarketDataContextValue | null>(null)

export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState<LiveSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current
    setRefreshing(true)
    const p = fetchLiveSnapshot()
      .then((data) => {
        if (!data) throw new Error('live snapshot unavailable')
        setLive(data)
      })
      .finally(() => {
        setRefreshing(false)
        inFlight.current = null
      })
    inFlight.current = p
    return p
  }, [])

  // Auto-fetch once when the app first loads, so a page opened later in the
  // session (without ever clicking Update) can still show "Live" immediately
  // rather than falling back to "Persisted"/"Static".
  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  return (
    <MarketDataContext.Provider value={{ live, refreshing, refresh }}>
      {children}
    </MarketDataContext.Provider>
  )
}

export function useMarketData(): MarketDataContextValue {
  const ctx = useContext(MarketDataContext)
  if (!ctx) throw new Error('useMarketData must be used within MarketDataProvider')
  return ctx
}
