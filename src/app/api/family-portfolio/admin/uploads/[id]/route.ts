// GET /api/family-portfolio/admin/uploads/[id]
//
// R13.2 — administrator-only retrieval of one upload's metadata, plus a
// SHORT-LIVED signed URL for the stored workbook (doc 05 § 3.1). The bucket is
// private and carries no `authenticated` storage policy, so this server-minted
// URL is the only way to reach an object. It is minted only after the caller is
// confirmed an administrator, and it expires in SIGNED_URL_TTL_SECONDS.
//
// R13.5 — the same route now also returns the DRAFT REVIEW: the material an
// administrator needs to decide whether to publish (doc 08 Stage 5, "draft
// preview API"). It is folded in here rather than given its own path because
// doc 05 § 7.4's binding route table has exactly one per-upload GET, and a draft
// is a property of that upload rather than a separate resource.
//
// THE REVIEW CARRIES NO AMOUNTS — counts, cell references, row labels and
// pass/fail only. See `draftReview.ts` for why. The workbook is re-parsed on
// every request and the derived draft is never cached.
//
// `?draft=0` skips the parse for a caller that only wants the download link, so
// listing an upload never pays for a full workbook parse it will not read.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { createUploadSignedUrl, SIGNED_URL_TTL_SECONDS } from '@/lib/db/repositories/portfolioUploadRepository'
import { buildDraftReview } from '@/lib/familyPortfolio/draftReview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guardPrivateApi()
  if (denied) return denied

  const entitlement = await getFamilyPortfolioEntitlement()
  if (!entitlement.isAdministrator) {
    return NextResponse.json(
      { error: 'not_authorized', detail: 'administrative capability is required' },
      { status: 403, headers: NO_STORE },
    )
  }

  const { id } = await context.params
  // Validate the shape before it reaches the database, so a malformed id is a
  // clean 404 rather than a driver error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  const result = await createUploadSignedUrl(id)
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'not_configured' ? 503 : 500
    return NextResponse.json({ error: result.code }, { status, headers: NO_STORE })
  }

  const wantDraft = new URL(request.url).searchParams.get('draft') !== '0'
  const reviewed = wantDraft ? await buildDraftReview(id) : null

  return NextResponse.json(
    {
      uploadId: result.upload.id,
      uploadKind: result.upload.uploadKind,
      originalFilename: result.upload.originalFilename,
      fileSha256: result.upload.fileSha256,
      fileSizeBytes: result.upload.fileSizeBytes,
      status: result.upload.status,
      uploadedAt: result.upload.uploadedAt,
      downloadUrl: result.url,
      downloadUrlExpiresInSeconds: SIGNED_URL_TTL_SECONDS,
      // Null when the parse could not run at all (e.g. the object is gone). A
      // null draft is honestly absent rather than an empty one that would read
      // as "nothing wrong with this workbook".
      draft: reviewed && reviewed.ok ? reviewed.review : null,
      draftError: reviewed && !reviewed.ok ? reviewed.code : null,
    },
    { headers: NO_STORE },
  )
}
