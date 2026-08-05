// R11 — repository-wide visual/interaction consistency sweep.
//
// Each block below locks an ENDURING product contract that an R11 audit found
// violated on exactly one surface while every sibling surface already honoured
// it. These are not stylistic preferences: every one is either a data-honesty
// rule, a privacy rule, or an accessibility rule this repo has written down.
//
// Source-scan style, matching the repo's existing convention for contracts that
// cannot be exercised without a DOM.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dict } from '../src/lib/i18n.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const HOME = read('src/app/page.tsx')
const COMPANY = read('src/app/companies/[ticker]/page.tsx')
const PORTFOLIO = read('src/app/portfolio/page.tsx')
const EARNINGS = read('src/app/earnings/page.tsx')
const SN_LIST = read('src/app/structured-notes/page.tsx')
const SN_DETAIL = read('src/app/structured-notes/[id]/page.tsx')
const PALETTE = read('src/components/ui/CommandPalette.tsx')
const LANG_TOGGLE = read('src/components/ui/LangToggle.tsx')
const MKT_BADGE = read('src/components/ui/MarketDataSourceBadge.tsx')

// ── Privacy ─────────────────────────────────────────────────────────────────

describe('R11 · the Nevada notional is masked on its own pages, not only on Home', () => {
  // The six masked amounts are documented in Home's header comment and in the
  // Portfolio page. The Structured Notes total notional is one of them, but
  // Privacy Mode had never been wired into either Structured Notes page — so
  // the canonical surface for that figure (plus a per-note breakdown Home does
  // not even show) rendered it in the clear while Home masked it.
  test('both Structured Notes pages consume the ONE shared privacy store', () => {
    for (const [name, src] of [['list', SN_LIST], ['detail', SN_DETAIL]] as const) {
      assert.match(src, /import \{ usePrivacyMode \} from '@\/components\/fable\/usePrivacyMode'/, name)
      assert.match(src, /const \[masked\] = usePrivacyMode\(\)/, name)
    }
    // Never a second privacy state or storage key.
    for (const src of [SN_LIST, SN_DETAIL]) assert.doesNotMatch(src, /cmi\.privacyMode|localStorage/)
  })

  test('every notional render routes through the shared PrivacyValue boundary', () => {
    // Book total (list), per-note column (list), and the detail capsule.
    // R12: the per-note cell renders '—' when its metric is missing (never a
    // fabricated "USD 0") — the amount expression moved inside a template
    // literal, still inside the same PrivacyValue boundary.
    assert.match(SN_LIST, /label=\{t\.sn\.dashNotional\}[^\n]*masked=\{masked\}/)
    assert.match(SN_LIST, /<PrivacyValue masked=\{masked\} className="block">/)
    assert.match(SN_LIST, /\{m \? `\$\{n\.currency\} \$\{fmtNum\(m\.currentNotional\)\}` : '—'\}/)
    assert.match(SN_DETAIL, /label=\{t\.sn\.colNotional\}[^\n]*masked=\{masked\}/)
    assert.match(SN_LIST, /import \{ PrivacyValue \}/)
  })

  test('no raw notional survives in a title/aria attribute while masked', () => {
    // The per-note cell used to duplicate the amount into a `title=` tooltip,
    // which would have leaked the value straight past the mask.
    assert.doesNotMatch(SN_LIST, /title=\{`\$\{n\.currency\} \$\{fmtNum\(m\?\.currentNotional/)
  })

  test('public Structured Notes data stays visible — masking is not over-applied', () => {
    for (const publicStat of ['dashLive', 'dashSafe', 'dashWatch', 'dashAutocallable', 'dashBreached']) {
      const at = SN_LIST.indexOf(`t.sn.${publicStat}`)
      assert.ok(at > -1, publicStat)
      assert.doesNotMatch(SN_LIST.slice(at, at + 160), /masked=/, `${publicStat} is a count — must stay visible`)
    }
  })
})

// ── Data honesty ────────────────────────────────────────────────────────────

describe('R11 · a source badge never claims more than the value it labels', () => {
  test('MarketDataSourceBadge no longer hardcodes a vendor into its tooltip', () => {
    assert.match(MKT_BADGE, /provider = 'Yahoo Finance'/, 'defaults preserved for every existing call site')
    assert.match(MKT_BADGE, /\$\{label\} — \$\{provider\}/)
    assert.doesNotMatch(MKT_BADGE, /\$\{label\} — Yahoo Finance/)
  })

  test('the Earnings CMF calendar badge names CMF, agreeing with its own footer', () => {
    const at = EARNINGS.indexOf('t.earnings.upcomingLabel')
    const block = EARNINGS.slice(at, at + 700)
    assert.match(block, /<MarketDataSourceBadge status=\{calLive \? 'live' : 'live-unavailable'\} provider="CMF" \/>/)
    assert.match(block, /source=\{t\.home\.earningsCalSource\}/)
  })

  test('the company badge and as-of are gated on this ticker’s own quote', () => {
    assert.match(COMPANY, /const priceStatus: DataSourceStatus = lv \?/)
    assert.match(COMPANY, /const priceAsOf = lv && live \?/)
  })
})

describe('R11 · a failed request is never rendered as empty or as a hung load', () => {
  test('Portfolio distinguishes a load failure from an empty account', () => {
    assert.match(PORTFOLIO, /const \[loadError, setLoadError\] = useState\(false\)/)
    assert.match(PORTFOLIO, /\) : loadError \? \(\s*\n\s*<AsyncState kind="error" \/>/)
    // The old swallow-and-show-empty comment must not come back.
    assert.doesNotMatch(PORTFOLIO, /leave loading state, show empty/)
    // "No portfolio yet" is a REAL empty and stays non-error.
    assert.match(PORTFOLIO, /`!pf` stays non-error/)
  })

  test('Company results and valuation reach an error state instead of loading forever', () => {
    assert.match(COMPANY, /const \[valuationFailed, setValuationFailed\] = useState\(false\)/)
    assert.match(COMPANY, /const \[resultsFailed, setResultsFailed\] = useState\(false\)/)
    assert.match(COMPANY, /kind=\{resultsFailed \? 'error' :/)
    assert.match(COMPANY, /\{valuationFailed \? \(\s*\n\s*<AsyncState kind="error" \/>/)
    // No bare swallow remains on either fetch.
    assert.doesNotMatch(COMPANY, /fetchValuation\(sym\)\.then\([^)]*\)\.catch\(\(\) => \{\}\)/)
  })
})

// ── Accessibility ───────────────────────────────────────────────────────────

describe('R11 · the shared focus ring is never removed', () => {
  test('the command palette input no longer suppresses :focus-visible', () => {
    assert.doesNotMatch(PALETTE, /focus-visible:outline-none/)
    assert.doesNotMatch(PALETTE, /outline: 'none'/)
    assert.doesNotMatch(PALETTE, /boxShadow: 'none'/)
  })

  test('the global ring the palette now inherits still exists', () => {
    const css = read('src/app/globals.css')
    assert.match(css, /:focus-visible \{\s*\n\s*outline: 2px solid var\(--focus\);/)
  })
})

describe('R11 · both header toggles name each of their options', () => {
  test('LangToggle options carry an accessible name, like ThemeToggle', () => {
    assert.match(LANG_TOGGLE, /aria-label=\{name\}/)
    assert.match(LANG_TOGGLE, /title=\{name\}/)
    assert.match(LANG_TOGGLE, /t\.topbar\.switchToEnglish : t\.topbar\.switchToSpanish/)
    // The group label is unchanged.
    assert.match(LANG_TOGGLE, /aria-label=\{t\.topbar\.language\}/)
  })

  test('the new names exist in both dictionaries and genuinely differ per language', () => {
    for (const k of ['switchToEnglish', 'switchToSpanish'] as const) {
      const en = (dict.en.topbar as Record<string, string>)[k]
      const es = (dict.es.topbar as Record<string, string>)[k]
      assert.ok(en && es, k)
      assert.notEqual(en, es, `${k} must be translated, not copied`)
    }
  })
})

// ── Localization ────────────────────────────────────────────────────────────

describe('R11 · no user-visible English literal survives in a repaired surface', () => {
  test('Portfolio form errors are dictionary-driven and leak no raw server string', () => {
    assert.doesNotMatch(PORTFOLIO, /msg: 'Network error'/)
    assert.doesNotMatch(PORTFOLIO, /msg: json\.error \?\? 'Error'/)
    assert.equal((PORTFOLIO.match(/msg: t\.portfolio\.networkError/g) ?? []).length, 3)
    assert.equal((PORTFOLIO.match(/msg: t\.portfolio\.addError/g) ?? []).length, 3)
  })

  test('Home’s rates tooltips are dictionary-driven', () => {
    assert.doesNotMatch(HOME, /title="Drag to reorder"/)
    assert.doesNotMatch(HOME, /title="Live"/)
    assert.match(HOME, /title=\{t\.common\.dragToReorder\}/)
    assert.match(HOME, /title=\{t\.dataSource\.live\}/)
  })

  test('every key added by R11 exists in BOTH dictionaries', () => {
    for (const k of ['addError', 'networkError'] as const) {
      assert.ok((dict.en.portfolio as Record<string, string>)[k], `en.portfolio.${k}`)
      assert.ok((dict.es.portfolio as Record<string, string>)[k], `es.portfolio.${k}`)
    }
    assert.ok((dict.en.common as Record<string, string>).dragToReorder)
    assert.ok((dict.es.common as Record<string, string>).dragToReorder)
    // Whole-dictionary parity is unbroken by the additions.
    assert.deepEqual(Object.keys(dict.en.portfolio).sort(), Object.keys(dict.es.portfolio).sort())
    assert.deepEqual(Object.keys(dict.en.common).sort(), Object.keys(dict.es.common).sort())
    assert.deepEqual(Object.keys(dict.en.topbar).sort(), Object.keys(dict.es.topbar).sort())
  })
})

// ── Surfaces ────────────────────────────────────────────────────────────────

describe('R11 · dense content sits on dense glass, and type stays on the scale', () => {
  test('the company news module uses the dense tier, like Home’s identical module', () => {
    const at = COMPANY.indexOf('t.company.recentNews')
    assert.ok(at > -1)
    assert.match(COMPANY.slice(Math.max(0, at - 400), at), /<GlassSurface variant="dense"/)
  })

  test('no rendered type drops below the smallest declared rung', () => {
    for (const [name, src] of [['company', COMPANY], ['compare', read('src/app/compare/page.tsx')]] as const) {
      assert.doesNotMatch(src, /fontSize: '9px'/, name)
      assert.doesNotMatch(src, /text-\[9px\]/, name)
    }
    assert.match(COMPANY, /ui-micro-label/)
  })
})
