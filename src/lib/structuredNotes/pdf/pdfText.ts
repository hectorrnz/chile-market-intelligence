// Phase 9A — server-only PDF text extraction wrapper.
//
// Thin adapter over `unpdf` (a serverless-friendly build of pdf.js) that
// returns per-page text in reading order. Kept separate from the deterministic
// term parser (extractStructuredNoteTerms.ts) so the parser can be unit-tested
// against a text fixture without a PDF binary or the pdf.js dependency.
//
// Deterministic text extraction only — NO OCR (that would require a scanned
// document and a different toolchain, out of scope for this phase) and NO AI.

import { extractText, getDocumentProxy } from 'unpdf'

export interface PdfTextResult {
  totalPages: number
  /** One entry per page; each is the page's text with items newline-separated. */
  pages: string[]
  /** True when at least one page yielded no extractable text (likely scanned → would need OCR). */
  possiblyScanned: boolean
}

/** Extracts per-page text from a PDF buffer. Throws only on a genuinely corrupt/non-PDF input. */
export async function extractPdfPages(data: Uint8Array): Promise<PdfTextResult> {
  const pdf = await getDocumentProxy(data)
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = (Array.isArray(text) ? text : [text]).map((t) => (typeof t === 'string' ? t : ''))
  const nonEmpty = pages.filter((p) => p.trim().length > 0).length
  return {
    totalPages,
    pages,
    // If a multi-page doc extracted almost no text, it is probably a scan.
    possiblyScanned: totalPages > 0 && nonEmpty === 0,
  }
}
