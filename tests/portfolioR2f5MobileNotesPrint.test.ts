// R13.R2F5 §§ A, C — mobile allocation centring and the footnote width band.
//
// (The print x-axis contract of § B is pinned in
// `portfolioR2f3PrintAxesInteraction.test.ts`, alongside the axis assertions it
// supersedes, rather than split across two files.)
//
// WHY THIS SUITE EXISTS. Both defects here are the same shape: a rule that is
// RIGHT at one width and wrong at another, written without a breakpoint.
//
//   A. The personal allocation row anchors the ring left so the legend can sit
//      to its right. Correct at desktop. Below `sm` the row wraps, and the same
//      anchor pins the ring to the left edge of a full-width mobile card with
//      all the free space on its right — the owner's 390 × 844 report.
//   B. Footnotes each carried their own 52-65ch measure and stacked. Correct as
//      a measure, wrong as a layout: on a 1632px page the stack uses about a
//      third of the width and leaves the rest blank.
//
// So the properties pinned below are BREAKPOINT-SCOPED and STRUCTURAL: what
// each width does, and that the notes measure comes from one shared band rather
// than from numbers scattered across five files.
//
// NO PRIVATE DATA. Every value here is a layout constant read off the source.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const DONUT_CODE = codeOf(read('src/components/familyPortfolio/AllocationDonut.tsx'))
const CSS = read('src/app/globals.css')
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every page of the Portfolio tab, which § C says to treat as one surface. */
const PORTFOLIO_TAB = [
  'src/app/family-portfolio/page.tsx',
  'src/app/family-portfolio/portfolio/page.tsx',
  'src/app/family-portfolio/weekly-changes/page.tsx',
  'src/app/family-portfolio/alternatives/page.tsx',
] as const

