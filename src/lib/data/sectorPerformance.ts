import rawData from '@/data/sectorPerformance.json'
import type { SectorPerformance } from '@/types'

export function getSectorPerformance(): SectorPerformance[] {
  return rawData as SectorPerformance[]
}
