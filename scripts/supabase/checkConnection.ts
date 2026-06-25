// Phase 5B — Supabase connection check.
// Usage: npm run supabase:check
// Exits 0 on success, 1 on error, 2 when not configured.

// @next/env is CJS — import via default, then destructure after all imports.
import pkg from '@next/env'
import { getSupabasePublicConfig, isSupabaseAdminConfigured } from '../../src/lib/supabase/env.ts'
import { createClient } from '@supabase/supabase-js'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const config = getSupabasePublicConfig()
if (!config) {
  console.error('[supabase:check] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set.')
  console.error('Copy .env.example to .env.local and fill in Supabase credentials.')
  process.exit(2)
}

console.log('[supabase:check] Connecting to:', config.url)

const client = createClient(config.url, config.publishableKey)

const EXPECTED_TABLES = [
  'data_sources', 'companies', 'macro_indicators', 'macro_observations',
  'stock_snapshots', 'stock_ohlcv', 'index_snapshots', 'sector_performance',
  'cmf_filings', 'documents', 'ingestion_runs',
]

async function main() {
  console.log('[supabase:check] Admin configured:', isSupabaseAdminConfigured())

  // Check all 11 tables from the migration.
  const missing: string[] = []
  const present: string[] = []
  for (const table of EXPECTED_TABLES) {
    const { error } = await client.from(table).select('*', { count: 'exact', head: true })
    if (error && (error.message.includes('does not exist') || error.code === '42P01')) {
      missing.push(table)
    } else if (error) {
      console.error(`[supabase:check] ${table}: error — ${error.message}`)
    } else {
      present.push(table)
    }
  }

  const errors = EXPECTED_TABLES.filter((t) => !present.includes(t) && !missing.includes(t))
  if (missing.length > 0) {
    console.warn(`[supabase:check] Missing tables: ${missing.join(', ')}`)
    console.warn('[supabase:check] Paste supabase/migrations/20260625000000_create_market_intelligence_core.sql into Supabase Dashboard > SQL Editor and run it.')
  } else if (errors.length > 0) {
    console.warn(`[supabase:check] Tables with unexpected errors: ${errors.join(', ')}`)
  } else {
    console.log(`[supabase:check] All ${present.length} tables present.`)
  }

  // Check row counts for seeded tables.
  for (const table of ['data_sources', 'companies', 'macro_indicators']) {
    const { count } = await client.from(table).select('*', { count: 'exact', head: true })
    console.log(`[supabase:check] ${table}: ${count ?? 0} rows`)
  }

  if (present.length === EXPECTED_TABLES.length) {
    console.log('[supabase:check] OK — connection verified, all tables present.')
  }
}

main().catch((err) => {
  console.error('[supabase:check] Unexpected error:', err)
  process.exit(1)
})
