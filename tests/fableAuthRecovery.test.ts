// R2 — Fable password-recovery variants (/forgot-password, /auth/reset-password).
//
// R1 migrated /login into the (auth) group and gave it the full-bleed Fable
// gateway. R2 does the same for the two recovery routes, which until now
// rendered through the application shell on a plain background — visually a
// different platform. This suite proves the three routes are now one
// authentication system, that each recovery route kept its complete functional
// contract, and that none of the R1.5 security boundary moved.
//
// Source-scan tests, following this repo's established convention (there is no
// React-rendering harness — see tests/fableR0Primitives.test.ts). Negative
// assertions run against comment-stripped source so they test code, not prose.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Strip block + line comments so negative assertions test code, not prose. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\/.*$/gm, '{')

const LOGIN_PATH  = 'src/app/(auth)/login/page.tsx'
const FORGOT_PATH = 'src/app/(auth)/forgot-password/page.tsx'
const RESET_PATH  = 'src/app/(auth)/auth/reset-password/page.tsx'

const LOGIN  = read(LOGIN_PATH)
const FORGOT = read(FORGOT_PATH)
const RESET  = read(RESET_PATH)
const AUTH_LAYOUT = read('src/app/(auth)/layout.tsx')
const AUTH_FORM   = read('src/components/fable/AuthForm.tsx')
const AUTH_SHELL  = read('src/components/fable/AuthShell.tsx')
const SHELL_GATE  = read('src/components/layout/ShellGate.tsx')
const CSS         = read('src/app/globals.css')
const I18N        = read('src/lib/i18n.ts')

const AUTH_ROUTES = [
  ['login', LOGIN],
  ['forgot-password', FORGOT],
  ['reset-password', RESET],
] as const
const RECOVERY_ROUTES = [
  ['forgot-password', FORGOT],
  ['reset-password', RESET],
] as const

// ─── 1 · One shell for all three routes ──────────────────────────────────────

