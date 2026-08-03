// Phase R7.1A — targeted mobile shell + structured-notes responsive repair.
//
// Locks the four confirmed 390×844 defects closed:
//   1. the collapsed global-search control painted OVER the Nevada logo — the
//      old TopBar put the hamburger + brand inside the squeezable
//      (`min-w-0 grow basis-0`) group, whose `shrink-0` children visually
//      overflowed the group box underneath the later-painted utility cluster;
//   2. the drawer username was a one-line truncating strip that clipped and
//      (on the translucent surface) blended with page text beneath it;
//   3. the Tier-5 overlay glass reused the in-flow `--nv-card` alphas
//      (.75–.9 light, .58–.72 dark), leaving underlying headings/values
//      readable through the open drawer and dialogs;
//   4. the structured-notes Allocation-by-entity card kept donut + legend
//      side by side at every card width, so the squeezed legend's nowrap
//      amounts overflowed the card boundary.
//
// These are source-scan checks (no browser) — geometry-class proxies for the
// in-browser verification recorded in docs/fable-integration/06. Numbered
// test groups map 1:1 onto the R7.1A brief's section G items 1–25.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const TOPBAR = read('src/components/layout/TopBar.tsx')
const DRAWER = read('src/components/layout/MobileNavDrawer.tsx')
const THEME_TOGGLE = read('src/components/ui/ThemeToggle.tsx')
const LANG_TOGGLE = read('src/components/ui/LangToggle.tsx')
const SHELL = read('src/components/fable/ModalShell.tsx')
const CSS = read('src/app/globals.css')
const SN_PAGE = read('src/app/structured-notes/page.tsx')
const I18N = read('src/lib/i18n.ts')

const LIGHT = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('.dark {'))
const DARK = CSS.slice(CSS.indexOf('.dark {'))

// The Donut component slice (allocation card chart + legend).
const DONUT = SN_PAGE.slice(SN_PAGE.indexOf('function Donut'))

// TopBar region slices, so assertions bind to the right element.
const protectedSlot = TOPBAR.slice(
  TOPBAR.indexOf('<div className="flex items-center gap-2.5 shrink-0">'),
  TOPBAR.indexOf('<div className="flex items-center gap-2.5 shrink min-w-0 grow basis-0">'),
)
const titleSlot = TOPBAR.slice(
  TOPBAR.indexOf('<div className="flex items-center gap-2.5 shrink min-w-0 grow basis-0">'),
  TOPBAR.indexOf('<div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">'),
)
const utilitySlot = TOPBAR.slice(
  TOPBAR.indexOf('<div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">'),
  TOPBAR.indexOf('<PrimaryNav />'),
)

/** Every rgba(...) alpha inside a CSS declaration string. */
function alphasOf(decl: string): number[] {
  return [...decl.matchAll(/rgba\([^)]*?,\s*(\.\d+|\d\.?\d*)\)/g)].map((m) => Number(m[1]))
}

