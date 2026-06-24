'use client'

import { useEffect, useState } from 'react'
import { useLang } from '@/components/providers/LangProvider'

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
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  function setTheme(dark: boolean) {
    if (dark === isDark) return
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch {}
    setIsDark(dark)
  }

  return (
    <div
      role="group"
      aria-label={t.topbar.theme}
      className="inline-flex items-center h-7 p-0.5 rounded-full border border-border gap-px"
      style={{ backgroundColor: 'var(--surface-2)' }}
    >
      {/* Light segment */}
      <button
        onClick={() => setTheme(false)}
        aria-pressed={!isDark}
        title={t.topbar.switchToLight}
        className="inline-flex items-center gap-1.5 h-full px-2.5 rounded-full text-xs transition-colors"
        style={
          !isDark
            ? { backgroundColor: 'var(--surface)', color: 'var(--foreground)' }
            : { color: 'var(--muted-fg)' }
        }
      >
        <SunIcon />
        <span>{t.topbar.light}</span>
      </button>

      {/* Dark segment */}
      <button
        onClick={() => setTheme(true)}
        aria-pressed={isDark}
        title={t.topbar.switchToDark}
        className="inline-flex items-center gap-1.5 h-full px-2.5 rounded-full text-xs transition-colors"
        style={
          isDark
            ? { backgroundColor: 'var(--surface)', color: 'var(--foreground)' }
            : { color: 'var(--muted-fg)' }
        }
      >
        <MoonIcon />
        <span>{t.topbar.dark}</span>
      </button>
    </div>
  )
}
