// Phase 5D — Manual cron trigger for local dev / staging validation.
//
// Usage (local dev — server must be running on port 3000):
//   node scripts/cron/testBcchMacroCron.ts
//   node scripts/cron/testBcchMacroCron.ts --url https://your-preview.vercel.app
//   node scripts/cron/testBcchMacroCron.ts --dry-run
//
// PowerShell equivalent (no script needed):
//   $h = @{ Authorization = "Bearer $env:CRON_SECRET" }
//   Invoke-RestMethod -Uri http://localhost:3000/api/cron/ingest-bcch-macro -Headers $h
//
// curl equivalent:
//   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest-bcch-macro

import pkg from '@next/env'
const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const getFlag = (flag: string): string | null => {
  const idx = args.indexOf(flag)
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null
}

const baseUrl  = getFlag('--url') ?? 'http://localhost:3000'
const isDryRun = args.includes('--dry-run')
const secret   = process.env.CRON_SECRET?.trim()

if (!secret) {
  console.error('[test-cron] CRON_SECRET not set in .env.local — cannot authenticate.')
  process.exit(1)
}

const url = `${baseUrl}/api/cron/ingest-bcch-macro`
console.log(`[test-cron] Calling ${url}`)
if (isDryRun) console.log('[test-cron] NOTE: --dry-run flag is for this script only (the server still runs a real ingestion)')

async function main() {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  })

  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  console.log(`[test-cron] HTTP ${res.status}`)
  console.log(JSON.stringify(body, null, 2))

  if (res.status === 401) {
    console.error('[test-cron] Auth failed — check CRON_SECRET matches what the server has.')
    process.exit(1)
  }
  if (res.status === 500) {
    console.error('[test-cron] Server error — check CRON_SECRET is set in the server env and BCCh is configured.')
    process.exit(1)
  }
  if (!res.ok) {
    process.exit(1)
  }

  console.log('\n[test-cron] ✓ Cron route responded successfully.')
}

main().catch(e => {
  console.error('[test-cron] Fatal:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
