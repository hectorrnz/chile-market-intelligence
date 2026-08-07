// R13.5 — Family Portfolio publication persistence.
//
// SERVER-ONLY. Never import from a client component.
//
// Like `portfolioUploadRepository.ts`, every write here uses the SERVICE-ROLE
// client. That is not a shortcut around authorization: the R13.3/R13.4/R13.5
// migrations grant `authenticated` only SELECT and define no write policy, so no
// user-scoped write path exists by construction. The authorization decision is
// made BEFORE this module is reached — each route runs `guardPrivateApi()` and
// then confirms administrative capability. This module never decides who may
// publish, and it never decides WHETHER a draft may be published: that is
// `publication.ts`'s job, and the route runs it first.
//
// EVERY MUTATION GOES THROUGH AN RPC, NEVER A DIRECT TABLE WRITE. A publication
// touches a parent row, hundreds of child rows and a supersession pointer, and
// the Supabase client has no multi-statement transaction API — so writing them
// as separate calls would make a half-published week visible to readers. The
// function body is the transaction (doc 05 § 6).

import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { UPLOAD_BUCKET } from './portfolioUploadRepository'
import type { UploadKind } from '@/lib/familyPortfolio/publication'

/** Bumped with the publication contract; recorded on every publication row. */
export { PUBLICATION_LIFECYCLE_VERSION } from '@/lib/familyPortfolio/publication'

export interface UploadRecord {
  id: string
  uploadKind: UploadKind
  storageObjectPath: string
  originalFilename: string
  fileSha256: string
  fileSizeBytes: number
  uploadedAt: string
  status: string
  detectedAsOfDate: string | null
  confirmedAsOfDate: string | null
}

export interface StoredFinding {
  severity: 'blocking' | 'warning' | 'info'
  code: string
  scope: string | null
  sourceSheet: string | null
  sourceCell: string | null
  rowLabel: string | null
  detail: string
}

export interface PublicationRecord {
  id: string
  uploadId: string
  uploadKind: UploadKind
  asOfDate: string
  revision: number
  isCurrent: boolean
  supersededBy: string | null
  publishedAt: string
  adminNote: string | null
  parserVersion: string
}

type Fail =
  | { ok: false; code: 'not_configured' }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'rpc_failed'; reason: string }
  | { ok: false; code: 'download_failed' }

/**
 * A narrow structural view of the admin client.
 *
 * Supabase JS type inference for these tables fails at this TypeScript recursion
 * depth — the same reason `watchlistRepository.ts`, `macroRepository.ts` and
 * `portfolioUploadRepository.ts` all cast. The shapes are written out rather
 * than using `any` so a typo in a column list is still a compile error.
 */
interface AdminShape {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>
        order: (col: string, o: { ascending: boolean }) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
      }
      order: (col: string, o: { ascending: boolean }) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>
    }
  }
  storage: {
    from: (b: string) => {
      download: (p: string) => Promise<{ data: Blob | null; error: unknown }>
    }
  }
}

function admin(): AdminShape | null {
  return getSupabaseAdminClient() as never as AdminShape | null
}

/**
 * A refusal raised by an RPC, reduced to its stable code.
 *
 * The functions raise `publication_refused_*` / `rollback_refused_*` /
 * `commentary_refused_*` messages precisely so the server can map them to an
 * HTTP status without parsing prose. Anything unrecognised collapses to a
 * generic code — a driver message can name a constraint or a column and must
 * not be echoed to a client.
 */
export function refusalCodeOf(message: string | undefined): string {
  const m = (message ?? '').trim()
  const known = /(publication_refused_[a-z_]+|rollback_refused_[a-z_]+|commentary_refused_[a-z_]+)/.exec(m)
  return known ? known[1] : 'publication_failed'
}

function toUpload(row: Record<string, unknown>): UploadRecord {
  return {
    id: String(row.id),
    uploadKind: row.upload_kind as UploadKind,
    storageObjectPath: String(row.storage_object_path),
    originalFilename: String(row.original_filename),
    fileSha256: String(row.file_sha256),
    fileSizeBytes: Number(row.file_size_bytes),
    uploadedAt: String(row.uploaded_at),
    status: String(row.status),
    detectedAsOfDate: row.detected_as_of_date === null || row.detected_as_of_date === undefined
      ? null
      : String(row.detected_as_of_date),
    confirmedAsOfDate: row.confirmed_as_of_date === null || row.confirmed_as_of_date === undefined
      ? null
      : String(row.confirmed_as_of_date),
  }
}

const UPLOAD_COLUMNS =
  'id, upload_kind, storage_object_path, original_filename, file_sha256, file_size_bytes, ' +
  'uploaded_at, status, detected_as_of_date, confirmed_as_of_date'

