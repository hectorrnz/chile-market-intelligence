// R13.R5C.2 — the Portfolio zero-display contract.
//
// THE RULE, literally: every user-visible numeric zero inside the Portfolio
// product renders `-`. `—` keeps its own, narrower meaning — no value could be
// established. Underlying values stay numeric: presentation changed, arithmetic
// did not.
//
// Three kinds of check here, and the first two are the ones that matter:
//   1. BEHAVIOURAL — the four shared formatters are pure, so the contract is
//      asserted by calling them, not by reading their source.
//   2. NON-IMPACT — a zero still sums, still reconciles, still ties an
//      accounting identity, using the same values a renderer is handed.
//   3. STRUCTURAL — that the rule lives in those four functions and one
//      component, so no surface can drift out of it. This is what stops
//      R13.R5C.1's failure mode (a per-call-site decision, made 60 times, made
//      wrong on levels) from recurring.
//
// NO PRIVATE DATA. Every figure below is invented.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  ZERO_MARK,
  UNAVAILABLE_MARK,
  formatUsd,
  formatUsdCompactM,
  formatUsdCompactUnit,
  formatRatioPct,
  formatWeightPct,
  formatChangePct,
  formatCount,
  roundsToZeroAt,
} from '../src/lib/formatters.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every surface the owner enumerated, plus the shared components they use. */
const SURFACES = [
  'src/app/family-portfolio/page.tsx',                          // Summary
  'src/app/family-portfolio/portfolio/page.tsx',                // Holdings
  'src/app/family-portfolio/weekly-changes/page.tsx',           // Weekly Changes
  'src/app/family-portfolio/alternatives/page.tsx',             // Alternatives Dashboard
  'src/app/family-portfolio/alternatives/holdings/page.tsx',    // Alternatives Holdings
  'src/app/family-portfolio/alternatives/cash-flows/page.tsx',  // Alternatives Cash Flows
  'src/components/familyPortfolio/AlternativesDrilldowns.tsx',  // drilldowns
  'src/components/familyPortfolio/ContributionBreakdownModal.tsx',
  'src/components/familyPortfolio/AllocationDonut.tsx',
  'src/components/familyPortfolio/AlternativesCashFlowChart.tsx',
  'src/components/familyPortfolio/ContributionChart.tsx',
  'src/components/familyPortfolio/HierarchicalTable.tsx',
  'src/components/familyPortfolio/PerformanceMarketsStrip.tsx',
  'src/components/familyPortfolio/PeriodValueChangeCard.tsx',
  'src/components/familyPortfolio/PortfolioValueHero.tsx',
  'src/components/familyPortfolio/ReconciliationStatus.tsx',
  'src/components/familyPortfolio/SummaryPrintSheet.tsx',        // print surface
  'src/components/familyPortfolio/WeeklySnapshotCard.tsx',
  'src/app/page.tsx',                                            // Overview's Portfolio card
] as const

// ───────────────────────────────────────────────────────────────────────────
// 1 · The contract itself
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.2 § 1 — exact zero renders the zero mark', () => {
  test('1 · money', () => {
    assert.equal(formatUsd(0), ZERO_MARK)
    assert.equal(formatUsd(-0), ZERO_MARK)
    assert.equal(formatUsd(0, 2), ZERO_MARK)
    assert.equal(formatUsd(0.0, 4), ZERO_MARK)
  })

  test('2 · percentages, signed and unsigned', () => {
    assert.equal(formatRatioPct(0), ZERO_MARK)
    assert.equal(formatRatioPct(-0), ZERO_MARK)
    assert.equal(formatWeightPct(0), ZERO_MARK)
    assert.equal(formatWeightPct(-0), ZERO_MARK)
    // `formatChangePct` converged onto `formatRatioPct` — one implementation,
    // so the change columns and the headline rates cannot drift apart.
    assert.equal(formatChangePct(0), ZERO_MARK)
    for (const r of [0, -0, 0.0123, -0.0456, 1, -1, null, undefined, Number.NaN]) {
      assert.equal(formatChangePct(r), formatRatioPct(r), String(r))
    }
  })

  test('3 · counts in a value position', () => {
    assert.equal(formatCount(0), ZERO_MARK)
    assert.equal(formatCount(-0), ZERO_MARK)
  })

  test('4 · a figure too small to SHOW at its precision reads as it renders', () => {
    // The rule is on the rendered form: `0` and `0,4` are the same `0` in a
    // whole-dollar column, and dashing one while printing the other would claim
    // a distinction the reader cannot see.
    assert.equal(formatUsd(0.4), ZERO_MARK)
    assert.equal(formatUsd(-0.4), ZERO_MARK)
    // …and the first figure that survives rounding keeps its number.
    assert.equal(formatUsd(0.5), '1')
    assert.equal(formatUsd(0.4, 2), '0,40')
    assert.equal(roundsToZeroAt(0.4, 0), true)
    assert.equal(roundsToZeroAt(0.5, 0), false)
  })
})

