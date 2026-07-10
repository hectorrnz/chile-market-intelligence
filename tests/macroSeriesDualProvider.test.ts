// Phase 8D — Unit tests for the dual-provider macro series registry
// (src/config/macroSeries.ts) and the US FRED manual map
// (src/config/usFredSeriesManualMap.ts). Pure, no network, no env reads.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MACRO_SERIES,
  getSeriesForRegion,
  getEnabledSeries,
  getEnabledBcchSeries,
  getEnabledFredSeries,
  getSeriesByStaticId,
} from '../src/config/macroSeries.ts'
import { usFredSeriesManualMap, isFredSeriesLive } from '../src/config/usFredSeriesManualMap.ts'
import { bcchSeriesManualMap } from '../src/config/bcchSeriesManualMap.ts'
import macroIndicators from '../src/data/macroIndicators.json' with { type: 'json' }

describe('macroSeries.ts — category assignment (Phase 8D.1 regression guard)', () => {
  // Real bug fixed this phase: both live providers hardcoded a single category
  // ('Rates' / 'US Rates') for every indicator regardless of its true category,
  // so copper/IPC/UF/IMACEC/desempleo/US CPI/US unemployment all misfiled into
  // the wrong Macro-page section once live data replaced the static fallback.
  const staticById = new Map(
    (macroIndicators as Array<{ id: string; category: string }>).map((i) => [i.id, i.category])
  )

  it('every MACRO_SERIES entry with a matching static id has the SAME category as macroIndicators.json', () => {
    for (const s of MACRO_SERIES) {
      const staticCategory = staticById.get(s.fallbackStaticId)
      if (staticCategory === undefined) continue // no static counterpart (e.g. Chilean-rates-only series)
      assert.equal(
        s.category, staticCategory,
        `${s.id} (fallbackStaticId=${s.fallbackStaticId}): live category "${s.category}" must match static "${staticCategory}"`
      )
    }
  })

  it('copper is Commodities, never Rates (the exact bug this phase fixed)', () => {
    const copper = getSeriesByStaticId('cobre-lme')
    assert.equal(copper?.category, 'Commodities')
  })

  it('CPI/UF/IMACEC/desempleo are never miscategorized as Rates', () => {
    assert.equal(getSeriesByStaticId('ipc-mensual')?.category, 'Inflation')
    assert.equal(getSeriesByStaticId('ipc-anual')?.category, 'Inflation')
    assert.equal(getSeriesByStaticId('uf-diaria')?.category, 'Inflation')
    assert.equal(getSeriesByStaticId('imacec-anual')?.category, 'Activity')
    assert.equal(getSeriesByStaticId('desempleo')?.category, 'Labor')
    assert.equal(getSeriesByStaticId('usdclp')?.category, 'FX')
  })

  it('US CPI and US unemployment are never miscategorized as US Rates', () => {
    assert.equal(getSeriesByStaticId('us-cpi-mensual')?.category, 'US Inflation')
    assert.equal(getSeriesByStaticId('us-cpi-anual')?.category, 'US Inflation')
    assert.equal(getSeriesByStaticId('us-unemployment')?.category, 'US Labor')
  })

  it('US Treasury yields legitimately stay US Rates', () => {
    for (const id of ['fed-funds', 'us3m', 'us2y', 'us10y', 'us20y', 'us30y']) {
      assert.equal(getSeriesByStaticId(id)?.category, 'US Rates')
    }
  })

  it('every MACRO_SERIES entry has a non-empty category (no field left undefined)', () => {
    for (const s of MACRO_SERIES) {
      assert.ok(s.category && s.category.length > 0, `${s.id} is missing a category`)
    }
  })
})

