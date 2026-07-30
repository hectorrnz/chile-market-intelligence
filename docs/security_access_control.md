# Access Control and User Provisioning

Canonical reference for who can reach what in Nevada Market Intelligence, and how
accounts are created and revoked. Established in **Phase R1.5**. Update this file
whenever a route's access class or the approval boundary changes.

Nevada Market Intelligence is a **private family-office platform**. There is no
public surface beyond sign-in and account recovery, and there is no
self-registration.

---

## 1 · The access model

**Default-deny.** `src/lib/auth/accessPolicy.ts` is the single source of truth.
Anything not matched by an explicit allowlist is private, so a route added in a
later phase is protected the moment it exists.

| Class | Meaning | Denial |
|---|---|---|
| `public_page` | Reachable with no session | — |
| `public_api` | JSON endpoint the pre-session flows call | — |
| `session_mint` | Establishes or clears a session | — |
| `bearer_auth_api` | `/api/cron/**`; validates its own bearer secret | 401 in-handler |
| `framework` | `/_next/**`, root framework files, any file with an extension | — |
| `private_page` | Everything else under `/` | 302 → `/login?next=…` |
| `private_api` | Everything else under `/api/` | JSON 401, `no-store` |

### Public browser allowlist (complete)

```
/login
/forgot-password
/auth/reset-password
```

### Session-mint allowlist (complete)

```
/auth/callback   — PKCE exchange for recovery links; enforces approval itself
/logout          — must work with or without a session, or sign-out loops
```

### Public API allowlist (complete)

```
/api/auth/login
/api/auth/forgot-password
/api/auth/reset-password
```

Everything else — `/api/market/**`, `/api/macro/**`, `/api/earnings/**`,
`/api/financials/**`, `/api/valuation/**`, `/api/compare/**`, `/api/news`,
`/api/portfolios/**`, `/api/watchlists/**`, `/api/structured-notes/**`,
`/api/notifications/**`, `/api/notification-recipients/**`,
`/api/health/**` — requires a session. Before R1.5 the first seven of those
families were world-readable.

---

## 2 · Enforcement layers

### Verified session

**Middleware** (`src/middleware.ts`) is the authoritative gate. It runs on every
non-asset request and, for every path the policy marks private, executes
`decideRequestAccess` (`src/lib/auth/requestAccess.ts`) with two Supabase-backed
inputs:

1. **`auth.getUser()`** — validates the token *with the Auth server*. This is
   what rejects a malformed cookie, a forged or expired token, and a **banned or
   deleted** account. It is never a local decode, and `getSession()` is not used
   to authorise anything.
2. **A single-row `user_profiles` read** under own-row RLS (`auth.uid() = id`),
   fetching the current approval marker. The service-role client is never used.

Decision table:

| Condition | Browser | API |
|---|---|---|
| No session / malformed / forged / expired / banned / deleted | 307 → `/login?next=…` | **401** `unauthenticated` |
| Verified identity, no current approval | 307 → `/login?next=…&error=not_authorized`, `sb-*` cookies cleared | **403** `not_authorized` |
| Verified identity, currently approved | proceed | proceed |

A verifier or lookup that throws fails **closed**.

**Latency cost, accepted deliberately.** Every private request now makes two
sequential Supabase round-trips (Auth verify, then the approval read) from the
middleware runtime. The pre-correction gate was zero-network — it read the
session cookie — but it authorised from unverified state and could not revoke
promptly. A page that fires several API calls multiplies this cost. For a
family-office platform with a handful of users that is the correct trade; if it
ever becomes a problem, the fix is a short-TTL server-side approval cache with
explicit invalidation on revoke, **not** a return to cookie-only trust.

### Approval on every request

Approval is **not** checked only at login, at callback, at token creation, at
refresh, or on first page load. It is re-read on every private browser request
and every private API request, which is what makes revocation immediate:

> approved user signs in → administrator runs `--revoke --write` → the user's
> **next** browser request redirects and their **next** API request returns 403.
> No access-token-expiry wait.

### Defence in depth

- **`guardPrivateApi()` / `getApprovedUser()`** (`apiGuard.ts`, `getUser.ts`) —
  the same two conditions, for handlers that need the caller's identity in their
  own logic. Not an opt-in for protection: middleware already covers every
  private endpoint.
- **Postgres RLS** — unchanged from Phase 6A/6C/6D/9B. Every user-scoped table
  authorises on `auth.uid()`.
