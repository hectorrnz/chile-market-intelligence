// R13.6F — SERVER-ONLY. Binds the pure invite orchestration to the real clients.
//
// Never import this from a client component: it reaches the Auth Admin API through
// the service-role client and reads RESEND_API_KEY through the notification email
// provider. The pure logic it wires up lives in `inviteOrchestration.ts`, which has
// no such imports and is where the behaviour is actually tested.
//
// THE TWO-CLIENT SPLIT
// ────────────────────
// `admin`   — service role. Used ONLY where Auth itself must be managed: minting
//             the invited identity and, in the narrow compensating case, removing
//             one that was just created. It can create an identity; it cannot
//             decide who may do so.
// `session` — the administrator's own session. Every application-state write goes
//             through it, because the RPCs resolve their actor from `auth.uid()`
//             and would refuse a service-role caller outright.
//
// Splitting it this way means a bug in a route handler cannot cause an
// unauthorized application write: the only client that could bypass RLS is never
// given an application statement to run.

import type { InvitePorts } from './inviteOrchestration.ts'
import { sendInviteEmail } from './inviteEmail.ts'
import { sendNotificationEmail } from '../notifications/emailProvider'
import { classifyRpcError } from './adminRpc.ts'

/** The Auth Admin surface used here, narrowed to what is actually called. */
interface AuthAdminClient {
  auth: {
    admin: {
      listUsers: (p: { page: number; perPage: number }) => Promise<{
        data: { users: { id: string; email?: string | null }[] } | null
        error: unknown
      }>
      generateLink: (p: {
        type: 'invite'
        email: string
        options?: { redirectTo?: string }
      }) => Promise<{
        data: { properties: { action_link?: string } | null; user: { id?: string } | null } | null
        error: unknown
      }>
      deleteUser: (id: string) => Promise<{ data: unknown; error: unknown }>
    }
  }
}

/** The PostgREST surface used here, narrowed to what is actually called. */
interface SessionClient {
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>
      }
    }
  }
}

const MAX_USER_PAGES = 10
const USERS_PER_PAGE = 200

export function buildInvitePorts(
  admin: AuthAdminClient,
  session: SessionClient,
): InvitePorts {
  return {
    async findAuthUserByEmail(email) {
      const wanted = email.trim().toLowerCase()
      for (let page = 1; page <= MAX_USER_PAGES; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE })
        // A read failure is reported as such, never as "no such user" — the
        // compensating delete keys off this answer, and guessing would risk
        // deleting an identity this request did not create.
        if (error) return 'error'
        const users = data?.users ?? []
        const match = users.find((u) => (u.email ?? '').trim().toLowerCase() === wanted)
        if (match) return { id: match.id }
        if (users.length < USERS_PER_PAGE) return null
      }
      // Ran out of pages without a definitive answer. Not the same as "absent".
      return 'error'
    },

    async generateInviteLink(email, redirectTo) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo },
      })
      if (error) {
        // The Auth error message can name the address; it is not forwarded.
        return { ok: false, code: 'invite_link_failed' }
      }
      const userId = data?.user?.id
      const actionLink = data?.properties?.action_link
      if (typeof userId !== 'string' || typeof actionLink !== 'string' || !actionLink) {
        return { ok: false, code: 'invite_link_incomplete' }
      }
      return { ok: true, userId, actionLink }
    },

    async provisionInvite({ userId, identity, shape }) {
      const { error } = await session.rpc('nmi_admin_provision_invite', {
        p_target_user_id: userId,
        p_username: identity.username,
        p_email: identity.email,
        p_display_name: identity.displayName,
        p_role: shape.role,
        p_principal: shape.principal,
        p_modules: shape.modules,
      })
      if (error) {
        const { code, status } = classifyRpcError(error)
        return { ok: false, code, status }
      }
      return { ok: true }
    },

    async profileExists(userId) {
      const { data, error } = await session
        .from('user_profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle()
      if (error) return 'error'
      return data !== null
    },

    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      return !error
    },

    async sendInvite({ identity, actionLink }) {
      return sendInviteEmail(
        {
          to: identity.email,
          displayName: identity.displayName,
          username: identity.username,
          actionLink,
        },
        sendNotificationEmail,
      )
    },
  }
}
