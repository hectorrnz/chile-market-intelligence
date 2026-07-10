// Platform notifications — migration/RLS/route hygiene checks (grep-based, no
// network/Supabase), plus unit tests for the email provider's pure logic.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const MIGRATION = read('../supabase/migrations/20260713000000_notifications_foundation.sql')
const REPOSITORY = read('../src/lib/db/repositories/notificationsRepository.ts')
const EMAIL_PROVIDER = read('../src/lib/notifications/emailProvider.ts')
const CRON_ROUTE = read('../src/app/api/cron/structured-notes/snapshot/route.ts')
const NOTIF_ROUTE = read('../src/app/api/notifications/route.ts')
const READ_ROUTE = read('../src/app/api/notifications/[id]/read/route.ts')
const READ_ALL_ROUTE = read('../src/app/api/notifications/read-all/route.ts')
const RECIPIENTS_ROUTE = read('../src/app/api/notification-recipients/route.ts')
const RECIPIENT_ID_ROUTE = read('../src/app/api/notification-recipients/[id]/route.ts')
const MIDDLEWARE = read('../src/middleware.ts')
const BELL = read('../src/components/ui/NotificationBell.tsx')
const SETTINGS_PAGE = read('../src/app/settings/notifications/page.tsx')
const ENV_EXAMPLE = read('../.env.example')

describe('migration hygiene', () => {
  it('creates notifications, notification_reads, notification_recipients', () => {
    assert.ok(MIGRATION.includes('create table if not exists notifications'))
    assert.ok(MIGRATION.includes('create table if not exists notification_reads'))
    assert.ok(MIGRATION.includes('create table if not exists notification_recipients'))
  })
  it('notifications has no insert/update/delete policy — writes are service-role only', () => {
    assert.ok(MIGRATION.includes('"notifications_select"'))
    assert.ok(!MIGRATION.includes('"notifications_insert"'))
    assert.ok(!MIGRATION.includes('"notifications_update"'))
    assert.ok(!MIGRATION.includes('"notifications_delete"'))
  })
  it('notification_reads is per-user (auth.uid() = user_id) for select/insert/delete', () => {
    const block = MIGRATION.slice(MIGRATION.indexOf('notification_reads_select'), MIGRATION.indexOf('notification_recipients ('))
    assert.ok(block.includes('auth.uid() = user_id'))
    assert.ok(MIGRATION.includes('notification_reads_insert'))
    assert.ok(MIGRATION.includes('notification_reads_delete'))
  })
  it('notification_recipients allows any authenticated user full CRUD (shared-trust model, matches Phase 9B)', () => {
    const block = MIGRATION.slice(MIGRATION.indexOf('notification_recipients_select'))
    assert.ok(block.includes('auth.uid() is not null'))
    assert.ok(MIGRATION.includes('notification_recipients_insert'))
    assert.ok(MIGRATION.includes('notification_recipients_update'))
    assert.ok(MIGRATION.includes('notification_recipients_delete'))
  })
  it('email column is citext (case-insensitive unique) and citext extension is (re)enabled defensively', () => {
    assert.ok(MIGRATION.includes('email       citext not null unique'))
    assert.ok(MIGRATION.includes('create extension if not exists citext'))
  })
})

describe('repository — user_id never set explicitly on insert (RLS/default establishes ownership)', () => {
  it('markNotificationRead/markAllNotificationsRead pass user_id as a value, never construct it', () => {
    assert.ok(REPOSITORY.includes("notification_id: notificationId, user_id: userId"))
  })
  it('createNotification never sets a user_id column (shared feed, not user-owned)', () => {
    const fnBody = REPOSITORY.slice(REPOSITORY.indexOf('export async function createNotification'), REPOSITORY.indexOf('export async function listNotifications'))
    assert.ok(!fnBody.includes('user_id'))
  })
  it('sanitize() redacts JWT-shaped tokens from error messages', () => {
    assert.ok(REPOSITORY.includes('eyJ[A-Za-z0-9_.\\-]{20,}'))
  })
})

describe('email provider — configuration and no-op behavior', () => {
  it('never throws when RESEND_API_KEY is unset — reports configured:false instead', async () => {
    const original = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      const { sendNotificationEmail, isEmailConfigured } = await import('../src/lib/notifications/emailProvider.ts')
      assert.equal(isEmailConfigured(), false)
      const result = await sendNotificationEmail(['a@b.com'], 'subject', '<p>hi</p>')
      assert.deepEqual(result, { ok: false, configured: false, sent: [], failed: [] })
    } finally {
      if (original !== undefined) process.env.RESEND_API_KEY = original
    }
  })

  it('returns early with an empty result when there are no recipients, even if configured', async () => {
    const original = process.env.RESEND_API_KEY
    process.env.RESEND_API_KEY = 'test-key'
    try {
      const { sendNotificationEmail } = await import('../src/lib/notifications/emailProvider.ts')
      const result = await sendNotificationEmail([], 'subject', '<p>hi</p>')
      assert.deepEqual(result, { ok: true, configured: true, sent: [], failed: [] })
    } finally {
      if (original !== undefined) process.env.RESEND_API_KEY = original
      else delete process.env.RESEND_API_KEY
    }
  })

  it('never imports a resend SDK — uses fetch against the documented HTTP endpoint only', () => {
    assert.ok(!EMAIL_PROVIDER.includes("from 'resend'"))
    assert.ok(EMAIL_PROVIDER.includes('https://api.resend.com/emails'))
  })

  it('reads the API key only from process.env (server-only, never NEXT_PUBLIC)', () => {
    assert.ok(!/NEXT_PUBLIC.*RESEND/.test(EMAIL_PROVIDER))
  })
})