const PUBLICATION_COLUMNS =
  'id, upload_id, upload_kind, as_of_date, revision, is_current, superseded_by, ' +
  'published_at, admin_note, parser_version'

export async function getUpload(uploadId: string): Promise<{ ok: true; upload: UploadRecord } | Fail> {
  const client = admin()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data } = await client.from('portfolio_source_uploads').select(UPLOAD_COLUMNS).eq('id', uploadId).maybeSingle()
  if (!data) return { ok: false, code: 'not_found' }
  return { ok: true, upload: toUpload(data) }
}

export async function getUploadFindings(uploadId: string): Promise<StoredFinding[]> {
  const client = admin()
  if (!client) return []
  const { data } = await client
    .from('portfolio_upload_findings')
    .select('severity, code, scope, source_sheet, source_cell, row_label, detail')
    .eq('upload_id', uploadId)
    .order('severity', { ascending: true })
  return (data ?? []).map((r) => ({
    severity: r.severity as StoredFinding['severity'],
    code: String(r.code),
    scope: r.scope === null || r.scope === undefined ? null : String(r.scope),
    sourceSheet: r.source_sheet === null || r.source_sheet === undefined ? null : String(r.source_sheet),
    sourceCell: r.source_cell === null || r.source_cell === undefined ? null : String(r.source_cell),
    rowLabel: r.row_label === null || r.row_label === undefined ? null : String(r.row_label),
    detail: String(r.detail),
  }))
}

/**
 * Reads the stored workbook back out of the private bucket for parsing.
 *
 * The bytes never leave the server: they are parsed in the route and only the
 * derived draft is serialized. This is also why the draft is recomputed on every
 * preview instead of being cached — a cached draft would be a second copy of
 * private financial content with its own lifetime.
 */
export async function downloadUploadBytes(
  objectPath: string,
): Promise<{ ok: true; bytes: Buffer } | Fail> {
  const client = admin()
  if (!client) return { ok: false, code: 'not_configured' }
  const { data, error } = await client.storage.from(UPLOAD_BUCKET).download(objectPath)
  if (error || !data) return { ok: false, code: 'download_failed' }
  return { ok: true, bytes: Buffer.from(await data.arrayBuffer()) }
}

function toPublication(r: Record<string, unknown>): PublicationRecord {
  return {
    id: String(r.id),
    uploadId: String(r.upload_id),
    uploadKind: r.upload_kind as UploadKind,
    asOfDate: String(r.as_of_date),
    revision: Number(r.revision),
    isCurrent: Boolean(r.is_current),
    supersededBy: r.superseded_by === null || r.superseded_by === undefined ? null : String(r.superseded_by),
    publishedAt: String(r.published_at),
    adminNote: r.admin_note === null || r.admin_note === undefined ? null : String(r.admin_note),
    parserVersion: String(r.parser_version),
  }
}

export async function getPublication(id: string): Promise<PublicationRecord | null> {
  const client = admin()
  if (!client) return null
  const { data } = await client.from('portfolio_publications').select(PUBLICATION_COLUMNS).eq('id', id).maybeSingle()
  return data ? toPublication(data) : null
}

/**
 * An upload as the administrator console sees it — deliberately WITHOUT
 * `storageObjectPath`.
 *
 * Doc 05 § 3.2 makes the object key opaque precisely because it leaks through
 * logs, error messages and signed URLs; the R13.2 detail route already withholds
 * it. A console listing has no use for it either — the download link is minted
 * server-side from the row — so the field is dropped at the repository boundary
 * rather than trusted not to be serialized further up.
 */
export type AdminUploadSummary = Omit<UploadRecord, 'storageObjectPath'>

export async function listUploads(): Promise<AdminUploadSummary[]> {
  const client = admin()
  if (!client) return []
  const { data } = await client
    .from('portfolio_source_uploads')
    .select(UPLOAD_COLUMNS)
    .order('uploaded_at', { ascending: false })
  return (data ?? []).map((row) => {
    const { storageObjectPath: _omitted, ...summary } = toUpload(row)
    void _omitted
    return summary
  })
}

export async function listPublications(): Promise<PublicationRecord[]> {
  const client = admin()
  if (!client) return []
  const { data } = await client
    .from('portfolio_publications')
    .select(PUBLICATION_COLUMNS)
    .order('published_at', { ascending: false })
  return (data ?? []).map(toPublication)
}

/**
 * Records the administrator's confirmed date and, when it diverges from the
 * detected one, the justification.
 *
 * The note is not optional in that case — a CHECK constraint on
 * `portfolio_source_uploads` refuses the write, so this cannot be bypassed by a
 * caller that skipped the server-side gate.
 */
