// R13.R2F4 § 1 — THE ALLOCATION LEGEND SITS TO THE RIGHT OF THE DONUT.
//
// WHY THIS SUITE EXISTS. The owner reported, twice, that the legend drops
// below the ring on a personal Summary, leaving dead space beside it. The
// previous pass answered it with WIDTH — Allocation was given a share of the
// row wide enough for `208px ring + 24px gap + 11rem legend` to fit side by
// side. That is a threshold, and a threshold can be crossed by something other
// than the viewport: the administrator's `labelPosition: 'outside'` setting
// adds 64px of leader padding to EACH side of the ring, taking the pair's
// required width from ~421px to ~549px, which no column of this row has below
// a ~1500px viewport. Nothing about the personal composition was wrong; the
// adjacency was simply never guaranteed.
//
// So this suite pins the GUARANTEE, not the arithmetic: the row may not wrap
// at `sm` and above, in either layout mode, whatever the settings say. The
// arithmetic is exercised too — as a property over every settings combination
// the dialog can actually produce — so a future change to the ring size, the
// gap or the legend basis fails here rather than in a print preview.
//
// NO PRIVATE DATA. Every number below is a layout constant read off the source.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const DONUT = read('src/components/familyPortfolio/AllocationDonut.tsx')
const DONUT_CODE = codeOf(DONUT)
const PANEL_CODE = codeOf(read('src/components/familyPortfolio/AllocationPanel.tsx'))
const PAGE_CODE = codeOf(read('src/app/portfolio/page.tsx'))

