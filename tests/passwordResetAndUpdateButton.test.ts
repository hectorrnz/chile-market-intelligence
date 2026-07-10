// Tests for two UX changes: (1) a single prominent "Update Data" button
// replaces the small per-panel refresh icons on Home/Stocks/Portfolio/Company;
// (2) a "Forgot password?" flow (request + reset pages/routes).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const HOME_PAGE       = join(ROOT, 'src/app/page.tsx')
const STOCKS_PAGE     = join(ROOT, 'src/app/stocks/page.tsx')
const PORTFOLIO_PAGE  = join(ROOT, 'src/app/portfolio/page.tsx')
const COMPANY_PAGE    = join(ROOT, 'src/app/companies/[ticker]/page.tsx')
const LOGIN_PAGE      = join(ROOT, 'src/app/login/page.tsx')
const FORGOT_PAGE     = join(ROOT, 'src/app/forgot-password/page.tsx')
const RESET_PAGE      = join(ROOT, 'src/app/auth/reset-password/page.tsx')
const FORGOT_ROUTE    = join(ROOT, 'src/app/api/auth/forgot-password/route.ts')
const RESET_ROUTE     = join(ROOT, 'src/app/api/auth/reset-password/route.ts')
const UPDATE_BUTTON   = join(ROOT, 'src/components/ui/UpdateDataButton.tsx')
const OLD_BUTTON      = join(ROOT, 'src/components/ui/MarketRefreshButton.tsx')

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('Single Update Data button (replaces per-panel refresh icons)', () => {
  it('UpdateDataButton component exists; old MarketRefreshButton is removed', () => {
    assert.ok(existsSync(UPDATE_BUTTON))
    assert.ok(!existsSync(OLD_BUTTON))
  })

  it('no source file references the removed MarketRefreshButton', () => {
    const srcDir = join(ROOT, 'src')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const content = readFileSync(full, 'utf8')
          if (content.includes('MarketRefreshButton')) hits.push(full)
        }
      }
    }
    walk(srcDir)
    assert.deepEqual(hits, [])
  })

  it('Home page renders exactly one UpdateDataButton', () => {
    const src = readFileSync(HOME_PAGE, 'utf8')
    assert.equal(countOccurrences(src, '<UpdateDataButton'), 1)
  })

  it('Stocks page renders exactly one UpdateDataButton', () => {
    const src = readFileSync(STOCKS_PAGE, 'utf8')
    assert.equal(countOccurrences(src, '<UpdateDataButton'), 1)
  })

  it('Portfolio page renders exactly one UpdateDataButton', () => {
    const src = readFileSync(PORTFOLIO_PAGE, 'utf8')
    assert.equal(countOccurrences(src, '<UpdateDataButton'), 1)
  })

  it('Company page renders exactly one UpdateDataButton', () => {
    const src = readFileSync(COMPANY_PAGE, 'utf8')
    assert.equal(countOccurrences(src, '<UpdateDataButton'), 1)
  })

  it('UpdateDataButton is bigger/more prominent than the old icon-only button (h-9, text label, not a 5x5 icon)', () => {
    const src = readFileSync(UPDATE_BUTTON, 'utf8')
    assert.ok(src.includes('h-9'))
    assert.ok(src.includes('t.common.updateData') || src.includes('t.common.updating') || src.includes('t.common.dataUpdated'))
    assert.ok(!src.includes('w-5 h-5'))
  })
})

describe('Forgot password flow', () => {
  it('login page links to /forgot-password', () => {
    const src = readFileSync(LOGIN_PAGE, 'utf8')
    assert.ok(src.includes('href="/forgot-password"'))
    assert.ok(src.includes('t.auth.forgotPassword'))
  })

  it('forgot-password page and API route exist', () => {
    assert.ok(existsSync(FORGOT_PAGE))
    assert.ok(existsSync(FORGOT_ROUTE))
  })

  it('reset-password page and API route exist', () => {
    assert.ok(existsSync(RESET_PAGE))
    assert.ok(existsSync(RESET_ROUTE))
  })

  it('forgot-password route never leaks whether an account exists (always returns ok:true)', () => {
    const src = readFileSync(FORGOT_ROUTE, 'utf8')
    assert.ok(src.includes("NextResponse.json({ ok: true })"))
    // The resetPasswordForEmail call result must not gate the response.
    assert.ok(src.includes('.catch(() => {})'))
  })

  it('forgot-password route uses the cookie-capturing session-writer client (never the admin client) so the PKCE code verifier reaches the browser', () => {
    const src = readFileSync(FORGOT_ROUTE, 'utf8')
    // Regression guard: getSupabaseServerClient() stubs cookie writes to a
    // no-op, which silently drops the PKCE verifier resetPasswordForEmail()
    // needs written to the browser — causing /auth/callback's later
    // exchangeCodeForSession() to fail. createSessionWriterClient() (same
    // client login/register use) captures the write and applies it as a real
    // Set-Cookie header via applyCookies().
    assert.ok(src.includes('createSessionWriterClient'))
    assert.ok(src.includes('applyCookies'))
    // Not imported/called as the actual client (a code comment may still
    // reference the old function name to document the bug it fixed).
    assert.ok(!src.includes("from '@/lib/supabase/server'"))
    assert.ok(!src.includes('getSupabaseAdminClient'))
  })

  it('forgot-password route builds redirectTo from the request origin, no hardcoded env-dependent URL', () => {
    const src = readFileSync(FORGOT_ROUTE, 'utf8')
    assert.ok(src.includes('request.nextUrl.origin'))
  })

  it('reset-password route requires a valid session and rejects otherwise (401 no_session)', () => {
    const src = readFileSync(RESET_ROUTE, 'utf8')
    assert.ok(src.includes("'no_session'"))
    assert.ok(src.includes('status: 401'))
  })

  it('reset-password route validates password strength before updating', () => {
    const src = readFileSync(RESET_ROUTE, 'utf8')
    assert.ok(src.includes('isValidPassword'))
  })

  it('reset-password route never uses the admin client', () => {
    const src = readFileSync(RESET_ROUTE, 'utf8')
    assert.ok(!src.includes('getSupabaseAdminClient'))
  })

  it('the reset-password landing page requires matching passwords before submitting', () => {
    const src = readFileSync(RESET_PAGE, 'utf8')
    assert.ok(src.includes('errPasswordMismatch'))
    assert.ok(src.includes('password !== confirmPassword'))
  })
})
