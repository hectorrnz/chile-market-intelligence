'use client'

import { useLang } from '@/components/providers/LangProvider'
import { useTheme } from '@/lib/useTheme'

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 shrink-0"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 shrink-0"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export function ThemeToggle() {
  const { t } = useLang()
  // R9.0 — state ownership moved out of this component into the ONE shared
  // theme store (`@/lib/useTheme`). The storage key, its raw 'dark' | 'light'
  // format, the dark-class effect and every rendered/accessibility detail below
  // are unchanged; this toggle is now simply one synchronized VIEW of the
  // preference rather than a private copy of it, so any other mounted theme
  // control (and any other tab) stays in step with it.
  const { isDark, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label={t.topbar.theme}
      className="inline-flex items-center h-7 p-0.5 rounded-full border gap-px"
      style={{ backgroundColor: 'var(--nv-chip)', borderColor: 'var(--nv-chipbd)' }}
    >
      {/* R7.1A — below `sm` each segment compacts to its icon so the header
          fits a 320px viewport; the text labels return at `sm`. Both options
          stay individually rendered, keyboard-operable, aria-pressed, and
          `title`-named at every width — never reduced to a text-only label
          (theme-toggle rule). */}
      {/* Light segment */}
      <button
        onClick={() => setTheme('light')}
        aria-pressed={!isDark}
        aria-label={t.topbar.switchToLight}
        title={t.topbar.switchToLight}
        className="inline-flex items-center gap-1.5 h-full px-1.5 sm:px-2.5 rounded-full text-xs nv-transition"
        style={
          !isDark
            ? { backgroundColor: 'var(--surface)', color: 'var(--foreground)' }
            : { color: 'var(--muted-fg)' }
        }
      >
        <SunIcon />
        <span className="hidden sm:inline">{t.topbar.light}</span>
      </button>

      {/* Dark segment */}
      <button
        onClick={() => setTheme('dark')}
        aria-pressed={isDark}
        aria-label={t.topbar.switchToDark}
        title={t.topbar.switchToDark}
        className="inline-flex items-center gap-1.5 h-full px-1.5 sm:px-2.5 rounded-full text-xs nv-transition"
        style={
          isDark
            ? { backgroundColor: 'var(--surface)', color: 'var(--foreground)' }
            : { color: 'var(--muted-fg)' }
        }
      >
        <MoonIcon />
        <span className="hidden sm:inline">{t.topbar.dark}</span>
      </button>
    </div>
  )
}