describe('R13.R5C.2 § 1 — unavailable keeps its own, different mark', () => {
  test('5 · null, undefined, NaN and ±∞ are NEVER the zero mark', () => {
    for (const fn of [formatUsd, formatRatioPct, formatWeightPct, formatCount]) {
      for (const v of [null, undefined, Number.NaN, Infinity, -Infinity]) {
        const out = fn(v as never)
        assert.equal(out, UNAVAILABLE_MARK, `${fn.name}(${String(v)})`)
        assert.notEqual(out, ZERO_MARK)
      }
    }
  })

  test('6 · the two marks are different characters', () => {
    assert.equal(ZERO_MARK, '-')
    assert.equal(UNAVAILABLE_MARK, '—')
    assert.notEqual(ZERO_MARK, UNAVAILABLE_MARK)
  })

  test('7 · zero is never classified as unavailable, in either direction', () => {
    // The frozen source semantic: a blank flow cell IS zero, a malformed one is
    // unavailable. Rendering may never merge the two.
    assert.notEqual(formatUsd(0), formatUsd(null))
    assert.notEqual(formatRatioPct(0), formatRatioPct(null))
    assert.notEqual(formatWeightPct(0), formatWeightPct(null))
    assert.notEqual(formatCount(0), formatCount(null))
  })
})

