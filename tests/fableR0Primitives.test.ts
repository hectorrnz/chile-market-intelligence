// R0 — Shared composition primitives (normalized Stage 5R program, phase R0).
//
// Source-scan tests following this repo's established convention (no
// React-rendering harness exists; see tests/responsiveLayout.test.ts).
// Covers: the three new primitives (PageHeader, Chip, ModalShell + its
// destructive-confirmation mode), the TableCard vertical-scroll option, the
// visual normalization of UpdateDataButton/LangToggle/ThemeToggle, the
// shell header/content width alignment, and the two chart token repairs —
// with scoped structural assertions, not just component-name presence.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const PAGE_HEADER = read('src/components/fable/PageHeader.tsx')
const CHIP = read('src/components/fable/Chip.tsx')
const MODAL = read('src/components/fable/ModalShell.tsx')
const TABLE_CARD = read('src/components/fable/TableCard.tsx')
const UPDATE = read('src/components/ui/UpdateDataButton.tsx')
const LANG = read('src/components/ui/LangToggle.tsx')
const THEME = read('src/components/ui/ThemeToggle.tsx')
const TOPBAR = read('src/components/layout/TopBar.tsx')
const SECONDARY = read('src/components/layout/SecondaryNav.tsx')
const APPSHELL = read('src/components/layout/AppShell.tsx')
const CSS = read('src/app/globals.css')
const LINE_CHART = read('src/components/charts/LineChart.tsx')
const FUND_CHART = read('src/components/charts/FundamentalsChart.tsx')

// ── Hygiene: the three new primitives are token-only, data-free, logic-free ─

