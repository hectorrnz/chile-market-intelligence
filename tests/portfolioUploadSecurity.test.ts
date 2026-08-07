// R13.2 — Family Portfolio upload security.
//
// Covers the doc 05 § 4 validation ladder, the hardened ZIP guards it relies
// on, and the opaque storage-key contract.
//
// NO REAL FINANCIAL DATA. Every fixture is a synthetic container built in
// memory from structural OOXML skeletons. No workbook, no real value, and no
// private input file is read, embedded, or committed by this suite.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'

import {
  validateUploadCandidate,
  sanitizeFilename,
  containsUnsafeXml,
  buildStorageObjectKey,
  isUploadKind,
  MAX_UPLOAD_BYTES,
  MAX_REQUEST_BYTES,
  MAX_XLSX_ENTRIES,
  XLSX_MIME,
  REJECTION_STATUS,
  type UploadCandidate,
} from '../src/lib/familyPortfolio/uploadValidation.ts'
import { unzip, MAX_ENTRY_COUNT } from '../src/lib/financials/xbrl/unzip.ts'
import { classifyPath, requiresApprovedSession } from '../src/lib/auth/accessPolicy.ts'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * Strips comments so an ORDERING assertion measures real statements.
 *
 * Without this, `indexOf('request.formData()')` matches the prose explaining
 * why the size screen must come first, which sits ABOVE the screen — inverting
 * the very ordering under test. Same convention as familyPortfolioBootstrap's
 * `codeOf`.
 */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const UPLOAD_ROUTE = 'src/app/api/family-portfolio/admin/uploads/route.ts'
const DETAIL_ROUTE = 'src/app/api/family-portfolio/admin/uploads/[id]/route.ts'
const REPO = 'src/lib/db/repositories/portfolioUploadRepository.ts'
const MIGRATION = 'supabase/migrations/20260807000000_family_portfolio_upload_storage.sql'

// ---------------------------------------------------------------------------
// In-memory ZIP builder — structural only, no workbook semantics
// ---------------------------------------------------------------------------

interface Part { name: string; content: string }

function makeZip(parts: Part[], opts: { declaredEntryCount?: number; thisDisk?: number; zip64?: boolean } = {}): Buffer {
  const localParts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const p of parts) {
    const nameBuf = Buffer.from(p.name, 'utf8')
    const raw = Buffer.from(p.content, 'utf8')
    const comp = deflateRawSync(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, comp)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)
    offset += local.length + nameBuf.length + comp.length
  }

  const cdBuf = Buffer.concat(central)
  const localBuf = Buffer.concat(localParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(opts.thisDisk ?? 0, 4)
  eocd.writeUInt16LE(0, 6)
  const count = opts.declaredEntryCount ?? parts.length
  eocd.writeUInt16LE(Math.min(count, 0xffff), 8)
  eocd.writeUInt16LE(opts.zip64 ? 0xffff : Math.min(count, 0xffff), 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(localBuf.length, 16)
  return Buffer.concat([localBuf, cdBuf, eocd])
}

const SHEET = '<worksheet><sheetData/></worksheet>'
const WORKBOOK = '<workbook><sheets><sheet name="RESUMEN" sheetId="1" r:id="rId1"/></sheets></workbook>'
const STYLES = '<styleSheet><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>'
const CONTENT_TYPES = '<Types><Default Extension="xml" ContentType="application/xml"/></Types>'

function validParts(extra: Part[] = []): Part[] {
  return [
    { name: '[Content_Types].xml', content: CONTENT_TYPES },
    { name: 'xl/workbook.xml', content: WORKBOOK },
    { name: 'xl/styles.xml', content: STYLES },
    { name: 'xl/worksheets/sheet1.xml', content: SHEET },
    ...extra,
  ]
}

function candidate(over: Partial<UploadCandidate> = {}): UploadCandidate {
  return {
    filename: 'weekly.xlsx',
    mimeType: XLSX_MIME,
    bytes: makeZip(validParts()),
    ...over,
  }
}

const DIGEST = 'a'.repeat(64)
const run = (c: UploadCandidate) => validateUploadCandidate(c, DIGEST)

// ---------------------------------------------------------------------------
// 1 - Happy path
// ---------------------------------------------------------------------------

describe('a well-formed .xlsx is accepted', () => {
  test('it passes the whole ladder and reports its digest and size', () => {
    const c = candidate()
    const r = run(c)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.sha256, DIGEST)
    assert.equal(r.sizeBytes, c.bytes.length)
    assert.equal(r.sanitizedFilename, 'weekly.xlsx')
    assert.ok(r.partNames.includes('xl/workbook.xml'))
  })

  test('a clean workbook produces no blocking finding', () => {
    const r = run(candidate())
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.findings.filter((f) => f.severity === 'blocking').length, 0)
  })
})

