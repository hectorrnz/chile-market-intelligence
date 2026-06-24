import rawRates from '@/data/chileanRates.json'
import type { ChileanRate } from '@/types'

const rates = rawRates as ChileanRate[]

export function getChileanRates(): ChileanRate[] {
  return rates
}
