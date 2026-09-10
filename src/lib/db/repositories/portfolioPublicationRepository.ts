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
import { readAllPages } from '@/lib/db/pagination'
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
/**
 * An ordered row query: awaitable as it always was, and now also rangeable, so
 * `readAllPages` can walk it. A PostgREST builder really is both — a thenable
 * that still accepts further modifiers — and modelling that is what lets a
 * console listing page without every call site changing shape.
 */
interface AdminRowsQuery
  extends PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }> {
  order: (col: string, o: { ascending: boolean }) => AdminRowsQuery
  range: (
    from: number,
    to: number,
  ) => Promise<{
    data: Record<string, unknown>[] | null
    error: { message?: string } | null
  }>
}

interface AdminShape {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>
        order: (col: string, o: { ascending: boolean }) => AdminRowsQuery
      }
      order: (col: string, o: { ascending: boolean }) => AdminRowsQuery
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

/**
 * The findings recorded when this upload was parsed at upload time.
 *
 * FOLLOW-UP G — this one is a PUBLISH GATE, not a listing. `summarizeDraft`
 * folds these into the same refusal set as the live re-parse, on the stated
 * rule that "a blocking finding recorded at UPLOAD time still blocks now". So
 * an unreadable findings table answered as `[]` did not merely lose a warning
 * count: it withdrew every blocking finding the file already had and could turn
 * an unpublishable draft publishable. The read now fails loudly instead.
 */
