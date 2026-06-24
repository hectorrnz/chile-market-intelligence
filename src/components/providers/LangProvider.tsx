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
