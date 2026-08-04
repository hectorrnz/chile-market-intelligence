// R9.4 — the recipient workflow moved into the canonical Settings page's
// full-width third row (`/settings#notifications`). This route is kept so
// existing bookmarks, older links and the pre-R9.4 notification-bell target
// still resolve, and it does exactly one thing: redirect there.
//
// The redirect is ONE-DIRECTIONAL by construction — `/settings` never redirects
// anywhere, so no loop is possible. Both paths remain private under the
// existing default-deny policy, and `matchesPrefix` keeps this path resolving
// to the same Settings nav group and page title as before.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function NotificationSettingsRedirect() {
  redirect('/settings#notifications')
}
