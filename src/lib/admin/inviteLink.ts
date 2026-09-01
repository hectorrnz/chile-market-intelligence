// R13.6F — the invitation destination, built from the REQUEST's own origin.
//
// PURE MODULE. Given an origin string it returns strings; it reads no environment
// variable and performs no I/O, so every property below is unit-testable.
//
// WHY THE ORIGIN IS A PARAMETER AND NOT A CONFIG VALUE
// ────────────────────────────────────────────────────
// The same build runs on Production and on every Preview deployment, each with a
// different hostname. A hard-coded host, or `NEXT_PUBLIC_SITE_URL`, would send a
// Preview invitation to Production — where the invited account may not exist —
// and would silently keep doing so with no error. The correct origin is the one
// the administrator's own request arrived on, which `request.nextUrl.origin`
// already gives us, and which the existing `/api/auth/forgot-password` route uses
// for exactly the same reason.
//
// This mirrors that precedent deliberately: recovery and invitation are the same
// mechanism (a one-time Supabase link landing on `/auth/callback`), so they must
// resolve their destination the same way rather than inventing a second one.
//
// NO OPEN REDIRECT
// ────────────────
// The `next` handed to `/auth/callback` is a fixed internal constant, never
// anything derived from a request. The callback re-validates it through
// `toSafeInternalPath` regardless, so even if this file were changed to accept a
// caller-supplied value the callback would still refuse to leave the origin — but
// not accepting one in the first place is the stronger position.

/**
 * Where an invited user lands after Supabase exchanges their one-time link.
 *
 * The existing PUBLIC password-setting page, reached through the existing session
 * mint. An invited Auth identity created by `generateLink({ type: 'invite' })` has
 * NO password, so setting one is the step that makes the account usable — and this
 * is the surface that already does that, with its own validation, its own i18n and
 * its own tests. Building a second "welcome" page would be a second auth system.
 */
export const INVITE_LANDING_PATH = '/auth/reset-password'

/** The session-mint route both recovery and invitation pass through. */
export const AUTH_CALLBACK_PATH = '/auth/callback'

/**
 * Rejects anything that is not a plain absolute http(s) origin.
 *
 * The origin comes from the framework rather than from a request body, so this is
 * defence in depth rather than the primary control — but a malformed origin would
 * otherwise be baked into an email that cannot be recalled once sent.
 */
export function isUsableOrigin(origin: unknown): origin is string {
  if (typeof origin !== 'string' || origin.trim().length === 0) return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  // An origin carries no path, query or fragment. Anything else means the caller
  // passed a full URL, and concatenating onto it would produce a broken link.
  if (url.pathname !== '/' && url.pathname !== '') return false
  if (url.search !== '' || url.hash !== '') return false
  return true
}

/**
 * The absolute URL Supabase must redirect the invitation to.
 *
 * Passed to `generateLink` as `options.redirectTo`, where the installed auth-js
 * appends it as the `redirect_to` query parameter on `POST /admin/generate_link`.
 * GoTrue only honours a redirect that matches its configured allow-list, so this
 * URL must also be registered in the Supabase project's Redirect URLs — the same
 * requirement the existing recovery flow already has for the same path.
 */
export function buildInviteRedirectUrl(origin: string): string {
  if (!isUsableOrigin(origin)) {
    throw new Error('invalid_origin')
  }
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin
  return `${base}${AUTH_CALLBACK_PATH}?next=${encodeURIComponent(INVITE_LANDING_PATH)}`
}

/**
 * The URL actually EMAILED to an invited person.
 *
 * WHY NOT GoTrue's OWN `action_link`
 * ──────────────────────────────────
 * Because it cannot work with a server-rendered callback, and the hermetic CI
 * proof measured exactly that. Following `action_link` reaches
 * `GET /auth/v1/verify`, which answers `303` to our callback with the session in
 * the URL **fragment** — `.../auth/callback?next=...#access_token=...`. A
 * fragment is never transmitted to a server: `/auth/callback` would see only
 * `next`, never call `exchangeCodeForSession`, never establish a session, and
 * therefore never call `nmi_activate_current_user()`. The invitation would look
 * like it worked and leave the account permanently `account_not_activated`.
 *
 * So the link points at the application instead, carrying the `hashed_token`
 * that `generateLink` already returns. The callback redeems it server-side with
 * `verifyOtp({ token_hash, type })`, which sets the session as cookies on the
 * response — the same posture the rest of this app's auth already uses, and the
 * pattern Supabase documents for server-side rendering.
 *
 * The one-time token is no more exposed here than in GoTrue's own link: it is the
 * same value, in the same position, sent to the same address. What changes is who
 * redeems it — our server rather than the user's browser.
 */
export function buildInviteAcceptUrl(origin: string, tokenHash: string): string {
  if (!isUsableOrigin(origin)) {
    throw new Error('invalid_origin')
  }
  if (typeof tokenHash !== 'string' || tokenHash.trim().length === 0) {
    throw new Error('invalid_token_hash')
  }
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin
  return (
    `${base}${AUTH_CALLBACK_PATH}` +
    `?token_hash=${encodeURIComponent(tokenHash)}` +
    `&type=invite` +
    `&next=${encodeURIComponent(INVITE_LANDING_PATH)}`
  )
}
