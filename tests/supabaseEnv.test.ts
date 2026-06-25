import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getSupabasePublicConfig,
  getSupabaseAdminConfig,
  isSupabaseConfigured,
  isSupabaseAdminConfigured,
} from '../src/lib/supabase/env.ts'

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
