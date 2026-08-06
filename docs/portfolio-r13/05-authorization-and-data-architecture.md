# R13.0 · Document 05 — Authorization and Data Architecture

**Phase:** R13.0 — documentation only. No migration is applied, no table is created, no policy is
changed. Table and column names below are **PROPOSED** and must be confirmed against existing
conventions before R13.1 writes any SQL.

---

## 1. What exists today — VERIFIED

Recapped from `01-current-state-audit.md` § 3, because every proposal here builds on it:

- **Default-deny routing.** `src/lib/auth/accessPolicy.ts` classifies anything not explicitly
  allowlisted as `private_page`/`private_api`. A new R13 route is protected the moment it exists.
- **Binary approval.** `isApprovedProfile()` — a non-empty `user_profiles.username` means approved.
  There is no scoping of *what* an approved user may see.
- **Administrator-only writes.** `20260730000000_user_profiles_admin_controlled_approval.sql` leaves
  exactly one policy (`users_own_profile_select`), revokes all privileges from `public`/`anon`/
  `authenticated`, grants back only `SELECT` to `authenticated`, strips column-level grants, and
  asserts the end state — including *effective* privileges via `has_table_privilege`.
- **`user_profiles.role`** exists in the database (`text not null default 'user'`) and is read
  **nowhere**. `approval.ts` states it is deliberately dormant, awaiting "the future Users & Access
  phase". **R13 is that phase.**
- **No Supabase Storage.** Zero usage anywhere in the repository.

---

## 2. Entitlement model — PROPOSED

### 2.1 Principle

Authorization must be enforced in **four** independent layers, each capable of denying on its own:

| Layer | Mechanism | Denies by |
|---|---|---|
| 1 · Database | Row Level Security on every R13 table | returning zero rows |
| 2 · Storage | Private bucket + storage RLS | refusing the object |
| 3 · Server | Route-handler scope filter using the caller's entitlement | 403 / omission before serialization |
| 4 · Client | Rendering only what the API returned | showing nothing |

> **Hard requirement.** Layer 4 is presentation, never protection. The API must **never** return a
> portfolio the caller is not entitled to and rely on React to hide it — this is risk **R2** in the
> audit register.

### 2.2 Two independent dimensions — BINDING

Authorization is composed from **two orthogonal fields**, never one.

| Dimension | Conceptual field | Answers |
|---|---|---|
| **Application role** | `role` | *What may this account do?* — administrative capability |
| **Portfolio entitlement** | `portfolio_principal` | *Whose personal portfolio may this account see?* |

**`portfolio_principal` supports exactly:** `jaime`, `andres`, `pablo`, `null`.

> **`administrator` is NOT a `portfolio_principal` value.**
> Administrative access is derived from the **application role**, not from the principal field.

Required behaviour:

- **Administrators derive complete access from the existing administrative role** — every portfolio
  scope plus every administrative control. No principal value grants administrative capability.
- **An approved non-administrator family user requires exactly one portfolio principal.** Approved
  with `portfolio_principal = null` and no administrative role ⇒ **no portfolio scope at all**
  (fails closed, never a default grant).
- **Administrators may have `portfolio_principal = null`** — and normally will. Their portfolio
  access comes from the role. A principal value on an administrator account is permitted but
  irrelevant to access.
- **Assignment and modification of `portfolio_principal` are administrator-only**, through the
  service-role provisioning path. The R1.5 migration already guarantees `authenticated` holds no
  write privilege on `user_profiles`, so this is enforced by the database, not by convention.
- **Never** hardcode usernames or e-mail addresses in application code. Both dimensions are data,
  read per request.

Why the separation matters: conflating them would make "an administrator who is also Pablo" or
"a read-only auditor with no personal portfolio" unrepresentable without a migration, and it would
put administrative capability behind a value whose whole purpose is *narrowing* visibility.

### 2.2a Administrator-role authority — RESOLVED IN R13.1 (verified decision)

> R13.0 left the physical shape of the role dimension open. **R13.1 resolved it by repository
> inspection.** This section records the decision and its evidence. Migration:
> `supabase/migrations/20260806000000_family_portfolio_entitlements.sql`.

