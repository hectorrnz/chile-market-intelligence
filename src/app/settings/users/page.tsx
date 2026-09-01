// POST-R13.6CDE — /settings/users, the administrator Users & Access console.
//
// SERVER COMPONENT, and the check is here on purpose.
//
// NAVIGATION HIDING IS NOT SECURITY. The Settings entry is hidden from members,
// but a member who types this URL must be refused by the server, not by the
// browser deciding what to draw. `callerIsPlatformAdministrator()` resolves the
// caller's own profile through the user-session client — own-row RLS, no
// service-role, no `user_metadata` — before any console markup is produced.
//
// THE PAGE GATE IS NOT THE ONLY GATE, and is not the important one. Both APIs
// this console calls re-derive administrator status from the database on their
// own request. Passing this check grants nothing: a member who somehow rendered
// the page would see an empty table and every save would be refused. That
// layering is deliberate — the page check exists so a member gets an honest
// answer instead of a broken screen, not so the APIs can relax.

import { callerIsPlatformAdministrator } from '@/lib/auth/getModuleAccess'
import { UsersAccessClient } from './UsersAccessClient'
import { UsersAccessDenied } from './UsersAccessDenied'

export const dynamic = 'force-dynamic'

export default async function UsersAccessPage() {
  if (!(await callerIsPlatformAdministrator())) return <UsersAccessDenied />
  return <UsersAccessClient />
}
