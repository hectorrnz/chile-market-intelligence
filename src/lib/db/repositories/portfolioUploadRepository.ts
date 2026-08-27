// R13.2 — Family Portfolio upload persistence.
//
// SERVER-ONLY. Never import from a client component.
//
// Every write here uses the SERVICE-ROLE client, which is correct and
// deliberate: the R13.2 migration grants `authenticated` only SELECT on both
// tables and defines no insert/update/delete policy, so there is no user-scoped
// write path by construction. The authorization decision is made BEFORE this
// module is reached — the route runs `guardPrivateApi()` and then
// `callerIsAdministrator()`. This module never decides who may write.
//
// It also never decides WHETHER a file is acceptable. That is
// `uploadValidation.ts`'s job, and the route runs it first.

import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import type { UploadFinding, UploadKind } from '@/lib/familyPortfolio/uploadValidation'

/** Bucket from doc 05 § 3.1. Private; never public; never given an `authenticated` policy. */
export const UPLOAD_BUCKET = 'portfolio-source-uploads'

/** Signed-URL lifetime (doc 05 § 3.1 — "short-lived"). Long enough to click, short enough to be useless if leaked. */
export const SIGNED_URL_TTL_SECONDS = 60

/** Recorded on every upload so a later parser change is traceable (doc 08 Stage 3). */
export const PARSER_VERSION = 'r13.2.upload-only'

export interface StoredUpload {
  id: string
  uploadKind: UploadKind
  storageObjectPath: string
  originalFilename: string
  fileSha256: string
  fileSizeBytes: number
  uploadedAt: string
  status: string
}

export type UploadWriteResult =
  | { ok: true; upload: StoredUpload; findingsPersisted: boolean }
  | { ok: false; code: 'not_configured' | 'duplicate_upload' | 'storage_failed' | 'write_failed'; detail: string }

/** Postgres unique-violation. This is how check 13 surfaces from the database. */
const UNIQUE_VIOLATION = '23505'

/**
 * True when a digest has already been ingested for this kind.
 *
 * This is a courtesy pre-check so the caller gets a clean 409 without uploading
 * bytes to storage first. It is NOT the guarantee — the unique constraint is,
 * and `persistUpload` still maps a 23505 to `duplicate_upload` in case two
 * requests race past this check.
 */
export async function findUploadByDigest(
  uploadKind: UploadKind,
  sha256: string,
): Promise<{ ok: true; existing: StoredUpload | null } | { ok: false; code: 'not_configured' }> {
  const client = getSupabaseAdminClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data } = await (client as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>
          }
        }
      }
    }
  })
    .from('portfolio_source_uploads')
    .select('id, upload_kind, storage_object_path, original_filename, file_sha256, file_size_bytes, uploaded_at, status')
    .eq('upload_kind', uploadKind)
    .eq('file_sha256', sha256)
    .maybeSingle()

  return { ok: true, existing: data ? toStoredUpload(data) : null }
}

function toStoredUpload(row: Record<string, unknown>): StoredUpload {
  return {
    id: String(row.id),
    uploadKind: row.upload_kind as UploadKind,
    storageObjectPath: String(row.storage_object_path),
    originalFilename: String(row.original_filename),
    fileSha256: String(row.file_sha256),
    fileSizeBytes: Number(row.file_size_bytes),
    uploadedAt: String(row.uploaded_at),
    status: String(row.status),
  }
}

/**
 * Uploads the bytes to the private bucket, then records the metadata row and
 * any findings.
 *
 * ATOMICITY — what is and is not guaranteed.
 *
 * Supabase Storage and Postgres share no transaction, so a genuine two-phase
 * commit is not available and is not claimed. The design instead makes the ONE
 * reachable inconsistency harmless, and compensates for the rest:
 *
 *   Storage fails            → nothing is written. Clean.
 *   Storage ok, insert fails → the object is explicitly removed (compensation),
 *                              then the failure is reported.
 *   Storage ok, insert ok,
 *   process dies between     → an orphaned object remains.
 *
 * That last case is the residual risk, and it is INERT rather than merely
 * unlikely: the bucket is private, carries no `authenticated` storage policy,
 * and the only way to mint a signed URL is `createUploadSignedUrl`, which
 * resolves the object path FROM a `portfolio_source_uploads` row. With no row,
 * no code path can name the object, so it is unreachable by any caller. It
 * consumes storage; it does not expose data.
 *
 * The inverse — a row pointing at an object that was never stored — is what an
 * administrator WOULD notice, because they could click it and get nothing. That
 * is why storage is written first and the database second, not the reverse.
 *
 * If the compensating remove itself fails, the result is the same inert orphan;
 * it is deliberately not retried in the request path.
 */
