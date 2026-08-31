// Responsive layout conventions — production audit 2026-07-21, updated for
// the Fable Phase 2 top-pill-navigation shell (2026-07-22).
//
// Root causes these lock in place:
//   1. globals.css carried `html { min-width: 1200px }`, forcing full-page
//      horizontal scroll on every viewport under 1200px.
//   2. Layout grids used bare `grid-cols-N` with no responsive prefix, so the
//      3-column dashboard never collapsed.
//   3. Dense tables sat in `overflow-hidden` / y-only wrappers and spilled
//      outside their cards instead of scrolling inside them.
//   4. Measured-height pinning (macroH/heatH/valH) was applied via inline
//      style, locking stacked mobile cards to an unrelated card's height.
//   5. The old left sidebar was a fixed 208px column at every width with no
//      drawer. It has been replaced by a glass top pill rail (desktop) + an
//      accessible mobile nav drawer — see the "primary navigation" block
//      below, which supersedes the old "sidebar" block.
//
// These are source-scan checks (no browser) — they can't prove pixel-perfect
// rendering, but they make the load-bearing class conventions impossible to
// silently revert.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('global blockers stay removed', () => {
  test('globals.css has no root min-width (the full-page-scroll crutch)', () => {
    const css = read('src/app/globals.css')
    assert.doesNotMatch(css, /min-width:\s*1200px/)
    assert.doesNotMatch(css, /html\s*{[^}]*min-width/s)
  })

  test('AppShell main uses responsive padding and may shrink inside the shell flex column', () => {
    const src = read('src/components/layout/AppShell.tsx')
    assert.match(src, /flex-1 min-h-0 overflow-y-auto/)
    assert.match(src, /px-3 py-4 sm:px-6 sm:py-5/)
  })
})

describe('primary navigation: desktop pill rail + accessible mobile drawer', () => {
  test('the desktop pill rail is hidden below lg', () => {
    const src = read('src/components/layout/PrimaryNav.tsx')
    assert.match(src, /hidden lg:flex/)
  })

  test('the pill rail scrolls internally with a hidden scrollbar instead of forcing page overflow', () => {
    const src = read('src/components/layout/PrimaryNav.tsx')
    assert.match(src, /overflow-x-auto nv-scrollbar-hidden/)
  })

  test('the contextual secondary row is also hidden below lg', () => {
    const src = read('src/components/layout/SecondaryNav.tsx')
    assert.match(src, /hidden lg:flex/)
  })

  test('the mobile drawer is hidden at lg and above, and closes on navigate', () => {
    const src = read('src/components/layout/MobileNavDrawer.tsx')
    assert.match(src, /lg:hidden/)
    assert.match(src, /onClick=\{closeNav\}/)
  })

  test('the mobile drawer is a real dialog: modal role, focus trap, Escape, restored focus, locked body scroll', () => {
    const src = read('src/components/layout/MobileNavDrawer.tsx')
    assert.match(src, /role="dialog"/)
    assert.match(src, /aria-modal="true"/)
    assert.match(src, /useEscape\(open, closeNav\)/)
    assert.match(src, /addEventListener\('keydown', onKeydown\)/, 'Tab is trapped inside the drawer')
    assert.match(src, /returnFocusRef\.current\?\.focus\(\)/, 'focus is restored to the trigger on close')
    assert.match(src, /document\.body\.style\.overflow = 'hidden'/, 'body scroll is locked while open')
  })

  test('the old Sidebar/SidebarProvider files are gone, not just unused', () => {
    assert.throws(() => read('src/components/layout/Sidebar.tsx'))
    assert.throws(() => read('src/components/providers/SidebarProvider.tsx'))
  })

  test('MobileNavProvider drawer-open state is plain, not persisted (a drawer must never restore open on load)', () => {
    const src = read('src/components/providers/MobileNavProvider.tsx')
    assert.match(src, /useState\(false\)/)
    assert.doesNotMatch(src, /usePersistentState/)
  })

  test('AppShell mounts the hamburger-driven drawer exactly once, not a second nav system', () => {
    const src = read('src/components/layout/AppShell.tsx')
    assert.match(src, /<TopBar \/>/)
    assert.match(src, /<SecondaryNav \/>/)
    assert.match(src, /<MobileNavDrawer \/>/)
    assert.doesNotMatch(src, /<Sidebar/)
  })

  test('the shell centers content at the tokenised Fable max-width', () => {
    const src = read('src/components/layout/AppShell.tsx')
    assert.match(src, /max-w-\(--content-max-w\)/)
    assert.match(src, /mx-auto/)
  })
})

