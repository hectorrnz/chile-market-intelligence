// R13.R2F2 §§ 15-16 — personal allocation alignment, and the system-wide
// button interaction contract.
//
// WHAT THIS SUITE IS FOR. Two things landed in this pass that are easy to
// regress silently:
//
//   1. The PERSONAL analytical row (Jaime · Andrés · Pablo) was rebalanced so
//      Asset Allocation reads donut-left / legend-right across the width it
//      actually has, instead of a centred pair floating in dead space. Main —
//      which already read correctly — had to come through byte-identical.
//   2. The hover "lift" + pointer cursor were implemented ONCE, in a shared
//      stylesheet rule, because this codebase has no shared Button primitive.
//      A shared rule is exactly the kind of change that quietly reaches things
//      it should not: disabled controls, informational badges, chart data
//      points, the print sheet.
//
// So the checks below pin the CONTRACT — donut before legend, Main unchanged,
// disabled excluded, motion collapsible, paper untouched — rather than one
// pass's markup. Composition is asserted as a source contract, this module's
// established idiom (portfolioR2b/c/d/e/f): a React tree cannot be rendered
// under `node --test`.
//
// NO PRIVATE DATA. Nothing here reads the book.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scopeHasWeeklyNotes } from '../src/lib/familyPortfolio/weeklyNotes.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Strips comments — prose DESCRIBING a mechanism must never satisfy a check for it. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PAGE = read('src/app/family-portfolio/page.tsx')
const CODE = codeOf(PAGE)
const PANEL = read('src/components/familyPortfolio/AllocationPanel.tsx')
const PANEL_CODE = codeOf(PANEL)
const DONUT = read('src/components/familyPortfolio/AllocationDonut.tsx')
const DONUT_CODE = codeOf(DONUT)
const SNAPCARD = codeOf(read('src/components/familyPortfolio/WeeklySnapshotCard.tsx'))
const CSS = read('src/app/globals.css')
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
const SEGMENTED = read('src/components/fable/SegmentedControl.tsx')