**Decision: `user_profiles.role` is the selected application-role authority for R13.**

| # | Verified statement | Evidence |
|---|---|---|
| 1 | `user_profiles.role` is the application-role authority | activated by the R13.1 migration; constrained `check (role in ('user','administrator'))` |
| 2 | The field was **created for application authorization but was dormant at runtime** | `role text not null default 'user'` since `20260701000000`; a repository-wide search found **zero** runtime reads — `src/lib/auth/approval.ts` states this explicitly and defers activation to "the future Users & Access phase" |
| 3 | **`service_role` is infrastructure authorization, not an application administrator identity** | the only administrator today is possession of the service-role key plus shell access (`scripts/admin/provisionUser.ts`). It bypasses RLS entirely; it is an operator capability. R13.1 neither replaces nor weakens it, and never treats it as a user role |
| 4 | Application role and portfolio principal are **orthogonal dimensions** | separate columns, separate CHECK sets; `nmi_portfolio_scopes(is_approved, is_admin, principal)` takes both independently |
| 5 | `portfolio_principal` supports **`jaime`, `andres`, `pablo`, `null`** | `check (portfolio_principal is null or portfolio_principal in ('jaime','andres','pablo'))` |
| 6 | **`administrator` is not a portfolio-principal value** | deliberately excluded from the CHECK; a migration postcondition reads `pg_get_constraintdef` and fails if the constraint ever admits it |
| 7 | **Existing users remain `role='user'` and `portfolio_principal=null` unless changed by an authorized administrator** | `role` keeps its `'user'` default and is never rewritten; `portfolio_principal` is added nullable with no default |
| 8 | The migration **must not infer, create, promote, or normalize an administrator** from usernames, emails, or production guesses | no `insert`, no `update` of `user_profiles`, and no username/email predicate exists anywhere in the migration |
| 9 | **Unexpected existing `role` values cause migration failure rather than silent rewriting** | a pre-flight `do $$` block aggregates any value outside `('user','administrator')` and `raise exception`s naming them: *"this migration will not guess a normalization for an authorization column"* |

**Why activating `role` preserves every current administrator.** Because no runtime code reads it,
activation grants nothing to anyone and removes nothing from anyone. Every approved user keeps
exactly the access they had, and there is no production role data to preserve — therefore nothing to
guess. The first administrator is created deliberately, later, through the service-role provisioning
path, never by a migration.

**Mutation is already locked.** `20260730000000` revoked every privilege on `user_profiles` from
`public`/`anon`/`authenticated` and granted back only `SELECT`. New columns inherit that posture, so
a user can read their own role and principal but cannot write either — self-assignment and
self-elevation are prevented by the database, not by convention. R13.1 adds no write policy and no
write grant, and asserts both in-migration.

**Schema drift corrected in the same change** (audit § 3.3): `role` and `preferences` restored to
`database.types.ts`; `avatar_url` removed after verifying **no migration in the chain creates it**
and no source file referenced it; `portfolio_principal` added. `role` and `portfolio_principal` are
deliberately absent from the generated `Insert`/`Update` types.

### 2.2b First-administrator bootstrap and role management — R13.1.1A

**The gap R13.1 shipped with.** R13.1 made `user_profiles.role` the authority but shipped **no
writer for it**, producing a hard deadlock: every row defaults to `'user'`, nothing wrote `role`, and
assigning a portfolio principal requires an administrator actor — so no administrator could ever
exist, and the module was unreachable. R13.1.1A closes it.

**Bootstrap contract** — `node scripts/admin/setUserRole.ts --bootstrap --target <username> --write`

A service-authorized bootstrap may create the first administrator **only** when all of the
following hold:

- **no approved application administrator currently exists** (counted from real rows, never a flag);
- the target exists and is **approved** under the existing approval model;
- the operator explicitly passed `--bootstrap`;
- the operator explicitly passed `--write` (dry-run is the default);
- the change touches **only** `role` plus one audit row.

It closes permanently the moment one administrator exists (`bootstrap_not_available`). It **never**
infers the administrator from a username convention, email domain, account age, production
ownership, the machine user, git identity, or environment-variable content — the target is always
explicit.

**Normal role-management contract** — `--actor <admin> --target <user> --role <user|administrator> --write`

