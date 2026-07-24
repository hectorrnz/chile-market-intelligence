// Fable Phase 2 — top pill navigation. Pure-logic tests for src/lib/navigation.ts
// (real assertions, not source-scan) plus source-scan checks for the shell
// components that can't be unit-tested directly (this project has no
// DOM/rendering test harness — see tests/responsiveLayout.test.ts for the
// established convention).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { navGroups, resolveActiveGroup, resolveActiveChild, getPageTitle, MACRO_REGIONS } from '../src/lib/navigation.ts'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const t = dict.en

describe('navGroups — every existing route stays reachable', () => {
  test('exactly the 8 specified primary groups, in order', () => {
    assert.deepEqual(
      navGroups.map((g) => g.key),
      ['overview', 'markets', 'analysis', 'macro', 'earnings', 'portfolio', 'structuredNotes', 'settings'],
    )
  })

  test('every group + child href is a real, distinct app route', () => {
    const hrefs = navGroups.flatMap((g) => [g.href, ...(g.children ?? []).map((c) => c.href)])
    const expected = [
      '/', '/stocks', '/stocks', '/watchlist', '/compare', '/compare', '/chart-builder',
      '/macro', '/macro', '/macro/calendar', '/earnings', '/portfolio', '/structured-notes',
      '/settings/notifications',
    ]
    assert.deepEqual(hrefs.sort(), expected.sort())
  })

  test('Settings is newly discoverable in nav (it was reachable only by direct URL before)', () => {
    const settings = navGroups.find((g) => g.key === 'settings')
    assert.equal(settings?.href, '/settings/notifications')
  })

  test('every group has a non-empty EN and ES label', () => {
    for (const g of navGroups) {
      assert.ok(g.label(dict.en).length > 0, `${g.key} EN label`)
      assert.ok(g.label(dict.es).length > 0, `${g.key} ES label`)
      for (const c of g.children ?? []) {
        assert.ok(c.label(dict.en).length > 0, `${g.key}.${c.key} EN label`)
        assert.ok(c.label(dict.es).length > 0, `${g.key}.${c.key} ES label`)
      }
    }
  })
})

describe('resolveActiveGroup / resolveActiveChild', () => {
  const cases: { path: string; group: string; child?: string }[] = [
    { path: '/', group: 'overview' },
    { path: '/stocks', group: 'markets', child: 'stocks' },
    { path: '/watchlist', group: 'markets', child: 'watchlist' },
    { path: '/companies/SQM-B', group: 'markets', child: 'stocks' },
    { path: '/compare', group: 'analysis', child: 'compare' },
    { path: '/chart-builder', group: 'analysis', child: 'charting' },
    { path: '/macro', group: 'macro', child: 'macroIndicators' },
    { path: '/macro/calendar', group: 'macro', child: 'macroCalendar' },
    { path: '/earnings', group: 'earnings' },
    { path: '/portfolio', group: 'portfolio' },
    { path: '/structured-notes', group: 'structuredNotes' },
    { path: '/structured-notes/XS3180975347', group: 'structuredNotes' },
    { path: '/settings/notifications', group: 'settings' },
  ]

  for (const c of cases) {
    test(`${c.path} → group ${c.group}${c.child ? ` / child ${c.child}` : ''}`, () => {
      const group = resolveActiveGroup(c.path)
      assert.equal(group?.key, c.group)
      const child = resolveActiveChild(c.path, group)
      assert.equal(child?.key, c.child)
    })
  }

  test('unrelated paths (auth pages) resolve to no group', () => {
    assert.equal(resolveActiveGroup('/login'), undefined)
    assert.equal(resolveActiveGroup('/forgot-password'), undefined)
    assert.equal(resolveActiveGroup('/auth/reset-password'), undefined)
  })

  test('a bare prefix collision does not false-match (e.g. no route starts with /macronew)', () => {
    assert.equal(resolveActiveGroup('/macronew')?.key, undefined)
  })
})

describe('getPageTitle', () => {
  test('company ticker page shows "Stocks · TICKER"', () => {
    assert.equal(getPageTitle('/companies/sqm-b', 'en', t), `${t.stocks.tag} · SQM-B`)
  })

  test('settings page now resolves a real title (previously fell through to the app name)', () => {
    assert.equal(getPageTitle('/settings/notifications', 'en', t), t.nav.settings)
  })

  test('macro sub-routes resolve distinct titles', () => {
    assert.equal(getPageTitle('/macro', 'en', t), t.nav.macroIndicators)
    assert.equal(getPageTitle('/macro/calendar', 'en', t), t.nav.macroCalendar)
  })

  test('unknown routes fall back to the app name', () => {
    assert.equal(getPageTitle('/login', 'en', t), 'Nevada Market Intelligence')
  })
})

