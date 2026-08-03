'use client'

import { useSyncExternalStore } from 'react'

// R9.0 — THE shared theme store.
//
// Theme already existed; this module does not introduce a second theme system,
// a second storage key, a second default, or a React provider. It takes the
// state ownership that used to live privately inside ThemeToggle and moves it
// into one external store, so every mounted theme control (the TopBar toggle
// today, the Settings Display card later) is a synchronized VIEW of the same
// preference rather than an independent copy of it.
//
// ── THE STORAGE CONTRACT IS AUTHORITATIVE AND UNCHANGED ────────────────────
//   key      'theme'
//   values   'dark' | 'light'
//   format   RAW string — never JSON
//   default  'dark'
//
// `src/app/layout.tsx` server-renders `<html className="dark">` and its
// pre-paint script removes that class *only* when the stored value is exactly
// the raw string `light`:
//
//     if (localStorage.getItem('theme') === 'light') { … }
//
// That script runs in <head> before the body paints and is byte-identical to
// what it was before R9.0.
//
// ── WHY NOT usePersistentState ────────────────────────────────────────────
// `usePersistentState` is the right tool for every OTHER preference in this app,
// but it JSON-stringifies: it would store `"\"light\""`, which the pre-paint
// comparison above can never match. The stored preference would be silently
// ignored on every first paint and the app would flash the wrong theme before
// hydration corrected it. So theme keeps its raw format and gets this
// purpose-built store, which reuses the same `cmi-ls:<key>` same-tab event
// convention and the same native `storage` cross-tab channel.

/** The only two values this app recognises. */
export type Theme = 'dark' | 'light'

/** Storage key — unchanged since before R9.0 and shared with the pre-paint script. */
export const THEME_STORAGE_KEY = 'theme'

/**
 * Dark is the first-visit default AND the server-rendered value, because
 * layout.tsx ships `<html className="dark">` and the pre-paint script only ever
 * *removes* that class. Any missing or unrecognised stored value resolves here.
 */
export const DEFAULT_THEME: Theme = 'dark'

/** Same-tab notification channel, matching the app-wide `cmi-ls:<key>` convention. */
const THEME_EVENT = `cmi-ls:${THEME_STORAGE_KEY}`

/** Strict validation: only the exact raw string `light` is light; everything else is the default. */
function normalizeTheme(raw: string | null | undefined): Theme {
  return raw === 'light' ? 'light' : DEFAULT_THEME
}

/**
 * Current theme, read straight from storage. This is `getSnapshot` — it must be
 * pure and must return a value that is `Object.is`-stable while nothing has
 * changed. It returns a primitive string, so stability is automatic and no
 * snapshot cache is needed (unlike `usePersistentState`, whose values are
 * objects).
 */
export function readTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    // localStorage unavailable (private mode, blocked cookies) — use the default.
    return DEFAULT_THEME
  }
}

/** The server render and the hydration render both assume the default. */
function getServerSnapshot(): Theme {
  return DEFAULT_THEME
}

/** Keeps `<html class="dark">` in step with a theme value. Idempotent. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const dark = theme === 'dark'
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * Writes the preference and tells everyone.
 *
 * Module-scope, so its identity is stable across renders and it can be handed
 * straight to a `useCallback`-free event handler.
 *
 * Re-applying the value that is already current is a deliberate no-op rather
 * than an error: the DOM class and storage are both set idempotently, the
 * dispatched event makes every subscriber re-read, and `useSyncExternalStore`
 * bails out because `getSnapshot` returns an identical primitive — so writing
 * the current value can never loop.
 */
export function setTheme(next: Theme): void {
  if (typeof window === 'undefined') return
  const theme = normalizeTheme(next)
  applyTheme(theme)
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Preference can't be persisted; the in-memory/document state still updates.
  }
  window.dispatchEvent(new Event(THEME_EVENT))
}

/**
 * `subscribe` for `useSyncExternalStore`. Module-scope (stable identity) and
 * only ever invoked on the client — React never calls it during SSR.
 *
 *   · `cmi-ls:theme`  → another control in THIS tab changed the theme.
 *   · `storage`       → another TAB changed it. The document class is applied
 *                       here too, because no `setTheme` ran in this tab.
 *
 * A storage event for any other key is ignored entirely. `e.key === null` means
 * the whole store was cleared, so the value is re-read (and safely resolves to
 * the default).
 */
function subscribe(onStoreChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== THEME_STORAGE_KEY) return
    applyTheme(readTheme())
    onStoreChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(THEME_EVENT, onStoreChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(THEME_EVENT, onStoreChange)
  }
}

/** Exposed for direct (non-React) subscription and for tests. */
export const subscribeToTheme = subscribe

export interface ThemeStore {
  /** `'dark'` or `'light'` — never anything else. */
  theme: Theme
  /** Convenience for the common binary check. */
  isDark: boolean
  /** Stable across renders; safe to pass straight to an event handler. */
  setTheme: (next: Theme) => void
}

/**
 * Reads the shared theme and returns a setter. Every caller — however many are
 * mounted — sees the same value and updates the instant any one of them changes
 * it, in this tab or another.
 *
 * Hydration-safe: the server and the hydration render both use the default, then
 * React re-renders with the stored value. This is the same shape
 * `usePersistentState` already uses throughout the app.
 */
export function useTheme(): ThemeStore {
  const theme = useSyncExternalStore(subscribe, readTheme, getServerSnapshot)
  return { theme, isDark: theme === 'dark', setTheme }
}
