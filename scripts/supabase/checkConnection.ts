// Phase 5B — Supabase connection check.
// Usage: npm run supabase:check
// Exits 0 on success, 1 on error, 2 when not configured.

import { getSupabasePublicConfig, isSupabaseAdminConfigured } from '../../src/lib/supabase/env.ts'
import { createClient } from '@supabase/supabase-js'

const config = getSupabasePublicConfig()
if (!config) {
  console.error('[supabase:check] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set.')
  console.error('Copy .env.example to .env.local and fill in Supabase credentials.')
  process.exit(2)
}

console.log('[supabase:check] Connecting to:', config.url)

const client = createClient(config.url, config.publishableKey)

async function main() {
  const { data, error } = await client.from('companies').select('count').single()
  if (error) {
    console.error('[supabase:check] Query failed:', error.message)
    process.exit(1)
  }
  console.log('[supabase:check] companies count:', data)
  console.log('[supabase:check] Admin configured:', isSupabaseAdminConfigured())
  console.log('[supabase:check] OK')
}

main().catch((err) => {
  console.error('[supabase:check] Unexpected error:', err)
  process.exit(1)
})
