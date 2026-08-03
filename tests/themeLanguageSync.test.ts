// R9.0 — shared theme state and language cross-tab synchronization.
//
// Theme is tested BEHAVIOURALLY: `src/lib/useTheme.ts` keeps its store outside
// React (module-scope functions over `window`/`localStorage`), so the real
// read/normalize/write/subscribe/notify logic can be exercised directly against
// a minimal browser stub — no DOM library, no new dependency, no React renderer.
//
// LangProvider is a React component with no headless renderer available in this
// repo, so its contract is asserted by source scan (the established convention
// for every other component here). The behaviour those scans protect is listed
// in the manual-validation matrix.

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  readTheme,
  setTheme,
  applyTheme,
  subscribeToTheme,
  THEME_STORAGE_KEY,
  DEFAULT_THEME,
  type Theme,
} from '../src/lib/useTheme.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const STORE = read('src/lib/useTheme.ts')
const TOGGLE = read('src/components/ui/ThemeToggle.tsx')
const LANG_PROVIDER = read('src/components/providers/LangProvider.tsx')
const LANG_TOGGLE = read('src/components/ui/LangToggle.tsx')
const LAYOUT = read('src/app/layout.tsx')

/** Comment-stripped view, so prose can neither satisfy nor trip a source scan. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ── Minimal browser stub ────────────────────────────────────────────────────

interface FakeEvent { type: string; key?: string | null; newValue?: string | null }
type Handler = (e: FakeEvent) => void

function installBrowser(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  // Mirrors the real first paint: layout.tsx server-renders <html class="dark">.
  const classes = new Set<string>(['dark'])
  const listeners = new Map<string, Set<Handler>>()

  const fakeLocalStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  }

  const win = {
    localStorage: fakeLocalStorage,
    addEventListener(type: string, fn: Handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener(type: string, fn: Handler) { listeners.get(type)?.delete(fn) },
    dispatchEvent(e: FakeEvent) { for (const fn of [...(listeners.get(e.type) ?? [])]) fn(e) },
  }

  const g = globalThis as unknown as Record<string, unknown>
  g.window = win
  g.document = {
    documentElement: {
      classList: {
        toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c) },
        contains: (c: string) => classes.has(c),
      },
    },
  }

  return {
    raw: (k: string) => (store.has(k) ? store.get(k)! : null),
    hasDarkClass: () => classes.has('dark'),
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    /** Realistic cross-tab write: the value lands in storage, THEN the event fires. */
    otherTabWrote(key: string, value: string | null) {
      if (value === null) store.delete(key); else store.set(key, value)
      win.dispatchEvent({ type: 'storage', key, newValue: value })
    },
    /** `key: null` is what a `localStorage.clear()` in another tab produces. */
    otherTabCleared() {
      store.clear()
      win.dispatchEvent({ type: 'storage', key: null, newValue: null })
    },
  }
}

function uninstallBrowser() {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.document
}

afterEach(uninstallBrowser)

// ── THEME · storage contract ────────────────────────────────────────────────

describe('R9.0 theme store — storage contract', () => {
  test('1. a missing value defaults to dark', () => {
    installBrowser()
    assert.equal(readTheme(), 'dark')
    assert.equal(DEFAULT_THEME, 'dark')
  })

  test('2. the raw string "dark" is read correctly', () => {
    installBrowser({ theme: 'dark' })
    assert.equal(readTheme(), 'dark')
  })

  test('3. the raw string "light" is read correctly', () => {
    installBrowser({ theme: 'light' })
    assert.equal(readTheme(), 'light')
  })

  test('4. an invalid value resolves safely to the default', () => {
    for (const bad of ['LIGHT', 'Light', 'blue', '', 'null', '"light"', '{"theme":"light"}', 'system']) {
      installBrowser({ theme: bad })
      assert.equal(readTheme(), 'dark', `${JSON.stringify(bad)} must resolve to the default`)
      uninstallBrowser()
    }
  })

  test('5. writes are RAW strings, never JSON — the pre-paint comparison depends on it', () => {
    const b = installBrowser()
    setTheme('light')
    assert.equal(b.raw(THEME_STORAGE_KEY), 'light')
    assert.notEqual(b.raw(THEME_STORAGE_KEY), JSON.stringify('light'))
    setTheme('dark')
    assert.equal(b.raw(THEME_STORAGE_KEY), 'dark')
    assert.notEqual(b.raw(THEME_STORAGE_KEY), JSON.stringify('dark'))
    // The exact expression the pre-paint script evaluates.
    setTheme('light')
    assert.equal(b.raw('theme') === 'light', true)
  })

  test('5b. an out-of-range write is normalized rather than persisted verbatim', () => {
    const b = installBrowser()
    setTheme('purple' as Theme)
    assert.equal(b.raw(THEME_STORAGE_KEY), 'dark')
    assert.equal(readTheme(), 'dark')
  })

  test('6. the store never imports usePersistentState and never JSON-encodes', () => {
    // Comment-stripped: the file's header deliberately *explains* why
    // usePersistentState is wrong for theme, and that prose must not trip
    // (or satisfy) the scan.
    assert.doesNotMatch(code(STORE), /usePersistentState/)
    assert.doesNotMatch(code(STORE), /JSON\.(stringify|parse)/)
    assert.match(STORE, /THEME_STORAGE_KEY = 'theme'/)
    // Exactly one storage key is touched by the store.
    const keys = [...code(STORE).matchAll(/localStorage\.(?:get|set|remove)Item\(([^,)]+)/g)].map((m) => m[1].trim())
    assert.deepEqual([...new Set(keys)], ['THEME_STORAGE_KEY'])
  })

  test('6b. no React provider and no second default are introduced', () => {
    assert.doesNotMatch(STORE, /createContext|<[A-Za-z]+\.Provider/)
    assert.equal((STORE.match(/DEFAULT_THEME\s*:\s*Theme\s*=/g) ?? []).length, 1)
    assert.doesNotMatch(code(STORE), /matchMedia/)
  })
})