- Requires an **explicitly identified approved administrator** actor; a non-administrator is
  rejected (`actor_not_administrator`), and the actor is authorized *before* the request is examined
  so an unauthorized caller learns nothing about the target.
- An administrator **cannot change their own role in either direction**
  (`self_role_change_forbidden`) — no self-elevation, no self-demotion.
- Only `'user'` and `'administrator'` are accepted; an unapproved target is refused.
- Every successful change writes an audit row; **no denial ever writes one.**

**Last-administrator protection.** Demoting the final approved administrator is refused
(`last_administrator_protected`). Together with bootstrap being illegal above zero administrators,
the count can never reach zero through this workflow — the deadlock cannot recur.

**Honest bootstrap audit semantics.** `family_portfolio_access_audit.actor_user_id` was made
**nullable** and `actor_kind` added (`'administrator' | 'service_bootstrap'`), bound by a CHECK:
an administrator row must name its actor; a bootstrap row must have `actor_user_id IS NULL`.
Recording the *target* as the actor merely because bootstrap has no administrator yet would be a
false record, so the schema makes it impossible. This was a **narrow amendment to the R13.1
migration itself**, which is legitimate because that migration is unpushed, unapplied and
unreleased — verified before amending (`git branch -r --contains` empty; absent from
`origin/master`). No second migration was created.

**No browser-reachable path.** Role and principal mutation live only in `scripts/admin/*.ts`,
outside the Next.js router. `tests/accessControl.test.ts` enforces that **no file under `src/`
writes `user_profiles`**, and R13.1.1A re-asserts it.

### 2.2c Isolated database validation — R13.1.1A

The local Windows environment has no Docker, no `psql`, and no local Supabase stack, so R13.1's
constraints, SECURITY DEFINER functions, privileges and RLS could only be inspected statically.
R13.1.1A adds an **executable** environment:

| Component | Path | Purpose |
|---|---|---|
| Local-only Supabase config | `supabase/config.toml` | lets `supabase start` / `db reset` / `test db` run an isolated stack. **No project ref, no production URL, no credential.** Auth stays enabled (the helpers resolve `auth.uid()`); storage/studio/realtime/analytics/edge disabled — none affects entitlement validation |
| Executable pgTAP suite | `supabase/tests/database/family_portfolio_entitlements_test.sql` | migration constraints, function security, the full access matrix through real `auth.uid()`, profile-mutation security under real RLS, and audit security — all against real PostgreSQL, in a transaction that rolls back |
| CI workflow | `.github/workflows/r13-family-portfolio-db-validation.yml` | disposable GitHub-hosted runner, **pinned** Supabase CLI (`2.108.0`, matching the devDependency, verified at runtime), `npm ci`, full migration chain from clean, pgTAP, advisory `db lint`, and the TypeScript half of the parity contract. Teardown always runs |

**Production credentials are never used.** The workflow consumes **no repository secret**, has
`permissions: contents: read`, never runs `supabase link`, uploads no artifact, and dumps no
database. The local stack mints throwaway credentials inside the runner.

**The boundary between static and executed validation:**

| Executed locally today | Executed only in the workflow | Not executed anywhere yet |
|---|---|---|
| TypeScript authorization rule; role/principal decision rules; every denial path; structural assertions over the migration, config, SQL suite and workflow | Migration application from clean; migration postconditions incl. the in-database parity truth table; CHECK enforcement; SECURITY DEFINER behaviour; function privileges; `auth.uid()` resolution; RLS; audit protection | — (once the workflow passes) |

> **Creating this workflow is not validation.** R13.1.1 remains **incomplete** until the workflow has
> actually **run and passed** on the committed branch. **R13.2 remains blocked** until then.

