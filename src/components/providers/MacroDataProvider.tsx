'use client'

// 2026-07-20 — Platform-wide live macro overlay, mirroring MarketDataProvider.
//
// Home's macro (Chile/US bands), Chilean Rates, and FX panels each read live
// BCCh/FRED indicators from a page-local `useState`, refetched from scratch
// on every mount. Next.js unmounts the Home page on route change, so
// navigating away and back always starts from a blank map and the default
// 'static' status — even moments after a successful Update showed "Live".
// Reported as: "some tables still show 'static' after they show 'live'
// whenever I update and come back to this tab" — the exact same class of
// bug already fixed for the Yahoo market snapshot (see MarketDataProvider).
//
// Mounted once in AppShell, above the router outlet, so it survives
// client-side navigation. `refresh()` is the one function Home's Update
// button calls for macro data; the CL/US split (never merged into one status)
// matches the original comment on Home's macro overlay — BCCh only ever
// covers Chile, so a shared status would misstate US freshness.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { fetchMacroIndicators } from '@/lib/data/macro'
import type { MacroIndicator } from '@/types'
import type { DataSourceStatus } from '@/lib/providers/types'

interface MacroDataContextValue {
  liveIndicatorMap: Record<string, MacroIndicator>
  clStatus: DataSourceStatus
  usStatus: DataSourceStatus
  refreshing: boolean
  refresh: () => Promise<void>
  /** Increments once per successful refresh. The Macro page owns extra data
   *  this provider doesn't hold (yield curve, US forex depth, release
   *  calendar); it keys its own fetch effects on this so ANY Update button in
   *  the app — not just the one on the Macro page — re-pulls them. */
  refreshSeq: number
}

const MacroDataContext = createContext<MacroDataContextValue | null>(null)

export function MacroDataProvider({ children }: { children: React.ReactNode }) {
  const [liveIndicatorMap, setLiveIndicatorMap] = useState<Record<string, MacroIndicator>>({})
  const [clStatus, setClStatus] = useState<DataSourceStatus>('static')
  const [usStatus, setUsStatus] = useState<DataSourceStatus>('static')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshSeq, setRefreshSeq] = useState(0)
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current
    setRefreshing(true)
    const p = Promise.all([fetchMacroIndicators('CL'), fetchMacroIndicators('US')])
      .then(([clRes, usRes]) => {
        if (clRes) {
          setClStatus(clRes.metadata.status)
          setLiveIndicatorMap(prev => ({ ...prev, ...Object.fromEntries(clRes.data.map(i => [i.id, i])) }))
        }
        if (usRes) {
          setUsStatus(usRes.metadata.status)
          setLiveIndicatorMap(prev => ({ ...prev, ...Object.fromEntries(usRes.data.map(i => [i.id, i])) }))
        }
        if (!clRes && !usRes) throw new Error('macro indicators unavailable')
        setRefreshSeq(n => n + 1)
      })
      .finally(() => {
        setRefreshing(false)
        inFlight.current = null
      })
    inFlight.current = p
    return p
  }, [])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  return (
    <MacroDataContext.Provider value={{ liveIndicatorMap, clStatus, usStatus, refreshing, refresh, refreshSeq }}>
      {children}
    </MacroDataContext.Provider>
  )
}

export function useMacroData(): MacroDataContextValue {
  const ctx = useContext(MacroDataContext)
  if (!ctx) throw new Error('useMacroData must be used within MacroDataProvider')
  return ctx
}