describe('topbar compresses instead of overflowing', () => {
  const src = read('src/components/layout/TopBar.tsx')
  test('left group can shrink and the title truncates', () => {
    assert.match(src, /flex items-center gap-2\.5 shrink min-w-0/)
    assert.match(src, /font-medium truncate/)
  })
  test('informational date hides on narrow viewports', () => {
    assert.match(src, /hidden xl:inline">{today}/)
  })
})

describe('dashboard grids collapse', () => {
  // Phase R10 rebuilt Home onto the Fable composition; R10.3 (the
  // user-directed width/density rebalance) put the analytical modules into
  // two responsive PEER grids — 1 col below lg, 2 cols at lg with the third
  // card spanning both (never an isolated narrow card), 3 similar-weight cols
  // from xl. The hero row keeps its asymmetric wrapping-flex composition.
  // Updated deliberately — the guarantee is unchanged: every region collapses
  // to one column on phones, and no fixed unprefixed multi-col grid exists.
  test('Home analytical rows are responsive peer grids; the hero row still wraps', () => {
    const src = read('src/app/page.tsx')
    assert.match(src, /ANALYTIC_ROW = 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch'/)
    assert.equal((src.match(/className=\{ANALYTIC_ROW\}/g) ?? []).length, 2, 'Row A and Row B share the one responsive grid recipe')
    assert.match(src, /ANALYTIC_SPAN = 'lg:col-span-2 xl:col-span-1'/)
    assert.doesNotMatch(src, /"grid grid-cols-3 gap-4 items-start"/)
    // Hero columns still carry a `min(100%, …)` basis so each wraps to full
    // width below its threshold — none can force horizontal overflow.
    assert.ok((src.match(/minWidth: 'min\(100%,/g) ?? []).length >= 3, 'every hero flex column collapses')
    assert.ok((src.match(/flex flex-wrap items-stretch gap-4/g) ?? []).length >= 1, 'the hero row wraps')
  })

  test('Home heat-map tiles are 2-across — sized for the one-third-width Row B card (R10.3)', () => {
    const src = read('src/app/page.tsx')
    assert.match(src, /grid grid-cols-2 gap-2/)
    assert.doesNotMatch(src, /sm:grid-cols-3/)
  })

  test('Company page KPI strip, business panels and results row collapse', () => {
    const src = read('src/app/companies/[ticker]/page.tsx')
    assert.match(src, /grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3/)
    assert.match(src, /grid grid-cols-1 lg:grid-cols-3 gap-4/)
    assert.match(src, /grid grid-cols-1 lg:grid-cols-2 gap-4 items-start/)
  })

  // POST-R13.5 — Phase 5H's Fable composition belonged to the retired
  // positions tracker. The R13 Portfolio now on `/portfolio` has its own
  // responsive conventions, asserted in full by the Family Portfolio section
  // lower in this file (FP_DIRS / FP_PAGES) — so this is not a coverage gap, it
  // is the same guarantee asserted against the page that actually exists.
  test('the retired positions tracker took its Fable column composition with it', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/api/portfolios')))
    assert.ok(!read('src/app/portfolio/page.tsx').includes('FABLE_HERO'))
  })

  test('Macro US region stacks below xl', () => {
    assert.match(read('src/app/macro/page.tsx'), /grid-cols-1 xl:grid-cols-2/)
  })
})

describe('measured-height pinning only binds at lg+', () => {
  // Phase R10 removed Home's measured-height pinning entirely: cards take
  // natural height and dense lists scroll inside their card via a maxHeight
  // cap instead — so stacked mobile cards can never be locked to an unrelated
  // driver card's height. The old guarantee (no inline height lock) endures.
  test('Home no longer pins card heights — natural height + in-card scroll', () => {
    const src = read('src/app/page.tsx')
    assert.equal((src.match(/lg:h-\(--pin-h\)/g) ?? []).length, 0, 'no pinned columns remain')
    assert.doesNotMatch(src, /style=\{\{ height: macroH/)
    assert.doesNotMatch(src, /style=\{\{ height: heatH/)
    assert.doesNotMatch(src, /ResizeObserver/)
    // Vertical containment moved to card-level scroll caps. News is the
    // terminal region, so it also owns an explicit size-contained scrollport;
    // clipped descendants cannot inflate AppShell's page scroll range.
    assert.ok((src.match(/maxHeight/g) ?? []).length >= 3, 'dense Home lists cap and scroll in-card')
    assert.match(src, /NEWS_SCROLL_BLOCK_SIZE = 'min\(440px, 60vh\)' as const/)
    assert.match(src, /blockSize: NEWS_SCROLL_BLOCK_SIZE, contain: 'strict'/)
  })

  test('Company page applies valH the same way', () => {
    const src = read('src/app/companies/[ticker]/page.tsx')
    assert.match(src, /lg:h-\(--pin-h\)/)
    assert.doesNotMatch(src, /style=\{\{ height: valH/)
  })
})

describe('dense tables scroll inside their card', () => {
  const CASES: { file: string; minCount: number }[] = [
    { file: 'src/app/stocks/page.tsx', minCount: 1 },
    { file: 'src/app/watchlist/page.tsx', minCount: 1 },
    { file: 'src/app/portfolio/page.tsx', minCount: 3 },
    { file: 'src/app/macro/page.tsx', minCount: 2 },
    { file: 'src/app/earnings/page.tsx', minCount: 2 },
    { file: 'src/app/compare/page.tsx', minCount: 3 },
    { file: 'src/app/structured-notes/[id]/page.tsx', minCount: 3 },
    { file: 'src/app/page.tsx', minCount: 1 },
  ]
  // Phase 5A (Fable /stocks re-skin): a page may now satisfy this either by
  // owning an `overflow-x-auto` wrapper itself, or by delegating to the shared
  // <TableCard minWidth={…}> container — which supplies exactly the same
  // in-card scroll. The guarantee is unchanged; the assertion follows where it
  // now lives (and the delegation itself is proven by the test below, so this
  // is not an escape hatch).
  const scrollWrappers = (file: string) =>
    (read(file).match(/overflow-x-auto|minWidth=\{/g) ?? []).length

  for (const { file, minCount } of CASES) {
    test(`${file} has ≥${minCount} card-level horizontal scroll wrapper(s)`, () => {
      const n = scrollWrappers(file)
      assert.ok(n >= minCount, `${file}: found ${n}, expected ≥${minCount}`)
    })
  }

  test('TableCard really provides the in-card scroll it is trusted with', () => {
    const src = read('src/components/fable/TableCard.tsx')
    assert.match(src, /overflow-x-auto/, 'TableCard must own the horizontal scroll container')
    assert.match(src, /minWidth\s*\?\s*\{\s*minWidth\s*\}/, 'TableCard must apply the caller-supplied minWidth')
  })

  test('Stocks keeps its 760px table floor while scrolling inside the card', () => {
    assert.match(read('src/app/stocks/page.tsx'), /minWidth=\{760\}/)
  })

  // Phase 5B: same delegation, same guarantee, the watchlist table's own floor.
  test('Watchlist keeps its 620px table floor while scrolling inside the card', () => {
    assert.match(read('src/app/watchlist/page.tsx'), /minWidth=\{620\}/)
  })

  // R9.4: the Settings recipients table — Email · Label · Active · Remove.
  test('Settings recipients keeps its 560px table floor while scrolling inside the card', () => {
    const src = read('src/app/settings/NotificationRecipientsCard.tsx')
    assert.match(src, /minWidth=\{560\}/)
    // The scroll is TableCard's, never a page-level workaround of its own.
    assert.doesNotMatch(src, /overflow-x-auto|overflow-x-scroll/)
  })
})

// R9.4 — the one form added to Settings must stack rather than pin fixed widths.
describe('the Settings recipient form stacks instead of overflowing', () => {
  const src = read('src/app/settings/NotificationRecipientsCard.tsx')

  test('inputs are full-width from a flex basis — no fixed w-64/w-48 field', () => {
    assert.doesNotMatch(src, /\bw-64\b|\bw-48\b|\bw-36\b|\bw-\[\d+px\]/)
    assert.match(src, /h-8 w-full rounded-\[var\(--radius-input\)\]/)
    assert.equal((src.match(/grow shrink basis-\[\d+px\] min-w-0/g) ?? []).length, 2)
  })

  test('the form wraps and is full width until lg, where it becomes a toolbar', () => {
    assert.match(src, /flex flex-wrap items-end gap-2 w-full lg:w-auto/)
    assert.match(src, /flex flex-col gap-2 w-full lg:w-auto/)
  })

  test('long emails and labels wrap inside their cell', () => {
    assert.match(src, /font-mono break-all/)
    assert.match(src, /text-muted-fg break-words/)
  })

  // R9.5 audit repair: the same address also appears in the remove-confirmation
  // dialog, which CLIPS (`overflow-hidden`) rather than scrolls. An email is one
  // unbreakable token, so an unwrapped one could be cut off at 320px in the one
  // place that has to state exactly what is about to be deleted.
  test('the confirmation dialog wraps the recipient it names', () => {
    const el = src.slice(src.indexOf('<DestructiveConfirm'))
    const desc = el.slice(el.indexOf('description={'), el.indexOf('confirmLabel='))
    assert.match(desc, /<span className="break-all">\{confirming\.email\}<\/span>/)
    assert.match(desc, /<span className="break-words"> · \{confirming\.label\}<\/span>/)
    // The shell still keeps a viewport gutter and caps its own width.
    const modal = read('src/components/fable/ModalShell.tsx')
    assert.match(modal, /fixed inset-0 z-\[90\] flex items-start justify-center pt-\[8vh\] px-4/)
    assert.match(modal, /sm: 'max-w-sm'/)
  })
})

// R9.6 — Privacy Mode must not become a layout event. The mask is a short inline
// token inside the cell that already existed, so cards and columns keep their
// geometry whether it is on or off.
describe('the privacy mask is layout-neutral', () => {
  const boundary = read('src/components/fable/PrivacyValue.tsx')

  test('the mask is an inline span with no width, height or block behaviour of its own', () => {
    assert.doesNotMatch(boundary, /\bw-\[|\bh-\[|\bmin-w-|\bmax-w-|block|absolute|fixed/)
    assert.match(boundary, /<span className=\{`ui-number tracking-wide \$\{className\}`\}/)
    // It never adds an overflow container that could nest inside a scrolling card.
    assert.doesNotMatch(boundary, /overflow-/)
  })

  test('masking is applied inside the existing cell, never around it', () => {
    // POST-R13.5 — the sample surface was the retired positions tracker. The
    // same property is asserted against the R13 Portfolio Summary, which is the
    // page carrying masked values on `/portfolio` now: a <td> wrapped in the
    // boundary would move the column, so the boundary always sits INSIDE the
    // cell that already set the alignment and padding.
    const portfolio = read('src/app/portfolio/page.tsx')
    assert.doesNotMatch(portfolio, /<PrivacyValue[^>]*>\s*\n?\s*<td/)
    assert.doesNotMatch(portfolio, /<MaskedAmount[^>]*>\s*\n?\s*<td/)
    // Its card-local scroll floors are untouched by the mask.
    assert.match(portfolio, /minWidth=\{\d+\}/)
  })

  test('the Settings privacy row reuses PreferenceRow — no new responsive shape', () => {
    const client = read('src/app/settings/SettingsClient.tsx')
    assert.equal((client.match(/<PreferenceRow/g) ?? []).length, 3)
    // The Switch is right-aligned exactly like the two selectors above it, and
    // the row's own flex-wrap is what lets it drop at a narrow width.
    assert.equal((client.match(/className="shrink-0 ml-auto"/g) ?? []).length, 3)
    assert.match(client, /\$\{ROW\} flex-wrap/)
    assert.doesNotMatch(client, /\bw-\[\d+px\]/)
  })
})

describe('shared components wrap instead of overflowing', () => {
  test('SectionHeader wraps its actions row', () => {
    const src = read('src/components/ui/SectionHeader.tsx')
    assert.match(src, /flex flex-wrap items-start/)
    assert.match(src, /min-w-0/)
  })

  test('NotificationBell drawer is capped to the viewport', () => {
    // Phase 3 (Fable): restyled from an anchored dropdown to a full right-edge
    // drawer (Fable spec: right `min(390px,94vw)`) — still always narrower
    // than the viewport at any width, just via a different responsive unit.
    assert.match(read('src/components/ui/NotificationBell.tsx'), /w-\[min\(390px,94vw\)\]/)
  })
})

// ─── R13.R5G · Family Portfolio responsive conventions ───────────────────────
//
// R13 built the Family Portfolio (Summary · Holdings · Weekly Changes ·
// Alternatives Dashboard / Holdings / Cash Flows) after every convention above
// was already established, so none of it was covered here. R13.R5 verified
// these surfaces in the browser down to 390px; this block makes the class
// recipes that produced that result impossible to revert silently.
//
// Source scans, not pixel snapshots — they assert the load-bearing recipe, never
// a rendered measurement, so a legitimate visual change never has to fight them.

const FP_DIRS = ['src/app/portfolio', 'src/components/familyPortfolio'] as const

/** Every .tsx under the Family Portfolio, so a NEW surface is covered the day it lands. */
function fpFiles(): string[] {
  const out: string[] = []
  for (const dir of FP_DIRS) {
    for (const entry of readdirSync(join(ROOT, dir), { recursive: true }) as string[]) {
      const rel = [dir, ...String(entry).split(sep)].join('/')
      if (rel.endsWith('.tsx')) out.push(rel)
    }
  }
  return out.sort()
}

const FP_SURFACES = {
  summary: 'src/app/portfolio/page.tsx',
  holdings: 'src/app/portfolio/holdings/page.tsx',
  weeklyChanges: 'src/app/portfolio/weekly-changes/page.tsx',
  altDashboard: 'src/app/portfolio/alternatives/page.tsx',
  altHoldings: 'src/app/portfolio/alternatives/holdings/page.tsx',
  altCashFlows: 'src/app/portfolio/alternatives/cash-flows/page.tsx',
  admin: 'src/app/portfolio/admin/page.tsx',
} as const

describe('Family Portfolio: every multi-column grid collapses to one column', () => {
  // The single defect this whole convention exists to prevent (root cause #2 at
  // the top of this file): a bare `grid-cols-3` that never collapses, so a
  // three-column analytical row survives onto a phone and forces page-level
  // horizontal scroll.
  const GRID = /(.?)grid-cols-([A-Za-z0-9[\](),_%.-]+)/g

  /** The class string a match sits inside — bounded by the nearest quote/backtick. */
  function classWindow(src: string, at: number): string {
    const before = src.slice(0, at)
    const open = Math.max(before.lastIndexOf("'"), before.lastIndexOf('"'), before.lastIndexOf('`'))
    const after = src.slice(at)
    const ends = [after.indexOf("'"), after.indexOf('"'), after.indexOf('`')].filter((i) => i >= 0)
    return src.slice(open + 1, at + Math.min(...ends))
  }

  const multiColumn = fpFiles().flatMap((rel) => {
    const src = read(rel)
    return [...src.matchAll(GRID)]
      .filter((m) => m[2] !== '1')
      .map((m) => ({
        where: `${rel}:${src.slice(0, m.index).split('\n').length}`,
        prefixChar: m[1],
        cls: `grid-cols-${m[2]}`,
        window: classWindow(src, m.index),
      }))
  })

  test('the scan actually found the grids it is guarding (it cannot pass by finding nothing)', () => {
    assert.ok(multiColumn.length >= 15, `expected the FP multi-column grids, found ${multiColumn.length}`)
  })

  test('every multi-column grid carries a responsive prefix', () => {
    for (const g of multiColumn) {
      assert.equal(g.prefixChar, ':', `${g.where}: bare "${g.cls}" never collapses — prefix it (sm:/lg:/xl:)`)
    }
  })

  test('every multi-column grid declares a one-column base in the same class string', () => {
    // A prefixed track with no base inherits whatever `grid` defaults to, which
    // is one column today but is not stated — so the collapse would be
    // accidental rather than declared. Each of these says it outright.
    for (const g of multiColumn) {
      assert.match(g.window, /(^|\s)grid-cols-1(\s|$)/, `${g.where}: "${g.cls}" has no grid-cols-1 base`)
    }
  })

  test('no element is pinned to a fixed width — every w-[…] is a max-w/min-w bound', () => {
    // A fixed-width cell or control is the other way a table forces the page
    // wider than the viewport. The Family Portfolio uses `max-w-[…rem]` purely
    // as a truncation ceiling on long labels (with `title` restating them).
    for (const rel of fpFiles()) {
      const src = read(rel)
      for (const m of src.matchAll(/(.{0,4})\bw-\[([^\]]+)\]/g)) {
        const line = src.slice(0, m.index).split('\n').length
        assert.match(
          m[1],
          /(max-|min-)$/,
          `${rel}:${line}: fixed w-[${m[2]}] — use max-w-/min-w- so the element can shrink`,
        )
      }
    }
  })
})

describe('Family Portfolio: dense tables scroll inside their own card', () => {
  // Each floor is the width that table's own columns need. Locking the exact
  // value keeps a change deliberate: widening a table without revisiting its
  // floor is what puts a column off the right edge on a phone.
  const FLOORS: { file: string; floors: number[] }[] = [
    { file: FP_SURFACES.summary, floors: [760] },
    { file: FP_SURFACES.holdings, floors: [760] },
    { file: FP_SURFACES.weeklyChanges, floors: [560, 760] },
    { file: FP_SURFACES.altHoldings, floors: [1080] },
    { file: FP_SURFACES.altCashFlows, floors: [720] },
    { file: FP_SURFACES.admin, floors: [720] },
  ]

  for (const { file, floors } of FLOORS) {
    test(`${file} keeps its ${floors.join('/')}px table floor inside TableCard`, () => {
      const src = read(file)
      for (const w of floors) assert.ok(src.includes(`minWidth={${w}}`), `${file}: missing minWidth {${w}}`)
      // The scroll stays TableCard's own container — never a page-level
      // workaround that would move the scrollbar onto the document.
      assert.doesNotMatch(src, /overflow-x-scroll/)
    })
  }

  test('the Alternatives drilldown tables own their in-card scroll directly', () => {
    // These render inside a DetailPanel rather than a TableCard, so they carry
    // the same pairing themselves: a scroll container plus a table floor.
    const src = read('src/components/familyPortfolio/AlternativesDrilldowns.tsx')
    const wrappers = (src.match(/<div className="overflow-x-auto">/g) ?? []).length
    const floors = (src.match(/min-w-\[520px\]/g) ?? []).length
    assert.equal(wrappers, 3, 'every drilldown table sits in its own scroll container')
    assert.equal(floors, wrappers, 'and each one carries a table floor')
  })

  test('long table labels truncate inside their cell instead of widening the row', () => {
    for (const rel of [FP_SURFACES.weeklyChanges, FP_SURFACES.altHoldings, FP_SURFACES.altCashFlows]) {
      assert.match(
        read(rel),
        /className="block truncate max-w-\[\d+rem\]" title=/,
        `${rel}: a long label must truncate, with title restating it in full`,
      )
    }
    // The hierarchy's own indented label cell shrinks rather than pushes.
    assert.match(read('src/components/familyPortfolio/HierarchicalTable.tsx'), /flex items-center gap-1\.5 min-w-0/)
  })

  test('TableCard is still the component all of this trusts', () => {
    const card = read('src/components/fable/TableCard.tsx')
    assert.match(card, /overflow-x-auto/)
    assert.match(card, /minWidth \? \{ minWidth \} : undefined/)
  })
})

describe('Family Portfolio: no card is pinned to a fixed height', () => {
  // Root cause #4 at the top of this file, in its Family Portfolio form. A
  // stacked mobile card locked to an unrelated driver card's height is the bug
  // the `--pin-h` convention was introduced to end; R13 avoids it by never
  // pinning at all, which is simpler and cannot regress at a new breakpoint.
  test('no measured-height pinning and no fixed page/card height anywhere', () => {
    for (const rel of fpFiles()) {
      const src = read(rel)
      assert.doesNotMatch(src, /--pin-h/, `${rel}: height pinning must not return`)
      assert.doesNotMatch(src, /\bh-\[\d+px\]/, `${rel}: fixed pixel card height`)
    }
  })

  test('vertical containment is a scroll cap on the table, not a height on the card', () => {
    // maxHeight caps the SCROLLPORT (TableCard pairs it with overflowY:auto),
    // so the card keeps its natural height and the rows scroll inside it.
    for (const rel of [FP_SURFACES.holdings, FP_SURFACES.weeklyChanges, FP_SURFACES.altHoldings, FP_SURFACES.altCashFlows]) {
      assert.match(read(rel), /maxHeight=\{640\}/, `${rel}: a long table must cap and scroll in-card`)
    }
    const card = read('src/components/fable/TableCard.tsx')
    assert.match(card, /maxHeight != null \? \{ maxHeight, overflowY: 'auto' \}/)
  })

  test('the only inline heights left are chart bar geometry, not layout', () => {
    // A bar drawn at a computed height IS the drawing; anything else would be a
    // layout lock. This keeps that distinction honest as new surfaces land.
    const offenders: string[] = []
    for (const rel of fpFiles()) {
      if (rel.endsWith('Chart.tsx')) continue
      const src = read(rel)
      for (const m of src.matchAll(/style=\{\{\s*height:/g)) {
        offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length}`)
      }
    }
    assert.deepEqual(offenders, [], 'inline height outside a chart component')
  })
})

describe('Family Portfolio: charts and controls are viewport-safe', () => {
  test('charts size themselves from their container, never a fixed pixel width', () => {
    for (const rel of [
      'src/components/familyPortfolio/PortfolioEvolutionChart.tsx',
      'src/components/familyPortfolio/ContributionChart.tsx',
    ]) {
      assert.match(read(rel), /new ResizeObserver\(/, `${rel}: must measure its container`)
    }
    // The evolution chart redraws into a measured viewBox at 100% width, so it
    // reflows rather than being scaled (which would shrink its axis text too).
    const evo = read('src/components/familyPortfolio/PortfolioEvolutionChart.tsx')
    assert.ok(evo.includes('viewBox={`0 0 ${w} ${height}`}'))
    assert.ok(evo.includes('width="100%"'))
    // The donut scales down with its column instead of setting the column width.
    assert.ok(read('src/components/familyPortfolio/AllocationDonut.tsx').includes('shrink-0 max-w-full h-auto'))
    // The cash-flow bars scroll inside the card when there are more periods than
    // fit, and still fill it when there are fewer (`w-max min-w-full`).
    const cf = read('src/components/familyPortfolio/AlternativesCashFlowChart.tsx')
    assert.ok(cf.includes('overflow-x-auto nv-scrollbar-hidden'))
    assert.ok(cf.includes('flex items-end gap-2 w-max min-w-full'))
  })

  test('the section rails scroll internally instead of forcing page overflow', () => {
    for (const rel of [
      'src/components/familyPortfolio/FamilyPortfolioNav.tsx',
      'src/components/familyPortfolio/AlternativesSubnav.tsx',
    ]) {
      const src = read(rel)
      assert.ok(src.includes('overflow-x-auto nv-scrollbar-hidden'), `${rel}: the rail must scroll itself`)
      assert.ok(src.includes('shrink-0 whitespace-nowrap'), `${rel}: pills keep their label rather than compressing`)
    }
  })

  test('the Alternatives filter bar wraps and its dropdown is capped to the viewport', () => {
    const src = read('src/components/familyPortfolio/AlternativesFilters.tsx')
    assert.ok(src.includes('flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0'))
    // A menu wider than the screen is unreachable — this one never can be.
    assert.ok(src.includes('max-w-[min(18rem,calc(100vw-2rem))]'))
    assert.ok(src.includes('min-w-0 truncate'))
  })

  test('the Summary header controls wrap and scroll rather than widening the page', () => {
    const src = read(FP_SURFACES.summary)
    assert.ok(src.includes('flex items-center gap-2 flex-wrap min-w-0 max-w-full'))
    assert.ok((src.match(/max-w-full overflow-x-auto nv-scrollbar-hidden/g) ?? []).length >= 2)
  })
})

describe('Family Portfolio: the corrected Weekly Performance basis grid stays mobile-safe', () => {
  // R13.R5B aligned the two Weekly Performance rows so "excl. Chilean equities"
  // begins at the same x in both. That fix introduced the only fixed-track grid
  // in the strip — so it is also the one place a two-across measure could reach
  // a phone. It stacks, and the stacking is what this asserts. (R5B's own test
  // covers the alignment itself; this covers its responsive half.)
  const STRIP = read('src/components/familyPortfolio/PerformanceMarketsStrip.tsx')

  test('each per-basis track stacks to one column below lg', () => {
    const tracks = [...STRIP.matchAll(/\d: '(grid-cols-1 lg:grid-cols-\d)'/g)].map((m) => m[1])
    assert.ok(tracks.length >= 2, 'the basis tracks must be literal class strings Tailwind can scan')
    for (const cls of tracks) assert.ok(cls.startsWith('grid-cols-1 '), `${cls} must stack below lg`)
  })

  test('alignment engages only where the grid exists, so every other row still flows', () => {
    // Below lg the grid is one column and the two bases read one above the
    // other — the same order the flow layout gives, never a squeeze.
    assert.match(STRIP, /const aligned = columns > 1 && BASIS_COLUMNS\[columns\] !== undefined/)
    assert.ok(STRIP.includes('flex flex-wrap ${'), 'the non-aligned rows keep the wrapping flow')
  })
})