export async function getUploadFindings(
  uploadId: string,
): Promise<{ ok: true; findings: StoredFinding[] } | Fail> {
  const client = admin()
  if (!client) return { ok: false, code: 'not_configured' }
  const { data, error } = await client
    .from('portfolio_upload_findings')
    .select('severity, code, scope, source_sheet, source_cell, row_label, detail')
    .eq('upload_id', uploadId)
    .order('severity', { ascending: true })
  if (error) {
    const message = (error as { message?: unknown }).message
    return {
      ok: false,
      code: 'rpc_failed',
      reason: refusalCodeOf(typeof message === 'string' ? message : 'findings_read_failed'),
    }
  }
  const findings = (data ?? []).map((r) => ({
    severity: r.severity as StoredFinding['severity'],
    code: String(r.code),
    scope: r.scope === null || r.scope === undefined ? null : String(r.scope),
    sourceSheet: r.source_sheet === null || r.source_sheet === undefined ? null : String(r.source_sheet),
    sourceCell: r.source_cell === null || r.source_cell === undefined ? null : String(r.source_cell),
    rowLabel: r.row_label === null || r.row_label === undefined ? null : String(r.row_label),
    detail: String(r.detail),
  }))
  return { ok: true, findings }
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

/**
 * FOLLOW-UP G — A FAILED READ IS NOT AN EMPTY TABLE.
 *
 * These three listings used to answer `[]` for both "this table holds nothing"
 * and "this table could not be read". The two are not the same fact, and the
 * second one is not a fact at all — it is the absence of one. Every caller then
 * had to treat an unknown book as an empty one, which is the same silent
 * fabrication FOLLOW-UP F closed at the pagination layer: `listPublications`
 * feeds the endpoint that separates a NEW week from a GAP_FILL, and it feeds
 * restatement detection, where "no publication stands for that week" is the
 * answer that lets an overwrite through the authorization gate unauthorized.
 *
 * They now answer in this module's canonical `{ ok: true; … } | Fail` form. An
 * empty table is still `{ ok: true, …: [] }` — the honest empty answer is
 * unchanged and unambiguous.
 */
export async function listUploads(): Promise<{ ok: true; uploads: AdminUploadSummary[] } | Fail> {
  const client = admin()
  if (!client) return { ok: false, code: 'not_configured' }
  // Newest first, with `id` as the tiebreaker that makes the order TOTAL —
  // two uploads recorded in the same transaction share `uploaded_at`, and tied
  // rows reorder between page requests, which drops rows silently (FOLLOW-UP F).
  const read = await readAllPages(() =>
    client
      .from('portfolio_source_uploads')
      .select(UPLOAD_COLUMNS)
      .order('uploaded_at', { ascending: false })
      .order('id', { ascending: false }),
  )
  // The reason is reduced to a stable code first: a driver message can name a
  // constraint, a column or a host, and must not travel with the refusal.
  if (!read.ok) return { ok: false, code: 'rpc_failed', reason: refusalCodeOf(read.reason) }
  return {
    ok: true,
    uploads: read.rows.map((row) => {
      const { storageObjectPath: _omitted, ...summary } = toUpload(row)
      void _omitted
      return summary
    }),
  }
}

export async function listPublications(): Promise<{ ok: true; publications: PublicationRecord[] } | Fail> {
  const client = admin()
  if (!client) return { ok: false, code: 'not_configured' }
  // One import can publish eight weeks in a single transaction, so `published_at`
  // alone is emphatically NOT a total order here — the R13.8 restoration wrote
  // exactly that. `as_of_date` then `id` settle every tie deterministically.
  const read = await readAllPages(() =>
    client
      .from('portfolio_publications')
      .select(PUBLICATION_COLUMNS)
      .order('published_at', { ascending: false })
      .order('as_of_date', { ascending: false })
      .order('id', { ascending: false }),
  )
  if (!read.ok) return { ok: false, code: 'rpc_failed', reason: refusalCodeOf(read.reason) }
  return { ok: true, publications: read.rows.map(toPublication) }
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
      ) => {
        order: (
          col: string,
          o: { ascending: boolean },
        ) => {
          order: (
            col: string,
            o: { ascending: boolean },
          ) => {
            range: (
              from: number,
              to: number,
            ) => Promise<{
              data: Record<string, unknown>[] | null
              error: { message?: string } | null
            }>
          }
        }
      }
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

  // FOLLOW-UP F. This read used to fetch ONE unpaged page. It happened to be
  // whole at 527 rows and would have gone silently short the week the book
  // crossed the server's 1,000-row cap — five scopes at two bases is roughly ten
  // observations a week, so the failure was dated, not hypothetical. Paged now,
  // on the TOTAL order `(observation_date, scope, basis)`: the unique key
  // re-ordered, so no row ties and none can fall between pages.
  const read = await readAllPages(() =>
    client
      .from('portfolio_evolution_observations')
      .select('scope, basis, observation_date, value')
      .order('observation_date', { ascending: true })
      .order('scope', { ascending: true })
      .order('basis', { ascending: true }),
  )
  if (!read.ok) return { ok: false, code: 'rpc_failed', reason: read.reason }
  return {
    ok: true,
    observations: read.rows.map((o) => ({
      scope: String(o.scope),
      basis: String(o.basis),
      observationDate: String(o.observation_date),
      value: Number(o.value),
    })),
  }
}

/**
 * The MATERIAL payload of the publication currently standing for one week.
 *
 * R13.8C.2 needs this to answer "would this workbook restate the standing
 * snapshot?" during PREVIEW — before any write path is entered — so the console
 * can show a proposed publication change instead of the false "nothing to apply"
 * that the history-only test produced.
 *
 * It reads through the ADMIN client for the same reason
 * `listPersistedEvolutionObservations` does: planning an import is a whole-book
 * operation an administrator has already been authorized for, and it must see
 * every scope, not only the ones the caller's own session may read.
 *
 * Returns null when no publication stands for that date — which the comparison
 * treats as "changed", because there is plainly something to publish.
 *
 * NOT THE ENFORCEMENT POINT. `nmi_import_portfolio_workbook` repeats this
 * comparison in SQL against its own rows under the publication lock, so a stale
 * or failed read here can never let a no-op through.
 */
export interface StandingPublicationPayload {
  publicationId: string
  asOfDate: string
  rows: SnapshotRowPayload[]
  performance: PerformanceRowPayload[]
}

interface PublicationPayloadShape {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        col: string,
        v: string,
      ) => Promise<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>
    }
  }
}

