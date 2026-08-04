// R9.2 — canonical /settings shell + read-only Fable Administration composition.
//
// Source-scan checks, the established convention for React surfaces in this
// repo (no headless renderer, and R9.2 forbids adding one). The behavioural
// properties these stand in for are in the R9.2 manual-validation matrix.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dict } from '../src/lib/i18n.ts'
import { navGroups, resolveActiveGroup, getPageTitle } from '../src/lib/navigation.ts'
import { requiresApprovedSession, classifyPath } from '../src/lib/auth/accessPolicy.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const PAGE = read('src/app/settings/page.tsx')
const CLIENT = read('src/app/settings/SettingsClient.tsx')
const NOTIF_PAGE = read('src/app/settings/notifications/page.tsx')
const BELL = read('src/components/ui/NotificationBell.tsx')
const HEALTH_ROUTE = read('src/app/api/health/ingestion/route.ts')

// R9.3 — the preference systems the Display card is a VIEW of, plus the
// selector primitive it reuses. Read here so the assertions can cross the file
// boundary rather than trusting an import line.
const THEME_STORE = read('src/lib/useTheme.ts')
const LANG_PROVIDER = read('src/components/providers/LangProvider.tsx')
const THEME_TOGGLE = read('src/components/ui/ThemeToggle.tsx')
const LANG_TOGGLE = read('src/components/ui/LangToggle.tsx')
const SEGMENTED = read('src/components/fable/SegmentedControl.tsx')
const LAYOUT = read('src/app/layout.tsx')

// R9.5 — the consolidation audit reads the surface as one product: the page
// header that owns the h1, and the shell that decides whether anything can
// cover the `#notifications` anchor.
const PAGE_HEADER = read('src/components/fable/PageHeader.tsx')
const APP_SHELL = read('src/components/layout/AppShell.tsx')
const TOP_BAR = read('src/components/layout/TopBar.tsx')
const SECONDARY_NAV = read('src/components/layout/SecondaryNav.tsx')

// R9.4 — the integrated recipients workflow and the shared components it reuses.
const CARD = read('src/app/settings/NotificationRecipientsCard.tsx')
const TABLE_CARD = read('src/components/fable/TableCard.tsx')
const MODAL = read('src/components/fable/ModalShell.tsx')
const SWITCH = read('src/components/fable/Switch.tsx')
const RECIPIENTS_ROUTE = read('src/app/api/notification-recipients/route.ts')
const RECIPIENT_ID_ROUTE = read('src/app/api/notification-recipients/[id]/route.ts')

/** Comment-stripped, so prose can neither satisfy nor trip a scan. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const PAGE_CODE = code(PAGE)
const CLIENT_CODE = code(CLIENT)
const CARD_CODE = code(CARD)
const BOTH = `${PAGE_CODE}\n${CLIENT_CODE}`

/** Every Fable Administration fixture string R9.2 must never reproduce. */
const FABLE_FIXTURES = [
  'María Undurraga', 'Cristóbal Ríos', 'Fernanda Larraín', 'External audit',
  'Custodian NAV feed', 'Document ingestion', 'Composite fixing',
  'Single sign-on', 'Two-factor', 'Session timeout', 'Device trust',
  'IP allowlist', 'Export watermark', 'ENFORCED',
  'Base currency', 'Reporting calendar', 'Benchmark set', 'Valuation policy',
  'Immutable log', 'Audit history', 'SAMPLE',
]

// ── Route and composition ───────────────────────────────────────────────────

describe('R9.2 · route and Fable composition', () => {
  test('1. the canonical /settings page exists as a server component with a client composition', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/settings/page.tsx')))
    assert.ok(existsSync(join(ROOT, 'src/app/settings/SettingsClient.tsx')))
    assert.doesNotMatch(PAGE, /^'use client'/, 'the route entry must stay a server component')
    assert.match(CLIENT, /^'use client'/)
    assert.match(PAGE_CODE, /export default async function SettingsPage\(\)/)
    assert.match(PAGE_CODE, /<SettingsClient account=\{account\} \/>/)
  })

  test('2-3. PageHeader is used and SectionHeader is absent', () => {
    assert.match(CLIENT, /from '@\/components\/fable\/PageHeader'/)
    assert.match(CLIENT_CODE, /<PageHeader\s+eyebrow=\{s\.tag\}\s+title=\{s\.title\}\s+metadata=\{s\.subtitle\}/)
    assert.doesNotMatch(BOTH, /SectionHeader/)
    // No hand-copied header styling.
    assert.doesNotMatch(CLIENT_CODE, /ui-page-title/)
  })

  test('4-5. cards are GlassSurface sections and sections use Reveal', () => {
    assert.match(CLIENT, /from '@\/components\/fable\/GlassSurface'/)
    assert.match(CLIENT, /from '@\/components\/fable\/motion'/)
    assert.equal((CLIENT_CODE.match(/<GlassSurface as="section"/g) ?? []).length, 4)
    // R9.3 added a fourth card INSIDE the existing second-row Reveal; R9.4 adds
    // the full-width third row as its own staggered reveal.
    assert.equal((CLIENT_CODE.match(/<Reveal delayMs=/g) ?? []).length, 3)
    assert.match(CLIENT_CODE, /<Reveal delayMs=\{70\}>/)
    assert.match(CLIENT_CODE, /<Reveal delayMs=\{130\}>/)
    assert.match(CLIENT_CODE, /<Reveal delayMs=\{190\}>/)
  })

  test('6-8. exactly the four cards render: Account, Data sources, Security, Display', () => {
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.account\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.sources\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.security\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.display\.title\}<\/CardTitle>/)
    assert.equal((CLIENT_CODE.match(/<CardTitle>/g) ?? []).length, 4)
  })

  test('9-11. no placeholder card and no early privacy stub', () => {
    // R9.3 owns Display and R9.4 owns Recipients (each has its own describe
    // below). R9.6 owns privacy — still the one thing that may not be stubbed.
    assert.doesNotMatch(CLIENT_CODE, /ThemeToggle|LangToggle|<Switch\b|role="switch"/)
    // The card is "Display", never a second "Appearance" concept.
    assert.doesNotMatch(CLIENT_CODE, /appearance|apariencia/i)
    assert.doesNotMatch(CLIENT_CODE, /placeholder|TODO|Coming soon|comingSoon|pr[óo]ximamente/i)
    // The composition delegates the mutation-heavy workflow rather than
    // inlining it — no recipient state or request lives in this file.
    assert.doesNotMatch(CLIENT_CODE, /notification-recipients|useState<Recipient|handleAdd/)
    // Card count already pinned at 4 above — an empty fifth card cannot exist.
  })

  test('12. Fable card proportions and responsive wrapping are reproduced', () => {
    // Row 1 — Fable `flex:1.6 1 420px; min-width:min(100%,330px)` beside
    // `flex:1 1 300px; min-width:min(100%,280px)`, 14px gap, wrapping.
    // Row 2 — Fable `flex:1.2 1 320px; min-width:min(100%,290px)` (Security)
    // beside the Display slot, same 14px rhythm and the same wrapping.
    assert.equal((CLIENT_CODE.match(/flex flex-wrap items-stretch gap-\[14px\]/g) ?? []).length, 2)
    assert.match(CLIENT_CODE, /grow-\[1\.6\] shrink basis-\[420px\] min-w-\[min\(100%,330px\)\]/)
    assert.match(CLIENT_CODE, /grow shrink basis-\[300px\] min-w-\[min\(100%,280px\)\]/)
    assert.match(CLIENT_CODE, /grow-\[1\.2\] shrink basis-\[320px\] min-w-\[min\(100%,290px\)\]/)
    assert.match(CLIENT_CODE, /mt-\[14px\]/)
    // Fable row anatomy: primary label over muted subline, chip pinned right.
    assert.match(CLIENT_CODE, /const ROW = 'flex items-center gap-3 py-2\.5 border-b border-\[var\(--nv-line\)\] last:border-0'/)
    assert.match(CLIENT_CODE, /px-5 py-\[18px\]/)
    // No consumer-settings sidebar, tabs, or preferences dashboard.
    assert.doesNotMatch(CLIENT_CODE, /role="tablist"|role="tab"|<aside|sidebar/i)
  })
})

// ── Navigation ──────────────────────────────────────────────────────────────

describe('R9.2 · navigation', () => {
  const settings = navGroups.find((g) => g.key === 'settings')

  test('13-14. the Settings nav href is /settings; key, icon and label unchanged', () => {
    assert.equal(settings?.href, '/settings')
    assert.equal(settings?.key, 'settings')
    assert.equal(settings?.icon, 'settings')
    assert.equal(settings?.label(dict.en), dict.en.nav.settings)
    assert.equal(settings?.label(dict.es), dict.es.nav.settings)
    assert.equal(settings?.children, undefined, 'R9.2 adds no nav child')
  })

  test('15. /settings/notifications still exists — now as the backward-compatible redirect (R9.4)', () => {
    // The route is PRESERVED, not deleted: existing bookmarks must resolve.
    assert.ok(existsSync(join(ROOT, 'src/app/settings/notifications/page.tsx')))
    assert.match(NOTIF_PAGE, /import \{ redirect \} from 'next\/navigation'/)
    assert.match(NOTIF_PAGE, /redirect\('\/settings#notifications'\)/)
    // One direction only — and the workflow itself no longer lives here.
    assert.doesNotMatch(NOTIF_PAGE, /notification-recipients|handleAdd|toggleActive|SectionHeader/)
  })

  test('16. the NotificationBell points directly at the integrated section (R9.4)', () => {
    assert.ok(BELL.includes('/settings#notifications'))
    assert.doesNotMatch(BELL, /href="\/settings\/notifications"/)
  })

  test('17 + 19. the nested route still resolves to the Settings group and its title', () => {
    assert.equal(getPageTitle('/settings/notifications', 'en', dict.en), dict.en.nav.settings)
    assert.equal(getPageTitle('/settings/notifications', 'es', dict.es), dict.es.nav.settings)
    assert.equal(getPageTitle('/settings', 'en', dict.en), dict.en.nav.settings)
    assert.equal(resolveActiveGroup('/settings')?.key, 'settings')
    assert.equal(resolveActiveGroup('/settings/notifications')?.key, 'settings')
    // Segment-aware: a sibling path must NOT activate Settings.
    assert.notEqual(resolveActiveGroup('/settingsfoo')?.key, 'settings')
  })

  test('18. both routes remain protected private pages under default-deny', () => {
    for (const p of ['/settings', '/settings/notifications']) {
      assert.equal(classifyPath(p), 'private_page')
      assert.ok(requiresApprovedSession(p))
    }
  })
})

// ── Account integrity ───────────────────────────────────────────────────────