describe('R2 · all three auth routes share the approved AuthShell', () => {
  test('every auth route file lives in the (auth) group, whose layout mounts AuthShell', () => {
    for (const path of [LOGIN_PATH, FORGOT_PATH, RESET_PATH]) {
      assert.ok(existsSync(join(ROOT, path)), `${path} must exist`)
    }
    assert.match(AUTH_LAYOUT, /<LangProvider>\s*<AuthShell>\{children\}<\/AuthShell>\s*<\/LangProvider>/)
  })

  test('the public URLs are unchanged — the group adds no path segment', () => {
    // A route group's parenthesised directory contributes nothing to the URL,
    // so these file paths resolve to /login, /forgot-password and
    // /auth/reset-password exactly as before.
    const url = (p: string) =>
      '/' + p.replace('src/app/', '').replace('/page.tsx', '').split('/').filter((s) => !s.startsWith('(')).join('/')
    assert.equal(url(LOGIN_PATH), '/login')
    assert.equal(url(FORGOT_PATH), '/forgot-password')
    assert.equal(url(RESET_PATH), '/auth/reset-password')
  })

  test('the pre-R2 page locations are gone, so neither URL can resolve twice', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/forgot-password/page.tsx')))
    assert.ok(!existsSync(join(ROOT, 'src/app/auth/reset-password/page.tsx')))
  })

  test('ShellGate suppresses the app chrome for exactly these three routes', () => {
    const m = SHELL_GATE.match(/new Set\(\[([^\]]*)\]\)/)
    assert.ok(m, 'ShellGate must declare its bare-route set')
    const routes = m![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
    assert.deepEqual(routes.sort(), ['/auth/reset-password', '/forgot-password', '/login'])
  })

  test('ShellGate membership and (auth) group membership are the same set', () => {
    // Drift either way is a real defect: a bare route outside the group renders
    // with NO shell at all; a group route missing here renders the gateway
    // nested inside the application chrome.
    const inGroup = walk(join(ROOT, 'src/app/(auth)'))
      .filter((f) => f.endsWith(`${sep}page.tsx`))
      .map((f) => f.split(sep).join('/').split('src/app/')[1].replace('/page.tsx', ''))
      .map((p) => '/' + p.split('/').filter((s) => !s.startsWith('(')).join('/'))
      .sort()
    const bare = SHELL_GATE.match(/new Set\(\[([^\]]*)\]\)/)![1]
      .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean).sort()
    assert.deepEqual(bare, inGroup)
  })

  test('no auth route renders AppShell or any application chrome', () => {
    for (const [name, src] of AUTH_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /AppShell/, `${name} must not render AppShell`)
      assert.doesNotMatch(code, /TopBar|PrimaryNav|SecondaryNav|MobileNavDrawer|CommandPalette|Sidebar/,
        `${name} must not render application navigation`)
      assert.doesNotMatch(code, /MarketDataProvider|MacroDataProvider/, `${name} must not mount data providers`)
    }
    // The layout is the only thing between the root layout and these pages.
    assert.doesNotMatch(strip(AUTH_LAYOUT), /AppShell|TopBar|CommandPalette|MarketDataProvider|MacroDataProvider/)
  })

  test('no auth route shows a company search or a platform date header', () => {
    for (const [name, src] of RECOVERY_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /t\.common\.search|CommandPalette|cmdk:open/, `${name} must not expose search`)
      assert.doesNotMatch(code, /formatFullDate|t\.topbar\./, `${name} must not render the platform date header`)
    }
  })

  // ── R2 repair — the global dashboard link is gone from the whole gateway ──
  //
  // Reported from the desktop review: "← Back to dashboard" still rendered below
  // the panel on /login. On a signed-out gateway `/` is a PRIVATE route, so the
  // link only bounced the visitor through middleware back to /login?next=/.

  test('no authentication page renders a back-to-dashboard link, in either language', () => {
    for (const [name, src] of AUTH_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /backToHome/, `${name} must not reference the dashboard-link key`)
      assert.doesNotMatch(code, /Back to dashboard/i, `${name} must not hardcode the English label`)
      assert.doesNotMatch(code, /Volver al panel/i, `${name} must not hardcode the Spanish label`)
      assert.doesNotMatch(code, /AuthBackLink/, `${name} must not use the removed primitive`)
    }
  })

  test('no authentication page links to the application root', () => {
    for (const [name, src] of AUTH_ROUTES) {
      const hrefs = [...strip(src).matchAll(/href="([^"]*)"/g)].map((m) => m[1])
      assert.ok(!hrefs.includes('/'), `${name} must not link to the private root`)
      // Every remaining link is route-specific navigation inside the panel.
      for (const href of hrefs) {
        assert.ok(['/login', '/forgot-password'].includes(href), `${name} has an unexpected link: ${href}`)
      }
    }
  })

  test('the removed primitive no longer exists, and the shell never had one', () => {
    assert.doesNotMatch(AUTH_FORM, /export function AuthBackLink/)
    assert.doesNotMatch(strip(AUTH_SHELL), /backToHome|href="\/"/,
      'AuthShell must not emit a dashboard link either')
    assert.doesNotMatch(strip(AUTH_FORM), /nv-auth-onphoto-shadow/,
      'the on-photo link treatment existed only for that link')
  })

  test('the orphaned i18n key is removed from both dictionaries', () => {
    const authBlocks = [...I18N.matchAll(/\n    auth: \{([\s\S]*?)\n    \},/g)]
    assert.equal(authBlocks.length, 2)
    for (const [i, block] of authBlocks.entries()) {
      assert.doesNotMatch(block[1], /backToHome:/, `auth.backToHome must be gone from ${i === 0 ? 'dict.en' : 'dict.es'}`)
    }
  })

  test('route-specific navigation inside the panels is PRESERVED', () => {
    // The repair removes only the global dashboard treatment.
    assert.match(LOGIN, /href="\/forgot-password"[\s\S]*?t\.auth\.forgotPassword/,
      '/login keeps "Forgot password?"')
    for (const [name, src] of RECOVERY_ROUTES) {
      assert.match(src, /<AuthSecondaryLink href="\/login" label=\{t\.auth\.haveAccount\}/,
        `${name} keeps "Back to sign in"`)
    }
  })

  test('the AUTHENTICATED application keeps its own navigation — the repair is gateway-only', () => {
    const topBar = read('src/components/layout/TopBar.tsx')
    assert.match(topBar, /href="\/"/, 'the app header keeps its brand link to the dashboard')
    assert.match(read('src/components/layout/PrimaryNav.tsx'), /<nav/, 'primary nav intact')
    assert.match(read('src/components/layout/ShellGate.tsx'), /<AppShell>\{children\}<\/AppShell>/)
  })

  test('the legacy card presentation is gone from both recovery routes', () => {
    for (const [name, src] of RECOVERY_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /BrandLogo/, `${name} must not use the legacy NMI mini-card lockup`)
      assert.doesNotMatch(code, /bg-background|bg-surface\b|border-border/, `${name} must not use the legacy flat card`)
      assert.doesNotMatch(code, /min-h-screen/, `${name} must not own the page frame — AuthShell does`)
    }
  })
})

