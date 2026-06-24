import hechosData from '@/data/hechosEsenciales.json'
import type { HechoEsencial } from '@/types'

const hechos = hechosData as HechoEsencial[]

export function getAllHechos(): HechoEsencial[] {
  return [...hechos].sort((a, b) => b.date.localeCompare(a.date))
}
export function getHechosByTicker(ticker: string): HechoEsencial[] {
  return hechos.filter(h => h.ticker === ticker).sort((a, b) => b.date.localeCompare(a.date))
}
export function getRecentHechos(n = 5): HechoEsencial[] { return getAllHechos().slice(0, n) }
