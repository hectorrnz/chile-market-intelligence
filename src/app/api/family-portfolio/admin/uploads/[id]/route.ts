// R13.2 — GET /api/family-portfolio/admin/uploads/[id]
//
// Administrator-only retrieval of one upload's metadata, plus a SHORT-LIVED
// signed URL for the stored workbook (doc 05 § 3.1).
//
// The bucket is private and carries no `authenticated` storage policy, so this
// server-minted URL is the only way to reach an object. It is minted only after
// the caller is confirmed an administrator, and it expires in
// SIGNED_URL_TTL_SECONDS.

import { NextResponse } from 'next/server'

import { guardPrivateApi } from '@/lib/auth/apiGuard'
import { getFamilyPortfolioEntitlement } from '@/lib/portfolioAccess/getEntitlement'
import { createUploadSignedUrl, SIGNED_URL_TTL_SECONDS } from '@/lib/db/repositories/portfolioUploadRepository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
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
  // clean 400 rather than a driver error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  }

  const result = await createUploadSignedUrl(id)
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'not_configured' ? 503 : 500
    return NextResponse.json({ error: result.code }, { status, headers: NO_STORE })
  }

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
    },
    { headers: NO_STORE },
  )
}
