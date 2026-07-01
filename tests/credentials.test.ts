// Phase 6B — Unit tests for pure credential validators.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeUsername,
  isValidUsername,
  isValidPassword,
  isValidEmail,
  isValidDisplayName,
} from '../src/lib/auth/credentials.ts'

describe('Phase 6B credential validators', () => {
  it('normalizeUsername trims whitespace', () => {
    assert.equal(normalizeUsername('  hector '), 'hector')
  })

  it('isValidUsername accepts 3-30 chars of letters/digits/._-', () => {
    assert.ok(isValidUsername('hector'))
    assert.ok(isValidUsername('h.martinez_1-2'))
    assert.ok(isValidUsername('abc'))
    assert.ok(isValidUsername('a'.repeat(30)))
  })

  it('isValidUsername rejects too short, too long, spaces, symbols', () => {
    assert.ok(!isValidUsername('ab'))
    assert.ok(!isValidUsername('a'.repeat(31)))
    assert.ok(!isValidUsername('has space'))
    assert.ok(!isValidUsername('bad@name'))
    assert.ok(!isValidUsername(''))
  })

  it('isValidPassword requires >= 8 chars', () => {
    assert.ok(isValidPassword('12345678'))
    assert.ok(!isValidPassword('short'))
    assert.ok(!isValidPassword(undefined))
    assert.ok(!isValidPassword(12345678))
  })

  it('isValidEmail checks basic shape', () => {
    assert.ok(isValidEmail('a@b.co'))
    assert.ok(!isValidEmail('nope'))
    assert.ok(!isValidEmail('a@b'))
    assert.ok(!isValidEmail(123))
  })

  it('isValidDisplayName requires 1-60 visible chars', () => {
    assert.ok(isValidDisplayName('H. Martinez'))
    assert.ok(!isValidDisplayName('   '))
    assert.ok(!isValidDisplayName('x'.repeat(61)))
    assert.ok(!isValidDisplayName(null))
  })
})
