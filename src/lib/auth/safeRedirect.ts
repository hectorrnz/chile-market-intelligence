// R1.5 — THE authoritative safe-internal-redirect validator.
//
// Every place that accepts, constructs, or consumes a post-authentication
// destination must route through `toSafeInternalPath`. Do NOT add a second
// validator: middleware, the login page, and /auth/callback all share this one
// so their notions of "safe" can never drift apart.
//
// The pre-R1.5 check was `next.startsWith('/')`, which accepts
// `//evil.example` — a protocol-relative URL the browser resolves against the
// current scheme, i.e. a fully external open redirect. It also accepted
// `/\evil.example` (browsers normalise `\` to `/`), percent-encoded variants,
// and values that normalise externally through path traversal.
//
// Rejected input always falls back to `/` — never to an error, so no caller
// needs its own failure branch.

/** Every rejected destination collapses to the application root. */
export const SAFE_FALLBACK_PATH = '/'

/**
 * Resolution base for normalisation. A deliberately unresolvable host: if a
 * candidate normalises to any other origin, it was not internal.
 */
const INTERNAL_BASE = 'https://internal.invalid'

/** Bounded decode passes — enough for nested encoding, not enough to loop. */
const MAX_DECODE_PASSES = 3

/**
 * True when the string contains a C0 control character or DEL.
 *
 * Browsers strip TAB/LF/CR from URLs *before* resolving them, so
 * `/<TAB>/evil.example` would otherwise pass a naive prefix check and then
 * resolve protocol-relatively. Written as an explicit code-point scan rather
 * than a character class so no literal control byte ever enters this source
 * file.
 */
function hasControlCharacter(candidate: string): boolean {
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * True when a candidate is externally-resolvable, scheme-bearing, or otherwise
 * not a plain internal path. Applied to the literal value AND to each decoded
 * form, so encoded variants cannot slip past.
 */
function looksExternal(candidate: string): boolean {
  // Backslashes anywhere: browsers normalise `\` → `/`, so `/\evil.example`
  // and `\evil.example` both resolve externally.
  if (candidate.includes('\\')) return true

  if (hasControlCharacter(candidate)) return true

  // Any scheme — `https:`, `javascript:`, `data:`, `mailto:` …
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) return true

  // Must be a rooted path, and must not be protocol-relative (`//host`,
  // `///host`, …).
  if (!candidate.startsWith('/')) return true
  if (candidate.startsWith('//')) return true

  return false
}

/** Returns the decoded string, or null when the encoding is malformed. */
function decodeOnce(candidate: string): string | null {
  try {
    return decodeURIComponent(candidate)
  } catch {
    return null
  }
}

/**
 * Normalises an untrusted `next`/destination value to a safe internal path.
 *
 * Accepts a rooted internal path and preserves its query string
 * (`/macro?region=cl`). Rejects absolute URLs, protocol-relative URLs, scheme
 * URIs, backslash and encoded variants, malformed encodings, values that
 * normalise to another origin, and empty input — all of which yield `/`.
 *
 * The fragment is dropped: it never reaches the server, so carrying it through
 * a server-side redirect only widens the input surface.
 */
export function toSafeInternalPath(value: string | null | undefined): string {
  if (typeof value !== 'string') return SAFE_FALLBACK_PATH

  const raw = value.trim()
  if (!raw) return SAFE_FALLBACK_PATH

  // Screen the literal value and every decoded form.
  let candidate = raw
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    if (looksExternal(candidate)) return SAFE_FALLBACK_PATH
    const decoded = decodeOnce(candidate)
    if (decoded === null) return SAFE_FALLBACK_PATH // malformed encoding
    if (decoded === candidate) break
    candidate = decoded
  }
  if (looksExternal(candidate)) return SAFE_FALLBACK_PATH

  // Final authority: resolve against an unreachable base and require that the
  // result stayed on it. Catches traversal that normalises out of the app
  // (`/..//evil.example` → `//evil.example`).
  let url: URL
  try {
    url = new URL(raw, INTERNAL_BASE)
  } catch {
    return SAFE_FALLBACK_PATH
  }
  if (url.origin !== INTERNAL_BASE) return SAFE_FALLBACK_PATH
  if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return SAFE_FALLBACK_PATH

  return `${url.pathname}${url.search}`
}

/**
 * Builds the `/login?next=…` destination for an unauthenticated request.
 * The `next` value is validated by the same helper before being attached, so a
 * hostile original URL can never be reflected into the login page.
 */
export function buildLoginRedirectPath(requestedPathWithQuery: string | null | undefined): string {
  const safeNext = toSafeInternalPath(requestedPathWithQuery)
  if (safeNext === SAFE_FALLBACK_PATH) return '/login'
  return `/login?next=${encodeURIComponent(safeNext)}`
}
