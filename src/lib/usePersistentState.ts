'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * useState that persists to localStorage and stays hydration-safe.
 *
 * Built on `useSyncExternalStore` (no setState-in-effect, no refs read during
 * render). Renders `initial` on the server / during hydration, then reconciles
 * to the stored value. Writes notify other hook instances in the same tab (a
 * custom event) and other tabs (the native `storage` event), so e.g. the
 * sidebar and the macro page stay in sync.
 *
 * Snapshots are cached at module scope keyed by storage key, so `getSnapshot`
 * returns a *stable* reference while the underlying JSON is unchanged — required
 * by `useSyncExternalStore` for object/array values.
 */
const snapByKey = new Map<string, { raw: string | null; val: unknown }>()

function readStore<T>(key: string, initial: T): T {
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* ignore */ }
  const cached = snapByKey.get(key)
  if (cached && cached.raw === raw) return cached.val as T
  let val: T = initial
  if (raw != null) {
    try { val = JSON.parse(raw) as T } catch { val = initial }
  }
  snapByKey.set(key, { raw, val })
  return val
}

export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const evt = `cmi-ls:${key}`

  const subscribe = useCallback((onChange: () => void) => {
    const onStorage = (e: StorageEvent) => { if (e.key === key) onChange() }
    window.addEventListener('storage', onStorage)
    window.addEventListener(evt, onChange)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(evt, onChange)
    }
  }, [key, evt])

  const getSnapshot = useCallback(() => readStore(key, initial), [key, initial])
  const getServerSnapshot = useCallback(() => initial, [initial])

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    const resolved = typeof next === 'function'
      ? (next as (prev: T) => T)(readStore(key, initial))
      : next
    const raw = JSON.stringify(resolved)
    try { localStorage.setItem(key, raw) } catch { /* ignore */ }
    snapByKey.set(key, { raw, val: resolved })
    window.dispatchEvent(new Event(evt))
  }, [key, evt, initial])

  return [value, setValue]
}