// ─── 2 · One visual language ─────────────────────────────────────────────────

describe('R2 · the recovery panels are variants of the same AuthPanel family', () => {
  test('each route composes the same headline slot, panel column and glass panel', () => {
    for (const [name, src] of AUTH_ROUTES) {
      assert.match(src, /<AuthHeadline/, `${name} must render the shared identity column`)
      assert.match(src, /<AuthPanelColumn>/, `${name} must render the shared panel column`)
      assert.match(src, /<AuthPanel /, `${name} must render the Tier-1 glass panel`)
      assert.match(src, /from '@\/components\/fable\/AuthPanel'/, `${name} must import the shared panel`)
    }
  })

  test('the background, veils, branding and utility controls come from ONE shell, not per-route copies', () => {
    // Every gateway visual lives in AuthShell; no route may restate one.
    assert.match(AUTH_SHELL, /login-santiago\.webp/)
    for (const [name, src] of AUTH_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /login-santiago|nv-auth-veil|NevadaMark|LangToggle|ThemeToggle|secureConnection/,
        `${name} must not re-implement a gateway layer`)
    }
  })

  test('the identity column is byte-identical across the three routes', () => {
    const headline = (src: string) => src.match(/<AuthHeadline[\s\S]*?\/>/)![0].replace(/\s+/g, ' ')
    const [a, b, c] = AUTH_ROUTES.map(([, src]) => headline(src))
    assert.equal(a, b)
    assert.equal(b, c)
    // …and it is fed entirely from i18n, never a literal.
    assert.match(a, /eyebrow=\{t\.auth\.brandEyebrow\} line1=\{t\.auth\.headline1\}/)
  })

  test('every panel uses the private-access eyebrow and a route-specific title', () => {
    const eyebrow = (src: string) => src.match(/<AuthPanel eyebrow=\{([^}]+)\}/)![1]
    const title = (src: string) => src.match(/<AuthPanel eyebrow=\{[^}]+\} title=\{([^}]+)\}/)![1]
    for (const [name, src] of AUTH_ROUTES) {
      assert.equal(eyebrow(src), 't.auth.privateAccess', `${name} eyebrow`)
    }
    assert.deepEqual(AUTH_ROUTES.map(([, src]) => title(src)), [
      't.auth.signInTitle',
      't.auth.forgotPasswordTitle',
      't.auth.newPasswordTitle',
    ])
  })

  test('panel height follows content — no route forces a height on the panel or its column', () => {
    for (const [name, src] of AUTH_ROUTES) {
      assert.doesNotMatch(strip(src), /height:|minHeight:|h-\[\d|min-h-\[\d/, `${name} must not pin panel height`)
    }
    assert.doesNotMatch(strip(AUTH_FORM), /height:|minHeight:/)
  })

  test('shared primitives own the field, notice, action and link recipes — no route restates them', () => {
    for (const marker of ['.nv-auth-input', 'rounded-full', 'nv-spin', 'nv-pop']) {
      assert.ok(AUTH_FORM.includes(marker), `AuthForm must own ${marker}`)
    }
    for (const [name, src] of AUTH_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /nv-auth-input|nv-spin/, `${name} must not restate the field or spinner recipe`)
      assert.doesNotMatch(code, /<input\b/, `${name} must not hand-roll an input`)
      assert.doesNotMatch(code, /<button\b/, `${name} must not hand-roll a button`)
    }
  })

  test('the success notice is a token pair declared once, never a hardcoded colour', () => {
    for (const tok of ['--nv-auth-ok-bg', '--nv-auth-ok-bd', '--nv-auth-ok-fg']) {
      assert.match(CSS, new RegExp(`  ${tok}:`), `${tok} must be declared in :root`)
      const darkBlock = CSS.match(/\n\.dark \{[\s\S]*?\n\}/)![0]
      assert.ok(!darkBlock.includes(`${tok}:`), `${tok} must stay theme-independent like every --nv-auth-* token`)
    }
    assert.match(AUTH_FORM, /var\(--nv-auth-ok-bg\)/)
    assert.doesNotMatch(strip(AUTH_FORM), /#[0-9a-fA-F]{3,8}\b/)
  })

  test('no page-level horizontal overflow can be introduced: the columns wrap, they do not scroll', () => {
    // The panel column collapses to min(100%, 330px) and the shell's middle row
    // wraps, so at 320px the panel stacks under the headline instead of forcing
    // the page wider.
    assert.match(AUTH_FORM, /minWidth: 'min\(100%, 330px\)'/)
    assert.match(AUTH_SHELL, /flex-1 flex items-center justify-between flex-wrap/)
    for (const [name, src] of AUTH_ROUTES) {
      assert.doesNotMatch(strip(src), /overflow-x|whitespace-nowrap|minWidth: '?\d{3}/, `${name} must not force width`)
    }
  })
})

// ─── 3 · /forgot-password — preserved functional contract ────────────────────

describe('R2 · /forgot-password behaviour is carried over verbatim', () => {
  const CODE = strip(FORGOT)

  test('posts the same payload to the same endpoint', () => {
    assert.match(FORGOT, /fetch\('\/api\/auth\/forgot-password', \{/)
    assert.match(FORGOT, /method: 'POST'/)
    assert.match(FORGOT, /'Content-Type': 'application\/json'/)
    assert.match(FORGOT, /JSON\.stringify\(\{ email: email\.trim\(\) \}\)/)
    // That endpoint is the only network call on the page.
    assert.deepEqual([...new Set([...CODE.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]))], ['/api/auth/forgot-password'])
  })

  test('the email field is a real labelled email input with the right autocomplete', () => {
    const field = FORGOT.match(/<AuthField\s+id="email"[\s\S]*?\/>/)
    assert.ok(field, 'email field must exist')
    for (const attr of ['type="email"', 'required', 'autoComplete="email"', 'label={t.auth.emailLabel}']) {
      assert.ok(field![0].includes(attr), `email field missing ${attr}`)
    }
    // Placeholder is never the only label.
    assert.match(AUTH_FORM, /<label htmlFor=\{id\}/)
  })

  test('submit action and disabled/loading semantics are unchanged', () => {
    assert.match(FORGOT, /<form onSubmit=\{handleSubmit\}/)
    assert.match(FORGOT, /label=\{t\.auth\.sendResetLink\}/)
    assert.match(FORGOT, /loading=\{loading\}/)
    assert.match(FORGOT, /disabled=\{loading \|\| !email\.trim\(\)\}/)
    assert.match(FORGOT, /setLoading\(true\)/)
    assert.match(FORGOT, /setLoading\(false\)/)
  })

  test('the sent state is generic, unconditional, and stays inside the same panel', () => {
    // The fetch result is never inspected: `finally` sets sent regardless, and
    // the catch is empty — so a real address and an unknown one are identical.
    assert.match(FORGOT, /\} finally \{\s*\n\s*setLoading\(false\)\s*\n\s*setSent\(true\)\s*\n\s*\}/)
    assert.doesNotMatch(CODE, /res\.ok|response\.ok|\.status|json\.error/, 'the response must not gate the UI')
    assert.match(FORGOT, /t\.auth\.resetLinkSentTitle/)
    assert.match(FORGOT, /t\.auth\.resetLinkSentMessage/)
    // Rendered by the same AuthPanel as the form — the panel is not swapped out.
    const panelStart = FORGOT.indexOf('<AuthPanel ')
    const panelEnd = FORGOT.indexOf('</AuthPanel>')
    assert.ok(panelStart > -1 && panelEnd > panelStart)
    assert.ok(FORGOT.indexOf('resetLinkSentMessage') > panelStart)
    assert.ok(FORGOT.indexOf('resetLinkSentMessage') < panelEnd, 'the sent state must live inside the panel')
    assert.equal((FORGOT.match(/<AuthPanel /g) ?? []).length, 1)
  })

  test('the panel head is stable across states, so sending does not jolt the layout', () => {
    // Eyebrow, title and explanation render before the {sent ? … : …} branch,
    // so only the region below them changes.
    const branch = FORGOT.indexOf('{sent ?')
    assert.ok(branch > -1)
    assert.ok(FORGOT.indexOf('t.auth.forgotPasswordTitle') < branch)
    assert.ok(FORGOT.indexOf('t.auth.forgotPasswordSubtitle') < branch)
  })

  test('sign-in navigation is present in both states', () => {
    const links = [...FORGOT.matchAll(/<AuthSecondaryLink href="([^"]+)" label=\{([^}]+)\}/g)]
    assert.equal(links.length, 2, 'one in the form, one in the sent state')
    for (const [, href, label] of links) {
      assert.equal(href, '/login')
      assert.equal(label, 't.auth.haveAccount')
    }
  })
})

// ─── 4 · /auth/reset-password — preserved functional contract ────────────────

describe('R2 · /auth/reset-password behaviour is carried over verbatim', () => {
  const CODE = strip(RESET)

  test('posts the same payload to the same endpoint', () => {
    assert.match(RESET, /fetch\('\/api\/auth\/reset-password', \{/)
    assert.match(RESET, /method: 'POST'/)
    assert.match(RESET, /JSON\.stringify\(\{ password \}\)/)
    assert.deepEqual([...new Set([...CODE.matchAll(/'(\/api\/[^']+)'/g)].map((m) => m[1]))], ['/api/auth/reset-password'])
  })

  test('both password fields exist, in order, as new-password inputs', () => {
    assert.deepEqual(
      [...RESET.matchAll(/<AuthField\s+id="([a-zA-Z]+)"/g)].map((m) => m[1]),
      ['password', 'confirmPassword'],
    )
    for (const id of ['password', 'confirmPassword']) {
      const field = RESET.match(new RegExp(`<AuthField\\s+id="${id}"[\\s\\S]*?/>`))!
      assert.ok(field[0].includes('type="password"'), `${id} must be a password input`)
      assert.ok(field[0].includes('autoComplete="new-password"'), `${id} must autocomplete as new-password`)
      assert.ok(field[0].includes('required'), `${id} must be required`)
    }
    assert.match(RESET, /label=\{t\.auth\.newPasswordLabel\}/)
    assert.match(RESET, /label=\{t\.auth\.confirmPasswordLabel\}/)
    assert.match(RESET, /hint=\{t\.auth\.passwordHint\}/)
  })

  test('mismatch is caught client-side before any request is made', () => {
    const guard = RESET.indexOf('password !== confirmPassword')
    const call = RESET.indexOf("fetch('/api/auth/reset-password'")
    assert.ok(guard > -1 && call > guard, 'the mismatch guard must precede the request')
    assert.match(RESET, /setError\(t\.auth\.errPasswordMismatch\)\s*\n\s*return/)
  })

  test('an invalid or expired recovery session is reported in place, never as a generic error', () => {
    assert.match(RESET, /json\.error === 'no_session' \? t\.auth\.errResetLinkInvalid : t\.auth\.errResetFailed/)
    assert.match(RESET, /<AuthNotice variant="error"/)
  })

  test('the page never redirects before the user can set a password', () => {
    // The ONLY navigation is the post-success return to /login. No mount-time
    // session probe, no effect-driven redirect.
    assert.doesNotMatch(CODE, /useEffect/, 'no mount-time redirect may be introduced')
    const pushes = [...CODE.matchAll(/router\.(push|replace)\(([^)]*)\)/g)]
    assert.equal(pushes.length, 1)
    assert.equal(pushes[0][2], "'/login'")
    assert.match(RESET, /setDone\(true\)\s*\n\s*setTimeout\(\(\) => router\.push\('\/login'\), 1500\)/)
  })

  test('the success state stays inside the same panel and offers sign-in navigation', () => {
    assert.match(RESET, /t\.auth\.resetSuccessMessage/)
    assert.match(RESET, /<AuthNotice variant="success"/)
    assert.equal((RESET.match(/<AuthPanel /g) ?? []).length, 1)
    const panelEnd = RESET.indexOf('</AuthPanel>')
    assert.ok(RESET.indexOf('resetSuccessMessage') < panelEnd)
    assert.match(RESET, /<AuthSecondaryLink href="\/login" label=\{t\.auth\.haveAccount\}/)
  })

  test('the panel head is stable across states, so completing the reset does not jolt the layout', () => {
    const branch = RESET.indexOf('{done ?')
    assert.ok(branch > -1)
    assert.ok(RESET.indexOf('t.auth.newPasswordTitle') < branch)
    assert.ok(RESET.indexOf('t.auth.newPasswordSubtitle') < branch)
  })

  test('loading and disabled semantics are unchanged', () => {
    assert.match(RESET, /disabled=\{loading \|\| !password \|\| !confirmPassword\}/)
    assert.match(RESET, /label=\{t\.auth\.submitNewPassword\}/)
    assert.equal((RESET.match(/setLoading\(false\)/g) ?? []).length, 2, 'both failure paths clear loading')
  })
})

// ─── 5 · Security boundary — R1.5 unchanged ──────────────────────────────────

describe('R2 · the R1.5 security boundary is untouched', () => {
  test('the recovery API paths and the callback URL are unchanged', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/api/auth/forgot-password/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/api/auth/reset-password/route.ts')))
    assert.ok(existsSync(join(ROOT, 'src/app/auth/callback/route.ts')))
    // /auth/callback is a route handler, so no layout or shell applies to it and
    // it must NOT be moved into the (auth) group.
    assert.ok(!existsSync(join(ROOT, 'src/app/(auth)/auth/callback')))
  })

  test('the recovery link still targets /auth/callback → /auth/reset-password', () => {
    const forgot = read('src/app/api/auth/forgot-password/route.ts')
    assert.match(forgot, /\/auth\/callback\?next=/)
    assert.match(forgot, /\/auth\/reset-password/)
    assert.match(forgot, /ok: true/, 'still generic — no account enumeration')
  })

  test('the callback still enforces the approval boundary before a session survives', () => {
    const cb = read('src/app/auth/callback/route.ts')
    assert.match(cb, /isApprovedProfile\(profile\)/)
    assert.match(cb, /supabase\.auth\.signOut\(\)/)
    assert.match(cb, /error=not_authorized/)
    assert.match(cb, /toSafeInternalPath/)
  })

  test('the access policy still classifies exactly these three pages as public', () => {
    const policy = read('src/lib/auth/accessPolicy.ts')
    const block = policy.match(/PUBLIC_PAGE_PATHS = \[([\s\S]*?)\]/)![1]
    const paths = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
    assert.deepEqual(paths, ['/login', '/forgot-password', '/auth/reset-password'])
  })

  test('no registration control or route reappears anywhere on the auth surface', () => {
    assert.ok(!existsSync(join(ROOT, 'src/app/api/auth/register/route.ts')))
    for (const [name, src] of AUTH_ROUTES) {
      assert.doesNotMatch(strip(src), /api\/auth\/register/, `${name} must not call a registration endpoint`)
      assert.doesNotMatch(strip(src), /sign ?up|create an account|createAccountTitle|submitCreate|needAccount/i,
        `${name} must expose no self-registration control`)
    }
    assert.doesNotMatch(strip(AUTH_FORM), /register|sign ?up/i)
  })

  test('no auth surface touches Supabase, credentials, or a service-role secret', () => {
    for (const [name, src] of [...AUTH_ROUTES, ['AuthForm', AUTH_FORM] as const]) {
      const code = strip(src)
      assert.doesNotMatch(code, /supabase|createClient|signInWith|SERVICE_ROLE|getSupabaseAdminClient/i,
        `${name} must not reach the auth provider directly`)
      assert.doesNotMatch(code, /user_profiles|auth\.uid/, `${name} must not implement approval logic client-side`)
    }
  })

  test('the recovery pages send no user id and read no session client-side', () => {
    for (const [name, src] of RECOVERY_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /userId|user_id|getUser\(|getSession\(/, `${name} must not handle identity directly`)
    }
  })
})

// ─── 6 · Accessibility, localization, motion ─────────────────────────────────

describe('R2 · accessibility, localization and motion', () => {
  test('every field is bound to a visible label and can announce its error', () => {
    assert.match(AUTH_FORM, /<label htmlFor=\{id\} className="block"/)
    assert.match(AUTH_FORM, /aria-describedby=\{describedBy\}/)
    // Both stateful forms wire the association when an error is showing.
    for (const [name, src] of [['login', LOGIN], ['reset-password', RESET]] as const) {
      assert.match(src, /const describedBy = error \? ERROR_ID : undefined/, `${name} must associate its error`)
      assert.match(src, /<AuthNotice variant="error" id=\{ERROR_ID\}/, `${name} must give the notice that id`)
    }
  })

  test('the error notice interrupts and the success notice does not', () => {
    assert.match(AUTH_FORM, /role=\{error \? 'alert' : 'status'\}/)
  })

  test('the spinner is decorative — the busy state is carried by the label and disabled', () => {
    // Slice to the NEXT export — a lazy `\n}` would stop at the destructured
    // parameter list and assert against nothing.
    const from = AUTH_FORM.indexOf('export function AuthSubmitButton')
    assert.ok(from > -1)
    const rest = AUTH_FORM.slice(from + 1)
    const button = rest.slice(0, rest.indexOf('export function'))
    assert.match(button, /aria-hidden="true"/)
    assert.match(button, /disabled=\{disabled\}/)
    assert.match(button, /\{label\}/)
  })

  test('all visible recovery copy flows through t.auth.*, in both languages', () => {
    for (const [name, src] of RECOVERY_ROUTES) {
      // No bare quoted sentence in JSX text position.
      assert.doesNotMatch(strip(src), />[A-Z][a-z]+ [a-z]+/, `${name} must not hardcode visible copy`)
    }
    const authBlocks = [...I18N.matchAll(/\n    auth: \{([\s\S]*?)\n    \},/g)]
    assert.equal(authBlocks.length, 2, 'one auth block per language')
    const used = new Set(
      [...(FORGOT + RESET).matchAll(/t\.auth\.([A-Za-z0-9]+)/g)].map((m) => m[1]),
    )
    assert.ok(used.size >= 12, 'the recovery routes should draw most of their copy from i18n')
    for (const key of used) {
      for (const [i, block] of authBlocks.entries()) {
        assert.ok(block[1].includes(`${key}:`), `auth.${key} missing from ${i === 0 ? 'dict.en' : 'dict.es'}`)
      }
    }
  })

  test('every recovery message required by the phase exists and is genuinely translated', () => {
    const authBlocks = [...I18N.matchAll(/\n    auth: \{([\s\S]*?)\n    \},/g)]
    const REQUIRED = [
      'forgotPasswordTitle', 'forgotPasswordSubtitle', 'sendResetLink',
      'resetLinkSentTitle', 'resetLinkSentMessage',
      'newPasswordTitle', 'newPasswordSubtitle', 'newPasswordLabel', 'confirmPasswordLabel',
      'submitNewPassword', 'errPasswordMismatch', 'errResetLinkInvalid', 'errResetFailed',
      'resetSuccessMessage', 'haveAccount',
    ]
    for (const key of REQUIRED) {
      for (const [i, block] of authBlocks.entries()) {
        assert.ok(block[1].includes(`${key}:`), `auth.${key} missing from ${i === 0 ? 'dict.en' : 'dict.es'}`)
      }
      // Values may be single- or double-quoted (a value containing an
      // apostrophe, e.g. "we'll send you a reset link", uses double quotes).
      const value = (block: string) => block.match(new RegExp(`${key}:\\s*(?:'([^']*)'|"([^"]*)")`))
      const en = value(authBlocks[0][1])
      const es = value(authBlocks[1][1])
      assert.ok(en && es, `${key} must be a plain string in both dictionaries`)
      const text = (m: RegExpMatchArray) => m[1] ?? m[2]
      assert.notEqual(text(en!), text(es!), `auth.${key} must be translated, not duplicated`)
    }
  })

  test('the recovery routes add no motion beyond the R1 entrance and notice pop', () => {
    for (const [name, src] of RECOVERY_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /nv-ken|nv-pulse|animation|transition(Property|Duration)?:/, `${name} adds motion`)
      assert.doesNotMatch(code, /style\.setProperty|clientX|clientY|requestAnimationFrame/, `${name} tracks the pointer`)
    }
    assert.doesNotMatch(strip(AUTH_FORM), /nv-ken|nv-pulse|animationDelay|will-change|willChange/)
  })

  test('reduced motion still collapses every auth entrance to its final state', () => {
    const reduced = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)![0]
    const finalState = reduced.match(/\.nv-reveal, \.nv-pop, \.nv-slide-in[^{]*\{[\s\S]*?\}/)![0]
    assert.match(finalState, /\.nv-auth-reveal/)
    assert.match(finalState, /\.nv-auth-fade/)
    assert.match(finalState, /opacity: 1 !important/)
    assert.match(finalState, /transform: none !important/)
    assert.match(reduced, /\.nv-ken, \.nv-pulse, \.nv-spin \{[\s\S]*?animation: none !important/)
    // The primitives use only those two utilities plus .nv-pop, all covered above.
    const used = [...AUTH_FORM.matchAll(/nv-(auth-reveal|auth-fade|pop|transition|spin)/g)].map((m) => m[0])
    assert.deepEqual([...new Set(used)].sort(), ['nv-auth-fade', 'nv-auth-reveal', 'nv-pop', 'nv-spin', 'nv-transition'])
  })
})

// ─── 7 · No duplicated implementations, no mock data ─────────────────────────

describe('R2 · one implementation of each auth concern', () => {
  test('AuthShell, AuthPanel, LangProvider and the form primitives each exist exactly once', () => {
    const defs = (needle: RegExp) =>
      walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f) && needle.test(readFileSync(f, 'utf8')))
    assert.equal(defs(/export function AuthShell\b/).length, 1)
    assert.equal(defs(/export function AuthPanel\b/).length, 1)
    assert.equal(defs(/export function LangProvider\b/).length, 1)
    for (const name of ['AuthField', 'AuthNotice', 'AuthSubmitButton', 'AuthHeadline', 'AuthPanelColumn']) {
      assert.equal(defs(new RegExp(`export function ${name}\\b`)).length, 1, `${name} must be defined once`)
    }
  })

  test('no auth route re-implements theme, language or session handling', () => {
    for (const [name, src] of AUTH_ROUTES) {
      const code = strip(src)
      assert.doesNotMatch(code, /localStorage|matchMedia|documentElement|setTheme|setLang\(/,
        `${name} must not re-implement a shell concern`)
    }
  })

  test('no auth surface reads Fable mock or sample data', () => {
    for (const [name, src] of [...AUTH_ROUTES, ['AuthForm', AUTH_FORM] as const, ['AuthShell', AUTH_SHELL] as const]) {
      const code = strip(src)
      assert.doesNotMatch(code, /@\/data\/|mock|sample|fixture|placeholderData/i, `${name} must not read sample data`)
    }
  })
})

/** Recursive file list, mirroring the helper used by the other suites. */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