describe('Macro region control is preserved verbatim across the new shell', () => {
  test('MACRO_REGIONS is Chile + US', () => {
    assert.deepEqual(MACRO_REGIONS.map((r) => r.rg), ['CL', 'US'])
  })

  for (const file of ['src/components/layout/SecondaryNav.tsx', 'src/components/layout/MobileNavDrawer.tsx']) {
    test(`${file} writes cmi.macroRegion and dispatches macro:region, same as before`, () => {
      const src = read(file)
      assert.match(src, /usePersistentState<'CL' \| 'US'>\('cmi\.macroRegion', 'CL'\)/)
      assert.match(src, /new CustomEvent\('macro:region', \{ detail: rg \}\)/)
    })
  }

  test('the Macro page itself is untouched — still listens for the same event', () => {
    const src = read('src/app/macro/page.tsx')
    assert.match(src, /window\.addEventListener\('macro:region', h\)/)
    assert.match(src, /usePersistentState<Region>\('cmi\.macroRegion', 'CL'\)/)
  })
})

describe('accessibility: aria-current, semantic nav, no color-only state', () => {
  test('PrimaryNav marks the active group with aria-current="page"', () => {
    const src = read('src/components/layout/PrimaryNav.tsx')
    assert.match(src, /aria-current=\{active \? 'page' : undefined\}/)
    assert.match(src, /fontWeight: active \? 600 : 500/, 'active state is also conveyed by weight, not color alone')
  })

  test('SecondaryNav and MobileNavDrawer mark active routes with aria-current="page"', () => {
    for (const file of ['src/components/layout/SecondaryNav.tsx', 'src/components/layout/MobileNavDrawer.tsx']) {
      const src = read(file)
      assert.match(src, /aria-current=/)
    }
  })

  test('nav landmarks carry an aria-label sourced from i18n, not a hardcoded string', () => {
    const primary = read('src/components/layout/PrimaryNav.tsx')
    assert.match(primary, /aria-label=\{t\.common\.primaryNav\}/)
    const drawer = read('src/components/layout/MobileNavDrawer.tsx')
    assert.match(drawer, /aria-label=\{t\.common\.mobileNav\}/)
  })

  test('the mobile-nav hamburger has an aria-label and title, and is keyboard-operable (a real <button>)', () => {
    const src = read('src/components/layout/TopBar.tsx')
    assert.match(src, /<button[\s\S]{0,200}onClick=\{toggleNav\}/)
    assert.match(src, /aria-label=\{open \? t\.common\.closeMenu : t\.common\.openMenu\}/)
  })
})

describe('motion: sliding indicator uses the tokenized, reduced-motion-safe utility', () => {
  test('PrimaryNav and SecondaryNav indicators use .nv-indicator (already reduced-motion-gated in globals.css)', () => {
    assert.match(read('src/components/layout/PrimaryNav.tsx'), /nv-indicator/)
    assert.match(read('src/components/layout/SecondaryNav.tsx'), /nv-indicator/)
  })

  test('globals.css collapses .nv-indicator transitions under prefers-reduced-motion', () => {
    const css = read('src/app/globals.css')
    const reducedBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    assert.match(reducedBlock, /transition-duration: \.01ms !important/)
  })

  test('the mobile drawer slide-in also degrades under reduced motion (via .nv-slide-in)', () => {
    assert.match(read('src/components/layout/MobileNavDrawer.tsx'), /nv-slide-in/)
    const css = read('src/app/globals.css')
    const reducedBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    assert.match(reducedBlock, /\.nv-reveal, \.nv-pop, \.nv-slide-in/)
  })
})

describe('logo: the shell uses the authoritative NevadaMark, never redrawn', () => {
  test('TopBar and MobileNavDrawer render NevadaMark, not the legacy raster BrandLogo', () => {
    for (const file of ['src/components/layout/TopBar.tsx', 'src/components/layout/MobileNavDrawer.tsx']) {
      const src = read(file)
      assert.match(src, /<NevadaMark/)
      assert.doesNotMatch(src, /<BrandLogo/)
    }
  })

  test('NevadaMark itself is untouched by this phase (still points at the byte-identical Fable SVG)', () => {
    const src = read('src/components/ui/NevadaMark.tsx')
    assert.match(src, /\/nevada-logo\.svg/)
  })
})

describe('semantic tokens only — no hardcoded hex/color in the new nav components', () => {
  const files = [
    'src/components/layout/TopBar.tsx',
    'src/components/layout/PrimaryNav.tsx',
    'src/components/layout/SecondaryNav.tsx',
    'src/components/layout/MobileNavDrawer.tsx',
  ]
  for (const file of files) {
    test(`${file} has no hardcoded hex color`, () => {
      const src = read(file)
      assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}(?!\))/, 'no literal hex color')
    })
    test(`${file} has no raw Tailwind color scale class`, () => {
      const src = read(file)
      assert.doesNotMatch(src, /\b(?:bg|text|border)-(?:gray|slate|zinc|emerald|red|blue|green|amber|purple)-\d{2,3}\b/)
    })
  }
})

describe('scope: no business logic, API, or auth files touched by the nav rewrite', () => {
  test('MobileNavDrawer and TopBar only read auth display state, never call Supabase directly', () => {
    for (const file of ['src/components/layout/TopBar.tsx', 'src/components/layout/MobileNavDrawer.tsx']) {
      const src = read(file)
      assert.doesNotMatch(src, /supabase/i)
      assert.match(src, /useAuthDisplay/)
    }
  })
})
