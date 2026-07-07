// Phase 9A — POST /api/structured-notes/extract
// Accepts an uploaded PDF (multipart/form-data, field "file"), extracts terms
// deterministically, records an extraction-run audit row, and returns the
// preview payload for review-before-import. Never persists a note here.
//
// Security: authenticated-only (middleware); server-side parsing; PDF MIME +
// size limit; the raw PDF is never stored or echoed back to the client.

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getSupabaseUserClient } from '@/lib/supabase/server'
import { extractPdfPages } from '@/lib/structuredNotes/pdf/pdfText'
import { extractStructuredNoteTerms } from '@/lib/structuredNotes/pdf/extractStructuredNoteTerms'
import { classifyReviewState } from '@/lib/structuredNotes/pdf/parsers/shared'
import { recordExtractionRun } from '@/lib/db/repositories/structuredNotesRepository'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(request: NextRequest): Promise<NextResponse> {
  const client = await getSupabaseUserClient()
  if (!client) return NextResponse.json({ error: 'Not configured' }, { status: 503 })

  let file: File | null = null
  try {
    const form = await request.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 })
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!isPdf) return NextResponse.json({ error: 'unsupported_type', detail: 'Only PDF term sheets are supported.' }, { status: 415 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file_too_large', detail: 'Max 10 MB.' }, { status: 413 })

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'read_failed' }, { status: 400 })
  }
  const fileHash = createHash('sha256').update(bytes).digest('hex')
  const fileName = sanitizeFileName(file.name)

  let pages: string[]
  let possiblyScanned = false
  try {
    const res = await extractPdfPages(bytes)
    pages = res.pages
    possiblyScanned = res.possiblyScanned
  } catch {
    return NextResponse.json({ error: 'pdf_parse_failed', detail: 'Could not read the PDF text layer.' }, { status: 422 })
  }

  if (possiblyScanned) {
    return NextResponse.json(
      { error: 'no_text_layer', detail: 'This PDF appears to be scanned (no extractable text). OCR is not supported in this phase.' },
      { status: 422 },
    )
  }

  const result = extractStructuredNoteTerms(pages, { fileName })
  const unsupported = result.errors.some((e) => e.includes('unsupported issuer format'))
  const reviewState = classifyReviewState(result.ok, result.confidenceScore, result.fieldsLowConfidence, unsupported)

  // Audit every extraction attempt (dry-run and successful alike). parserVersion
  // is per-extraction (e.g. "9C.creditAgricole.1"), not a single app-wide constant —
  // it reflects whichever issuer parser the router actually dispatched to.
  const runId = await recordExtractionRun(client, {
    fileName,
    fileHash,
    parserVersion: result.parserVersion,
    status: result.ok ? 'extracted' : 'needs_review',
    confidenceScore: result.confidenceScore,
    fieldsSeen: result.fieldsSeen,
    fieldsExtracted: result.fieldsExtracted,
    fieldsLowConfidence: result.fieldsLowConfidence,
    warnings: result.warnings,
    errors: result.errors,
    extractedPayload: result.note,
  })

  return NextResponse.json({
    extractionRunId: runId,
    fileHash,
    parserVersion: result.parserVersion,
    ok: result.ok,
    confidenceScore: result.confidenceScore,
    note: result.note,
    fields: result.fields,
    warnings: result.warnings,
    errors: result.errors,
    // Explicit review flag: low overall confidence or any missing critical field.
    needsReview: !result.ok || result.confidenceScore < 0.9,
    // 'ready' | 'review_recommended' | 'review_required' | 'unsupported' — see classifyReviewState.
    reviewState,
  })
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '_').slice(0, 200)
}