describe('FX panel — BCCh-only cleanup (Phase 8D.1)', () => {
  it('EUR/CLP is verified live via BCCh and categorized FX', () => {
    const eurclp = getSeriesByStaticId('eurclp')
    assert.ok(eurclp, 'eurclp must exist in the registry')
    assert.equal(eurclp?.sourceProvider, 'BCCh')
    assert.equal(eurclp?.category, 'FX')
    assert.equal(eurclp?.enabled, true)
    assert.ok(eurclp?.providerSeriesCode, 'eurclp must have a verified series code')
  })

  it('every FX-category MACRO_SERIES entry is BCCh-sourced and enabled — no unverified FX pair leaks into the live category', () => {
    const fxSeries = MACRO_SERIES.filter((s) => s.category === 'FX')
    assert.ok(fxSeries.length >= 2, 'expected at least usdclp + eurclp in the FX category')
    for (const s of fxSeries) {
      assert.equal(s.sourceProvider, 'BCCh', `${s.id}: FX-category series must be BCCh-sourced`)
      assert.equal(s.enabled, true, `${s.id}: FX-category series must be enabled (verified)`)
    }
  })

  it('macroIndicators.json FX-category entries source from Banco Central de Chile only', () => {
    const fxStatic = (macroIndicators as Array<{ id: string; category: string; source: string }>)
      .filter((i) => i.category === 'FX')
    assert.ok(fxStatic.length >= 2)
    for (const i of fxStatic) {
      assert.equal(i.source, 'Banco Central de Chile', `${i.id}: static FX fallback must name BCCh, not a fabricated vendor`)
    }
  })

  it('Home page no longer references the removed fake-FX artifacts (fxRates.json sections, Static MVP sample)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8')
    assert.ok(!src.includes('getFxBySection'), 'page.tsx must not import the old section-grouped FX helper')
    assert.ok(!src.includes('# of currency per USD'), 'page.tsx must not reference the removed FX helper-text label')
    assert.ok(!/fxSource.*Static MVP/i.test(src), 'page.tsx must not hardcode a Static MVP FX label')
  })

  it('Home page merges fetched live macro data into the rendered rows, not just the status badge (regression: badge said Live BCCh while the value stayed frozen on the static fallback)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8')
    // fxRows/macroChile/macroUs must read through liveIndicatorMap (populated
    // from the live /api/macro fetch), not directly off the static
    // getAllIndicators()/getByCategory() baseline alone.
    assert.ok(src.includes('liveIndicatorMap[fx.id]'), 'FX rows must prefer the live-fetched value per id')
    assert.ok(src.includes('liveIndicatorMap[id] ?? allIndicators.find'), 'Chile/US macro rows must prefer the live-fetched value per id')
    assert.ok(src.includes("setLiveIndicatorMap"), 'the live fetch effect must actually populate the merged-value map, not only setMacroStatus/setUsMacroStatus')
  })

  it('the Update Data button (doRefresh) also refreshes macro, not just market data', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8')
    const doRefreshBody = src.slice(src.indexOf('const doRefresh = useCallback'), src.indexOf('const doRefresh = useCallback') + 800)
    assert.ok(doRefreshBody.includes("fetchMacroIndicators('CL')"), 'doRefresh must also re-fetch CL macro indicators')
    assert.ok(doRefreshBody.includes("fetchMacroIndicators('US')"), 'doRefresh must also re-fetch US macro indicators')
  })

  it('i18n no longer defines the removed FX section-grouping labels', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/lib/i18n.ts', import.meta.url), 'utf8')
    assert.ok(!src.includes('fxKeyFx'), 'fxKeyFx label should be removed — FX panel is a flat list now')
    assert.ok(!src.includes('fxPerUsd'), 'fxPerUsd ("# of currency per USD") label should be removed')
  })
})

describe('usFredSeriesManualMap', () => {
  const required = [
    'fed-funds', 'us3m', 'us2y', 'us10y', 'us20y', 'us30y',
    'us-unemployment', 'us-cpi-mensual', 'us-cpi-anual',
  ]

  it('includes all 9 required US indicator keys', () => {
    for (const k of required) assert.ok(k in usFredSeriesManualMap, `missing FRED manual-map key: ${k}`)
  })

  it('every entry is verified with a non-null FRED series id — no guessing', () => {
    for (const [key, e] of Object.entries(usFredSeriesManualMap)) {
      assert.equal(e.verified, true, `${key} should be verified`)
      assert.ok(e.seriesId && e.seriesId.length > 0, `${key} must have a seriesId`)
    }
  })

  it('isFredSeriesLive requires verified=true (undefined entry is never live)', () => {
    assert.equal(isFredSeriesLive(undefined), false)
    const entry = usFredSeriesManualMap['us10y']
    assert.equal(isFredSeriesLive(entry), true)
    assert.equal(isFredSeriesLive({ ...entry, verified: false }), false)
  })

  it('CPI mensual and anual share the same underlying series id but different transforms', () => {
    const mom = usFredSeriesManualMap['us-cpi-mensual']
    const yoy = usFredSeriesManualMap['us-cpi-anual']
    assert.equal(mom.seriesId, yoy.seriesId)
    assert.equal(mom.transformation, 'mom')
    assert.equal(yoy.transformation, 'yoy')
  })
})