export async function getStandingPublicationPayload(
  asOfDate: string,
): Promise<{ ok: true; payload: StandingPublicationPayload | null } | Fail> {
  const admin = getSupabaseAdminClient()
  if (!admin) return { ok: false, code: 'not_configured' }

  // FOLLOW-UP G — an unreadable ledger is NOT "no publication stands here". The
  // caller reads a null payload as "there is plainly something to publish", so a
  // failed read would have manufactured a change out of an unknown.
  const publications = await listPublications()
  if (!publications.ok) return publications
  const standing = publications.publications.find(
    (p) => p.uploadKind === 'portfolio' && p.isCurrent && p.asOfDate === asOfDate,
  )
  if (!standing) return { ok: true, payload: null }

  const client = admin as never as PublicationPayloadShape

  const rowsResult = await client
    .from('portfolio_snapshot_rows')
    .select(
      'scope, row_key, parent_row_key, depth, display_order, row_type, label_es, label_en, ' +
        'currency, value, value_class, source_sheet, source_cell, metadata',
    )
    .eq('publication_id', standing.id)
  if (rowsResult.error) {
    return { ok: false, code: 'rpc_failed', reason: rowsResult.error.message ?? 'snapshot_read_failed' }
  }
  // FOLLOW-UP F. One publication is ~197 snapshot rows, well inside the server's
  // 1,000-row response cap, and this read is bounded by the book's STRUCTURE
  // rather than its history — so it does not page. It does refuse a capped read,
  // the same way `listStandingPublicationPayloads` below does: a short payload
  // here would read as a page full of removed rows and manufacture a restatement
  // that never happened. A loud refusal is the only safe short answer.
  if ((rowsResult.data ?? []).length >= TRUNCATION_GUARD) {
    return { ok: false, code: 'rpc_failed', reason: 'publication_payload_truncated' }
  }

  const perfResult = await client
    .from('portfolio_performance_rows')
    .select('scope, basis, metric, value, value_class, source_sheet, source_cell, metadata')
    .eq('publication_id', standing.id)
  if (perfResult.error) {
    return { ok: false, code: 'rpc_failed', reason: perfResult.error.message ?? 'performance_read_failed' }
  }
  if ((perfResult.data ?? []).length >= TRUNCATION_GUARD) {
    return { ok: false, code: 'rpc_failed', reason: 'publication_payload_truncated' }
  }

  return {
    ok: true,
    payload: {
      publicationId: standing.id,
      asOfDate: standing.asOfDate,
      rows: (rowsResult.data ?? []).map(mapSnapshotRow),
      performance: (perfResult.data ?? []).map(mapPerformanceRow),
    },
  }
}

/**
 * The ONE mapping from a stored snapshot row to its payload shape.
 *
 * Extracted at R13.8D.1 so the single-week read and the batched historical read
 * cannot drift. A second copy that coerced a NULL differently would make one
 * comparison see a restatement the other does not.
 */
function mapSnapshotRow(r: Record<string, unknown>): SnapshotRowPayload {
  return {
    scope: String(r.scope),
    row_key: String(r.row_key),
    parent_row_key: r.parent_row_key === null ? null : String(r.parent_row_key),
    depth: Number(r.depth),
    display_order: Number(r.display_order),
    row_type: String(r.row_type),
    label_es: String(r.label_es),
    label_en: r.label_en === null ? null : String(r.label_en),
    currency: String(r.currency),
    // NULL stays NULL: unavailable is never zero (doc 02 § 9), and coercing
    // it here would make an unavailable leaf compare equal to a real 0.
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    value_class: String(r.value_class),
    source_sheet: String(r.source_sheet),
    source_cell: String(r.source_cell),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }
}

function mapPerformanceRow(r: Record<string, unknown>): PerformanceRowPayload {
  return {
    scope: String(r.scope),
    basis: String(r.basis),
    metric: String(r.metric),
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    value_class: String(r.value_class),
    source_sheet: String(r.source_sheet),
    source_cell: String(r.source_cell),
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
  }
}

