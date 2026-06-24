import stockData from '@/data/stockPrices.json'
import type { StockPriceSnapshot } from '@/types'

const snapshots = stockData as StockPriceSnapshot[]

export function getAllSnapshots(): StockPriceSnapshot[] { return snapshots }
export function getSnapshotByTicker(ticker: string): StockPriceSnapshot | undefined {
  return snapshots.find(s => s.ticker === ticker)
}
