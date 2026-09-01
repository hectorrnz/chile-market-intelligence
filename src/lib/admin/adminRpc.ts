// R13.6F — calling the administrative RPCs, and translating their refusals.
//
// WHY THE RPCs ARE CALLED WITH THE ADMINISTRATOR'S OWN SESSION
// ────────────────────────────────────────────────────────────
// Every function in the R13.6F migration begins with `nmi_assert_admin_actor()`,
// which resolves the actor from `auth.uid()`. The service-role client has no
// `auth.uid()`, so a service-role call would raise `not_authenticated` — by
// design. Routing these through the user session is what makes the database, not
// the route handler, the place authorization is decided, and it is what lets the
// audit rows record a real actor instead of "the server".
//
// The Auth Admin API is the one exception, and only where Auth itself must be
// managed (creating the invited identity). It cannot write application state.
//
// STABLE TOKENS, NOT MESSAGE MATCHING
// ───────────────────────────────────
// Each RPC raises a bare token — `last_administrator`, `username_taken`,
// `already_activated` — with no interpolated user data. This module maps those to
// HTTP status codes. Anything unrecognised becomes a generic 500 with NO detail
// forwarded: a raw PostgreSQL message can carry column names, constraint names and
// occasionally row values, none of which belong in an API response.

/** Every refusal the R13.6F RPCs can raise, mapped to its HTTP status. */
export const RPC_ERROR_STATUS: Readonly<Record<string, number>> = {
  // Authorization
  not_authenticated: 401,
  not_administrator: 403,
  // Request shape
  invalid_target: 400,
  invalid_username: 400,
  invalid_email: 400,
  invalid_role: 400,
  invalid_principal: 400,
  invalid_action: 400,
  unknown_module: 400,
  // Target state
  target_not_found: 404,
  auth_identity_missing: 409,
  no_profile: 404,
  not_approved: 409,
  account_disabled: 409,
  // Conflicts that are expected in normal use and must read cleanly
  username_taken: 409,
  already_activated: 409,
  /**
   * The last-administrator invariant. 409 because it is a genuine conflict with
   * the current state of the world rather than a malformed request: the same call
   * would succeed once another administrator exists.
   */
  last_administrator: 409,
}

/** The recognised token in a PostgREST/Supabase RPC error, or null. */
export function rpcErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return null
  // The raised token is the whole message for our own `raise exception 'token'`,
  // but PostgREST may prefix it. Match a known token as a WHOLE WORD rather than a
  // substring, so `not_administrator` can never be read as `not_authenticated`.
  for (const token of Object.keys(RPC_ERROR_STATUS)) {
    const pattern = new RegExp(`(^|[^a-z_])${token}([^a-z_]|$)`)
    if (pattern.test(message)) return token
  }
  return null
}

export interface RpcFailure {
  readonly code: string
  readonly status: number
}

/**
 * Reduces an RPC error to a stable code and status.
 *
 * An unrecognised failure is deliberately flattened to `write_failed` / 500 and
 * the original message is DROPPED rather than forwarded. It is not useful to the
 * administrator, and it is the one place a database internal could reach a client.
 */
export function classifyRpcError(error: unknown): RpcFailure {
  const code = rpcErrorCode(error)
  if (code) return { code, status: RPC_ERROR_STATUS[code] }
  return { code: 'write_failed', status: 500 }
}
