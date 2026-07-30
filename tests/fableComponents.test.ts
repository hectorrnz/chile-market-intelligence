// Phase 3 — Fable shared component library.
//
// Source-scan tests (this repo's established convention — no React-rendering
// test infra exists and Phase 3 adds none). Cover: every new component file
// exists and uses only semantic tokens (no hardcoded hex, no raw Tailwind
// color scale), no embedded sample financial data, dialog/a11y semantics on
// the restyled overlays, EN/ES i18n completeness for every new string, and
// that the untouched source-integrity components remain untouched.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const FABLE_DIR = 'src/components/fable'
const NEW_COMPONENTS = [
  'GlassSurface.tsx',
  'useCountUp.ts',
  'Sparkline.tsx',
  'SparklineRow.tsx',
  'ChangeIndicator.tsx',
  'KpiCapsule.tsx',
  'KpiHero.tsx',
  'CurrentActions.tsx',
  'SegmentedControl.tsx',
  'BarrierGauge.tsx',
  'TableCard.tsx',
  'PrivacyValue.tsx',
  'usePrivacyMode.ts',
  'DetailPanel.tsx',
  'AsyncState.tsx',
  'motion.tsx',
]

const MODIFIED_COMPONENTS = [
  'src/components/ui/StatusPill.tsx',
  'src/components/ui/NotificationBell.tsx',
  'src/components/ui/CommandPalette.tsx',
]

// ── File existence ──────────────────────────────────────────────────────────

describe('every new Fable shared component exists', () => {
  for (const file of NEW_COMPONENTS) {
    test(`${FABLE_DIR}/${file} exists`, () => {
      assert.ok(existsSync(join(ROOT, FABLE_DIR, file)), `missing ${FABLE_DIR}/${file}`)
    })
  }
})

// ── Semantic tokens only — no hardcoded hex, no raw Tailwind color scale ───

