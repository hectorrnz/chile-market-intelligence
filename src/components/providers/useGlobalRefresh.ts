'use client'

// One Update button refreshes the WHOLE platform.
//
// There are two independent live-data domains — the Yahoo market snapshot
// (MarketDataProvider) and the BCCh/FRED macro overlay (MacroDataProvider).
// Before this hook, each page's Update button refreshed only the domain that
// page happened to read, so clicking Update on Stocks left the Macro tab
// (indicators, yield curve, FX depth, release calendar) untouched and stale,
// and vice versa. Reported as: "the macro tab is not being updated when one
// of the Update Data is clicked".
//
// Every UpdateDataButton onRefresh should call this rather than a single
// provider's refresh, so the user never has to hunt for the "right" tab's
// button. Failures in one domain never block the other.

import { useCallback } from 'react'
import { useMarketData } from './MarketDataProvider'
import { useMacroData } from './MacroDataProvider'

export function useGlobalRefresh(): () => Promise<void> {
  const { refresh: refreshMarket } = useMarketData()
  const { refresh: refreshMacro } = useMacroData()

  return useCallback(async () => {
    const results = await Promise.allSettled([refreshMarket(), refreshMacro()])
    // Surface a failure to UpdateDataButton (which shows a failed state) only
    // when BOTH domains failed — a partial refresh still updated real data on
    // screen and should not be reported to the user as a failed update.
    if (results.every(r => r.status === 'rejected')) {
      throw new Error('refresh failed')
    }
  }, [refreshMarket, refreshMacro])
}