/** R13.8D.1 — one already-published week, whole, for restatement detection. */
export interface StandingPublicationIndexEntry {
  publicationId: string
  asOfDate: string
  revision: number
  rows: SnapshotRowPayload[]
  performance: PerformanceRowPayload[]
}

interface PublicationBatchShape {
  from: (t: string) => {
    select: (c: string) => {
      in: (
        col: string,
        v: readonly string[],
      ) => Promise<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>
    }
  }
}

/**
 * How many publications one batched read asks for.
 *
 * PostgREST caps a response at a server-configured row limit. A publication is
 * ~195 snapshot rows, so a small chunk stays far below any plausible cap — and
 * `TRUNCATION_GUARD` below turns a cap that DOES bite into a loud refusal rather
 * than a silently short payload, which would otherwise read as a page full of
 * "removed" rows and manufacture restatements that do not exist.
 */
const SNAPSHOT_CHUNK_PUBLICATIONS = 3
const PERFORMANCE_CHUNK_PUBLICATIONS = 20
const TRUNCATION_GUARD = 1000

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Every CURRENT portfolio publication among `asOfDates`, with its full payload.
 *
 * This is the Production side of historical-publication-restatement detection
 * (R13.8D.1 § 3). It reads the same two tables and the same columns as
 * `getStandingPublicationPayload` through the same mappers, so the historical
 * comparison and the current-week comparison are literally the same comparison
 * applied to different weeks.
 *
 * Read through the ADMIN client for the same reason `listPersistedEvolutionObservations`
 * is: this is a WHOLE-BOOK planning read made by an already-authorized
 * administrator, spanning every scope, and it never reaches a member surface.
 */
export async function listStandingPublicationPayloads(
  asOfDates: readonly string[],
): Promise<{ ok: true; payloads: StandingPublicationIndexEntry[] } | Fail> {
  const admin = getSupabaseAdminClient()
  if (!admin) return { ok: false, code: 'not_configured' }
  if (asOfDates.length === 0) return { ok: true, payloads: [] }

  const wanted = new Set(asOfDates)
  // FOLLOW-UP G — this is the restatement gate. An unreadable ledger answered as
  // "none of these weeks is published" reports zero restatements, and an import
  // that overwrites settled history then passes the correction-authorization
  // gate without ever asking for authorization. It must fail instead.
  const publications = await listPublications()
  if (!publications.ok) return publications
  const standing = publications.publications.filter(
    (p) => p.uploadKind === 'portfolio' && p.isCurrent && wanted.has(p.asOfDate),
  )
  if (standing.length === 0) return { ok: true, payloads: [] }

  const client = admin as never as PublicationBatchShape
  const byId = new Map<string, StandingPublicationIndexEntry>()
  for (const p of standing) {
    byId.set(p.id, {
      publicationId: p.id,
      asOfDate: p.asOfDate,
      revision: p.revision,
      rows: [],
      performance: [],
    })
  }
  const ids = [...byId.keys()]

  for (const group of chunk(ids, SNAPSHOT_CHUNK_PUBLICATIONS)) {
    const result = await client
      .from('portfolio_snapshot_rows')
      .select(
        'publication_id, scope, row_key, parent_row_key, depth, display_order, row_type, ' +
          'label_es, label_en, currency, value, value_class, source_sheet, source_cell, metadata',
      )
      .in('publication_id', group)
    if (result.error) {
      return { ok: false, code: 'rpc_failed', reason: result.error.message ?? 'snapshot_read_failed' }
    }
    const data = result.data ?? []
    if (data.length >= TRUNCATION_GUARD) {
      return { ok: false, code: 'rpc_failed', reason: 'publication_payload_truncated' }
    }
    for (const r of data) byId.get(String(r.publication_id))?.rows.push(mapSnapshotRow(r))
  }

  for (const group of chunk(ids, PERFORMANCE_CHUNK_PUBLICATIONS)) {
    const result = await client
      .from('portfolio_performance_rows')
      .select('publication_id, scope, basis, metric, value, value_class, source_sheet, source_cell, metadata')
      .in('publication_id', group)
    if (result.error) {
      return { ok: false, code: 'rpc_failed', reason: result.error.message ?? 'performance_read_failed' }
    }
    const data = result.data ?? []
    if (data.length >= TRUNCATION_GUARD) {
      return { ok: false, code: 'rpc_failed', reason: 'publication_payload_truncated' }
    }
    for (const r of data) byId.get(String(r.publication_id))?.performance.push(mapPerformanceRow(r))
  }

  return { ok: true, payloads: [...byId.values()] }
}

