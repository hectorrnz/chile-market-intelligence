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
  // R13.8B adds `import_refused_*`. It is listed alongside the others rather
  // than folded into a looser pattern so an unrecognised driver message still
  // collapses to the generic code instead of being echoed to a client.
  const known =
    /(publication_refused_[a-z_]+|rollback_refused_[a-z_]+|commentary_refused_[a-z_]+|import_refused_[a-z_]+)/.exec(m)
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

/**
 * The same call for a function that returns a jsonb OBJECT rather than a uuid.
 *
 * `nmi_import_portfolio_workbook` and `nmi_rollback_portfolio_import` report
 * counts alongside their identifiers, so they cannot use `callRpc` — and bending
 * `callRpc` to accept either shape would weaken the check that catches a
 * publication RPC returning nothing.
 */
async function callJsonRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: Record<string, unknown> } | Fail> {
  const client = admin()
  if (!client) return { ok: false, code: 'not_configured' }
  const { data, error } = await client.rpc(fn, args)
  if (error) return { ok: false, code: 'rpc_failed', reason: refusalCodeOf(error.message) }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code: 'rpc_failed', reason: 'publication_failed' }
  }
  return { ok: true, result: data as Record<string, unknown> }
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

// ---------------------------------------------------------------------------
// R13.R1 § 9 — weekly evolution history (administrator write path)
// ---------------------------------------------------------------------------

/** One row of the weekly evolution series, as extracted from the source. */
export interface EvolutionObservationPayload {
  scope: string
  basis: string
  observation_date: string
  value: number
  currency: string
  source_upload_id: string
  source_sheet: string
  source_cell: string
  source_row_label: string
  parser_version: string
  extractor_version: string
  ingested_by: string | null
  metadata: Record<string, unknown>
}

/** The upsert shape, kept out of `AdminShape` so its column list is explicit. */
interface EvolutionUpsertShape {
  from: (t: string) => {
    upsert: (
      rows: EvolutionObservationPayload[],
      opts: { onConflict: string },
    ) => Promise<{ error: { message?: string } | null }>
  }
}

/**
 * Replaces the persisted weekly evolution series for one scope, idempotently.
 *
 * UPSERT ON `(scope, basis, observation_date)` — the constraint the migration
 * creates. A re-ingest of the same workbook rewrites the same rows in place; a
 * later workbook that restates a historical week updates that week rather than
 * adding a second, contradictory observation for the same date.
 *
 * NOTHING IS DELETED. A week that stops appearing in a newer workbook keeps its
 * previously-ingested observation: that value was really published by the
 * source, and silently dropping history is not a correction.
 *
 * Called AFTER the publication it accompanies has already committed, so a
 * failure here can never invalidate a valid publication — the caller reports it
 * honestly instead.
 */
export async function upsertEvolutionObservations(
  observations: EvolutionObservationPayload[],
): Promise<{ ok: true; count: number } | Fail> {
  if (observations.length === 0) return { ok: true, count: 0 }
  const client = getSupabaseAdminClient() as never as EvolutionUpsertShape | null
  if (!client) return { ok: false, code: 'not_configured' }

  // Chunked so one oversized statement cannot fail a two-year history; the
  // upsert is idempotent, so a partial application is safe to re-run.
  const CHUNK = 250
  let written = 0
  for (let i = 0; i < observations.length; i += CHUNK) {
    const slice = observations.slice(i, i + CHUNK)
    const { error } = await client
      .from('portfolio_evolution_observations')
      .upsert(slice, { onConflict: 'scope,basis,observation_date' })
    if (error) {
      return { ok: false, code: 'rpc_failed', reason: error.message ?? 'evolution_upsert_failed' }
    }
    written += slice.length
  }
  return { ok: true, count: written }
}

// ---------------------------------------------------------------------------
// R13.8B § 7/§ 8 — the atomic weekly import
// ---------------------------------------------------------------------------
//
// `upsertEvolutionObservations` above stays exported because the standalone
// historical-backfill tool still uses it. THE PUBLISH PATH NO LONGER DOES: a
// weekly import writes its publication and every history mutation inside
// `nmi_import_portfolio_workbook`, which is one transaction. A chunked,
// post-commit, best-effort upsert cannot express "all of these weeks or none".

/** What Production currently holds, as the planner's `publishedObservations`. */
export interface PersistedObservationRead {
  scope: string
  basis: string
  observationDate: string
  value: number
}

interface EvolutionReadShape {
  from: (t: string) => {
    select: (c: string) => {
      order: (
        col: string,
        o: { ascending: boolean },
      ) => Promise<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>
    }
  }
}

/**
 * Every persisted evolution observation, across every scope.
 *
 * This is the ADMINISTRATOR planning read, deliberately separate from
 * `familyPortfolioReadRepository.getEvolutionObservations`, which runs through
 * the caller's own session so `nmi_can_access_scope` re-derives entitlement per
 * scope. Planning an import is a whole-book operation an administrator has
 * already been authorized for, and it must see Jaime's, Andrés's and Pablo's
 * series as well as Main's — otherwise a personal scope's existing week would
 * look ABSENT and a correction would be misclassified as a gap fill.
 *
 * A row's presence IS its status: the evolution table models a gap as an absent
 * row and its `value` column is NOT NULL by R13.R1 design, so everything read
 * here is `stated`.
 */