describe('macroSeries.ts — dual-provider merge', () => {
  it('MACRO_SERIES includes both CL (BCCh) and US (FRED) regions', () => {
    const regions = new Set(MACRO_SERIES.map((s) => s.region))
    assert.ok(regions.has('CL'))
    assert.ok(regions.has('US'))
  })

  it('every US entry has sourceProvider FRED; every CL entry has sourceProvider BCCh', () => {
    for (const s of MACRO_SERIES) {
      if (s.region === 'US') assert.equal(s.sourceProvider, 'FRED', `${s.id} (US) should be FRED-sourced`)
      if (s.region === 'CL') assert.equal(s.sourceProvider, 'BCCh', `${s.id} (CL) should be BCCh-sourced`)
    }
  })

  it('getSeriesForRegion filters correctly by region', () => {
    const us = getSeriesForRegion('US')
    const cl = getSeriesForRegion('CL')
    assert.ok(us.length > 0 && us.every((s) => s.region === 'US'))
    assert.ok(cl.length > 0 && cl.every((s) => s.region === 'CL'))
  })

  it('getEnabledFredSeries only returns FRED-sourced, verified entries', () => {
    const fred = getEnabledFredSeries()
    assert.ok(fred.length >= 9, `expected at least 9 enabled FRED series, got ${fred.length}`)
    for (const s of fred) {
      assert.equal(s.sourceProvider, 'FRED')
      assert.equal(s.enabled, true)
      assert.ok(s.providerSeriesCode)
    }
  })

  it('getEnabledBcchSeries only returns BCCh-sourced, verified entries (never leaks a FRED def)', () => {
    const bcch = getEnabledBcchSeries()
    assert.ok(bcch.length >= 12, `expected at least 12 enabled BCCh series (11 + copper), got ${bcch.length}`)
    for (const s of bcch) {
      assert.equal(s.sourceProvider, 'BCCh')
      assert.equal(s.enabled, true)
    }
  })

  it('getEnabledSeries (both providers) is the union of getEnabledBcchSeries + getEnabledFredSeries', () => {
    const all = getEnabledSeries()
    const bcch = getEnabledBcchSeries()
    const fred = getEnabledFredSeries()
    assert.equal(all.length, bcch.length + fred.length)
  })

  it('cobre-lme (copper) is BCCh-sourced, monthly, USD/lb — matches Phase 8D verification', () => {
    const copper = getSeriesByStaticId('cobre-lme')
    assert.ok(copper)
    assert.equal(copper!.sourceProvider, 'BCCh')
    assert.equal(copper!.unit, 'USD/lb')
    assert.equal(copper!.frequency, 'monthly')
    assert.equal(copper!.enabled, true)
  })

  it('getSeriesByStaticId resolves both a CL and a US indicator by their static id', () => {
    const tpm = getSeriesByStaticId('tpm')
    const us10y = getSeriesByStaticId('us10y')
    assert.ok(tpm && tpm.sourceProvider === 'BCCh')
    assert.ok(us10y && us10y.sourceProvider === 'FRED')
  })

  it('every enabled series manualKey resolves to a real entry in the corresponding manual map', () => {
    for (const s of getEnabledSeries()) {
      if (s.sourceProvider === 'FRED') {
        assert.ok(s.manualKey in usFredSeriesManualMap, `${s.id}: manualKey ${s.manualKey} missing from FRED map`)
      } else {
        assert.ok(s.manualKey in bcchSeriesManualMap, `${s.id}: manualKey ${s.manualKey} missing from BCCh map`)
      }
    }
  })
})