> ### ⚠ Validation status — PostgreSQL execution NOT performed
>
> **PostgreSQL migration execution and RLS runtime behaviour remain UNVERIFIED** until the migration
> is applied in a real PostgreSQL environment. This environment has no local Supabase instance:
> Docker is absent (`supabase start` cannot run), `psql` is absent, there is no
> `supabase/config.toml`, and no service-role key is present.
>
> What R13.1 *did* verify: the TypeScript authorization rule, the assignment decision rules, and the
> full negative-authorization surface are **executed for real** in
> `tests/familyPortfolioEntitlements.test.ts`; the migration's embedded truth table is asserted
> row-for-row identical to the TypeScript truth table. What it did **not** verify: that PostgreSQL
> returns those results, that the policies behave as written, or that the privilege postconditions
> hold. The migration carries its own `do $$` postcondition blocks — including an in-database
> execution of the parity truth table — which raise on any mismatch **when the migration is pushed**.
> That push is the real verification event.
>
> **R13.2 must not depend on these policies until R13.1.1 execution validation passes.**

### 2.3 Scope resolution

Portfolio scopes are stable identifiers, not display strings:
`main`, `jaime`, `andres`, `pablo`, `alternatives`.

**Access matrix — BINDING:**

| Caller | Main | Jaime's | Andrés's | Pablo's | Alternatives | Admin controls |
|---|---|---|---|---|---|---|
| **Administrator** (by role) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `jaime` | ✓ | ✓ | — | — | ✓ | — |
| `andres` | ✓ | — | ✓ | — | ✓ | — |
| `pablo` | ✓ | — | — | ✓ | ✓ | — |
| `null`, non-administrator | — | — | — | — | — | — |

Administrative controls = uploads, validation reports, publication, revisions, rollback, and
access management (principal assignment).

**PROPOSED:** implement as a pure module `src/lib/portfolioAccess/entitlements.ts`, taking **both**
dimensions:

```
scopesFor({ isAdministrator, principal }): PortfolioScope[]
canReadScope({ isAdministrator, principal }, scope): boolean
canAdminister({ isAdministrator }): boolean
```

Pure (no Next.js/Supabase imports) so it is directly unit-testable and consumed identically by
RLS-adjacent server code, route handlers, and the UI — mirroring how `accessPolicy.ts` is shared by
middleware and route guards.

**PROPOSED:** a SQL mirror for RLS, taking both dimensions. Physical names are provisional:

```sql
create or replace function public.nmi_portfolio_scopes(is_admin boolean, principal text)
returns text[] language sql immutable as $$
  select case
    when is_admin        then array['main','jaime','andres','pablo','alternatives']
    when principal = 'jaime'  then array['main','jaime','alternatives']
    when principal = 'andres' then array['main','andres','alternatives']
    when principal = 'pablo'  then array['main','pablo','alternatives']
    else array[]::text[]
  end
$$;
```

**Risk:** the TypeScript and SQL definitions can drift, producing an access matrix that differs
between the database and the application. **Mitigation — required, not optional:** the
implementation plan mandates **SQL ↔ TypeScript authorization parity tests** asserting that the SQL
function body in the migration enumerates exactly the same scope sets, for exactly the same
`(is_admin, principal)` inputs, as the TS module — including the fail-closed `null`
non-administrator case. Same static-assertion technique already used by
`macroIndicatorDbCoverage.test.ts` and `supabaseSchema.test.ts`. See
`08-implementation-test-release-plan.md` § Stage 1.

### 2.4 RLS predicate

Every readable R13 table carries `scope text not null`, and:

```sql
create policy "r13_scope_read" on public.<table>
  for select to authenticated
  using (
    scope = any (
      (select nmi_portfolio_scopes(p.is_administrator, p.portfolio_principal)
         from public.user_profiles p
        where p.id = auth.uid())
    )
  );
```

Both dimensions are read from the caller's own profile row inside the policy, so the database
reaches the same verdict as the server with no trust in anything the client sends. A caller with no
profile row yields `null`, `= any(null)` is `null`, and the row is denied — fail-closed by
construction.

- **No** insert/update/delete policy for `authenticated` on any R13 table. All writes are
  service-role, performed by the upload/publication pipeline after a server-side administrator
  check — exactly the posture the R1.5 migration established for `user_profiles`.
- Postconditions asserted in-migration in the R1.5 style: exactly the expected policies exist; RLS
  enabled; `anon` holds no effective privilege; `authenticated` holds only `SELECT`; no column-level
  grants; ownership and `BYPASSRLS` checked.

