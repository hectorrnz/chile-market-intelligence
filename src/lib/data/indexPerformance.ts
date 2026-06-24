import rawData from '@/data/indexPerformance.json'
import type { IndexPerformance } from '@/types'

export function getIndexPerformance(): IndexPerformance[] {
  return rawData as IndexPerformance[]
}
