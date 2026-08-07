// R13.2 — Family Portfolio upload validation ladder (doc 05 § 4).
//
// PURE MODULE. No Next.js, Supabase, environment, or filesystem import — so it
// is directly unit-testable under `node --test` and is consumed identically by
// the route handler and by the tests. It never touches the network and never
// writes anything.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO:
//   - It does not authenticate. Check 1 (approved administrator) is enforced by
//     the route via `guardPrivateApi()` + `callerIsAdministrator()`; a pure
//     module must never be the authorization boundary.
//   - It does not look up prior uploads. Check 13 (SHA-256 duplicate) needs the
//     database, so this module COMPUTES the digest and the route compares it.
//   - It does not parse the workbook. Stage 2 accepts, validates, hashes and
//     stores; RESUMEN/Alternatives parsing is Stage 3/4.
//
// NO RAW CONTENT ESCAPES. Every rejection carries a structured code and a
// code-derived message. Cell values, cell contents, and parser exception text
// never appear in a finding, a return value, or a log line. Where a part name
// is useful for an administrator to act on, the PART NAME is included — never
// its contents.

import { unzip, type ZipEntry } from '../financials/xbrl/unzip.ts'

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Doc 05 § 4 check 5. The sample workbook is ~450 KB; this is headroom without inviting abuse. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024 // 20 MB

/**
 * The whole multipart request may exceed the file by the size of the MIME
 * envelope (boundaries, part headers, the `uploadKind` field). This is the
 * ceiling screened against `Content-Length` BEFORE the body is parsed, so it
 * allows a small, fixed allowance over the file cap rather than being an
 * independent limit.
 */
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024 // 20 MB + 64 KB envelope

/**
 * Doc 05 § 4 check 9 — entry-count ceiling, tightened for `.xlsx` specifically.
 *
 * A workbook part count scales with sheets, styles, relationships and media. A
 * few hundred is already generous for the source workbooks R13 ingests; beyond
 * that it is not the file we are being asked to accept.
 */
export const MAX_XLSX_ENTRIES = 512

/** The only MIME type an `.xlsx` may present (doc 05 § 4 check 3). */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Extensions that can carry executable macros — refused outright (doc 05 § 4 check 4). */
export const MACRO_ENABLED_EXTENSIONS = ['.xlsm', '.xltm', '.xlsb'] as const

/** The ZIP member that proves an embedded VBA project regardless of extension. */
export const VBA_PROJECT_ENTRY = 'vbaproject.bin'

/** Parts every well-formed `.xlsx` must carry (doc 05 § 4 check 10). */
export const REQUIRED_XLSX_PARTS = ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml'] as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UploadKind = 'portfolio' | 'alternatives'

export const UPLOAD_KINDS: readonly UploadKind[] = ['portfolio', 'alternatives'] as const

export function isUploadKind(v: unknown): v is UploadKind {
  return typeof v === 'string' && (UPLOAD_KINDS as readonly string[]).includes(v)
}

/** Structured rejection codes. These are the ONLY strings a client ever sees. */
export type UploadRejectionCode =
  | 'no_file'
  | 'unsupported_type'
  | 'macro_enabled_workbook'
  | 'file_too_large'
  | 'not_a_zip'
  | 'unsafe_entry_name'
  | 'unsupported_compression'
  | 'zip_bomb'
  | 'malformed_workbook'
  | 'unsafe_xml'

/** HTTP status per rejection code, exactly as doc 05 § 4 specifies. */
export const REJECTION_STATUS: Record<UploadRejectionCode, number> = {
  no_file: 400,
  unsupported_type: 415,
  macro_enabled_workbook: 415,
  file_too_large: 413,
  not_a_zip: 422,
  unsafe_entry_name: 422,
  unsupported_compression: 422,
  zip_bomb: 422,
  malformed_workbook: 422,
  unsafe_xml: 422,
}

export type FindingSeverity = 'blocking' | 'warning' | 'info'

export interface UploadFinding {
  severity: FindingSeverity
  code: string
  /** Code-derived message. NEVER a cell value, amount, or raw part content. */
  detail: string
  /** Part name within the container, when it helps an administrator act. */
  sourcePart?: string
}

export interface UploadCandidate {
  filename: string
  mimeType: string
  bytes: Buffer
}

