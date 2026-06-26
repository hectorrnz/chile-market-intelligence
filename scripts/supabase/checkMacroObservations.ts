// Phase 5C — Validate macro_observations after BCCh ingestion.
// Usage: npm run supabase:check-macro
// Reports count, date range, and latest value per indicator_id + last ingestion run.

import pkg from '@next/env'
import { createClient } from '@supabase/supabase-js'

const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ''
const url = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''

if (!url || (!publishableKey && !svcKey)) {
  console.error('[check-macro] Supabase credentials not configured. Set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local')
  process.exit(2)
}

// Use admin key when available (bypasses RLS for aggregate reads). Fall back to publishable.
const db = createClient(url, svcKey || publishableKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  console.log('[check-macro] Checking macro_observations...')

  // ─── All rows (paginated — PostgREST default cap is 1,000) ─────────────────
  type ObsRow = { indicator_id: string; observation_date: string; value: number }
  const allRows: ObsRow[] = []
  const PAGE = 1000
  let from = 0
  let fetchErr: { message: string } | null = null

  while (true) {
    const { data, error } = await db
      .from('macro_observations')
      .select('indicator_id, observation_date, value')
      .order('observation_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) { fetchErr = error; break }
    if (!data || data.length === 0) break
    allRows.push(...(data as ObsRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  if (fetchErr) {
    const hint = fetchErr.message.includes('does not exist')
      ? '\n  → Run supabase/migrations/20260626000000_macro_obs_constraints.sql in SQL Editor first.'
      : ''
    console.error(`[check-macro] macro_observations query failed: ${fetchErr.message}${hint}`)
    process.exit(1)
  }

  if (allRows.length === 0) {
    console.log('[check-macro] macro_observations: 0 rows — run: npm run ingest:bcch-macro:dry')
    return
  }

  // ─── Aggregate per indicator ──────────────────────────────────────────────────
  interface Agg { count: number; min: string; max: string; latest: number }
  const agg = new Map<string, Agg>()
  for (const r of allRows) {
    const cur = agg.get(r.indicator_id)
    if (!cur) {
      agg.set(r.indicator_id, { count: 1, min: r.observation_date, max: r.observation_date, latest: r.value })
    } else {
      cur.count++
      if (r.observation_date < cur.min) cur.min = r.observation_date
      if (r.observation_date > cur.max) { cur.max = r.observation_date; cur.latest = r.value }
    }
  }

  const total = allRows.length
  console.log(`\n[check-macro] macro_observations: ${total.toLocaleString()} total rows across ${agg.size} indicators\n`)

  const col = (s: string | number, w: number) => String(s).padEnd(w)
  console.log(col('indicator_id', 18) + col('count', 8) + col('first', 12) + col('last', 12) + 'latest value')
  console.log('─'.repeat(70))
  for (const [id, v] of [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(col(id, 18) + col(v.count, 8) + col(v.min, 12) + col(v.max, 12) + String(v.latest))
  }

  // ─── Latest ingestion run ─────────────────────────────────────────────────────
  console.log('\n[check-macro] Latest ingestion runs:')
  const { data: runs, error: runErr } = await db
    .from('ingestion_runs')
    .select('provider, job_type, status, started_at, rows_seen, rows_inserted, error_message')
    .order('started_at', { ascending: false })
    .limit(5)

  if (runErr) {
    console.warn(`[check-macro] ingestion_runs query failed: ${runErr.message}`)
  } else if (!runs || runs.length === 0) {
    console.log('  (no ingestion runs recorded yet)')
  } else {
    for (const r of runs as Array<Record<string, unknown>>) {
      const ts = String(r.started_at ?? '').slice(0, 16)
      const status = String(r.status ?? '?').padEnd(18)
      const seen = String(r.rows_seen ?? 0).padStart(6)
      const ins  = String(r.rows_inserted ?? 0).padStart(6)
      const err  = r.error_message ? ` | err: ${String(r.error_message).slice(0, 60)}` : ''
      console.log(`  ${ts}  ${status}  seen ${seen}  upserted ${ins}${err}`)
    }
  }
}

main().catch(e => {
  console.error('[check-macro] Fatal:', e)
  process.exit(1)
})
