// Phase 8C.2 — minimal, dependency-free ZIP reader for CMF XBRL archives.
//
// The CMF financial-statement download (safec_ifrs_verarchivo.php) returns a
// ZIP archive containing the `.xbrl` instance document plus its companion
// `.xsd`/`.xml` taxonomy files (verified live: e.g. COPEC 12/2023 →
// `90690000_202312_C.xbrl` + `_C.xsd` + `-definition.xml`, all DEFLATE). This
// was THE blocker in Phase 8C.1: the provider downloaded a real ZIP but had no
// way to unzip it (no zip dependency was added).
//
// This module unzips without any new dependency — it parses the ZIP central
// directory and inflates each entry with Node's built-in `node:zlib`
// (`inflateRawSync`), which handles the raw DEFLATE streams ZIP entries use
// (compression method 8). Method 0 (stored/uncompressed) is also handled.
//
// Scope is deliberately narrow: this is NOT a general ZIP library. It targets
// the small, well-formed, single-disk archives CMF serves. Anything it does
// not understand fails closed with a structured error, never a guess.
//
// SECURITY (server-only; every guard fails closed):
//   - Entry names are validated: no absolute paths, no `..` traversal, no
//     backslashes, no NUL bytes, no drive letters. A suspicious name aborts
//     the whole extraction (we never partially trust an archive).
//   - Total uncompressed size is capped (MAX_TOTAL_UNCOMPRESSED_BYTES) to
//     avoid a zip-bomb. Per-entry uncompressed size is also capped.
//   - Nothing is ever written to disk here — extraction is fully in-memory.
//   - Only compression methods 0 (stored) and 8 (deflate) are accepted.

import { inflateRawSync } from 'node:zlib'

const LOCAL_FILE_HEADER_SIG = 0x04034b50
const CENTRAL_DIR_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

/** A single archive-bomb-sane cap: a real CMF instance is ~2–3 MB; the whole archive uncompressed is well under this. */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 64 * 1024 * 1024 // 64 MB
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 48 * 1024 * 1024 // 48 MB
/** The compressed ZIP we accept downloading — a hard ceiling well above the ~250 KB real archives. */
export const MAX_ZIP_BYTES = 32 * 1024 * 1024 // 32 MB

export interface ZipEntry {
  /** Entry name exactly as stored (already validated safe). */
  name: string
  /** Lower-cased file extension without the dot, e.g. "xbrl", "xsd", "xml", or "" if none. */
  ext: string
  /** Decompressed bytes. */
  data: Buffer
}

export type UnzipErrorCode =
  | 'not_a_zip'
  | 'too_large'
  | 'malformed'
  | 'unsupported_compression'
  | 'unsafe_entry_name'
  | 'zip_bomb'

export interface UnzipError {
  code: UnzipErrorCode
  reason: string
}

export type UnzipResult = { ok: true; entries: ZipEntry[] } | { ok: false; error: UnzipError }

/** A ZIP begins with the local-file-header signature "PK\x03\x04". */
export function looksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === LOCAL_FILE_HEADER_SIG
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/**
 * Rejects any entry name that could escape an extraction root or otherwise
 * looks hostile. We never actually write to disk, but validating the name is
 * cheap defense-in-depth against a future caller that does, and against a
 * maliciously-crafted archive masquerading as a CMF filing.
 */
function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false
  if (name.includes('\0')) return false
  if (name.includes('\\')) return false // backslash — Windows path separator / traversal
  if (name.startsWith('/')) return false // absolute POSIX path
  if (/^[A-Za-z]:/.test(name)) return false // Windows drive letter
  // Split on '/' and reject any '..' segment (or a leading empty segment).
  const segments = name.split('/')
  for (const seg of segments) {
    if (seg === '..') return false
  }
  return true
}

/**
 * Parses and inflates a ZIP archive fully in memory. Reads the End Of Central
 * Directory record, walks the central directory, and inflates each entry from
 * its local header. Directory entries (names ending in '/') are skipped.
 */