// ── THEME · synchronization ─────────────────────────────────────────────────

describe('R9.0 theme store — synchronization', () => {
  test('7. a same-tab change notifies every subscriber', () => {
    installBrowser()
    let hits = 0
    const stop = subscribeToTheme(() => { hits += 1 })
    setTheme('light')
    assert.equal(hits, 1)
    assert.equal(readTheme(), 'light')
    stop()
  })

  test('8. a cross-tab storage event updates this tab', () => {
    const b = installBrowser({ theme: 'dark' })
    let hits = 0
    const stop = subscribeToTheme(() => { hits += 1 })
    b.otherTabWrote('theme', 'light')
    assert.equal(hits, 1)
    assert.equal(readTheme(), 'light')
    stop()
  })

  test('9. an unrelated storage event is ignored entirely', () => {
    const b = installBrowser({ theme: 'dark' })
    let hits = 0
    const stop = subscribeToTheme(() => { hits += 1 })
    b.otherTabWrote('lang', 'es')
    b.otherTabWrote('cmi.privacyMode', 'true')
    b.otherTabWrote('cmi.compareSlots', '["SQM-B"]')
    assert.equal(hits, 0, 'no unrelated key may wake the theme store')
    assert.equal(readTheme(), 'dark')
    stop()
  })

  test('9b. a whole-store clear() in another tab resolves safely to the default', () => {
    const b = installBrowser({ theme: 'light' })
    assert.equal(readTheme(), 'light')
    const stop = subscribeToTheme(() => {})
    b.otherTabCleared()
    assert.equal(readTheme(), 'dark')
    assert.equal(b.hasDarkClass(), true)
    stop()
  })

  test('10. the documentElement dark class tracks the value, in this tab and from another', () => {
    const b = installBrowser({ theme: 'dark' })
    assert.equal(b.hasDarkClass(), true)
    setTheme('light')
    assert.equal(b.hasDarkClass(), false)
    setTheme('dark')
    assert.equal(b.hasDarkClass(), true)

    // Cross-tab: no setTheme runs here, so `subscribe` must apply the class.
    const stop = subscribeToTheme(() => {})
    b.otherTabWrote('theme', 'light')
    assert.equal(b.hasDarkClass(), false)
    b.otherTabWrote('theme', 'dark')
    assert.equal(b.hasDarkClass(), true)
    stop()
  })

  test('10b. applyTheme is idempotent', () => {
    const b = installBrowser()
    applyTheme('light'); applyTheme('light')
    assert.equal(b.hasDarkClass(), false)
    applyTheme('dark'); applyTheme('dark')
    assert.equal(b.hasDarkClass(), true)
  })

  test('11. multiple controls share ONE state — every one sees every change', () => {
    installBrowser({ theme: 'dark' })
    const seen: Theme[][] = [[], [], []]
    const stops = seen.map((bucket) => subscribeToTheme(() => { bucket.push(readTheme()) }))

    setTheme('light')   // e.g. the TopBar toggle
    setTheme('dark')    // e.g. the Settings Display card

    for (const bucket of seen) assert.deepEqual(bucket, ['light', 'dark'])
    for (const stop of stops) stop()
  })

  test('11b. writing the CURRENT value settles — it cannot loop', () => {
    installBrowser({ theme: 'light' })
    let hits = 0
    const stop = subscribeToTheme(() => { hits += 1 })
    setTheme('light')
    setTheme('light')
    setTheme('light')
    assert.equal(hits, 3, 'exactly one notification per call — no re-entrant cascade')
    assert.equal(readTheme(), 'light')
    stop()
  })

  test('11c. unsubscribing removes BOTH listeners', () => {
    const b = installBrowser()
    const stop = subscribeToTheme(() => {})
    assert.equal(b.listenerCount('storage'), 1)
    assert.equal(b.listenerCount(`cmi-ls:${THEME_STORAGE_KEY}`), 1)
    stop()
    assert.equal(b.listenerCount('storage'), 0)
    assert.equal(b.listenerCount(`cmi-ls:${THEME_STORAGE_KEY}`), 0)
  })

  test('12. the server snapshot is the stable default and nothing persists during SSR', () => {
    uninstallBrowser()
    assert.equal(typeof (globalThis as unknown as Record<string, unknown>).window, 'undefined')
    assert.equal(readTheme(), DEFAULT_THEME)
    assert.equal(readTheme(), readTheme())
    assert.doesNotThrow(() => setTheme('light'))   // no-op, no throw, no write
    assert.doesNotThrow(() => applyTheme('light'))
    // getSnapshot returns a primitive, so Object.is stability is structural.
    assert.match(code(STORE), /function getServerSnapshot\(\): Theme \{\s*return DEFAULT_THEME/)
    assert.match(code(STORE), /useSyncExternalStore\(subscribe, readTheme, getServerSnapshot\)/)
    assert.equal((code(STORE).match(/typeof window === 'undefined'/g) ?? []).length, 2)
  })
})

// ── THEME · preserved contracts ─────────────────────────────────────────────

describe('R9.0 theme — preserved contracts', () => {
  test('13. the layout.tsx pre-paint theme logic is unchanged', () => {
    assert.match(
      LAYOUT,
      /\(function\(\)\{try\{if\(localStorage\.getItem\('theme'\)==='light'\)\{document\.documentElement\.classList\.remove\('dark'\)\}\}catch\(e\)\{\}\}\)\(\)/,
    )
    assert.match(LAYOUT, /<html lang="en" className="h-full dark" suppressHydrationWarning>/)
    // The store must not have been wired into layout at all.
    assert.doesNotMatch(LAYOUT, /useTheme|THEME_STORAGE_KEY/)
  })

  test('14. ThemeToggle keeps its exact markup and accessibility contract', () => {
    assert.match(TOGGLE, /role="group"/)
    assert.match(TOGGLE, /aria-label=\{t\.topbar\.theme\}/)
    assert.equal((TOGGLE.match(/aria-pressed=/g) ?? []).length, 2)
    assert.match(TOGGLE, /aria-pressed=\{!isDark\}/)
    assert.match(TOGGLE, /aria-pressed=\{isDark\}/)
    assert.match(TOGGLE, /aria-label=\{t\.topbar\.switchToLight\}/)
    assert.match(TOGGLE, /aria-label=\{t\.topbar\.switchToDark\}/)
    assert.match(TOGGLE, /title=\{t\.topbar\.switchToLight\}/)
    assert.match(TOGGLE, /title=\{t\.topbar\.switchToDark\}/)
    // Both options individually rendered; icon-only collapse below `sm` intact.
    assert.ok(TOGGLE.includes('<SunIcon />') && TOGGLE.includes('<MoonIcon />'))
    assert.equal((TOGGLE.match(/hidden sm:inline/g) ?? []).length, 2)
    assert.match(TOGGLE, /h-7 p-0\.5 rounded-full border/)
    assert.match(TOGGLE, /nv-transition/)
    assert.match(TOGGLE, /var\(--nv-chip\)/)
    assert.match(TOGGLE, /var\(--nv-chipbd\)/)
  })

  test('14b. ThemeToggle owns no theme state of its own any more', () => {
    assert.match(TOGGLE, /const \{ isDark, setTheme \} = useTheme\(\)/)
    assert.match(TOGGLE, /from '@\/lib\/useTheme'/)
    assert.doesNotMatch(code(TOGGLE), /localStorage|useState|useEffect|documentElement/)
    assert.match(TOGGLE, /setTheme\('light'\)/)
    assert.match(TOGGLE, /setTheme\('dark'\)/)
  })

  test('14c. exactly one theme store exists and it is the only theme writer', () => {
    for (const src of [TOGGLE, LANG_TOGGLE, LANG_PROVIDER]) {
      assert.doesNotMatch(code(src), /localStorage\.setItem\(\s*['"]theme['"]/)
    }
    assert.equal((STORE.match(/export function useTheme\b/g) ?? []).length, 1)
  })
})

// ── LANGUAGE ────────────────────────────────────────────────────────────────

describe('R9.0 language — cross-tab synchronization', () => {
  test('15. the default is still en', () => {
    assert.match(LANG_PROVIDER, /useState<Lang>\('en'\)/)
    assert.match(LANG_PROVIDER, /lang: 'en',/)
  })

  test('16. setLang still writes the RAW en/es value to the existing key', () => {
    assert.match(LANG_PROVIDER, /localStorage\.setItem\('lang', newLang\)/)
    assert.doesNotMatch(code(LANG_PROVIDER), /JSON\.(stringify|parse)/)
    assert.doesNotMatch(LANG_PROVIDER, /usePersistentState/)
    const keys = [...code(LANG_PROVIDER).matchAll(/localStorage\.(?:get|set)Item\('([^']+)'/g)].map((m) => m[1])
    assert.deepEqual([...new Set(keys)], ['lang'])
  })

  test('17. a cross-tab storage event updates the language', () => {
    const c = code(LANG_PROVIDER)
    assert.match(c, /window\.addEventListener\('storage', onStorage\)/)
    assert.match(c, /if \(e\.newValue === 'en' \|\| e\.newValue === 'es'\) setLangState\(e\.newValue\)/)
  })

  test('18. an invalid cross-tab value is ignored, not applied', () => {
    // The ONLY setLangState call in the storage handler is guarded by the
    // en/es check above — there is no fallback branch that could apply
    // an unrecognised value (or a null from removeItem/clear).
    const handler = code(LANG_PROVIDER).match(/function onStorage\(e: StorageEvent\)\s*\{[\s\S]*?\n {4}\}/)
    assert.ok(handler, 'the storage handler must be a named function')
    assert.equal((handler![0].match(/setLangState\(/g) ?? []).length, 1)
    assert.match(handler![0], /e\.newValue === 'en' \|\| e\.newValue === 'es'/)
  })

  test('19. an unrelated storage event does nothing', () => {
    const handler = code(LANG_PROVIDER).match(/function onStorage\(e: StorageEvent\)\s*\{[\s\S]*?\n {4}\}/)
    assert.match(handler![0], /if \(e\.key !== 'lang'\) return/)
  })

  test('20. the listener is removed on unmount', () => {
    assert.match(
      code(LANG_PROVIDER),
      /return \(\) => window\.removeEventListener\('storage', onStorage\)/,
    )
    // Registered once, in an effect with an empty dependency array.
    assert.equal((code(LANG_PROVIDER).match(/addEventListener/g) ?? []).length, 1)
    assert.equal((code(LANG_PROVIDER).match(/removeEventListener/g) ?? []).length, 1)
  })

  test('21. the useLang() interface is unchanged', () => {
    assert.match(LANG_PROVIDER, /interface LangContextType \{\s*lang: Lang\s*setLang: \(lang: Lang\) => void\s*t: Translation\s*\}/)
    assert.match(LANG_PROVIDER, /export function useLang\(\) \{\s*return useContext\(LangContext\)\s*\}/)
    assert.match(LANG_PROVIDER, /t: dict\[lang\] as Translation/)
  })

  test('22. exactly one LangProvider exists', () => {
    assert.equal((LANG_PROVIDER.match(/export function LangProvider\b/g) ?? []).length, 1)
    assert.equal((LANG_PROVIDER.match(/createContext<LangContextType>/g) ?? []).length, 1)
  })

  test('23. no second lang key, hook, or dictionary is introduced', () => {
    assert.doesNotMatch(code(LANG_PROVIDER), /localStorage\.(get|set)Item\('(?!lang')/)
    assert.equal((LANG_PROVIDER.match(/from '@\/lib\/i18n'/g) ?? []).length, 1)
    assert.doesNotMatch(code(STORE), /\blang\b/)
    assert.doesNotMatch(code(STORE), /dict|i18n/)
  })
})

// ── Scope ───────────────────────────────────────────────────────────────────

describe('R9.0 scope — nothing beyond the preference architecture', () => {
  test('no Settings UI, Switch primitive, or privacy-mode consumer is introduced', () => {
    for (const src of [STORE, TOGGLE, LANG_PROVIDER]) {
      assert.doesNotMatch(src, /role="switch"|\/settings|privacyMasked|usePrivacyMode/)
    }
  })

  test('no server persistence, API, or database surface is touched', () => {
    for (const src of [STORE, TOGGLE, LANG_PROVIDER]) {
      assert.doesNotMatch(src, /supabase|\/api\/|@\/lib\/db|user_profiles|fetch\(/i)
    }
  })
})
