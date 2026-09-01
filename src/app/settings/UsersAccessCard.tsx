'use client'

// POST-R13.6CDE — the Settings entry point for the Users & Access console.
//
// ADMINISTRATOR ONLY, and hidden rather than disabled: a member has no use for
// knowing the console exists, and a greyed-out control invites them to ask why
// they cannot use it.
//
// HIDING IS NOT THE PROTECTION. `/settings/users` re-checks administrator status
// in its own server component, and both APIs behind it re-check on every
// request. A member who learns the URL is refused by the server, not by the
// absence of this card — the same "client is presentation, never protection"
// model `/portfolio/admin` already uses.
//
// It renders nothing at all while access is still resolving, so it can never
// flash into view for a member on a slow connection.

import Link from 'next/link'
import { useLang } from '@/components/providers/LangProvider'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { ChipLabel } from '@/components/fable/Chip'
import { useModuleAccess } from '@/components/providers/ModuleAccessProvider'

export function UsersAccessCard() {
  const { t } = useLang()
  const { access, ready } = useModuleAccess()

  if (!ready || !access.isAdministrator) return null

  return (
    // Same 14px row gap and px-5/py-[18px] card padding as the rest of the
    // Settings composition, so this reads as the next Fable row, not an
    // appendix stuck to the Notification Recipients card.
    <GlassSurface variant="card" as="section" className="mt-[14px] px-5 py-[18px] flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="ui-label text-muted-fg">{t.usersAccess.tag}</h2>
          <p className="ui-meta text-muted-fg mt-1">{t.usersAccess.subtitle}</p>
        </div>
        <ChipLabel className="shrink-0">{t.usersAccess.entryNote}</ChipLabel>
      </div>
      {/* The open action in the Fable chip recipe — a real pill hit target
          instead of a bare text link. */}
      <Link
        href="/settings/users"
        className="self-start inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full border border-[var(--nv-chipbd)] bg-[var(--nv-chip)] text-xs text-foreground whitespace-nowrap hover:bg-[var(--selected)] nv-transition"
      >
        {t.usersAccess.open} →
      </Link>
    </GlassSurface>
  )
}
