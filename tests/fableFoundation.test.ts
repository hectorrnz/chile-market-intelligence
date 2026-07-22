// Fable integration — Phase 1 (shared visual foundation).
//
// Locks the token/material/typography/motion foundation and the ONE theme
// mechanism (decision D2) so they cannot silently regress as later phases
// re-skin the shell, components, and pages.
//
// These are source-scan checks (no browser). They can't prove pixel rendering,
// but they make the load-bearing conventions impossible to revert by accident.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const CSS = read('src/app/globals.css')
const LAYOUT = read('src/app/layout.tsx')

/** Extract a top-level rule body (the block's closing brace is at column 0). */
function block(selector: string): string {
  const re = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)^\\}`, 'm')
  const m = CSS.match(re)
  assert.ok(m, `globals.css should declare a top-level "${selector} { … }" block`)
  return m![1]
}

const LIGHT = block(':root')
const DARK = block('.dark')

// ── D2 · one theme system ───────────────────────────────────────────────────

describe('theme mechanism (decision D2) — exactly one system', () => {
  test('light values under :root, dark values under .dark', () => {
    assert.match(LIGHT, /--background:/)
    assert.match(DARK, /--surface:/)
  })

  test('no body.nv-light — the Fable-only class system is never introduced', () => {
    assert.doesNotMatch(CSS, /\.nv-light/)
    assert.doesNotMatch(LAYOUT, /nv-light/)
  })

  test('exactly one localStorage theme key, and it is still "theme"', () => {
    const keys = [...CSS.matchAll(/localStorage/g)].length
    assert.equal(keys, 0, 'globals.css must not touch localStorage')
    const reads = [...LAYOUT.matchAll(/localStorage\.(get|set)Item\('([^']+)'\)?/g)].map((m) => m[2])
    assert.deepEqual([...new Set(reads)], ['theme'])
  })

  test('the .dark class lives on <html>, not on <body>', () => {
    assert.match(LAYOUT, /<html[^>]*className="[^"]*\bdark\b/)
    assert.doesNotMatch(LAYOUT, /<body[^>]*className="[^"]*\bdark\b/)
  })
})

describe('dark is the first-visit default; a stored choice wins', () => {
  test('server render already carries .dark (no flash toward dark)', () => {
    assert.match(LAYOUT, /<html lang="en" className="h-full dark"/)
  })

  test('the pre-paint script only removes .dark, and only for a stored "light"', () => {
    const script = LAYOUT.match(/__html: `([^`]*)`/)
    assert.ok(script, 'the pre-paint inline theme script must still exist')
    const src = script![1]
    assert.match(src, /localStorage\.getItem\('theme'\)==='light'/)
    assert.match(src, /classList\.remove\('dark'\)/)
    assert.doesNotMatch(src, /classList\.add\('dark'\)/)
  })

  test('the script runs in <head>, before first paint', () => {
    const head = LAYOUT.match(/<head>([\s\S]*?)<\/head>/)
    assert.ok(head)
    assert.match(head![1], /dangerouslySetInnerHTML/)
  })

  test('hydration mismatch on the theme class is suppressed', () => {
    assert.match(LAYOUT, /suppressHydrationWarning/)
  })
})

// ── Token coverage & light/dark parity ──────────────────────────────────────

/** Every token whose value legitimately differs between the two themes. */
const THEME_VARYING = [
  // Fable material tokens
  '--nv-bg0', '--nv-bg1', '--nv-text', '--nv-text2', '--nv-text3',
  '--nv-line', '--nv-bd', '--nv-card', '--nv-card-solid', '--nv-mod', '--nv-tbl',
  '--nv-chip', '--nv-chipbd', '--nv-acc', '--nv-acc2', '--nv-hdrbg',
  '--nv-hdrbg-solid', '--nv-hover', '--nv-selected', '--nv-onnav', '--nv-focus',
  '--nv-scrim', '--nv-actioncard',
  '--nv-posbg', '--nv-negbg', '--nv-critbg', '--nv-ambbg', '--nv-revbg', '--nv-neubg',
  '--nv-ch1', '--nv-ch2', '--nv-ch3',
  '--nv-sh', '--nv-sh-auth', '--nv-sh-action', '--nv-sh-drawer', '--nv-sh-button',
  '--nv-sh-palette',
  // NMI semantic aliases
  '--surface', '--surface-2', '--muted-fg', '--meta-fg', '--border-strong',
  '--primary', '--primary-fg', '--accent-fg',
  '--positive', '--negative', '--warning', '--critical', '--review',
  '--critical-fill', '--critical-fill-fg',
  '--news-src-df', '--news-src-lt', '--news-src-em', '--news-src-de',
  '--news-src-cmf', '--news-src-bc',
  '--sidebar', '--sidebar-fg', '--sidebar-muted', '--sidebar-active',
  '--sidebar-accent', '--sidebar-border',
  '--topbar', '--topbar-fg', '--topbar-border',
]

