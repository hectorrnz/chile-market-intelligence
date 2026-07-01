// Phase 6A — Watchlist repository.
// All operations are user-scoped; Supabase RLS enforces this at the DB layer.
// Route handlers must pass a user-session client (getSupabaseUserClient()).
//
// Note: Supabase JS type inference for user-scoped (auth) tables can be unreliable;
// results are cast via `as unknown as RowType` following the pattern in macroRepository.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, WatchlistRow as DbWatchlistRow, WatchlistItemRow as DbWatchlistItemRow } from '../../supabase/database.types.ts'

type Client = SupabaseClient<Database>

// Re-export clean repository-layer row types (camelCase, no db prefix)
export interface WatchlistRow {
  id: string
  userId: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface WatchlistItemRow {
  id: string
  watchlistId: string
  userId: string
  ticker: string
  notes: string | null
  addedAt: string
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapWatchlist(r: DbWatchlistRow): WatchlistRow {
  return { id: r.id, userId: r.user_id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at }
}

function mapItem(r: DbWatchlistItemRow): WatchlistItemRow {
  return { id: r.id, watchlistId: r.watchlist_id, userId: r.user_id, ticker: r.ticker, notes: r.notes ?? null, addedAt: r.added_at }
}

// ─── Watchlist helpers ────────────────────────────────────────────────────────

export async function getUserWatchlists(client: Client): Promise<WatchlistRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('watchlists')
    .select('id, user_id, name, created_at, updated_at')
    .order('created_at', { ascending: true })

  const data = res.data as DbWatchlistRow[] | null
  if (res.error || !data) return []
  return data.map(mapWatchlist)
}

export async function getDefaultWatchlist(client: Client): Promise<WatchlistRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('watchlists')
    .select('id, user_id, name, created_at, updated_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  const data = res.data as DbWatchlistRow | null
  if (res.error || !data) return null
  return mapWatchlist(data)
}

export async function createWatchlist(client: Client, name: string): Promise<WatchlistRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('watchlists')
    .insert({ name })
    .select('id, user_id, name, created_at, updated_at')
    .single()

  const data = res.data as DbWatchlistRow | null
  if (res.error || !data) return null
  return mapWatchlist(data)
}

export async function ensureDefaultWatchlist(
  client: Client,
  defaultName = 'Default',
): Promise<WatchlistRow | null> {
  const existing = await getDefaultWatchlist(client)
  if (existing) return existing
  return createWatchlist(client, defaultName)
}

// ─── Watchlist item helpers ───────────────────────────────────────────────────

export async function getWatchlistItems(
  client: Client,
  watchlistId: string,
): Promise<WatchlistItemRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('watchlist_items')
    .select('id, watchlist_id, user_id, ticker, notes, added_at')
    .eq('watchlist_id', watchlistId)
    .order('added_at', { ascending: true })

  const data = res.data as DbWatchlistItemRow[] | null
  if (res.error || !data) return []
  return data.map(mapItem)
}

export async function addTickerToWatchlist(
  client: Client,
  watchlistId: string,
  ticker: string,
  notes?: string,
): Promise<{ ok: boolean; error?: string; item?: WatchlistItemRow }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('watchlist_items')
    .insert({ watchlist_id: watchlistId, ticker: ticker.toUpperCase(), notes: notes ?? null })
    .select('id, watchlist_id, user_id, ticker, notes, added_at')
    .single()

  if (res.error) {
    // PostgreSQL unique violation code
    if ((res.error as { code?: string }).code === '23505') return { ok: false, error: 'duplicate' }
    return { ok: false, error: (res.error as { message: string }).message }
  }

  const data = res.data as DbWatchlistItemRow | null
  if (!data) return { ok: false, error: 'no_data' }
  return { ok: true, item: mapItem(data) }
}

export async function removeTickerFromWatchlist(
  client: Client,
  watchlistId: string,
  ticker: string,
): Promise<{ ok: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('watchlist_items')
    .delete()
    .eq('watchlist_id', watchlistId)
    .eq('ticker', ticker.toUpperCase())

  if (res.error) return { ok: false, error: (res.error as { message: string }).message }
  return { ok: true }
}

export async function updateWatchlistItemNotes(
  client: Client,
  watchlistId: string,
  ticker: string,
  notes: string | null,
): Promise<{ ok: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('watchlist_items')
    .update({ notes })
    .eq('watchlist_id', watchlistId)
    .eq('ticker', ticker.toUpperCase())

  if (res.error) return { ok: false, error: (res.error as { message: string }).message }
  return { ok: true }
}

export async function deleteWatchlist(
  client: Client,
  watchlistId: string,
): Promise<{ ok: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (client as any)
    .from('watchlists')
    .delete()
    .eq('id', watchlistId)

  if (res.error) return { ok: false, error: (res.error as { message: string }).message }
  return { ok: true }
}
