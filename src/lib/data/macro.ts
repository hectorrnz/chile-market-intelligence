import macroData from '@/data/macroIndicators.json'
import type { MacroIndicator } from '@/types'

const indicators = macroData as MacroIndicator[]

export function getAllIndicators(): MacroIndicator[] { return indicators }
export function getByCategory(category: MacroIndicator['category']): MacroIndicator[] {
  return indicators.filter(i => i.category === category)
}
export function getHighImportance(): MacroIndicator[] {
  return indicators.filter(i => i.importance === 'high')
}
