// TEST/DEMO-ONLY — NOT IMPORTED BY ANY PRODUCTION ROUTE OR PAGE (FX Integrity
// Task). This static/sample FX data previously backed the Macro / US forex
// table before it moved to a live Frankfurter feed, and previously backed the
// Chile Macro-page FX depth table before that table was removed from
// production (it had no live/persisted backing — Chile's verified live BCCh
// FX pairs, USD/CLP and EUR/CLP, are served via the macro indicators API
// instead). Retained only because tests/frankfurterFx.test.ts exercises the
// pure `getFxRates()`/`getFxBySection()` helpers as a regression guard against
// this file being silently wired back into a production surface — see that
// test file's production-import guard.

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
