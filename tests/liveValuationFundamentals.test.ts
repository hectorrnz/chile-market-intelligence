import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildFundamentals, type StaticStockSnapshot } from '../src/lib/compare/compareStatic.ts'

const staticSnap: StaticStockSnapshot = {
  ticker: 'X',
  peFwd: 10,
  psFwd: 3,
  evEbitda: 7,
  opMargin: 20,
  grossMargin: 40,
  roe: 12,
  fcfYield: 2,
  pb: 1.8,
  netDebtEbitda: 2,
  dividendYield: 3,
}

describe('buildFundamentals — live Yahoo layering (items 3+4)', () => {
  test('live valuation overrides static/persisted and marks every field derived', () => {
    const f = buildFundamentals(staticSnap, 1000, 500, undefined, {
      peFwd: 8.4, psTtm: 2.1, evEbitda: 6.1, opMargin: 25, grossMargin: 30,
      roe: 15, fcfYield: 4.2, pb: 1.2, dividendYield: 5.1, netDebtEbitda: 1.5,
    })
    assert.equal(f.pe, 8.4)
    assert.equal(f.psFwd, 2.1)
    assert.equal(f.evEbitda, 6.1)
    assert.equal(f.opMargin, 25)
    assert.equal(f.roe, 15)
    assert.equal(f.pb, 1.2)
    assert.equal(f.dividendYield, 5.1)
    for (const k of ['pe', 'psFwd', 'evEbitda', 'opMargin', 'grossMargin', 'roe', 'fcfYield', 'pb', 'dividendYield', 'netDebtEbitda']) {
      assert.ok(f.derivedFields.includes(k as never), `${k} should be marked derived`)
    }
  })

  test('a null live field falls through to the persisted layer', () => {
    const f = buildFundamentals(staticSnap, 1000, 500, { opMarginPct: 22 }, {
      // opMargin absent from live → persisted 22 wins over static 20
      opMargin: null,
    })
    assert.equal(f.opMargin, 22)
    assert.ok(f.derivedFields.includes('opMargin'))
  })

  test('no live and no persisted → honest static value, NOT marked derived', () => {
    const f = buildFundamentals(staticSnap, 1000, 500, undefined, undefined)
    assert.equal(f.opMargin, 20) // static snapshot value
    assert.ok(!f.derivedFields.includes('opMargin'))
    // P/B, ROE, P/S never fall back to the fabricated static snapshot — null instead
    assert.equal(f.pb, null)
    assert.equal(f.roe, null)
    assert.equal(f.psFwd, null)
  })

  test('live P/B present but no persisted → live wins, marked derived', () => {
    const f = buildFundamentals(staticSnap, 1000, 500, undefined, { pb: 1.2 })
    assert.equal(f.pb, 1.2)
    assert.ok(f.derivedFields.includes('pb'))
  })
})