**Security note:** the sub-select re-reads `user_profiles` per row evaluation. Ensure
`user_profiles(id)` is the primary key (it is) so this is an index lookup, and consider wrapping the
principal lookup in a `stable security definer` helper to let the planner cache it per statement.
Correctness first; measure before optimising.

---

## 3. Storage architecture — PROPOSED

### 3.1 Bucket

One **private** bucket, `portfolio-source-uploads`. Never public. No public URL is ever generated;
downloads (administrator-only) use short-lived signed URLs minted server-side after an
administrator check.

### 3.2 Object naming — opaque

```
<upload_kind>/<yyyy>/<uuid>.xlsx
e.g.  portfolio/2026/9f4c1e2a-....xlsx
```

The object key carries **no** original filename, no principal name, no portfolio date, no financial
hint. The original filename is stored as a sanitized database column, not in the path. Rationale: an
object key leaks through logs, error messages, and signed URLs.

### 3.3 Storage RLS

`storage.objects` policies for this bucket: **no** `authenticated` select/insert/update/delete.
Service-role only. The application mediates every read.

---

## 4. Upload validation — PROPOSED

Reusing and extending the verified `/api/structured-notes/extract` pattern (audit § 4.1) and the
`unzip.ts` guards (audit § 4.3):

| # | Check | Failure code |
|---|---|---|
| 1 | Caller is an approved administrator (`guardPrivateApi()` + `isAdministrator`) | 403 `not_authorized` |
| 2 | `file instanceof File`, field `file` present | 400 `no_file` |
| 3 | Extension `.xlsx` **and** MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 415 `unsupported_type` |
| 4 | **Macro-enabled rejected**: `.xlsm`, `.xltm`, `.xlsb`, or a `vbaProject.bin` entry inside the ZIP | 415 `macro_enabled_workbook` |
| 5 | Size ≤ **20 MB** (sample is ~450 KB; headroom without inviting abuse) | 413 `file_too_large` |
| 6 | Valid ZIP (`PK\x03\x04`), single-disk, no Zip64 | 422 `not_a_zip` |
| 7 | Entry-name safety — no `..`, absolute path, backslash, NUL, drive letter | 422 `unsafe_entry_name` |
| 8 | Compression method ∈ {0, 8} | 422 `unsupported_compression` |
| 9 | Decompression-bomb caps: per-entry, total, and **entry-count** ceiling | 422 `zip_bomb` |
| 10 | Required parts present (`xl/workbook.xml`, `xl/styles.xml`, the target sheet) | 422 `malformed_workbook` |
| 11 | **XXE / entity-expansion defence** — reject any `<!DOCTYPE` or `<!ENTITY` in any XML part | 422 `unsafe_xml` |
| 12 | External-link parts present → **recorded and ignored**, never resolved | warning `external_links_present` |
| 13 | SHA-256 duplicate detection against prior uploads of the same kind | 409 `duplicate_upload` (administrator may override with a note) |

Items 4 and 11 are additions beyond the existing precedent and are mandatory: the sample workbook
proves both external links and add-in formulas are routinely present.

**PROPOSED — parsing runtime.** `export const runtime = 'nodejs'` (Edge lacks `node:zlib`) and
`export const dynamic = 'force-dynamic'`. Parse synchronously and return the draft; no background
job infrastructure exists and none is warranted for a ~450 KB workbook.

**PROPOSED — no raw content in responses or logs.** As with the Structured Notes route: parser
exception text never leaves the server; the client receives a code. No cell value is logged. Log
counts, codes, cell **references**, and row **labels** only — never amounts.

---

## 5. Data model — PROPOSED

Names are provisional. Reuse existing conventions (`created_at`/`updated_at` triggers, `metadata
jsonb` for provenance, `source_priority`-style integers where supersession applies).

### 5.1 Upload and publication spine

```
portfolio_source_uploads
  id uuid pk
  upload_kind          text not null check (upload_kind in ('portfolio','alternatives'))
  storage_object_path  text not null            -- opaque key, § 3.2
  original_filename    text not null            -- sanitized
  file_sha256          text not null
  file_size_bytes      bigint not null
  uploaded_by          uuid not null references auth.users(id)
  uploaded_at          timestamptz not null default now()
  parser_version       text not null
  status               text not null check (status in
                         ('received','parsing','draft','blocked','published','superseded','rolled_back'))
  detected_as_of_date  date                     -- proposed by detection
  confirmed_as_of_date date                     -- administrator-confirmed
  date_override_note   text                     -- REQUIRED when confirmed <> detected
  metadata             jsonb not null default '{}'
  unique (upload_kind, file_sha256)
```