- **Session-mint approval** — `/api/auth/login` and `/auth/callback` also apply
  the predicate, so an unapproved identity is never issued a cookie at all.

**When Supabase is unconfigured**, no request can be authorised, so middleware
fails **closed** for private paths. `/login`, the auth endpoints and all assets
still respond, so the app builds, deploys and renders the gateway with zero env
vars — but it serves no data. This is a deliberate change from the pre-R1.5
behaviour, where missing credentials left the whole private API surface open.

---

## 2a · Controls outside the application code

Two findings outside the application layer could defeat the approval boundary.
Both were verified against the connected project on **2026-07-30**.

| # | Finding | Status |
|---|---|---|
| 1 | `user_profiles` RLS permitted self-approval | **Migration written — NOT YET APPLIED.** See §2b |
| 2 | Public Supabase signup enabled | **RESOLVED 2026-07-30** by the administrator; re-verified `disable_signup: true` |

Until the §2b migration is applied to production, the approval boundary is
enforced by the application but not by the database: a user holding any session
can still grant it to themselves.

### Finding 1 — the former unsafe policies

`supabase/migrations/20260701000000_auth_watchlist_foundation.sql` granted every
authenticated identity write access to its own approval record:

```sql
create policy "users_own_profile_select" on user_profiles
  for select using (auth.uid() = id);             -- ← kept (tightened in §2b)

create policy "users_own_profile_insert" on user_profiles
  for insert with check (auth.uid() = id);        -- ← creates the marker

create policy "users_own_profile_update" on user_profiles
  for update using (auth.uid() = id);             -- ← no WITH CHECK: rewrites it
```

Any holder of a session — including one obtained through the recovery-link path —
could `INSERT` a `user_profiles` row with a free username using the **public anon
key**, and thereby approve itself. `UPDATE` had no `WITH CHECK` clause, so a
revoked user could restore their own marker or repoint `email` at another
identity.

There were also **no explicit grants anywhere in the repository's migrations**,
so the table relied entirely on Supabase's default `anon`/`authenticated` grants.
Confirmed live before the repair: an anonymous
`GET /rest/v1/user_profiles?select=id,username` returned **HTTP 200 with `[]`** —
the rows were filtered by RLS, but the request itself was accepted.

Until §2b is applied, treat the approval boundary as advisory: the application
enforces it, but the database still lets a user grant it to themselves.

### ~~BLOCKING 2~~ — public Supabase signup · **RESOLVED 2026-07-30**

Deleting `/api/auth/register` removed the *application's* signup path. It did not
touch Supabase Auth, which exposes `POST /auth/v1/signup` directly to anyone
holding the publishable anon key — a key that ships in the client bundle by
design.

First read-only check of the connected project on **2026-07-30** via
`GET /auth/v1/settings` found the control **off**:

```
disable_signup     : false      ← public signup was ENABLED
mailer_autoconfirm : false      ← e-mail confirmation is required
external providers : email
```

The administrator disabled it the same day. Re-verified at **15:17 UTC**:

```
disable_signup     : true       ← public signup is DISABLED
mailer_autoconfirm : false
external providers : email
```

This closes the outsider's route to an `auth.users` identity. **It does not
close BLOCKING 1**: an identity that already exists — or any existing approved
user — can still write its own `user_profiles` row with the anon key, so the
self-approval and self-restoration paths remain open until the RLS repair above
is applied. The specific bypass this control removed was: direct `signUp` →
confirm the address you control → `INSERT` your own profile row → full access.

This is a **deployment setting, not code** — it can be switched back at any time
and is not enforced by anything in this repository. Re-verify with the procedure
in §4a after any Supabase project change, and keep the log there current.

---

## 2b · The repair — `user_profiles` becomes administrator-controlled

Migration: **`supabase/migrations/20260730000000_user_profiles_admin_controlled_approval.sql`**
— forward-only, re-runnable, privileges and policies only. **Not applied to any
environment.**

### What it does

1. Guards on `public.user_profiles` existing, and raises a clear exception if it
   does not.
2. Re-asserts `enable row level security` (never disables it).
3. **Drops every policy currently attached to the table**, enumerated from
   `pg_catalog.pg_policies` and dropped with `format('drop policy %I …')`. A
   guessed list of names would leave a permissive policy added by hand under some
   other name in place; enumeration cannot.
4. Creates exactly one policy: `users_own_profile_select`, `SELECT`, `to
   authenticated`, `using (auth.uid() = id)`, no `WITH CHECK`.
