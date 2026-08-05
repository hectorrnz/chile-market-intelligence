'use client'

import { useLang } from '@/components/providers/LangProvider'
import type { Lang } from '@/lib/i18n'

/**
 * EN|ES capsule (Fable utility-chip language), sharing the ThemeToggle's
 * segmented-pill geometry. Behavior unchanged: same `setLang` persistence via
 * LangProvider. Body font, never monospace — EN/ES are UI labels, and the
 * monospace face is reserved for identifiers (§18).
 */
export function LangToggle() {
  const { lang, setLang, t } = useLang()

  function switchTo(next: Lang) {
    if (next !== lang) setLang(next)
  }

  return (
    <div
      role="group"
      aria-label={t.topbar.language}
      title={t.topbar.language}
      className="inline-flex items-center h-7 p-0.5 rounded-full border gap-px"
      style={{ backgroundColor: 'var(--nv-chip)', borderColor: 'var(--nv-chipbd)' }}
    >
      {(['en', 'es'] as Lang[]).map((code) => {
        const active = lang === code
        // R11: each option carries its own accessible name, matching
        // ThemeToggle — "en"/"es" alone is not a usable screen-reader label.
        const name = code === 'en' ? t.topbar.switchToEnglish : t.topbar.switchToSpanish
        return (
          <button
            key={code}
            type="button"
            onClick={() => switchTo(code)}
            aria-pressed={active}
            aria-label={name}
            title={name}
            className="inline-flex items-center h-full px-1.5 sm:px-2.5 rounded-full text-xs uppercase nv-transition"
            style={
              active
                ? { backgroundColor: 'var(--surface)', color: 'var(--foreground)', fontWeight: 600 }
                : { color: 'var(--muted-fg)' }
            }
          >
            {code}
          </button>
        )
      })}
    </div>
  )
}