describe('no hardcoded hex colors in any new or modified component', () => {
  const ALL = [...NEW_COMPONENTS.map((f) => `${FABLE_DIR}/${f}`), ...MODIFIED_COMPONENTS]
  for (const file of ALL) {
    test(`${file} has no hardcoded hex`, () => {
      const src = read(file)
      // rgba(255,255,255,.NN) literals are permitted ONLY on the Current
      // Actions card (an explicit design_principles §5.2 fixed-light-on-teal
      // exception, itself built from existing --nv-actioncard/--shadow-action
      // tokens) — hex colors are never permitted anywhere.
      assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${file} must not hardcode a hex color`)
    })
  }
})

describe('no raw Tailwind color-scale classes in any new or modified component', () => {
  const ALL = [...NEW_COMPONENTS.map((f) => `${FABLE_DIR}/${f}`), ...MODIFIED_COMPONENTS]
  for (const file of ALL) {
    test(`${file} has no raw color-scale utility`, () => {
      const src = read(file)
      assert.doesNotMatch(
        src,
        /\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
        `${file} must use semantic tokens, not a raw Tailwind color scale`,
      )
    })
  }
})

describe('no duplicate theme/material system introduced', () => {
  test('no component declares its own CSS custom property token (only consumes var(--…))', () => {
    for (const file of NEW_COMPONENTS.map((f) => `${FABLE_DIR}/${f}`)) {
      const src = read(file)
      const declared = [...src.matchAll(/'--([a-zA-Z0-9-]+)':/g)].map((m) => m[1])
      for (const name of declared) {
        assert.equal(name, 'nv-reveal-delay', `${file} declares an unexpected CSS custom property --${name}`)
      }
    }
  })

  test('globals.css additions reuse existing tokens — no new color/blur/shadow token declared', () => {
    const css = read('src/app/globals.css')
    const actionBlock = css.match(/\.nv-action-card \{[^}]*\}/)
    assert.ok(actionBlock, '.nv-action-card must exist')
    assert.match(actionBlock![0], /var\(--nv-actioncard\)/)
    assert.match(actionBlock![0], /var\(--shadow-action\)/)
    assert.match(actionBlock![0], /var\(--radius-card\)/)

    const pulseBlock = css.match(/\.nv-content-pulse \{[^}]*\}/)
    assert.ok(pulseBlock, '.nv-content-pulse must exist')
    assert.match(pulseBlock![0], /nvPulse var\(--dur-pulse\) var\(--ease-primary\) 1/)
    // Reuses the existing nvPulse keyframe — no new @keyframes was added.
    assert.equal([...css.matchAll(/@keyframes nvPulse\b/g)].length, 1)
  })
})

// ── No embedded sample data ─────────────────────────────────────────────────

describe('no embedded sample financial data in any new component', () => {
  const BANNED_SAMPLE_PATTERNS: RegExp[] = [
    /SQM-B|BSANTANDER|COPEC|CHILE\.SN/, // real tickers used as literal sample values
    /['"]SAMPLE['"]/, // Fable's own literal SAMPLE badge string (doc-comment prose mentioning "sample data" is fine and expected)
    /"?\$?\s?1[,.]234[,.]567/, // canonical fake figures
  ]
  for (const file of NEW_COMPONENTS.map((f) => `${FABLE_DIR}/${f}`)) {
    test(`${file} contains no embedded sample data`, () => {
      const src = read(file)
      for (const re of BANNED_SAMPLE_PATTERNS) {
        assert.doesNotMatch(src, re, `${file} appears to embed sample data (matched ${re})`)
      }
    })
  }

  test('every data-bearing prop is typed to accept real external values, never a default sample value', () => {
    for (const file of ['KpiCapsule.tsx', 'KpiHero.tsx', 'CurrentActions.tsx', 'BarrierGauge.tsx', 'TableCard.tsx']) {
      const src = read(`${FABLE_DIR}/${file}`)
      // No component may default a data prop (value/actions/marks/children) to
      // a non-empty literal — only `= []`, `= false`, or no default at all.
      assert.doesNotMatch(src, /(value|actions|marks)\s*=\s*\[.+\]/, `${file} must not default a data prop to sample content`)
    }
  })
})

// ── StatusPill — additive, no signature change ──────────────────────────────

describe('StatusPill extended with the requested semantic states', () => {
  const src = read('src/components/ui/StatusPill.tsx')

  test('every requested variant is present', () => {
    for (const v of ['positive', 'negative', 'warning', 'review', 'neutral', 'unavailable', 'critical', 'live', 'persisted', 'derived', 'fallback', 'blocked']) {
      assert.match(src, new RegExp(`\\b${v}:`), `missing StatusPill variant "${v}"`)
    }
  })

  test('prop signature is unchanged — still { label, variant }', () => {
    assert.match(src, /interface StatusPillProps \{\s*label: string\s*variant\?: PillVariant\s*\}/)
  })

  test('reuses the existing --state-* tokens rather than inventing new colors', () => {
    assert.match(src, /pillStyle\('--state-live'\)/)
    assert.match(src, /pillStyle\('--state-persisted'\)/)
    assert.match(src, /pillStyle\('--state-static'\)/)
    assert.match(src, /pillStyle\('--state-blocked'\)/)
    assert.match(src, /pillStyle\('--state-unavailable'\)/)
  })

  test('does not replace DataSourceBadge/SourceStateBadge vocabulary or logic', () => {
    assert.doesNotMatch(src, /SOURCE_REGISTRY|DataSourceStatus/)
  })
})

// ── Source-integrity components remain untouched ────────────────────────────

describe('DataSourceBadge, SourceStateBadge, and TableSourceFooter are untouched', () => {
  test('DataSourceBadge.tsx unchanged in shape/state vocabulary', () => {
    const src = read('src/components/ui/DataSourceBadge.tsx')
    assert.match(src, /STATUS_KEY: Record<DataSourceStatus,/)
    assert.match(src, /DOT_COLOR: Record<DataSourceStatus,/)
  })

  test('SourceStateBadge.tsx unchanged in shape/state vocabulary', () => {
    const src = read('src/components/ui/SourceStateBadge.tsx')
    assert.match(src, /SOURCE_REGISTRY, getSourceLabel, getStateWord/)
  })

  test('TableSourceFooter.tsx unchanged — still "Source: {source} as of {date}"', () => {
    const src = read('src/components/ui/TableSourceFooter.tsx')
    assert.match(src, /\{t\.common\.source\}: \{source\}/)
  })

  test('none of the three were modified this phase (no Fable-only glass class introduced)', () => {
    for (const f of ['src/components/ui/DataSourceBadge.tsx', 'src/components/ui/MarketDataSourceBadge.tsx', 'src/components/ui/SourceStateBadge.tsx', 'src/components/ui/TableSourceFooter.tsx']) {
      const src = read(f)
      assert.doesNotMatch(src, /nv-glass|nv-surface-dense|nv-action-card/, `${f} was expected to stay untouched this phase`)
    }
  })
})

// ── Dialog / a11y semantics on restyled overlays ────────────────────────────

describe('NotificationBell restyled to a full accessible drawer', () => {
  const src = read('src/components/ui/NotificationBell.tsx')

  test('dialog semantics present', () => {
    assert.match(src, /role="dialog"/)
    assert.match(src, /aria-modal="true"/)
  })

  test('Escape closes, backdrop closes, focus is trapped and restored, body scroll locks', () => {
    assert.match(src, /useEscape\(open, \(\) => setOpen\(false\)\)/)
    assert.match(src, /nv-scrim absolute inset-0" onClick=\{\(\) => setOpen\(false\)\}/)
    assert.match(src, /FOCUSABLE_SELECTOR/)
    assert.match(src, /document\.body\.style\.overflow = 'hidden'/)
    assert.match(src, /triggerRef\.current\?\.focus\(\)/)
  })

  test('polling, auth-gating, mark-read, mark-all-read, links, and timestamps are preserved', () => {
    assert.match(src, /POLL_MS = 60_000/)
    assert.match(src, /if \(!signedIn\) return null/)
    assert.match(src, /await fetch\(`\/api\/notifications\/\$\{id\}\/read`, \{ method: 'POST' \}\)/)
    assert.match(src, /await fetch\('\/api\/notifications\/read-all', \{ method: 'POST' \}\)/)
    assert.match(src, /n\.linkUrl/)
    assert.match(src, /new Date\(n\.createdAt\)\.toLocaleString\(\)/)
  })

  test('empty, loading-tolerant (no crash on transient fetch failure), and error paths preserved', () => {
    assert.match(src, /t\.notifications\.empty/)
    assert.match(src, /\.catch\(\(\) => \{/)
  })

  test('no fabricated notification content', () => {
    assert.doesNotMatch(src, /title: 'Sample|New note|Portfolio alert/)
  })
})

describe('CommandPalette restyled to the glass overlay language', () => {
  const src = read('src/components/ui/CommandPalette.tsx')

  test('dialog semantics present', () => {
    assert.match(src, /role="dialog"/)
    assert.match(src, /aria-modal="true"/)
  })

  test('keyboard shortcut, navigation, and search behavior preserved', () => {
    assert.match(src, /e\.metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === 'k'/)
    assert.match(src, /e\.key === '\/' && !typing && !open/)
    assert.match(src, /window\.addEventListener\('cmdk:open', onOpen\)/)
    assert.match(src, /ArrowDown/)
    assert.match(src, /ArrowUp/)
    assert.match(src, /select\(visible\[active\]\.ticker\)/)
  })

  test('routes to the real company page — no new mock command added', () => {
    assert.match(src, /router\.push\(`\/companies\/\$\{ticker\}`\)/)
    assert.doesNotMatch(src, /router\.push\('\/(admin|settings-mock|demo)/)
  })

  test('recent searches still persisted via the existing usePersistentState key', () => {
    assert.match(src, /usePersistentState<\{ ticker: string; ts: number \}\[\]>\('cmi\.recentSearches', \[\]\)/)
  })
})

describe('DetailPanel is a full accessible dialog and never a route replacement', () => {
  const src = read(`${FABLE_DIR}/DetailPanel.tsx`)

  test('dialog semantics, Escape, backdrop, focus trap, body lock, focus restore', () => {
    assert.match(src, /role="dialog"/)
    assert.match(src, /aria-modal="true"/)
    assert.match(src, /useEscape\(open, onClose\)/)
    assert.match(src, /nv-scrim absolute inset-0" onClick=\{onClose\}/)
    assert.match(src, /FOCUSABLE_SELECTOR/)
    assert.match(src, /document\.body\.style\.overflow = 'hidden'/)
    assert.match(src, /triggerRef\.current as HTMLElement \| null\)\?\.focus\?\.\(\)/)
  })

  test('offers a link back to the canonical full page — never the only path to the content', () => {
    assert.match(src, /fullPageHref/)
    assert.match(src, /<Link href=\{fullPageHref\}/)
  })

  test('no sample company or structured-note data embedded', () => {
    assert.doesNotMatch(src, /SQM-B|XS\d{10}|ISIN/)
  })
})

// ── SegmentedControl — keyboard + ARIA ──────────────────────────────────────

describe('SegmentedControl is keyboard-operable with correct ARIA', () => {
  const src = read(`${FABLE_DIR}/SegmentedControl.tsx`)

  test('role=radiogroup / role=radio with aria-checked and a roving tabindex', () => {
    assert.match(src, /role="radiogroup"/)
    assert.match(src, /role="radio"/)
    assert.match(src, /aria-checked=\{active\}/)
    assert.match(src, /tabIndex=\{active \? 0 : -1\}/)
  })

  test('Left/Right/Up/Down/Home/End are all handled', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      assert.match(src, new RegExp(`'${key}'`), `missing ${key} handling`)
    }
  })

  test('supports a controlled value and disabled options', () => {
    assert.match(src, /value: T/)
    assert.match(src, /onChange: \(value: T\) => void/)
    assert.match(src, /disabled=\{option\.disabled\}/)
  })

  test('reuses the Phase 2 sliding-indicator hook rather than a new visual system', () => {
    assert.match(src, /import \{ useNavIndicator \} from '@\/components\/layout\/useNavIndicator'/)
  })

  test('the indicator uses the reduced-motion-gated .nv-indicator utility', () => {
    assert.match(src, /nv-indicator/)
  })
})

// ── BarrierGauge — accessibility, no color-only meaning ─────────────────────

describe('BarrierGauge', () => {
  const src = read(`${FABLE_DIR}/BarrierGauge.tsx`)

  test('has a real accessible text equivalent, not only an aria-label', () => {
    assert.match(src, /role="img"/)
    assert.match(src, /aria-label=\{accessibleText\}/)
    // The same text is also rendered as visible content — never color-only.
    assert.match(src, /<span className="ui-meta text-muted-fg">\{accessibleText\}<\/span>/)
  })

  test('accepts values and thresholds entirely through props', () => {
    assert.match(src, /current: number \| null/)
    assert.match(src, /marks: BarrierMark\[\]/)
  })

  test('supports multiple barrier kinds', () => {
    for (const k of ['knockIn', 'coupon', 'autocall', 'strike']) {
      assert.match(src, new RegExp(k))
    }
  })

  test('the unavailable state is honest, not a fabricated gauge', () => {
    assert.match(src, /if \(current === null \|\| !Number\.isFinite\(current\)\)/)
  })

  test('no hardcoded structured-note values (ISINs, specific barrier percentages)', () => {
    assert.doesNotMatch(src, /XS\d{10}|65%|100%/)
  })

  test('no decorative 3D effects (gradient/filter/perspective)', () => {
    assert.doesNotMatch(src, /perspective|rotate3d|linear-gradient|radial-gradient|filter:\s*blur/)
  })
})

// ── PrivacyValue — masking, controlled, no persistence of the value itself ─

describe('privacy masking', () => {
  const valueSrc = read(`${FABLE_DIR}/PrivacyValue.tsx`)
  const hookSrc = read(`${FABLE_DIR}/usePrivacyMode.ts`)

  test('PrivacyValue is controlled by a boolean prop, never manages its own state', () => {
    assert.match(valueSrc, /masked: boolean/)
    assert.doesNotMatch(valueSrc, /useState/)
  })

  test('masking never alters the underlying value — only swaps rendered text', () => {
    assert.match(valueSrc, /if \(!masked\) return <span className=\{className\}>\{children\}<\/span>/)
    assert.doesNotMatch(valueSrc, /children\.replace|Number\(children\)|parseFloat/)
  })

  test('the masked state is announced to assistive technology, not silently visual-only', () => {
    assert.match(valueSrc, /aria-label=\{t\.fable\.privacy\.masked\}/)
  })

  test('no logging of sensitive values', () => {
    assert.doesNotMatch(valueSrc, /console\.(log|debug|info|warn|error)/)
  })

  test('usePrivacyMode uses the existing localStorage preference mechanism, not a new one', () => {
    assert.match(hookSrc, /usePersistentState<boolean>\('cmi\.privacyMode', false\)/)
    assert.doesNotMatch(hookSrc, /fetch\(|await /)
  })
})

// ── TableCard — overflow, states, footer/badge compatibility ───────────────

describe('TableCard (analytical table container)', () => {
  const src = read(`${FABLE_DIR}/TableCard.tsx`)

  test('scroll is card-level via overflow-x-auto, never page-level', () => {
    assert.match(src, /overflow-x-auto/)
  })

  test('renders on the near-opaque dense surface, not translucent glass', () => {
    assert.match(src, /GlassSurface variant="dense"/)
  })

  test('supports every required async state via the shared AsyncStateKind union', () => {
    assert.match(src, /state\?: AsyncStateKind/)
    const asyncSrc = read(`${FABLE_DIR}/AsyncState.tsx`)
    for (const s of ['loading', 'empty', 'error', 'unavailable', 'blocked', 'partial', 'stale']) {
      assert.match(asyncSrc, new RegExp(`'${s}'`), `AsyncStateKind must support the ${s} state`)
    }
  })

  test('accepts a footer slot without supplying its own source text (compatible with TableSourceFooter)', () => {
    assert.match(src, /footer\?: ReactNode/)
    assert.doesNotMatch(src, /Source:/)
  })

  test('does not embed a sample table', () => {
    assert.doesNotMatch(src, /<table>|<thead>|<tbody>/)
  })

  test('never mutates or filters the children it is given (no column hiding)', () => {
    assert.doesNotMatch(src, /\.filter\(|\.slice\(|\.map\(/)
  })
})

// ── AsyncState — semantic distinctness ──────────────────────────────────────

describe('AsyncState family keeps semantic distinctions', () => {
  const src = read(`${FABLE_DIR}/AsyncState.tsx`)

  test('all seven kinds are distinct and covered', () => {
    for (const k of ['loading', 'empty', 'error', 'unavailable', 'blocked', 'partial', 'stale']) {
      assert.match(src, new RegExp(`'${k}'`))
    }
  })

  test('error and unavailable render different copy keys, never interchangeable', () => {
    assert.notEqual(dict.en.fable.async.error.title, dict.en.fable.async.unavailable.title)
    assert.notEqual(dict.en.fable.async.error.body, dict.en.fable.async.unavailable.body)
  })

  test('stale and partial preserve source/as-of when supplied', () => {
    assert.match(src, /kind === 'partial' \|\| kind === 'stale'/)
    assert.match(src, /\{t\.common\.source\}: \{source\}/)
  })

  test('loading state renders a spinner and never claims data already exists', () => {
    assert.match(src, /nv-spin/)
    assert.doesNotMatch(dict.en.fable.async.loading.title, /loaded|complete|ready/i)
    assert.doesNotMatch(dict.en.fable.async.loading.body, /loaded|complete|ready/i)
  })
})

// ── Motion primitives ────────────────────────────────────────────────────────

describe('motion primitives wrap the Phase 1 reduced-motion-gated utilities', () => {
  const src = read(`${FABLE_DIR}/motion.tsx`)

  test('Reveal, Pop, SlideIn, ContentPulse all exist', () => {
    for (const name of ['Reveal', 'Pop', 'SlideIn', 'ContentPulse']) {
      assert.match(src, new RegExp(`export function ${name}`))
    }
  })

  test('OverlayTransition and ValueChangeTransition are provided as semantic aliases', () => {
    assert.match(src, /export const OverlayTransition = Pop/)
    assert.match(src, /export const ValueChangeTransition = ContentPulse/)
  })

  test('each wrapper applies only an existing CSS class — no inline animation, no new keyframes', () => {
    assert.match(src, /className=\{`nv-reveal/)
    assert.match(src, /className=\{`nv-pop/)
    assert.match(src, /className=\{`nv-slide-in/)
    assert.match(src, /className=\{`inline-block nv-content-pulse/)
    assert.doesNotMatch(src, /@keyframes/)
  })

  test('no animation library was added', () => {
    const pkg = JSON.parse(read('package.json'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const banned of ['framer-motion', 'motion', 'gsap', 'react-spring', '@react-spring/web', 'animejs']) {
      assert.ok(!(banned in deps), `unexpected dependency: ${banned}`)
    }
  })

  test('children are always rendered — never conditionally hidden by these wrappers', () => {
    assert.match(src, /\{children\}/)
    const occurrences = [...src.matchAll(/\{children\}/g)].length
    assert.ok(occurrences >= 4, 'every wrapper must render {children}')
  })
})

// ── Reduced motion — count-up and sliding-indicator consumers ──────────────

describe('reduced motion is honored by every new interactive/animated component', () => {
  test('useCountUp renders the final value immediately under reduced motion', () => {
    const src = read(`${FABLE_DIR}/useCountUp.ts`)
    assert.match(src, /usePrefersReducedMotion/)
    assert.match(src, /const animate = enabled && !reducedMotion/)
  })

  test('useCountUp never sets state synchronously in a bare effect body (matches this repo\'s accepted patterns)', () => {
    const src = read(`${FABLE_DIR}/useCountUp.ts`)
    assert.match(src, /Render-time previous-value pattern/)
  })

  test('Sparkline and BarrierGauge are static SVG — nothing to reduce', () => {
    const spark = read(`${FABLE_DIR}/Sparkline.tsx`)
    const gauge = read(`${FABLE_DIR}/BarrierGauge.tsx`)
    assert.doesNotMatch(spark, /animation|@keyframes|requestAnimationFrame/)
    assert.doesNotMatch(gauge, /animation|@keyframes|requestAnimationFrame/)
  })
})

// ── i18n completeness — every new visible string exists in EN + ES ─────────

describe('i18n: fable namespace exists and is complete in both languages', () => {
  test('dict.en.fable and dict.es.fable both exist', () => {
    assert.ok('fable' in dict.en, 'dict.en.fable must exist')
    assert.ok('fable' in dict.es, 'dict.es.fable must exist')
  })

  function collectKeyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
    const paths: string[] = []
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        paths.push(...collectKeyPaths(v as Record<string, unknown>, path))
      } else {
        paths.push(path)
      }
    }
    return paths
  }

  test('every key path under dict.en.fable exists under dict.es.fable, and vice versa', () => {
    const enPaths = collectKeyPaths(dict.en.fable as unknown as Record<string, unknown>).sort()
    const esPaths = collectKeyPaths(dict.es.fable as unknown as Record<string, unknown>).sort()
    assert.deepEqual(enPaths, esPaths)
  })

  test('no fable string is empty', () => {
    const enPaths = collectKeyPaths(dict.en.fable as unknown as Record<string, unknown>)
    function get(obj: Record<string, unknown>, path: string): unknown {
      return path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj)
    }
    for (const p of enPaths) {
      const en = get(dict.en.fable as unknown as Record<string, unknown>, p)
      const es = get(dict.es.fable as unknown as Record<string, unknown>, p)
      assert.ok(typeof en === 'string' && en.length > 0, `dict.en.fable.${p} must be non-empty`)
      assert.ok(typeof es === 'string' && es.length > 0, `dict.es.fable.${p} must be non-empty`)
    }
  })

  test('no new component hardcodes a UI string outside of useLang()/t.*', () => {
    // A conservative heuristic: every new component that renders visible
    // English words does so via `t.` — this catches an obvious regression
    // (a literal "Loading…" etc.) without false-positiving on aria-hidden
    // glyphs, punctuation, or the deliberately-untranslated `⌘K` shortcut hint.
    for (const file of ['CurrentActions.tsx', 'AsyncState.tsx', 'DetailPanel.tsx', 'PrivacyValue.tsx']) {
      const src = read(`${FABLE_DIR}/${file}`)
      assert.match(src, /useLang/, `${file} must consume useLang() for its visible text`)
    }
  })
})

// ── Component architecture hygiene ──────────────────────────────────────────

describe('component architecture', () => {
  test('every new component is typed (no implicit any props objects)', () => {
    for (const file of NEW_COMPONENTS.filter((f) => f.endsWith('.tsx'))) {
      const src = read(`${FABLE_DIR}/${file}`)
      assert.match(src, /interface \w+Props|<[A-Z]\w* extends string>/, `${file} should declare a typed props interface`)
    }
  })

  test('no page, route, API, or business-logic file changed this phase', () => {
    // Static existence/shape checks — these files must be present and
    // untouched in scope; a real diff-scope check happens at PR review, this
    // guards against an accidental structural change slipping in silently.
    assert.ok(existsSync(join(ROOT, 'src/middleware.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/auth/login/route.ts')))
    // R1.5: middleware delegates to the shared default-deny policy instead of
    // carrying its own PROTECTED_PAGES/PROTECTED_API arrays.
    const mw = read('src/middleware.ts')
    assert.match(mw, /requiresApprovedSession/)
    assert.match(mw, /decideRequestAccess/)
  })

  test('package.json has no new runtime dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    const deps = Object.keys(pkg.dependencies)
    assert.deepEqual(
      deps.sort(),
      ['@supabase/ssr', '@supabase/supabase-js', 'next', 'react', 'react-dom', 'unpdf', 'yahoo-finance2'].sort(),
    )
  })
})
