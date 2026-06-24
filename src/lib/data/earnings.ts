import earningsData from '@/data/earnings.json'
import type { EarningsRelease } from '@/types'

const releases = earningsData as EarningsRelease[]

export function getAllEarnings(): EarningsRelease[] { return releases }
export function getEarningsByTicker(ticker: string): EarningsRelease[] {
  return releases.filter(e => e.ticker === ticker)
}
export function getUpcomingEarnings(): EarningsRelease[] {
  const today = '2025-06-17'
  return releases
    .filter(e => e.reportDate >= today && e.resultQuality === 'Pending')
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
}
export function getRecentResults(): EarningsRelease[] {
  const today = '2025-06-17'
  return releases
    .filter(e => e.reportDate < today && e.resultQuality !== 'Pending')
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
}
