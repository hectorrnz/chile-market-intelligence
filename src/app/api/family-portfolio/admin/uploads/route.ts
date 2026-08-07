// R13.2 — POST /api/family-portfolio/admin/uploads
//
// Accepts, validates, hashes and privately stores a source workbook.
// It PARSES NOTHING: turning an upload into a draft is Stage 3/4.
//
// Doc 05 § 4's ladder runs in order, and check 1 (approved administrator) is
// enforced here before a single byte of the body is read — an unauthorized
// caller must never be able to make this route do work, let alone learn whether
// a digest already exists.
//
// NO RAW CONTENT LEAVES THE SERVER. Responses carry a structured code and a
// code-derived message. No cell value, no part content, and no exception text
// is ever returned or logged.

import { NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import {
  validateUploadCandidate,
  buildStorageObjectKey,
  isUploadKind,
  MAX_UPLOAD_BYTES,
  MAX_REQUEST_BYTES,
} from '@/lib/familyPortfolio/uploadValidation'
import { persistUpload, findUploadByDigest } from '@/lib/db/repositories/portfolioUploadRepository'

// `node:zlib` and `node:crypto` are unavailable on Edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

function fail(code: string, status: number, detail: string) {
  return NextResponse.json({ error: code, detail }, { status, headers: NO_STORE })
}

export async function POST(request: Request) {
  // --- Check 1: approved session, then administrative capability.
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  if (!entitlement.isAdministrator || !entitlement.userId) {
    // Deliberately identical to any other non-administrator refusal: a caller
    // learns nothing about whether the route or the resource exists.
    return fail('not_authorized', 403, 'administrative capability is required')
  }

  // --- Check 5a: declared request size, BEFORE the body is parsed.
  //
  // This ordering is the whole point. `request.formData()` materialises the
  // ENTIRE body — the workbook included — into memory. Any size check placed
  // after it protects nothing: the allocation has already happened. So the
  // Content-Length header is screened first.
  //
  // Content-Length is client-supplied and absent under chunked transfer, so it
  // is a FIRST-LINE bound, not the guarantee. The guarantees behind it are the
  // exact `file.size` / byte-length checks below, and the platform's own body
  // ceiling. A request that lies low and sends more still meets those.
  const declaredLength = Number(request.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return fail('file_too_large', 413, `file exceeds the ${MAX_UPLOAD_BYTES}-byte limit`)
  }

  // --- Check 2: a file field must be present.
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail('no_file', 400, 'the request body is not multipart form data')
  }

  const kindRaw = form.get('uploadKind')
  if (!isUploadKind(kindRaw)) {
    return fail('unsupported_type', 415, 'uploadKind must be "portfolio" or "alternatives"')
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return fail('no_file', 400, 'a file field is required')
  }

  // --- Check 5b: the authoritative size bound.
  //
  // Unlike the header screen above, `file.size` is measured from the bytes that
  // actually arrived, so a lying or absent Content-Length cannot get past it.
  // It runs before `arrayBuffer()` so the SECOND full-size copy is never taken.
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail('file_too_large', 413, `file exceeds the ${MAX_UPLOAD_BYTES}-byte limit`)
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  // --- Checks 3-12.
  const verdict = validateUploadCandidate(
    { filename: file.name, mimeType: file.type, bytes },
    sha256,
  )
  if (!verdict.ok) {
    return fail(verdict.code, verdict.httpStatus, verdict.detail)
  }

  // --- Check 13: duplicate detection. The unique constraint is the real
  // guarantee; this pre-check just avoids storing bytes we would then discard.
  const existing = await findUploadByDigest(kindRaw, sha256)
  if (!existing.ok) {
    return fail('not_configured', 503, 'upload storage is not configured')
  }
  if (existing.existing) {
    return NextResponse.json(
      {
        error: 'duplicate_upload',
        detail: 'this workbook has already been uploaded for this kind',
        existingUploadId: existing.existing.id,
      },
      { status: 409, headers: NO_STORE },
    )
  }

  const stored = await persistUpload({
    uploadKind: kindRaw,
    storageObjectPath: buildStorageObjectKey(kindRaw, new Date().getUTCFullYear(), randomUUID()),
    originalFilename: verdict.sanitizedFilename,
    fileSha256: sha256,
    bytes,
    uploadedBy: entitlement.userId,
    findings: verdict.findings,
  })

  if (!stored.ok) {
    const status = stored.code === 'duplicate_upload' ? 409 : stored.code === 'not_configured' ? 503 : 500
    return fail(stored.code, status, stored.detail)
  }

  return NextResponse.json(
    {
      uploadId: stored.upload.id,
      uploadKind: stored.upload.uploadKind,
      originalFilename: stored.upload.originalFilename,
      fileSha256: stored.upload.fileSha256,
      fileSizeBytes: stored.upload.fileSizeBytes,
      status: stored.upload.status,
      uploadedAt: stored.upload.uploadedAt,
      // Warnings only — a blocking finding would have returned above.
      findings: verdict.findings,
      // Reported honestly: the upload itself is valid either way, but the
      // caller must not be told the findings were recorded if they were not.
      findingsPersisted: stored.findingsPersisted,
    },
    { status: 201, headers: NO_STORE },
  )
}