// ═══════════════════════════════════════════════════════════════════════════
// § 1 · THE NON-WRAP GUARANTEE
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F4 § 1 · the legend cannot fall below the donut at desktop', () => {
  test('the pair is explicitly non-wrapping from sm upward — in BOTH modes', () => {
    // Below `sm` the row still wraps, which is the correct mobile behaviour:
    // a 390px card cannot hold a 208px ring and a legend side by side.
    const rows = DONUT_CODE.match(/'relative flex [^']+'/g) ?? []
    assert.equal(rows.length, 2, 'exactly two container class strings: spread and compact')
    for (const row of rows) {
      assert.match(row, /flex-wrap sm:flex-nowrap/, `must not be able to wrap at sm+: ${row}`)
    }
  })

  test('it is the LEGEND that gives way, never the ring', () => {
    // The owner's constraint: "Do not shrink the donut merely to make the
    // layout fit." Under `flex-nowrap` the shrink factor decides who absorbs a
    // narrow column — so the svg is `shrink-0` and the legend carries `min-w-0`
    // with truncating labels.
    assert.match(DONUT_CODE, /className="shrink-0 max-w-full h-auto"/)
    assert.match(DONUT_CODE, /'flex flex-col gap-1\.5 min-w-0 basis-\[11rem\] grow/)
    assert.match(DONUT_CODE, /className="truncate min-w-0 text-foreground"/)
    // And the ring's nominal size is unchanged from the size the owner approved.
    assert.match(PANEL_CODE, /size=\{208\}/)
  })

  test('the guarantee holds for every settings combination the dialog can produce', () => {
    // The property the previous pass's width arithmetic did NOT have. `pad` is
    // read from the component itself so this cannot drift from the source.
    assert.match(DONUT_CODE, /const pad = settings\.labelPosition === 'outside' \? 64 : 0/)
    assert.match(DONUT_CODE, /const box = size \+ pad \* 2/)

    const ROOT_PX = 17 // globals.css: html { font-size: 17px }
    const GAP = 1.5 * ROOT_PX // gap-x-6
    const LEGEND_BASIS = 11 * ROOT_PX // basis-[11rem]
    const required = (labelPosition: string) => {
      const pad = labelPosition === 'outside' ? 64 : 0
      return 208 + pad * 2 + GAP + LEGEND_BASIS
    }

    // The narrowest desktop case: a 1280px viewport, minus the shell's 48px of
    // padding and ~15px of scrollbar, times Allocation's 5/12 of the row,
    // minus the panel's own 51px of horizontal padding.
    const available = ((1280 - 48 - 15) * 5) / 12 - 51

    // Under the DEFAULT settings the old wrap-based layout did fit — which is
    // exactly why the defect looked intermittent and was reported twice.
    assert.ok(required('legend_only') < available)
    // Under a setting the administrator can choose from the dialog, it did not.
    assert.ok(required('outside') > available, 'the outside-label setting crosses the wrap threshold')
    // `flex-nowrap` is what makes that second case a shrunken legend rather
    // than a legend under the ring. There is no width the row can be given
    // that removes the need for it.
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 1 · WHICH MODE EACH SCOPE RENDERS
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F4 § 1 · the personal Summary renders the legend-right mode', () => {
  test('personal opts into wide; Main keeps compact', () => {
    assert.match(PAGE_CODE, /layout=\{showNotes \? 'compact' : 'wide'\}/)
    // `showNotes` is the Main/personal discriminator the whole row already
    // keys off — not a second, separately-maintained scope test.
    assert.match(PAGE_CODE, /const showNotes = activeScope !== null && scopeHasWeeklyNotes\(activeScope\)/)
  })

  test('wide anchors the ring LEFT and lets the ledger reach the column edge', () => {
    assert.match(DONUT_CODE, /spread[\s\S]{0,140}?justify-start[^']*w-full max-w-full/)
    // The upper bound on the ledger is released only here — that release IS
    // the "use the available width" requirement.
    assert.ok(!/'flex flex-col gap-1\.5 min-w-0 basis-\[11rem\] grow'[^\n]*max-w/.test(DONUT_CODE))
  })

  test('Main keeps the centred, capped pair it was approved with', () => {
    assert.match(DONUT_CODE, /justify-center gap-x-6 gap-y-3 min-w-0 max-w-full/)
    assert.match(DONUT_CODE, /basis-\[11rem\] grow max-w-\[18rem\]/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 1 · THE REJECTED DOTTED LEADER
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F4 § 1 · the dotted leader is gone', () => {
  test('no leader rule is drawn between a category and its weight', () => {
    // Owner review, R13.R2F3 § 6: "The current excessively long dotted-leader /
    // empty-field effect should not remain if it looks visually stretched."
    assert.ok(!/border-dotted/.test(DONUT), 'the dotted leader must not return')
    assert.ok(!/mb-\[0\.3em\]/.test(DONUT), 'nor its baseline nudge')
  })

  test('the weight is pinned right by the ordinary ledger rule, in both modes', () => {
    // `ml-auto` unconditionally — label left, number right, the same convention
    // every other table in the app uses. The `spread ? '' : 'ml-auto'` branch
    // existed only to make room for the leader.
    assert.match(DONUT_CODE, /className="ui-number text-muted-fg shrink-0 ml-auto"/)
    assert.ok(!/spread \? '' : 'ml-auto'/.test(DONUT_CODE))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// § 1 · INVARIANTS THIS PASS MAY NOT HAVE BROKEN
// ═══════════════════════════════════════════════════════════════════════════

describe('R13.R2F4 § 1 · nothing else about the donut moved', () => {
  test('source order still puts the ring before the legend', () => {
    // The visual right-hand legend must come from normal flow — never from
    // `order-*` or `row-reverse`, which would desync the reading order and the
    // order a legend-hidden screen reader hears.
    const svgAt = DONUT_CODE.indexOf('<svg')
    const legendAt = DONUT_CODE.indexOf('settings.legendVisible && (')
    assert.ok(svgAt > 0 && legendAt > svgAt, 'the ring must precede the legend in source')
    assert.ok(!/order-\d|order-\[|flex-row-reverse|flex-wrap-reverse/.test(DONUT_CODE))
  })

  test('privacy and accessibility are untouched', () => {
    // Amounts still go through the one guarded path…
    assert.match(DONUT_CODE, /<MaskedAmount\s+value=\{s\.value\}\s+masked=\{masked\}/)
    // …the in-ring label still falls back to percentage-only under the mask…
    assert.match(DONUT_CODE, /if \(!wantsValue \|\| maskedEffective\) return \[pct\]/)
    // …the masked state is still announced…
    assert.match(DONUT_CODE, /\{maskedEffective && wantsValue && <span className="sr-only">/)
    // …and every slice is still a real focusable element with its own name.
    assert.match(DONUT_CODE, /tabIndex=\{0\}/)
    assert.match(DONUT_CODE, /aria-label=\{`\$\{s\.label\} \$\{formatWeightPct\(s\.weight\)\}`\}/)
    // Colour is still never the only carrier of meaning.
    assert.match(DONUT_CODE, /const svgLabel = settings\.legendVisible/)
  })

  test('the panel still forwards the mode rather than deciding it', () => {
    // One decision point (the page), so a future scope cannot acquire a
    // different allocation treatment by accident.
    assert.match(PANEL_CODE, /layout=\{layout\}/)
    assert.ok(!/activeScope|isMain|scope ===/.test(PANEL_CODE), 'the panel must not know about scopes')
  })
})