// ---------------------------------------------------------------------------
// R13.8E — ROW-LEVEL HISTORY: planning read and staging relay.
// ---------------------------------------------------------------------------

/** One row-history identity as Production currently holds it. */
export interface PersistedRowHistoryRead {
  scope: string
  observationDate: string
  rowKey: string
  value: number | null
  valueClass: string
}

interface RowHistoryReadShape {
  from: (t: string) => {
    select: (c: string) => {
      order: (
        col: string,
        o: { ascending: boolean },
      ) => {
        order: (
          col: string,
          o: { ascending: boolean },
        ) => {
          order: (
            col: string,
            o: { ascending: boolean },
          ) => {
            range: (
              from: number,
              to: number,
            ) => Promise<{
              data:
                | Array<{
                    scope: string
                    observation_date: string
                    row_key: string
                    value: number | null
                    value_class: string
                  }>
                | null
              error: { message?: string } | null
            }>
          }
        }
      }
    }
  }
}

/**
 * Every row-history identity Production holds, with its value and class.
 *
 * Read through the ADMIN client for the same reason
 * `listPersistedEvolutionObservations` is: planning an import is a whole-book
 * operation an already-authorized administrator performs across every scope,
 * and it never reaches a member surface.
 *
 * FOLLOW-UP F. This walk used to ask for 5,000-row pages and stop as soon as a
 * page came back short. PostgREST caps a response at 1,000 rows on this project,
 * so the FIRST page was always short and the walk always stopped — 1,000 of
 * 19,757 identities, with the other 18,757 reading as ABSENT and an identical
 * re-upload proposing them as fresh insertions. `readAllPages` terminates on an
 * EMPTY page and advances by rows RECEIVED, so a cap can shorten the page but
 * never the answer. See `src/lib/db/pagination.ts`.
 */
export async function listPersistedRowHistory(): Promise<
  { ok: true; rows: PersistedRowHistoryRead[] } | Fail
> {
  const client = getSupabaseAdminClient() as never as RowHistoryReadShape | null
  if (!client) return { ok: false, code: 'not_configured' }

  // A TOTAL order. `(observation_date, scope, row_key)` is this table's unique
  // key re-ordered, so no two rows tie — without every component a row can sit
  // on two pages or on none, and a missed identity reads as ABSENT.
  const read = await readAllPages(() =>
    client
      .from('portfolio_row_history')
      .select('scope, observation_date, row_key, value, value_class')
      .order('observation_date', { ascending: true })
      .order('scope', { ascending: true })
      .order('row_key', { ascending: true }),
  )
  if (!read.ok) return { ok: false, code: 'rpc_failed', reason: read.reason }

  return {
    ok: true,
    rows: read.rows.map((r) => ({
      scope: String(r.scope),
      observationDate: String(r.observation_date),
      rowKey: String(r.row_key),
      value: r.value === null || r.value === undefined ? null : Number(r.value),
      valueClass: String(r.value_class),
    })),
  }
}

/**
 * One staged row-history row, in the exact shape the RPC's `jsonb_to_recordset`
 * reads. Snake-cased for that reason, like every other RPC payload here.
 */
