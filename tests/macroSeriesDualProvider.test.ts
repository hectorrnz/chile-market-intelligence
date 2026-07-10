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