export async function listPersistedEvolutionObservations(): Promise<
  { ok: true; observations: PersistedObservationRead[] } | Fail
> {
  const client = getSupabaseAdminClient() as never as EvolutionReadShape | null
  if (!client) return { ok: false, code: 'not_configured' }

  const { data, error } = await client
    .from('portfolio_evolution_observations')
    .select('scope, basis, observation_date, value')
    .order('observation_date', { ascending: true })

  if (error) return { ok: false, code: 'rpc_failed', reason: error.message ?? 'evolution_read_failed' }
  return {
    ok: true,
    observations: (data ?? []).map((o) => ({
      scope: String(o.scope),
      basis: String(o.basis),
      observationDate: String(o.observation_date),
      value: Number(o.value),
    })),
  }
}

/** One history mutation, in the exact shape the RPC's `jsonb_to_recordset` reads. */
export interface ImportObservationPayload {
  scope: string
  basis: string
  series_identity: string
  observation_date: string
  disposition: 'new' | 'gap_fill' | 'changed'
  new_value: number | null
  new_status: 'stated' | 'unavailable'
  /**
   * The pre-state the plan asserts. The RPC verifies it under lock and refuses
   * the whole import if it has moved — and writes the before-image it READ, not
   * this one. Sending it is how a stale plan is caught in the database.
   */
  prior_value: number | null
  prior_status: 'stated' | 'unavailable' | null
  source_sheet: string
  source_cell: string
  source_row_label: string
  currency: string
  parser_version: string
  extractor_version: string
}

/**
 * ONE upload → ONE import operation → ONE current publication → N history points.
 *
 * The whole packet is the transaction. There is no fallback sequential apply and
 * no post-commit second write: if this call fails, nothing happened.
 */
export async function importPortfolioWorkbook(params: {
  uploadId: string
  asOfDate: string
  publishedBy: string
  parserVersion: string
  planVersion: string
  rows: SnapshotRowPayload[]
  observations: ImportObservationPayload[]
  performance: PerformanceRowPayload[]
  correctionAuthorized: boolean
  correctionReason: string | null
  counts: Record<string, unknown>
  adminNote: string | null
  metadata: Record<string, unknown>
}) {
  return callJsonRpc('nmi_import_portfolio_workbook', {
    p_upload_id: params.uploadId,
    p_as_of_date: params.asOfDate,
    p_published_by: params.publishedBy,
    p_parser_version: params.parserVersion,
    p_plan_version: params.planVersion,
    p_rows: params.rows,
    p_observations: params.observations,
    p_performance: params.performance,
    p_correction_authorized: params.correctionAuthorized,
    p_correction_reason: params.correctionReason,
    p_counts: params.counts,
    p_admin_note: params.adminNote,
    p_metadata: params.metadata,
  })
}

/**
 * Reverses one import: insertions removed, overwrites restored to their recorded
 * before-image and prior lineage, the displaced publication promoted back.
 *
 * Refuses rather than clobbers when a later import already moved one of these
 * rows on — the forward `import_operation_id` makes that check exact.
 */
export async function rollbackPortfolioImport(params: {
  importId: string
  actorId: string
  note: string | null
}) {
  return callJsonRpc('nmi_rollback_portfolio_import', {
    p_import_id: params.importId,
    p_actor_id: params.actorId,
    p_note: params.note,
  })
}

/** One import operation, as the administrator console lists it. */
export interface ImportOperationRecord {
  id: string
  uploadId: string
  asOfDate: string
  publicationId: string | null
  previousPublicationId: string | null
  planVersion: string
  counts: Record<string, unknown>
  correctionAuthorized: boolean
  correctionReason: string | null
  createdAt: string
  rolledBackAt: string | null
  rollbackNote: string | null
}

interface ImportOperationsShape {
  from: (t: string) => {
    select: (c: string) => {
      order: (
        col: string,
        o: { ascending: boolean },
      ) => Promise<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>
    }
  }
}

/** The import ledger, newest first. Identifiers, dates and counts — no amounts. */
export async function listImportOperations(): Promise<ImportOperationRecord[]> {
  const client = getSupabaseAdminClient() as never as ImportOperationsShape | null
  if (!client) return []

  const { data, error } = await client
    .from('portfolio_import_operations')
    .select(
      'id, upload_id, as_of_date, publication_id, previous_publication_id, plan_version, ' +
        'counts, correction_authorized, correction_reason, created_at, rolled_back_at, rollback_note',
    )
    .order('created_at', { ascending: false })

  if (error) return []
  return (data ?? []).map((r) => ({
    id: String(r.id),
    uploadId: String(r.upload_id),
    asOfDate: String(r.as_of_date),
    publicationId: r.publication_id == null ? null : String(r.publication_id),
    previousPublicationId: r.previous_publication_id == null ? null : String(r.previous_publication_id),
    planVersion: String(r.plan_version),
    counts: (r.counts ?? {}) as Record<string, unknown>,
    correctionAuthorized: r.correction_authorized === true,
    correctionReason: r.correction_reason == null ? null : String(r.correction_reason),
    createdAt: String(r.created_at),
    rolledBackAt: r.rolled_back_at == null ? null : String(r.rolled_back_at),
    rollbackNote: r.rollback_note == null ? null : String(r.rollback_note),
  }))
}