export function unzip(buf: Buffer): UnzipResult {
  if (buf.length > MAX_ZIP_BYTES) {
    return { ok: false, error: { code: 'too_large', reason: `archive is ${buf.length} bytes, over the ${MAX_ZIP_BYTES}-byte cap` } }
  }
  if (!looksLikeZip(buf)) {
    return { ok: false, error: { code: 'not_a_zip', reason: 'missing ZIP local-file-header signature (PK\\x03\\x04)' } }
  }

  // Find the End Of Central Directory record by scanning backwards for its
  // signature (it lives near the end, after an optional variable-length
  // comment). 22 is the fixed EOCD size.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) return { ok: false, error: { code: 'malformed', reason: 'no End Of Central Directory record found' } }

  const entryCount = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)
  if (cdOffset >= buf.length) return { ok: false, error: { code: 'malformed', reason: 'central directory offset out of range' } }

  const entries: ZipEntry[] = []
  let totalUncompressed = 0

  for (let n = 0; n < entryCount; n++) {
    if (cdOffset + 46 > buf.length || buf.readUInt32LE(cdOffset) !== CENTRAL_DIR_SIG) {
      return { ok: false, error: { code: 'malformed', reason: `bad central-directory header at entry ${n}` } }
    }
    const method = buf.readUInt16LE(cdOffset + 10)
    const compSize = buf.readUInt32LE(cdOffset + 20)
    const uncompSize = buf.readUInt32LE(cdOffset + 24)
    const nameLen = buf.readUInt16LE(cdOffset + 28)
    const extraLen = buf.readUInt16LE(cdOffset + 30)
    const commentLen = buf.readUInt16LE(cdOffset + 32)
    const localHeaderOffset = buf.readUInt32LE(cdOffset + 42)
    const name = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8')
    cdOffset += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // directory entry — no data

    if (!isSafeEntryName(name)) {
      return { ok: false, error: { code: 'unsafe_entry_name', reason: `entry name failed safety validation: "${name.slice(0, 80)}"` } }
    }
    if (uncompSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      return { ok: false, error: { code: 'zip_bomb', reason: `entry "${name}" declares ${uncompSize} uncompressed bytes, over the per-entry cap` } }
    }
    if (method !== 0 && method !== 8) {
      return { ok: false, error: { code: 'unsupported_compression', reason: `entry "${name}" uses compression method ${method} (only 0/stored and 8/deflate are supported)` } }
    }

    // Read the local file header to find where this entry's data starts (the
    // local header has its own name/extra lengths, which can differ from the
    // central-directory copy).
    if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIG) {
      return { ok: false, error: { code: 'malformed', reason: `bad local file header for "${name}"` } }
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26)
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28)
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
    const dataEnd = dataStart + compSize
    if (dataEnd > buf.length) {
      return { ok: false, error: { code: 'malformed', reason: `entry "${name}" data extends past end of archive` } }
    }
    const compressed = buf.subarray(dataStart, dataEnd)

    let data: Buffer
    if (method === 0) {
      data = Buffer.from(compressed)
    } else {
      try {
        data = inflateRawSync(compressed)
      } catch (e) {
        return { ok: false, error: { code: 'malformed', reason: `failed to inflate "${name}": ${e instanceof Error ? e.message.slice(0, 120) : 'unknown'}` } }
      }
    }

    totalUncompressed += data.length
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      return { ok: false, error: { code: 'zip_bomb', reason: `total uncompressed size exceeded ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes` } }
    }

    entries.push({ name, ext: extOf(name), data })
  }

  return { ok: true, entries }
}

/**
 * Picks the XBRL *instance* document from an archive's entries. The instance
 * is the `.xbrl` file (CMF names it `<rut>_<period>_C.xbrl`). Companion
 * `.xsd`/`.xml` taxonomy/definition files are NOT instance documents.
 *
 * Returns null when the archive contains no `.xbrl` entry — this is exactly
 * how a taxonomy-only ZIP (the blank schema packs from CMF's taxonomy download
 * pages, which carry only `.xsd`/`.xml`) is rejected: it has no instance, so
 * it must never be treated as a financial filing.
 */
export function findXbrlInstance(entries: ZipEntry[]): ZipEntry | null {
  const xbrlEntries = entries.filter((e) => e.ext === 'xbrl')
  if (xbrlEntries.length === 0) return null
  // If more than one (not expected for CMF), prefer the largest — the instance
  // is far larger than any stray file.
  return xbrlEntries.reduce((a, b) => (b.data.length > a.data.length ? b : a))
}

/** True when an archive has taxonomy/schema files but no `.xbrl` instance — a taxonomy-only pack that is NOT a financial filing. */
export function isTaxonomyOnlyArchive(entries: ZipEntry[]): boolean {
  const hasInstance = entries.some((e) => e.ext === 'xbrl')
  const hasTaxonomy = entries.some((e) => e.ext === 'xsd' || e.ext === 'xml')
  return !hasInstance && hasTaxonomy
}
