// Server-side text-decoding utilities for BCCh API responses.
//
// BCCh SieteRestWS serves JSON in UTF-8 but declares Content-Type with
// charset=iso-8859-1 (or no charset), causing res.json() / res.text() to
// decode multi-byte UTF-8 sequences as Latin-1 and produce Mojibake like
// "Ã³" instead of "ó".
//
// The strategy is: attempt strict UTF-8 decoding first. If the bytes form
// valid UTF-8, use that result regardless of what the Content-Type header
// says (common for misconfigured Spanish government APIs). Only fall back
// to the declared charset when UTF-8 validation fails.
//
// No credentials are read, logged, or returned by this module.

/** Extract the charset from a Content-Type header value. Defaults to 'utf-8'. */
export function charsetFromContentType(ct: string | null): string {
  if (!ct) return 'utf-8'
  const m = /charset\s*=\s*([^\s;,]+)/i.exec(ct)
  return m ? m[1].trim() : 'utf-8'
}

/** True when more than 0.5 % of characters are Unicode replacement chars (U+FFFD). */
function looksGarbled(s: string): boolean {
  if (s.length === 0) return false
  const count = (s.match(/�/g) ?? []).length
  return count / s.length > 0.005
}

/**
 * Decode a fetch Response body into a string, sniffing UTF-8 before trusting
 * the Content-Type charset declaration.
 *
 * Strategy:
 *   1. Try strict UTF-8 (fatal: true). If the bytes are valid UTF-8, return
 *      that result — BCCh often sends UTF-8 content despite claiming iso-8859-1.
 *   2. Try the charset declared in Content-Type (e.g. iso-8859-1).
 *   3. If that looks garbled (high U+FFFD density), fall back to ISO-8859-1.
 *   4. Last resort: UTF-8 with replacement characters (never throws).
 *
 * The caller is responsible for not logging the URL (which may carry creds).
 */
export async function decodeResponseText(res: Response): Promise<string> {
  const ct = res.headers.get('content-type')
  const declaredCharset = charsetFromContentType(ct)
  const buf = await res.arrayBuffer()

  // 1. Prefer UTF-8 if the bytes are valid UTF-8 — ignores a wrong charset header.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    // Not valid UTF-8; fall through to the declared charset.
  }

  // 2. Try the charset declared in Content-Type.
  try {
    const decoded = new TextDecoder(declaredCharset, { fatal: false }).decode(buf)
    if (!looksGarbled(decoded)) return decoded
  } catch {
    // Unknown charset name — fall through.
  }

  // 3. ISO-8859-1 covers most Latin-1 / Windows-1252 content.
  const latin1 = new TextDecoder('iso-8859-1').decode(buf)
  if (!looksGarbled(latin1)) return latin1

  // 4. Last resort: UTF-8 with replacement (always succeeds).
  return new TextDecoder('utf-8', { fatal: false }).decode(buf)
}

/**
 * Normalize a Spanish text string for accent-insensitive keyword matching.
 *
 * - Strips combining diacritical marks (U+0300–U+036F) so "dólar" === "dolar".
 * - Lowercases.
 * - Collapses whitespace.
 *
 * Both the API series title AND the keyword pattern should be run through this
 * function before comparison to ensure consistent matching regardless of whether
 * the source contains accented or unaccented characters.
 */
export function normalizeSearchText(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip combining diacritical marks (U+0300–U+036F)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