export async function persistUpload(params: {
  uploadKind: UploadKind
  storageObjectPath: string
  originalFilename: string
  fileSha256: string
  bytes: Buffer
  uploadedBy: string
  findings: UploadFinding[]
}): Promise<UploadWriteResult> {
  const client = getSupabaseAdminClient()
  if (!client) return { ok: false, code: 'not_configured', detail: 'storage and database are not configured' }

  const storage = (client as never as {
    storage: {
      from: (b: string) => {
        upload: (p: string, d: Buffer, o: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>
        remove: (p: string[]) => Promise<{ error: unknown }>
        createSignedUrl: (p: string, s: number) => Promise<{ data: { signedUrl?: string } | null; error: unknown }>
      }
    }
  }).storage

  const up = await storage.from(UPLOAD_BUCKET).upload(params.storageObjectPath, params.bytes, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: false,
  })
  if (up.error) {
    // The provider message can name the object key but never file content.
    return { ok: false, code: 'storage_failed', detail: 'the file could not be stored' }
  }

  const table = (client as never as {
    from: (t: string) => {
      insert: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        select: (c: string) => { single: () => Promise<{ data: Record<string, unknown> | null; error: { code?: string } | null }> }
      } & Promise<{ error: { code?: string } | null }>
    }
  })

  const inserted = await table
    .from('portfolio_source_uploads')
    .insert({
      upload_kind: params.uploadKind,
      storage_object_path: params.storageObjectPath,
      original_filename: params.originalFilename,
      file_sha256: params.fileSha256,
      file_size_bytes: params.bytes.length,
      uploaded_by: params.uploadedBy,
      parser_version: PARSER_VERSION,
      status: 'received',
    })
    .select('id, upload_kind, storage_object_path, original_filename, file_sha256, file_size_bytes, uploaded_at, status')
    .single()

  if (inserted.error || !inserted.data) {
    await storage.from(UPLOAD_BUCKET).remove([params.storageObjectPath])
    if (inserted.error?.code === UNIQUE_VIOLATION) {
      return { ok: false, code: 'duplicate_upload', detail: 'this workbook has already been uploaded for this kind' }
    }
    return { ok: false, code: 'write_failed', detail: 'the upload could not be recorded' }
  }

  const upload = toStoredUpload(inserted.data)

  // Findings are recorded AFTER the upload row exists (they reference it). A
  // failure here is not worth destroying a valid upload over — the object and
  // its metadata row are consistent with each other either way — but it must
  // not be reported as success. `findingsPersisted` is returned so the caller
  // states what actually happened instead of echoing the in-memory list as
  // though the database had accepted it.
  let findingsPersisted = true
  if (params.findings.length > 0) {
    const written = await table.from('portfolio_upload_findings').insert(
      params.findings.map((f) => ({
        upload_id: upload.id,
        severity: f.severity,
        code: f.code,
        source_sheet: f.sourcePart ?? null,
        detail: f.detail,
      })),
    )
    findingsPersisted = !written.error
  }

  return { ok: true, upload, findingsPersisted }
}

/**
 * Mints a short-lived signed URL for an upload (doc 05 § 3.1).
 *
 * The caller must already have been confirmed an administrator. No public URL
 * is ever generated for this bucket.
 */
export async function createUploadSignedUrl(
  uploadId: string,
): Promise<{ ok: true; url: string; upload: StoredUpload } | { ok: false; code: 'not_configured' | 'not_found' | 'sign_failed' }> {
  const client = getSupabaseAdminClient()
  if (!client) return { ok: false, code: 'not_configured' }

  const { data } = await (client as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>
        }
      }
    }
  })
    .from('portfolio_source_uploads')
    .select('id, upload_kind, storage_object_path, original_filename, file_sha256, file_size_bytes, uploaded_at, status')
    .eq('id', uploadId)
    .maybeSingle()

  if (!data) return { ok: false, code: 'not_found' }
  const upload = toStoredUpload(data)

  const signed = await (client as never as {
    storage: {
      from: (b: string) => {
        createSignedUrl: (p: string, s: number) => Promise<{ data: { signedUrl?: string } | null; error: unknown }>
      }
    }
  }).storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(upload.storageObjectPath, SIGNED_URL_TTL_SECONDS)

  const url = signed.data?.signedUrl
  if (!url) return { ok: false, code: 'sign_failed' }
  return { ok: true, url, upload }
}
