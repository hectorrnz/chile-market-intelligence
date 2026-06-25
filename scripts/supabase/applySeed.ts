// Phase 5B.1 — Apply seed data via Supabase admin client.
// Usage: npm run supabase:seed
// Uses the service-role key (SUPABASE_SERVICE_ROLE_KEY) to bypass RLS.
// Idempotent — checks existing rows before inserting.
//
// If you get PGRST205 "schema cache" errors, PostgREST needs a reload:
//   Supabase Dashboard → Project Settings → API → Reload schema
// Then retry this script.
//
// Alternatively, paste supabase/seed.sql into Supabase Dashboard → SQL Editor.

import pkg from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const ROOT = join(import.meta.dirname, '../..')

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T
}

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
const url = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''

if (!url || !svcKey) {
  console.error('[supabase:seed] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set.')
  process.exit(2)
}

const db = createClient(url, svcKey, { auth: { autoRefreshToken: false, persistSession: false } })

interface Company {
  ticker: string; name: string; legalName?: string; sector?: string
  industry?: string; exchange?: string; currency?: string; country: string; active: boolean
}

interface MacroIndicator {
  id: string; region: string; name: string; shortName?: string
  category?: string; unit?: string; source?: string
}

function schemaHint(code: string | undefined): string {
  if (code === 'PGRST205') {
    return '\n  → PostgREST schema cache is stale. Fix:\n' +
      '    1. Go to Supabase Dashboard → Project Settings → API → click "Reload schema"\n' +
      '    2. Retry: npm run supabase:seed\n' +
      '    Alternative: paste supabase/seed.sql into Dashboard → SQL Editor'
  }
  return ''
}

async function countRows(table: string): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (db.from as any)(table).select('*', { count: 'exact', head: true })
  if (error) {
    console.error(`[supabase:seed] ${table} count [${error.code ?? '?'}]: ${error.message}${schemaHint(error.code)}`)
    return null
  }
  return count ?? 0
}

async function main() {
  console.log('[supabase:seed] Connecting to:', url.replace(/^(https:\/\/[^.]+).*/, '$1…'))
  console.log('[supabase:seed] Starting seed...')

  // ─── data_sources ───────────────────────────────────────────────────────────
  // data_sources has no unique constraint on provider — plain insert, skip if already seeded.
  const dsCount = await countRows('data_sources')
  if (dsCount === null) { process.exit(1) }
  if (dsCount === 0) {
    const { error } = await db.from('data_sources').insert([
      { provider: 'static',     source_type: 'static', display_name: 'Static MVP Data',                base_url: null,                                                     status: 'active',   metadata: { static_mvp: true } },
      { provider: 'bcch',       source_type: 'api',    display_name: 'Banco Central de Chile BDE',     base_url: 'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx', status: 'inactive', metadata: { static_mvp: true } },
      { provider: 'cmf',        source_type: 'scrape', display_name: 'CMF Chile',                      base_url: 'https://www.cmfchile.cl',                                status: 'inactive', metadata: { static_mvp: true } },
      { provider: 'brain_data', source_type: 'api',    display_name: 'Brain Data / Bolsa de Santiago', base_url: null,                                                     status: 'inactive', metadata: { static_mvp: true } },
    ])
    if (error) {
      console.error(`[supabase:seed] data_sources insert [${error.code ?? '?'}]: ${error.message}${schemaHint(error.code)}`)
      process.exit(1)
    }
    console.log('[supabase:seed] data_sources: 4 inserted')
  } else {
    console.log(`[supabase:seed] data_sources: already seeded (${dsCount} rows), skipping`)
  }

  // ─── companies ──────────────────────────────────────────────────────────────
  const companies = loadJson<Company[]>('src/data/companies.json')
  const companyRows = companies.map((c) => ({
    ticker:     c.ticker,
    name:       c.name,
    legal_name: c.legalName ?? null,
    sector:     c.sector ?? null,
    industry:   c.industry ?? null,
    exchange:   c.exchange ?? null,
    currency:   c.currency ?? null,
    country:    c.country,
    active:     c.active,
    metadata:   { static_mvp: true },
  }))
  const { error: coErr } = await db.from('companies').upsert(companyRows, { onConflict: 'ticker' })
  if (coErr) {
    console.error(`[supabase:seed] companies upsert [${coErr.code ?? '?'}]: ${coErr.message}${schemaHint(coErr.code)}`)
    process.exit(1)
  }
  console.log(`[supabase:seed] companies: ${companyRows.length} upserted`)

  // ─── macro_indicators ───────────────────────────────────────────────────────
  const macro = loadJson<MacroIndicator[]>('src/data/macroIndicators.json')
  const macroRows = macro.map((m) => {
    const src = m.source?.toLowerCase() ?? ''
    const provider = src.includes('bcch') || src.includes('banco central') ? 'bcch'
      : src.includes('cmf') ? 'cmf' : 'static'
    return {
      id:              m.id,
      region:          m.region,
      name:            m.name,
      short_name:      m.shortName ?? null,
      category:        m.category ?? null,
      unit:            m.unit ?? null,
      source_provider: provider,
      live_enabled:    false,
      metadata:        { static_mvp: true },
    }
  })
  const { error: maErr } = await db.from('macro_indicators').upsert(macroRows, { onConflict: 'id' })
  if (maErr) {
    console.error(`[supabase:seed] macro_indicators upsert [${maErr.code ?? '?'}]: ${maErr.message}${schemaHint(maErr.code)}`)
    process.exit(1)
  }
  console.log(`[supabase:seed] macro_indicators: ${macroRows.length} upserted`)

  // ─── verify ─────────────────────────────────────────────────────────────────
  console.log('[supabase:seed] Final counts:')
  for (const table of ['data_sources', 'companies', 'macro_indicators']) {
    const n = await countRows(table)
    console.log(`  ${table}: ${n ?? 'error'} rows`)
  }

  console.log('[supabase:seed] Done.')
}

main().catch((err) => {
  console.error('[supabase:seed] Unexpected error:', err)
  process.exit(1)
})
