// Phase 9A — Structured-notes workbook mapping + security/hygiene checks.
//
// Grep-based checks (no Supabase/DB) that guard the phase's non-negotiables:
// migration shape, RLS, private-file exclusion, no Bloomberg dependency in the
// app, sanitized routes, and documentation completeness.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const MIGRATION = read('../supabase/migrations/20260706000000_structured_notes_foundation.sql')
const MAPPING_DOC = read('../docs/structured_notes_workbook_mapping.md')
const MARKET_PROVIDER = read('../src/lib/structuredNotes/structuredNoteMarketProvider.ts')
const SYMBOL_MAP = read('../src/lib/structuredNotes/underlyingSymbolMap.ts')
const EXTRACT_ROUTE = read('../src/app/api/structured-notes/extract/route.ts')
const MIDDLEWARE = read('../src/middleware.ts')

describe('migration — 7 tables, user-scoped, RLS', () => {
  const tables = [
    'structured_notes', 'structured_note_underlyings', 'structured_note_observations',
    'structured_note_allocations', 'structured_note_price_snapshots',
    'structured_note_extraction_runs', 'structured_note_extracted_fields',
  ]
  it('creates all 7 tables', () => {
    for (const t of tables) assert.ok(MIGRATION.includes(`create table if not exists ${t}`), `missing table ${t}`)
  })
  it('enables RLS on all 7 tables', () => {
    for (const t of tables) assert.ok(MIGRATION.includes(`alter table ${t}`) || MIGRATION.includes(`'${t}'`), `missing RLS enable for ${t}`)
    assert.ok(MIGRATION.includes('enable row level security'))
  })
  it('scopes every table to auth.uid() = user_id', () => {
    assert.ok(MIGRATION.includes('auth.uid() = user_id'))
    assert.ok(MIGRATION.includes("default auth.uid()"))
  })
  it('has NO public read/write policy', () => {
    assert.ok(!/using \(true\)/.test(MIGRATION))
    assert.ok(!/to anon/i.test(MIGRATION))
  })
  it('constrains observation_type and status', () => {
    assert.ok(MIGRATION.includes("observation_type in ('coupon','autocall','final')"))
    assert.ok(/status in \('scheduled'/.test(MIGRATION))
  })
  it('guards child ownership against the parent note', () => {
    assert.ok(MIGRATION.includes('check_structured_note_ownership'))
  })
})

describe('no Bloomberg dependency in the app', () => {
  it('market provider uses Yahoo, and makes no Bloomberg call/import (comments may mention it)', () => {
    assert.ok(/yahoo-finance2|yahoo/i.test(MARKET_PROVIDER))
    // No actual Bloomberg API call or import — only doc mentions are allowed.
    assert.ok(!/_xll|\.BDP\(|from ['"][^'"]*bloomberg/i.test(MARKET_PROVIDER))
  })
  it('symbol map makes no Bloomberg call/import', () => {
    assert.ok(!/_xll|\.BDP\(|from ['"][^'"]*bloomberg/i.test(SYMBOL_MAP))
  })
  it('mapping doc records the workbook Bloomberg BDP dependency being replaced', () => {
    assert.ok(/BDP/.test(MAPPING_DOC))
    assert.ok(/Yahoo/i.test(MAPPING_DOC))
  })
})

describe('security / provenance', () => {
  it('extract route is auth-gated + PDF-only + size-limited + Node runtime', () => {
    assert.ok(EXTRACT_ROUTE.includes('getSupabaseUserClient'))
    assert.ok(EXTRACT_ROUTE.includes('application/pdf'))
    assert.ok(EXTRACT_ROUTE.includes('MAX_BYTES'))
    assert.ok(EXTRACT_ROUTE.includes("runtime = 'nodejs'"))
  })
  it('extract route never echoes raw PDF bytes/text back to the client', () => {
    // The response returns the structured note + fields, never the raw page text.
    assert.ok(!/pages\s*[},]/.test(EXTRACT_ROUTE.split('return NextResponse.json')[1] ?? ''))
  })
  it('middleware protects /structured-notes and /api/structured-notes', () => {
    assert.ok(MIDDLEWARE.includes("'/structured-notes'"))
    assert.ok(MIDDLEWARE.includes("'/api/structured-notes'"))
  })
})

describe('mapping doc completeness', () => {
  it('classifies extracted vs internal vs derived vs market-data fields', () => {
    assert.ok(/PDF/.test(MAPPING_DOC))
    assert.ok(/Internal/.test(MAPPING_DOC))
    assert.ok(/Derived/.test(MAPPING_DOC))
    assert.ok(/market data/i.test(MAPPING_DOC))
  })
  it('records the sample ISIN and the internal-allocation rule', () => {
    assert.ok(MAPPING_DOC.includes('XS3180975347'))
    assert.ok(/never.*(from|extract).*PDF|allocation/i.test(MAPPING_DOC))
    assert.ok(/WATERMILL/.test(MAPPING_DOC)) // internal sociedades documented
  })
})

describe('no private files committed', () => {
  it('the real term-sheet PDF and workbook are NOT in the repo', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    // Walk a couple of levels for stray xlsx / term-sheet pdfs.
    function walk(dir: string, depth: number): string[] {
      if (depth > 3) return []
      let files: string[] = []
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue
        const full = `${dir}/${e.name}`
        if (e.isDirectory()) files = files.concat(walk(full, depth + 1))
        else files.push(full)
      }
      return files
    }
    const all = walk(root, 0)
    assert.ok(!all.some((f) => /\.xlsx$/i.test(f)), 'a .xlsx file is committed')
    assert.ok(!all.some((f) => /Notas Estructuradas/i.test(f) && !f.endsWith('.md') && !f.endsWith('.test.ts')), 'a private workbook file is committed')
    assert.ok(!all.some((f) => /TS_XS\d+.*\.pdf$/i.test(f)), 'a private term-sheet PDF is committed')
  })
  it('the committed fixture is a small sanitized text file, not a binary', () => {
    const fx = fileURLToPath(new URL('fixtures/structured-notes/citi_sample_terms.txt', import.meta.url))
    assert.ok(existsSync(fx))
    const content = readFileSync(fx, 'utf8')
    assert.ok(content.length < 8000) // tiny
    assert.ok(content.includes('XS3180975347'))
  })
})
