// R13.R2C §§ 8-11 — reads and administrator writes for the multiple Weekly
// Notes.
//
// CLIENT DISCIPLINE, unchanged from every other Family Portfolio surface:
//
//   * READS go through the CALLER'S OWN session, so the
//     `nmi_can_access_scope(scope) and deleted_at is null` policy re-derives
//     both the entitlement and the tombstone independently of anything the
//     application believes.
//   * WRITES go through the service-role admin client, AFTER the route has
//     established `entitlement.isAdministrator`. The table has no write policy
//     at all, so there is no second way in.
//
// DELETION IS A TOMBSTONE (§ 11), never a row removal: `deleted_at`/`deleted_by`
// are stamped and RLS stops returning the row. The record that a note existed
// and was withdrawn survives, which is the same reason the commentary chain
// supersedes rather than updating in place.

import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import type { WeeklyNote } from '@/lib/familyPortfolio/weeklyNotes'
// `isSchemaMissing` lives in the PURE module (R13.R2 pass 4 § 1) so the
// classification can be tested against the real PostgREST error shape without
// loading a Supabase client.
import { isSchemaMissing, sortWeeklyNotes } from '@/lib/familyPortfolio/weeklyNotes'

export type WeeklyNotesFailure =
  | 'not_configured'
  | 'schema_missing'
  | 'read_failed'
  | 'write_failed'
  | 'not_found'

type Fail = { ok: false; code: WeeklyNotesFailure }

interface NoteRow {
  id: string
  body: string
  display_order: number
  created_at: string
  updated_at: string
}

type PostgrestError = { message?: string; code?: string } | null

/** Supabase's generated types do not know this table yet; the shape is explicit. */
interface NotesSelect {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => {
          order: (c: string, o: { ascending: boolean }) => Promise<{
            data: NoteRow[] | null
            error: PostgrestError
          }>
        }
      }
    }
  }
}

interface NotesWrite {
  from: (t: string) => {
    insert: (rows: Record<string, unknown>[]) => {
      select: (cols: string) => {
        single: () => Promise<{ data: NoteRow | null; error: PostgrestError }>
      }
    }
    update: (patch: Record<string, unknown>) => {
      eq: (c: string, v: string) => {
        is: (c: string, v: null) => {
          select: (cols: string) => {
            maybeSingle: () => Promise<{ data: NoteRow | null; error: PostgrestError }>
          }
        }
      }
    }
  }
}

const TABLE = 'family_portfolio_weekly_notes'

function toNote(r: NoteRow): WeeklyNote {
  return {
    id: r.id,
    body: r.body,
    displayOrder: r.display_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/**
 * The LIVE notes for one published week and scope, in the module's one
 * deterministic order. RLS already excludes tombstones; the ordering is applied
 * here so the screen, the print sheet and the tests cannot disagree.
 */
export async function getWeeklyNotes(
  publicationId: string,
  scope: string,
): Promise<{ ok: true; notes: WeeklyNote[] } | Fail> {
  const client = (await getSupabaseUserClient()) as never as NotesSelect | null
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await client
    .from(TABLE)
    .select('id, body, display_order, created_at, updated_at')
    .eq('publication_id', publicationId)
    .eq('scope', scope)
    .order('display_order', { ascending: true })

  if (error) return { ok: false, code: isSchemaMissing(error) ? 'schema_missing' : 'read_failed' }
  return { ok: true, notes: sortWeeklyNotes((data ?? []).map(toNote)) }
}

export async function createWeeklyNote(input: {
  publicationId: string
  scope: string
  body: string
  displayOrder: number
  author: string
}): Promise<{ ok: true; note: WeeklyNote } | Fail> {
  const client = getSupabaseAdminClient() as never as NotesWrite | null
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await client
    .from(TABLE)
    .insert([
      {
        publication_id: input.publicationId,
        scope: input.scope,
        body: input.body,
        display_order: input.displayOrder,
        created_by: input.author,
      },
    ])
    .select('id, body, display_order, created_at, updated_at')
    .single()

  if (error) return { ok: false, code: isSchemaMissing(error) ? 'schema_missing' : 'write_failed' }
  if (!data) return { ok: false, code: 'write_failed' }
  return { ok: true, note: toNote(data) }
}

/**
 * Edits ONE note by its own id.
 *
 * `.is('deleted_at', null)` is load-bearing: a tombstoned note must not be
 * editable back into existence by id, which would make deletion reversible
 * through a path the UI never offers and the audit trail never records.
 */
export async function updateWeeklyNote(input: {
  id: string
  body: string
  author: string
}): Promise<{ ok: true; note: WeeklyNote } | Fail> {
  const client = getSupabaseAdminClient() as never as NotesWrite | null
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await client
    .from(TABLE)
    .update({ body: input.body, updated_by: input.author })
    .eq('id', input.id)
    .is('deleted_at', null)
    .select('id, body, display_order, created_at, updated_at')
    .maybeSingle()

  if (error) return { ok: false, code: isSchemaMissing(error) ? 'schema_missing' : 'write_failed' }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, note: toNote(data) }
}

/** Tombstones ONE note. Its siblings are not touched. */
export async function deleteWeeklyNote(input: {
  id: string
  author: string
}): Promise<{ ok: true } | Fail> {
  const client = getSupabaseAdminClient() as never as NotesWrite | null
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await client
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString(), deleted_by: input.author })
    .eq('id', input.id)
    .is('deleted_at', null)
    .select('id, body, display_order, created_at, updated_at')
    .maybeSingle()

  if (error) return { ok: false, code: isSchemaMissing(error) ? 'schema_missing' : 'write_failed' }
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true }
}
