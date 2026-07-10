// Platform notifications repository.
//
// Two write contexts, same as structured_note_monitoring_runs (Phase 9D):
//   - createNotification() is called from a server/cron context via the
//     service-role admin client (no user session exists for a scheduled job;
//     RLS has no insert policy for the anon-key client at all).
//   - Everything else (listing, marking read, managing recipients) is called
//     from authenticated route handlers via the user-session client.
// Per the established pattern, user-scoped rows never have user_id set
// explicitly in an insert — the column default (auth.uid()) and RLS establish
// ownership. New tables exceed safe TS inference depth (see watchlistRepository
// precedent), so queries go through the same `q(client)` escape hatch.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  NotificationRow as DbNotification,
  NotificationRecipientRow as DbRecipient,
} from '../../supabase/database.types.ts'
import type { PlatformNotification, NotificationRecipient, NewNotification } from '../../notifications/types.ts'

type Client = SupabaseClient<Database>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any
function q(client: Client): { from: (table: string) => AnyQuery } {
  return client as unknown as { from: (table: string) => AnyQuery }
}

function sanitize(msg: string | undefined): string {
  if (!msg) return 'database error'
  return msg.replace(/eyJ[A-Za-z0-9_.\-]{20,}/g, '***').slice(0, 200)
}

function mapNotification(r: DbNotification, readIds: Set<string>): PlatformNotification {
  return {
    id: r.id,
    notificationType: r.notification_type,
    title: r.title,
    body: r.body,
    linkUrl: r.link_url,
    relatedEntityType: r.related_entity_type,
    relatedEntityId: r.related_entity_id,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    isRead: readIds.has(r.id),
  }
}

function mapRecipient(r: DbRecipient): NotificationRecipient {
  return { id: r.id, email: r.email, label: r.label, active: r.active, createdAt: r.created_at, updatedAt: r.updated_at }
}

/** Creates a shared notification. Called with the admin client from a cron/server context — there is no user-facing write path (see the migration's RLS: no insert policy for the anon-key client). */
export async function createNotification(client: Client, input: NewNotification): Promise<{ ok: boolean; id?: string; error?: string }> {
  const res = await q(client)
    .from('notifications')
    .insert({
      notification_type: input.notificationType,
      title: input.title,
      body: input.body ?? null,
      link_url: input.linkUrl ?? null,
      related_entity_type: input.relatedEntityType ?? null,
      related_entity_id: input.relatedEntityId ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()
  if (res.error) return { ok: false, error: sanitize(res.error.message) }
  return { ok: true, id: res.data?.id }
}

/** Lists notifications newest-first, with isRead computed for the given user. limit defaults to 50 (a bell dropdown, not a full archive browser). */
export async function listNotifications(client: Client, userId: string, limit = 50): Promise<PlatformNotification[]> {
  const [notifRes, readsRes] = await Promise.all([
    q(client).from('notifications').select('*').order('created_at', { ascending: false }).limit(limit),
    q(client).from('notification_reads').select('notification_id').eq('user_id', userId),
  ])
  if (notifRes.error) return []
  const readIds = new Set<string>((readsRes.data ?? []).map((r: { notification_id: string }) => r.notification_id))
  return (notifRes.data ?? []).map((r: DbNotification) => mapNotification(r, readIds))
}

/** Unread count for the given user — same read-state diff as listNotifications, without fetching full rows (used for the bell badge, polled more often than the full list). */
export async function getUnreadNotificationCount(client: Client, userId: string): Promise<number> {
  const [totalRes, readsRes] = await Promise.all([
    q(client).from('notifications').select('id', { count: 'exact', head: true }),
    q(client).from('notification_reads').select('notification_id').eq('user_id', userId),
  ])
  const total = totalRes.count ?? 0
  const readCount = (readsRes.data ?? []).length
  return Math.max(0, total - readCount)
}

/** Marks one notification read for the given user. Idempotent (upsert) — reading twice is a no-op, not an error. */
export async function markNotificationRead(client: Client, notificationId: string, userId: string): Promise<boolean> {
  const res = await q(client)
    .from('notification_reads')
    .upsert({ notification_id: notificationId, user_id: userId }, { onConflict: 'notification_id,user_id' })
  return !res.error
}

/** Marks every currently-visible notification read for the given user in one round trip. */
export async function markAllNotificationsRead(client: Client, userId: string, notificationIds: string[]): Promise<boolean> {
  if (notificationIds.length === 0) return true
  const rows = notificationIds.map((id) => ({ notification_id: id, user_id: userId }))
  const res = await q(client).from('notification_reads').upsert(rows, { onConflict: 'notification_id,user_id' })
  return !res.error
}

// ─── Recipients (email distribution list, editable at /settings/notifications) ─

export async function listNotificationRecipients(client: Client): Promise<NotificationRecipient[]> {
  const res = await q(client).from('notification_recipients').select('*').order('created_at', { ascending: true })
  if (res.error) return []
  return (res.data ?? []).map(mapRecipient)
}

/** Active recipient emails only — what the email-sending step should actually use. */
export async function getActiveNotificationRecipientEmails(client: Client): Promise<string[]> {
  const res = await q(client).from('notification_recipients').select('email').eq('active', true)
  if (res.error) return []
  return (res.data ?? []).map((r: { email: string }) => r.email)
}

export async function addNotificationRecipient(client: Client, email: string, label: string | null): Promise<{ ok: boolean; error?: string }> {
  const res = await q(client).from('notification_recipients').insert({ email: email.trim(), label: label?.trim() || null })
  if (res.error) return { ok: false, error: sanitize(res.error.message) }
  return { ok: true }
}

export async function updateNotificationRecipient(
  client: Client,
  id: string,
  patch: Partial<Pick<NotificationRecipient, 'email' | 'label' | 'active'>>,
): Promise<{ ok: boolean; error?: string }> {
  const dbPatch: Record<string, unknown> = {}
  if (patch.email !== undefined) dbPatch.email = patch.email.trim()
  if (patch.label !== undefined) dbPatch.label = patch.label?.trim() || null
  if (patch.active !== undefined) dbPatch.active = patch.active
  if (Object.keys(dbPatch).length === 0) return { ok: true }
  const res = await q(client).from('notification_recipients').update(dbPatch).eq('id', id)
  if (res.error) return { ok: false, error: sanitize(res.error.message) }
  return { ok: true }
}

export async function deleteNotificationRecipient(client: Client, id: string): Promise<boolean> {
  const res = await q(client).from('notification_recipients').delete().eq('id', id)
  return !res.error
}
