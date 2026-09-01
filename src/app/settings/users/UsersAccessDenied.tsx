'use client'

// POST-R13.6CDE — what a non-administrator sees at /settings/users.
//
// Rendered by the SERVER component after it has already established that the
// caller is not an administrator, so this markup only ever reaches someone who
// genuinely may not manage accounts.
//
// It says so plainly rather than 404-ing or showing a generic failure. The route
// is a real, documented part of the product; pretending it does not exist would
// make an administrator who mistypes their session state think the feature was
// broken, and a member who followed a shared link think the app had crashed.

import { useLang } from '@/components/providers/LangProvider'
import { PageHeader } from '@/components/fable/PageHeader'
import { GlassSurface } from '@/components/fable/GlassSurface'
import { AsyncState } from '@/components/fable/AsyncState'

export function UsersAccessDenied() {
  const { t } = useLang()
  return (
    <div className="w-full">
      <PageHeader eyebrow={t.settings.tag} title={t.usersAccess.title} />
      <GlassSurface variant="card" className="mt-3">
        <AsyncState kind="not_authorized" message={t.usersAccess.notAuthorized} />
      </GlassSurface>
    </div>
  )
}
