// POST-R13.6CDE — client-safe reader for the caller's own effective access.
//
// Mirrors every other `src/lib/data/*` helper: it hits an `/api` route and never
// imports a provider, a Supabase client or anything server-only, so a client
// component can import it without dragging server code into the bundle.

import { parseEffectiveAccess, NO_ACCESS, type EffectiveAccess } from '@/lib/auth/effectiveAccess'

/**
 * Fetches the caller's effective access.
 *
 * Never throws and never returns a partially-trusted body: a transport failure,
 * a non-OK status and a malformed payload all degrade to `NO_ACCESS`, which
 * grants nothing. Failing towards LESS chrome is the right direction — a module
 * pill that should have appeared is a visible annoyance the user can report,
 * whereas one that should not have appeared teaches them the wrong thing about
 * what they may reach and then 403s when they click it.
 */
export async function fetchEffectiveAccess(signal?: AbortSignal): Promise<EffectiveAccess> {
  try {
    const res = await fetch('/api/me/access', { cache: 'no-store', signal })
    if (!res.ok) return NO_ACCESS
    return parseEffectiveAccess(await res.json())
  } catch {
    return NO_ACCESS
  }
}
