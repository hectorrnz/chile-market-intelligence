// R1 — Auth shell and login (normalized Stage 5R program, phase R1).
//
// Source-scan tests following this repo's established convention (no
// React-rendering harness exists; see tests/fableR0Primitives.test.ts).
// Covers: the shell-suppression gate (ShellGate), the (auth) route group,
// the AuthShell layer stack and utility cluster, the AuthPanel anatomy, the
// migrated /login page's COMPLETE functional contract (endpoints, payloads,
// error mapping, next guard, loading/disabled semantics, field attributes),
// the locked exclusions (passkey / demo credentials / remember-device /
// show-hide password / simulated auth / signed-in auto-redirect), i18n
// coverage in both languages, token hygiene, and R2 non-regression
// (/forgot-password and /auth/reset-password unchanged).

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Strip block + line comments so negative assertions test code, not prose. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\/.*$/gm, '{')

const LAYOUT = read('src/app/layout.tsx')
const SHELL_GATE = read('src/components/layout/ShellGate.tsx')
const AUTH_LAYOUT = read('src/app/(auth)/layout.tsx')
const LOGIN = read('src/app/(auth)/login/page.tsx')
const AUTH_SHELL = read('src/components/fable/AuthShell.tsx')
const AUTH_PANEL = read('src/components/fable/AuthPanel.tsx')
const CSS = read('src/app/globals.css')
const I18N = read('src/lib/i18n.ts')
const FORGOT = read('src/app/forgot-password/page.tsx')
const RESET = read('src/app/auth/reset-password/page.tsx')

const LOGIN_CODE = strip(LOGIN)
const SHELL_CODE = strip(AUTH_SHELL)
const PANEL_CODE = strip(AUTH_PANEL)
const GATE_CODE = strip(SHELL_GATE)

// ─── 1 · Shell architecture — the gate, the group, the layout ────────────────

describe('R1 shell architecture', () => {
  test('root layout mounts ShellGate (metadata contract intact)', () => {
    assert.match(LAYOUT, /<ShellGate>\{children\}<\/ShellGate>/)
    assert.doesNotMatch(strip(LAYOUT), /<AppShell>/)
    assert.match(LAYOUT, /robots: \{ index: false, follow: false \}/)
    assert.match(LAYOUT, /template: '%s · NMI'/)
  })

  test('ShellGate suppresses chrome for exactly /login in R1 — forgot/reset stay in the app shell until R2', () => {
    const m = SHELL_GATE.match(/new Set\(\[([^\]]*)\]\)/)
    assert.ok(m, 'ShellGate must declare its bare-route set')
    const routes = m![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
    assert.deepEqual(routes, ['/login'])
  })

  test('ShellGate renders the unchanged AppShell for every other route', () => {
    assert.match(SHELL_GATE, /<AppShell>\{children\}<\/AppShell>/)
    assert.match(SHELL_GATE, /usePathname/)
  })

  test('(auth) layout provides LangProvider around AuthShell — the group renders outside AppShell with its own context', () => {
    assert.match(AUTH_LAYOUT, /<LangProvider>\s*<AuthShell>\{children\}<\/AuthShell>\s*<\/LangProvider>/)
    // No app-chrome or data providers — an auth gateway fetches nothing.
    assert.doesNotMatch(strip(AUTH_LAYOUT), /MarketDataProvider|MacroDataProvider|TopBar|CommandPalette|AppShell/)
  })

  test('/login lives in the (auth) group; the old page location is gone', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/(auth)/login/page.tsx')))
    assert.ok(!existsSync(join(ROOT, 'src/app/login/page.tsx')), 'old login page must be removed (same URL now served by the group)')
  })

  test('R2 non-regression: /forgot-password and /auth/reset-password are untouched in R1', () => {
    // Still at their original locations, still wired to their real endpoints,
    // still on the pre-Fable presentation (BrandLogo card), not the auth shell.
    assert.ok(existsSync(join(ROOT, 'src/app/forgot-password/page.tsx')))
    assert.ok(existsSync(join(ROOT, 'src/app/auth/reset-password/page.tsx')))
    assert.match(FORGOT, /\/api\/auth\/forgot-password/)
    assert.match(RESET, /\/api\/auth\/reset-password/)
    assert.match(FORGOT, /BrandLogo/)
    assert.match(RESET, /BrandLogo/)
    assert.doesNotMatch(FORGOT, /AuthShell|AuthPanel/)
    assert.doesNotMatch(RESET, /AuthShell|AuthPanel/)
  })
})

// ─── 2 · AuthShell — layer stack, utility cluster, notice ────────────────────

