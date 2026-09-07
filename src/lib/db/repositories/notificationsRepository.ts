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

// ─── R13.7B3.2 · Historical-correction notifications ─────────────────────────
//
// A deliberately separate pair of functions from `createNotification` above, for
// one reason: this path must be idempotent, and it must be visibly impossible
// for it to email. Neither function below touches `notification_recipients` or
// any mail transport, and the writer's input type carries no address field.

/**
 * The `correctionKey` values already recorded for one reconciliation operation.
 *
 * Read before writing so a retry can report what it is skipping and create only
 * what is genuinely missing. The unique index added by 20260820000000 remains
 * the hard guarantee — this read is the readable half, not the enforcement, and
 * a row that appears between this read and the insert is caught there.
 */
export async function listHistoricalCorrectionKeys(client: Client, operationId: string): Promise<string[]> {
  const res = await q(client)
    .from('notifications')
    .select('metadata')
    .eq('notification_type', 'structured_note_historical_correction')
    .eq('metadata->>operationId', operationId)
  if (res.error) throw new Error(sanitize(res.error.message))
  return (res.data ?? [])
    .map((r: { metadata: Record<string, unknown> | null }) => r.metadata?.correctionKey)
    .filter((k: unknown): k is string => typeof k === 'string')
}

export interface HistoricalCorrectionInsert {
  notificationType: string
  title: string
  body: string
  linkUrl: string
  relatedEntityType: string
  relatedEntityId: string
  metadata: Record<string, unknown>
}

export type HistoricalCorrectionWriteResult =
  | { ok: true; id: string; created: true }
  /** The identity already existed — a retry, not a failure. */
  | { ok: true; created: false }
  | { ok: false; created: false; error: string }

/**
 * Creates one historical-correction notification, or reports it already exists.
 *
 * A unique-violation (23505) is the SUCCESS path for a retry: the index caught a
 * duplicate that the pre-read could not see, which is precisely what makes two
 * concurrent runs safe. Any other error is returned so the caller can report a
 * partial result and be re-run.
 */
export async function createHistoricalCorrectionNotification(
  client: Client,
  input: HistoricalCorrectionInsert,
): Promise<HistoricalCorrectionWriteResult> {
  const res = await q(client)
    .from('notifications')
    .insert({
      notification_type: input.notificationType,
      title: input.title,
      body: input.body,
      link_url: input.linkUrl,
      related_entity_type: input.relatedEntityType,
      related_entity_id: input.relatedEntityId,
      metadata: input.metadata,
    })
    .select('id')
    .single()

  if (res.error) {
    if (res.error.code === '23505') return { ok: true, created: false }
    return { ok: false, created: false, error: sanitize(res.error.message) }
  }
  return { ok: true, id: res.data?.id, created: true }
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