export interface UploadAccepted {
  ok: true
  sha256: string
  sizeBytes: number
  sanitizedFilename: string
  /** Part names observed in the container. Names only — never content. */
  partNames: string[]
  findings: UploadFinding[]
}

export interface UploadRejected {
  ok: false
  code: UploadRejectionCode
  httpStatus: number
  /** Code-derived message, safe to return to the client. */
  detail: string
  findings: UploadFinding[]
}

export type UploadValidationResult = UploadAccepted | UploadRejected

function reject(code: UploadRejectionCode, detail: string, findings: UploadFinding[] = []): UploadRejected {
  return {
    ok: false,
    code,
    httpStatus: REJECTION_STATUS[code],
    detail,
    findings: [...findings, { severity: 'blocking', code, detail }],
  }
}

// ---------------------------------------------------------------------------
// Filename handling
// ---------------------------------------------------------------------------

/**
 * Reduces a client-supplied filename to a safe display value.
 *
 * The result is stored in a database column for administrator display only —
 * it NEVER becomes part of the storage object key (doc 05 § 3.2 requires an
 * opaque key), so this cannot influence where anything is written.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  const cleaned = base
    // Control characters (incl. NUL) are stripped first so a filename can never
    // corrupt a log line or terminate a C-style string downstream.
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^A-Za-z0-9 ._()-]/g, '_')
    .trim()
  const safe = cleaned.length > 0 ? cleaned : 'upload.xlsx'
  return safe.length > 120 ? safe.slice(0, 120) : safe
}

function lowerExt(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot).toLowerCase()
}

// ---------------------------------------------------------------------------
// XML safety
// ---------------------------------------------------------------------------

/**
 * Doc 05 § 4 check 11 — XXE / entity-expansion defence.
 *
 * A DOCTYPE is the entry point for both external-entity resolution and the
 * "billion laughs" expansion attack. A legitimate OOXML part never carries one,
 * so any occurrence is refused rather than sanitized. Matching allows the
 * whitespace an attacker may insert after `<!`.
 */
const DOCTYPE_OR_ENTITY = /<!\s*(DOCTYPE|ENTITY)/i

export function containsUnsafeXml(text: string): boolean {
  return DOCTYPE_OR_ENTITY.test(text)
}

/** Parts whose bytes are XML and therefore must be scanned for check 11. */
function isXmlPart(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.xml') || n.endsWith('.rels')
}

