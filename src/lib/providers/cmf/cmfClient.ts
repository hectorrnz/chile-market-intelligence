// Phase 5A — CMF HTTP client. SERVER-ONLY.
//
// Conservative HTTP fetch for public CMF portal pages. Never aggressive:
//   - Hard timeout (default 8 seconds)
//   - Explicit User-Agent identifying this as research tooling
//   - Used only by the discovery script and the live provider shell
//   - Never called during build, never called automatically
//
// isCmfLiveConfigured() checks whether live ingestion is explicitly requested.

const DEFAULT_BASE_URL = 'https://www.cmfchile.cl'
const DEFAULT_TIMEOUT_MS = 8000

/** Returns true only when CMF live ingestion is explicitly enabled. */
export function isCmfLiveConfigured(): boolean {
  const mode = (process.env.CMF_DATA_MODE ?? '').trim().toLowerCase()
  return mode === 'live' || mode === 'hybrid'
}

export function getCmfBaseUrl(): string {
  return (process.env.CMF_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/$/, '')
}

function getCmfTimeoutMs(): number {
  const raw = process.env.CMF_REQUEST_TIMEOUT_MS
  const n = raw ? parseInt(raw, 10) : NaN
  return isNaN(n) || n <= 0 ? DEFAULT_TIMEOUT_MS : n
}

function getCmfUserAgent(): string {
  const ua = (process.env.CMF_USER_AGENT ?? '').trim()
  return ua || 'CMI-FinancialResearch/1.0 (internal buyside terminal)'
}

/**
 * Fetch a page from the public CMF portal.
 * Path must start with '/'. Throws on timeout, HTTP error, or network failure.
 * Callers must handle errors and never let them propagate to client responses.
 */
export async function fetchCmfPage(path: string): Promise<string> {
  const url = `${getCmfBaseUrl()}${path}`
  const timeoutMs = getCmfTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': getCmfUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`CMF returned HTTP ${res.status} for ${path}`)
    return await res.text()
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === 'AbortError') {
      throw new Error(`CMF request timed out after ${timeoutMs}ms (path: ${path})`)
    }
    throw err
  }
}