export interface RowHistoryStagedRow {
  scope: string
  observation_date: string
  row_key: string
  parent_row_key: string | null
  depth: number
  display_order: number
  row_type: string
  label_es: string
  label_en: string | null
  currency: string
  value: number | null
  value_class: string
  source_sheet: string
  source_cell: string
  source_row: number | null
  parser_version: string
  disposition: 'new' | 'gap_fill' | 'changed'
  /**
   * The pre-state the plan asserts, for an overwrite only. The RPC re-reads it
   * under the import lock and refuses the whole import if it has moved — and
   * writes the before-image it READ, never this one.
   */
  prior_value: number | null
  prior_value_class: string | null
}

interface StagingWriteShape {
  from: (t: string) => {
    insert: (rows: unknown[]) => Promise<{ error: { message?: string } | null }>
    delete: () => {
      eq: (col: string, v: string) => Promise<{ error: { message?: string } | null }>
    }
  }
}

/**
 * How many row-history rows travel in one staged chunk.
 *
 * At ~213 bytes of JSON per row a 2,000-row chunk is ~430 KB — comfortably
 * inside any HTTP body limit, while a first backfill of ~19,757 rows costs ten
 * requests. The size exists to make the transport boring; the import's
 * atomicity does not depend on it, because the RPC consumes every chunk inside
 * its own transaction.
 */
export const ROW_HISTORY_STAGE_CHUNK = 2000

/**
 * Stages one import's row history immediately before the import runs.
 *
 * WHY A RELAY AT ALL. A first backfill carries every clean frozen column the
 * workbook holds — 4.2 MB of JSON for the current book. Making the import's
 * success depend on whether that fits in one request body would tie a financial
 * write to a transport limit that says nothing about whether the data is right.
 *
 * These rows are TRANSPORT, NOT STATE. Nothing reads them but the import that
 * consumes and deletes them in the same transaction, and the RPC refuses to
 * proceed unless the number of staged rows matches the number the caller says
 * it staged — so a lost chunk is a refusal, never a partially written history.
 */
export async function stageRowHistory(
  stagingId: string,
  rows: readonly RowHistoryStagedRow[],
): Promise<{ ok: true; staged: number } | Fail> {
  const client = getSupabaseAdminClient() as never as StagingWriteShape | null
  if (!client) return { ok: false, code: 'not_configured' }
  if (rows.length === 0) return { ok: true, staged: 0 }

  const chunks = chunk([...rows], ROW_HISTORY_STAGE_CHUNK)
  for (let i = 0; i < chunks.length; i += 1) {
    const { error } = await client
      .from('portfolio_row_history_staging')
      .insert([{ staging_id: stagingId, chunk_index: i, rows: chunks[i] }])
    if (error) {
      // Leave nothing behind on a partial stage. The chunks are scratch, so a
      // failed cleanup is not itself a failure — the RPC's count check refuses
      // an incomplete relay, and the next import purges anything older than a day.
      await discardRowHistoryStaging(stagingId)
      return { ok: false, code: 'rpc_failed', reason: error.message ?? 'row_history_stage_failed' }
    }
  }
  return { ok: true, staged: rows.length }
}