5. **Revokes ALL privileges** from `PUBLIC`, `anon` and `authenticated`, then
   grants back only `select` to `authenticated` and `all privileges` to
   `service_role`. The blanket revoke is deliberate: a DML-only list
   (`insert, update, delete, truncate`) leaves `REFERENCES` and `TRIGGER` behind.
6. **Revokes column-level grants too.** `REVOKE … ON TABLE` does *not* remove
   column privileges in PostgreSQL — they live in `pg_attribute.attacl` — so an
   old `GRANT UPDATE (username)` would survive a table-level revoke and quietly
   keep the boundary writable. Every column is enumerated and stripped.
7. **Asserts its own final state** and raises a clear exception on any deviation
   (see "Postconditions" below).
8. Adds `comment on` the table and the `username` column recording the boundary.

Every statement — table, policy, grant, revoke, alter, comment, and both dynamic
`format()` templates — is schema-qualified as `public.user_profiles`. Nothing
relies on `search_path`.

### Final RLS policies

| Policy | Command | Roles | Using | With check |
|---|---|---|---|---|
| `users_own_profile_select` | `SELECT` | `authenticated` | `auth.uid() = id` | — |

No `INSERT`, `UPDATE` or `DELETE` policy exists. Under RLS, a command with no
permissive policy is denied for every non-bypassing role.

### Final table grants

| Role | Table privileges | Column privileges |
|---|---|---|
| `PUBLIC` | *(none)* | *(none)* |
| `anon` | *(none)* | *(none)* |
| `authenticated` | `SELECT` only — no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` | *(none)* |
| `service_role` | `ALL PRIVILEGES` (bypasses RLS — the administrative path) | — |

### Postconditions

The migration ends with a `do $$ … $$` block that raises an exception unless all
of the following hold. These run inside the database when the migration is
pushed, which is what actually proves the privilege model:

1. exactly one policy exists on `public.user_profiles`;
2. its name is `users_own_profile_select`, its command is `SELECT`, its roles are
   `{authenticated}`, its predicate matches `auth.uid() = id`, and its
   `with_check` is null;
3. `relrowsecurity` is true;
4. `PUBLIC` and `anon` hold **no** table privilege;
5. `authenticated` holds **exactly** `SELECT`;
6. no column-level `INSERT`, `UPDATE` or `REFERENCES` grant survives for
   `PUBLIC`, `anon` or `authenticated`;
7. `service_role` still holds at least `SELECT`, `INSERT` and `UPDATE`, so
   provisioning and revocation keep working;
8. **effective** table access — `has_table_privilege()` reports false for `anon`
   on all seven privileges, and for `authenticated` on all six non-`SELECT`
   privileges, while `SELECT` remains true;
9. **effective** column access — `has_any_column_privilege()` reports false for
   `anon` and `authenticated` on `INSERT`, `UPDATE` and `REFERENCES`
   (`SELECT` is deliberately excluded: the approval lookup needs it);
10. neither `anon` nor `authenticated` **owns** the table;
11. neither holds `BYPASSRLS` or `SUPERUSER`;
12. `service_role` **does** retain `BYPASSRLS` (or superuser), or provisioning
    would be blocked by the very policy this migration installs.

The assertion is deliberately two-layered. Checks 4–6 read `pg_class.relacl` /
`pg_attribute.attacl` through `aclexplode()` and prove no *explicit* grant was
left behind. Checks 8–9 use the privilege-check functions and prove nothing is
reachable **through role membership or table ownership** either — a custom parent
role holding `UPDATE` that `authenticated` inherits would leave the direct ACL
reading "SELECT only" while real access was broader, and only the effective check
catches that. `information_schema` is avoided throughout: its views are filtered
by the current role and would silently under-report when run as a non-owner.

The policy predicate check is fail-closed (`pol.qual is null or pol.qual !~ …`) —
`null !~ pattern` evaluates to NULL rather than true, so a bare regex test would
have accepted a policy with no `USING` clause at all. The policy is also asserted
`PERMISSIVE`, matching the mode it is created in.

### Why ordinary users cannot self-approve after this

Creating an approval record needs `INSERT`: the privilege is revoked at table and
column level **and** no policy permits it. Restoring a revoked marker, changing
`username`, or repointing `email` needs `UPDATE`: likewise. Deleting needs
`DELETE`: likewise. Reading another user's row is blocked by `auth.uid() = id`.
An anonymous caller has no privilege at all — the pre-repair `200 []` becomes a
permission error.

### Why no self-service UPDATE policy was preserved

The audit found **zero** application writes to `user_profiles` from a user
session. Every read is own-row (`middleware.ts`, `getUser.ts`,
`auth/callback/route.ts`); the only cross-row read is the username → email
resolution in `/api/auth/login`, which already uses the service-role client; the
only writes are `scripts/admin/provisionUser.ts` (provision `upsert`, revoke
`update`), also service-role. `role` and `preferences` are read and written
nowhere in the codebase. So no user-facing workflow is broken, and no
column-restricted policy or RPC is needed. If profile self-editing is ever
wanted, add a **column-restricted server endpoint or RPC** — do not restore a
broad `UPDATE` policy.

### Effect on existing users

None. No row is inserted, updated or deleted; no column, constraint, index or
trigger changes; the table is not recreated. Every currently-approved user keeps
their row and their `username`, so sign-in, the per-request approval lookup and
password recovery all continue to work unchanged.

### Applying this migration

Database changes in this repository are managed as files under
`supabase/migrations/` and applied with the Supabase CLI. Do **not** paste this
migration into the remote SQL Editor — that would apply it without recording it
in the migration history, and the two would then disagree.

```bash
# 1 · Inspect local migration history
ls supabase/migrations

