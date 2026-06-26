import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getSupabasePublicConfig,
  getSupabaseAdminConfig,
  isSupabaseConfigured,
  isSupabaseAdminConfigured,
} from '../src/lib/supabase/env.ts'

const BASE_URL      = 'https://abc123.supabase.co'
const REST_URL      = 'https://abc123.supabase.co/rest/v1'
const REST_URL_SLASH = 'https://abc123.supabase.co/rest/v1/'
const FAKE_PUB_KEY  = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.FAKE'
const FAKE_SVC_KEY  = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.FAKE'

describe('Supabase env detection (no vars set)', () => {
  it('getSupabasePublicConfig returns null when vars are absent', () => {
    assert.equal(getSupabasePublicConfig(), null)
  })

  it('getSupabaseAdminConfig returns null when vars are absent', () => {
    assert.equal(getSupabaseAdminConfig(), null)
  })

  it('isSupabaseConfigured returns false when vars are absent', () => {
    assert.equal(isSupabaseConfigured(), false)
  })

  it('isSupabaseAdminConfigured returns false when vars are absent', () => {
    assert.equal(isSupabaseAdminConfigured(), false)
  })
})

// ─── URL normalization ────────────────────────────────────────────────────────
// These tests verify that both public and admin config functions strip the
// /rest/v1 suffix that the Supabase Dashboard shows in its "REST URL" field.
// The Supabase JS client appends /rest/v1 itself, so using the dashboard URL
// verbatim would produce double-path URLs and PGRST125 errors.

type EnvSnapshot = { url?: string; pubKey?: string; svcKey?: string }

function withEnv(vars: { url: string; pubKey: string; svcKey?: string }, fn: () => void) {
  const saved: EnvSnapshot = {
    url:    process.env.NEXT_PUBLIC_SUPABASE_URL,
    pubKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    svcKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL                = vars.url
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY    = vars.pubKey
  if (vars.svcKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = vars.svcKey
  else delete process.env.SUPABASE_SERVICE_ROLE_KEY
  try { fn() } finally {
    if (saved.url !== undefined)    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL
    if (saved.pubKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.pubKey
    else delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (saved.svcKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.svcKey
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY
  }
}

describe('URL normalization — getSupabasePublicConfig', () => {
  it('base URL is returned unchanged', () => {
    withEnv({ url: BASE_URL, pubKey: FAKE_PUB_KEY }, () => {
      assert.equal(getSupabasePublicConfig()?.url, BASE_URL)
    })
  })

  it('strips /rest/v1 suffix from dashboard REST URL', () => {
    withEnv({ url: REST_URL, pubKey: FAKE_PUB_KEY }, () => {
      assert.equal(getSupabasePublicConfig()?.url, BASE_URL)
    })
  })

  it('strips trailing-slash /rest/v1/ suffix', () => {
    withEnv({ url: REST_URL_SLASH, pubKey: FAKE_PUB_KEY }, () => {
      assert.equal(getSupabasePublicConfig()?.url, BASE_URL)
    })
  })
})

describe('URL normalization — getSupabaseAdminConfig', () => {
  it('base URL is returned unchanged', () => {
    withEnv({ url: BASE_URL, pubKey: FAKE_PUB_KEY, svcKey: FAKE_SVC_KEY }, () => {
      assert.equal(getSupabaseAdminConfig()?.url, BASE_URL)
    })
  })

  it('strips /rest/v1 suffix from dashboard REST URL', () => {
    withEnv({ url: REST_URL, pubKey: FAKE_PUB_KEY, svcKey: FAKE_SVC_KEY }, () => {
      assert.equal(getSupabaseAdminConfig()?.url, BASE_URL)
    })
  })

  it('strips trailing-slash /rest/v1/ suffix', () => {
    withEnv({ url: REST_URL_SLASH, pubKey: FAKE_PUB_KEY, svcKey: FAKE_SVC_KEY }, () => {
      assert.equal(getSupabaseAdminConfig()?.url, BASE_URL)
    })
  })

  it('admin and public config produce the same normalized URL', () => {
    withEnv({ url: REST_URL, pubKey: FAKE_PUB_KEY, svcKey: FAKE_SVC_KEY }, () => {
      const pub = getSupabasePublicConfig()?.url
      const adm = getSupabaseAdminConfig()?.url
      assert.equal(adm, pub)
    })
  })

  it('service-role key value is not reflected in the url field', () => {
    withEnv({ url: BASE_URL, pubKey: FAKE_PUB_KEY, svcKey: FAKE_SVC_KEY }, () => {
      const cfg = getSupabaseAdminConfig()
      assert.ok(!cfg?.url.includes('service_role'), 'url must not contain key material')
    })
  })
})