// ---------------------------------------------------------------------------
// 2 - Type, macro, and size rejections (checks 3, 4, 5)
// ---------------------------------------------------------------------------

describe('type and macro rejections', () => {
  test('a wrong MIME type is refused as unsupported_type', () => {
    const r = run(candidate({ mimeType: 'application/octet-stream' }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'unsupported_type')
    assert.equal(r.httpStatus, 415)
  })

  test('a non-.xlsx extension is refused', () => {
    const r = run(candidate({ filename: 'weekly.csv' }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'unsupported_type')
  })

  test('.xlsm reports macro_enabled_workbook, NOT the generic type error', () => {
    // The specific, security-relevant code must win over unsupported_type.
    const r = run(candidate({ filename: 'weekly.xlsm' }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'macro_enabled_workbook')
    assert.equal(r.httpStatus, 415)
  })

  for (const ext of ['xltm', 'xlsb']) {
    test(`.${ext} is refused as macro-enabled`, () => {
      const r = run(candidate({ filename: `weekly.${ext}` }))
      assert.equal(r.ok, false)
      if (r.ok) return
      assert.equal(r.code, 'macro_enabled_workbook')
    })
  }

  test('an .xlsx containing vbaProject.bin is still refused as macro-enabled', () => {
    // The extension proves nothing; the container is what matters.
    const bytes = makeZip(validParts([{ name: 'xl/vbaProject.bin', content: 'MZ-not-really' }]))
    const r = run(candidate({ bytes }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'macro_enabled_workbook')
  })

  test('an oversized file is refused before any parsing', () => {
    const r = run(candidate({ bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1) }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'file_too_large')
    assert.equal(r.httpStatus, 413)
  })

  test('an empty file is refused', () => {
    const r = run(candidate({ bytes: Buffer.alloc(0) }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'no_file')
  })
})

// ---------------------------------------------------------------------------
// 3 - Container rejections (checks 6-9)
// ---------------------------------------------------------------------------

describe('container rejections', () => {
  test('a non-ZIP payload is refused', () => {
    const r = run(candidate({ bytes: Buffer.from('this is plainly not a zip archive') }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'not_a_zip')
    assert.equal(r.httpStatus, 422)
  })

  test('a traversal entry name aborts the whole archive', () => {
    const bytes = makeZip(validParts([{ name: '../../escape.xml', content: '<a/>' }]))
    const r = run(candidate({ bytes }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'unsafe_entry_name')
  })

  test('an absolute entry name is refused', () => {
    const bytes = makeZip(validParts([{ name: '/etc/passwd', content: 'x' }]))
    const r = run(candidate({ bytes }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'unsafe_entry_name')
  })

  test('exceeding the xlsx entry-count ceiling is refused as a zip bomb', () => {
    const many: Part[] = []
    for (let i = 0; i < MAX_XLSX_ENTRIES + 5; i++) many.push({ name: `xl/p${i}.xml`, content: '<a/>' })
    const r = run(candidate({ bytes: makeZip(validParts(many)) }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'zip_bomb')
  })

  test('a multi-disk archive is refused', () => {
    const r = run(candidate({ bytes: makeZip(validParts(), { thisDisk: 1 }) }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'not_a_zip')
  })

  test('a Zip64 archive is refused rather than misread', () => {
    const r = run(candidate({ bytes: makeZip(validParts(), { zip64: true }) }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'not_a_zip')
  })
})

// ---------------------------------------------------------------------------
// 4 - Workbook shape and XML safety (checks 10, 11, 12)
// ---------------------------------------------------------------------------

describe('workbook shape and XML safety', () => {
  for (const missing of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml']) {
    test(`a container missing ${missing} is malformed`, () => {
      const parts = validParts().filter((p) => p.name !== missing)
      const r = run(candidate({ bytes: makeZip(parts) }))
      assert.equal(r.ok, false)
      if (r.ok) return
      assert.equal(r.code, 'malformed_workbook')
    })
  }

  test('a container with no worksheet part is malformed', () => {
    const parts = validParts().filter((p) => !p.name.startsWith('xl/worksheets/'))
    const r = run(candidate({ bytes: makeZip(parts) }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'malformed_workbook')
  })

  test('a DOCTYPE in any XML part is refused as unsafe_xml', () => {
    const parts = validParts()
    parts[3] = { name: 'xl/worksheets/sheet1.xml', content: '<!DOCTYPE x [<!ENTITY a "b">]><worksheet/>' }
    const r = run(candidate({ bytes: makeZip(parts) }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'unsafe_xml')
  })

  test('a DOCTYPE hidden in a .rels part is also refused', () => {
    const bytes = makeZip(validParts([{ name: 'xl/_rels/workbook.xml.rels', content: '<!DOCTYPE r><Relationships/>' }]))
    const r = run(candidate({ bytes }))
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'unsafe_xml')
  })

  test('containsUnsafeXml tolerates whitespace after the bang', () => {
    assert.equal(containsUnsafeXml('<!  DOCTYPE foo>'), true)
    assert.equal(containsUnsafeXml('<!ENTITY x "y">'), true)
    assert.equal(containsUnsafeXml('<worksheet><!-- a comment --></worksheet>'), false)
  })

  test('external links are recorded as a warning and never block', () => {
    const bytes = makeZip(validParts([{ name: 'xl/externalLinks/externalLink1.xml', content: '<externalLink/>' }]))
    const r = run(candidate({ bytes }))
    assert.equal(r.ok, true)
    if (!r.ok) return
    const w = r.findings.find((f) => f.code === 'external_links_present')
    assert.ok(w, 'an external-link warning must be recorded')
    assert.equal(w.severity, 'warning')
    assert.match(w.detail, /never resolved/i)
  })
})

// ---------------------------------------------------------------------------
// 5 - No content leakage
// ---------------------------------------------------------------------------

describe('no raw content leaks through a rejection', () => {
  test('a rejection never echoes part contents', () => {
    const secret = 'SENSITIVE-CELL-CONTENT-9f4c1e2a'
    const parts = validParts()
    parts[3] = { name: 'xl/worksheets/sheet1.xml', content: `<!DOCTYPE x><worksheet>${secret}</worksheet>` }
    const r = run(candidate({ bytes: makeZip(parts) }))
    assert.equal(r.ok, false)
    if (r.ok) return
    const serialized = JSON.stringify(r)
    assert.ok(!serialized.includes(secret), 'rejection payload must not contain part content')
  })

  test('every rejection code maps to a defined HTTP status', () => {
    for (const [code, status] of Object.entries(REJECTION_STATUS)) {
      assert.equal(typeof status, 'number', `${code} needs a status`)
      assert.ok(status >= 400 && status < 500, `${code} must be a 4xx`)
    }
  })
})

// ---------------------------------------------------------------------------
// 6 - Filename sanitisation and opaque storage keys
// ---------------------------------------------------------------------------

describe('filename sanitisation', () => {
  test('a path is reduced to its basename', () => {
    assert.equal(sanitizeFilename('C:\\Users\\x\\secret\\weekly.xlsx'), 'weekly.xlsx')
    assert.equal(sanitizeFilename('/var/tmp/weekly.xlsx'), 'weekly.xlsx')
  })

  test('control characters are stripped', () => {
    assert.equal(sanitizeFilename('week\u0000ly\u001b.xlsx'), 'weekly.xlsx')
  })

  test('an empty or fully-stripped name falls back to a safe default', () => {
    assert.equal(sanitizeFilename(''), 'upload.xlsx')
    assert.equal(sanitizeFilename('///'), 'upload.xlsx')
  })

  test('a very long name is truncated', () => {
    assert.ok(sanitizeFilename('a'.repeat(500) + '.xlsx').length <= 120)
  })
})

describe('storage object keys are opaque (doc 05 section 3.2)', () => {
  const UUID = '9f4c1e2a-1111-4222-8333-444455556666'

  test('the key carries kind, year and a uuid only', () => {
    assert.equal(buildStorageObjectKey('portfolio', 2026, UUID), `portfolio/2026/${UUID}.xlsx`)
  })

  test('the key never contains the original filename', () => {
    const key = buildStorageObjectKey('alternatives', 2026, UUID)
    assert.ok(!key.toLowerCase().includes('weekly'))
    assert.ok(!/resumen|jaime|andres|pablo/i.test(key))
  })

  test('a non-uuid is refused rather than silently used', () => {
    assert.throws(() => buildStorageObjectKey('portfolio', 2026, '../escape'))
  })

  test('only the two documented upload kinds exist', () => {
    assert.equal(isUploadKind('portfolio'), true)
    assert.equal(isUploadKind('alternatives'), true)
    assert.equal(isUploadKind('administrator'), false)
    assert.equal(isUploadKind(''), false)
  })
})

// ---------------------------------------------------------------------------
// 7 - The hardened reader keeps its previous defaults
// ---------------------------------------------------------------------------

describe('unzip hardening does not change existing callers', () => {
  test('the default entry ceiling is generous enough for existing archives', () => {
    assert.ok(MAX_ENTRY_COUNT >= 1024)
  })

  test('a small archive still unzips with no options passed', () => {
    const r = unzip(makeZip([{ name: 'a.xml', content: '<a/>' }]))
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.entries.length, 1)
  })
})

// ---------------------------------------------------------------------------
// 7b - Resource boundaries: no cap may be enforced only AFTER the allocation
// ---------------------------------------------------------------------------

describe('allocation happens behind a bound, not before one', () => {
  test('a lying central directory cannot drive an unbounded inflate', () => {
    // The declared uncompressed size is attacker-controlled. This archive
    // declares a tiny entry but expands far past the cap; the bound must come
    // from zlib's own maxOutputLength, not from the post-hoc running total.
    const huge = 'A'.repeat(4 * 1024 * 1024)
    const comp = deflateRawSync(Buffer.from(huge, 'utf8'))

    const nameBuf = Buffer.from('xl/bomb.xml', 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(64, 22) // LIE: claims 64 uncompressed bytes
    local.writeUInt16LE(nameBuf.length, 26)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(comp.length, 20)
    cd.writeUInt32LE(64, 24) // the same lie in the central directory
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(0, 42)

    const localBuf = Buffer.concat([local, nameBuf, comp])
    const cdBuf = Buffer.concat([cd, nameBuf])
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(cdBuf.length, 12)
    eocd.writeUInt32LE(localBuf.length, 16)

    const zip = Buffer.concat([localBuf, cdBuf, eocd])

    // The TOTAL cap is left deliberately high. With a low total, the old
    // post-hoc running-total check would also have returned `zip_bomb` — after
    // inflating the entry in full — and this test would pass without proving
    // anything. A high total means only a bound applied DURING decompression
    // (zlib's maxOutputLength) can reject this archive.
    const r = unzip(zip, {
      maxEntryUncompressedBytes: 1024,
      maxTotalUncompressedBytes: 64 * 1024 * 1024,
    })
    assert.equal(r.ok, false, 'a lying header must not be able to inflate past the per-entry cap')
    if (r.ok) return
    assert.equal(r.error.code, 'zip_bomb')
    assert.match(r.error.reason, /expands beyond/)
  })

  test('the route screens Content-Length BEFORE parsing the body', () => {
    const SRC = codeOf(read(UPLOAD_ROUTE))
    const headerAt = SRC.indexOf("headers.get('content-length')")
    const parseAt = SRC.indexOf('request.formData()')
    assert.ok(headerAt >= 0, 'the route must screen the declared request size')
    assert.ok(parseAt > headerAt,
      'formData() materialises the whole body — the size screen must precede it')
  })

  test('the authoritative size check precedes the second full copy', () => {
    const SRC = codeOf(read(UPLOAD_ROUTE))
    const sizeAt = SRC.indexOf('file.size > MAX_UPLOAD_BYTES')
    const bufferAt = SRC.indexOf('arrayBuffer()')
    assert.ok(sizeAt >= 0 && bufferAt > sizeAt,
      'file.size must be checked before arrayBuffer() copies the bytes again')
  })

  test('the request ceiling allows only a small envelope over the file cap', () => {
    assert.ok(MAX_REQUEST_BYTES > MAX_UPLOAD_BYTES, 'multipart overhead needs headroom')
    assert.ok(MAX_REQUEST_BYTES - MAX_UPLOAD_BYTES <= 1024 * 1024,
      'the envelope allowance must stay small — it is not a second file budget')
  })

  test('no source comment claims a check runs before an allocation it follows', () => {
    const SRC = read(UPLOAD_ROUTE)
    assert.doesNotMatch(SRC, /before buffering, so an oversized body is never/,
      'this comment was false: formData() had already buffered the body')
  })
})

// ---------------------------------------------------------------------------
// 8 - Route authorization (check 1)
// ---------------------------------------------------------------------------

describe('the admin upload routes are protected', () => {
  const routes = ['/api/family-portfolio/admin/uploads', '/api/family-portfolio/admin/uploads/abc']

  test('default-deny classifies them private_api — they are on no allowlist', () => {
    for (const r of routes) {
      assert.equal(classifyPath(r), 'private_api', `${r} must be private`)
      assert.equal(requiresApprovedSession(r), true, `${r} must require an approved session`)
    }
  })

  for (const [label, path] of [['upload', UPLOAD_ROUTE], ['detail', DETAIL_ROUTE]] as const) {
    const SRC = read(path)

    test(`the ${label} route exists and runs on the node runtime`, () => {
      assert.ok(existsSync(join(ROOT, path)))
      // node:zlib and node:crypto are unavailable on Edge.
      assert.match(SRC, /export const runtime = 'nodejs'/)
      assert.match(SRC, /export const dynamic = 'force-dynamic'/)
    })

    test(`the ${label} route guards the session BEFORE doing any work`, () => {
      assert.match(SRC, /guardPrivateApi\(\)/)
      // Comments are stripped so this measures statements, not prose.
      const CODE = codeOf(SRC)
      const guardAt = CODE.indexOf('guardPrivateApi()')
      const adminAt = CODE.indexOf('isAdministrator')
      assert.ok(guardAt >= 0 && adminAt > guardAt, 'the administrator check must follow the session guard')
    })

    test(`the ${label} route refuses a non-administrator with 403 not_authorized`, () => {
      // Either shape is fine: a literal `status: 403` or the `fail(code, 403, …)`
      // helper. What matters is that the refusal is a 403 carrying that code.
      assert.match(SRC, /not_authorized/)
      assert.match(SRC, /(status: 403|'not_authorized', 403)/)
    })

    test(`the ${label} route never caches a response`, () => {
      assert.match(SRC, /no-store/i)
    })
  }

  test('the upload route reads the file only after authorising', () => {
    const SRC = codeOf(read(UPLOAD_ROUTE))
    const adminAt = SRC.indexOf('isAdministrator')
    const bodyAt = SRC.indexOf('formData()')
    assert.ok(adminAt >= 0 && bodyAt > adminAt,
      'an unauthorised caller must never cause the body to be parsed')
  })
})

// ---------------------------------------------------------------------------
// 9 - Secrets and content hygiene
// ---------------------------------------------------------------------------

describe('no secret or raw content escapes', () => {
  const sources = [UPLOAD_ROUTE, DETAIL_ROUTE, REPO].map((p) => [p, read(p)] as const)

  test('no source file embeds a service-role key or exposes one to the client', () => {
    for (const [name, src] of sources) {
      assert.doesNotMatch(src, /NEXT_PUBLIC_SUPABASE_SERVICE/i, `${name} must not expose the service key`)
      assert.doesNotMatch(src, /eyJ[A-Za-z0-9_-]{20,}/, `${name} must not embed a JWT`)
    }
  })

  test('the routes never log the uploaded bytes or a parser exception', () => {
    for (const [name, src] of sources) {
      assert.doesNotMatch(src, /console\.(log|info|debug)\s*\(/, `${name} must not log`)
      assert.doesNotMatch(src, /console\.error\s*\([^)]*bytes/, `${name} must not log file bytes`)
    }
  })

  test('the repository never returns a raw provider error message to the caller', () => {
    const src = read(REPO)
    // Provider messages can carry object keys and internal detail; the module
    // maps them to fixed, code-derived strings instead.
    assert.match(src, /detail: 'the file could not be stored'/)
    assert.match(src, /detail: 'the upload could not be recorded'/)
  })

  test('the service-role repository is never reachable from a client bundle', () => {
    // The repository imports the service-role admin client. Any 'use client'
    // file importing it — directly or through a re-export — would pull the
    // service key into the browser bundle.
    const src = read(REPO)
    assert.doesNotMatch(src, /^'use client'/m, 'the repository must never be a client module')
    assert.match(src, /SERVER-ONLY/i, 'it must carry the repo-wide server-only marker')

    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(e.name)) continue
        const body = readFileSync(full, 'utf8')
        if (!/^['"]use client['"]/m.test(body)) continue
        if (/portfolioUploadRepository|supabase\/admin/.test(body)) {
          offenders.push(full.replace(ROOT, ''))
        }
      }
    }
    walk(join(ROOT, 'src'))
    assert.deepEqual(offenders, [], `client components must not import service-role code: ${offenders.join(', ')}`)
  })

  test('an object path can never be supplied by the caller', () => {
    // The detail route accepts an upload UUID and resolves the storage path
    // from the row. A caller-supplied path would let one signed URL reach any
    // object in the bucket, bypassing the row-level lookup entirely.
    const src = read(DETAIL_ROUTE)
    assert.doesNotMatch(src, /storage_object_path|storageObjectPath/,
      'the route must not accept or echo a storage path')
    assert.match(src, /\[0-9a-f\]\{8\}-/, 'the id must be shape-validated as a UUID')

    const repo = read(REPO)
    assert.match(repo, /\.eq\('id', uploadId\)/,
      'the signed URL path must be resolved from the row, never from caller input')
  })

  test('a rejection never returns a storage key, SQL detail, or internal path', () => {
    for (const [name, src] of sources) {
      assert.doesNotMatch(src, /error\.message/, `${name} must not surface a provider message`)
      assert.doesNotMatch(src, /\bstack\b/, `${name} must not surface a stack trace`)
    }
    const detail = read(DETAIL_ROUTE)
    // The error branch returns only the code.
    assert.match(detail, /NextResponse\.json\(\{ error: result\.code \}/)
  })

  test('the signed URL is short-lived and minted server-side only', () => {
    const src = read(REPO)
    assert.match(src, /SIGNED_URL_TTL_SECONDS = \d+/)
    const ttl = Number(/SIGNED_URL_TTL_SECONDS = (\d+)/.exec(src)?.[1])
    assert.ok(ttl > 0 && ttl <= 300, `signed URL TTL must be short, got ${ttl}s`)
    assert.doesNotMatch(src, /getPublicUrl/, 'a private bucket must never mint a public URL')
  })
})

// ---------------------------------------------------------------------------
// 10 - Migration posture (structural; executed for real by the pgTAP suite)
// ---------------------------------------------------------------------------

describe('the R13.2 migration establishes the documented posture', () => {
  const SQL = read(MIGRATION)

  test('both tables are created with RLS enabled', () => {
    assert.match(SQL, /create table if not exists public\.portfolio_source_uploads/)
    assert.match(SQL, /create table if not exists public\.portfolio_upload_findings/)
    assert.match(SQL, /alter table public\.portfolio_source_uploads\s+enable row level security/)
    assert.match(SQL, /alter table public\.portfolio_upload_findings enable row level security/)
  })

  test('only SELECT policies exist — every write is service-role', () => {
    const policies = SQL.match(/create policy[\s\S]*?;/g) ?? []
    assert.ok(policies.length > 0, 'the migration must create policies')
    for (const p of policies) {
      assert.match(p, /for select/, `a non-SELECT policy exists: ${p.slice(0, 80)}`)
    }
    assert.doesNotMatch(SQL, /for (insert|update|delete)\s+to authenticated/i)
  })

  test('administrator read is resolved through the R13.1 helper, not a hardcoded identity', () => {
    assert.match(SQL, /using \(public\.nmi_is_administrator\(\)\)/)
    assert.doesNotMatch(SQL, /@|jaime@|andres@|pablo@/,
      'no email or hardcoded identity may appear in the migration')
  })

  test('duplicate detection is a database guarantee', () => {
    assert.match(SQL, /unique \(upload_kind, file_sha256\)/)
  })

  test('the storage bucket is created private and never made public', () => {
    assert.match(SQL, /'portfolio-source-uploads'/)
    assert.match(SQL, /public\)\s*\n?\s*values \('portfolio-source-uploads', 'portfolio-source-uploads', false\)/)
    assert.match(SQL, /do update set public = false/)
  })

  test('it asserts its own end state rather than assuming it', () => {
    assert.match(SQL, /raise exception/)
    assert.match(SQL, /has_table_privilege\('authenticated'/)
    assert.match(SQL, /has_table_privilege\('anon'/)
    assert.match(SQL, /bucket is PUBLIC/)
  })

  test('it guards on R13.1 being applied first', () => {
    assert.match(SQL, /nmi_is_administrator\(\)' \) is null|to_regprocedure\('public\.nmi_is_administrator\(\)'\)/)
  })

  test('the pgTAP suite executes the upload posture under real RLS', () => {
    const PG = read('supabase/tests/database/family_portfolio_entitlements_test.sql')
    assert.match(PG, /portfolio_source_uploads/)
    assert.match(PG, /an ordinary user reads NO upload rows/)
    assert.match(PG, /CANNOT forge an upload row/)
    assert.match(PG, /bucket exists and is PRIVATE/)
    assert.match(PG, /not vacuous/)
  })

  test('storage is enabled in the local config so the bucket assertions can run', () => {
    const CFG = read('supabase/config.toml')
    assert.match(CFG, /\[storage\][\s\S]{0,400}?enabled = true/)
  })
})