describe('R0 primitives — token/data hygiene', () => {
  const NEW_FILES: [string, string][] = [
    ['PageHeader.tsx', PAGE_HEADER],
    ['Chip.tsx', CHIP],
    ['ModalShell.tsx', MODAL],
  ]

  for (const [name, src] of NEW_FILES) {
    test(`${name} has no hardcoded hex color`, () => {
      assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/)
    })
    test(`${name} has no raw Tailwind color-scale class`, () => {
      assert.doesNotMatch(
        src,
        /\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
      )
    })
    test(`${name} has no data fetching, API path, or auth logic`, () => {
      assert.doesNotMatch(src, /fetch\(|\/api\/|supabase|useAuth/i)
    })
    test(`${name} embeds no sample financial data`, () => {
      assert.doesNotMatch(src, /SQM-B|BSANTANDER|COPEC|['"]SAMPLE['"]|1[,.]234[,.]567/)
    })
    test(`${name} declares no CSS custom property of its own`, () => {
      assert.doesNotMatch(src, /'--[a-zA-Z0-9-]+':/)
    })
  }
})

// ── PageHeader ──────────────────────────────────────────────────────────────

describe('PageHeader — Fable baseline header primitive', () => {
  test('renders a <header> with the wrapping baseline-row classes', () => {
    assert.match(PAGE_HEADER, /<header className=\{`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-5/)
  })

  test('eyebrow uses the ui-label scale; title uses ui-page-title on an <h1>', () => {
    assert.match(PAGE_HEADER, /ui-label text-muted-fg/)
    assert.match(PAGE_HEADER, /<h1 className="ui-page-title text-foreground">/)
  })

  test('metadata is a baseline-aligned wrapping ui-meta container', () => {
    assert.match(PAGE_HEADER, /ui-meta text-muted-fg flex items-baseline flex-wrap/)
  })

  test('source order: eyebrow → title → metadata → actions', () => {
    const positions = [
      PAGE_HEADER.indexOf('{eyebrow &&'),
      PAGE_HEADER.indexOf('<h1'),
      PAGE_HEADER.indexOf('{metadata &&'),
      PAGE_HEADER.indexOf('{actions &&'),
    ]
    assert.ok(positions.every((p) => p >= 0), 'all four slots must exist')
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'slot order changed')
  })

  test('the trailing action cluster wraps (min-w-0, never shrink-0) so actions stay reachable at narrow widths', () => {
    const actionsSlice = PAGE_HEADER.slice(PAGE_HEADER.indexOf('{actions &&'))
    assert.match(actionsSlice, /flex flex-wrap items-center gap-2 ml-auto min-w-0/)
    assert.doesNotMatch(actionsSlice, /shrink-0/)
  })

  test('purely presentational: no effects, no fetching, no route strings', () => {
    assert.doesNotMatch(PAGE_HEADER, /useEffect|useState|usePathname|useRouter/)
    // Every visible string must come from the caller: strip JSX expressions,
    // then no bare capitalized label text may remain between tags.
    const stripped = PAGE_HEADER.replace(/\{[^}]*\}/g, '')
    assert.ok(!/>[A-Z][a-zA-Z ]{3,}</.test(stripped), 'PageHeader must not hardcode visible copy')
  })
})

// ── Chip primitive ──────────────────────────────────────────────────────────

describe('Chip — shared pill recipe (button / label / select variants)', () => {
  const buttonBody = CHIP.slice(CHIP.indexOf('export function ChipButton'), CHIP.indexOf('export function ChipLabel'))
  const labelBody = CHIP.slice(CHIP.indexOf('export function ChipLabel'), CHIP.indexOf('export function ChipSelect'))
  const selectBody = CHIP.slice(CHIP.indexOf('export function ChipSelect'))

  test('exports the three variants', () => {
    for (const name of ['ChipButton', 'ChipLabel', 'ChipSelect']) {
      assert.match(CHIP, new RegExp(`export function ${name}`))
    }
  })

  test('the shared recipe is a 999px capsule on the chip tokens with tokenized motion', () => {
    assert.match(CHIP, /rounded-full border border-\[var\(--nv-chipbd\)\]/)
    assert.match(CHIP, /nv-transition/)
    assert.doesNotMatch(CHIP, /transition-colors/)
  })

  test('ChipButton is a real <button type="button"> with disabled + selected states', () => {
    assert.match(buttonBody, /<button/)
    assert.match(buttonBody, /type="button"/)
    assert.match(buttonBody, /disabled:opacity-50 disabled:cursor-not-allowed/)
    // Selected is conveyed by fill AND weight — never color alone.
    assert.match(buttonBody, /bg-\[var\(--selected\)\] text-foreground font-semibold/)
    assert.match(buttonBody, /hover:text-foreground/)
  })

  test('ChipButton contains exactly one interactive element (no nested interactives)', () => {
    assert.equal((buttonBody.match(/<button/g) ?? []).length, 1)
    assert.doesNotMatch(buttonBody, /<a\s/)
  })

  test('ChipLabel is a non-interactive <span>', () => {
    assert.match(labelBody, /<span/)
    assert.doesNotMatch(labelBody, /<button|onClick/)
  })

  test('ChipSelect styles a NATIVE <select> (keyboard behavior inherited), chevron is decorative', () => {
    assert.match(selectBody, /<select/)
    assert.match(selectBody, /appearance-none/)
    assert.match(selectBody, /aria-hidden="true"/)
    assert.match(selectBody, /pointer-events-none/)
  })
})

// ── ModalShell ──────────────────────────────────────────────────────────────

describe('ModalShell — the one shared dialog shell', () => {
  test('overlay layer: fixed full-viewport wrapper, scrim rendered before the dialog', () => {
    assert.match(MODAL, /fixed inset-0 z-\[90\]/)
    const scrimIdx = MODAL.indexOf('nv-scrim absolute inset-0')
    const dialogIdx = MODAL.indexOf('role={role}')
    assert.ok(scrimIdx > 0 && dialogIdx > scrimIdx, 'the scrim must precede (sit under) the dialog surface')
  })

  test('labelled dialog: role, aria-modal, title and description association via useId', () => {
    assert.match(MODAL, /role\?: 'dialog' \| 'alertdialog'/)
    assert.match(MODAL, /role = 'dialog'/)
    assert.match(MODAL, /aria-modal="true"/)
    assert.match(MODAL, /aria-labelledby=\{titleId\}/)
    assert.match(MODAL, /aria-describedby=\{description \? descId : undefined\}/)
    assert.match(MODAL, /useId\(\)/)
    assert.match(MODAL, /id=\{titleId\}/)
    assert.match(MODAL, /id=\{descId\}/)
  })

  test('Escape, scrim-click, and ✕ dismissal are all wired — and all gated while dismissal is disabled', () => {
    assert.match(MODAL, /useEscape\(open && canDismiss, onClose\)/)
    assert.match(MODAL, /onClick=\{scrimDismiss && canDismiss \? onClose : undefined\}/)
    assert.match(MODAL, /disabled=\{!canDismiss\}/)
  })

  test('close button reuses the existing i18n close label (no new hardcoded copy)', () => {
    assert.match(MODAL, /aria-label=\{t\.fable\.panel\.close\}/)
  })

  test('focus management: initial focus, Tab trap, restoration to the invoking control', () => {
    assert.match(MODAL, /FOCUSABLE_SELECTOR/)
    assert.match(MODAL, /getFocusable\(\)\[0\]\?\.focus\(\), 0\)/)
    assert.match(MODAL, /if \(e\.key !== 'Tab'\) return/)
    assert.match(MODAL, /addEventListener\('keydown', onKeydown\)/)
    assert.match(MODAL, /wasOpenRef\.current && !open/)
    assert.match(MODAL, /\?\.focus\?\.\(\)/)
  })

  test('body scroll is locked while open and restored on close', () => {
    assert.match(MODAL, /document\.body\.style\.overflow = 'hidden'/)
    assert.match(MODAL, /document\.body\.style\.overflow = prevOverflow/)
  })

  test('pinned header/footer slots with a scrollable body between them', () => {
    assert.match(MODAL, /shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3/)
    assert.match(MODAL, /flex-1 min-h-0 overflow-y-auto px-5 py-4/)
    assert.match(MODAL, /shrink-0 flex flex-wrap items-center justify-end gap-2 px-5 py-3/)
  })

  test('dense option swaps overlay glass for the near-opaque analytical surface (§8), chrome from tokens', () => {
    assert.match(MODAL, /dense \? 'nv-surface-dense' : 'nv-glass-overlay'/)
    assert.match(MODAL, /var\(--radius-module\)/)
    assert.match(MODAL, /var\(--nv-bd\)/)
    assert.match(MODAL, /var\(--shadow-palette\)/)
  })

  test('entrance uses the reduced-motion-gated .nv-pop utility, mobile containment via max-h + px', () => {
    assert.match(MODAL, /nv-pop/)
    assert.match(MODAL, /max-h-\[85vh\]/)
    assert.match(MODAL, /px-4/)
  })
})

describe('DestructiveConfirm — the ModalShell destructive-confirmation mode', () => {
  const body = MODAL.slice(MODAL.indexOf('export function DestructiveConfirm'))

  test('is an alertdialog whose dismissal locks while the mutation is pending', () => {
    assert.match(body, /role="alertdialog"/)
    assert.match(body, /dismissDisabled=\{pending\}/)
  })

  test('confirm fires at most once per open (duplicate-submission guard)', () => {
    assert.match(body, /if \(pending \|\| firedRef\.current\) return/)
    assert.match(body, /firedRef\.current = true/)
    assert.match(MODAL, /if \(open && !pending\) firedRef\.current = false/)
  })

  test('both actions disable while pending; the destructive action announces busy', () => {
    assert.equal((body.match(/disabled=\{pending\}/g) ?? []).length, 2)
    assert.match(body, /aria-busy=\{pending \|\| undefined\}/)
  })

  test('the destructive action uses the critical-fill pair (the one white-text-safe signal in both themes)', () => {
    assert.match(body, /var\(--critical-fill\)/)
    assert.match(body, /var\(--critical-fill-fg\)/)
  })

  test('contains no mutation logic and never uses window.confirm', () => {
    assert.doesNotMatch(MODAL, /window\.confirm/)
    assert.doesNotMatch(body, /fetch\(|\/api\//)
  })
})

// ── TableCard vertical-scroll option ────────────────────────────────────────

describe('TableCard — optional vertical-scroll mode', () => {
  test('default behavior is unchanged: no maxHeight → no vertical scroll style at all', () => {
    assert.match(TABLE_CARD, /style=\{maxHeight != null \? \{ maxHeight, overflowY: 'auto' \} : undefined\}/)
  })

  test('vertical scroll lands on the SAME element as the horizontal scroll, so sticky headers bind to one container', () => {
    const wrapper = TABLE_CARD.slice(TABLE_CARD.indexOf('className="overflow-x-auto"'))
    const styleIdx = wrapper.indexOf("overflowY: 'auto'")
    const innerIdx = wrapper.indexOf('{children}')
    assert.ok(styleIdx > 0 && styleIdx < innerIdx, 'maxHeight/overflowY must sit on the overflow-x-auto wrapper itself')
  })

  test('existing minWidth floor and footer slot are untouched', () => {
    assert.match(TABLE_CARD, /style=\{minWidth \? \{ minWidth \} : undefined\}/)
    assert.match(TABLE_CARD, /\{footer && <div className="px-4 py-2\.5">\{footer\}<\/div>\}/)
  })

  test('controls slot and state-instead-of-children contract are untouched', () => {
    assert.match(TABLE_CARD, /controls && <div className="flex items-center gap-2 flex-wrap ml-auto">/)
    assert.match(TABLE_CARD, /state \? \(/)
  })
})

// ── UpdateDataButton — platform-wide contract preserved, styling normalized ─

describe('UpdateDataButton — the platform-wide update contract (D-1)', () => {
  // Comment-stripped source: the doc comment deliberately NAMES the
  // useGlobalRefresh callback callers must supply, so "holds no provider
  // dependency" has to be asserted against executable code only.
  const UPDATE_CODE = UPDATE.replace(/\/\*[\S\s]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  test('onRefresh is a REQUIRED prop (no optional marker, no default)', () => {
    assert.match(UPDATE, /onRefresh: \(\) => Promise<void>/, 'onRefresh must stay required')
    assert.doesNotMatch(UPDATE, /onRefresh\?:/, 'onRefresh must not become optional')
    assert.match(UPDATE, /\{ onRefresh, className = '' \}: Props/)
  })

  test('invokes the supplied callback directly, with it in the callback deps', () => {
    assert.match(UPDATE, /await onRefresh\(\)/)
    assert.match(UPDATE, /\}, \[onRefresh, state\]\)/)
  })

  test('holds no provider dependency — the platform-wide callback is supplied by the caller, not obtained here', () => {
    assert.doesNotMatch(UPDATE_CODE, /useGlobalRefresh/, 'the button must not import or call the refresh hook itself')
    assert.doesNotMatch(UPDATE_CODE, /useMarketData|useMacroData|MarketDataProvider|MacroDataProvider/)
    // The only imports are React state hooks and the language provider.
    const imports = [...UPDATE_CODE.matchAll(/^import .+$/gm)].map((m) => m[0])
    assert.deepEqual(imports, [
      "import { useState, useCallback } from 'react'",
      "import { useLang } from '@/components/providers/LangProvider'",
    ])
  })

  test('contains no fetch, endpoint, or route-local orchestration', () => {
    assert.doesNotMatch(UPDATE_CODE, /fetch\(|\/api\/|axios/)
  })

  test('documents the caller contract: platform-wide action, never a route-local handler', () => {
    // Phrase-level (not sentence-level) matching — the doc comment wraps.
    assert.match(UPDATE, /represents\*\* the platform-wide update action/)
    assert.match(UPDATE, /must be the authoritative/)
    assert.match(UPDATE, /route-local/)
    assert.match(UPDATE, /must never be passed here/)
  })

  test('every route rendering it obtains the authoritative platform-wide callback', () => {
    // The real wiring assertion (route → useGlobalRefresh) lives here and in
    // tests/marketDataProvider.test.ts; this covers all 7 rendering routes,
    // including the three that provider suite does not enumerate.
    const ROUTES = [
      'src/app/page.tsx',
      'src/app/stocks/page.tsx',
      'src/app/companies/[ticker]/page.tsx',
      'src/app/compare/page.tsx',
      'src/app/macro/page.tsx',
      'src/app/earnings/page.tsx',
      'src/app/portfolio/page.tsx',
    ]
    for (const route of ROUTES) {
      const src = read(route)
      assert.match(src, /<UpdateDataButton/, `${route} should render UpdateDataButton`)
      assert.match(src, /onRefresh=\{/, `${route} must pass the required onRefresh prop`)
      assert.match(src, /useGlobalRefresh\(\)/, `${route} must obtain the platform-wide callback`)
    }
  })

  test('loading/success/failure semantics are byte-preserved (idle→loading→done→2s→idle; failure→idle)', () => {
    assert.match(UPDATE, /'idle' \| 'loading' \| 'done'/)
    assert.match(UPDATE, /setTimeout\(\(\) => setState\('idle'\), 2000\)/)
    assert.match(UPDATE, /catch \{\s*setState\('idle'\)\s*\}/)
    assert.match(UPDATE, /if \(state === 'loading'\) return/)
  })

  test('labels still come from the same i18n keys', () => {
    for (const key of ['t.common.updating', 't.common.dataUpdated', 't.common.updateData']) {
      assert.ok(UPDATE.includes(key), `missing ${key}`)
    }
  })

  test('styling is normalized to the Fable pill system (999px, tokenized motion/spin), size kept prominent', () => {
    assert.match(UPDATE, /rounded-full/)
    assert.match(UPDATE, /nv-transition/)
    assert.match(UPDATE, /nv-spin/)
    assert.ok(UPDATE.includes('h-9'))
    assert.doesNotMatch(UPDATE, /transition-colors|animate-spin/)
  })
})

// ── LangToggle / ThemeToggle — visual normalization, behavior preserved ─────

describe('LangToggle & ThemeToggle — normalized segmented capsules', () => {
  test('both share the chip-token capsule track (999px, --nv-chip / --nv-chipbd)', () => {
    for (const src of [LANG, THEME]) {
      assert.match(src, /h-7 p-0\.5 rounded-full border/)
      assert.match(src, /var\(--nv-chip\)/)
      assert.match(src, /var\(--nv-chipbd\)/)
    }
  })

  test('both use tokenized motion — no raw transition utilities left', () => {
    for (const src of [LANG, THEME]) {
      assert.match(src, /nv-transition/)
      assert.doesNotMatch(src, /transition-colors/)
    }
  })

  test('LangToggle behavior preserved: same setLang switch, EN/ES options, group semantics, aria-pressed', () => {
    assert.match(LANG, /if \(next !== lang\) setLang\(next\)/)
    assert.match(LANG, /\['en', 'es'\] as Lang\[\]/)
    assert.match(LANG, /role="group"/)
    assert.match(LANG, /aria-label=\{t\.topbar\.language\}/)
    assert.match(LANG, /aria-pressed=\{active\}/)
    // §18: mono is for identifiers only — EN/ES are UI labels.
    assert.doesNotMatch(LANG, /font-mono/)
  })

  test('ThemeToggle behavior preserved: persisted choice, class toggle, group + aria-pressed + per-option titles', () => {
    assert.match(THEME, /localStorage\.setItem\('theme', dark \? 'dark' : 'light'\)/)
    assert.match(THEME, /document\.documentElement\.classList\.toggle\('dark', dark\)/)
    assert.match(THEME, /role="group"/)
    assert.match(THEME, /aria-label=\{t\.topbar\.theme\}/)
    assert.equal((THEME.match(/aria-pressed=/g) ?? []).length, 2)
    assert.match(THEME, /title=\{t\.topbar\.switchToLight\}/)
    assert.match(THEME, /title=\{t\.topbar\.switchToDark\}/)
  })
})

// ── Shell width alignment ───────────────────────────────────────────────────

describe('shell width — header rows and main share the one --content-max-w cap', () => {
  test('TopBar content is capped and centered like <main>', () => {
    assert.match(TOPBAR, /max-w-\(--content-max-w\) mx-auto/)
  })

  test('SecondaryNav content is capped and centered like <main>', () => {
    assert.match(SECONDARY, /max-w-\(--content-max-w\) mx-auto/)
    // Visibility contract unchanged (locked by responsiveLayout.test.ts too).
    assert.match(SECONDARY, /hidden lg:flex/)
  })

  test('AppShell main still carries the same cap — no duplicated numeric width anywhere', () => {
    assert.match(APPSHELL, /max-w-\(--content-max-w\)/)
    for (const src of [TOPBAR, SECONDARY, APPSHELL]) {
      assert.doesNotMatch(src, /1560/)
    }
    assert.match(CSS, /--content-max-w:\s*1560px/)
  })
})

// ── Header region allocation (repair of the 1024/1728 nav collision) ────────

describe('header regions — brand, utilities and the nav rail cannot starve each other', () => {
  const PRIMARY_NAV = read('src/components/layout/PrimaryNav.tsx')

  // Region slices, so every assertion below is scoped to the right element
  // rather than matched anywhere in the file.
  const headerOpen = TOPBAR.indexOf('<header')
  const brandStart = TOPBAR.indexOf('<div className="flex items-center gap-2.5')
  const utilityStart = TOPBAR.indexOf('<div className="flex items-center gap-1 sm:gap-2')
  const navMount = TOPBAR.indexOf('<PrimaryNav />')
  const headerRow = TOPBAR.slice(headerOpen, brandStart)
  const brandRegion = TOPBAR.slice(brandStart, utilityStart)
  const utilityRegion = TOPBAR.slice(utilityStart, navMount)

  test('the header row wraps and its height follows content instead of clipping it', () => {
    assert.match(headerRow, /flex flex-wrap/, 'the header row must be allowed to wrap')
    assert.match(headerRow, /min-h-14/, 'height is a floor, not a fixed clip')
    assert.doesNotMatch(headerRow, /(?<!min-)\bh-14\b/, 'a fixed height would re-clip the wrapped rail')
  })

  test('the brand region does not consume unbounded width', () => {
    // basis-0 keeps its hypothetical size at zero (it can never push the
    // utility cluster onto another line), min-w-0 + truncate let the page
    // title yield first.
    assert.match(brandRegion, /min-w-0/)
    assert.match(brandRegion, /basis-0/)
    assert.match(brandRegion, /\bshrink\b/)
    assert.match(brandRegion, /truncate/, 'the page title truncates inside the region')
  })

  test('the nav rail is allowed to shrink and owns a full-width line — never the leftovers', () => {
    // Scoped to the rail element's own class list — the file's comment
    // explains the flex-1 defect by name, which is not the same as using it.
    const railClass = /<nav[\s\S]*?className="([^"]+)"/.exec(PRIMARY_NAV)?.[1] ?? ''
    assert.ok(railClass.includes('min-w-0'), 'the rail must be able to shrink below content width')
    assert.ok(railClass.includes('basis-full'), 'the rail claims its own line at full content width')
    assert.ok(!/\bflex-1\b/.test(railClass), 'a basis-0 rail is exactly what starved it to a few pixels')
  })

  test('horizontal overflow is contained inside the nav rail, never the page', () => {
    assert.match(PRIMARY_NAV, /overflow-x-auto nv-scrollbar-hidden/)
    assert.match(SECONDARY, /overflow-x-auto nv-scrollbar-hidden/, 'the secondary rail scrolls in-region too')
    // Neither header row may itself scroll or hide overflow horizontally.
    assert.doesNotMatch(headerRow, /overflow-x/)
  })

  test('nav pills never compress — they keep full label width and the rail scrolls instead', () => {
    assert.match(PRIMARY_NAV, /shrink-0 whitespace-nowrap/)
    assert.match(SECONDARY, /shrink-0 whitespace-nowrap/)
  })

  test('the utility cluster neither overlays nor is overlaid by the nav region', () => {
    // Both are ordinary in-flow flex siblings — an overlay could only come
    // from taking one out of flow or stacking it, so neither region may use
    // absolute/fixed positioning or an arbitrary z-index. (A small optical
    // nudge like the hamburger's -ml-1 is not an overlay mechanism.)
    for (const region of [brandRegion, utilityRegion]) {
      assert.doesNotMatch(region, /\babsolute\b|\bfixed\b|\bz-\[/)
    }
    assert.match(utilityRegion, /ml-auto/, 'utilities sit at the end of the first line')
    // The rail is mounted after the utility cluster, so DOM order matches the
    // visual order (utilities on line 1, rail on line 2) and tab order agrees.
    assert.ok(navMount > utilityStart, 'PrimaryNav must be mounted after the utility cluster')
  })

  test('every utility control is still present and reachable — none removed to make room', () => {
    for (const control of ['cmdk:open', 'NotificationBell', 'LangToggle', 'ThemeToggle', 't.auth.signOut', 't.auth.signIn']) {
      assert.ok(TOPBAR.includes(control), `${control} must remain in the header`)
    }
  })

  test('navigation labels, destinations and the measured indicator are unchanged', () => {
    assert.match(PRIMARY_NAV, /\{navGroups\.map\(\(group\) => \{/, 'items still come from navGroups')
    assert.match(PRIMARY_NAV, /\{group\.label\(t\)\}/, 'labels still resolve through i18n')
    assert.match(PRIMARY_NAV, /href=\{group\.href\}/)
    assert.match(PRIMARY_NAV, /aria-current=\{active \? 'page' : undefined\}/)
    assert.match(PRIMARY_NAV, /useNavIndicator\(activeGroup\?\.key \?\? null/)
    assert.match(PRIMARY_NAV, /nv-indicator/)
    assert.doesNotMatch(PRIMARY_NAV, /\btruncate\b/, 'a nav label must never be truncated')
  })

  test('the indicator hook itself is untouched by this repair', () => {
    const hook = read('src/components/layout/useNavIndicator.ts')
    assert.match(hook, /setRect\(\{ left: elRect\.left - railRect\.left \+ rail\.scrollLeft, width: elRect\.width \}\)/)
    assert.match(hook, /window\.addEventListener\('resize', measure\)/)
  })
})

// ── Chart token repairs ─────────────────────────────────────────────────────

describe('chart token repairs — the two Stage 5R leaks are closed', () => {
  test('LineChart event markers use --chart-primary, never the bare --primary interaction token', () => {
    assert.match(LINE_CHART, /fill="var\(--chart-primary\)"/)
    assert.doesNotMatch(LINE_CHART, /var\(--primary\)/)
  })

  test('FundamentalsChart hover column uses --chart-hover-column, never the bare --hover token', () => {
    assert.match(FUND_CHART, /fill="var\(--chart-hover-column\)"/)
    assert.doesNotMatch(FUND_CHART, /var\(--hover\)/)
  })

  test('--chart-hover-column is declared in the chart token block as an alias (no new raw color)', () => {
    assert.match(CSS, /--chart-hover-column:\s*var\(--hover\);/)
  })

  test('no structural chart logic changed — datasets, scales, and series wiring untouched', () => {
    // The hover band is still the same full-height rect over the hovered slot.
    assert.match(FUND_CHART, /hover != null && <rect x=\{ML \+ hover \* slotW\} y=\{MT\} width=\{slotW\} height=\{chartH\}/)
    // Markers are still baseline triangles carrying their <title> label.
    assert.match(LINE_CHART, /baseline - 7/)
    assert.match(LINE_CHART, /<title>\{m\.label\}<\/title>/)
  })
})