/** Doc 05 § 4 check 12 — external-link parts live under `xl/externalLinks/`. */
function isExternalLinkPart(name: string): boolean {
  return name.toLowerCase().startsWith('xl/externallinks/')
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * Runs doc 05 § 4 checks 3–12 over a candidate upload and computes the SHA-256
 * needed for check 13.
 *
 * ORDERING NOTE — deliberate deviation from the table's numbering. Check 4
 * (macro-enabled) is evaluated BEFORE check 3 (extension/MIME) for the
 * *extension* half. A `.xlsm` satisfies neither, and returning the generic
 * `unsupported_type` would tell an administrator only that the type was wrong,
 * hiding the security-relevant fact that they uploaded a macro-enabled
 * workbook. The more specific and more alarming code wins.
 *
 * `sha256` is injected rather than imported so this module stays free of
 * `node:crypto` and remains trivially testable; the route passes the real hash.
 */
export function validateUploadCandidate(
  candidate: UploadCandidate,
  sha256: string,
): UploadValidationResult {
  const findings: UploadFinding[] = []
  const ext = lowerExt(candidate.filename)

  // --- Check 4a (macro-enabled by extension) — before check 3, see note above.
  if ((MACRO_ENABLED_EXTENSIONS as readonly string[]).includes(ext)) {
    return reject('macro_enabled_workbook', `macro-enabled workbook extension "${ext}" is not accepted`)
  }

  // --- Check 3 (extension AND MIME).
  if (ext !== '.xlsx') {
    return reject('unsupported_type', 'only .xlsx workbooks are accepted')
  }
  if (candidate.mimeType !== XLSX_MIME) {
    return reject('unsupported_type', 'declared content type is not the .xlsx media type')
  }

  // --- Check 5 (size). Checked before any parsing so an oversized upload is
  // never inflated in memory.
  if (candidate.bytes.length === 0) {
    return reject('no_file', 'the uploaded file is empty')
  }
  if (candidate.bytes.length > MAX_UPLOAD_BYTES) {
    return reject('file_too_large', `file exceeds the ${MAX_UPLOAD_BYTES}-byte limit`)
  }

  // --- Checks 6–9 (ZIP validity, entry-name safety, compression, bomb caps).
  // Delegated to the hardened reader, which fails closed on each.
  const archive = unzip(candidate.bytes, {
    maxEntries: MAX_XLSX_ENTRIES,
    maxZipBytes: MAX_UPLOAD_BYTES,
  })
  if (!archive.ok) {
    const mapped: UploadRejectionCode =
      archive.error.code === 'not_a_zip' ? 'not_a_zip'
        : archive.error.code === 'unsafe_entry_name' ? 'unsafe_entry_name'
        : archive.error.code === 'unsupported_compression' ? 'unsupported_compression'
        : archive.error.code === 'zip_bomb' ? 'zip_bomb'
        : archive.error.code === 'too_large' ? 'file_too_large'
        : 'malformed_workbook'
    // The reader's `reason` describes STRUCTURE (entry names, sizes, methods),
    // never workbook content, so it is safe to surface. It is still passed
    // through a fixed code so a client can branch without parsing prose.
    return reject(mapped, archive.error.reason)
  }

  const entries: ZipEntry[] = archive.entries
  const partNames = entries.map((e) => e.name)
  const lowerNames = partNames.map((n) => n.toLowerCase())

  // --- Check 4b (macro-enabled by content). An `.xlsx` extension proves
  // nothing: the container is what matters.
  const vbaIndex = lowerNames.findIndex((n) => n === VBA_PROJECT_ENTRY || n.endsWith(`/${VBA_PROJECT_ENTRY}`))
  if (vbaIndex >= 0) {
    return reject('macro_enabled_workbook', 'the container carries an embedded VBA project')
  }

  // --- Check 10 (required parts).
  for (const required of REQUIRED_XLSX_PARTS) {
    if (!lowerNames.includes(required.toLowerCase())) {
      return reject('malformed_workbook', `required workbook part is missing: ${required}`)
    }
  }
  // At least one worksheet must exist. Binding a SPECIFIC target sheet requires
  // resolving workbook.xml relationships, which is Stage 3 parsing work — Stage
  // 2 asserts only that the container is structurally a workbook.
  if (!lowerNames.some((n) => n.startsWith('xl/worksheets/') && n.endsWith('.xml'))) {
    return reject('malformed_workbook', 'the workbook contains no worksheet part')
  }

  // --- Check 11 (XXE / entity expansion) across every XML part.
  for (const entry of entries) {
    if (!isXmlPart(entry.name)) continue
    if (containsUnsafeXml(entry.data.toString('utf8'))) {
      return reject('unsafe_xml', 'an XML part declares a DOCTYPE or ENTITY, which is never accepted', findings)
    }
  }

  // --- Check 12 (external links) — RECORDED, never resolved. This is a
  // warning, not a rejection: the sample workbook proves external links are
  // routinely present. Nothing in R13 ever follows one.
  for (const name of partNames) {
    if (isExternalLinkPart(name)) {
      findings.push({
        severity: 'warning',
        code: 'external_links_present',
        detail: 'an external-link part is present; it is recorded and ignored, never resolved',
        sourcePart: name,
      })
    }
  }

  return {
    ok: true,
    sha256,
    sizeBytes: candidate.bytes.length,
    sanitizedFilename: sanitizeFilename(candidate.filename),
    partNames,
    findings,
  }
}

// ---------------------------------------------------------------------------
// Storage object key (doc 05 § 3.2) — opaque by construction
// ---------------------------------------------------------------------------

/**
 * Builds the storage object key: `<upload_kind>/<yyyy>/<uuid>.xlsx`.
 *
 * The key carries NO original filename, principal name, portfolio date, or
 * financial hint — object keys leak through logs, error messages and signed
 * URLs. `uuid` and `year` are injected so this stays pure and deterministic
 * under test.
 */
export function buildStorageObjectKey(kind: UploadKind, year: number, uuid: string): string {
  if (!isUploadKind(kind)) throw new Error('unknown upload kind')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new Error('storage object key requires a UUID')
  }
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('storage object key requires a four-digit year')
  }
  return `${kind}/${year}/${uuid}.xlsx`
}
