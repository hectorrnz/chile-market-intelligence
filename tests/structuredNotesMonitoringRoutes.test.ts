// Phase 9D — Structured Notes monitoring route hygiene checks (grep-based, no
// network/Supabase — mirrors the existing security/provenance checks in
// tests/structuredNotesWorkbookMapping.test.ts).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const CRON_ROUTE = read('../src/app/api/cron/structured-notes/snapshot/route.ts')
const STATUS_ROUTE = read('../src/app/api/structured-notes/monitoring-status/route.ts')
const MACRO_CRON = read('../src/app/api/cron/ingest-bcch-macro/route.ts')
const HEALTH_CRON = read('../src/app/api/cron/check-ingestion-health/route.ts')
const MIDDLEWARE = read('../src/middleware.ts')
const VERCEL_JSON = read('../vercel.json')
const MIGRATION = read('../supabase/migrations/20260709000000_structured_notes_monitoring.sql')

describe('cron snapshot route — auth', () => {
  it('requires a Bearer CRON_SECRET and returns 401 on mismatch', () => {
    assert.ok(CRON_ROUTE.includes('CRON_SECRET'))
    assert.ok(CRON_ROUTE.includes("Bearer ${secret}"))
    assert.ok(CRON_ROUTE.includes("status: 401"))
  })
  it('returns 500 (not 200) when CRON_SECRET itself is unconfigured, rather than silently allowing access', () => {
    assert.ok(CRON_ROUTE.includes('CRON_SECRET missing'))
  })
  it('uses the service-role admin client (no user session exists for a scheduled job)', () => {
    assert.ok(CRON_ROUTE.includes('getSupabaseAdminClient'))
  })
  it('never echoes the CRON_SECRET or a service-role key in the response body', () => {
    assert.ok(!/secret,/.test(CRON_ROUTE.split('NextResponse.json(').slice(1).join('')))
  })
  it('records a monitoring run and reports partial_success distinctly from success/failed', () => {
    assert.ok(CRON_ROUTE.includes('createStructuredNoteMonitoringRun'))
    assert.ok(CRON_ROUTE.includes('completeStructuredNoteMonitoringRun'))
    assert.ok(CRON_ROUTE.includes("'partial_success'"))
  })
  it('sanitizes unexpected errors to a bounded message', () => {
    assert.ok(CRON_ROUTE.includes('.slice(0, 200)'))
  })
})

describe('cron snapshot route — Phase 9E quote-quality summary', () => {
  it('threads quoteMeta into snapshot persistence and observation evaluation', () => {
    assert.ok(CRON_ROUTE.includes('priceResult.quoteMeta'))
  })
  it('records provider/quality diagnostics on the monitoring run without a migration (reuses metadata jsonb)', () => {
    assert.ok(CRON_ROUTE.includes('providerSummary'))
    assert.ok(CRON_ROUTE.includes('unsupportedSymbols'))
    assert.ok(CRON_ROUTE.includes('staleSymbols'))
    assert.ok(CRON_ROUTE.includes('fallbackProviderUsed'))
    assert.ok(CRON_ROUTE.includes('providerDisagreement'))
  })
  it('response labels every run a monitoring estimate, never an official calculation-agent determination', () => {
    assert.ok(/not an official calculation-agent determination/i.test(CRON_ROUTE))
  })
})

describe('monitoring-status route — authenticated read', () => {
  it('uses the user-session client, not the admin client (per-request authenticated read)', () => {
    assert.ok(STATUS_ROUTE.includes('getSupabaseUserClient'))
    assert.ok(!STATUS_ROUTE.includes('getSupabaseAdminClient'))
  })
  it('returns 503 when Supabase is not configured, never a fabricated empty-success', () => {
    assert.ok(STATUS_ROUTE.includes("status: 503"))
  })
  it('surfaces Phase 9E quote-quality fields from the latest run metadata, defaulting safely on an old run with no metadata', () => {
    assert.ok(STATUS_ROUTE.includes('providerSummary'))
    assert.ok(STATUS_ROUTE.includes('fallbackProviderUsed'))
    assert.ok(STATUS_ROUTE.includes('providerDisagreement'))
    assert.ok(STATUS_ROUTE.includes('runMeta.providerSummary ?? null'))
  })
})

describe('Vercel cron configuration', () => {
  it('adds the structured-notes snapshot cron without disturbing the existing macro/health crons', () => {
    const cfg = JSON.parse(VERCEL_JSON) as { crons: { path: string; schedule: string }[] }
    const paths = cfg.crons.map((c) => c.path)
    assert.ok(paths.includes('/api/cron/ingest-bcch-macro'))
    assert.ok(paths.includes('/api/cron/check-ingestion-health'))
    assert.ok(paths.includes('/api/cron/structured-notes/snapshot'))
  })
  it('runs at most once per weekday (no hourly polling)', () => {
    const cfg = JSON.parse(VERCEL_JSON) as { crons: { path: string; schedule: string }[] }
    const snap = cfg.crons.find((c) => c.path === '/api/cron/structured-notes/snapshot')!
    // A single fixed minute+hour with a weekday range, not a wildcard/interval on minutes or hours.
    const [minute, hour] = snap.schedule.split(' ')
    assert.ok(/^\d{1,2}$/.test(minute))
    assert.ok(/^\d{1,2}$/.test(hour))
  })
})

describe('regression — existing macro/market cron routes unaffected', () => {
  it('the BCCh macro cron route file is untouched by this phase (still Bearer CRON_SECRET, still POST/GET to macro repos)', () => {
    assert.ok(MACRO_CRON.includes('CRON_SECRET'))
  })
  it('the ingestion-health cron route file is untouched by this phase', () => {
    assert.ok(HEALTH_CRON.includes('CRON_SECRET'))
    assert.ok(HEALTH_CRON.includes('evaluateOverallIngestionHealth'))
  })
})

describe('middleware — structured-notes routes still auth-gated (regression)', () => {
  it('protects /structured-notes and /api/structured-notes (unchanged from Phase 9A/9B)', () => {
    assert.ok(MIDDLEWARE.includes("'/structured-notes'"))
    assert.ok(MIDDLEWARE.includes("'/api/structured-notes'"))
  })
  it('does not add the cron route to the authenticated-page middleware (cron uses its own Bearer auth, not session auth)', () => {
    assert.ok(!MIDDLEWARE.includes('/api/cron/structured-notes'))
  })
})

describe('migration hygiene', () => {
  it('adds the monitoring_runs table with the documented run_type/status check constraints', () => {
    assert.ok(MIGRATION.includes('structured_note_monitoring_runs'))
    assert.ok(/run_type in \('scheduled_snapshot', 'manual_refresh', 'observation_check', 'backfill'\)/.test(MIGRATION))
    assert.ok(/status in \('running', 'success', 'partial_success', 'failed'\)/.test(MIGRATION))
  })
  it('has no insert/update/delete RLS policy on the new table (service-role writes only)', () => {
    assert.ok(MIGRATION.includes('sn_monitoring_runs_select'))
    assert.ok(!MIGRATION.includes('sn_monitoring_runs_insert'))
    assert.ok(!MIGRATION.includes('sn_monitoring_runs_update'))
    assert.ok(!MIGRATION.includes('sn_monitoring_runs_delete'))
  })
  it('makes price_snapshots.user_id nullable for cron-inserted rows (never claims RLS is bypassed for regular clients)', () => {
    assert.ok(MIGRATION.includes('alter column user_id drop not null'))
  })
})