/** Removes a staged batch the import never consumed. Best-effort by design. */
export async function discardRowHistoryStaging(stagingId: string): Promise<void> {
  const client = getSupabaseAdminClient() as never as StagingWriteShape | null
  if (!client) return
  await client.from('portfolio_row_history_staging').delete().eq('staging_id', stagingId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance history (POST-R13.8 FOLLOW-UP D)
// ─────────────────────────────────────────────────────────────────────────────

/** Four chained `order` calls, because the unique key has four components. */
interface PerformanceHistoryReadShape {
  from: (t: string) => {
    select: (c: string) => {
      order: (
        col: string,
        o: { ascending: boolean },
      ) => {
        order: (
          col: string,
          o: { ascending: boolean },
        ) => {
          order: (
            col: string,
            o: { ascending: boolean },
          ) => {
            order: (
              col: string,
              o: { ascending: boolean },
            ) => {
              range: (
                from: number,
                to: number,
              ) => Promise<{
                data:
                  | Array<{
                      scope: string
                      basis: string
                      metric: string
                      observation_date: string
                      value: number | null
                      value_class: string
                    }>
                  | null
                error: { message?: string } | null
              }>
            }
          }
        }
      }
    }
  }
}

/** One performance-history identity as Production holds it. */
export interface PersistedPerformanceHistoryRead {
  scope: string
  basis: string
  metric: string
  observationDate: string
  value: number | null
  valueClass: string
}

/**
 * Every performance-history identity Production holds, with its value and class.
 *
 * The same admin-client whole-book walk `listPersistedRowHistory` performs, and
 * for the same reason: planning an import is a whole-book operation an
 * already-authorized administrator performs across every scope, and it never
 * reaches a member surface.
 *
 * FOLLOW-UP F. It carried the same 5,000-row page and the same
 * short-page-is-the-end rule, and so read 1,000 of 2,260 identities against a
 * 1,000-row server cap.
 */
export async function listPersistedPerformanceHistory(): Promise<
  { ok: true; rows: PersistedPerformanceHistoryRead[] } | Fail
> {
  const client = getSupabaseAdminClient() as never as PerformanceHistoryReadShape | null
  if (!client) return { ok: false, code: 'not_configured' }

  // A TOTAL order, so paging is stable. `(observation_date, scope, basis,
  // metric)` is the unique key re-ordered — without every component a row can
  // sit on two pages or on none, and a missed identity reads as ABSENT, which
  // turns an ordinary re-upload into a fabricated insertion.
  const read = await readAllPages(() =>
    client
      .from('portfolio_performance_history')
      .select('scope, basis, metric, observation_date, value, value_class')
      .order('observation_date', { ascending: true })
      .order('scope', { ascending: true })
      .order('basis', { ascending: true })
      .order('metric', { ascending: true }),
  )
  if (!read.ok) return { ok: false, code: 'rpc_failed', reason: read.reason }

  return {
    ok: true,
    rows: read.rows.map((r) => ({
      scope: String(r.scope),
      basis: String(r.basis),
      metric: String(r.metric),
      observationDate: String(r.observation_date),
      value: r.value === null || r.value === undefined ? null : Number(r.value),
      valueClass: String(r.value_class),
    })),
  }
}

/**
 * One staged performance-history metric, in the exact shape the RPC's
 * `jsonb_to_recordset` reads. Snake-cased for that reason.
 */
export interface PerformanceHistoryStagedRow {
  scope: string
  basis: string
  metric: string
  observation_date: string
  value: number | null
  value_class: string
  source_sheet: string
  source_cell: string
  source_row: number | null
  parser_version: string
  disposition: 'new' | 'gap_fill' | 'changed'
  /**
   * The pre-state the plan asserts, for an overwrite only. The RPC re-reads it
   * under the import lock, refuses if it has moved, and writes the before-image
   * it READ rather than this one.
   */
  prior_value: number | null
  prior_value_class: string | null
}

/**
 * How many performance-history metrics travel in one staged chunk.
 *
 * A first backfill is ~2,260 metrics and ~0.85 MB, so this is one or two
 * requests rather than ten. It uses a relay anyway: one transport shape for both
 * histories is one thing to reason about, and "it still fits in a request body"
 * is not a property worth re-verifying each week.
 */
export const PERFORMANCE_HISTORY_STAGE_CHUNK = 2000

/** Stages one import's performance history immediately before the import runs. */
export async function stagePerformanceHistory(
  stagingId: string,
  rows: readonly PerformanceHistoryStagedRow[],
): Promise<{ ok: true; staged: number } | Fail> {
  const client = getSupabaseAdminClient() as never as StagingWriteShape | null
  if (!client) return { ok: false, code: 'not_configured' }
  if (rows.length === 0) return { ok: true, staged: 0 }

  const chunks = chunk([...rows], PERFORMANCE_HISTORY_STAGE_CHUNK)
  for (let i = 0; i < chunks.length; i += 1) {
    const { error } = await client
      .from('portfolio_performance_history_staging')
      .insert([{ staging_id: stagingId, chunk_index: i, rows: chunks[i] }])
    if (error) {
      await discardPerformanceHistoryStaging(stagingId)
      return {
        ok: false,
        code: 'rpc_failed',
        reason: error.message ?? 'performance_history_stage_failed',
      }
    }
  }
  return { ok: true, staged: rows.length }
}

/** Removes a staged batch the import never consumed. Best-effort by design. */
export async function discardPerformanceHistoryStaging(stagingId: string): Promise<void> {
  const client = getSupabaseAdminClient() as never as StagingWriteShape | null
  if (!client) return
  await client.from('portfolio_performance_history_staging').delete().eq('staging_id', stagingId)
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
 * R13.8D.1 — one already-published week this import re-publishes, in the exact
 * shape the RPC's `jsonb_to_recordset` reads.
 *
 * `prior_publication_id` is the revision the plan was compared against. The RPC
 * re-reads which revision is actually current under the publication lock and
 * refuses the whole import if it has moved — the same stale-plan discipline the
 * observation packet uses, applied to publications.
 */
export interface ImportHistoricalPublicationPayload {
  as_of_date: string
  prior_publication_id: string
  /**
   * Named `snapshot_rows`/`performance_rows`, not `rows`/`performance`: `ROWS`
   * is a reserved word in PostgreSQL, and the RPC reads this array through
   * `jsonb_to_recordset`, where a reserved column alias has to be quoted at
   * every use. A key that never needs quoting cannot be mis-quoted once.
   */
  snapshot_rows: SnapshotRowPayload[]
  performance_rows: PerformanceRowPayload[]
  /** Audit only — the DB re-derives whether the week genuinely differs. */
  difference_count: number
  /**
   * R13.8E — THE RESTATED WEEK'S OWN ANCHORS, read off its own frozen column.
   *
   * Before this, a restatement inherited the IMPORT's anchors, so the seven
   * weeks corrected in the first real catch-up import each recorded
   * `previousWeekDate = 2026-08-28` — a date two months AFTER the week it
   * claims to precede. The values were always right; only this metadata was
   * wrong, and the weekly surfaces read it as a financial basis.
   *
   * Null stays null. A column whose own anchor the parser could not resolve
   * records none, never a neighbour's.
   */
  previous_week_date: string | null
  beginning_of_year_date: string | null
}

/**
 * ONE upload → ONE import operation → ONE current publication → N history points
 * → M corrected historical publications.
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
  historicalPublications?: ImportHistoricalPublicationPayload[]
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
    p_historical_publications: params.historicalPublications ?? [],
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
      ) => {
        order: (
          col: string,
          o: { ascending: boolean },
        ) => {
          range: (
            from: number,
            to: number,
          ) => Promise<{
            data: Record<string, unknown>[] | null
            error: { message?: string } | null
          }>
        }
      }
    }
  }
}

/** The import ledger, newest first. Identifiers, dates and counts — no amounts. */
export async function listImportOperations(): Promise<
  { ok: true; operations: ImportOperationRecord[] } | Fail
> {
  const client = getSupabaseAdminClient() as never as ImportOperationsShape | null
  if (!client) return { ok: false, code: 'not_configured' }

  // The ledger only ever grows, so it is paged, on a TOTAL order: `created_at`
  // with `id` settling any tie (FOLLOW-UP F).
  const read = await readAllPages(() =>
    client
      .from('portfolio_import_operations')
      .select(
        'id, upload_id, as_of_date, publication_id, previous_publication_id, plan_version, ' +
          'counts, correction_authorized, correction_reason, created_at, rolled_back_at, rollback_note',
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }),
  )

  if (!read.ok) return { ok: false, code: 'rpc_failed', reason: refusalCodeOf(read.reason) }
  const operations = read.rows.map((r) => ({
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
  return { ok: true, operations }
}