```
portfolio_publications
  id uuid pk
  upload_id      uuid not null references portfolio_source_uploads(id)
  upload_kind    text not null
  as_of_date     date not null
  revision       int  not null default 1
  published_by   uuid not null references auth.users(id)
  published_at   timestamptz not null default now()
  is_current     boolean not null default true
  superseded_by  uuid references portfolio_publications(id)
  admin_note     text
  unique (upload_kind, as_of_date, revision)
```

Exactly one `is_current = true` per `(upload_kind, as_of_date)`, enforced by a partial unique index.
Rollback flips `is_current` to a prior revision; **nothing is ever deleted**.

### 5.2 Portfolio snapshot rows

```
portfolio_snapshot_rows
  id uuid pk
  publication_id  uuid not null references portfolio_publications(id)
  scope           text not null      -- 'main' | 'jaime' | 'andres' | 'pablo'   ← RLS key
  as_of_date      date not null
  row_key         text not null      -- stable slug, e.g. 'main.liquid.renta_fija.investment_grade'
  parent_row_key  text               -- null at the top of a tree
  depth           int  not null
  display_order   int  not null
  row_type        text not null check (row_type in
                    ('group_header','asset_class','sub_asset_class','sociedad_header',
                     'individual_asset','sociedad_subtotal','portfolio_subtotal','portfolio_total',
                     'named_holding','flow','performance'))
  label_es        text not null      -- source label, verbatim
  label_en        text               -- curated translation; null → fall back to label_es
  currency        text not null default 'USD'
  value           numeric            -- null = genuinely unavailable, never 0
  value_class     text not null      -- doc 04 § 7 taxonomy
  source_sheet    text not null
  source_cell     text not null      -- provenance, e.g. 'RESUMEN!CZ13'
  metadata        jsonb not null default '{}'
  unique (publication_id, scope, row_key)
```

Notes:
- **`row_key` stability is the crux.** Derive it from the normalized label path, not the row number,
  so an inserted row does not re-key every sibling and destroy week-over-week comparability. Store
  the observed source row number in `metadata` for audit only.
- Beginning-of-year, previous-week, this-week and difference are **not** columns. Each published week
  is its own snapshot; the four-column view is assembled at read time from up to three snapshots plus
  one NMI-derived difference. This is what makes the historical-week selector work with no reshaping.

### 5.3 Performance and flows

```
portfolio_performance_rows
  publication_id, scope, as_of_date, basis, metric, value, value_class,
  source_sheet, source_cell
```

- `basis` ∈ `('ex_chilean_equities','with_chilean_equities','total')` — Main publishes two bases
  (doc 02 § 2.1); personal portfolios publish one.
- `metric` ∈ `('flow','weekly_profit','weekly_return','ytd_profit','ytd_return')`.
- Stored as **source-provided** values, with NMI's independent recomputation (doc 04 § 4.2) stored
  alongside in `metadata` as a cross-check, never replacing the source figure.

### 5.4 Alternatives

```
alternatives_holdings
  publication_id, id, category, currency, investment_name, sociedad,
  capital_committed, contributions, unfunded, last_statement_date, last_valuation,
  flow_since_statement, current_value, reported_irr, calculated_irr,
  source_sheet, source_row, metadata
  -- scope is fixed 'alternatives'

alternatives_events
  publication_id, holding_id, event_date (month-end), amount, currency,
  event_type text check (event_type in ('aporte','dividendo','distribucion','unclassified')),
  raw_fill text,            -- 'FF002060' or 'theme3@0.4'
  resolved_hex text,
  classification_method text check (... in ('legend_exact','legend_family','administrator')),
  source_cell text,
  metadata jsonb
```

`event_type = 'unclassified'` rows are ingestible into a **draft** but block publication of that
holding's event history until an administrator classifies them (doc 03 § 3.4).

