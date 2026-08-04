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

/** Comment-stripped, so prose can neither satisfy nor trip a scan. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const PAGE_CODE = code(PAGE)
const CLIENT_CODE = code(CLIENT)
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
    // R9.3 added a fourth card INSIDE the existing second-row Reveal, so the
    // staggered cadence is still exactly two reveals.
    assert.equal((CLIENT_CODE.match(/<Reveal delayMs=/g) ?? []).length, 2)
    assert.match(CLIENT_CODE, /<Reveal delayMs=\{70\}>/)
    assert.match(CLIENT_CODE, /<Reveal delayMs=\{130\}>/)
  })

  test('6-8. exactly the four cards render: Account, Data sources, Security, Display', () => {
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.account\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.sources\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.security\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.display\.title\}<\/CardTitle>/)
    assert.equal((CLIENT_CODE.match(/<CardTitle>/g) ?? []).length, 4)
  })

  test('9-11. no Notification Recipients card, no placeholder card, no early privacy stub', () => {
    // R9.3 owns Display (its own describe below). R9.4 owns recipients and
    // R9.6 owns privacy — neither may be stubbed early.
    assert.doesNotMatch(CLIENT_CODE, /ThemeToggle|LangToggle|<Switch\b|role="switch"/)
    // The card is "Display", never a second "Appearance" concept.
    assert.doesNotMatch(CLIENT_CODE, /appearance|apariencia/i)
    assert.doesNotMatch(CLIENT_CODE, /recipient|notification-recipients|destinatario/i)
    assert.doesNotMatch(CLIENT_CODE, /placeholder|TODO|Coming soon|comingSoon|pr[óo]ximamente/i)
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

  test('15. /settings/notifications still exists and is untouched by R9.2', () => {
    assert.ok(existsSync(join(ROOT, 'src/app/settings/notifications/page.tsx')))
    for (const marker of ['handleAdd', 'async function remove', 'toggleActive', 'SectionHeader']) {
      assert.ok(NOTIF_PAGE.includes(marker), `notifications page must still contain ${marker}`)
    }
    for (const call of ["'/api/notification-recipients'", '`/api/notification-recipients/${r.id}`', '`/api/notification-recipients/${id}`']) {
      assert.ok(NOTIF_PAGE.includes(call), `notifications page must still call ${call}`)
    }
    // R9.4 owns the redirect — it must not exist yet.
    assert.doesNotMatch(NOTIF_PAGE, /redirect\(/)
  })

  test('16. the NotificationBell href is unchanged pending R9.4', () => {
    assert.ok(BELL.includes('/settings/notifications'))
    assert.doesNotMatch(BELL, /\/settings#notifications/)
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

  test('57-58. no notification-recipient call, and the existing page is byte-compatible', () => {
    assert.doesNotMatch(BOTH, /notification-recipients|notificationsRepository/)
    // The R9.4 sequencing hold: the notifications page still owns its own flow.
    assert.match(NOTIF_PAGE, /export default function NotificationSettingsPage\(\)/)
    assert.match(NOTIF_PAGE, /t\.notifications\.settings\.note/)
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

  test('40-43. recipients stay in R9.4 — no card, no redirect, no bell repoint, no API call', () => {
    assert.doesNotMatch(BOTH, /notification-recipients|notificationsRepository|recipient/i)
    assert.match(NOTIF_PAGE, /export default function NotificationSettingsPage\(\)/)
    for (const marker of ['handleAdd', 'async function remove', 'toggleActive']) {
      assert.ok(NOTIF_PAGE.includes(marker), `notifications page must still contain ${marker}`)
    }
    assert.doesNotMatch(NOTIF_PAGE, /redirect\(/)
    assert.ok(BELL.includes('/settings/notifications'))
    assert.doesNotMatch(BELL, /\/settings#notifications/)
    assert.equal((CLIENT_CODE.match(/fetch\(/g) ?? []).length, 1)
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
