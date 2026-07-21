// Client-safe fetch helper for the live per-ticker valuation.
// Components call this to hit /api/valuation/[ticker] — never the resolver or
// Supabase directly. Mirrors fetchCompareData in compareData.ts.

import type { ValuationResult } from '@/lib/compare/compareTypes'

export async function fetchValuation(ticker: string): Promise<ValuationResult | null> {
  if (!ticker) return null
  const res = await fetch(`/api/valuation/${encodeURIComponent(ticker)}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`/api/valuation returned ${res.status}`)
  const json = (await res.json()) as { data: ValuationResult | null }
  return json.data
}