describe('R1 AuthShell layer stack and anatomy', () => {
  test('layers render photo → light-wash veil → navy-vignette veil → content, in DOM order', () => {
    const photo = AUTH_SHELL.indexOf('/login-santiago.webp')
    const wash = AUTH_SHELL.indexOf('--nv-auth-veil-wash')
    const vignette = AUTH_SHELL.indexOf('--nv-auth-veil-vignette')
    const content = AUTH_SHELL.indexOf('z-[1]')
    assert.ok(photo > -1 && wash > -1 && vignette > -1 && content > -1)
    assert.ok(photo < wash && wash < vignette && vignette < content, 'layer stack order must match the Fable §0 composition')
  })

  test('photograph is decorative, Fable-composed, and STATIC — no Ken-Burns drift (R1 perf repair)', () => {
    assert.match(AUTH_SHELL, /alt=""/)
    assert.match(AUTH_SHELL, /objectPosition: '58% 30%'/)
    // A continuously transformed full-screen image beneath five
    // backdrop-filter surfaces invalidates every cached blur each frame.
    assert.doesNotMatch(SHELL_CODE, /nv-ken/, 'the login photograph must not carry a continuous drift animation')
    // Decode kept off the critical path so it cannot stall the entrance.
    assert.match(AUTH_SHELL, /decoding="async"/)
    assert.match(AUTH_SHELL, /fetchPriority="high"/)
    // Never a raw animation declaration — reduced motion must catch it globally.
    assert.doesNotMatch(SHELL_CODE, /animation:\s*['"`]/)
  })

  test('both veils are aria-hidden token consumers', () => {
    const veils = [...AUTH_SHELL.matchAll(/aria-hidden="true"[^>]*className="absolute inset-0"[^>]*\/>/g)]
    assert.ok(veils.length >= 2, 'two full-bleed veil layers expected')
    assert.match(AUTH_SHELL, /background: 'var\(--nv-auth-veil-wash\)'/)
    assert.match(AUTH_SHELL, /background: 'var\(--nv-auth-veil-vignette\)'/)
  })

  test('brand is the FULL NevadaMark lockup at the Fable clamp width — not the symbol crop, not BrandLogo', () => {
    assert.match(AUTH_SHELL, /<NevadaMark variant="lockup"/)
    assert.match(AUTH_SHELL, /clamp\(98px,9vw,132px\)/)
    assert.doesNotMatch(SHELL_CODE, /variant="symbol"|BrandLogo/)
  })

  test('utility cluster: secure chip (pulsing dot) · LangToggle · Santiago clock · ThemeToggle', () => {
    const secure = AUTH_SHELL.indexOf('t.auth.secureConnection')
    const lang = AUTH_SHELL.indexOf('<LangToggle />')
    const clock = AUTH_SHELL.indexOf('t.auth.santiago')
    const theme = AUTH_SHELL.indexOf('<ThemeToggle />')
    assert.ok(secure > -1 && lang > -1 && clock > -1 && theme > -1)
    assert.ok(secure < lang && lang < clock && clock < theme, 'Fable §0 chip order: secure · EN|ES · clock · theme')
    assert.match(AUTH_SHELL, /var\(--nv-auth-secure\)/)
    // The dot is static: the gateway becomes visually still after entrance
    // (R1 perf repair). Meaning never rested on the pulse — the chip is
    // labelled, so nothing is conveyed by motion alone.
    assert.doesNotMatch(SHELL_CODE, /nv-pulse/, 'no ambient pulse loop may remain on the gateway')
  })

  test('LangToggle and ThemeToggle are the EXISTING components, re-skinned only via token rescoping', () => {
    assert.match(AUTH_SHELL, /from '@\/components\/ui\/LangToggle'/)
    assert.match(AUTH_SHELL, /from '@\/components\/ui\/ThemeToggle'/)
    assert.doesNotMatch(SHELL_CODE, /function (LangToggle|ThemeToggle)|localStorage/)
    // The remap sets theme-varying chip tokens to fixed auth tokens — every
    // override value must itself be a var() reference, never a literal color.
    const remap = AUTH_SHELL.match(/const CHIP_REMAP = \{([\s\S]*?)\} as CSSProperties/)
    assert.ok(remap, 'CHIP_REMAP must exist')
    for (const line of remap![1].split('\n').map((l) => l.trim()).filter(Boolean)) {
      assert.match(line, /^'--[a-z-]+': 'var\(--nv-[a-z-]+\)',?$/, `non-token remap value: ${line}`)
    }
  })

  test('clock is minute-resolution, America/Santiago, hydration-safe', () => {
    assert.match(AUTH_SHELL, /timeZone: 'America\/Santiago'/)
    assert.match(AUTH_SHELL, /suppressHydrationWarning/)
    assert.match(AUTH_SHELL, /setInterval/)
    assert.match(AUTH_SHELL, /clearInterval/)
  })

  test('confidentiality notice renders from i18n with the on-photo treatment; no prototype line', () => {
    assert.match(AUTH_SHELL, /t\.auth\.confidentialityNotice/)
    assert.match(AUTH_SHELL, /var\(--nv-auth-onphoto\)/)
    assert.match(AUTH_SHELL, /var\(--nv-auth-onphoto-shadow\)/)
    assert.doesNotMatch(SHELL_CODE, /[Pp]rototype|sample data/)
  })

  test('shell responsive grammar: wrapping rows and clamp() spacing, no fixed page width', () => {
    assert.match(AUTH_SHELL, /flex items-start justify-between gap-4 flex-wrap/)
    assert.match(AUTH_SHELL, /flex-1 flex items-center justify-between flex-wrap/)
    assert.match(AUTH_SHELL, /clamp\(18px, 3\.2vw, 46px\) clamp\(18px, 3\.6vw, 54px\)/)
    assert.match(AUTH_SHELL, /gap: 'clamp\(28px, 5vw, 72px\)'/)
    assert.doesNotMatch(SHELL_CODE, /min-w-\[1|minWidth: '?\d{4}/)
  })

  test('shell is presentational: no fetch, no API path, no supabase, no auth logic', () => {
    assert.doesNotMatch(SHELL_CODE, /fetch\(|\/api\/|supabase|useAuth|middleware/i)
  })

  test('shell and panel are token-only (no hex colors, no raw Tailwind color scales)', () => {
    for (const [name, src] of [['AuthShell', SHELL_CODE], ['AuthPanel', PANEL_CODE]] as const) {
      assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${name} must not hardcode a hex color`)
      assert.doesNotMatch(
        src,
        /\b(bg|text|border)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
        `${name} must not use a raw color scale`,
      )
    }
  })
})

// ─── 3 · AuthPanel — Tier-1 glass anatomy ────────────────────────────────────

describe('R1 AuthPanel', () => {
  test('surface is the Tier-1 auth glass, not the card tier', () => {
    assert.match(AUTH_PANEL, /nv-glass-auth relative overflow-hidden/)
    assert.doesNotMatch(PANEL_CODE, /nv-glass-card|nv-glass-overlay/)
  })

  test('anatomy order: specular sheen → hairline → eyebrow → h2 title → children', () => {
    // Scan comment-stripped source — the component's own doc comment narrates
    // this anatomy and would otherwise match the markers first.
    const spec = PANEL_CODE.indexOf('--nv-auth-specular')
    const hairline = PANEL_CODE.indexOf('--nv-auth-hairline')
    const eyebrow = PANEL_CODE.indexOf('ui-label')
    const title = PANEL_CODE.indexOf('<h2')
    const children = PANEL_CODE.indexOf('{children}')
    assert.ok(spec > -1 && hairline > -1 && eyebrow > -1 && title > -1 && children > -1)
    assert.ok(spec < hairline && hairline < eyebrow && eyebrow < title && title < children)
  })

  test('specular and hairline are decorative and non-interactive', () => {
    const overlays = [...AUTH_PANEL.matchAll(/aria-hidden="true"/g)]
    assert.ok(overlays.length >= 2)
    assert.equal((AUTH_PANEL.match(/pointer-events-none/g) ?? []).length, 2)
  })

  test('the panel is stateless and pointer-free — nothing can re-render the form the user is typing into (R1 perf repair)', () => {
    // The specular originally tracked the cursor by setting React state on
    // every mousemove, re-rendering the whole panel subtree (the entire form)
    // per pointer event and repainting a large radial gradient over a
    // backdrop-filtered surface. It is now a fixed sheen.
    assert.doesNotMatch(PANEL_CODE, /useState|useRef|useEffect/, 'AuthPanel must hold no state')
    assert.doesNotMatch(PANEL_CODE, /on(Mouse|Pointer)(Move|Enter|Over|Leave)/, 'no pointer handler may remain')
    assert.doesNotMatch(PANEL_CODE, /--glx|--gly|setSpec|requestAnimationFrame/)
    assert.doesNotMatch(PANEL_CODE, /animation|setInterval|setTimeout|will-change|willChange/)
    // A stateless presentational component needs no client boundary at all.
    assert.doesNotMatch(PANEL_CODE, /'use client'/)
    // The sheen itself survives — the glass must still read as glass.
    assert.match(AUTH_PANEL, /background: 'var\(--nv-auth-specular\)'/)
    assert.match(CSS, /--nv-auth-specular: radial-gradient\(520px 260px at 50% 0%/)
  })

  test('no pointer-driven CSS custom property is written anywhere on the gateway', () => {
    for (const [name, src] of [['AuthShell', SHELL_CODE], ['AuthPanel', PANEL_CODE], ['login', LOGIN_CODE]] as const) {
      assert.doesNotMatch(src, /style\.setProperty|clientX|clientY|getBoundingClientRect/, `${name} must not track the pointer`)
    }
  })

  test('typography: ui-label eyebrow (tracking-capped) + tokenized 23px title on auth ink', () => {
    assert.match(AUTH_PANEL, /className="ui-label" style=\{\{ color: 'var\(--nv-auth-eyebrow\)' \}\}/)
    assert.match(AUTH_PANEL, /var\(--fs-chart-headline\)/)
    assert.match(AUTH_PANEL, /var\(--nv-auth-ink\)/)
    assert.doesNotMatch(PANEL_CODE, /letterSpacing: '\.(1[5-9]|[2-9])/)
  })
})

// ─── 4 · /login — the complete preserved functional contract ─────────────────

describe('R1 login functional contract (Phase 6B preserved verbatim)', () => {
  test('page composes the shell slots: headline block + AuthPanel with Fable flex grammar', () => {
    assert.match(LOGIN, /from '@\/components\/fable\/AuthPanel'/)
    assert.match(LOGIN, /flex: '1\.1 1 340px', maxWidth: 640/)
    assert.match(LOGIN, /flex: '0 1 402px', minWidth: 'min\(100%, 330px\)'/)
    const headline = LOGIN.indexOf('t.auth.headline1')
    const panel = LOGIN.indexOf('<AuthPanel')
    assert.ok(headline > -1 && panel > -1 && headline < panel, 'headline block precedes the panel')
  })

  test('headline is the h1; panel title is the existing NMI sign-in title', () => {
    assert.match(LOGIN, /<h1[\s\S]*?\{t\.auth\.headline1\}[\s\S]*?\{t\.auth\.headline2\}[\s\S]*?<\/h1>/)
    // R1.5 removed public self-registration, so there is no mode to switch on.
    assert.match(LOGIN, /title=\{t\.auth\.signInTitle\}/)
    assert.doesNotMatch(LOGIN, /createAccountTitle/)
    assert.match(LOGIN, /var\(--fs-login-headline\)/)
  })

  test('submission handler is connected and posts to the sign-in endpoint with the exact payload', () => {
    assert.match(LOGIN, /<form onSubmit=\{handleSubmit\}/)
    // R1.5: one endpoint, one payload — the registration branch is gone with
    // the endpoint. See docs/security_access_control.md.
    assert.match(LOGIN, /fetch\('\/api\/auth\/login', \{/)
    assert.match(LOGIN, /\{ username: username\.trim\(\), password \}/)
    assert.doesNotMatch(LOGIN, /displayName: username\.trim\(\)/)
    assert.match(LOGIN, /method: 'POST'/)
    assert.match(LOGIN, /'Content-Type': 'application\/json'/)
  })

  test('callback/redirect behavior: ?error banner, shared safe-redirect guard, full navigation', () => {
    assert.match(LOGIN, /searchParams\.get\('error'\)/)
    assert.match(LOGIN, /searchParams\.get\('next'\) \?\? '\/'/)
    assert.match(LOGIN, /callbackError \? callbackErrorToMessage\(t, callbackError\) : null/)
    // R1.5 replaced the `startsWith('/')` guard, which accepted `//evil.example`,
    // with the one authoritative validator shared with middleware and the
    // callback route. Redirect-safety coverage lives in accessControl.test.ts.
    assert.match(LOGIN, /const safeNext = toSafeInternalPath\(next\)/)
    assert.doesNotMatch(LOGIN, /next\.startsWith\('\/'\)/)
    assert.match(LOGIN, /window\.location\.assign\(safeNext\)/)
  })

  test('loading and disabled semantics are byte-identical; loading adds the tokenized spinner', () => {
    assert.match(LOGIN, /disabled=\{loading \|\| !username\.trim\(\) \|\| !password\}/)
    assert.match(LOGIN, /setLoading\(true\)/)
    assert.equal((LOGIN.match(/setLoading\(false\)/g) ?? []).length, 2, 'both failure paths clear loading; success navigates away')
    assert.match(LOGIN, /\{loading && \(/)
    assert.match(LOGIN, /nv-spin/)
  })

  test('error mapping covers every code /api/auth/login can return, plus the generic fallback', () => {
    // R1.5: the five create-account codes (username_taken, invalid_password,
    // invalid_username, invalid_email, invalid_display_name) are unreachable —
    // the endpoint that produced them no longer exists. /api/auth/login answers
    // only invalid_credentials; everything else falls to the generic message.
    assert.ok(LOGIN.includes("case 'invalid_credentials'"), 'missing invalid_credentials mapping')
    assert.match(LOGIN, /default:\s+return t\.auth\.errorGeneric/)
    assert.match(LOGIN, /role="alert"/)
    assert.match(LOGIN, /json\.error \?\? ''/)
    // The server-set ?error=not_authorized banner (unapproved identity).
    assert.match(LOGIN, /'not_authorized' \? t\.auth\.errNotAuthorized : t\.auth\.errorCallback/)
  })

  test('username field keeps its exact semantic attributes and receives initial focus', () => {
    const field = LOGIN.match(/<input\s+id="username"[\s\S]*?\/>/)
    assert.ok(field)
    for (const attr of ['type="text"', 'required', 'autoFocus', 'autoComplete="username"', 'autoCapitalize="none"', 'spellCheck={false}']) {
      assert.ok(field![0].includes(attr), `username input missing ${attr}`)
    }
    assert.match(LOGIN, /htmlFor="username"/)
  })

  test('the recovery-email registration field is GONE — the form collects no email', () => {
    // R1.5: this field only ever existed to self-register. Its removal is the
    // point, so the R1 assertion is inverted rather than deleted.
    assert.doesNotMatch(LOGIN, /id="email"/)
    assert.doesNotMatch(LOGIN, /t\.auth\.email(Label|Placeholder|Hint)/)
    // The two username/password fields are the entire form.
    assert.deepEqual([...LOGIN.matchAll(/<input\s+id="([a-z]+)"/g)].map((m) => m[1]), ['username', 'password'])
  })

  test('password field is a plain current-password input with no create-mode hint', () => {
    const field = LOGIN.match(/<input\s+id="password"[\s\S]*?\/>/)
    assert.ok(field)
    assert.ok(field![0].includes('type="password"'), 'password input must keep a literal type')
    assert.ok(field![0].includes(`autoComplete="current-password"`), 'sign-in only, so no new-password branch')
    assert.match(LOGIN, /htmlFor="password"/)
    assert.doesNotMatch(LOGIN, /t\.auth\.passwordHint/)
  })

  test('forgot-password link keeps its destination, now unconditionally', () => {
    assert.match(LOGIN, /href="\/forgot-password"[\s\S]*?t\.auth\.forgotPassword/)
    assert.doesNotMatch(LOGIN, /!isCreate/)
  })

  test('the mode toggle is replaced by administrator-provisioned wording; back link preserved', () => {
    assert.doesNotMatch(LOGIN, /setMode|\bisCreate\b/)
    assert.doesNotMatch(LOGIN, /t\.auth\.(needAccount|submitCreate|createAccountSubtitle)/)
    assert.match(LOGIN, /t\.auth\.adminProvisioned/)
    assert.match(LOGIN, /href="\/"[\s\S]*?t\.auth\.backToHome/)
  })

  test('useSearchParams stays inside a Suspense boundary', () => {
    assert.match(LOGIN, /<Suspense>\s*<LoginForm \/>\s*<\/Suspense>/)
  })

  test('keyboard submission preserved: a real <form> with a type="submit" button', () => {
    assert.match(LOGIN, /<form onSubmit/)
    assert.match(LOGIN, /type="submit"/)
  })
})

// ─── 5 · Locked exclusions — nothing from Fable's mock auth enters ───────────

describe('R1 locked exclusions (normalized decision register)', () => {
  const ALL_NEW = LOGIN_CODE + SHELL_CODE + PANEL_CODE + strip(AUTH_LAYOUT) + GATE_CODE

  test('no passkey, no demo credentials, no remember-device, no sample identity, no simulated auth', () => {
    assert.doesNotMatch(ALL_NEW, /passkey|fillDemo|demo|remember|role="switch"|aria-checked|startSignedIn|María Undurraga|name@inversionesnevada/i)
  })

  test('no show/hide-password control (not currently supported; no Class C approval on this route)', () => {
    assert.doesNotMatch(ALL_NEW, /showPass|pwType|type=\{[^}]*password[^}]*\}|aria-pressed=\{show/i)
  })

  test('no signed-in auto-redirect added (not currently present)', () => {
    assert.doesNotMatch(LOGIN_CODE, /useAuthDisplay|getCurrentUser|router\.(replace|push)|useEffect/)
  })

  test('no second auth system: the new surfaces never import a supabase client or reference credentials', () => {
    assert.doesNotMatch(ALL_NEW, /supabase|service_role|SUPABASE|createClient|signInWith/i)
    assert.doesNotMatch(ALL_NEW, /localStorage\.(get|set)Item\(['"](?!lang|theme)/)
  })

  test('the only network call on the page is the sign-in endpoint', () => {
    // R1.5 removed public self-registration, so /api/auth/register is no longer
    // reachable from here (the endpoint no longer exists at all). Deliberate
    // narrowing of the R1 assertion — see docs/security_access_control.md.
    const calls = [...LOGIN_CODE.matchAll(/\/api\/[a-z/-]*/g)].map((m) => m[0])
    assert.deepEqual([...new Set(calls)].sort(), ['/api/auth/login'])
    assert.doesNotMatch(SHELL_CODE + PANEL_CODE, /\/api\//)
  })

  test('no hardcoded visible copy — headline/notice/chips all flow through t.auth.*', () => {
    assert.doesNotMatch(ALL_NEW, /Private Capital|Disciplined Stewardship|Authorized users only|Secure connection|PRIVATE ACCESS/i)
    for (const key of ['brandEyebrow', 'headline1', 'headline2', 'headlineSub', 'headlineNote', 'privateAccess', 'secureConnection', 'sessionProtected', 'confidentialityNotice', 'santiago']) {
      assert.ok(LOGIN.includes(`t.auth.${key}`) || AUTH_SHELL.includes(`t.auth.${key}`), `t.auth.${key} unused`)
    }
  })
})

// ─── 6 · Tokens, i18n, motion ────────────────────────────────────────────────

describe('R1 tokens, i18n, and motion', () => {
  test('every new auth token is declared in :root and none is redefined under .dark (theme-independent)', () => {
    const darkBlock = CSS.match(/\n\.dark \{[\s\S]*?\n\}/)![0]
    for (const tok of [
      '--nv-auth-bg', '--nv-auth-veil-wash', '--nv-auth-veil-vignette', '--nv-auth-ink', '--nv-auth-ink-2',
      '--nv-auth-ink-3', '--nv-auth-eyebrow', '--nv-auth-link', '--nv-auth-secure', '--nv-auth-input-bg',
      '--nv-auth-input-bd', '--nv-auth-input-fg', '--nv-auth-focus-ring', '--nv-auth-err-bg', '--nv-auth-err-bd',
      '--nv-auth-err-fg', '--nv-auth-onphoto', '--nv-auth-onphoto-shadow', '--nv-auth-chip-active',
      '--nv-auth-chip-ink', '--nv-auth-chip-muted', '--nv-auth-chip-hover', '--nv-auth-hairline', '--nv-auth-specular',
    ]) {
      assert.match(CSS, new RegExp(`  ${tok}:`), `${tok} must be declared`)
      assert.ok(!darkBlock.includes(`${tok}:`), `${tok} must not vary by theme (login is theme-independent)`)
    }
  })

  test('.nv-auth-input class: token-only field recipe with a visible replacement focus treatment', () => {
    const rule = CSS.match(/\.nv-auth-input \{[\s\S]*?\}/)![0]
    assert.match(rule, /border-radius: var\(--radius-input\)/)
    assert.match(rule, /background: var\(--nv-auth-input-bg\)/)
    assert.match(rule, /transition-duration: var\(--dur-hover\)/)
    const focus = CSS.match(/\.nv-auth-input:focus,[\s\S]*?\}/)![0]
    assert.match(focus, /border-color: var\(--nv-auth-link\)/)
    assert.match(focus, /box-shadow: 0 0 0 3px var\(--nv-auth-focus-ring\)/)
    assert.match(CSS, /\.nv-auth-input::placeholder \{ color: var\(--nv-auth-ink-3\); \}/)
  })

  test('chip-glass blur utility lives inside the @supports guard with tokenized radii', () => {
    const supports = CSS.match(/@supports \(\(backdrop-filter[\s\S]*?\n\}/)![0]
    assert.match(supports, /\.nv-auth-chip-glass \{[\s\S]*?blur\(var\(--nv-blur-chip\)\) saturate\(var\(--nv-sat-chip\)\)/)
  })

  test('every new i18n key exists in BOTH dict.en and dict.es', () => {
    const authBlocks = [...I18N.matchAll(/\n    auth: \{([\s\S]*?)\n    \},/g)]
    assert.equal(authBlocks.length, 2, 'expected exactly one auth block per language')
    for (const key of ['privateAccess', 'brandEyebrow', 'headline1', 'headline2', 'headlineSub', 'headlineNote', 'secureConnection', 'santiago', 'sessionProtected', 'confidentialityNotice']) {
      for (const [i, block] of authBlocks.entries()) {
        assert.ok(block[1].includes(`${key}:`), `auth.${key} missing from ${i === 0 ? 'dict.en' : 'dict.es'}`)
      }
    }
    // The ES copy is genuinely translated, not the EN strings duplicated.
    assert.ok(authBlocks[1][1].includes('Capital Privado.'))
    assert.ok(authBlocks[1][1].includes('Conexión segura'))
    assert.ok(authBlocks[1][1].includes('Solo usuarios autorizados'))
  })

  test('the gateway entrance uses the auth-scoped utilities, never the blur-animating .nv-reveal', () => {
    for (const [name, src] of [['AuthShell', SHELL_CODE], ['login', LOGIN_CODE]] as const) {
      assert.match(src, /nv-auth-(reveal|fade)/, `${name} must use the auth entrance utilities`)
      // `.nv-reveal`'s nvIn keyframe animates filter: blur(8px) — forbidden here.
      assert.doesNotMatch(src, /\bnv-reveal\b(?!-)/, `${name} must not use the blur-animating section reveal`)
    }
    assert.match(LOGIN, /nv-pop/) // error banner: opacity + transform only
    // Stagger via the custom property, never a literal animation-delay style.
    assert.match(AUTH_SHELL, /'--nv-auth-delay'/)
    assert.doesNotMatch(SHELL_CODE + LOGIN_CODE, /animationDelay|animation-delay/)
  })

  test('entrance keyframes animate ONLY opacity and transform — no filter, blur, shadow, or layout property', () => {
    const FORBIDDEN = /filter|blur|backdrop|box-shadow|background|width|height|\btop\b|\bleft\b|\bright\b|\bbottom\b|margin|padding|border/
    for (const name of ['nvAuthIn', 'nvAuthFade', 'nvPop']) {
      const kf = CSS.match(new RegExp(`@keyframes ${name}\\s*\\{[\\s\\S]*?\\n?[^\\n]*\\}\\s*$`, 'm'))
      assert.ok(kf, `@keyframes ${name} must exist`)
      const body = kf![0].replace(new RegExp(`@keyframes ${name}`), '')
      assert.doesNotMatch(body, FORBIDDEN, `@keyframes ${name} must not animate an expensive property`)
      assert.match(body, /opacity|transform/)
    }
    // The compositor-friendly offset is a 3D translate, and its distance
    // matches nvIn's rise so the gateway shares the app pages' signature.
    assert.match(CSS, /@keyframes nvAuthIn\s+\{ from \{ opacity: 0; transform: translate3d\(0, 22px, 0\) \}/)
    assert.match(CSS, /@keyframes nvAuthFade \{ from \{ opacity: 0 \} to \{ opacity: 1 \} \}/)
    assert.match(CSS, /@keyframes nvIn\s+\{ from \{[^}]*translateY\(22px\)/, 'nvIn sets the shared 22px rise')
  })

  test('the gateway settles at EXACTLY the pace of every app page — same duration, easing and stagger tokens as .nv-reveal', () => {
    // The reported defect: at --dur-pop (220ms) the login snapped in well ahead
    // of Markets/Macro/etc, which reveal over --dur-reveal (640ms). The auth
    // utilities now share that timing; only nvIn's expensive blur is omitted.
    const sectionReveal = CSS.match(/\.nv-reveal \{[\s\S]*?\}/)![0]
    const duration = sectionReveal.match(/animation: nvIn (var\(--[a-z-]+\)) (var\(--[a-z-]+\))/)
    assert.ok(duration, '.nv-reveal must declare its duration and easing as tokens')
    const [, durToken, easeToken] = duration!

    for (const cls of ['nv-auth-reveal', 'nv-auth-fade']) {
      const rule = CSS.match(new RegExp(`\\.${cls} \\{[\\s\\S]*?\\}`))
      assert.ok(rule, `.${cls} must exist`)
      assert.ok(rule![0].includes(durToken), `.${cls} must run at ${durToken}, the same duration app pages use`)
      assert.ok(rule![0].includes(easeToken), `.${cls} must use ${easeToken}, the same easing app pages use`)
      assert.match(rule![0], /animation-delay: var\(--nv-auth-delay, 0ms\)/)
      // Guard the specific regression: never the short overlay-pop duration.
      assert.doesNotMatch(rule![0], /--dur-pop/, `.${cls} must not snap in at the overlay-pop duration`)
    }
    assert.equal(durToken, 'var(--dur-reveal)')
    assert.match(CSS, /--dur-reveal:\s*640ms/)
  })

  test('stagger tiers are whole --stagger-reveal steps, and the headline leads with no delay', () => {
    const delays = [...(AUTH_SHELL + LOGIN).matchAll(/'--nv-auth-delay': '([^']+)'/g)].map((m) => m[1])
    assert.ok(delays.length > 0)
    for (const d of delays) {
      assert.match(
        d,
        /^(var\(--stagger-reveal\)|calc\(var\(--stagger-reveal\) \* \d\))$/,
        `stagger must be a tokenized --stagger-reveal step, got: ${d}`,
      )
    }
    assert.match(CSS, /--stagger-reveal:\s*70ms/)
    // The headline block carries NO delay — it leads the cascade.
    assert.match(LOGIN, /className="nv-auth-reveal"\s*\n\s*style=\{\{ flex: '1\.1 1 340px', maxWidth: 640 \}/)
  })

  test('.nv-auth-fade is used for the backdrop-filtered surfaces, .nv-auth-reveal for the rest', () => {
    // Translating a blurred surface re-samples its backdrop every frame.
    const chipCluster = AUTH_SHELL.match(/className="flex items-center gap-2 flex-wrap ([^"]+)"/)
    assert.ok(chipCluster)
    assert.equal(chipCluster![1], 'nv-auth-fade', 'the glass utility-chip cluster must fade, not translate')
    const panelCol = LOGIN.match(/className="(nv-auth-[a-z]+)"\s*\n\s*style=\{\{ flex: '0 1 402px'/)
    assert.ok(panelCol)
    assert.equal(panelCol![1], 'nv-auth-fade', 'the glass panel column must fade, not translate')
  })

  test('reduced motion removes every entrance, drift, pulse and pointer effect — content renders immediately', () => {
    const reduced = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)![0]
    // Universal collapse still first.
    assert.match(reduced, /animation-duration: \.01ms !important/)
    assert.match(reduced, /transition-duration: \.01ms !important/)
    // The auth entrance renders at its FINAL state, never a hidden start frame.
    const finalState = reduced.match(/\.nv-reveal, \.nv-pop, \.nv-slide-in[^{]*\{[\s\S]*?\}/)![0]
    assert.match(finalState, /\.nv-auth-reveal/)
    assert.match(finalState, /\.nv-auth-fade/)
    assert.match(finalState, /opacity: 1 !important/)
    assert.match(finalState, /transform: none !important/)
    // Loops stay disabled (the gateway ships none, but the guard must remain).
    assert.match(reduced, /\.nv-ken, \.nv-pulse, \.nv-spin \{[\s\S]*?animation: none !important/)
  })

  test('loading remains understandable without spinner rotation — the label is never replaced by the spinner', () => {
    // Under reduced motion `.nv-spin` stops; the button must still say what it
    // is doing and stay disabled, so the label renders unconditionally.
    assert.match(LOGIN, /\{loading && \([\s\S]*?nv-spin[\s\S]*?\)\}\s*\n\s*\{t\.auth\.submitSignIn\}/)
    assert.match(LOGIN, /disabled=\{loading \|\| !username\.trim\(\) \|\| !password\}/)
  })

  test('no expensive property is transitioned on the gateway outside the input focus indicator', () => {
    // The one permitted exception is `.nv-auth-input`'s focus treatment, which
    // REPLACES the global ring (border-color + a 3px halo) and only fires on
    // focus — it is the visible focus indicator, not entrance choreography.
    for (const [name, src] of [['AuthShell', SHELL_CODE], ['AuthPanel', PANEL_CODE], ['login', LOGIN_CODE]] as const) {
      assert.doesNotMatch(src, /transition(Property|Duration)?:\s*['"`]/, `${name} must not hand-roll a transition`)
      assert.doesNotMatch(src, /backdropFilter|filter:\s*['"`]?blur/, `${name} must not animate or inline a filter`)
    }
  })

  test('the login photograph is the only full-screen layer and it carries no animation at all', () => {
    const img = AUTH_SHELL.match(/<img[\s\S]*?\/>/)![0]
    assert.doesNotMatch(img, /nv-ken|nv-auth-reveal|nv-auth-fade|nv-pulse|animation/)
    assert.match(img, /className="absolute inset-0 w-full h-full"/)
  })

  test('the login photograph asset ships in public/', () => {
    assert.ok(existsSync(join(ROOT, 'public/login-santiago.webp')))
  })
})