# 2 · Verify which project is linked (the linked one is marked in the output)
supabase projects list
#    if it is not linked yet:
#    supabase link --project-ref <project-ref>

# 3 · Compare local migrations against what the remote has applied
supabase migration list

# 4 · Dry run — shows exactly what WOULD be pushed, changes nothing
supabase db push --dry-run

# 5 · Review the pending migration named in step 4 before going further
cat supabase/migrations/20260730000000_user_profiles_admin_controlled_approval.sql

# 6 · Apply, only after the dry run has been reviewed and approved
supabase db push

# 7 · Verify afterwards (see "Verifying the result")
```

Step 6 is the only step that writes. The migration's own postcondition block runs
as part of it: if the final policy, table privileges or column privileges are not
exactly as specified, the transaction raises and the push fails rather than
leaving a half-repaired boundary.

> Note: the Supabase CLI is blocked by Windows security policy on the current
> development machine (see `CLAUDE.md`, Phase 5B.1), so these commands must be run
> from an environment where the CLI is available. Earlier migrations in this
> repository were applied through the SQL Editor for that reason; this one should
> not be.

### Verifying the result

Read-only catalog queries — they change nothing and can be run from `psql`,
`supabase db execute`, or the SQL Editor.

```sql
-- 1 · RLS still enabled
select relrowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relname = 'user_profiles';
-- expect: t

-- 2 · Exactly one policy: SELECT, {authenticated}, own-row
select policyname, cmd, roles, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'user_profiles';
-- expect: one row — users_own_profile_select | SELECT | {authenticated}
--         | (auth.uid() = id) | NULL

-- 3 · Table privileges (grantee 0 = PUBLIC)
select coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type
from pg_catalog.pg_class c
join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
cross join lateral aclexplode(c.relacl) a
left join pg_catalog.pg_roles r on r.oid = a.grantee
where ns.nspname = 'public' and c.relname = 'user_profiles'
order by 1, 2;
-- expect: no PUBLIC or anon rows; authenticated → SELECT only;
--         service_role → the full set

-- 4 · Column privileges — nothing for PUBLIC / anon / authenticated
select att.attname, coalesce(r.rolname, 'PUBLIC') as grantee, a.privilege_type
from pg_catalog.pg_attribute att
join pg_catalog.pg_class c on c.oid = att.attrelid
join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
cross join lateral aclexplode(att.attacl) a
left join pg_catalog.pg_roles r on r.oid = a.grantee
where ns.nspname = 'public' and c.relname = 'user_profiles'
  and att.attnum > 0 and not att.attisdropped;
-- expect: zero rows

-- 5 · Existing approved users are intact
select count(*) as approved from public.user_profiles where username is not null;
-- expect: unchanged from before the migration
```

Then verify behaviour end to end:

- an approved user signs in and reaches `/portfolio`;
- with that session live, `node scripts/admin/provisionUser.ts --username <name>
  --revoke --write` → their next page load redirects and their next API call
  returns **403**;
- re-provision them and confirm access returns;
- from the browser console of a signed-in session, a direct
  `supabase.from('user_profiles').insert({...})` or `.update({ username: 'x' })`
  against the anon key must fail with a permission/RLS error.

### Rollback

Not automated, and deliberately so — **rolling back restores the self-approval
vulnerability**: it re-grants `authenticated` and `anon` full table privileges and
re-creates the two policies that let any session-holder write its own approval
marker.

```sql
drop policy if exists "users_own_profile_select" on public.user_profiles;
create policy "users_own_profile_select" on public.user_profiles
  for select using (auth.uid() = id);
