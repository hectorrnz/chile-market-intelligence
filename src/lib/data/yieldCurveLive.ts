// Client-safe fetch helper for the live yield curve. Only TYPE imports from
// the provider layer, so no server code reaches the browser bundle.

import type { LiveYieldCurveResult } from '@/lib/providers/yieldCurveProvider'

export async function fetchLiveYieldCurve(region: 'CL' | 'US', signal?: AbortSignal): Promise<LiveYieldCurveResult | null> {
  try {
    const res = await fetch(`/api/macro/yield-curve?region=${region}`, { signal })
    if (!res.ok) return null
    return (await res.json()) as LiveYieldCurveResult
  } catch {
    return null
  }
}
