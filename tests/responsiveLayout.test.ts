// Responsive layout conventions — production audit 2026-07-21.
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
//   5. The sidebar was a fixed 208px column at every width with no drawer.
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

describe('sidebar: desktop column + mobile drawer', () => {
  test('static aside is hidden below lg', () => {
    const src = read('src/components/layout/Sidebar.tsx')
    assert.match(src, /hidden lg:flex/)
  })

  test('a mobile overlay drawer exists and closes on navigate', () => {
    const src = read('src/components/layout/Sidebar.tsx')
    assert.match(src, /lg:hidden/)
    assert.match(src, /mobileOpen/)
    assert.match(src, /onNavigate/)
  })

  test('SidebarProvider toggle is viewport-aware and the drawer is never persisted', () => {
    const src = read('src/components/providers/SidebarProvider.tsx')
    assert.match(src, /matchMedia\('\(min-width: 1024px\)'\)/)
    assert.match(src, /useState\(false\)/, 'mobileOpen is plain state, not usePersistentState')
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

  test('NotificationBell dropdown is capped to the viewport', () => {
    assert.match(read('src/components/ui/NotificationBell.tsx'), /max-w-\[calc\(100vw-1\.5rem\)\]/)
  })
})