create policy "users_own_profile_insert" on public.user_profiles
  for insert with check (auth.uid() = id);
create policy "users_own_profile_update" on public.user_profiles
  for update using (auth.uid() = id);

grant select, insert, update, delete on table public.user_profiles to authenticated;
grant select, insert, update, delete on table public.user_profiles to anon;  -- Supabase default
```

Lossless: the forward migration changes no data, so rollback restores the prior
state exactly. Prefer a new forward migration over an ad-hoc rollback, so the
history stays accurate.

Public Supabase signup must **separately** remain disabled — see §4a. This
migration does not affect that setting, and neither control substitutes for the
other.

---

## 3 · What makes a usable account

Two records. Both are required; either alone is useless.

| Record | Field | Why it is required |
|---|---|---|
| `auth.users` | — | Supabase Auth identity; holds the password |
| `user_profiles` | `username` (citext, UNIQUE) | **The approval marker.** `/api/auth/login` resolves username → email through this row; no row means no sign-in |
| | `email` | Recovery, and the username → Auth lookup |
| | `display_name` | Shown in the shell |

`user_profiles.role` exists (default `'user'`) but is read nowhere. R1.5
deliberately does not activate it — approval is presence-based, and a role
hierarchy is a design decision for the future Users & Access phase.

Approval is **never** derived from Supabase `user_metadata`: metadata is writable
by the user themselves through the public anon key, so it cannot be an
authorization claim.

---

## 4 · Provisioning a user (administrator only)

Public self-registration is removed: the create-account mode is gone from
`/login` and `/api/auth/register` no longer exists. Accounts are created with the
CLI below, which lives outside the Next.js router and cannot be reached over HTTP.

```bash
# 1. Dry run — validates inputs, creates nothing.
node scripts/admin/provisionUser.ts \
  --username <chosen-username> \
  --email <recovery-address> \
  --display-name "<display name>"

# 2. Apply. Prints a random temporary password ONCE.
node scripts/admin/provisionUser.ts \
  --username <chosen-username> \
  --email <recovery-address> \
  --display-name "<display name>" \
  --write

# Or supply the password yourself, off argv and out of shell history:
printf '%s' '<password>' | node scripts/admin/provisionUser.ts \
  --username <chosen-username> --email <recovery-address> --password-stdin --write
```

**Where:** the administrator's own machine, or any environment holding
`SUPABASE_SERVICE_ROLE_KEY`. Never in a browser, never through the app.

**Non-secret fields required:** username, recovery email, display name
(defaults to the username).

**What it creates:** the Auth identity and the `user_profiles` approval row, in
that order. Re-running repairs a partially-provisioned account rather than
failing.

**Handing over credentials:** give the one-time temporary password out-of-band
(not by email alongside the username), then have the user set their own via
**Forgot password** on `/login`.

**Verify:** sign in at `/login` with the username, confirm a private route such
as `/portfolio` renders, then sign out and confirm `/portfolio` redirects.

**Partial-failure recovery:** the script prints `PARTIAL PROVISIONING` and exits
non-zero if the Auth identity was created but the approval record was not. Either
re-run the same command to finish it, or delete the Auth user in
**Supabase Dashboard → Authentication → Users** to roll back.

---

## 4a · Mandatory Supabase deployment settings

These are **deployment controls, not code**. The application cannot assume they
are configured, and R1.5's model is not complete until they are.

### Disable public signup

**Supabase Dashboard → Authentication → Sign In / Providers → Email →
"Allow new users to sign up" → OFF.** (The API field is `disable_signup`; turning
the toggle off sets `disable_signup: true`.)

What this preserves:

- **Administrator create-user / invite-user** — unaffected. Both go through the
  Admin API with the service-role key, which is not subject to this setting, so
  `scripts/admin/provisionUser.ts` keeps working.
- **Password recovery for existing approved users** — unaffected.
  `resetPasswordForEmail` and the `/auth/callback` → `/auth/reset-password` flow
  do not create users.

What it blocks: unauthenticated `POST /auth/v1/signup` with the public anon key,
i.e. the only remaining way for an outsider to obtain an `auth.users` identity.

### Verification (creates no user, reveals no secret)

Read the project's own public settings endpoint. It requires only the publishable
anon key already present in `.env.local`, writes nothing, and returns the flag
directly:

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" | grep -o '"disable_signup":[^,]*'
```