### 5.5 Validation findings

```
portfolio_upload_findings
  upload_id, severity ('blocking'|'warning'|'info'), code, scope, source_sheet,
  source_cell, row_label, detail, created_at
```

`detail` is a **code-derived message**, never a raw cell value or amount.

### 5.6 Administrator commentary

```
portfolio_commentary
  publication_id, scope, body text, author uuid, created_at, updated_at,
  revision int, superseded_by uuid
```

Optional; never required for publication. Edited only through an audited revision (append a new
revision, supersede the old). **Never AI-generated, never derived from price movements** — enforced
by there being no code path that writes it other than an administrator form submission.

---

## 6. Publication lifecycle — PROPOSED

```
received → parsing → draft ──(blocking findings)──→ blocked
                       │
                       └──(administrator confirms date + reviews)──→ published
published ──(re-publish same date)──→ superseded  (prior revision retained)
published ──(rollback)──────────────→ prior revision becomes is_current
```

**Atomicity.** A publication writes all of its rows or none. Supabase JS has no multi-statement
transaction API (the same limitation Phase 6D documented), so the two viable shapes are:
(a) a Postgres RPC performing the whole publication in one function — **recommended**; or
(b) insert every row against a not-yet-current `publication_id`, then flip `is_current` as the single
atomic commit point. Either way, **a published portfolio is never partially replaced**: readers
resolve rows through `is_current`, so an in-progress write is invisible.

**Independence.** Portfolio and Alternatives publish separately, carry separate `as_of_date`s, and
are rolled back independently. The UI surfaces both dates whenever alternatives data appears
alongside portfolio data.

**Freshness.** Each surface derives its own as-of from the data actually on screen — the standing
"one as-of per surface" rule from the Source Badge convention applies unchanged. Where two datasets
coexist, show two clearly-labelled as-ofs rather than one blended date.

---

## 7. Route architecture — BINDING

**Client-facing module label: `Family Portfolio`.**

### 7.1 Page routes

| Route | Renders | Entitlement |
|---|---|---|
| `/family-portfolio` | the **generated Overview** | any approved caller with ≥ 1 scope |
| `/family-portfolio/portfolio` | the **detailed authorized portfolio** | `canReadScope` for the selected scope |
| `/family-portfolio/weekly-changes` | the **Weekly Changes** experience | `canReadScope` for the selected scope |
| `/family-portfolio/alternatives` | the **shared Alternatives** experience | `canReadScope('alternatives')` |
| `/family-portfolio/admin` | administrator-only upload, validation, publication, revision, rollback, and access management | **administrator role only** |

### 7.2 Module navigation

`Overview` · `Portfolio` · `Weekly Changes` · `Alternatives` · `Admin`

**`Admin` is visible only to administrators.** Visibility is a presentation convenience; the
protection is that `/family-portfolio/admin` and every `/api/family-portfolio/admin/*` endpoint
reject a non-administrator server-side regardless of what the client renders.

### 7.3 Non-interference with `/portfolio` — BINDING

`/portfolio` is a **separate Chilean-equities portfolio domain**. R13 must not replace it, rename
it, redirect it, merge family-portfolio data into it, reuse its ticker-constrained data model as the
family-portfolio model, or break its existing behaviour. The two modules coexist with no shared
tables, no shared repositories, and no shared routes.

### 7.4 API surface

| Route | Method | Entitlement |
|---|---|---|
| `/api/family-portfolio/scopes` | GET | approved; returns **only** the caller's scopes |
| `/api/family-portfolio/[scope]/weeks` | GET | `canReadScope` |
| `/api/family-portfolio/[scope]/snapshot?asOf=` | GET | `canReadScope`; returns BoY / prev / this / difference |
| `/api/family-portfolio/[scope]/weekly-changes?asOf=` | GET | `canReadScope` |
| `/api/family-portfolio/alternatives` | GET | `canReadScope('alternatives')` |
| `/api/family-portfolio/overview/[scope]` | GET | `canReadScope` |
| `/api/family-portfolio/admin/uploads` | POST | administrator only |
| `/api/family-portfolio/admin/uploads/[id]` | GET | administrator only |
| `/api/family-portfolio/admin/uploads/[id]/publish` | POST | administrator only |
| `/api/family-portfolio/admin/publications/[id]/rollback` | POST | administrator only |
| `/api/family-portfolio/admin/access` | GET, POST | administrator only — principal assignment |