describe('R13.R5C.2 § 1 — ordinary values are untouched', () => {
  test('8 · positive and negative render exactly as before', () => {
    assert.equal(formatUsd(1234567), '1.234.567')
    assert.equal(formatUsd(-1234567), '-1.234.567')
    assert.equal(formatUsd(-2500.75, 2), '-2.500,75')
    assert.equal(formatRatioPct(0.0123), '+1,23%')
    assert.equal(formatRatioPct(-0.0456), '-4,56%')
    assert.equal(formatWeightPct(0.423), '42,3%')
    assert.equal(formatCount(12), '12')
    assert.equal(formatCount(1234), '1.234')
  })

  test('9 · a negative sign is never mistaken for the zero mark', () => {
    // They share a glyph, so the test is that a real negative keeps its digits.
    const neg = formatUsd(-1)
    assert.equal(neg, '-1')
    assert.notEqual(neg, ZERO_MARK)
    assert.ok(neg.length > 1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2 · Non-impact — the number is still the number
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.2 § 1 — presentation only', () => {
  test('10 · a dashed zero still sums to the same total', () => {
    const children = [1_000_000, 0, -250_000, 0, 0]
    const total = children.reduce((s, v) => s + v, 0)
    assert.equal(total, 750_000)
    // Three of the five render as the mark; the total is unchanged and renders
    // as a number because it is one.
    assert.equal(children.filter((v) => formatUsd(v) === ZERO_MARK).length, 3)
    assert.equal(formatUsd(total), '750.000')
  })

  test('11 · a total that IS zero renders the mark and still equals zero', () => {
    const children = [500_000, -500_000]
    const total = children.reduce((s, v) => s + v, 0)
    assert.equal(total, 0)
    assert.equal(formatUsd(total), ZERO_MARK)
    // The VALUE is a number, not a string — nothing downstream sees the mark.
    assert.equal(typeof total, 'number')
    assert.equal(total + 1, 1)
  })

  test('12 · the committed / contributed / unfunded identity still ties', () => {
    // A fully-drawn commitment: the exact case R13.R5C.1 refused to dash on the
    // grounds that it would break a visible identity. It does not — the
    // identity is arithmetic on the values, and only the third term's
    // RENDERING changes.
    const committed = 170_000
    const contributed = 170_000
    const unfunded = committed - contributed
    assert.equal(unfunded, 0)
    assert.equal(committed - contributed - unfunded, 0)
    assert.equal(formatUsd(committed), '170.000')
    assert.equal(formatUsd(contributed), '170.000')
    assert.equal(formatUsd(unfunded), ZERO_MARK)
  })

  test('13 · a weekly reconciliation with no flow still ties', () => {
    // previous + profit + net flow = closing, with the flow rendering as the
    // mark because no external capital moved.
    const previous = 1_000_000
    const profit = 50_000
    const netFlow = 0
    const closing = previous + profit + netFlow
    assert.equal(closing, 1_050_000)
    assert.equal(formatUsd(netFlow), ZERO_MARK)
    assert.equal(formatUsd(closing), '1.050.000')
  })

  test('14 · a liquidated holding still reads as liquidated', () => {
    // Beginning of year worth something, worth nothing now. R13.R5C.1 kept a
    // numeric `0` here so the liquidation stayed visible; the owner's rule
    // dashes it, and the FACT is still carried — by the beginning-of-year
    // column beside it, which is a real figure, and by the difference.
    const beginningOfYear = 543_875
    const thisWeek = 0
    const difference = thisWeek - beginningOfYear
    assert.equal(formatUsd(beginningOfYear), '543.875')
    assert.equal(formatUsd(thisWeek), ZERO_MARK)
    assert.equal(formatUsd(difference), '-543.875')
  })

  test('15 · a zero ratio still drives colour and ordering', () => {
    // Nothing downstream branches on the rendered string.
    const ratios = [0.02, 0, -0.01]
    const sorted = [...ratios].sort((a, b) => b - a)
    assert.deepEqual(sorted, [0.02, 0, -0.01])
    assert.equal(formatRatioPct(sorted[1]), ZERO_MARK)
    assert.equal(sorted[1] >= 0, true, 'a zero is still non-negative for tone')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3 · Centralisation — where the rule lives
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.2 § 2 — one rule, not sixty', () => {
  test('16 · MaskedAmount applies it by DEFAULT', () => {
    // This is the structural fix for R13.R5C.1: the flag was opt-in, so every
    // call site made its own decision and levels were decided wrongly.
    const masked = read('src/components/familyPortfolio/MaskedAmount.tsx')
    assert.match(masked, /zeroDash = true/)
    assert.doesNotMatch(code(masked), /zeroDash = false/)
  })

  test('17 · no Portfolio surface opts a VALUE out of the contract', () => {
    // The flag survives only as the chart-scale opt-out. A surface that passed
    // it any other way would be making the per-call-site decision again.
    for (const p of SURFACES) {
      for (const line of code(read(p)).split('\n')) {
        // `zeroDashNote` is the reader-facing legend, not the flag.
        if (!/zeroDash(?!Note)/.test(line)) continue
        assert.match(line, /zeroDash=\{false\}/, `${p}: ${line.trim()}`)
      }
    }
  })

  test('18 · the ONLY opt-outs are the two chart axes', () => {
    const optOuts = SURFACES.flatMap((p) =>
      (code(read(p)).match(/zeroDash=\{false\}/g) ?? []).map(() => p),
    )
    assert.deepEqual(optOuts.sort(), [
      'src/components/familyPortfolio/ContributionChart.tsx',
      'src/components/familyPortfolio/SummaryPrintSheet.tsx',
    ])
    // …and each is a TICK, never a datum.
    assert.match(read('src/components/familyPortfolio/ContributionChart.tsx'), /value=\{tick\}[^/]*zeroDash=\{false\}/)
    assert.match(read('src/components/familyPortfolio/SummaryPrintSheet.tsx'), /value=\{tick\.value\}[^/]*zeroDash=\{false\}/)
  })

  test('19 · an axis form keeps a numeric zero, so a baseline stays readable', () => {
    // `-` sitting between `-2M` and `2M` would be read as a stray minus sign.
    assert.equal(formatUsdCompactUnit(0), '0')
    assert.equal(formatUsdCompactM(0), '0')
    // …and a real figure forced to a larger unit still rounds to a numeral
    // rather than becoming `-M`.
    assert.equal(formatUsdCompactUnit(400_000, 'M'), '0M')
  })

  test('20 · no Portfolio surface formats a figure itself', () => {
    // A local `toLocaleString` would be a figure outside the contract — and,
    // for a monetary value, outside the privacy mask as well.
    const targets = [...SURFACES, 'src/components/familyPortfolio/PortfolioEvolutionChart.tsx']
    for (const p of targets) {
      // The Overview file holds several cards; only the PORTFOLIO card is in
      // scope. Its neighbours are a different module and public market data,
      // which this pass must NOT convert (see 20c).
      const src = p === 'src/app/page.tsx' ? portfolioCardOf(code(read(p))) : code(read(p))
      assert.doesNotMatch(src, /toLocaleString/, p)
      assert.doesNotMatch(src, /Intl\.NumberFormat/, p)
    }
  })

  test('20c · the Overview cards BESIDE the Portfolio card keep their own conventions', () => {
    // §2 of the brief: no public market-data convention outside Portfolio moves.
    // The Structured Notes notional and the index values still format
    // themselves, in their own locales, and are untouched by this pass.
    const src = code(read('src/app/page.tsx'))
    const outside = src.replace(portfolioCardOf(src), '')
    assert.match(outside, /totalCurrentNotional\.toLocaleString\('en-US'\)/)
    assert.match(outside, /idx\.value\.toLocaleString\('es-CL'\)/)
  })

  test('20b · the evolution chart formats its AXIS and nothing else', () => {
    // `formatAxisValue` is a documented scale form, alongside the two compact
    // formatters. Its exact VALUES go through the caller's `formatValue`, which
    // is `formatUsd` — so tooltip and hidden table obey the contract while the
    // scale stays a scale.
    const chart = code(read('src/components/familyPortfolio/PortfolioEvolutionChart.tsx'))
    assert.match(chart, /function formatAxisValue/)
    // The only numeric formatting in the file is that helper and SVG geometry.
    const fixedUses = chart.match(/[\w.)\]]+\.toFixed\(/g) ?? []
    assert.ok(fixedUses.length > 0)
    assert.doesNotMatch(chart, /formatUsd|formatRatioPct|formatWeightPct/)
    assert.match(read('src/app/family-portfolio/page.tsx'), /formatValue=\{\(v\) => formatUsd\(v\)\}/)
  })

  test('21 · the hierarchy table renders through the shared renderer, not a copy', () => {
    // It was the last surface embedding the chain itself, and being second is
    // exactly how it came to print `0` where Weekly Changes printed `-`.
    const table = code(read('src/components/familyPortfolio/HierarchicalTable.tsx'))
    assert.match(table, /<MaskedAmount value=\{value\} masked=\{masked\} \/>/)
    assert.doesNotMatch(table, /formatUsd/)
    assert.doesNotMatch(table, /PrivacyValue/)
    // …and the per-row "is this slot unoccupied" judgement R13.R5C.1 needed is
    // gone, because no row needs judging any more.
    assert.doesNotMatch(table, /unoccupied/)
  })
})

describe('R13.R5C.2 § 2 — the blast radius stays inside Portfolio', () => {
  test('22 · the four contract formatters are called ONLY from Portfolio', () => {
    // This is what makes changing them the right centralisation rather than an
    // app-wide convention change. Verified here so it stays true.
    const files = walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f))
    const OUTSIDE: string[] = []
    for (const abs of files) {
      const rel = abs.slice(ROOT.length + 1).replace(/\\/g, '/')
      if (rel === 'src/lib/formatters.ts') continue
      const src = read(rel)
      if (!/\bformatUsd\b|\bformatRatioPct\b|\bformatWeightPct\b|\bformatCount\b/.test(src)) continue
      const isPortfolio =
        rel.includes('familyPortfolio') || rel.includes('family-portfolio') || rel === 'src/app/page.tsx'
      if (!isPortfolio) OUTSIDE.push(rel)
    }
    assert.deepEqual(OUTSIDE, [], 'a non-Portfolio surface now depends on the Portfolio zero contract')
  })

  test('23 · the app-wide money and percent formatters are untouched', () => {
    // Market data outside Portfolio formats through these, and a `-` in a
    // stock table would be a convention change the owner ruled out.
    const f = read('src/lib/formatters.ts')
    const body = (name: string) =>
      f.slice(f.indexOf(`export function ${name}(`), f.indexOf('\n}', f.indexOf(`export function ${name}(`)))
    for (const name of ['formatCLP', 'formatPct', 'formatPercent']) {
      assert.doesNotMatch(body(name), /ZERO_MARK/, name)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 4 · Consistency across the enumerated surfaces
// ───────────────────────────────────────────────────────────────────────────

describe('R13.R5C.2 § 3 — one convention on every surface', () => {
  test('24 · every enumerated surface routes its figures through the contract', () => {
    // A surface either renders figures through the contract, or renders none of
    // its own and delegates to a component that does — Holdings is the second
    // kind: its whole table IS `HierarchicalTable`.
    const DELEGATES: Record<string, string> = {
      'src/app/family-portfolio/portfolio/page.tsx': 'HierarchicalTable',
    }
    for (const p of SURFACES) {
      const src = code(read(p))
      const usesContract =
        /<MaskedAmount/.test(src) ||
        /formatUsd\(|formatRatioPct\(|formatWeightPct\(|formatCount\(|formatChangePct\(/.test(src)
      if (usesContract) continue
      const delegate = DELEGATES[p]
      assert.ok(delegate, `${p} renders no figure through the contract and delegates to nothing`)
      assert.match(src, new RegExp(`<${delegate}`), `${p} must delegate to ${delegate}`)
    }
  })

  test('25 · the reader is told what the two marks mean, in both languages', async () => {
    const { dict } = await import('../src/lib/i18n.ts')
    for (const lang of ['en', 'es'] as const) {
      const note = dict[lang].fp.weeklyChanges.zeroDashNote
      assert.ok(note.includes('“-”'), lang)
      assert.ok(note.includes('“—”'), lang)
    }
  })

  test('26 · the legend is shown on the surfaces that carry both marks', () => {
    for (const p of [
      'src/app/family-portfolio/page.tsx',
      'src/app/family-portfolio/portfolio/page.tsx',
      'src/app/family-portfolio/weekly-changes/page.tsx',
    ]) {
      assert.match(read(p), /zeroDashNote/, p)
    }
  })
})

/**
 * The Overview's PORTFOLIO card only — from its own heading to the next card's.
 * The file holds three cards side by side and only this one is Portfolio.
 */
function portfolioCardOf(src: string): string {
  const from = src.indexOf('{t.fp.tag}')
  const to = src.indexOf('{t.nav.structuredNotes}')
  assert.ok(from > 0 && to > from, 'the Portfolio card must be locatable in the Overview')
  return src.slice(from, to)
}

/** Recursive file list — `node:fs` only, no dependency. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(abs))
    else out.push(abs)
  }
  return out
}
