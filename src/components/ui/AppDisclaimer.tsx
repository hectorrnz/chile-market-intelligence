'use client'

import { useLang } from '@/components/providers/LangProvider'

export function AppDisclaimer() {
  const { t } = useLang()
  return (
    <div className="no-print shrink-0 border-t border-border px-6 py-1 bg-background">
      <p className="text-[11px] text-muted-fg text-center">{t.topbar.disclaimer}</p>
    </div>
  )
}