describe('R7.1A §G1-4 — mobile header geometry', () => {
  it('1. the header is three independent layout slots: protected brand, squeezable title, utility cluster', () => {
    assert.ok(protectedSlot.length > 0, 'protected slot exists')
    assert.ok(titleSlot.length > 0, 'squeezable title slot exists')
    assert.ok(utilitySlot.length > 0, 'utility slot exists')
    // The protected slot owns the nav trigger and the brand; the utility slot
    // owns search, notifications, language and theme — each in exactly one slot.
    assert.match(protectedSlot, /toggleNav/)
    assert.match(protectedSlot, /<NevadaMark variant="symbol" size=\{28\}/)
    for (const control of ["new Event('cmdk:open')", '<NotificationBell />', '<LangToggle />', '<ThemeToggle />']) {
      assert.ok(utilitySlot.includes(control), `${control} lives in the utility cluster`)
      assert.ok(!protectedSlot.includes(control), `${control} must not live beside the brand`)
    }
  })

  it('2. the search trigger cannot use geometry that overlaps the logo', () => {
    // Fixed icon-square below md, own shrink-0 slot, in normal flow — no
    // absolute positioning, no z-index, no negative margins anywhere in TopBar.
    assert.match(
      utilitySlot,
      /className="shrink-0 flex items-center justify-center md:justify-start gap-2 h-9 w-9 px-0 md:w-auto md:px-3 rounded-full/,
    )
    assert.doesNotMatch(TOPBAR, /\babsolute\b|\bfixed\b|\bz-\[/)
    assert.doesNotMatch(TOPBAR, /[\s"']-m[ltrbxy]?-\d/, 'no negative margin utilities in the header')
    // The old collision mechanism is gone: the brand no longer sits inside a
    // min-w-0 group. The protected slot is shrink-0, so the flex line's
    // min-content is honest and flex-wrap (still present) drops the utilities
    // to a second row instead of painting them over the mark.
    assert.match(TOPBAR, /flex flex-wrap items-center gap-1\.5 sm:gap-3 py-2 w-full max-w-\(--content-max-w\) mx-auto min-w-0/)
    assert.doesNotMatch(protectedSlot, /min-w-0/)
  })

  it('3. the Nevada mark keeps protected space at mobile widths', () => {
    // Mark and its link are both shrink-0 inside the shrink-0 slot, and the
    // squeezable title slot sits BETWEEN brand and utilities as a spacer.
    assert.match(protectedSlot, /className="flex items-center gap-2 shrink-0" aria-label="Inversiones Nevada"/)
    assert.match(protectedSlot, /<NevadaMark variant="symbol" size=\{28\} alt="" className="shrink-0" \/>/)
    const brandIdx = TOPBAR.indexOf('aria-label="Inversiones Nevada"')
    const titleIdx = TOPBAR.indexOf('gap-2.5 shrink min-w-0 grow basis-0')
    const utilIdx = TOPBAR.indexOf('shrink-0 ml-auto')
    assert.ok(brandIdx < titleIdx && titleIdx < utilIdx, 'brand → spacer/title → utilities, in order')
  })

  it('4. the header compacts to fit a 320px viewport (static proxy for the in-browser check)', () => {
    // Icon-only search below md; icon-only theme segments below sm; tighter
    // segment padding below sm; date only at xl; wordmark only at md. With
    // these, the one-line min-content at 320px is under the 296px content box
    // (verified in-browser); under extreme font scaling the row wraps, never
    // overflows.
    assert.match(utilitySlot, /aria-label=\{t\.common\.search\}/, 'icon-only search keeps an accessible name')
    assert.match(utilitySlot, /aria-hidden="true">⌕<\/span>/)
    assert.match(utilitySlot, /hidden xl:inline">\{today\}/)
    const themeLabelGates = THEME_TOGGLE.match(/className="hidden sm:inline"/g) ?? []
    assert.equal(themeLabelGates.length, 2, 'both theme labels hide below sm (icons remain)')
    assert.match(THEME_TOGGLE, /px-1\.5 sm:px-2\.5/)
    assert.match(LANG_TOGGLE, /px-1\.5 sm:px-2\.5/)
    // Compaction never removes a control: both toggles keep two operable,
    // aria-pressed, titled segments; search and bell stay mounted.
    for (const src of [THEME_TOGGLE, LANG_TOGGLE]) assert.match(src, /aria-pressed=/)
    assert.match(THEME_TOGGLE, /aria-label=\{t\.topbar\.switchToLight\}/)
    assert.match(THEME_TOGGLE, /aria-label=\{t\.topbar\.switchToDark\}/)
  })
})

describe('R7.1A §G5-13 — drawer surface, layering, identity, dialog contract', () => {
  it('5. the drawer uses the approved near-opaque Tier-5 surface treatment', () => {
    assert.match(DRAWER, /nv-glass-overlay nv-slide-in absolute inset-y-0 left-0 w-72 max-w-\[85vw\]/)
    // The blurred Tier-5 fill is the dedicated overlay token, not the in-flow
    // card gradient…
    const supportsIdx = CSS.indexOf('@supports ((backdrop-filter')
    const overlayRule = CSS.slice(CSS.indexOf('.nv-glass-overlay {', supportsIdx))
    assert.match(overlayRule.slice(0, 400), /background: var\(--nv-overlay-fill\)/)
    assert.doesNotMatch(overlayRule.slice(0, 400), /background: var\(--nv-card\)/)
    // …and every fill stop clears the §8 dense-surface floor in BOTH themes.
    for (const [name, block] of [['light', LIGHT], ['dark', DARK]] as const) {
      const decl = block.match(/--nv-overlay-fill:[^;]+;/)?.[0]
      assert.ok(decl, `--nv-overlay-fill defined in ${name} theme`)
      const alphas = alphasOf(decl!)
      assert.ok(alphas.length >= 2, `${name} overlay fill is a two-stop gradient`)
      for (const a of alphas) assert.ok(a >= 0.92, `${name} overlay alpha ${a} must be >= .92`)
    }
    // Liquid Glass character retained: blur + saturation still applied.
    assert.match(overlayRule.slice(0, 500), /backdrop-filter: blur\(var\(--nv-blur-overlay\)\) saturate\(var\(--nv-sat-overlay\)\)/)
  })

  it('6. the drawer backdrop clearly suppresses the underlying page', () => {
    assert.match(DRAWER, /nv-scrim absolute inset-0" onClick=\{closeNav\} aria-hidden="true"/)
    const light = LIGHT.match(/--nv-scrim:\s*rgba\([^)]+\)/)?.[0] ?? ''
    const dark = DARK.match(/--nv-scrim:\s*rgba\([^)]+\)/)?.[0] ?? ''
    assert.ok(alphasOf(light)[0] >= 0.44, `light scrim alpha (${light}) must dim, not tint`)
    assert.ok(alphasOf(dark)[0] >= 0.55, `dark scrim alpha (${dark}) must dim, not tint`)
    assert.match(CSS, /\.nv-scrim \{\s*\n\s*backdrop-filter: blur\(var\(--nv-blur-scrim\)\)/)
  })

  it('7. layering: drawer above header and page, below dialogs, per the documented scale', () => {
    assert.match(CSS, /Layering scale \(R7\.1A/)
    assert.match(DRAWER, /fixed inset-0 z-\[80\]/)
    for (const p of ['src/components/fable/ModalShell.tsx', 'src/components/fable/DetailPanel.tsx', 'src/components/ui/NotificationBell.tsx']) {
      assert.match(read(p), /z-\[90\]/, `${p} sits on the dialog tier`)
    }
    assert.match(read('src/components/ui/CommandPalette.tsx'), /z-\[100\]/)
    // The header never out-stacks an overlay, and no page content escalates
    // past sticky-chrome tiers (locked per-page by the existing suites).
    assert.doesNotMatch(TOPBAR, /z-\[/)
  })

  it('8. the username has a dedicated identity container', () => {
    assert.match(DRAWER, /\{t\.auth\.signedInAs\}/)
    assert.match(DRAWER, /break-words line-clamp-2" title=\{displayName\}/)
    // The cramped one-line strip under the drawer header is gone.
    assert.doesNotMatch(DRAWER, /px-4 py-2 text-xs text-muted-fg truncate/)
  })

  it('9. a long username cannot overlap navigation', () => {
    // The identity section is an in-flow shrink-0 sibling AFTER the nav
    // (never absolutely positioned over it), and the name is height-bounded
    // by line-clamp-2 with the full value on title.
    const navClose = DRAWER.indexOf('</nav>')
    const identity = DRAWER.indexOf('t.auth.signedInAs')
    assert.ok(navClose > 0 && identity > navClose, 'identity section renders after the nav list')
    const footer = DRAWER.slice(navClose)
    assert.match(footer, /shrink-0 px-4 py-3/)
    assert.doesNotMatch(footer, /\babsolute\b/)
    // Sign-out stays associated but visually distinct (its own chip row).
    assert.match(footer, /href="\/logout"/)
    assert.match(footer, /\{t\.auth\.signOut\}/)
  })

  it('10. the drawer focus trap remains active', () => {
    assert.match(DRAWER, /const getFocusable = \(\) => Array\.from\(container\.querySelectorAll<HTMLElement>\(FOCUSABLE_SELECTOR\)\)/)
    assert.match(DRAWER, /addEventListener\('keydown', onKeydown\)/)
  })

  it('11. Escape and focus restoration remain intact', () => {
    assert.match(DRAWER, /useEscape\(open, closeNav\)/)
    assert.match(DRAWER, /returnFocusRef\.current\?\.focus\(\)/)
  })

  it('12. background scroll lock remains intact', () => {
    assert.match(DRAWER, /document\.body\.style\.overflow = 'hidden'/)
  })

  it('13. shared modal behavior is unchanged (ModalShell contract)', () => {
    assert.match(SHELL, /dense \? 'nv-surface-dense' : 'nv-glass-overlay'/)
    assert.match(SHELL, /nv-scrim absolute inset-0/)
    assert.match(SHELL, /useEscape\(open && canDismiss, onClose\)/)
    assert.match(SHELL, /max-h-\[85vh\]/)
  })
})

describe('R7.1A §G14-19 — allocation card responsive composition', () => {
  it('14. the card switches to a stacked composition below the container breakpoint', () => {
    // Container query (card-width, not viewport-width): base = stacked,
    // side-by-side only from @lg (32rem of card width).
    // R7.1B.1 widened the gap 5 → 6 when the allocation chart moved into the
    // wider dashboard column. The container-query rule itself — stacked base,
    // side-by-side only from @lg of CARD width — is unchanged.
    assert.match(DONUT, /<div className="@container">/)
    assert.match(DONUT, /flex flex-col items-center gap-4 @lg:flex-row @lg:gap-6/)
  })

  it('15. the legend occupies the full card width when stacked', () => {
    assert.match(DONUT, /className="w-full text-xs space-y-0\.5 min-w-0 @lg:flex-1"/)
  })

  it('16. numeric values cannot overflow the card', () => {
    // Rows wrap; the name is the flexible truncating part (full identity via
    // title); the numeric block is atomic nowrap units that drop to a
    // right-aligned second line instead of leaving the card.
    assert.match(DONUT, /flex flex-wrap items-center gap-x-2 gap-y-0\.5 rounded-lg/)
    assert.match(DONUT, /truncate min-w-0 flex-1 basis-24" title=\{s\.label\}/)
    assert.match(DONUT, /ui-number ml-auto flex flex-wrap justify-end gap-x-1 text-right/)
    const nowrapUnits = DONUT.match(/whitespace-nowrap/g) ?? []
    assert.ok(nowrapUnits.length >= 2, 'both numeric units are atomic (no mid-number wrap)')
    // Tabular numerals preserved on the numeric block.
    assert.match(DONUT, /ui-number/)
  })

  it('17. the ordinary legend needs no nested vertical scrollbar', () => {
    assert.doesNotMatch(DONUT, /overflow-y-auto|overflow-auto|max-h-/)
  })

  it('18. the desktop composition is preserved (side-by-side at wide cards, same donut geometry)', () => {
    assert.match(DONUT, /@lg:flex-row/)
    // R7.1B.1 — the donut is drawn larger (w-52 stacked, w-60 side-by-side)
    // now that it owns the wider dashboard column; it is still a fixed square
    // that cannot be squeezed out of aspect ratio.
    assert.match(DONUT, /relative w-52 h-52 @lg:w-60 @lg:h-60 shrink-0/)
    // Center total still present and unclipped by construction.
    assert.match(DONUT, /\{totalLabel\}/)
    assert.match(DONUT, /max-w-full truncate" title=\{`\$\{currency\} \$\{fmtNum\(total\)\}`\}/)
  })

  it('19. chart data, percentages and hover linking are unchanged', () => {
    assert.match(DONUT, /const gap = positive\.length > 1 \? 1\.6 : 0/)
    assert.match(DONUT, /\(s\.frac \* 100\)\.toFixed\(1\)/)
    assert.match(DONUT, /fmtNum\(s\.value\)/)
    assert.match(DONUT, /opacity=\{hi && hi !== s\.label \? 0\.3 : 1\}/)
    assert.match(SN_PAGE, /<Donut data=\{summary\.entityExposure\.map\(\(e\) => \(\{ label: e\.entityName, value: e\.notional \}\)\)\}/)
  })
})

describe('R7.1A §G20-25 — scope and hygiene', () => {
  it('20. no mock data is introduced', () => {
    // The drawer identity renders the real authenticated display name; the
    // donut renders only its data prop (live book aggregates).
    assert.match(DRAWER, /useAuthDisplay\(\)/)
    assert.match(DRAWER, /\{displayName\}/)
    assert.doesNotMatch(DONUT, /Watermill|Dubai|Staten|placeholder/i)
  })

  it('21. no API, provider, or schema surface is referenced by the shell/donut changes', () => {
    for (const [name, src] of [['TopBar', TOPBAR], ['MobileNavDrawer', DRAWER], ['ThemeToggle', THEME_TOGGLE], ['LangToggle', LANG_TOGGLE]] as const) {
      assert.doesNotMatch(src, /supabase|\/api\/|@\/lib\/db|@\/lib\/providers/i, `${name} stays a pure shell component`)
    }
  })

  it('22. no native alert, confirm, or prompt exists in the touched surfaces', () => {
    for (const src of [TOPBAR, DRAWER, THEME_TOGGLE, LANG_TOGGLE, SN_PAGE, SHELL]) {
      assert.doesNotMatch(src, /window\.(alert|confirm|prompt)\(/)
    }
  })

  it('23. EN and ES labels remain complete and distinct', () => {
    const signedIn = [...I18N.matchAll(/signedInAs:\s*'([^']+)'/g)].map((m) => m[1])
    assert.equal(signedIn.length, 2, 'signedInAs exists in both dictionaries')
    assert.notEqual(signedIn[0], signedIn[1], 'EN and ES values are distinct')
  })

  it('24. light and dark styles remain token driven — no hardcoded colors in the repairs', () => {
    for (const src of [DRAWER, THEME_TOGGLE, LANG_TOGGLE, DONUT]) {
      // CHART_PALETTE (donut series) resolves from the page's token-derived
      // palette constant, not from inline hexes in the repaired markup.
      assert.doesNotMatch(src.replace(/CHART_PALETTE/g, ''), /#[0-9a-fA-F]{6}\b/)
    }
    for (const block of [LIGHT, DARK]) {
      assert.match(block, /--nv-overlay-fill:/)
      assert.match(block, /--nv-scrim:/)
    }
  })

  it('25. no page-level overflow rule is weakened', () => {
    assert.doesNotMatch(CSS, /min-width:\s*1200px/, 'the removed html min-width must never return')
    assert.match(read('src/components/layout/AppShell.tsx'), /overflow-y-auto/)
    // The header still wraps (never scrolls or clips horizontally).
    assert.doesNotMatch(TOPBAR, /overflow-x/)
  })
})