Expected after remediation: `"disable_signup":true`.

Do **not** verify by attempting a real `signUp` call — that creates a user when
the setting is wrong, which is precisely the condition you are testing for. Never
pass the service-role key to this check.

**Verification log** — record the date and outcome only, never an address, a
username, or key material:

| Date | `disable_signup` | Checked by |
|---|---|---|
| 2026-07-30 | `false` — **BLOCKING, remediation required** | R1.5 correction audit |
| 2026-07-30 (re-check, 15:17 UTC) | `true` — **control satisfied** | R1.5 correction audit |

### Why the Dashboard alone is not enough

Inviting or creating a user in the Supabase Dashboard produces an `auth.users`
row with no `user_profiles` row. That identity **cannot** sign in (username
resolution fails) and is refused a session at `/auth/callback` even if it follows
a recovery link. That is the intended fail-closed behaviour — not a bug to work
around by hand-editing tables.

---

## 5 · Revoking access

| Action | Effect | Latency |
|---|---|---|
| `provisionUser.ts --username <name> --revoke --write` | Clears `username`, the approval marker. Sign-in and every future session mint fail. Data is retained. | Immediate for new sessions |
| **Supabase Dashboard → Authentication → Users → Ban** | Invalidates the refresh token; `getUser()` fails at once | Immediate for verified checks; an already-issued access token stops working when it expires (Supabase default 1 h) |
| **Dashboard → Delete user** | Cascades to `user_profiles` and every user-scoped table | Same as ban |

**Do both** for a departure: revoke the approval marker *and* ban or delete the
Auth user. Revoking the marker alone leaves an already-issued access token able to
pass the middleware gate until it expires, because that gate reads the cookie
rather than the database on every request (see §2, layer 1).

---

## 6 · Safe redirects

`src/lib/auth/safeRedirect.ts` is the only validator. Middleware builds `next`
with it, the login page consumes `next` through it, and `/auth/callback`
validates its own `next` with it.

Accepted: rooted internal paths, query string preserved — `/`, `/watchlist`,
`/companies/SQM-B`, `/macro?region=cl`.

Rejected → `/`: absolute `http`/`https` URLs, protocol-relative (`//host`,
`///host`), backslash variants (`\host`, `/\host`), any scheme
(`javascript:`, `data:`), percent-encoded variants of the above, malformed
encodings, control characters (browsers strip TAB/LF/CR before resolving),
values that normalise to another origin, and empty input.

The pre-R1.5 check was `next.startsWith('/')`, which accepted `//evil.example`
— an open redirect on both the login page and `/auth/callback`.

---

## 7 · Cache safety

Private browser routes are all `'use client'` shells that fetch through the API,
so no private data is ever embedded in prerendered HTML. Middleware additionally
stamps `Cache-Control: no-store, no-cache, must-revalidate, private` on every
private response and on every denial, so nothing private can be held by a CDN or
shared between users. Public market/macro caching inside the resolvers is
untouched — those caches are server-side and firm-wide, not per-user.

---

## 8 · Residual risks

- **Access-token window on revocation.** See §5. Mitigated by banning/deleting the
  Auth user, which is the documented procedure.
- **Middleware trusts the session cookie.** `getSession()` does not re-verify the
  JWT with the Auth server. A forged cookie would still have to be signed with the
  project's JWT secret, and every route handler that calls `guardPrivateApi()` /
  `getApprovedUser()` re-verifies. Raising the gate itself to `getUser()` would
  add an Auth round-trip to every request.
- **Recovery email enumeration is deliberate.** `/forgot-password` always answers
  `ok: true`, so it does not reveal whether an address exists. An unapproved
  identity can still receive a link, but `/auth/callback` refuses it a session.
- **`user_profiles.role` is inert.** There is one privilege level today; every
  approved user sees the same shared book.

## 9 · Deferred to the Users & Access administration phase

- A browser UI for provisioning, listing, suspending and revoking users.
- An explicit account-status column (`active` / `suspended`) and an activated
  `role` column, replacing presence-based approval.
- Immediate session revocation (server-side session invalidation rather than
  waiting out the access-token TTL).
- Per-user audit logging of sign-in and access events.
- Per-role route and API scoping (today every approved user is equivalent).
