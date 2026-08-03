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
    assert.equal((CLIENT_CODE.match(/<GlassSurface as="section"/g) ?? []).length, 3)
    assert.equal((CLIENT_CODE.match(/<Reveal delayMs=/g) ?? []).length, 2)
    assert.match(CLIENT_CODE, /<Reveal delayMs=\{70\}>/)
    assert.match(CLIENT_CODE, /<Reveal delayMs=\{130\}>/)
  })

  test('6-8. exactly the three R9.2 cards render: Account, Data sources, Security', () => {
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.account\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.sources\.title\}<\/CardTitle>/)
    assert.match(CLIENT_CODE, /<CardTitle>\{s\.security\.title\}<\/CardTitle>/)
    assert.equal((CLIENT_CODE.match(/<CardTitle>/g) ?? []).length, 3)
  })

  test('9-11. no Display controls, no Notification Recipients card, no placeholder card', () => {
    // R9.3 owns Display; R9.4 owns recipients; R9.6 owns privacy. Nothing may
    // be stubbed early. (`displayName` is an account FIELD, not a Display card,
    // so this scans for the actual controls rather than the substring.)
    assert.doesNotMatch(CLIENT_CODE, /ThemeToggle|LangToggle|SegmentedControl|<Switch\b|role="switch"/)
    assert.doesNotMatch(CLIENT_CODE, /s\.display|settings\.display|appearance|apariencia/i)
    assert.equal('display' in (dict.en.settings as unknown as Record<string, unknown>), false)
    assert.doesNotMatch(CLIENT_CODE, /recipient|notification-recipients|destinatario/i)
    assert.doesNotMatch(CLIENT_CODE, /placeholder|TODO|Coming soon|comingSoon|pr[óo]ximamente/i)
    // Card count already pinned at 3 above — an empty fourth card cannot exist.
  })

  test('12. Fable card proportions and responsive wrapping are reproduced', () => {
    // Row 1 — Fable `flex:1.6 1 420px; min-width:min(100%,330px)` beside
    // `flex:1 1 300px; min-width:min(100%,280px)`, 14px gap, wrapping.
    assert.match(CLIENT_CODE, /flex flex-wrap items-stretch gap-\[14px\]/)
    assert.match(CLIENT_CODE, /grow-\[1\.6\] shrink basis-\[420px\] min-w-\[min\(100%,330px\)\]/)
    assert.match(CLIENT_CODE, /grow shrink basis-\[300px\] min-w-\[min\(100%,280px\)\]/)
    // Row 2 — Security, full width, same 14px rhythm.
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
    assert.doesNotMatch(CLIENT_CODE, /onSubmit|onChange/)
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
  test('53-56. no Switch, theme, language-preference, or privacy import', () => {
    assert.doesNotMatch(BOTH, /fable\/Switch|<Switch\b|role="switch"/)
    assert.doesNotMatch(BOTH, /useTheme|usePrivacyMode|usePersistentState|localStorage/)
    // useLang is consumed for translation only — no setLang control.
    assert.match(CLIENT, /import \{ useLang \} from '@\/components\/providers\/LangProvider'/)
    assert.doesNotMatch(CLIENT_CODE, /setLang|lang ===|LangToggle|ThemeToggle/)
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
