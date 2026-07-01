// Phase 6B — Pure credential validation helpers (no side effects, testable).
// Used by the register/login routes and covered by unit tests.

/** Trim surrounding whitespace; usernames are compared case-insensitively (citext). */
export function normalizeUsername(raw: string): string {
  return raw.trim()
}

/** 3–30 chars: letters, digits, underscore, dot, hyphen. No spaces. */
export function isValidUsername(u: string): boolean {
  return /^[a-zA-Z0-9_.-]{3,30}$/.test(u)
}

/** At least 8 characters (Supabase default minimum), capped to a sane length. */
export function isValidPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 8 && p.length <= 200
}

/** Minimal email shape check — real validation happens at Supabase. */
export function isValidEmail(e: unknown): e is string {
  return typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim())
}

/** Display name: 1–60 visible characters. */
export function isValidDisplayName(d: unknown): d is string {
  return typeof d === 'string' && d.trim().length >= 1 && d.trim().length <= 60
}
