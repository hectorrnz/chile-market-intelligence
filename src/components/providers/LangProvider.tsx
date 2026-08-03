'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { dict, type Lang, type Translation } from '@/lib/i18n'


interface LangContextType {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Translation
}

const LangContext = createContext<LangContextType>({
  lang: 'en',
  setLang: () => {},
  t: dict.en,
})

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('lang') as Lang | null
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === 'en' || saved === 'es') setLangState(saved)
    } catch {
      // localStorage unavailable — keep default 'en'
    }
  }, [])

  // R9.0 — cross-tab synchronization. Same provider, same `lang` key, same raw
  // 'en' | 'es' format, same default: the only addition is that a write from
  // ANOTHER tab now reaches this one, so two open tabs can never disagree about
  // the interface language. Same-tab consumers already stay in step through the
  // context below, so nothing else changes.
  //
  // A `storage` event for any other key is ignored, and so is any value that is
  // not exactly 'en' or 'es' — including `newValue === null`, which is what a
  // `removeItem`/`clear()` elsewhere produces. An unrecognised value leaves the
  // current language alone rather than silently resetting the UI.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== 'lang') return
      if (e.newValue === 'en' || e.newValue === 'es') setLangState(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function setLang(newLang: Lang) {
    setLangState(newLang)
    try { localStorage.setItem('lang', newLang) } catch {}
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t: dict[lang] as Translation }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