// ═══════════════════════════════════════════════════════════════════════════
// § A · THE DONUT IS CENTRED ON MOBILE, ANCHORED LEFT ON DESKTOP
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F5 § A · allocation at 390 × 844 and at desktop', () => {
  /** The two container class strings, in source order: spread, then compact. */
  const containers = DONUT_CODE.match(/'relative flex [^']+'/g) ?? []

  test('there are exactly the two container variants, and neither wraps at sm+', () => {
    assert.equal(containers.length, 2, 'spread and compact — no third layout may appear')
    for (const c of containers) assert.match(c, /flex-wrap sm:flex-nowrap/)
  })

  test('the wide (personal) row centres below sm and anchors left from sm up', () => {
    const spread = containers.find((c) => /justify-start/.test(c))
    assert.ok(spread, 'the wide row must still anchor the ring left at desktop')
    // The unprefixed justification is the MOBILE one — that is the whole fix.
    assert.match(spread!, /justify-center sm:justify-start/)
    // …and the desktop half of it is unchanged: full-width row, ring first.
    assert.match(spread!, /w-full max-w-full/)
  })

  test('Main keeps the centred pair at every width', () => {
    const compact = containers.find((c) => !/justify-start/.test(c))
    assert.ok(compact)
    assert.match(compact!, /justify-center/)
    // No breakpoint may creep into Main's justification: it is centred at 390
    // and centred at 1728, which is what it was approved as.
    assert.ok(!/sm:justify-/.test(compact!), 'Main must not acquire a breakpoint-scoped anchor')
  })

  test('centring is achieved by justification, never by resizing the ring', () => {
    // The owner's standing constraint across three passes: the ring keeps its
    // size; it is never shrunk or padded to make a layout work.
    assert.match(DONUT_CODE, /className="shrink-0 max-w-full h-auto"/)
    assert.ok(!/sm:size|size=\{\s*\w+\s*\?/.test(DONUT_CODE), 'the ring size must not become responsive')
    // And the legend still stacks BELOW on mobile rather than beside — it is
    // the wrap that puts it there, and the wrap survives below sm.
    assert.match(DONUT_CODE, /'flex flex-col gap-1\.5 min-w-0 basis-\[11rem\] grow/)
  })

  test('source order still puts the ring first — centring is not a reversal', () => {
    const svgAt = DONUT_CODE.indexOf('<svg')
    const legendAt = DONUT_CODE.indexOf('settings.legendVisible && (')
    assert.ok(svgAt > 0 && legendAt > svgAt)
    assert.ok(!/order-\d|order-\[|flex-row-reverse|flex-wrap-reverse|flex-col-reverse/.test(DONUT_CODE))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § C · FOOTNOTES USE THE WIDTH, WITHOUT BECOMING LONG LINES
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F5 § C · the footnote / source / disclosure band', () => {
  test('the band is a LEFT-ORIGIN STACK — never a second starting column', () => {
    // THE REJECTED SHAPE. R13.R2F5 made this a wrapping flex ROW so notes
    // would pack side by side and fill the width. It did fill the width — by
    // giving the reader three different left edges:
    //   `Source: RESUMEN workbook      Weekly source history · 102 points …`
    // The owner's instruction is a reading-flow one: "the text EXTENDS to the
    // right. But it should start from the left (where source currently is)."
    const band = /\.nv-notes \{[\s\S]{0,300}?\}/.exec(CSS_CODE)
    assert.ok(band, '.nv-notes must exist in globals.css')
    assert.match(band![0], /flex-direction: column/, 'every block must begin on its own line')
    assert.ok(!/flex-wrap: wrap/.test(band![0]), 'a wrapping row reintroduces the second column')
    assert.ok(!/column-gap/.test(band![0]), 'a column gap only exists to separate side-by-side notes')
    assert.match(band![0], /align-items: flex-start/, 'blocks align to the common left origin')
  })

  test('R13.R2F5.2 — the CARD is the measure; no character cap wraps early', () => {
    // The owner's remaining defect after R13.R2F5.1: a fixed 110ch measure
    // (≈605px at 11px) still broke the Evolution disclosure into three or four
    // short lines with most of the card empty beside them. A character cap
    // cannot be right for runs that appear in containers from a 5fr allocation
    // column to a full-page footer — the same number is generous in one and
    // needlessly tight in the other.
    const child = /\.nv-notes > \* \{[\s\S]{0,200}?\}/.exec(CSS_CODE)
    assert.ok(child, '.nv-notes > * must exist')
    // No flex-basis: a basis is only meaningful for sharing a line.
    assert.ok(!/flex: 1 1/.test(child![0]), 'a share-a-line basis must not return')
    // …and no character measure of any size: it is the container that bounds
    // the line now. A cap here is what the owner rejected twice.
    assert.ok(!/max-width: \d+ch/.test(child![0]), 'a fixed ch measure wraps before the card does')
    assert.match(child![0], /max-width: 100%/, 'the container is the measure, stated explicitly')
    assert.match(child![0], /min-width: 0/, 'a long token must still not widen the page')
  })

  test('no note in a band carries a measure of its own either', () => {
    // A child cap silently wins over the band, so the defect would come back
    // one paragraph at a time. `max-w-*` in ch, rem, px or a named size are all
    // the same mistake on a note inside `.nv-notes`.
    for (const p of PORTFOLIO_TAB) {
      const src = codeOf(read(p))
      let i = src.indexOf('className="nv-notes')
      while (i !== -1) {
        const group = src.slice(i, i + 900)
        const end = group.indexOf('</div>')
        for (const m of group.slice(0, end === -1 ? 900 : end).match(/max-w-\S+/g) ?? []) {
          assert.fail(`${p} caps a note inside a band (${m}) — the band's own measure is defeated`)
        }
        i = src.indexOf('className="nv-notes', i + 1)
      }
    }
  })

  test('no note group contains a horizontal row', () => {
    // The other half of the rejected shape lived in the JSX: a
    // `flex flex-wrap items-baseline gap-x-4` row INSIDE a group, which put the
    // provenance line to the right of the source line on the same baseline.
    for (const p of PORTFOLIO_TAB) {
      const src = codeOf(read(p))
      let i = src.indexOf('className="nv-notes')
      while (i !== -1) {
        // The group's own opening tag, then its first child element.
        const after = src.slice(i, i + 700)
        const firstChild = after.slice(after.indexOf('>') + 1)
        assert.ok(
          !/^\s*<div className="[^"]*\bflex\b[^"]*(?:flex-wrap|gap-x-)/.test(firstChild),
          `${p} opens a notes group with a horizontal row — that is the rejected second column`,
        )
        i = src.indexOf('className="nv-notes', i + 1)
      }
    }
  })

  test('it is applied across the Portfolio tab, not to one component', () => {
    // The owner asked for this "in the whole portfolio tab". A fix on the
    // Summary alone would leave the same dead space on every sibling page.
    const users = PORTFOLIO_TAB.filter((p) => /nv-notes/.test(read(p)))
    assert.ok(users.length >= 3, `only ${users.length} Portfolio-tab pages use the band`)
    // …including the Summary, whose evolution disclosure is the widest region.
    assert.match(read('src/app/family-portfolio/page.tsx'), /nv-notes/)
  })

  test('the per-note caps the band replaced are gone from those pages', () => {
    // A child cap SILENTLY DEFEATS the band: `.nv-notes > *` sets max-width,
    // and a `max-w-[52ch]` on the note itself simply wins, leaving it exactly
    // as narrow as before while the layout claims to have been rebalanced.
    // 52ch and 65ch were the two footnote measures in use; neither may remain.
    // Comments stripped: a comment RECORDING which cap was replaced is
    // documentation, not a live measure.
    for (const p of PORTFOLIO_TAB) {
      for (const m of codeOf(read(p)).match(/max-w-\[(?:52|65)ch\]/g) ?? []) {
        assert.fail(`${p} still pins a per-note measure (${m}) — the band supplies it`)
      }
    }
  })

  test('a disclosure BODY is exempt, and deliberately so', () => {
    // Not everything small and grey is a footnote. The High Water Market
    // explainer is an expandable <details> body — real explanatory prose the
    // reader opens on purpose, not a provenance line packed into a band. It
    // keeps its own measure, and it is not a child of any `nv-notes` group.
    const summary = read('src/app/family-portfolio/page.tsx')
    const explainer = summary.match(/id=\{hwmTipId\}\s*\n\s*className="([^"]+)"/)
    assert.ok(explainer, 'the HWM explainer must still exist')
    assert.match(explainer![1], /max-w-\[78ch\]/, 'a disclosure body keeps its own measure')
    assert.ok(!/nv-notes/.test(explainer![1]))
  })

  test('the band changes packing only — never type, colour or hierarchy', () => {
    // These are still plain meta paragraphs. A footnote that grew into body
    // type, or lost its muted tone, would be a redesign, not a rebalance.
    for (const p of PORTFOLIO_TAB) {
      const src = read(p)
      const bands = src.match(/className="[^"]*\bnv-notes\b[^"]*"/g) ?? []
      for (const b of bands) {
        assert.ok(!/text-sm|text-base|text-foreground\b/.test(b), `band restyles its children: ${b}`)
      }
    }
    // And the shared band itself sets no type properties at all.
    const band = /\.nv-notes \{[\s\S]{0,300}?\}/.exec(CSS_CODE)!
    assert.ok(!/font|color|text-/.test(band[0]), 'the band must not restyle text')
  })

  test('the snapshot footnote is bounded by its column, not by an arbitrary 52ch', () => {
    // WeeklySnapshotCard sits in a NARROW column of the analytical row, so it
    // gains nothing from widening — but it should still pack through the one
    // shared mechanism rather than a hand-set measure of its own.
    const card = codeOf(read('src/components/familyPortfolio/WeeklySnapshotCard.tsx'))
    assert.ok(!/max-w-\[52ch\]/.test(card), 'the hand-set measure must be gone')
    assert.match(card, /nv-notes[^"]*mt-auto pt-2\.5 pb-1/, 'spacing and bottom-pinning unchanged')
  })
})