export async function recordConfirmedDate(params: {
  uploadId: string
  detected: string | null
  confirmed: string
  overrideNote: string | null
}): Promise<{ ok: true } | Fail> {
  const client = admin()
  if (!client) return { ok: false, code: 'not_configured' }
  const { error } = await (client as never as {
    from: (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: { message?: string } | null }>
      }
    }
  })
    .from('portfolio_source_uploads')
    .update({
      detected_as_of_date: params.detected,
      confirmed_as_of_date: params.confirmed,
      date_override_note: params.overrideNote,
    })
    .eq('id', params.uploadId)
  if (error) return { ok: false, code: 'rpc_failed', reason: refusalCodeOf(error.message) }
  return { ok: true }
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<{ ok: true; id: string } | Fail> {
  const client = admin()
  if (!client) return { ok: false, code: 'not_configured' }
  const { data, error } = await client.rpc(fn, args)
  if (error) return { ok: false, code: 'rpc_failed', reason: refusalCodeOf(error.message) }
  if (typeof data !== 'string' || data.length === 0) {
    return { ok: false, code: 'rpc_failed', reason: 'publication_failed' }
  }
  return { ok: true, id: data }
}

export interface SnapshotRowPayload {
  scope: string
  row_key: string
  parent_row_key: string | null
  depth: number
  display_order: number
  row_type: string
  label_es: string
  label_en: string | null
  currency: string
  /** NULL is preserved as NULL: unavailable is never zero (doc 02 § 9). */
  value: number | null
  value_class: string
  source_sheet: string
  source_cell: string
  metadata: Record<string, unknown>
}

export interface PerformanceRowPayload {
  scope: string
  basis: string
  metric: string
  value: number | null
  value_class: string
  source_sheet: string
  source_cell: string
  metadata: Record<string, unknown>
}

export async function publishPortfolio(params: {
  uploadId: string
  asOfDate: string
  publishedBy: string
  parserVersion: string
  rows: SnapshotRowPayload[]
  performance: PerformanceRowPayload[]
  adminNote: string | null
  metadata: Record<string, unknown>
}) {
  return callRpc('nmi_publish_portfolio', {
    p_upload_id: params.uploadId,
    p_as_of_date: params.asOfDate,
    p_published_by: params.publishedBy,
    p_parser_version: params.parserVersion,
    p_rows: params.rows,
    p_performance: params.performance,
    p_admin_note: params.adminNote,
    p_metadata: params.metadata,
  })
}

export interface HoldingPayload {
  /** Generated server-side so events can reference it without a name join. */
  id: string
  category: string
  currency: string
  investment_name: string
  sociedad: string
  capital_committed: number | null
  contributions: number | null
  unfunded: number | null
  last_statement_date: string | null
  last_statement_label: string | null
  last_valuation: number | null
  flow_since_statement: number | null
  current_value: number | null
  reported_irr: number | null
  calculated_irr: number | null
  source_sheet: string
  source_row: number
  source_cell: string
  metadata: Record<string, unknown>
}

export interface EventPayload {
  holding_id: string
  event_date: string
  amount: number
  currency: string
  event_type: string
  raw_fill: string | null
  resolved_hex: string | null
  classification_method: string | null
  source_sheet: string
  source_cell: string
  source_row: number
  metadata: Record<string, unknown>
}

export async function publishAlternatives(params: {
  uploadId: string
  asOfDate: string
  publishedBy: string
  parserVersion: string
  holdings: HoldingPayload[]
  events: EventPayload[]
  adminNote: string | null
  metadata: Record<string, unknown>
}) {
  return callRpc('nmi_publish_alternatives', {
    p_upload_id: params.uploadId,
    p_as_of_date: params.asOfDate,
    p_published_by: params.publishedBy,
    p_parser_version: params.parserVersion,
    p_holdings: params.holdings,
    p_events: params.events,
    p_admin_note: params.adminNote,
    p_metadata: params.metadata,
  })
}

export async function rollbackPublication(params: {
  targetId: string
  actorId: string
  note: string | null
}) {
  return callRpc('nmi_rollback_publication', {
    p_target_id: params.targetId,
    p_actor_id: params.actorId,
    p_note: params.note,
  })
}

export async function upsertCommentary(params: {
  publicationId: string
  scope: string
  body: string
  author: string
}) {
  return callRpc('nmi_upsert_portfolio_commentary', {
    p_publication_id: params.publicationId,
    p_scope: params.scope,
    p_body: params.body,
    p_author: params.author,
  })
}