Every handler starts with `guardPrivateApi()` and then an explicit entitlement check.
`accessPolicy.ts` needs **no change** — default-deny already covers these paths, and none may be
added to any allowlist.

---

## 8. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| A1 | Entitlement enforced only client-side | **High** | Four-layer model § 2.1; a test asserts every R13 route calls the scope filter |
| A2 | TS and SQL scope definitions drift | **High** | **Mandatory** SQL↔TS authorization parity tests (§ 2.3, Stage 1) |
| A2b | Administrative capability granted via a principal value, or a principal silently granting admin | **High** | Two orthogonal dimensions (§ 2.2); `administrator` is not a principal value; parity tests cover `(is_admin, principal)` combinations incl. admin + `null` |
| A3 | Personal data leaks into Main | **High** | `scope` is assigned at parse time from the section anchor; a test asserts Main ingests only Main's row range |
| A4 | Service-role key reachable from a client bundle | **High** | Existing convention: never `NEXT_PUBLIC_`; publication runs server-side only |
| A5 | Signed URL leaks a workbook | **Medium** | Short TTL, administrator-only minting, opaque object keys |
| A6 | Partial publication leaves an inconsistent book | **Medium** | RPC or deferred `is_current` flip (§ 6) |
| A7 | Zip bomb / XXE via `.xlsx` | **Medium** | Checks 6–11 (§ 4) |
| A8 | `row_key` instability breaks week-over-week comparison | **Medium** | Label-path derivation, not row index (§ 5.2) |
| A9 | Private workbook committed to the repository | **Medium** | Extend the existing committed-secrets test to `.xlsx` and `docs/portfolio-r13/` |
| A10 | Duplicate upload silently republishes | **Low** | SHA-256 unique per kind; override requires a note |

---

## 9. Acceptance criteria

- [x] Existing auth/approval architecture re-stated and built upon, not bypassed
- [x] Application role and portfolio principal defined as **two separate dimensions**; `administrator` is not a principal value
- [x] **Administrator-role authority RESOLVED (R13.1)** — `user_profiles.role`, with evidence, in § 2.2a
- [x] `service_role` recorded as infrastructure authorization, never an application administrator identity
- [x] Migration proven not to infer, create, promote, or normalize an administrator; unexpected role values fail loudly
- [x] **First-administrator bootstrap contract defined and tested** (R13.1.1A, § 2.2b)
- [x] **Last-administrator protection** — the deadlock cannot recur
- [x] **Honest bootstrap audit semantics** — `actor_kind` + nullable `actor_user_id`, CHECK-bound
- [x] **Isolated database validation harness committed** (config, pgTAP suite, pinned-CLI workflow; § 2.2c)
- [ ] **PostgreSQL migration execution — NOT PERFORMED.** Harness exists; the workflow has not run
- [ ] **RLS runtime validation — NOT PERFORMED.** Same
- [ ] **R13.1.1 complete** — blocked until the workflow runs and passes on the committed branch
- [x] Principal assignment defined as administrator-controlled data, never hardcoded identities
- [x] Required access matrix expressed for all three principals, `null`, and administrators
- [x] Route architecture fixed: `Family Portfolio` module under `/family-portfolio`, five routes, Admin administrator-only
- [x] Non-interference with the existing `/portfolio` domain stated as binding
- [x] SQL↔TypeScript authorization parity tests required, not optional
- [x] Enforcement specified at DB, storage, server, and client layers, with client explicitly non-authoritative
- [x] Private storage, opaque identifiers, and signed-URL policy defined
- [x] SHA-256 duplicate detection, MIME/type/size validation, macro rejection, ZIP and XXE protections specified
- [x] Versioned parser contracts, drafts, blocking errors, warnings, preview, atomic publication, revisions, rollback, audit specified
- [x] Source-sheet / source-cell / parser-version provenance specified per row
- [x] Independent Portfolio and Alternatives lifecycles with honest dual freshness
- [x] Risks enumerated with mitigations