describe('R9.2 · account card integrity', () => {
  test('20-22. the signed-in account only — no user list, no Fable fixture identity', () => {
    assert.match(PAGE_CODE, /const user = await getCurrentUser\(\)/)
    assert.match(PAGE_CODE, /getApprovalProfile\(user\.id\)/)
    // No list, map, or count of other users anywhere.
    assert.doesNotMatch(BOTH, /users\b|accounts\b|lastActive|last-active|scope\b|\.map\(\(u\b/i)
    for (const fixture of FABLE_FIXTURES) {
      assert.ok(!PAGE.includes(fixture) && !CLIENT.includes(fixture), `must not reproduce Fable fixture "${fixture}"`)
    }
  })

  test('23. user_profiles.role is never selected or displayed', () => {
    assert.doesNotMatch(BOTH, /\brole\b/)
    // The authoritative helper's own select list is unchanged and roleless.
    const getUser = read('src/lib/auth/getUser.ts')
    assert.match(getUser, /\.select\('id, username, email, display_name'\)/)
  })

  test('24-25. read-only — no profile write path and no user_profiles mutation', () => {
    assert.doesNotMatch(BOTH, /\.update\(|\.insert\(|\.upsert\(|\.delete\(|user_profiles/)
    assert.doesNotMatch(BOTH, /method:\s*'(POST|PATCH|PUT|DELETE)'/)
  })

  test('26. no service-role client anywhere in the route', () => {
    assert.doesNotMatch(BOTH, /supabase\/admin|getSupabaseAdminClient|SERVICE_ROLE|serviceRole/i)
  })

  test('27-28. username comes from the authoritative profile; approval never from metadata', () => {
    assert.match(PAGE_CODE, /username: text\(profile\?\.username\)/)
    // The metadata read is scoped to display_name/username-for-display only.
    const metaLine = PAGE_CODE.match(/const meta = .*$/m)
    assert.ok(metaLine)
    assert.match(metaLine![0], /display_name\?: unknown; username\?: unknown/)
    // Access is derived from the profile row via the shared predicate — never
    // from user_metadata, which is user-writable through the anon key.
    assert.match(PAGE_CODE, /access: profile === null \? 'unavailable' : isApprovedProfile\(profile\) \? 'approved' : 'not_approved'/)
    assert.doesNotMatch(PAGE_CODE, /meta\.(approved|access)|user_metadata\.\w*approv/i)
  })

  test('29. missing authoritative data renders Unavailable, never a fabricated value', () => {
    // A failed profile read yields null → "Unavailable", not a borrowed username.
    assert.match(PAGE_CODE, /function text\(value: unknown\): string \| null/)
    assert.match(CLIENT_CODE, /\{f\.value \?\? s\.account\.unavailable\}/)
    assert.match(CLIENT_CODE, /account\.access === 'approved' \? s\.account\.approved/)
    assert.match(CLIENT_CODE, /: s\.account\.unavailable/)
    // The tri-state exists in the type, so a failed read cannot become a denial.
    assert.match(CLIENT, /access: 'approved' \| 'not_approved' \| 'unavailable'/)
  })

  test('30. no editable account control', () => {
    assert.doesNotMatch(CLIENT_CODE, /<input|<textarea|<select|<form|contentEditable/)
    assert.doesNotMatch(CLIENT_CODE, /onSubmit/)
    // R9.3 introduced exactly two `onChange` bindings — both are the Display
    // card's preference selectors. Neither account nor security is editable.
    assert.deepEqual(CLIENT_CODE.match(/onChange=\{\w+\}/g), ['onChange={setTheme}', 'onChange={setLang}'])
    // Account values are a semantic description list.
    assert.match(CLIENT_CODE, /<dl className/)
    assert.match(CLIENT_CODE, /<dt className/)
    assert.match(CLIENT_CODE, /<dd\b/)
  })
})

// ── Data sources ────────────────────────────────────────────────────────────

describe('R9.2 · data sources card', () => {
  test('31-32. uses the existing sanitized endpoint and creates no other', () => {
    assert.match(CLIENT_CODE, /fetch\('\/api\/health\/ingestion', \{ cache: 'no-store', signal: controller\.signal \}\)/)
    assert.equal((CLIENT_CODE.match(/fetch\(/g) ?? []).length, 1)
    assert.equal(existsSync(join(ROOT, 'src/app/api/settings')), false)
    assert.equal(existsSync(join(ROOT, 'src/app/api/account')), false)
    // The endpoint itself is untouched.
    assert.match(HEALTH_ROUTE, /export async function GET\(\): Promise<NextResponse>/)
    assert.doesNotMatch(HEALTH_ROUTE, /settings/i)
  })

  test('33-35. loading, error and empty are explicit and distinct — failure is never healthy or empty', () => {
    assert.match(CLIENT_CODE, /useState<'loading' \| 'ready' \| 'error'>\('loading'\)/)
    assert.match(CLIENT_CODE, /healthState === 'loading' \? \(\s*<AsyncState kind="loading" \/>/)
    assert.match(CLIENT_CODE, /healthState === 'error' \? \(\s*<AsyncState kind="unavailable" message=\{s\.sources\.loadError\}/)
    assert.match(CLIENT_CODE, /sourceRows\.length === 0 \? \(\s*<AsyncState kind="empty" message=\{s\.sources\.empty\}/)
    // A non-2xx response is an error, not a body to render.
    assert.match(CLIENT_CODE, /if \(!res\.ok\) throw new Error\('unavailable'\)/)
    assert.match(CLIENT_CODE, /setHealthState\('error'\)/)
    // Stale requests are aborted on unmount.
    assert.match(CLIENT_CODE, /new AbortController\(\)/)
    assert.match(CLIENT_CODE, /return \(\) => controller\.abort\(\)/)
    assert.match(CLIENT_CODE, /if \(controller\.signal\.aborted\) return/)
    // No polling was introduced.
    assert.doesNotMatch(CLIENT_CODE, /setInterval|setTimeout/)
  })

  test('36-38. nothing is hardcoded — no status, no sync time, no Fable feed', () => {
    // Statuses and timestamps come only from the response.
    assert.match(CLIENT_CODE, /status: health\.macro\.status/)
    assert.match(CLIENT_CODE, /status: health\.market\.status/)
    assert.doesNotMatch(CLIENT_CODE, /'(healthy|warning|stale|failed)'\s*[,)]/)
    assert.doesNotMatch(CLIENT_CODE, /\d{2}:\d{2}/, 'no hardcoded synchronization time')
    assert.doesNotMatch(CLIENT_CODE, /Synced|nightly|custodian|Delayed \d/i)
    // Every rendered field is guarded on actually being present.
    assert.match(CLIENT_CODE, /if \(health\.macro\.latestRunAt\)/)
    assert.match(CLIENT_CODE, /if \(health\.market\.latestSnapshotDate\)/)
    assert.match(CLIENT_CODE, /indicatorsTotal != null && health\.macro\.indicatorsHealthy != null/)
    // Shared date formatting only.
    assert.match(CLIENT, /import \{ formatSourceDate \} from '@\/lib\/formatters'/)
    assert.doesNotMatch(CLIENT_CODE, /toLocaleDateString|toLocaleTimeString|new Date\(/)
  })

  test('39. no raw JSON, credentials, or backend error text is rendered', () => {
    assert.doesNotMatch(CLIENT_CODE, /JSON\.stringify|<pre\b|\{json\}|\{health\}/)
    // The typed response shape deliberately omits the route's `error`/`detail`
    // fields, so the failure body can never reach the DOM. (`detail` as a
    // StatusRow prop is this component's own localized subline, not the
    // endpoint's error text.)
    const shape = CLIENT.match(/interface IngestionHealth \{[\s\S]*?\n\}/)
    assert.ok(shape)
    assert.doesNotMatch(shape![0], /\berror\b|\bdetail\b/)
    assert.doesNotMatch(CLIENT_CODE, /health\.detail|health\.error|json\.detail|json\.error|\.message\b/)
    assert.doesNotMatch(BOTH, /process\.env|SUPABASE_|DATABASE_URL|\bstack\b/i)
  })

  test('40. chip tone is derived from the returned status', () => {
    assert.match(CLIENT_CODE, /const STATUS_TONE: Record<HealthStatus, string> = \{/)
    assert.match(CLIENT_CODE, /healthy: 'text-positive'/)
    assert.match(CLIENT_CODE, /failed: 'text-negative'/)
    assert.match(CLIENT_CODE, /unknown: 'text-muted-fg'/)
    assert.match(CLIENT_CODE, /<ChipLabel className=\{STATUS_TONE\[row\.status\]\}>\{statusWord\(row\.status\)\}<\/ChipLabel>/)
    // Never colour alone — the chip carries the localized status word too.
    assert.match(CLIENT_CODE, /s\.sources\.status\[status\] \?\? s\.sources\.status\.unknown/)
  })
})

// ── Security card ───────────────────────────────────────────────────────────

describe('R9.2 · security card', () => {
  test('41-42. the password action is the canonical recovery route, honestly worded', () => {
    assert.match(CLIENT_CODE, /<Link href="\/forgot-password"/)
    assert.equal(dict.en.settings.security.resetPassword, 'Send password reset email')
    for (const d of [dict.en, dict.es]) {
      assert.doesNotMatch(d.settings.security.resetPassword, /change password|cambiar contrase/i)
    }
    assert.doesNotMatch(BOTH, /changePassword|change-password|currentPassword|newPassword/i)
  })

  test('43-44. sign-out reuses the canonical /logout route with no second auth workflow', () => {
    assert.match(CLIENT_CODE, /<a href="\/logout" className="text-xs text-negative/)
    assert.doesNotMatch(BOTH, /signOut\(|auth\.signOut|\/api\/auth\//)
    assert.equal((CLIENT_CODE.match(/\/logout/g) ?? []).length, 1)
  })

  test('45-46. no signup, approval, or role control', () => {
    // The Security card *states* that public sign-up is disabled — the scan is
    // therefore for a sign-up ROUTE or handler, not the word.
    assert.doesNotMatch(BOTH, /href="\/register"|\/api\/auth\/register|createAccount|selfRegister|signUp\(/i)
    assert.doesNotMatch(BOTH, /setApproved|approveUser|grantRole|setRole|\.rpc\(/i)
    // No interactive control at all in R9.2 — the page is entirely read-only
    // plus two navigational links.
    assert.doesNotMatch(CLIENT_CODE, /<button/)
    assert.equal((CLIENT_CODE.match(/onClick=/g) ?? []).length, 0)
  })

  test('47-52. every fabricated Fable security claim is excluded', () => {
    for (const claim of ['Single sign-on', 'SSO', 'Two-factor', '2FA', 'Session timeout', 'Device trust', 'IP allowlist', 'Export watermark', 'ENFORCED']) {
      assert.ok(!PAGE.includes(claim) && !CLIENT.includes(claim), `must not claim "${claim}"`)
      for (const d of [dict.en, dict.es]) {
        assert.doesNotMatch(JSON.stringify(d.settings), new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `i18n must not claim "${claim}"`)
      }
    }
  })

  test('security rows state only factual NMI invariants', () => {
    for (const d of [dict.en, dict.es]) {
      for (const key of ['accessState', 'signupState', 'rlsState', 'passwordState'] as const) {
        assert.ok(d.settings.security[key].length > 0)
      }
    }
    assert.match(CLIENT_CODE, /name=\{s\.security\.access\} detail=\{s\.security\.accessDesc\}/)
    assert.match(CLIENT_CODE, /name=\{s\.security\.signup\} detail=\{s\.security\.signupDesc\}/)
    assert.match(CLIENT_CODE, /name=\{s\.security\.rls\} detail=\{s\.security\.rlsDesc\}/)
    assert.match(CLIENT_CODE, /name=\{s\.security\.password\} detail=\{s\.security\.passwordDesc\}/)
  })
})

// ── Scope ───────────────────────────────────────────────────────────────────

describe('R9.2 · scope restraint', () => {
  test('53-56. no Switch, privacy, or ad-hoc persistence import', () => {
    assert.doesNotMatch(BOTH, /fable\/Switch|<Switch\b|role="switch"/)
    // R9.3 legitimately consumes `useTheme` — the ONE shared store. What stays
    // forbidden is a private persistence path or an early privacy consumer.
    assert.doesNotMatch(BOTH, /usePrivacyMode|usePersistentState|localStorage|sessionStorage/)
    assert.match(CLIENT, /import \{ useLang \} from '@\/components\/providers\/LangProvider'/)
    // The TopBar's own controls are never embedded — their icon-collapse and
    // header geometry are top-bar-specific.
    assert.doesNotMatch(CLIENT_CODE, /LangToggle|ThemeToggle/)
    // The server component touches no preference system at all.
    assert.doesNotMatch(PAGE_CODE, /useTheme|useLang|setTheme|setLang|SegmentedControl/)
  })

  test('57-58. the composition delegates the recipient workflow instead of inlining it', () => {
    // R9.4 integrated recipients, but the read-only composition itself still
    // issues no recipient request and holds no recipient state.
    assert.doesNotMatch(BOTH, /notification-recipients|notificationsRepository/)
    assert.match(CLIENT_CODE, /import \{ NotificationRecipientsCard \} from '\.\/NotificationRecipientsCard'/)
    assert.match(CLIENT_CODE, /<NotificationRecipientsCard \/>/)
    // The legacy route is now purely the preserved redirect.
    assert.match(NOTIF_PAGE, /export default function NotificationSettingsRedirect\(\)/)
  })

  test('59. no migration or generated database-type change', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    assert.equal(migrations.filter((f) => /settings|account|preference/i.test(f)).length, 0)
    assert.doesNotMatch(BOTH, /supabase\/migrations|database\.types/)
  })

  test('60. no API route was added or changed', () => {
    assert.equal(existsSync(join(ROOT, 'src/app/settings/api')), false)
    assert.doesNotMatch(BOTH, /NextResponse|route\.ts/)
    // The one endpoint consumed is pre-existing and read-only.
    assert.doesNotMatch(HEALTH_ROUTE, /POST|PATCH|DELETE/)
  })
})

// ── Localization and accessibility ──────────────────────────────────────────

describe('R9.2 · localization and accessibility', () => {
  /** Every leaf string in a nested dictionary branch, with its dotted path. */
  function leaves(obj: unknown, prefix = ''): [string, string][] {
    if (typeof obj === 'string') return [[prefix, obj]]
    if (obj && typeof obj === 'object') {
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
    }
    return []
  }

  test('61-62. the settings namespace exists in both languages with exact key parity', () => {
    assert.ok('settings' in dict.en && 'settings' in dict.es)
    const en = leaves(dict.en.settings).map(([k]) => k).sort()
    const es = leaves(dict.es.settings).map(([k]) => k).sort()
    assert.deepEqual(es, en)
    assert.ok(en.length >= 40, `expected a full settings namespace, got ${en.length} keys`)
    for (const [path, value] of leaves(dict.es.settings)) {
      assert.ok(value.trim().length > 0, `es.settings.${path} must not be empty`)
    }
    // Existing notification settings keys are untouched.
    assert.equal(dict.en.notifications.settings.tag, 'Notification Settings')
    assert.equal(dict.es.notifications.settings.add, 'Agregar')
  })

  test('63. no hardcoded visible English — every string comes from the dictionary', () => {
    // Compare against actual string literals and JSX text nodes, not raw
    // substrings — identifiers like `SettingsAccount` legitimately contain a
    // dictionary word without rendering it.
    const literals = new Set<string>()
    for (const m of CLIENT_CODE.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) literals.add((m[1] ?? m[2]).trim())
    for (const m of CLIENT_CODE.matchAll(/>([^<>{}]+)</g)) literals.add(m[1].trim())
    for (const [path, value] of leaves(dict.en.settings)) {
      assert.ok(!literals.has(value), `SettingsClient hardcodes en.settings.${path} instead of reading it`)
    }
    assert.match(CLIENT_CODE, /const s = t\.settings/)
  })

  test('64. heading hierarchy: PageHeader owns the h1, cards are h2', () => {
    const header = read('src/components/fable/PageHeader.tsx')
    assert.match(header, /<h1 className="ui-page-title text-foreground">/)
    assert.match(CLIENT_CODE, /return <h2 className="ui-label text-muted-fg">\{children\}<\/h2>/)
    assert.doesNotMatch(CLIENT_CODE, /<h1|<h3|<h4/)
  })

  test('65. loading and error carry live-region semantics via the shared AsyncState', () => {
    const async = read('src/components/fable/AsyncState.tsx')
    assert.match(async, /role=\{kind === 'error' \? 'alert' : 'status'\}/)
    assert.match(async, /aria-live="polite"/)
    assert.match(CLIENT, /import \{ AsyncState \} from '@\/components\/fable\/AsyncState'/)
  })

  test('66-67. actions are real links, and no native dialog is used', () => {
    assert.match(CLIENT, /import Link from 'next\/link'/)
    // Accessible names are the link text itself — no bare-glyph action.
    assert.match(CLIENT_CODE, /\{s\.security\.resetPassword\}/)
    assert.match(CLIENT_CODE, /\{s\.security\.signOut\}/)
    assert.doesNotMatch(BOTH, /window\.(alert|confirm|prompt)|\balert\(|\bconfirm\(|\bprompt\(/)
    // No nested interactive control inside a link or a row.
    assert.doesNotMatch(CLIENT_CODE, /<Link[^>]*>\s*<(button|a)\b/)
  })

  test('responsive: long values wrap and no fixed width can overflow the page', () => {
    assert.match(CLIENT_CODE, /break-all/, 'long emails/usernames must wrap')
    assert.match(CLIENT_CODE, /break-words/)
    assert.equal((CLIENT_CODE.match(/min-w-0/g) ?? []).length >= 4, true)
    assert.match(CLIENT_CODE, /flex-wrap/)
    // No viewport-busting fixed width.
    assert.doesNotMatch(CLIENT_CODE, /\bw-\[\d{3,}px\]|min-w-\[\d{3,}px\](?!.*100%)/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R9.3 — functional Display preferences
// ════════════════════════════════════════════════════════════════════════════

describe('R9.3 · Display card composition', () => {
  test('1-4. the Display card exists beside Security in the second row, in the Fable language', () => {
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.display\.title\}<\/CardTitle>/)
    // Both second-row cards are GlassSurface sections in ONE wrapping flex row.
    const row2 = CLIENT_CODE.slice(CLIENT_CODE.indexOf('<Reveal delayMs={130}>'))
    assert.equal((row2.match(/<GlassSurface as="section"/g) ?? []).length, 2)
    assert.match(row2, /<div className="flex flex-wrap items-stretch gap-\[14px\] mt-\[14px\]">/)
    assert.ok(row2.indexOf('s.security.title') < row2.indexOf('s.display.title'), 'Security precedes Display')
    // Same card padding and same 22px glass treatment as the R9.2 cards.
    assert.match(row2, /\$\{CARD\} grow shrink basis-\[300px\]/)
    const glass = read('src/components/fable/GlassSurface.tsx')
    assert.match(glass, /nv-glass-card/)
  })

  test('5-7. no Settings sidebar, no tabs, no Save/Cancel/Reset control', () => {
    assert.doesNotMatch(CLIENT_CODE, /role="tablist"|role="tab"|<aside|sidebar|<nav\b/i)
    // Immediate-save: none of the deferred-save affordances may exist.
    for (const d of [dict.en, dict.es]) {
      const json = JSON.stringify(d.settings)
      assert.doesNotMatch(json, /\bSave\b|\bCancel\b|\bApply\b|\bGuardar\b|\bCancelar\b|\bAplicar\b|\bRestablecer\b|unsaved|sin guardar/i)
    }
    assert.doesNotMatch(CLIENT_CODE, /isDirty|hasChanges|pendingChanges|onSave|handleSave|toast/i)
    // Still no literal button element in the page itself.
    assert.doesNotMatch(CLIENT_CODE, /<button/)
  })

  test('8. the preference row reuses the exact Fable row anatomy', () => {
    // Same ROW constant (padding, gap, rule, last:border-0) as every other card.
    assert.match(CLIENT_CODE, /function PreferenceRow\(/)
    assert.match(CLIENT_CODE, /<div className=\{`\$\{ROW\} flex-wrap`\}>/)
    // Primary label over muted subline, control pinned right — same as StatusRow.
    assert.match(CLIENT_CODE, /<span className="block text-xs text-foreground font-medium break-words">\{label\}<\/span>/)
    assert.match(CLIENT_CODE, /<span className="block ui-meta text-muted-fg mt-0\.5 break-words">\{detail\}<\/span>/)
    // Both rows carry a label AND an explanatory subline.
    assert.match(CLIENT_CODE, /label=\{s\.display\.theme\}\s*\n\s*detail=\{s\.display\.themeDesc\}/)
    assert.match(CLIENT_CODE, /label=\{s\.display\.language\}\s*\n\s*detail=\{s\.display\.languageDesc\}/)
    assert.equal((CLIENT_CODE.match(/<PreferenceRow/g) ?? []).length, 2, 'exactly Theme and Language')
    // StatusRow is untouched, so the other three cards render identically.
    assert.match(CLIENT_CODE, /function StatusRow\(\{ name, detail, chip \}/)
    assert.match(CLIENT_CODE, /const ROW = 'flex items-center gap-3 py-2\.5 border-b border-\[var\(--nv-line\)\] last:border-0'/)
  })
})

describe('R9.3 · theme preference', () => {
  test('9-10. the card consumes the ONE shared store — no second hook or provider', () => {
    assert.match(CLIENT, /import \{ useTheme, type Theme \} from '@\/lib\/useTheme'/)
    assert.match(CLIENT_CODE, /const \{ theme, setTheme \} = useTheme\(\)/)
    assert.equal((CLIENT_CODE.match(/useTheme\(\)/g) ?? []).length, 1)
    // Exactly one theme store exists in the codebase, and it is not a provider.
    assert.equal((THEME_STORE.match(/export function useTheme\b/g) ?? []).length, 1)
    assert.doesNotMatch(CLIENT_CODE, /createContext|ThemeProvider|ThemeContext/)
  })

  test('11-13. no second theme key, no usePersistentState, no JSON serialization', () => {
    assert.doesNotMatch(CLIENT_CODE, /localStorage|sessionStorage|usePersistentState|JSON\.(stringify|parse)/)
    // The store is still the only theme writer, still raw, still one key.
    assert.match(THEME_STORE, /export const THEME_STORAGE_KEY = 'theme'/)
    assert.match(THEME_STORE, /localStorage\.setItem\(THEME_STORAGE_KEY, theme\)/)
    assert.doesNotMatch(code(THEME_STORE), /JSON\.(stringify|parse)|usePersistentState/)
    const keys = [...code(THEME_STORE).matchAll(/localStorage\.(?:get|set)Item\(([^,)]+)/g)].map((m) => m[1].trim())
    assert.deepEqual([...new Set(keys)], ['THEME_STORAGE_KEY'])
  })

  test('14-16. Light and Dark options exist and the stored theme drives selection', () => {
    const block = CLIENT_CODE.slice(CLIENT_CODE.indexOf('<SegmentedControl<Theme>'))
    assert.match(block, /\{ value: 'light', label: s\.display\.light \}/)
    assert.match(block, /\{ value: 'dark', label: s\.display\.dark \}/)
    // The control is CONTROLLED by the store's value — not by local state.
    assert.match(block, /value=\{theme\}/)
    // The option values ARE the stored values, so nothing is mapped or re-encoded.
    assert.match(THEME_STORE, /export type Theme = 'dark' \| 'light'/)
    assert.match(THEME_STORE, /export const DEFAULT_THEME: Theme = 'dark'/)
  })

  test('17-18. selecting an option calls the shared setter; no independent authoritative state', () => {
    assert.match(CLIENT_CODE, /onChange=\{setTheme\}/)
    // Cross-file: the primitive really does invoke onChange with the option value.
    assert.match(SEGMENTED, /function select\(next: T\) \{\s*\n\s*onChange\(next\)/)
    assert.match(SEGMENTED, /onClick=\{\(\) => !option\.disabled && select\(option\.value\)\}/)
    // The only useState in the whole client is the ingestion-health pair.
    const generics = [...CLIENT_CODE.matchAll(/useState<([^>]*)>/g)].map((m) => m[1])
    assert.equal(generics.length, 2)
    for (const g of generics) assert.doesNotMatch(g, /Theme|Lang/i)
    assert.doesNotMatch(CLIENT_CODE, /setTheme\(|applyTheme|documentElement/, 'no re-implementation of the store')
  })

  test('19-21. ThemeToggle, layout.tsx and the downstream dark-class effect are unchanged', () => {
    // TopBar toggle: same store, same markup/accessibility contract.
    assert.match(THEME_TOGGLE, /const \{ isDark, setTheme \} = useTheme\(\)/)
    assert.match(THEME_TOGGLE, /from '@\/lib\/useTheme'/)
    assert.equal((THEME_TOGGLE.match(/aria-pressed=/g) ?? []).length, 2)
    assert.ok(THEME_TOGGLE.includes('<SunIcon />') && THEME_TOGGLE.includes('<MoonIcon />'))
    assert.equal((THEME_TOGGLE.match(/hidden sm:inline/g) ?? []).length, 2)
    // Pre-paint script: byte-identical, still comparing the RAW string.
    assert.match(
      LAYOUT,
      /\(function\(\)\{try\{if\(localStorage\.getItem\('theme'\)==='light'\)\{document\.documentElement\.classList\.remove\('dark'\)\}\}catch\(e\)\{\}\}\)\(\)/,
    )
    assert.match(LAYOUT, /<html lang="en" className="h-full dark" suppressHydrationWarning>/)
    assert.doesNotMatch(LAYOUT, /useTheme|SegmentedControl|settings/)
    // The one downstream effect is still the documentElement dark class.
    assert.match(THEME_STORE, /document\.documentElement\.classList\.toggle\('dark', dark\)/)
  })

  test('22. Settings and the TopBar are two views of the same store, synchronized both ways', () => {
    for (const src of [CLIENT, THEME_TOGGLE]) assert.match(src, /from '@\/lib\/useTheme'/)
    // Same-tab: `setTheme` dispatches the shared event every subscriber listens to.
    assert.match(THEME_STORE, /window\.dispatchEvent\(new Event\(THEME_EVENT\)\)/)
    assert.match(THEME_STORE, /window\.addEventListener\(THEME_EVENT, onStoreChange\)/)
    // Cross-tab: the native storage event, re-applying the document class.
    assert.match(THEME_STORE, /window\.addEventListener\('storage', onStorage\)/)
    assert.match(THEME_STORE, /if \(e\.key !== null && e\.key !== THEME_STORAGE_KEY\) return/)
    assert.match(THEME_STORE, /useSyncExternalStore\(subscribe, readTheme, getServerSnapshot\)/)
  })
})

describe('R9.3 · language preference', () => {
  test('23-24. the card consumes the existing provider — no second LangProvider', () => {
    assert.match(CLIENT, /import \{ useLang \} from '@\/components\/providers\/LangProvider'/)
    assert.match(CLIENT_CODE, /const \{ lang, setLang, t \} = useLang\(\)/)
    assert.equal((CLIENT_CODE.match(/useLang\(\)/g) ?? []).length, 1)
    assert.equal((LANG_PROVIDER.match(/export function LangProvider\b/g) ?? []).length, 1)
    // The client CONSUMES that provider (its import path is required above) and
    // defines no context or provider of its own.
    assert.doesNotMatch(CLIENT_CODE, /createContext|\.Provider\b|function LangProvider/)
  })

  test('25-26. no second lang key and no second dictionary', () => {
    assert.match(LANG_PROVIDER, /localStorage\.setItem\('lang', newLang\)/)
    const keys = [...code(LANG_PROVIDER).matchAll(/localStorage\.(?:get|set)Item\('([^']+)'/g)].map((m) => m[1])
    assert.deepEqual([...new Set(keys)], ['lang'])
    // The client imports only the Lang TYPE — never a second dictionary.
    assert.match(CLIENT, /import type \{ Lang \} from '@\/lib\/i18n'/)
    assert.equal((CLIENT.match(/from '@\/lib\/i18n'/g) ?? []).length, 1)
    assert.doesNotMatch(CLIENT_CODE, /\bdict\b/)
  })

  test('27-29. English and Español options exist and the current language drives selection', () => {
    const block = CLIENT_CODE.slice(CLIENT_CODE.indexOf('<SegmentedControl<Lang>'))
    assert.match(block, /\{ value: 'en', label: s\.display\.english \}/)
    assert.match(block, /\{ value: 'es', label: s\.display\.spanish \}/)
    assert.match(block, /value=\{lang\}/)
    // Endonyms in both dictionaries — a language's own name does not translate.
    assert.equal(dict.en.settings.display.english, dict.es.settings.display.english)
    assert.equal(dict.en.settings.display.spanish, dict.es.settings.display.spanish)
  })

  test('30-31. selecting calls setLang with the raw en/es value; no independent state', () => {
    assert.match(CLIENT_CODE, /onChange=\{setLang\}/)
    assert.match(LANG_PROVIDER, /function setLang\(newLang: Lang\)/)
    assert.match(LANG_PROVIDER, /useState<Lang>\('en'\)/, 'the provider still owns the default')
    // The client never mirrors the language into its own state.
    assert.doesNotMatch(CLIENT_CODE, /setLangState|useState<Lang>/)
  })

  test('32. Settings and the TopBar consume the same provider, synchronized both ways', () => {
    for (const src of [CLIENT, LANG_TOGGLE]) {
      assert.match(src, /from '@\/components\/providers\/LangProvider'/)
    }
    // Same-tab: React context. Cross-tab: the native storage event (R9.0).
    assert.match(LANG_PROVIDER, /<LangContext.Provider value=\{\{ lang, setLang, t: dict\[lang\] as Translation \}\}>/)
    assert.match(LANG_PROVIDER, /window\.addEventListener\('storage', onStorage\)/)
    assert.match(LANG_PROVIDER, /if \(e\.key !== 'lang'\) return/)
  })
})

describe('R9.3 · privacy restraint and scope preservation', () => {
  test('33-36. no privacy import, control, or placeholder copy', () => {
    assert.doesNotMatch(BOTH, /usePrivacyMode|PrivacyToggle|PrivacyValue|privacyMasked/)
    assert.doesNotMatch(BOTH, /mask|ocultar saldo|hide balance|sensitive/i)
    for (const d of [dict.en, dict.es]) {
      assert.doesNotMatch(JSON.stringify(d.settings), /privacy|privacidad|mask|enmascar/i)
    }
    // A disabled/"coming soon" preference row would be a placeholder control.
    assert.doesNotMatch(CLIENT_CODE, /disabled: true|disabled=\{true\}|\bdisabled\b/)
  })

  test('37-39. the three R9.2 cards are still present and unchanged in substance', () => {
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.account\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.sources\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.security\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /fetch\('\/api\/health\/ingestion'/)
    assert.match(CLIENT_CODE, /<Link href="\/forgot-password"/)
    assert.match(CLIENT_CODE, /<a href="\/logout"/)
    assert.match(CLIENT_CODE, /\{f\.value \?\? s\.account\.unavailable\}/)
  })

  test('40-43. the Display card owns no recipient concern (that is R9.4\'s own component)', () => {
    assert.doesNotMatch(BOTH, /notification-recipients|notificationsRepository/)
    // The composition still issues exactly one request of its own — the
    // ingestion-health read. Recipient traffic belongs to the R9.4 component.
    assert.equal((CLIENT_CODE.match(/fetch\(/g) ?? []).length, 1)
    // The Display card's two selectors remain its only controls.
    assert.deepEqual(CLIENT_CODE.match(/onChange=\{\w+\}/g), ['onChange={setTheme}', 'onChange={setLang}'])
  })

  test('44-46. no profile write, no service-role import, no migration or database-type change', () => {
    assert.doesNotMatch(BOTH, /\.update\(|\.insert\(|\.upsert\(|\.delete\(|user_profiles/)
    assert.doesNotMatch(BOTH, /supabase\/admin|getSupabaseAdminClient|SERVICE_ROLE|serviceRole/i)
    assert.doesNotMatch(BOTH, /supabase\/migrations|database\.types/)
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    assert.equal(migrations.filter((f) => /display|preference|theme|language/i.test(f)).length, 0)
    // No server-side preference persistence was introduced.
    assert.doesNotMatch(BOTH, /method:\s*'(POST|PATCH|PUT|DELETE)'/)
    assert.equal(existsSync(join(ROOT, 'src/app/api/settings')), false)
  })

  test('the shared SegmentedControl primitive itself is untouched', () => {
    assert.match(SEGMENTED, /export function SegmentedControl<T extends string>\(\{\s*\n\s*options, value, onChange, ariaLabel, remeasureToken, className = '',\s*\n\}: SegmentedControlProps<T>\)/)
    assert.match(SEGMENTED, /useNavIndicator\(value, remeasureToken \? `\$\{value\}\|\$\{remeasureToken\}` : value\)/)
  })
})

describe('R9.3 · accessibility, localization and responsive behavior', () => {
  function leaves(obj: unknown, prefix = ''): [string, string][] {
    if (typeof obj === 'string') return [[prefix, obj]]
    if (obj && typeof obj === 'object') {
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
    }
    return []
  }

  test('47. the Display card has a real subordinate heading', () => {
    assert.match(CLIENT_CODE, /return <h2 className="ui-label text-muted-fg">\{children\}<\/h2>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.display\.title\}<\/CardTitle>/)
    assert.doesNotMatch(CLIENT_CODE, /<h1|<h3|<h4/)
  })

  test('48-49. each selector carries an accessible group name', () => {
    assert.match(CLIENT_CODE, /ariaLabel=\{s\.display\.theme\}/)
    assert.match(CLIENT_CODE, /ariaLabel=\{s\.display\.language\}/)
    assert.match(SEGMENTED, /role="radiogroup"\s*\n\s*aria-label=\{ariaLabel\}/)
  })

  test('50-51. selected state is programmatically exposed, and never as role="switch"', () => {
    assert.match(SEGMENTED, /role="radio"\s*\n\s*aria-checked=\{active\}/)
    assert.doesNotMatch(SEGMENTED, /role="switch"|aria-checked=\{checked\}/)
    assert.doesNotMatch(CLIENT_CODE, /role="switch"|aria-pressed/)
    // Selected state is also carried by weight, not colour alone.
    assert.match(SEGMENTED, /fontWeight: active \? 600 : 500/)
    // Keyboard-operable with a roving tabindex.
    assert.match(SEGMENTED, /tabIndex=\{active \? 0 : -1\}/)
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']) {
      assert.ok(SEGMENTED.includes(`'${key}'`), `SegmentedControl must handle ${key}`)
    }
    // Focus-visible treatment is the global ring — nothing suppresses it.
    assert.doesNotMatch(SEGMENTED, /outline:\s*none|outline-none/)
  })

  test('52. no native dialog and no nested interactive control', () => {
    assert.doesNotMatch(BOTH, /window\.(alert|confirm|prompt)|\balert\(|\bconfirm\(|\bprompt\(/)
    assert.doesNotMatch(CLIENT_CODE, /<Link[^>]*>\s*<(button|a)\b/)
    // The heading renders nothing but its own text, so no control can be nested
    // inside it; and in the row the selector is a SIBLING of the label block,
    // never a descendant of it.
    assert.match(CLIENT_CODE, /function CardTitle\(\{ children \}: \{ children: React\.ReactNode \}\) \{\s*\n\s*return <h2 className="ui-label text-muted-fg">\{children\}<\/h2>\s*\n\}/)
    assert.match(CLIENT_CODE, /<\/span>\s*\n\s*\{control\}\s*\n\s*<\/div>/)
  })

  test('53-55. the nine new keys exist in both languages with exact parity', () => {
    const required = ['title', 'theme', 'themeDesc', 'light', 'dark', 'language', 'languageDesc', 'english', 'spanish']
    for (const d of [dict.en, dict.es]) {
      for (const k of required) {
        const v = (d.settings.display as unknown as Record<string, string>)[k]
        assert.equal(typeof v, 'string', `settings.display.${k} must exist`)
        assert.ok(v.trim().length > 0, `settings.display.${k} must not be empty`)
      }
    }
    const en = leaves(dict.en.settings.display).map(([k]) => k).sort()
    const es = leaves(dict.es.settings.display).map(([k]) => k).sort()
    assert.deepEqual(es, en)
    // Whole-namespace parity still holds after the addition.
    assert.deepEqual(
      leaves(dict.es.settings).map(([k]) => k).sort(),
      leaves(dict.en.settings).map(([k]) => k).sort(),
    )
  })

  test('56. no hardcoded visible copy — every Display string comes from the dictionary', () => {
    const literals = new Set<string>()
    for (const m of CLIENT_CODE.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) literals.add((m[1] ?? m[2]).trim())
    for (const m of CLIENT_CODE.matchAll(/>([^<>{}]+)</g)) literals.add(m[1].trim())
    for (const d of [dict.en, dict.es]) {
      for (const [path, value] of leaves(d.settings.display)) {
        assert.ok(!literals.has(value), `SettingsClient hardcodes settings.display.${path} instead of reading it`)
      }
    }
    // Only the raw STORED values appear as literals, and only as option values.
    for (const v of ['light', 'dark', 'en', 'es']) assert.ok(literals.has(v))
  })

  test('57. every pre-existing R9.2 and notification key survives untouched', () => {
    assert.equal(dict.en.settings.security.resetPassword, 'Send password reset email')
    assert.equal(dict.en.settings.account.unavailable, 'Unavailable')
    assert.equal(dict.es.settings.sources.title, 'Fuentes de datos')
    assert.equal(dict.en.notifications.settings.tag, 'Notification Settings')
    assert.equal(dict.es.notifications.settings.add, 'Agregar')
    assert.equal(dict.en.topbar.theme, 'Theme')
    assert.equal(dict.es.topbar.language, 'Idioma')
  })

  test('58-61. the second row wraps, uses the approved proportions, and cannot overflow', () => {
    assert.equal((CLIENT_CODE.match(/flex flex-wrap items-stretch gap-\[14px\]/g) ?? []).length, 2)
    assert.match(CLIENT_CODE, /grow-\[1\.2\] shrink basis-\[320px\] min-w-\[min\(100%,290px\)\]/)
    assert.match(CLIENT_CODE, /grow shrink basis-\[300px\] min-w-\[min\(100%,280px\)\]/)
    // The preference row itself wraps, so a narrow card drops the selector onto
    // its own right-aligned line instead of crushing the label.
    assert.match(CLIENT_CODE, /\$\{ROW\} flex-wrap/)
    assert.match(CLIENT_CODE, /grow shrink basis-\[140px\] min-w-0/)
    assert.match(CLIENT_CODE, /className="shrink-0 ml-auto"/)
    assert.equal((CLIENT_CODE.match(/className="shrink-0 ml-auto"/g) ?? []).length, 2)
    // No fixed-width selector container and no viewport-busting width anywhere.
    assert.doesNotMatch(CLIENT_CODE, /\bw-\[\d+px\]/)
    assert.doesNotMatch(CLIENT_CODE, /min-w-\[\d{3,}px\]/)
    // The primitive keeps its labels on one line inside its own pill.
    assert.match(SEGMENTED, /shrink-0 whitespace-nowrap/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R9.4 — Notification Recipients integrated into Settings
// ════════════════════════════════════════════════════════════════════════════

describe('R9.4 · composition', () => {
  test('1-3. the section exists, carries id="notifications", and is the full-width third row', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/settings/NotificationRecipientsCard.tsx')))
    // R9.5 added `ref`/`tabIndex={-1}` to this tag (see the focus repair); the
    // anchor id, the spacing and the full-width property are unchanged.
    assert.match(CARD_CODE, /<section [^>]*id="notifications"/)
    // Full width: the SECTION itself carries no flex basis/grow (the add-form
    // fields legitimately do), and it is not inside either two-card row.
    assert.match(CARD_CODE, /<section [^>]*id="notifications" className="mt-\[14px\] scroll-mt-6">/)
    const sectionTag = CARD_CODE.match(/<section [^>]*id="notifications"[^>]*>/)![0]
    assert.doesNotMatch(sectionTag, /basis-|grow|shrink|w-\[|max-w-/)
    // Rendered after both rows, in its own staggered reveal.
    const idx = CLIENT_CODE.indexOf('<NotificationRecipientsCard />')
    assert.ok(idx > CLIENT_CODE.indexOf('<Reveal delayMs={130}>'), 'third row comes after the second')
    assert.match(CLIENT_CODE, /<Reveal delayMs=\{190\}>\s*\n\s*<NotificationRecipientsCard \/>/)
  })

  test('4. the four existing Settings cards remain', () => {
    for (const key of ['s.account.title', 's.sources.title', 's.security.title', 's.display.title']) {
      assert.ok(CLIENT_CODE.includes(`<CardTitle>{${key}}</CardTitle>`), `${key} card must remain`)
    }
    assert.equal((CLIENT_CODE.match(/<CardTitle>/g) ?? []).length, 4)
    assert.equal((CLIENT_CODE.match(/<GlassSurface as="section"/g) ?? []).length, 4)
  })

  test('5-9. the approved shared components are used — TableCard, ChipButton, Switch, DestructiveConfirm', () => {
    assert.match(CARD, /import \{ TableCard \} from '@\/components\/fable\/TableCard'/)
    assert.match(CARD, /import \{ ChipButton \} from '@\/components\/fable\/Chip'/)
    assert.match(CARD, /import \{ Switch \} from '@\/components\/fable\/Switch'/)
    assert.match(CARD, /import \{ DestructiveConfirm \} from '@\/components\/fable\/ModalShell'/)
    assert.match(CARD_CODE, /<TableCard/)
    assert.match(CARD_CODE, /<Switch\b/)
    assert.match(CARD_CODE, /<DestructiveConfirm/)
    // ChipButton for both Add (submit) and Remove.
    assert.match(CARD_CODE, /<ChipButton type="submit"/)
    assert.match(CARD_CODE, /<ChipButton\s*\n\s*onClick=\{\(\) => setConfirming\(r\)\}/)
    // GlassSurface arrives through TableCard — the approved card material.
    assert.match(TABLE_CARD, /<GlassSurface variant="card"/)
    assert.match(TABLE_CARD, /<GlassSurface variant="dense">/)
    // No new shared primitive was introduced for this phase.
    assert.equal(existsSync(join(ROOT, 'src/components/fable/RecipientTable.tsx')), false)
  })

  test('10-12. no legacy SectionHeader, no sidebar or tabs, Fable hierarchy intact', () => {
    assert.doesNotMatch(CARD, /SectionHeader/)
    assert.doesNotMatch(CARD_CODE, /role="tablist"|role="tab"|<aside|sidebar/i)
    // The section label is TableCard's own `h2 ui-label` — the same Fable
    // treatment as every other Settings card, and still subordinate to the
    // PageHeader's single h1.
    assert.match(TABLE_CARD, /<h2 className="ui-label text-muted-fg">\{title\}<\/h2>/)
    assert.doesNotMatch(CARD_CODE, /<h1|<h2|<h3/)
    // Same 14px vertical rhythm as rows 1 and 2.
    assert.match(CARD_CODE, /mt-\[14px\]/)
  })
})

describe('R9.4 · route compatibility and the notification bell', () => {
  test('13-15. /settings/notifications is preserved as a one-directional redirect', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/settings/notifications/page.tsx')))
    assert.match(NOTIF_PAGE, /import \{ redirect \} from 'next\/navigation'/)
    assert.match(NOTIF_PAGE, /redirect\('\/settings#notifications'\)/)
    assert.equal((NOTIF_PAGE.match(/redirect\(/g) ?? []).length, 1, 'exactly one redirect call')
    // One direction: /settings itself never redirects, so no loop is possible.
    assert.doesNotMatch(BOTH, /redirect\(/)
    assert.doesNotMatch(CARD_CODE, /redirect\(/)
  })

  test('16. the bell links straight to the integrated section, and nothing else about it changed', () => {
    assert.match(BELL, /<Link href="\/settings#notifications" onClick=\{\(\) => setOpen\(false\)\}/)
    assert.doesNotMatch(BELL, /href="\/settings\/notifications"/)
    // Behaviour, fetching, unread state, drawer and icons untouched.
    for (const marker of [
      "fetch('/api/notifications', { cache: 'no-store' })",
      'const POLL_MS = 60_000',
      'if (!signedIn) return null',
      'async function markRead(',
      'async function markAllRead(',
      'aria-haspopup="dialog"',
      "backgroundColor: 'var(--critical-fill)'",
    ]) {
      assert.ok(BELL.includes(marker), `NotificationBell must still contain ${marker}`)
    }
  })

  test('17-20. nav stays /settings; both paths resolve, stay private, and keep their title', () => {
    assert.equal(navGroups.find((g) => g.key === 'settings')?.href, '/settings')
    assert.equal(resolveActiveGroup('/settings')?.key, 'settings')
    assert.equal(resolveActiveGroup('/settings/notifications')?.key, 'settings')
    for (const p of ['/settings', '/settings/notifications']) {
      assert.equal(classifyPath(p), 'private_page')
      assert.ok(requiresApprovedSession(p))
    }
    assert.equal(getPageTitle('/settings/notifications', 'en', dict.en), dict.en.nav.settings)
    assert.equal(getPageTitle('/settings/notifications', 'es', dict.es), dict.es.nav.settings)
  })
})

describe('R9.4 · initial load states', () => {
  test('21-22. loading is explicit, and empty is only reached after a SUCCESSFUL read', () => {
    assert.match(CARD_CODE, /const \[loadState, setLoadState\] = useState<LoadState>\('loading'\)/)
    assert.match(CARD_CODE, /type LoadState = 'loading' \| 'ready' \| 'error'/)
    assert.match(
      CARD_CODE,
      /loadState === 'loading' \? 'loading'\s*\n\s*: loadState === 'error' \? 'error'\s*\n\s*: recipients\.length === 0 \? 'empty'/,
    )
    // TableCard renders AsyncState — role="status" for loading, "alert" for error.
    assert.match(TABLE_CARD, /<AsyncState kind=\{state\}/)
    const async = read('src/components/fable/AsyncState.tsx')
    assert.match(async, /role=\{kind === 'error' \? 'alert' : 'status'\}/)
  })

  test('23-26. a failed read is its own state — never empty, never a stale success, never swallowed', () => {
    assert.match(CARD_CODE, /if \(!res\.ok\) throw new Error\('load_failed'\)/)
    assert.match(CARD_CODE, /setLoadState\('error'\)/)
    // `ready` is set ONLY on the success path.
    assert.equal((CARD_CODE.match(/setLoadState\('ready'\)/g) ?? []).length, 1)
    const success = CARD_CODE.indexOf("setLoadState('ready')")
    const failure = CARD_CODE.indexOf("setLoadState('error')")
    assert.ok(success < failure, 'ready is the try-branch, error the catch-branch')
    // The legacy `Array.isArray(...) ? ... : []` fallthrough that made a failed
    // GET indistinguishable from an empty list is gone: the throw precedes it.
    assert.ok(CARD_CODE.indexOf("throw new Error('load_failed')") < CARD_CODE.indexOf('Array.isArray(json.recipients)'))
    // No swallowed handler anywhere in the file.
    assert.doesNotMatch(CARD_CODE, /\.catch\(\(\)\s*=>\s*\{\s*\}\)/)
    assert.doesNotMatch(CARD_CODE, /catch\s*\{\s*\}/)
    // Stale requests are aborted on unmount and ignored after the await.
    assert.match(CARD_CODE, /new AbortController\(\)/)
    assert.match(CARD_CODE, /return \(\) => controller\.abort\(\)/)
    assert.match(CARD_CODE, /if \(controller\.signal\.aborted\) return/)
    assert.match(CARD_CODE, /if \(!controller\.signal\.aborted\) setLoadState\('error'\)/)
  })
})

describe('R9.4 · add recipient integrity', () => {
  test('27-29. the POST contract is byte-identical to the legacy call', () => {
    assert.match(CARD_CODE, /const ENDPOINT = '\/api\/notification-recipients'/)
    assert.match(CARD_CODE, /method: 'POST',\s*\n\s*headers: \{ 'Content-Type': 'application\/json' \},/)
    assert.match(CARD_CODE, /body: JSON\.stringify\(\{ email: trimmedEmail, label: label\.trim\(\) \|\| undefined \}\)/)
    assert.match(CARD_CODE, /type="email"/)
    // And the route it talks to is unchanged.
    assert.match(RECIPIENTS_ROUTE, /export async function GET\(\)/)
    assert.match(RECIPIENTS_ROUTE, /export async function POST\(request: NextRequest\)/)
    assert.match(RECIPIENTS_ROUTE, /if \(!isValidEmail\(email\)\) return NextResponse\.json\(\{ error: 'invalid_email' \}, \{ status: 422 \}\)/)
    assert.match(RECIPIENTS_ROUTE, /body\.label\.trim\(\)\.slice\(0, 80\)/)
  })

  test('30-33. the non-empty pre-check, the 80-char cap, and the duplicate-submit guard all hold', () => {
    assert.match(CARD_CODE, /const trimmedEmail = email\.trim\(\)\s*\n\s*if \(!trimmedEmail \|\| adding\) return/)
    assert.match(CARD_CODE, /maxLength=\{80\}/)
    // Disabled while pending AND while the field is empty.
    assert.match(CARD_CODE, /<ChipButton type="submit" disabled=\{adding \|\| !email\.trim\(\)\}/)
    assert.match(CARD_CODE, /setAdding\(true\)/)
    assert.match(CARD_CODE, /finally \{\s*\n\s*setAdding\(false\)/)
  })

  test('34-36. fields clear only after confirmed success, and no unconfirmed row is inserted', () => {
    const body = CARD_CODE.slice(CARD_CODE.indexOf('async function handleAdd'), CARD_CODE.indexOf('async function toggleActive'))
    // The failure branch returns BEFORE any clearing or list mutation.
    const failure = body.indexOf('if (!res.ok) {')
    const clearEmail = body.indexOf("setEmail('')")
    assert.ok(failure >= 0 && failure < clearEmail, 'the non-ok branch precedes the clear')
    assert.match(body, /if \(!res\.ok\) \{[\s\S]*?setFeedback\(\{ tone: 'error'[\s\S]*?return\s*\n\s*\}/)
    // The confirmed list is re-read from the server; no locally-built row.
    assert.match(body, /const confirmed = await fetchConfirmed\(\)\s*\n\s*if \(confirmed\) setRecipients\(confirmed\)/)
    assert.ok(body.indexOf('fetchConfirmed()') < clearEmail, 'the server is consulted before the fields clear')
    assert.doesNotMatch(body, /setRecipients\(\(prev\) => \[\.\.\.prev,/, 'never appends an unconfirmed row')
  })

  test('37-39. invalid_email keeps its exact behaviour, duplicates are named, failure is surfaced', () => {
    assert.match(CARD_CODE, /if \(error === 'invalid_email'\) return n\.invalidEmail/)
    assert.match(CARD_CODE, /const DUPLICATE_ERROR = \/duplicate key\|unique constraint\|already exists\/i/)
    assert.match(CARD_CODE, /if \(error && DUPLICATE_ERROR\.test\(error\)\) return n\.duplicateError/)
    assert.match(CARD_CODE, /return n\.addError/)
    // The email column really is UNIQUE, so this branch is reachable and honest.
    const migration = read('supabase/migrations/20260713000000_notifications_foundation.sql')
    assert.match(migration, /email\s+citext not null unique/)
    // Success only after res.ok — it is set after the non-ok early return.
    assert.ok(CARD_CODE.indexOf("message: n.addSuccess") > CARD_CODE.indexOf('if (!res.ok) {'))
    // The server's own error text is classified, never rendered.
    assert.doesNotMatch(CARD_CODE, /message: json\.error|\{json\.error\}|\{feedback\.raw/)
  })
})

describe('R9.4 · active toggle integrity and concurrency', () => {
  const body = CARD_CODE.slice(CARD_CODE.indexOf('async function toggleActive'), CARD_CODE.indexOf('async function confirmRemove'))

  test('40-41. the PATCH contract is byte-identical', () => {
    assert.match(body, /fetch\(`\$\{ENDPOINT\}\/\$\{r\.id\}`, \{\s*\n\s*method: 'PATCH',\s*\n\s*headers: \{ 'Content-Type': 'application\/json' \},\s*\n\s*body: JSON\.stringify\(\{ active: next \}\),/)
    assert.match(RECIPIENT_ID_ROUTE, /export async function PATCH\(request: NextRequest, ctx: \{ params: Promise<\{ id: string \}> \}\)/)
    assert.match(RECIPIENT_ID_ROUTE, /if \(typeof body\.active === 'boolean'\) patch\.active = body\.active/)
  })

  test('42-44. the shared Switch is used, with its ARIA contract and a per-recipient name', () => {
    assert.match(CARD_CODE, /<Switch\s*\n\s*checked=\{r\.active\}/)
    assert.match(SWITCH, /role="switch"/)
    assert.match(SWITCH, /aria-checked=\{checked\}/)
    // The name is composed from a localized phrase plus THIS recipient's email.
    assert.match(CARD_CODE, /aria-label=\{`\$\{n\.activeFor\}: \$\{r\.email\}`\}/)
    // The primitive itself was not modified to make this work.
    assert.match(SWITCH, /export function Switch\(\{\s*\n\s*checked,\s*\n\s*onCheckedChange,\s*\n\s*disabled = false,/)
    // Still presentation-only: the scan runs on the comment-stripped body,
    // because the doc block legitimately NAMES recipient activation as the
    // intended consumer and that prose must not trip it.
    assert.doesNotMatch(code(SWITCH), /fetch\(|useState|notification|recipient/i)
    assert.equal([...SWITCH.matchAll(/from\s+'([^']+)'/g)].length, 0, 'the primitive still needs no import')
  })

  test('45-48. prior value captured per recipient, pending keyed by id, other rows unaffected', () => {
    assert.match(body, /const previous = r\.active/)
    assert.match(body, /const next = !previous/)
    assert.match(CARD_CODE, /const \[pendingIds, setPendingIds\] = useState<string\[\]>\(\[\]\)/)
    assert.match(body, /if \(pendingIds\.includes\(r\.id\)\) return/, 'same-row overlap prevented')
    assert.match(body, /setPendingIds\(\(prev\) => \[\.\.\.prev, r\.id\]\)/)
    assert.match(body, /setPendingIds\(\(prev\) => prev\.filter\(\(id\) => id !== r\.id\)\)/)
    // Disabled state is per row, derived from that row's id — never a global flag.
    assert.match(CARD_CODE, /const busy = pendingIds\.includes\(r\.id\)/)
    assert.match(CARD_CODE, /disabled=\{busy\}/)
    assert.doesNotMatch(CARD_CODE, /disabled=\{adding \|\| busy\}|const \[busy, setBusy\]/)
  })

  test('49-53. only the affected row changes, rollback is row-scoped, nothing is swallowed', () => {
    // Optimistic update touches exactly the one id.
    assert.match(body, /setRecipients\(\(prev\) => prev\.map\(\(x\) => \(x\.id === r\.id \? \{ \.\.\.x, active: next \} : x\)\)\)/)
    // Rollback restores the CAPTURED prior value for the same single id.
    assert.match(body, /setRecipients\(\(prev\) => prev\.map\(\(x\) => \(x\.id === r\.id \? \{ \.\.\.x, active: previous \} : x\)\)\)/)
    // Never a whole-list snapshot restore.
    assert.doesNotMatch(CARD_CODE, /const snapshot = recipients|setRecipients\(snapshot\)|setRecipients\(previousList\)/)
    assert.doesNotMatch(body, /\.catch\(\(\)\s*=>\s*\{\s*\}\)/)
    assert.match(body, /if \(!res\.ok\) throw new Error\('update_failed'\)/)
    // Success strictly after the ok check.
    assert.ok(body.indexOf('n.updateSuccess') > body.indexOf('if (!res.ok)'))
    assert.match(body, /message: n\.updateError/)
  })
})

describe('R9.4 · confirmed delete', () => {
  const body = CARD_CODE.slice(CARD_CODE.indexOf('async function confirmRemove'))

  test('54-57. the DELETE contract is unchanged, gated by the shared dialog naming the recipient', () => {
    assert.match(body, /fetch\(`\$\{ENDPOINT\}\/\$\{target\.id\}`, \{ method: 'DELETE' \}\)/)
    assert.match(RECIPIENT_ID_ROUTE, /export async function DELETE\(_request: NextRequest, ctx: \{ params: Promise<\{ id: string \}> \}\)/)
    assert.match(CARD_CODE, /<DestructiveConfirm\s*\n\s*open=\{confirming !== null\}/)
    // The dialog description is built from THIS recipient's real fields only.
    // R9.5 made the same two fields wrap (they were an unbreakable string that
    // the clipping dialog could cut off at 320px) — same fields, same order.
    const el = CARD_CODE.slice(CARD_CODE.indexOf('<DestructiveConfirm'))
    const desc = el.slice(el.indexOf('description={'), el.indexOf('confirmLabel='))
    assert.match(desc, /\{confirming\.email\}/)
    assert.match(desc, /confirming\.label \? [\s\S]{0,90}\{confirming\.label\}/)
    // Only the two human-readable fields — never an internal one.
    assert.doesNotMatch(desc, /confirming\.(id|createdAt|active)/, 'names the recipient, nothing internal')
    assert.match(CARD_CODE, /title=\{n\.confirmRemoveTitle\}/)
    assert.match(CARD_CODE, /cancelLabel=\{n\.cancel\}/)
  })

  test('56 + 58-59. no native dialog; cancel and Escape mutate nothing', () => {
    assert.doesNotMatch(CARD_CODE, /window\.(confirm|alert|prompt)/)
    assert.ok(!/[^.\w](confirm|alert|prompt)\(/.test(CARD_CODE.replace(/confirmRemove\(/g, 'x(')))
    // Cancel only closes — it never calls the mutation.
    assert.match(CARD_CODE, /onCancel=\{\(\) => setConfirming\(null\)\}/)
    assert.match(CARD_CODE, /onConfirm=\{\(\) => void confirmRemove\(\)\}/)
    // Escape and the scrim route through onCancel in the shared shell, and the
    // shell fires onConfirm at most once per open.
    assert.match(MODAL, /useEscape\(open && canDismiss, onClose\)/)
    assert.match(MODAL, /if \(pending \|\| firedRef\.current\) return\s*\n\s*firedRef\.current = true\s*\n\s*onConfirm\(\)/)
    assert.match(MODAL, /onClick=\{onCancel\} disabled=\{pending\}/)
  })

  test('60-65. the row survives until a confirmed success, and a failure preserves it', () => {
    // Pending is set before the request; the row is NOT removed there.
    const setPending = body.indexOf('setPendingIds((prev) => [...prev, target.id])')
    const removal = body.indexOf('prev.filter((x) => x.id !== target.id)')
    const okCheck = body.indexOf("if (!res.ok) throw new Error('delete_failed')")
    assert.ok(setPending >= 0 && okCheck > setPending, 'pending precedes the request')
    assert.ok(removal > okCheck, 'the row is removed only AFTER the ok check')
    // Exactly one DELETE per confirmation, guarded against re-entry.
    assert.equal((body.match(/method: 'DELETE'/g) ?? []).length, 1)
    assert.match(body, /if \(!target \|\| pendingIds\.includes\(target\.id\)\) return/)
    // The catch surfaces a failure and never removes the row.
    const catchBlock = body.slice(body.indexOf('} catch {'), body.indexOf('} finally {'))
    assert.match(catchBlock, /message: n\.removeError/)
    assert.doesNotMatch(catchBlock, /setRecipients/)
    // Both the row's Switch and its Remove control are disabled while pending.
    assert.equal((CARD_CODE.match(/disabled=\{busy\}/g) ?? []).length, 2)
    assert.match(CARD_CODE, /pending=\{confirming \? pendingIds\.includes\(confirming\.id\) : false\}/)
  })

  test('66. the trap, scroll-lock and restoration stay the shared shell\'s contract', () => {
    // The card never reimplements any part of the dialog contract.
    assert.doesNotMatch(CARD_CODE, /role="dialog"|aria-modal|FOCUSABLE|addEventListener\('keydown'/)
    // R9.5: it does make exactly ONE focus move, and only because the shell's
    // restoration target — the deleted row's Remove chip — no longer exists by
    // then. Scope is asserted precisely in "R9.5 · focus is never lost…".
    assert.equal((CARD_CODE.match(/\.focus\(\)/g) ?? []).length, 1)
    assert.match(CARD_CODE, /sectionRef\.current\?\.focus\(\)/)
    assert.match(MODAL, /triggerRef\.current = document\.activeElement/)
    assert.match(MODAL, /if \(wasOpenRef\.current && !open\) \(triggerRef\.current as HTMLElement \| null\)\?\.focus\?\.\(\)/)
    assert.match(MODAL, /document\.body\.style\.overflow = 'hidden'/)
    assert.match(MODAL, /if \(e\.key !== 'Tab'\) return/)
  })
})

describe('R9.4 · feedback and accessibility', () => {
  test('67-68. errors are role="alert", success is a separate polite live region', () => {
    assert.match(CARD_CODE, /<p id=\{errorId\} role="alert"/)
    assert.match(CARD_CODE, /<p aria-live="polite"/)
    // Deliberately two elements: role="alert" is implicitly assertive, so an
    // explicit polite value on the same node would muddle both announcements.
    assert.doesNotMatch(CARD_CODE, /role="alert"[^>]*aria-live/)
    // Every message is localized and derived from a confirmed outcome.
    assert.match(CARD_CODE, /const errorMessage = feedback\?\.tone === 'error' \? feedback\.message : null/)
    assert.match(CARD_CODE, /const successMessage = feedback\?\.tone === 'success' \? feedback\.message : null/)
    // A new operation clears the previous message first.
    assert.equal((CARD_CODE.match(/setFeedback\(null\)/g) ?? []).length, 3)
  })

  test('69-70. the email field is correctly typed, labelled, described and marked invalid', () => {
    assert.match(CARD_CODE, /aria-invalid=\{addInvalid \|\| undefined\}/)
    assert.match(CARD_CODE, /aria-describedby=\{addInvalid \? errorId : noteId\}/)
    // aria-invalid is scoped to an ADD error — a row failure must not mark it.
    assert.match(CARD_CODE, /const addInvalid = feedback\?\.tone === 'error' && feedback\.scope === 'add'/)
    assert.match(CARD_CODE, /autoComplete="email"/)
    // Visible labels, properly associated.
    assert.match(CARD_CODE, /<label htmlFor=\{emailId\} className="ui-label text-muted-fg">\{n\.emailLabel\}<\/label>/)
    assert.match(CARD_CODE, /<label htmlFor=\{labelId\}/)
    assert.match(CARD_CODE, /\{n\.labelLabel\} <span className="text-muted-fg">\{n\.optional\}<\/span>/)
    assert.equal((CARD_CODE.match(/id=\{emailId\}|id=\{labelId\}/g) ?? []).length, 2)
  })

  test('71-73. table headers are scoped, pending is announced, remove is named per recipient', () => {
    assert.equal((CARD_CODE.match(/<th scope="col"/g) ?? []).length, 4)
    assert.match(CARD_CODE, /aria-busy=\{busy \|\| undefined\}/)
    assert.match(CARD_CODE, /aria-busy=\{adding \|\| undefined\}/)
    // Pending is also visible text, not only a disabled attribute.
    assert.match(CARD_CODE, /\{adding \? n\.adding : n\.add\}/)
    assert.match(CARD_CODE, /\{busy \? n\.removing : n\.remove\}/)
    assert.match(CARD_CODE, /aria-label=\{`\$\{n\.removeFor\}: \$\{r\.email\}`\}/)
  })

  test('74-76. no colour-only meaning, no nested interactive control, no native dialog', () => {
    // Feedback carries its own text; the tone class is an addition, not the signal.
    assert.match(CARD_CODE, /className=\{errorMessage \? 'ui-meta text-negative' : undefined\}/)
    assert.match(CARD_CODE, /className=\{successMessage \? 'ui-meta text-positive' : undefined\}/)
    // Active state is exposed by aria-checked and by the thumb position.
    assert.match(SWITCH, /checked \? 'translate-x-\[12\.5px\]' : 'translate-x-0'/)
    // One control per cell — nothing is nested inside the Switch or ChipButton.
    assert.doesNotMatch(CARD_CODE, /<Switch[^/]*>[\s\S]*?<\/Switch>/)
    assert.doesNotMatch(CARD_CODE, /<ChipButton[^>]*>\s*<(button|a|input)\b/)
    assert.doesNotMatch(CARD_CODE, /window\.(alert|confirm|prompt)/)
  })
})

describe('R9.4 · responsive behaviour', () => {
  test('77. the add form has no unsafe fixed widths and fills narrow viewports', () => {
    // The legacy w-64 / w-48 inputs are gone.
    assert.doesNotMatch(CARD_CODE, /\bw-64\b|\bw-48\b|\bw-36\b|\bw-\[\d+px\]/)
    assert.match(CARD_CODE, /h-8 w-full rounded-\[var\(--radius-input\)\]/)
    // Each field grows from a basis and can shrink to nothing.
    assert.equal((CARD_CODE.match(/grow shrink basis-\[\d+px\] min-w-0/g) ?? []).length, 2)
    // The form itself wraps and is full-width until lg.
    assert.match(CARD_CODE, /className="flex flex-wrap items-end gap-2 w-full lg:w-auto"/)
    assert.match(CARD_CODE, /className="flex flex-col gap-2 w-full lg:w-auto"/)
  })

  test('78-80. the table has a real min-width floor, scrolling card-locally, and long text wraps', () => {
    assert.match(CARD_CODE, /minWidth=\{560\}/)
    assert.match(TABLE_CARD, /className="overflow-x-auto"/)
    assert.match(TABLE_CARD, /<div style=\{minWidth \? \{ minWidth \} : undefined\}>\{children\}<\/div>/)
    // No page-level overflow workaround was introduced.
    assert.doesNotMatch(CARD_CODE, /overflow-x-auto|overflow-x-scroll|min-w-\[/)
    // Long emails and long Spanish labels wrap instead of widening the page.
    assert.match(CARD_CODE, /font-mono break-all/)
    assert.match(CARD_CODE, /text-muted-fg break-words/)
  })

  test('81-83. the Switch touch inset cannot reach the Remove control', () => {
    // The primitive's invisible hit area extends 13px past its 30px track…
    assert.match(SWITCH, /before:-inset-\[13px\]/)
    // …so both control cells carry px-4 (17px at this app's 17px root), giving
    // ≥34px between the track edge and the Remove chip.
    assert.match(CARD_CODE, /<td className="py-3 px-4 text-center">/)
    assert.match(CARD_CODE, /<td className="py-3 px-4 text-right">/)
    // Row padding exceeds the 44px hit height, so vertical neighbours cannot
    // overlap either.
    assert.equal((CARD_CODE.match(/className="py-3 px-/g) ?? []).length, 4)
    // The anchor is not hidden behind page chrome after navigation.
    assert.match(CARD_CODE, /scroll-mt-6/)
  })
})

describe('R9.4 · preserved API, RLS and security contracts', () => {
  test('84-86. no service-role client, no user_profiles, no per-user recipient filtering', () => {
    assert.doesNotMatch(CARD, /supabase\/admin|getSupabaseAdminClient|SERVICE_ROLE|serviceRole/i)
    assert.doesNotMatch(CARD, /user_profiles|@\/lib\/db|notificationsRepository|@\/lib\/supabase/)
    assert.doesNotMatch(CARD_CODE, /process\.env/)
    // No ownership or user filter was introduced anywhere in the chain.
    assert.doesNotMatch(CARD_CODE, /user_id|userId|ownerId|\.filter\(\(r\) => r\.user/)
    assert.doesNotMatch(RECIPIENTS_ROUTE, /user_id|auth\.uid/)
  })

  test('87-91. the shared-trust RLS, the four endpoints, the types and the schema are untouched', () => {
    const migration = read('supabase/migrations/20260713000000_notifications_foundation.sql')
    for (const policy of ['select', 'insert', 'update', 'delete']) {
      assert.match(
        migration,
        new RegExp(`create policy "notification_recipients_${policy}" on notification_recipients for ${policy} (using|with check) \\(auth\\.uid\\(\\) is not null\\)`),
        `the shared-trust ${policy} policy must be unchanged`,
      )
    }
    // Exactly the pre-existing four handlers, no new route file.
    assert.equal((RECIPIENTS_ROUTE.match(/export async function (GET|POST|PATCH|DELETE)/g) ?? []).length, 2)
    assert.equal((RECIPIENT_ID_ROUTE.match(/export async function (GET|POST|PATCH|DELETE)/g) ?? []).length, 2)
    assert.equal(existsSync(join(ROOT, 'src/app/api/notification-recipients/[id]/[action]')), false)
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    assert.equal(migrations.filter((f) => /recipient|notification/i.test(f)).length, 1, 'no new notifications migration')
    assert.doesNotMatch(CARD_CODE, /database\.types|supabase\/migrations/)
  })

  test('92. the shared-trust explanatory note is preserved verbatim and still rendered', () => {
    for (const d of [dict.en, dict.es]) {
      assert.match(d.notifications.settings.note, /do not need to be registered app users|no necesitan ser usuarios registrados/)
    }
    assert.match(CARD_CODE, /<p id=\{noteId\} className="ui-meta text-muted-fg mt-1">\{n\.note\}<\/p>/)
    assert.doesNotMatch(CARD, /must be a registered/i)
  })
})

describe('R9.4 · scope and localization', () => {
  function leaves(obj: unknown, prefix = ''): [string, string][] {
    if (typeof obj === 'string') return [[prefix, obj]]
    if (obj && typeof obj === 'object') {
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
    }
    return []
  }

  test('93-96. privacy still absent; theme, language, Portfolio and Home untouched', () => {
    assert.doesNotMatch(`${CARD}\n${CLIENT}`, /usePrivacyMode|PrivacyToggle|PrivacyValue|privacyMasked/)
    for (const d of [dict.en, dict.es]) {
      assert.doesNotMatch(JSON.stringify(d.settings), /privacy|privacidad/i)
    }
    assert.doesNotMatch(CARD, /useTheme|useLang\(\)\.setLang|SegmentedControl/)
    assert.match(CARD, /import \{ useLang \} from '@\/components\/providers\/LangProvider'/)
    // No notification preference types, categories, schedules or test sends.
    assert.doesNotMatch(CARD_CODE, /categor|schedule|digest|frequency|sendTest|verify|verification/i)
    // Portfolio and Home carry no recipient concern.
    for (const f of ['src/app/portfolio/page.tsx', 'src/app/page.tsx']) {
      assert.doesNotMatch(read(f), /NotificationRecipientsCard|notification-recipients/)
    }
  })

  test('97-98. no mock recipient data and no fabricated column', () => {
    // Every row field comes from the API response — nothing invented. (The
    // scan targets fabricated FIELDS, not the word "role", which the feedback
    // region legitimately uses as an ARIA attribute.)
    assert.doesNotMatch(CARD_CODE, /lastSent|last_sent|deliveryStatus|verificationStatus|createdBy|r\.(owner|role|userName)/i)
    for (const invented of ['n.lastSent', 'n.owner', 'n.role', 'n.notificationType', 'n.deliveryStatus']) {
      assert.ok(!CARD_CODE.includes(invented), `must not render an invented ${invented} column`)
    }
    assert.doesNotMatch(CARD, /@example\.com|john@|jane@|sample recipient/i)
    // The only literal address is the input's format placeholder.
    assert.equal((CARD_CODE.match(/name@company\.com/g) ?? []).length, 1)
    // The rendered columns are exactly the four real ones.
    assert.match(CARD_CODE, /\{n\.emailLabel\}<\/th>/)
    assert.match(CARD_CODE, /\{n\.labelLabel\}<\/th>/)
    assert.match(CARD_CODE, /\{n\.activeLabel\}<\/th>/)
    assert.match(CARD_CODE, /\{n\.remove\}<\/th>/)
  })

  test('99-103. every key exists in both languages, parity holds, and nothing is hardcoded', () => {
    const required = [
      'optional', 'adding', 'removing', 'loadError', 'addSuccess', 'duplicateError',
      'updateSuccess', 'updateError', 'removeSuccess', 'removeError',
      'confirmRemoveTitle', 'cancel', 'activeFor', 'removeFor',
    ]
    for (const d of [dict.en, dict.es]) {
      for (const k of required) {
        const v = (d.notifications.settings as unknown as Record<string, string>)[k]
        assert.equal(typeof v, 'string', `notifications.settings.${k} must exist`)
        assert.ok(v.trim().length > 0)
      }
    }
    assert.deepEqual(
      leaves(dict.es.notifications).map(([k]) => k).sort(),
      leaves(dict.en.notifications).map(([k]) => k).sort(),
    )
    // Pre-existing keys survive untouched.
    assert.equal(dict.en.notifications.settings.add, 'Add')
    assert.equal(dict.es.notifications.settings.add, 'Agregar')
    assert.equal(dict.en.notifications.settings.invalidEmail, 'Enter a valid email address')
    assert.equal(dict.en.notifications.settings.tag, 'Notification Settings')
    assert.equal(dict.en.notifications.manageRecipients, 'Manage email recipients →')
    // No hardcoded visible copy in the component.
    const literals = new Set<string>()
    for (const m of CARD_CODE.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) literals.add((m[1] ?? m[2]).trim())
    for (const m of CARD_CODE.matchAll(/>([^<>{}]+)</g)) literals.add(m[1].trim())
    for (const d of [dict.en, dict.es]) {
      for (const [path, value] of leaves(d.notifications.settings)) {
        assert.ok(!literals.has(value), `the card hardcodes notifications.settings.${path} instead of reading it`)
      }
    }
    assert.match(CARD_CODE, /const n = t\.notifications\.settings/)
  })
})

// ── R9.5 · final consolidation audit ────────────────────────────────────────
// R9.0–R9.4 each guarded its own slice. These assert the properties that only
// exist once the five phases are read as ONE surface, plus the two defects the
// audit demonstrated and repaired.

describe('R9.5 · the surface is one integrated product', () => {
  test('1-8. exactly one canonical Settings page — no sidebar, tabs, subpage or fabricated control', () => {
    // The settings tree is exactly the canonical page, its client composition,
    // the recipients card, and the preserved redirect. Nothing else.
    const files = readdirSync(join(ROOT, 'src/app/settings'), { withFileTypes: true })
    assert.deepEqual(
      files.map((f) => f.name).sort(),
      ['NotificationRecipientsCard.tsx', 'SettingsClient.tsx', 'notifications', 'page.tsx'].sort(),
    )
    assert.deepEqual(readdirSync(join(ROOT, 'src/app/settings/notifications')), ['page.tsx'])

    const surface = `${PAGE_CODE}\n${CLIENT_CODE}\n${CARD_CODE}`
    // No secondary navigation model was invented inside the page.
    assert.doesNotMatch(surface, /role="tab"|role="tablist"|aria-selected|<Sidebar|SettingsNav|settingsTabs/)
    // Immediate-save only: no form-level commit or revert affordance anywhere.
    // (`cancelLabel` is the destructive dialog's safe exit, not a page control.)
    assert.doesNotMatch(surface, /n\.save|s\.save|onSave|handleSave|isDirty|unsavedChanges|pendingChanges|>Save<|>Apply<|>Reset<|>Discard</i)
    // No disabled or "coming soon" placeholder control.
    assert.doesNotMatch(surface, /comingSoon|coming soon|próximamente|placeholder control|disabled aria-label/i)
  })

  test('9. the three approved rows are present, in order, each with its own Reveal', () => {
    const rows = ['s.account.title', 's.sources.title', 's.security.title', 's.display.title']
    let cursor = -1
    for (const key of rows) {
      const at = CLIENT_CODE.indexOf(key)
      assert.ok(at > cursor, `${key} must appear after the previous card`)
      cursor = at
    }
    // Row 3 is the recipients card, last.
    assert.ok(CLIENT_CODE.indexOf('<NotificationRecipientsCard') > cursor)
    // Exactly three staggered reveals — one per row, cadence preserved.
    assert.equal((CLIENT_CODE.match(/<Reveal /g) ?? []).length, 3)
    for (const ms of [70, 130, 190]) assert.match(CLIENT_CODE, new RegExp(`delayMs=\\{${ms}\\}`))
  })

  test('45-46. exactly one h1 for the whole surface, and only h2 below it', () => {
    const surface = `${PAGE_CODE}\n${CLIENT_CODE}\n${CARD_CODE}`
    // The page composition declares no heading of its own — PageHeader owns the h1.
    assert.doesNotMatch(surface, /<h1[\s>]/)
    assert.match(code(PAGE_HEADER), /<h1[\s>]/)
    assert.equal((CLIENT_CODE.match(/<PageHeader\b/g) ?? []).length, 1)
    // Card titles are real subordinate headings, not styled spans.
    assert.match(CLIENT_CODE, /<h2 className="ui-label text-muted-fg">\{children\}<\/h2>/)
    assert.match(code(TABLE_CARD), /<h2 className="ui-label text-muted-fg">\{title\}<\/h2>/)
    // No level is skipped by anything this surface renders.
    assert.doesNotMatch(surface, /<h[3-6][\s>]/)
  })

  test('the `#notifications` anchor cannot be covered by fixed navigation', () => {
    // The shell scrolls <main>; TopBar and SecondaryNav are flex siblings ABOVE
    // it, not fixed/sticky overlays, so an in-page anchor can never land under
    // the chrome. Locked here because a later `sticky` on either would break it.
    assert.match(code(APP_SHELL), /<main className="flex-1 overflow-y-auto/)
    for (const [name, src] of [['TopBar', TOP_BAR], ['SecondaryNav', SECONDARY_NAV]] as const) {
      assert.doesNotMatch(code(src), /\b(fixed|sticky)\s/, `${name} must not overlay the scroll container`)
    }
    assert.match(CARD_CODE, /id="notifications"[^>]*className="[^"]*scroll-mt-/)
  })
})

describe('R9.5 · focus is never lost after a confirmed removal', () => {
  test('the section is programmatically focusable without joining the tab order', () => {
    assert.match(CARD_CODE, /const sectionRef = useRef<HTMLElement>\(null\)/)
    assert.match(CARD_CODE, /<section ref=\{sectionRef\} tabIndex=\{-1\} id="notifications"/)
    // -1 only: the section must never become a tab stop of its own.
    assert.doesNotMatch(CARD_CODE, /tabIndex=\{0\}|tabIndex="0"/)
  })

  test('focus moves ONLY after the server confirmed the delete', () => {
    // One increment, on the success path: after the res.ok throw and before the catch.
    assert.equal((CARD_CODE.match(/setRemovedSeq\(/g) ?? []).length, 1)
    const confirm = CARD_CODE.slice(CARD_CODE.indexOf('async function confirmRemove'))
    const okThrow = confirm.indexOf("throw new Error('delete_failed')")
    const bump = confirm.indexOf('setRemovedSeq(')
    const catchAt = confirm.indexOf('} catch {')
    assert.ok(okThrow > -1 && bump > okThrow, 'focus must not move before the response is confirmed')
    assert.ok(bump < catchAt, 'a failed delete must not move focus — its row still exists')
    // The rollback/failure path never touches focus.
    const failure = confirm.slice(catchAt, confirm.indexOf('} finally {'))
    assert.doesNotMatch(failure, /setRemovedSeq|\.focus\(/)
  })

  test('the effect is guarded so a fresh mount never steals focus', () => {
    assert.match(CARD_CODE, /if \(removedSeq === 0\) return\s*\n\s*sectionRef\.current\?\.focus\(\)/)
    assert.match(CARD_CODE, /\}, \[removedSeq\]\)/)
    // The card manages exactly this one focus move and nothing else.
    assert.equal((CARD_CODE.match(/\.focus\(\)/g) ?? []).length, 1)
    assert.doesNotMatch(CARD_CODE, /document\.activeElement|autoFocus/)
  })

  test('the shared dialog contract is unchanged — it still owns cancel, Escape and failure', () => {
    const modal = code(MODAL)
    assert.match(modal, /triggerRef\.current = document\.activeElement/)
    assert.match(modal, /if \(wasOpenRef\.current && !open\) \(triggerRef\.current as HTMLElement \| null\)\?\.focus\?\.\(\)/)
    assert.match(modal, /document\.body\.style\.overflow = 'hidden'/)
    assert.match(modal, /useEscape\(open && canDismiss, onClose\)/)
    assert.match(modal, /role=\{role\}[\s\S]{0,80}aria-modal="true"/)
    // The repair lives in the caller — no primitive was modified to achieve it.
    assert.doesNotMatch(modal, /removedSeq|sectionRef|notification|recipient/i)
  })
})

describe('R9.5 · the destructive target survives a 320px viewport', () => {
  test('the dialog still names the recipient, and the name can wrap', () => {
    const desc = CARD_CODE.slice(CARD_CODE.indexOf('<DestructiveConfirm'))
    // Both real fields still identify the target — no information was traded away.
    assert.match(desc, /<span className="break-all">\{confirming\.email\}<\/span>/)
    assert.match(desc, /confirming\.label \? <span className="break-words"> · \{confirming\.label\}<\/span> : null/)
    // Still honest: only fields the API actually returns.
    assert.doesNotMatch(desc, /lastSent|owner|role|createdBy/i)
  })

  test('the same value wraps the same way in the table cell', () => {
    assert.match(CARD_CODE, /<td className="py-3 px-4 font-mono break-all text-foreground">\{r\.email\}<\/td>/)
    assert.match(CARD_CODE, /<td className="py-3 px-3 text-muted-fg break-words">\{r\.label \?\? '—'\}<\/td>/)
  })

  test('the dialog clips rather than scrolls, which is why wrapping is required', () => {
    // Documents the constraint the repair answers: if this ever becomes a
    // scrolling surface the wrap is still correct, but the reason changes.
    const modal = code(MODAL)
    assert.match(modal, /'nv-pop relative w-full flex flex-col overflow-hidden max-h-\[85vh\]'/)
    assert.match(modal, /max-w-sm/)
    assert.match(modal, /px-4/, 'the dialog keeps a viewport gutter at narrow widths')
  })
})

describe('R9.5 · regression control', () => {
  test('no repair leaked into a primitive, an API, auth or the bell', () => {
    for (const [name, src] of [
      ['Switch', SWITCH], ['SegmentedControl', SEGMENTED], ['TableCard', TABLE_CARD],
      ['ThemeToggle', THEME_TOGGLE], ['LangToggle', LANG_TOGGLE], ['LangProvider', LANG_PROVIDER],
      ['useTheme', THEME_STORE], ['layout', LAYOUT],
    ] as const) {
      assert.doesNotMatch(code(src), /R9\.5|removedSeq|sectionRef/, `${name} must not be touched by the audit`)
    }
    // The bell still points at the integrated section and nothing else moved.
    assert.match(BELL, /href="\/settings#notifications"/)
    assert.equal((BELL.match(/href="\/settings/g) ?? []).length, 1)
    assert.match(BELL, /const POLL_MS = 60_000/)
    // The preserved redirect is still exactly one statement.
    assert.match(code(NOTIF_PAGE), /redirect\('\/settings#notifications'\)/)
    assert.doesNotMatch(code(NOTIF_PAGE), /useState|fetch\(|<form|<table/)
  })

  test('the four recipient endpoints, payloads and the shared-trust model are unchanged', () => {
    assert.equal((CARD_CODE.match(/const ENDPOINT = '\/api\/notification-recipients'/g) ?? []).length, 1)
    assert.match(CARD_CODE, /method: 'POST'[\s\S]{0,160}JSON\.stringify\(\{ email: trimmedEmail, label: label\.trim\(\) \|\| undefined \}\)/)
    assert.match(CARD_CODE, /`\$\{ENDPOINT\}\/\$\{r\.id\}`[\s\S]{0,80}method: 'PATCH'[\s\S]{0,120}JSON\.stringify\(\{ active: next \}\)/)
    assert.match(CARD_CODE, /`\$\{ENDPOINT\}\/\$\{target\.id\}`, \{ method: 'DELETE' \}/)
    // No ownership, per-user filtering or client-side authorization crept in.
    assert.doesNotMatch(CARD_CODE, /user_id|userId|owner_id|process\.env|service_role|createAdminClient/)
    // Both routes stay private under default-deny.
    for (const p of ['/settings', '/settings/notifications', '/api/notification-recipients']) {
      assert.ok(requiresApprovedSession(p), `${p} must remain private`)
    }
    assert.equal(classifyPath('/settings'), 'private_page')
    assert.equal(classifyPath('/settings/notifications'), 'private_page')
    assert.equal(classifyPath('/api/notification-recipients'), 'private_api')
  })

  test('Privacy Mode is still deferred to R9.6 across the whole surface', () => {
    const surface = `${PAGE_CODE}\n${CLIENT_CODE}\n${CARD_CODE}`
    assert.doesNotMatch(surface, /usePrivacyMode|PrivacyToggle|PrivacyValue|privacyMasked|maskBalances|hideNotional/i)
    for (const d of [dict.en, dict.es]) {
      assert.doesNotMatch(JSON.stringify(d.settings), /privacy|privacidad|mask|ocultar valores/i)
    }
    // Portfolio and Home remain untouched by this phase.
    for (const f of ['src/app/portfolio/page.tsx', 'src/app/page.tsx']) {
      assert.doesNotMatch(read(f), /R9\.5|NotificationRecipientsCard|usePrivacyMode/)
    }
  })
})
