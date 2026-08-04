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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('global blockers stay removed', () => {
  test('globals.css has no root min-width (the full-page-scroll crutch)', () => {
    const css = read('src/app/globals.css')
    assert.doesNotMatch(css, /min-width:\s*1200px/)
    assert.doesNotMatch(css, /html\s*{[^}]*min-width/s)
  })

  test('AppShell main uses responsive padding', () => {
    assert.match(read('src/components/layout/AppShell.tsx'), /px-3 py-4 sm:px-6 sm:py-5/)
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

  test('the shell centers content at the 1560px Fable max-width', () => {
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
  test('Home regions are 1-col below lg', () => {
    const src = read('src/app/page.tsx')
    const m = src.match(/grid grid-cols-1 lg:grid-cols-3 gap-4 items-start/g) ?? []
    assert.equal(m.length, 2, 'both Home regions collapse')
    assert.doesNotMatch(src, /"grid grid-cols-3 gap-4 items-start"/)
  })

  test('Home heat-map tiles drop to 2-wide on phones', () => {
    assert.match(read('src/app/page.tsx'), /grid grid-cols-2 sm:grid-cols-3 gap-2/)
  })

  test('Company page KPI strip, business panels and results row collapse', () => {
    const src = read('src/app/companies/[ticker]/page.tsx')
    assert.match(src, /grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3/)
    assert.match(src, /grid grid-cols-1 lg:grid-cols-3 gap-4/)
    assert.match(src, /grid grid-cols-1 lg:grid-cols-2 gap-4 items-start/)
  })

  // Phase 5H rebuilt Portfolio onto the Fable composition, which is
  // intrinsically responsive (wrapping flex rows with `min(100%, …)` bases and
  // an auto-fit minis grid) rather than breakpoint-classed. Updated
  // deliberately to the new conventions — the guarantee is unchanged and, if
  // anything, stronger: every column is asserted to collapse to full width.
  test('Portfolio Fable columns collapse to full width, and the metric grids reflow', () => {
    const src = read('src/app/portfolio/page.tsx')
    // All four Fable columns (hero, aside, table column, rail) carry a
    // `min(100%, …)` basis, so each wraps to full width below its threshold.
    assert.equal((src.match(/minWidth: 'min\(100%,/g) ?? []).length, 4, 'every Fable column collapses')
    // Both regions are wrapping flex rows, never fixed-column grids.
    assert.match(src, /flex flex-wrap items-stretch gap-3\.5/)
    assert.match(src, /flex flex-wrap items-start gap-3\.5/)
    // The hero's secondary-metric grid is auto-fit, never a fixed column count.
    assert.match(src, /repeat\(auto-fit, minmax\(120px, 1fr\)\)/)
    // The cash secondary metrics still reflow across breakpoints.
    assert.match(src, /grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3/)
    // The pre-Fable fixed 7-across capsule grid must not come back.
    assert.doesNotMatch(src, /xl:grid-cols-7/)
  })

  test('Macro US region stacks below xl', () => {
    assert.match(read('src/app/macro/page.tsx'), /grid-cols-1 xl:grid-cols-2/)
  })
})

describe('measured-height pinning only binds at lg+', () => {
  test('Home applies macroH/heatH via the --pin-h CSS variable', () => {
    const src = read('src/app/page.tsx')
    // ≥4: the four pinned columns (comments may mention the class too).
    assert.ok((src.match(/lg:h-\(--pin-h\)/g) ?? []).length >= 4, 'four pinned columns')
    assert.doesNotMatch(src, /style=\{\{ height: macroH/)
    assert.doesNotMatch(src, /style=\{\{ height: heatH/)
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
