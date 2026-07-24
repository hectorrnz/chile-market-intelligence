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

  test('Portfolio summary cards collapse', () => {
    const src = read('src/app/portfolio/page.tsx')
    assert.match(src, /grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3/)
    assert.match(src, /grid grid-cols-2 sm:grid-cols-5 gap-3/)
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
  for (const { file, minCount } of CASES) {
    test(`${file} has ≥${minCount} overflow-x-auto table wrapper(s)`, () => {
      const n = (read(file).match(/overflow-x-auto/g) ?? []).length
      assert.ok(n >= minCount, `${file}: found ${n}, expected ≥${minCount}`)
    })
  }
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