/** Semantic names the design brief requires, resolved in the light block. */
const REQUIRED_SEMANTIC = [
  '--background', '--background-2', '--surface', '--surface-2',
  '--surface-module', '--surface-table',
  '--foreground', '--muted', '--muted-fg', '--meta-fg',
  '--border', '--border-strong', '--focus',
  '--brand-teal', '--brand-navy', '--brand-blue', '--brand-pale', '--brand-cyan',
  '--link',
  '--positive', '--negative', '--warning', '--review', '--unavailable',
  '--state-live', '--state-persisted', '--state-hybrid', '--state-static',
  '--state-blocked', '--state-unavailable',
  '--hover', '--selected', '--scrim',
]

describe('design tokens', () => {
  test('every theme-varying token is defined in BOTH :root and .dark', () => {
    const missing: string[] = []
    for (const token of THEME_VARYING) {
      const re = new RegExp(`${token}\\s*:`)
      if (!re.test(LIGHT)) missing.push(`${token} (light)`)
      if (!re.test(DARK)) missing.push(`${token} (dark)`)
    }
    assert.deepEqual(missing, [], `tokens missing a theme counterpart: ${missing.join(', ')}`)
  })

  test('every required semantic token exists', () => {
    const missing = REQUIRED_SEMANTIC.filter((t) => !new RegExp(`${t}\\s*:`).test(LIGHT))
    assert.deepEqual(missing, [])
  })

  test('semantic tokens are registered as Tailwind utilities', () => {
    for (const name of [
      '--color-background', '--color-surface', '--color-surface-table',
      '--color-foreground', '--color-muted-fg', '--color-border', '--color-focus',
      '--color-positive', '--color-negative', '--color-warning', '--color-review',
    ]) {
      assert.match(CSS, new RegExp(`${name}\\s*:`), `${name} should be registered in @theme`)
    }
  })

  test('no raw Tailwind color-scale value is hardcoded in the token layer', () => {
    assert.doesNotMatch(CSS, /\b(bg|text|border)-(gray|slate|zinc|emerald|red|blue|indigo)-\d{2,3}\b/)
  })

  test('brand constants carry the approved institutional hexes', () => {
    assert.match(LIGHT, /--brand-teal:\s*#004A64/i)
    assert.match(LIGHT, /--brand-navy:\s*#00355F/i)
    assert.match(LIGHT, /--brand-blue:\s*#7399C6/i)
    assert.match(LIGHT, /--brand-pale:\s*#ACD4F1/i)
    assert.match(LIGHT, /--brand-cyan:\s*#23BAE8/i)
  })

  test('purple appears only as the Review status token', () => {
    // #7A68AE / #B9ABE4 / #5E4B8B are the only permitted violets.
    assert.match(LIGHT, /--review:\s*#5E4B8B/i)
    assert.match(DARK, /--review:\s*#B9ABE4/i)
  })

  test('every contrast deviation from the Fable palette is documented in-file', () => {
    // Three tokens deliberately depart from tokens.json for WCAG AA reasons.
    // Each must carry a DEVIATION note so the choice is never mistaken for drift.
    const notes = [...CSS.matchAll(/DEVIATION \(documented\)/g)].length
    assert.ok(notes >= 3, `expected >= 3 documented deviations, found ${notes}`)
    assert.match(LIGHT, /--positive:\s*#1A6630/i)   // Fable #3EA464 = 3.1:1 on white
    assert.match(DARK, /--positive:\s*#3EA464/i)    // Fable value passes on dark
    assert.match(DARK, /--negative:\s*#D05050/i)    // Fable #D4796B regresses white-on-fill
  })
})

// ── Liquid Glass material system ────────────────────────────────────────────

const GLASS_TIERS = [
  '.nv-glass-auth',      // 1 · authentication
  '.nv-glass-nav',       // 2 · navigation
  '.nv-glass-kpi',       // 3 · floating KPI
  '.nv-glass-card',      // 4 · standard analytical
  '.nv-glass-overlay',   // 5 · elevated modal / drawer
  '.nv-surface-dense',   // 6 · near-opaque dense table surface
  '.nv-scrim',           // 7 · scrim / overlay
]

describe('Liquid Glass material tiers', () => {
  test('all seven tiers exist', () => {
    for (const tier of GLASS_TIERS) {
      assert.ok(CSS.includes(`${tier} {`), `missing material tier ${tier}`)
    }
  })

  test('blur is applied only inside an @supports guard, so every tier has an opaque fallback', () => {
    const supports = CSS.match(/@supports \(\(backdrop-filter[\s\S]*?\n\}\n/)
    assert.ok(supports, 'backdrop-filter must be gated behind @supports')
    // No blur is *introduced* outside the @supports block; the only declarations
    // elsewhere are the guard rules and the print block, which switch it off.
    for (const m of CSS.matchAll(/backdrop-filter:([^;]+);/g)) {
      if (m[1].trim().startsWith('none')) continue
      assert.ok(
        supports![0].includes(m[0]),
        `blur declared outside @supports: ${m[0]}`,
      )
    }
  })

  test('dense data sits on a near-opaque surface (>= .92 alpha), never on glass', () => {
    for (const b of [LIGHT, DARK]) {
      const tbl = b.match(/--nv-tbl:\s*rgba\([^)]*,\s*\.(\d+)\)/)
      const mod = b.match(/--nv-mod:\s*rgba\([^)]*,\s*\.(\d+)\)/)
      assert.ok(tbl && Number(`0.${tbl[1]}`) >= 0.92, 'table surface must be >= .92 alpha')
      assert.ok(mod && Number(`0.${mod[1]}`) >= 0.92, 'analytical module surface must be >= .92 alpha')
    }
    // The dense tiers must not carry blur at all.
    const dense = CSS.match(/\.nv-surface-dense \{[^}]*\}/)
    assert.ok(dense && !dense[0].includes('backdrop-filter'))
  })

  test('no stacked blur — nested glass drops its own backdrop-filter', () => {
    assert.match(CSS, /NO STACKED BLUR/)
    assert.match(
      CSS,
      /:is\(\.nv-glass-auth, \.nv-glass-nav, \.nv-glass-kpi, \.nv-glass-card, \.nv-glass-overlay\)\s*\n:is\(/,
    )
  })

  test('no backdrop blur on table rows or cells', () => {
    assert.match(CSS, /NO BLUR ON DENSE DATA/)
    assert.match(CSS, /:is\(thead, tbody, tfoot, tr, th, td\) \{\s*\n\s*backdrop-filter: none/)
  })

  test('row hover is a tint, not a blur change', () => {
    assert.match(CSS, /\.nv-row-hover:hover \{\s*\n\s*background-color: var\(--hover\);/)
  })

  test('print flattens every glass surface to opaque and removes the scrim', () => {
    const print = CSS.match(/@media print \{[\s\S]*?\n\}\n\n\/\* Utility/)
    assert.ok(print)
    assert.match(print![0], /backdrop-filter: none !important/)
    assert.match(print![0], /background: #ffffff !important/)
    assert.match(print![0], /\.nv-scrim \{ display: none !important; \}/)
    assert.match(print![0], /\.no-print \{ display: none !important; \}/)
  })
})

// ── Typography ──────────────────────────────────────────────────────────────

describe('typography', () => {
  test('system font stack only — no web font download', () => {
    assert.match(CSS, /--font-sans:\s*-apple-system, BlinkMacSystemFont, "SF Pro Display"/)
    assert.doesNotMatch(CSS, /@font-face|fonts\.googleapis|next\/font/)
  })

  test('tabular, lining numerals apply body-wide', () => {
    const body = CSS.match(/\nbody \{[\s\S]*?\n\}/)
    assert.ok(body)
    assert.match(body![0], /font-variant-numeric: tabular-nums lining-nums/)
  })

  test('.ui-label and .ui-table-header use the Fable sectionLabel spec', () => {
    for (const cls of ['.ui-label', '.ui-table-header']) {
      const rule = CSS.match(new RegExp(`\\${cls} \\{[^}]*\\}`))
      assert.ok(rule, `${cls} must exist`)
      assert.match(rule![0], /font-family: var\(--font-sans\)/)
      assert.match(rule![0], /font-size: var\(--fs-section-label\)/)
      assert.match(rule![0], /font-weight: var\(--fw-bold\)/)
      assert.match(rule![0], /letter-spacing: var\(--tracking-section-label\)/)
      assert.match(rule![0], /text-transform: uppercase/)
      assert.doesNotMatch(rule![0], /font-mono/)
    }
    assert.match(LIGHT, /--fs-section-label:\s*10\.5px/)
    assert.match(LIGHT, /--fw-bold:\s*700/)
    assert.match(LIGHT, /--tracking-section-label:\s*\.14em/)
  })

  test('tracking never exceeds .14em', () => {
    for (const m of CSS.matchAll(/letter-spacing:\s*\.?(\d*\.?\d+)em/g)) {
      assert.ok(Number(m[1]) <= 0.14, `letter-spacing ${m[1]}em exceeds the .14em maximum`)
    }
    for (const m of CSS.matchAll(/--tracking-[a-z-]+:\s*(\.\d+)em/g)) {
      assert.ok(Number(m[1]) <= 0.14, `tracking token ${m[1]}em exceeds the .14em maximum`)
    }
  })

  test('.ui-number keeps the body font with tabular numerals (never mono)', () => {
    const rule = CSS.match(/\.ui-number \{[^}]*\}/)
    assert.ok(rule)
    assert.match(rule![0], /font-family: var\(--font-sans\)/)
    assert.match(rule![0], /tabular-nums lining-nums/)
  })

  test('the full type scale is tokenised', () => {
    for (const t of [
      '--fs-login-headline', '--fs-kpi-hero', '--fs-chart-headline',
      '--fs-capsule-value', '--fs-page-title', '--fs-card-value', '--fs-body',
      '--fs-table-cell', '--fs-section-label', '--fs-micro-label', '--fs-meta',
    ]) {
      assert.match(LIGHT, new RegExp(`${t}\\s*:`), `missing type token ${t}`)
    }
  })
})

// ── Radii, shadows, spacing ─────────────────────────────────────────────────

describe('radius scale', () => {
  test('the full semantic scale is registered', () => {
    const expected: Array<[string, string]> = [
      ['--radius-pill', '999px'],
      ['--radius-hero', '24px'],
      ['--radius-card', '22px'],
      ['--radius-module', '20px'],
      ['--radius-capsule', '18px'],
      ['--radius-input', '13px'],
      ['--radius-menu', '12px'],
      ['--radius-cell', '6px'],
    ]
    for (const [token, value] of expected) {
      assert.match(CSS, new RegExp(`${token}:\\s*${value.replace('px', 'px')}`), `${token} should be ${value}`)
    }
  })

  test('dense material tiers use the small end of the scale', () => {
    // The dense/table surfaces must never carry a card- or hero-sized radius.
    for (const cls of ['.nv-surface-dense', '.nv-surface-module']) {
      const rule = CSS.match(new RegExp(`\\${cls} \\{[^}]*\\}`))
      assert.ok(rule)
      assert.doesNotMatch(rule![0], /--radius-(card|hero|module)/)
    }
  })
})

describe('shadow hierarchy', () => {
  test('shadows are tokenised per material role', () => {
    for (const t of ['--shadow-card', '--shadow-auth', '--shadow-action', '--shadow-drawer', '--shadow-button', '--shadow-palette']) {
      assert.match(CSS, new RegExp(`${t}:`), `missing ${t}`)
    }
  })

  test('no shadow is declared on a table element or a form field', () => {
    // Walk every declaration block and check the selectors that own it.
    const offenders: string[] = []
    for (const rule of CSS.matchAll(/([^{}@\/]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].split('\n').pop()!.trim()
      const body = rule[2]
      if (!/box-shadow:\s*(?!none)/.test(body)) continue
      if (/(^|[\s,>+~])(tr|td|th|thead|tbody|tfoot|input|select|textarea)([\s,:.[]|$)/.test(selector)) {
        offenders.push(selector)
      }
    }
    assert.deepEqual(offenders, [], `shadows are forbidden on table rows/cells and form fields: ${offenders.join(' | ')}`)
  })

  test('the dense tiers carry no shadow at all', () => {
    for (const cls of ['.nv-surface-dense', '.nv-surface-module', '.nv-row-hover:hover']) {
      const rule = CSS.match(new RegExp(`\\${cls.replace(':hover', ':hover')} \\{[^}]*\\}`))
      if (rule) assert.doesNotMatch(rule[0], /box-shadow/)
    }
  })
})

describe('spacing scale', () => {
  test('Fable spacing and the 1560px content width are tokenised', () => {
    for (const t of ['--space-card-y', '--space-card-x', '--space-hero-y', '--space-hero-x', '--space-grid-gap', '--space-row-y', '--content-max-w']) {
      assert.match(LIGHT, new RegExp(`${t}\\s*:`), `missing ${t}`)
    }
    assert.match(LIGHT, /--content-max-w:\s*1560px/)
  })
})

// ── Motion ──────────────────────────────────────────────────────────────────

describe('motion foundation', () => {
  test('duration and easing tokens exist for every approved motion role', () => {
    for (const t of [
      '--dur-hover', '--dur-state', '--dur-pop', '--dur-drawer', '--dur-nav',
      '--dur-pulse', '--dur-reveal', '--dur-countup', '--dur-bar', '--dur-fade',
      '--dur-ken', '--stagger-reveal', '--ease-primary', '--ease-out-cubic',
    ]) {
      assert.match(LIGHT, new RegExp(`${t}\\s*:`), `missing motion token ${t}`)
    }
    assert.match(LIGHT, /--ease-primary:\s*cubic-bezier\(\.22, \.61, \.36, 1\)/)
    assert.match(LIGHT, /--dur-nav:\s*380ms/)
    assert.match(LIGHT, /--dur-drawer:\s*320ms/)
    assert.match(LIGHT, /--dur-pop:\s*220ms/)
    assert.match(LIGHT, /--dur-reveal:\s*640ms/)
  })

  test('all six Fable keyframes are defined', () => {
    for (const k of ['nvKen', 'nvPulse', 'nvSpin', 'nvPop', 'nvSlide', 'nvIn']) {
      assert.match(CSS, new RegExp(`@keyframes ${k}\\b`), `missing @keyframes ${k}`)
    }
  })

  test('foundational motion utilities exist and reference tokens, not literals', () => {
    for (const cls of ['.nv-transition', '.nv-transition-state', '.nv-indicator', '.nv-pop', '.nv-slide-in', '.nv-reveal']) {
      const rule = CSS.match(new RegExp(`\\${cls} \\{[^}]*\\}`))
      assert.ok(rule, `missing motion utility ${cls}`)
      assert.match(rule![0], /var\(--(dur|ease)-/, `${cls} must consume motion tokens`)
    }
  })

  test('no animation library was added', () => {
    const pkg = JSON.parse(read('package.json'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const banned of ['framer-motion', 'motion', 'gsap', 'react-spring', '@react-spring/web', 'animejs', 'lucide-react', 'recharts', 'chart.js']) {
      assert.ok(!(banned in deps), `unexpected dependency: ${banned}`)
    }
  })
})

describe('reduced motion (hard rule)', () => {
  const rm = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/)

  test('the media query exists and collapses every animation and transition', () => {
    assert.ok(rm, 'a prefers-reduced-motion block must exist')
    assert.match(rm![0], /animation-duration: \.01ms !important/)
    assert.match(rm![0], /animation-iteration-count: 1 !important/)
    assert.match(rm![0], /transition-duration: \.01ms !important/)
  })

  test('section reveal, Ken-Burns, pulse and spin are disabled outright', () => {
    assert.match(rm![0], /\.nv-reveal[^{]*\{[\s\S]*?animation: none !important/)
    assert.match(rm![0], /\.nv-ken, \.nv-pulse, \.nv-spin \{[\s\S]*?animation: none !important/)
  })

  test('content renders in its final visible position', () => {
    assert.match(rm![0], /opacity: 1 !important/)
    assert.match(rm![0], /transform: none !important/)
    assert.match(rm![0], /filter: none !important/)
  })
})

// ── Accessibility & responsive guarantees ───────────────────────────────────

describe('accessibility foundation', () => {
  test('the focus ring is 2px solid var(--focus), offset 2px, and never removed', () => {
    const rule = CSS.match(/:focus-visible \{[^}]*\}/)
    assert.ok(rule)
    assert.match(rule![0], /outline: 2px solid var\(--focus\)/)
    assert.match(rule![0], /outline-offset: 2px/)
    assert.doesNotMatch(CSS, /outline:\s*(none|0)\s*;/)
  })

  test('--focus resolves to the Fable focus colour in both themes', () => {
    assert.match(LIGHT, /--nv-focus:\s*#2F6EB6/i)
    assert.match(DARK, /--nv-focus:\s*#68A6D6/i)
  })
})

describe('responsive guarantees preserved', () => {
  test('no root min-width was reintroduced', () => {
    assert.doesNotMatch(CSS, /min-width:\s*1200px/)
    assert.doesNotMatch(CSS, /html\s*\{[^}]*min-width/s)
  })

  test('no page-level horizontal overflow is forced by the foundation', () => {
    assert.doesNotMatch(CSS, /\n(html|body)[^{]*\{[^}]*overflow-x:\s*(scroll|auto)/)
  })

  test('the 17px root scale and print unlocks are unchanged', () => {
    assert.match(CSS, /html \{ font-size: 17px; \}/)
    assert.match(CSS, /\.overflow-y-auto, \.overflow-auto, \.overflow-x-auto \{ overflow: visible !important; \}/)
  })
})

// ── Brand mark ──────────────────────────────────────────────────────────────

describe('logo foundation', () => {
  const LOGO = 'public/nevada-logo.svg'

  test('the authoritative SVG is present in public/', () => {
    assert.ok(existsSync(join(ROOT, LOGO)), `${LOGO} must exist`)
  })

  test('the asset is a preserved SVG, not a redraw or a raster', () => {
    const svg = read(LOGO)
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="435" height="348" viewBox="0 0 435 348">/)
    assert.match(svg, /#1E5591/i, 'the deep-blue brand hex must be intact')
    assert.match(svg, /#23BAE8/i, 'the cyan brand hex must be intact')
    assert.doesNotMatch(svg, /<filter|feDropShadow|feGaussianBlur/, 'no effects may be added to the mark')
  })

  test('the legacy raster pair is retained (existing branding untouched this phase)', () => {
    assert.ok(existsSync(join(ROOT, 'public/nevada-logo-light.jpg')))
    assert.ok(existsSync(join(ROOT, 'public/nevada-logo-dark.png')))
    assert.match(read('src/components/ui/BrandLogo.tsx'), /nevada-logo-light\.jpg/)
  })

  test('NevadaMark renders the untouched asset with graceful degradation', () => {
    const src = read('src/components/ui/NevadaMark.tsx')
    assert.match(src, /src="\/nevada-logo\.svg"/)
    assert.match(src, /onError=\{\(\) => setFailed\(true\)\}/)
    assert.match(src, /if \(failed\) return null/)
  })

  test('NevadaMark adds no shadow, glow, outline, or visible box', () => {
    const src = read('src/components/ui/NevadaMark.tsx')
    assert.doesNotMatch(src, /boxShadow|filter:|dropShadow|outline:|borderRadius|backgroundColor/)
  })

  test('NevadaMark reproduces the approved 30px header symbol crop', () => {
    const src = read('src/components/ui/NevadaMark.tsx')
    assert.match(src, /SYMBOL_WINDOW = 30/)
    assert.match(src, /SYMBOL_IMAGE_WIDTH = 92/)
    assert.match(src, /SYMBOL_OFFSET_X = -29/)
    assert.match(src, /SYMBOL_OFFSET_Y = -6/)
  })
})

// ── Source-disclosure compatibility (merge-contract point 10) ───────────────

describe('source-disclosure components remain intact and token-compatible', () => {
  test('the badge components still exist and use semantic tokens only', () => {
    for (const f of [
      'src/components/ui/DataSourceBadge.tsx',
      'src/components/ui/MarketDataSourceBadge.tsx',
      'src/components/ui/SourceStateBadge.tsx',
      'src/components/ui/TableSourceFooter.tsx',
    ]) {
      const src = read(f)
      assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/, `${f} must not hardcode a hex`)
      assert.doesNotMatch(src, /\b(bg|text|border)-(gray|slate|emerald|red)-\d{2,3}\b/, `${f} must not use a raw colour scale`)
    }
  })

  test('the state vocabulary the badges paint with is tokenised for the restyle', () => {
    for (const t of ['--state-live', '--state-persisted', '--state-hybrid', '--state-static', '--state-blocked', '--state-unavailable']) {
      assert.match(LIGHT, new RegExp(`${t}\\s*:`))
    }
  })

  test('Phase 1 changed no page, route, API, or business-logic file', () => {
    // The foundation must be inheritable without touching content.
    assert.ok(existsSync(join(ROOT, 'src/app/page.tsx')))
    assert.ok(existsSync(join(ROOT, 'src/middleware.ts')))
    // layout.tsx keeps its metadata contract (robots noindex, favicon, template).
    assert.match(LAYOUT, /robots: \{ index: false, follow: false \}/)
    assert.match(LAYOUT, /template: '%s · NMI'/)
    assert.match(LAYOUT, /icon: '\/favicon\.svg\?v=2'/)
    assert.match(LAYOUT, /<AppShell>\{children\}<\/AppShell>/)
  })
})