// ═══════════════════════════════════════════════════════════════════════════
// § 15 · PERSONAL ALLOCATION
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F2 § 15 · the personal analytical row', () => {
  test('every personal scope renders Snapshot + Allocation and NO Weekly Notes', () => {
    // The row's shape is derived from this one predicate, so proving the
    // predicate per scope proves the composition for all three at once —
    // stronger than asserting three copies of the same markup.
    assert.equal(scopeHasWeeklyNotes('main'), true)
    for (const scope of ['jaime', 'andres', 'pablo']) {
      assert.equal(scopeHasWeeklyNotes(scope), false, scope)
    }
    assert.match(CODE, /const showNotes = activeScope !== null && scopeHasWeeklyNotes\(activeScope\)/)
    // Both surfaces are unconditional — they are not gated on `showNotes`, so
    // a personal scope cannot lose either one.
    assert.match(CODE, /<WeeklySnapshotCard/)
    assert.match(CODE, /<AllocationPanel/)
    // The notes column is the ONLY conditional region.
    assert.match(CODE, /\{showNotes && \(/)
    assert.equal((CODE.match(/<WeeklyNotesPanel/g) ?? []).length, 1)
  })

  test('both rows are three tracks, and neither is an empty column', () => {
    // R13.R2F3 recomposed the personal row from two tracks to three: Main is
    // Snapshot | Allocation | Notes, personal is Performance | Snapshot |
    // Allocation. The invariant this test protects is NOT the track count —
    // it is that a personal scope never renders a NOTES column, empty or
    // otherwise. The Performance column is real content moved up into the row,
    // not filler standing in for the missing notes.
    const main = CODE.match(/showNotes\s*\n?\s*\?\s*'grid grid-cols-1 xl:grid-cols-\[([^\]]+)\]'/)
    const personal = CODE.match(/:\s*'grid grid-cols-1 xl:grid-cols-\[([^\]]+)\]'/)
    assert.ok(main, 'Main analytical row must declare an explicit xl track list')
    assert.ok(personal, 'personal analytical row must declare an explicit xl track list')
    assert.equal(main[1].split('_').length, 3)
    assert.equal(personal[1].split('_').length, 3)
    // Both stack to a single column below xl — a three-up analytical row on a
    // phone would guarantee the horizontal overflow this app does not ship.
    assert.equal((CODE.match(/grid grid-cols-1 xl:grid-cols-\[/g) ?? []).length, 2)
    // Every track is `minmax(0,…)`: without the zero minimum a grid track
    // refuses to shrink below its content and pushes page width.
    for (const track of [...main[1].split('_'), ...personal[1].split('_')]) {
      assert.match(track, /^minmax\(0,\d+fr\)$/)
    }
    // The notes column is still the ONE conditional region, and it is the only
    // thing keyed to `showNotes` inside the row besides the Performance column.
    assert.equal((CODE.match(/<WeeklyNotesPanel/g) ?? []).length, 1)
    assert.match(CODE, /\{showNotes && \(/)
  })

  test('Snapshot and Allocation keep the SAME share of the row in both scopes', () => {
    // The ledger is four short lines whose label and amount must stay legible
    // as ONE line. WeeklySnapshotCard caps its measure below xl and releases
    // the cap at xl on the assumption that it is a NARROW column there — so
    // neither scope may hand it a wide one.
    assert.match(SNAPCARD, /max-w-\[32rem\] xl:max-w-none/)
    const main = CODE.match(/showNotes\s*\n?\s*\?\s*'grid grid-cols-1 xl:grid-cols-\[([^\]]+)\]'/)
    const personal = CODE.match(/:\s*'grid grid-cols-1 xl:grid-cols-\[([^\]]+)\]'/)
    const fr = (list: string) => list.split('_').map((t) => Number(t.match(/(\d+)fr/)![1]))
    const mainFr = fr(main![1])         // Snapshot | Allocation | Notes
    const personalFr = fr(personal![1]) // Performance | Snapshot | Allocation
    const share = (parts: number[], i: number) => parts[i] / parts.reduce((a, b) => a + b, 0)
    // Snapshot: Main track 0 ≡ personal track 1. Allocation: Main 1 ≡ personal 2.
    // So both render at the same absolute width whichever portfolio is on
    // screen — which is also why Allocation can use Main's own `compact`
    // treatment on a personal scope without any second calibration.
    assert.equal(share(personalFr, 1), share(mainFr, 0), 'Snapshot share must match Main')
    assert.equal(share(personalFr, 2), share(mainFr, 1), 'Allocation share must match Main')
    // …and Performance takes exactly the slot Notes occupies on Main, so the
    // row is neither wider nor emptier than the one the owner approved.
    assert.equal(share(personalFr, 0), share(mainFr, 2), 'Performance must take the Notes slot')
  })

  test('R13.R2F4 — a personal scope takes the wide treatment, Main keeps compact', () => {
    // SUPERSEDES the R13.R2F3 pin of a single literal `layout="compact"`. The
    // owner reviewed the result and reported the legend still dropping BELOW
    // the ring with dead space beside it, so the personal column opts back
    // into the mode that anchors the ring left and lets the ledger claim the
    // width — minus the dotted leader, which the owner rejected separately.
    assert.match(CODE, /layout=\{showNotes \? 'compact' : 'wide'\}/)
    // Main is `showNotes === true`, so it still resolves to compact through
    // the same expression — no second branch, no separate Main treatment.
    assert.match(PANEL_CODE, /layout\?: 'compact' \| 'wide'/)
    assert.match(PANEL_CODE, /layout = 'compact'/)
    assert.match(PANEL_CODE, /layout=\{layout\}/)
    assert.match(DONUT_CODE, /layout = 'compact'/)
  })

  test('wide = donut LEFT, legend RIGHT, filling the column', () => {
    assert.match(DONUT_CODE, /const spread = layout === 'wide' && settings\.legendVisible/)
    // Row anchored to the start and stretched, so the ring sits at the left
    // edge and the ledger claims the rest — not a centred pair with dead space
    // either side of it.
    // R13.R2F5 scoped the start-anchoring to `sm` and up so the wrapped mobile
    // line centres; the desktop half of the contract is unchanged.
    assert.match(DONUT_CODE, /spread[\s\S]{0,140}?'relative flex flex-wrap sm:flex-nowrap items-center justify-center sm:justify-start[^']*w-full max-w-full'/)
    // Compact keeps the centred treatment.
    assert.match(DONUT_CODE, /'relative flex flex-wrap sm:flex-nowrap items-center justify-center gap-x-6 gap-y-3 min-w-0 max-w-full'/)
    // The legend's upper bound is released ONLY in spread; compact keeps it.
    assert.match(DONUT_CODE, /spread[\s\S]{0,160}?'flex flex-col gap-1\.5 min-w-0 basis-\[11rem\] grow'[\s\S]{0,120}?'flex flex-col gap-1\.5 min-w-0 basis-\[11rem\] grow max-w-\[18rem\]'/)
  })

  test('the donut precedes the legend in the DOM, not merely on screen', () => {
    // Source order is the accessible order and the order a legend-hidden
    // screen reader hears. It must not be achieved with `order-*`/`row-reverse`.
    const svgAt = DONUT_CODE.indexOf('<svg')
    const legendAt = DONUT_CODE.indexOf('settings.legendVisible && (')
    assert.ok(svgAt > 0 && legendAt > svgAt, 'the ring must be authored before the legend')
    assert.ok(!/flex-row-reverse|order-\[?-?\d/.test(DONUT_CODE))
  })

  test('the ring is not shrunk, and never overflows the page', () => {
    // Owner direction: the donut is size-protected. The wide layout must be
    // paid for by the legend, never by the ring.
    assert.match(PANEL_CODE, /size=\{208\}/)
    assert.match(DONUT_CODE, /className="shrink-0 max-w-full h-auto"/)
    // The row itself is bounded too, and wraps rather than pushing width.
    assert.match(DONUT_CODE, /flex-wrap/)
    assert.equal((DONUT_CODE.match(/max-w-full/g) ?? []).length >= 2, true)
  })

  test('the legend stays a complete ledger in BOTH layouts', () => {
    // Every entry keeps its chip, its name and its weight, weights on a common
    // right edge. R13.R2F4: that edge is `ml-auto` in BOTH modes now — the
    // dotted leader that used to supply it in spread was owner-rejected, so
    // the branch it required is gone. Neither mode may drop a category or a
    // percentage.
    assert.match(DONUT_CODE, /slices\.map\(\(s\) => \{/)
    assert.match(DONUT_CODE, /\{formatWeightPct\(s\.weight\)\}/)
    assert.match(DONUT_CODE, /\{s\.label\}/)
    assert.match(DONUT_CODE, /className="ui-number text-muted-fg shrink-0 ml-auto"/)
  })

  test('allocation VALUES, basis and privacy are untouched by the layout work', () => {
    // Weights still come from the same normalization over AVAILABLE weights,
    // a null weight still draws no slice, and every monetary figure still goes
    // through the one guarded render path.
    assert.match(DONUT_CODE, /e\.weight !== null && e\.weight > 0/)
    assert.match(DONUT_CODE, /const fractions = available\.map\(\(e\) => e\.weight \/ total\)/)
    assert.match(DONUT_CODE, /paletteTokenAt\(settings\.palette, i\)/)
    assert.match(DONUT_CODE, /<MaskedAmount/)
    assert.match(DONUT_CODE, /const maskedEffective = masked \|\| !resolved/)
    // Colour is still never the only carrier: a hidden legend still enumerates
    // every slice on the SVG's own accessible name.
    assert.match(DONUT_CODE, /settings\.legendVisible\s*\n?\s*\?\s*summary/)
    // The panel still renders provenance, the basis rail and the gear.
    assert.match(PANEL_CODE, /basisControl/)
    assert.match(PANEL_CODE, /SettingsGearButton/)
    assert.match(PANEL_CODE, /readOnlyNote/)
    assert.match(CODE, /<TableSourceFooter source=\{t\.fp\.portfolio\.source\} asOf=\{pub\.publishedAt\} \/>/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 16 · SHARED BUTTON INTERACTION
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F2 § 16 · the shared button interaction contract', () => {
  test('it is implemented ONCE, in the shared stylesheet', () => {
    // Not duplicated across pages. If a component ever needs its own hover
    // transform it should extend this rule, not fork it.
    assert.match(CSS_CODE, /button:not\(:disabled\):not\(\[aria-disabled='true'\]\)/)
    for (const file of [
      'src/app/family-portfolio/page.tsx',
      'src/components/familyPortfolio/AllocationPanel.tsx',
      'src/components/familyPortfolio/SettingsGearButton.tsx',
      'src/components/fable/SegmentedControl.tsx',
    ]) {
      assert.ok(
        !/hover:-translate-y|hover:translate-y|hover:scale-1/.test(read(file)),
        `${file} must not carry its own hover transform`,
      )
    }
  })

  test('enabled controls get the pointer cursor — including the scope selector', () => {
    // The clause list widened in R13.R2F3 (nav anchors joined it), so this
    // asserts the button clause is IN the cursor rule rather than pinning the
    // whole list — which is pinned in portfolioR2f3PrintAxesInteraction.
    assert.match(CSS_CODE, /button:not\(:disabled\):not\(\[aria-disabled='true'\]\),[\s\S]{0,220}?\{\s*cursor: pointer;/)
    // The portfolio scope selector is a SegmentedControl of real <button>s, so
    // the shared rule reaches it with no per-component class. This is the
    // control the owner reported as showing the default arrow.
    assert.match(CODE, /<SegmentedControl[\s\S]{0,400}?ariaLabel=\{t\.fp\.portfolio\.scopeSelector\}/)
    assert.match(SEGMENTED, /<button/)
    // …and it must not have been "fixed" by hardcoding a cursor on it instead.
    assert.ok(!/cursor-pointer/.test(SEGMENTED))
  })

  test('DISABLED controls are excluded from both the cursor and the lift', () => {
    // An affordance on something that cannot be activated is a lie. Both the
    // native attribute and the ARIA state are excluded.
    const declarations = CSS_CODE.match(/^\s*(?:button|\[role='button'\])[^{\n]*\{/gm) ?? []
    assert.ok(declarations.length > 0)
    for (const decl of declarations) {
      // The print/reduced-motion neutralisers deliberately apply to every
      // button — they REMOVE effects, so they need no exclusion.
      if (/transform: none/.test(CSS_CODE.slice(CSS_CODE.indexOf(decl), CSS_CODE.indexOf(decl) + 120))) continue
      assert.match(decl, /:not\(\[aria-disabled='true'\]\)/, decl.trim())
    }
    assert.match(CSS_CODE, /button:not\(:disabled\)/)
    // The existing disabled utilities still win, because they are Tailwind
    // utilities and this rule sits in the components layer.
    assert.match(SEGMENTED, /disabled:opacity-40 disabled:cursor-not-allowed/)
    assert.match(CSS_CODE, /@layer components \{/)
  })

  test('the lift is restrained, and moves nothing else on the page', () => {
    assert.match(CSS_CODE, /transform: translateY\(-1px\)/)
    // No glow, no bounce, no 3D, no exaggerated zoom — and critically no
    // LAYOUT property, which would reflow the row.
    const block = CSS_CODE.slice(CSS_CODE.indexOf('@media (hover: hover)'), CSS_CODE.indexOf('.nv-pop'))
    assert.ok(!/rotate|perspective|translateZ|box-shadow|filter|margin|width|height|padding/.test(block))
    assert.ok(!/scale\((?:[2-9]|1\.[2-9])/.test(block))
    // On the app's existing hover tokens — no new duration, no new easing.
    assert.match(CSS_CODE, /transition-duration: var\(--dur-hover\);\s*\n\s*transition-timing-function: var\(--ease-primary\);/)
    assert.ok(!/--dur-lift|--ease-lift|--dur-pop-button/.test(CSS_CODE))
  })

  test('it reaches only real controls — not badges, text or chart data points', () => {
    // The rule is scoped by TAG/ROLE, so exclusion is structural rather than a
    // denylist that a new component could fall outside of. The donut's slices
    // are focusable <path> elements and must never lift.
    assert.ok(!/^\s*a:hover|^\s*span:hover|^\s*div:hover/m.test(CSS_CODE))
    assert.match(DONUT_CODE, /<path/)
    assert.ok(!/role="button"/.test(DONUT_CODE))
    // Nothing in the app fakes a button with a div — verified so the
    // `[role='button']` half of the selector cannot silently pick up a card.
    assert.ok(!/role="button"/.test(read('src/components/fable/Chip.tsx')))
  })

  test('the sliding-indicator exception is keyed to the INDICATOR, not to being selected', () => {
    // A selected pill sits over `.nv-indicator`, an absolutely-positioned
    // sibling that JS moves and that does not travel with the button's own
    // transform — lifting the label alone would peel it off its pill. Ordinary
    // toggles have nothing to peel away from and are NOT excluded, so a
    // control never behaves two different ways in its two states.
    assert.match(CSS_CODE, /button\[role='radio'\]\[aria-checked='true'\]:hover/)
    assert.match(CSS_CODE, /:has\(> \.nv-indicator\) > button\[aria-pressed='true'\]:hover/)
    assert.match(SEGMENTED, /role="radio"/)
    assert.match(SEGMENTED, /className="absolute[^"]*nv-indicator"/)
    // A blanket "any aria-pressed button" exclusion would have caught the
    // privacy, theme and language toggles, which carry no indicator.
    assert.ok(!/^\s*button\[aria-pressed='true'\]:hover/m.test(CSS_CODE))
    assert.match(read('src/components/fable/PrivacyValue.tsx'), /aria-pressed=\{masked\}/)
    assert.ok(!/nv-indicator/.test(read('src/components/ui/ThemeToggle.tsx')))
  })

  test('SELECTED state survives the hover — it is position-only', () => {
    // The exception suppresses `transform` and nothing else, so colour, weight
    // and the aria state that actually announce selection are untouched.
    const exception = CSS_CODE.slice(CSS_CODE.indexOf("button[role='radio'][aria-checked='true']:hover"))
    const body = exception.slice(exception.indexOf('{'), exception.indexOf('}') + 1)
    assert.match(body, /^\{\s*transform: none;\s*\}$/)
    assert.match(SEGMENTED, /color: active \? 'var\(--foreground\)' : 'var\(--muted-fg\)', fontWeight: active \? 600 : 500/)
    assert.match(SEGMENTED, /aria-checked=\{active\}/)
  })

  test('a shared primitive that declared its own timing keeps it', () => {
    // `.nv-transition-state` is the app's slower 260ms state choreography and
    // carries `width`; the Switch track uses it. The shared button selector is
    // more specific than a single class, so without this exclusion it would
    // have silently retimed a primitive outside this module.
    assert.match(CSS_CODE, /:not\(\.nv-transition-state\)[\s\S]{0,140}?transition-property: transform,/)
    assert.match(CSS_CODE, /\.nv-transition-state \{[\s\S]{0,200}?transform, width;/)
    assert.match(CSS_CODE, /\.nv-transition-state \{[\s\S]{0,200}?var\(--dur-state\)/)
    assert.match(read('src/components/fable/Switch.tsx'), /nv-transition-state/)
    // The cursor is declared separately so the exclusion does not cost it.
    const cursorRule = CSS_CODE.slice(
      CSS_CODE.indexOf("button:not(:disabled):not([aria-disabled='true'])"),
    )
    assert.match(cursorRule.slice(0, 200), /cursor: pointer;\s*\n\s*\}/)
  })

  test('`.nv-transition` itself is NOT repurposed', () => {
    // It is used app-wide on non-button elements (table rows, legend items,
    // donut slices). Adding `transform` to it would have animated all of them.
    const shared = CSS_CODE.slice(CSS_CODE.indexOf('.nv-transition {'))
    const body = shared.slice(0, shared.indexOf('}'))
    assert.match(body, /transition-property: color, background-color, border-color, box-shadow, opacity;/)
    assert.ok(!/transform/.test(body))
  })

  test('reduced motion removes the DISPLACEMENT, and keeps the affordance', () => {
    const rm = CSS_CODE.slice(CSS_CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
    const block = rm.slice(0, rm.indexOf('\n}\n'))
    // Collapsing the transition alone is not enough — a translated FINAL
    // position is still a positional change.
    assert.match(block, /button:hover, \[role='button'\]:hover(?:, nav a:hover)? \{\s*transform: none !important;\s*\}/)
    // The cursor is not motion and must survive, so it is never neutralised here.
    assert.ok(!/cursor/.test(block))
    // The pre-existing blanket collapse is still in place.
    assert.match(block, /transition-duration: \.01ms !important;/)
  })

  test('touch never gets a sticky post-tap lift', () => {
    // The lift lives entirely inside a hover-capable query; a touch-only
    // device never matches it, so a tap cannot leave a control raised.
    const hoverBlock = CSS_CODE.slice(CSS_CODE.indexOf('@media (hover: hover)'), CSS_CODE.indexOf('.nv-pop'))
    assert.match(hoverBlock, /transform: translateY\(-1px\)/)
    // …and there is no lift declared outside it.
    const outside = CSS_CODE.replace(hoverBlock, '')
    assert.ok(!/transform: translateY\(-1px\)/.test(outside))
  })

  test('keyboard focus is unchanged and is not replaced by hover', () => {
    assert.match(CSS_CODE, /:focus-visible \{\s*outline: 2px solid var\(--focus\);/)
    // The hover rule must not touch outline — hover is an addition to the
    // focus treatment, never a substitute for it.
    const hoverBlock = CSS_CODE.slice(CSS_CODE.indexOf('@media (hover: hover)'), CSS_CODE.indexOf('.nv-pop'))
    assert.ok(!/outline/.test(hoverBlock))
  })

  test('paper inherits no interaction', () => {
    const print = CSS_CODE.slice(CSS_CODE.indexOf('@media print {'))
    assert.match(print, /button, \[role='button'\](?:, nav a)? \{\s*transform: none !important;\s*transition: none !important;\s*\}/)
    // And the print sheet's own chart is untouched by the interaction work:
    // still a plain block, no hover or transition reaches it. (R13.R2F5.1 gave
    // it explicit `width`/`height` — see portfolioR2f3PrintAxesInteraction for
    // why those are load-bearing; they are not interaction state.)
    assert.match(CSS_CODE, /\.nv-print-sheet \.nv-print-evo \{\s*display: block;/)
    assert.match(read('src/components/familyPortfolio/SummaryPrintSheet.tsx'), /Y_AXIS_GUTTER/)
  })

  test('no control was shrunk to accommodate the effect', () => {
    // The 32px icon targets stay 32px: the lift is a transform, which does not
    // change the hit area, and nothing was resized to make room for it.
    assert.match(read('src/components/familyPortfolio/SettingsGearButton.tsx'), /w-8 h-8/)
    assert.match(CODE, /w-8 h-8 shrink-0 rounded-full text-muted-fg/)
  })

  test('authorization and privacy are untouched by an interaction pass', () => {
    // A styling change must not have reached what the page is allowed to show.
    assert.match(CODE, /const portfolioScopes = scopes\.filter\(\(s\) => s\.id !== 'alternatives'\)/)
    assert.match(CODE, /portfolioScopes\.some\(\(s\) => s\.id === requested\)/)
    assert.match(CODE, /portfolioScopes\.length > 1 && activeScope &&/)
    assert.match(CODE, /<PrivacyToggle masked=\{masked\}/)
    // The selector still only changes the URL — no client-side scope grant.
    assert.match(CODE, /router\.replace\(`\/family-portfolio\?scope=\$\{encodeURIComponent\(next\)\}`/)
  })
})
