// Phase 5C.2 — Set Vercel Preview environment variables from .env.local.
//
// Usage:
//   1. Add VERCEL_TOKEN=<your-token> to .env.local  (get token at vercel.com/account/tokens)
//   2. node scripts/vercel/setPreviewEnv.ts
//   3. Remove VERCEL_TOKEN from .env.local if desired (it is already gitignored)
//
// What this does:
//   - Reads values from .env.local (including VERCEL_TOKEN)
//   - Calls Vercel API to set each var for the Preview environment ONLY
//   - Never prints secret values
//   - Skips vars that are already set to the same environment/type
//
// Does NOT touch Production vars.

import pkg from '@next/env'
const { loadEnvConfig } = pkg
loadEnvConfig(process.cwd())

const PROJECT_ID = 'prj_wHQUl16Sx0ugk8qjr3CJVkZT4BRE'
const TEAM_ID    = 'team_HVqm1TUBvxAw8kamPXEGZbW1'

// Vars to push to Preview only.
// sensitive=true → encrypted storage; isPublic=true → client-bundle safe (NEXT_PUBLIC_*)
const PREVIEW_VARS: { key: string; sensitive: boolean }[] = [
  { key: 'DATA_MODE',                            sensitive: false },
  { key: 'BCCH_API_USER',                        sensitive: true  },
  { key: 'BCCH_API_PASSWORD',                    sensitive: true  },
  { key: 'BCCH_API_BASE_URL',                    sensitive: false },
  { key: 'DB_MODE',                              sensitive: false },
  { key: 'NEXT_PUBLIC_SUPABASE_URL',             sensitive: false },
  { key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', sensitive: false },
  { key: 'SUPABASE_SERVICE_ROLE_KEY',            sensitive: true  },
  { key: 'CRON_SECRET',                          sensitive: true  },
]

const token = process.env.VERCEL_TOKEN?.trim()
if (!token) {
  console.error('[setPreviewEnv] VERCEL_TOKEN not set. Add it to .env.local and retry.')
  process.exit(1)
}

const BASE = `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}`

async function listExisting(): Promise<Map<string, { id: string; target: string[] }>> {
  const res = await fetch(BASE, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`)
  const json = await res.json() as { envs: Array<{ id: string; key: string; target: string[] }> }
  const map = new Map<string, { id: string; target: string[] }>()
  for (const e of json.envs ?? []) map.set(e.key, { id: e.id, target: e.target })
  return map
}

async function upsertVar(
  key: string,
  value: string,
  sensitive: boolean,
  existing: Map<string, { id: string; target: string[] }>,
): Promise<'created' | 'updated' | 'skipped'> {
  const prev = existing.get(key)
  const type = sensitive ? 'encrypted' : 'plain'
  const body = { key, value, target: ['preview'], type }

  if (prev) {
    // Already has a preview entry — update value only (never change type; Vercel rejects it for sensitive vars)
    if (prev.target.includes('preview')) {
      const patchUrl = `https://api.vercel.com/v10/projects/${PROJECT_ID}/env/${prev.id}?teamId=${TEAM_ID}`
      const r = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, target: ['preview'] }), // omit type — cannot change sensitive→plain/encrypted
      })
      if (!r.ok) throw new Error(`PATCH ${key} failed: ${r.status} ${await r.text()}`)
      return 'updated'
    }
    // Exists only for other environments — create a separate Preview entry
  }

  const r = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text()
    // Conflict = already exists for preview, treat as success
    if (r.status === 400 && text.includes('already')) return 'skipped'
    throw new Error(`POST ${key} failed: ${r.status} ${text}`)
  }
  return 'created'
}

async function main() {
  console.log('[setPreviewEnv] Reading .env.local values and pushing to Vercel Preview...')
  console.log(`[setPreviewEnv] Project: ${PROJECT_ID} | Team: ${TEAM_ID}`)
  console.log('[setPreviewEnv] Target:  preview only (production unchanged)\n')

  const existing = await listExisting()
  console.log(`[setPreviewEnv] Found ${existing.size} existing env var(s) in project.\n`)

  let created = 0; let updated = 0; let skipped = 0; let failed = 0

  for (const { key, sensitive } of PREVIEW_VARS) {
    const value = process.env[key]?.trim() ?? ''
    if (!value) {
      console.warn(`  [SKIP]  ${key.padEnd(42)} — not set in .env.local`)
      skipped++
      continue
    }
    try {
      const result = await upsertVar(key, value, sensitive, existing)
      const label = result === 'created' ? '[CREATE]' : result === 'updated' ? '[UPDATE]' : '[SKIP]  '
      // Never print the value — just confirm key + result
      const suffix = sensitive ? '(encrypted)' : '(plain)'
      console.log(`  ${label} ${key.padEnd(42)} ${suffix}`)
      if (result === 'created') created++
      else if (result === 'updated') updated++
      else skipped++
    } catch (e) {
      console.error(`  [ERROR] ${key}: ${e instanceof Error ? e.message : String(e)}`)
      failed++
    }
  }

  console.log(`\n[setPreviewEnv] Done — created: ${created}, updated: ${updated}, skipped: ${skipped}, failed: ${failed}`)
  if (failed > 0) process.exit(1)
  console.log('\n[setPreviewEnv] Redeploy the Preview branch on Vercel to pick up the new vars.')
}

main().catch(e => {
  console.error('[setPreviewEnv] Fatal:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
