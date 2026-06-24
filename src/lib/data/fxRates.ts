import rawFx from '@/data/fxRates.json'
import type { FxRate } from '@/types'

const fx = rawFx as FxRate[]

export const FX_SECTION_ORDER: FxRate['section'][] = [
  'Key FX',
  '# USD per',
  '# of currency per USD',
  '# of Yen per',
]

export function getFxRates(): FxRate[] {
  return fx
}

/** Group FX rates by section, preserving the canonical section order. */
export function getFxBySection(): { section: FxRate['section']; items: FxRate[] }[] {
  return FX_SECTION_ORDER
    .map(section => ({ section, items: fx.filter(r => r.section === section) }))
    .filter(g => g.items.length > 0)
}