describe('cron route — notifies + emails on autocall (structured_note_called)', () => {
  it('creates a notification only when the note actually transitions to autocalled', () => {
    const idx = CRON_ROUTE.indexOf("statusUpdate.newStatus === 'autocalled'")
    assert.ok(idx >= 0)
  })
  it('uses the admin client for createNotification (cron has no user session)', () => {
    assert.ok(CRON_ROUTE.includes('createNotification'))
    assert.ok(CRON_ROUTE.includes('getActiveNotificationRecipientEmails'))
  })
  it('email delivery failures never fail the whole monitoring run (best-effort, swallowed)', () => {
    const idx = CRON_ROUTE.indexOf('async function notifyStructuredNoteCalled')
    const body = CRON_ROUTE.slice(idx, idx + 1200)
    assert.ok(body.includes('try {'))
    assert.ok(body.includes('} catch {'))
  })
  it('the email/notification includes a direct link to the note', () => {
    assert.ok(CRON_ROUTE.includes('/structured-notes/${note.id}'))
  })
})

describe('API routes — auth-scoped, no admin client leakage', () => {
  it('GET /api/notifications uses the user-session client and requires a signed-in user', () => {
    assert.ok(NOTIF_ROUTE.includes('getSupabaseUserClient'))
    assert.ok(!NOTIF_ROUTE.includes('getSupabaseAdminClient'))
    assert.ok(NOTIF_ROUTE.includes('requireCurrentUser'))
  })
  it('mark-as-read routes scope the update to the current user id, not an arbitrary body field', () => {
    assert.ok(READ_ROUTE.includes('markNotificationRead(client, id, user.id)'))
    assert.ok(READ_ALL_ROUTE.includes('markAllNotificationsRead(client, user.id'))
  })
  it('recipients routes validate email format before insert/update', () => {
    assert.ok(RECIPIENTS_ROUTE.includes('isValidEmail'))
    assert.ok(RECIPIENT_ID_ROUTE.includes('isValidEmail'))
  })
})

describe('middleware — new routes are auth-gated', () => {
  it('protects /settings pages and /api/notifications, /api/notification-recipients', () => {
    assert.ok(MIDDLEWARE.includes("'/settings'"))
    assert.ok(MIDDLEWARE.includes("'/api/notifications'"))
    assert.ok(MIDDLEWARE.includes("'/api/notification-recipients'"))
  })
  it('does not touch the cron route auth (its own Bearer CRON_SECRET, unaffected)', () => {
    assert.ok(!MIDDLEWARE.includes('/api/cron/structured-notes'))
  })
})

describe('NotificationBell UI', () => {
  it('only renders for signed-in users', () => {
    assert.ok(BELL.includes('if (!signedIn) return null'))
  })
  it('polls the feed via an inline fetch, not a memoized callback invoked synchronously in the effect (set-state-in-effect lint rule)', () => {
    const idx = BELL.indexOf('useEffect(() => {\n    if (!signedIn) return')
    assert.ok(idx >= 0)
    const body = BELL.slice(idx, idx + 700)
    assert.ok(body.includes('.then((json) => {'))
    assert.ok(!body.includes('void load()'))
  })
  it('shows a red unread-count badge only when unreadCount > 0', () => {
    assert.ok(BELL.includes('unreadCount > 0 && ('))
    assert.ok(BELL.includes("backgroundColor: 'var(--negative)'"))
  })
  it('links to the recipients settings page', () => {
    assert.ok(BELL.includes('/settings/notifications'))
  })
})

describe('Settings page — recipient management is editable (add/remove/toggle active)', () => {
  it('supports add, remove, and active toggle', () => {
    assert.ok(SETTINGS_PAGE.includes('handleAdd'))
    assert.ok(SETTINGS_PAGE.includes('async function remove'))
    assert.ok(SETTINGS_PAGE.includes('toggleActive'))
  })
  it('never claims a recipient must be a registered app user', () => {
    assert.ok(!/must be a registered/i.test(SETTINGS_PAGE))
  })
})

describe('env template documents Resend config as server-only, optional', () => {
  it('RESEND_API_KEY and NOTIFICATION_EMAIL_FROM are documented, never NEXT_PUBLIC', () => {
    assert.ok(ENV_EXAMPLE.includes('RESEND_API_KEY='))
    assert.ok(ENV_EXAMPLE.includes('NOTIFICATION_EMAIL_FROM='))
    assert.ok(!ENV_EXAMPLE.includes('NEXT_PUBLIC_RESEND'))
  })
})

describe('i18n — notifications keys present in both languages', () => {
  it('has one notifications: block per language with bell/panel/settings keys', () => {
    const src = read('../src/lib/i18n.ts')
    const count = (src.match(/notifications:\s*\{/g) ?? []).length
    assert.equal(count, 2, 'expected one notifications block in dict.en and one in dict.es')
    assert.ok(src.includes('bellLabel:'))
    assert.ok(src.includes('manageRecipients:'))
  })
})
