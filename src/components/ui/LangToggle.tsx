'use client'

import { useLang } from '@/components/providers/LangProvider'
import type { Lang } from '@/lib/i18n'

export function LangToggle() {
  const { lang, setLang, t } = useLang()

  function switchTo(next: Lang) {
    if (next !== lang) setLang(next)
  }

  return (
    <div
      className="flex items-center gap-0.5 text-xs font-mono border border-border rounded overflow-hidden"
      title={t.topbar.language}
    >
      {(['en', 'es'] as Lang[]).map((code) => (
        <button
          key={code}
          onClick={() => switchTo(code)}
          className={[
            'px-2 py-1 uppercase transition-colors',
            lang === code
              ? 'bg-surface-2 text-foreground font-medium'
              : 'bg-surface text-muted-fg hover:text-muted',
          ].join(' ')}
        >
          {code}
        </button>
      ))}
    </div>
  )
}
