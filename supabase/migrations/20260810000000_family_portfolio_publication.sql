-- R13.5 — atomic publication, revisions, rollback and administrator commentary
-- (doc 05 §§ 5.1, 5.6, 6; doc 08 Stage 5).
--
-- Forward-only and idempotent, in the style of 20260806/07/08/09000000. Every
-- guarantee is re-asserted by postcondition blocks that `raise exception`.
--
-- WHY THIS MIGRATION EXISTS AT ALL. R13.3 created the publication ledger and its
-- one-current-per-week index, but nothing could WRITE a publication: a
-- publication has to insert a parent row, hundreds of child rows and a
-- supersession pointer as ONE indivisible act, and the Supabase JS client has no
-- multi-statement transaction API — the same limitation Phase 6D documented.
-- Doing it as separate client calls would leave a half-published week visible to
-- readers the moment the first insert committed. Doc 05 § 6 names the fix and
-- prefers it: "a Postgres RPC performing the whole publication in one function".
-- A function body IS a transaction, so a failure at any row aborts the entire
-- publication and the previously-current week keeps serving readers untouched.
--
-- SECURITY POSTURE — deliberately SECURITY INVOKER, which is STRONGER here.
--
-- Every other `nmi_*` helper is SECURITY DEFINER because it must read
-- `user_profiles` on behalf of a caller who cannot read it directly. These four
-- are the opposite case: they WRITE the book, and doc 05 § 2.4 fixes that
-- writes are service-role only. Leaving them INVOKER means the function runs
-- with the caller's own privileges, so even if EXECUTE were granted to
-- `authenticated` by mistake, the inserts would still fail — `authenticated`
-- holds no INSERT on any R13 table and RLS still applies. A DEFINER function
-- owned by the migration role would instead have handed that caller the whole
-- book. EXECUTE is revoked from public/anon/authenticated and granted only to
-- `service_role`; `search_path` is pinned regardless, so a caller-controlled
-- path can never resolve `public.<table>` to a shadow relation.
--
-- WHAT THE DATABASE REFUSES ON ITS OWN. The server checks these too, but a
-- second, independent layer is the point (doc 05 § 2.1):
--   * a publication whose upload carries a BLOCKING finding;
--   * an alternatives publication carrying an `unclassified` event;
--   * an empty payload — publishing nothing would still flip `is_current` and
--     blank out the week for every reader;
--   * a date override with no note (already CHECK-enforced in R13.2).

do $$
begin
  if to_regclass('public.portfolio_publications') is null then
    raise exception 'public.portfolio_publications is missing — apply R13.3 before R13.5';
  end if;
  if to_regclass('public.alternatives_holdings') is null then
    raise exception 'public.alternatives_holdings is missing — apply R13.4 before R13.5';
  end if;
  if to_regprocedure('public.nmi_can_access_scope(text)') is null then
    raise exception 'public.nmi_can_access_scope(text) is missing — apply R13.1 before R13.5';
  end if;
end $$;

-- ── 1. Administrator commentary (doc 05 § 5.6) ───────────────────────────────
--
-- Optional, never required for publication, NEVER AI-generated and never
-- derived from price movements — enforced structurally by there being no code
-- path that writes this table other than the administrator RPC below.
--
-- Editing is APPEND-AND-SUPERSEDE, not an in-place update: what an
-- administrator said at publication time has to survive every later edit, or
-- the audit trail is only as good as the last revision.
create table if not exists public.portfolio_commentary (
  id              uuid primary key default gen_random_uuid(),
  publication_id  uuid not null references public.portfolio_publications(id) on delete cascade,
  scope           text not null check (scope in ('main','jaime','andres','pablo','alternatives')),
  body            text not null check (length(btrim(body)) > 0),
  author          uuid not null references auth.users(id) on delete restrict,
  revision        int  not null default 1 check (revision >= 1),
  superseded_by   uuid references public.portfolio_commentary(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb,
  constraint portfolio_commentary_revision_key unique (publication_id, scope, revision)
);

-- Exactly one live revision per (publication, scope). The same partial-unique
-- technique the publication ledger uses, for the same reason: it makes the swap
-- atomic without a second bookkeeping column.
create unique index if not exists portfolio_commentary_current_idx
  on public.portfolio_commentary (publication_id, scope)
  where superseded_by is null;

create index if not exists portfolio_commentary_publication_idx
  on public.portfolio_commentary (publication_id, scope);

comment on table public.portfolio_commentary is
  'R13.5 — optional administrator commentary per (publication, scope). Append-and-supersede only: '
  'a superseded revision is retained, never updated in place and never deleted. Never generated, '
  'never derived from market data (doc 05 section 5.6).';

alter table public.portfolio_commentary enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'portfolio_commentary'
  loop
    execute format('drop policy %I on public.portfolio_commentary', pol.policyname);
  end loop;
end $$;

-- Commentary is portfolio content, so it reads through the SAME scope predicate
-- as the rows it annotates. Andrés must not read commentary written on Jaime's
-- scope any more than he may read Jaime's values.
create policy "portfolio_commentary_scope_select"
  on public.portfolio_commentary
  for select to authenticated
  using (public.nmi_can_access_scope(scope));

revoke all privileges on table public.portfolio_commentary from public, anon, authenticated;
grant select on table public.portfolio_commentary to authenticated;
grant all privileges on table public.portfolio_commentary to service_role;

-- ── 2. Upload status, derived rather than asserted ───────────────────────────
--
-- An upload's status is a FACT ABOUT ITS PUBLICATIONS, so it is recomputed from
-- them instead of being set by whichever code path happened to run last. That
-- makes publish and rollback symmetric for free: rolling a revision back
-- restores its upload to `published` without a separate rule that could drift.
create or replace function public.nmi_sync_upload_status(p_upload_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.portfolio_source_uploads u
  set status = case
    when exists (select 1 from public.portfolio_publications p
                  where p.upload_id = u.id and p.is_current)                    then 'published'
    when exists (select 1 from public.portfolio_publications p
                  where p.upload_id = u.id and p.superseded_by is not null)     then 'superseded'
    when exists (select 1 from public.portfolio_publications p
                  where p.upload_id = u.id)                                     then 'rolled_back'
    else u.status
  end
  where u.id = p_upload_id;
end $$;

-- ── 3. Series serialization ──────────────────────────────────────────────────
--
-- WHY AN ADVISORY LOCK AND NOT `SELECT ... FOR UPDATE`.
--
-- The obvious mechanism — locking the existing publications of a week — has a
-- hole exactly where it matters most: the FIRST publication of a week locks
-- NOTHING, because there are no rows yet. Two concurrent first publications
-- would both read `max(revision) = 0`, both compute revision 1, and both race to
-- insert. The unique constraints still hold the line (one of them fails with
-- 23505 and rolls back entirely, so the book is never corrupted), but the loser
-- gets an opaque constraint violation instead of taking its legitimate turn, and
-- a comment claiming the code "serialises" would simply be untrue.
--
-- A transaction-scoped ADVISORY LOCK has no such hole: it is keyed on the
-- (kind, date) SERIES rather than on rows that may not exist, so it serialises
-- an empty series exactly as it serialises a populated one. It is released
-- automatically on commit OR abort, so a failed publication never strands it.
--
-- Every caller MUST take the lock through this one function. A hand-rolled key
-- that differed by so much as a separator would silently fail to serialise
-- against the others while looking correct.
create or replace function public.nmi_lock_publication_series(p_kind text, p_as_of_date date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('nmi_publication_series'),
    pg_catalog.hashtext(p_kind || ':' || p_as_of_date::text));
end $$;

-- ── 3b. Shared refusal guards ────────────────────────────────────────────────
create or replace function public.nmi_assert_publishable(p_upload_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.portfolio_source_uploads where id = p_upload_id) then
    raise exception 'publication_refused_upload_not_found';
  end if;
  -- Doc 02 § 6.3: a blocking finding invalidates the dataset as a whole. The
  -- remedy is to recalculate and re-upload, never to publish around it.
  if exists (
    select 1 from public.portfolio_upload_findings
    where upload_id = p_upload_id and severity = 'blocking'
  ) then
    raise exception 'publication_refused_blocking_findings';
  end if;
end $$;

-- ── 4. Portfolio publication — one transaction (doc 05 § 6) ───────────────────
create or replace function public.nmi_publish_portfolio(
  p_upload_id        uuid,
  p_as_of_date       date,
  p_published_by     uuid,
  p_parser_version   text,
  p_rows             jsonb,
  p_performance      jsonb  default '[]'::jsonb,
  p_admin_note       text   default null,
  p_metadata         jsonb  default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_pub_id      uuid := gen_random_uuid();
  v_revision    int;
  v_previous    uuid;
  v_prev_upload uuid;
  v_prev_parser text;
begin
  perform public.nmi_assert_publishable(p_upload_id);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'publication_refused_nothing_to_publish';
  end if;

  -- Serialise every concurrent writer of this (kind, date) series — including
  -- the first, when no row exists to lock. Everything below reads committed
  -- state under this lock, so the revision it computes cannot be stale.
  perform public.nmi_lock_publication_series('portfolio', p_as_of_date);

  select coalesce(max(revision), 0) + 1 into v_revision
    from public.portfolio_publications
   where upload_kind = 'portfolio' and as_of_date = p_as_of_date;

  -- Supersede what readers are CURRENTLY seeing — not the highest revision,
  -- which may itself already be superseded after a rollback.
  select id, upload_id, parser_version into v_previous, v_prev_upload, v_prev_parser
    from public.portfolio_publications
   where upload_kind = 'portfolio' and as_of_date = p_as_of_date and is_current;

  -- DUPLICATE-SUBMISSION GUARD, not an idempotency system.
  --
  -- Re-publishing IS intentionally non-idempotent: a corrected workbook must
  -- create a new revision. But a corrected workbook is necessarily a DIFFERENT
  -- upload — R13.2 makes `(upload_kind, file_sha256)` unique, so the same bytes
  -- cannot be ingested twice for one kind. A request to publish the very upload
  -- that is ALREADY current, at the very parser version that produced it, can
  -- therefore only be a double-click or a transport retry; it would mint a
  -- revision byte-identical to the one it supersedes.
  --
  -- A parser upgrade over the same upload is explicitly still allowed: the
  -- parser version differs, the rows genuinely differ, and doc 05 § 5.1 requires
  -- those two publications to be distinguishable.
  if v_previous is not null and v_prev_upload = p_upload_id
     and v_prev_parser is not distinct from p_parser_version then
    raise exception 'publication_refused_duplicate_submission';
  end if;

  -- ORDERING — INSERT NON-CURRENT, FILL, DEMOTE, PROMOTE.
  --
  -- Two constraints pull in opposite directions and both must be honoured:
  --
  --   * `portfolio_publications_current_idx` is a PARTIAL unique index over
  --     (upload_kind, as_of_date) WHERE is_current, so two current rows for one
  --     week cannot coexist even for an instant.
  --   * `superseded_by` carries a NON-DEFERRABLE self-referential foreign key,
  --     so it can only ever name a row that ALREADY EXISTS.
  --
  -- Demoting the predecessor first and pointing it at the not-yet-inserted new
  -- id satisfies the index but violates the FK — PostgreSQL checks it at the end
  -- of that UPDATE and raises 23503. That is exactly what run 31210961884 hit on
  -- every re-publication; the first publication survived only because there was
  -- no predecessor to demote.
  --
  -- The sequence below satisfies both. The new revision is inserted NON-CURRENT,
  -- which the partial index ignores entirely, so it can exist alongside the
  -- still-current predecessor while its children are written. Only once the
  -- complete revision exists is the predecessor demoted — and by then the row its
  -- `superseded_by` names is real. The promotion is last, after the demote, so
  -- the index is never asked to hold two current rows.
  --
  -- The intermediate state (predecessor current, successor complete but not yet
  -- current) is invisible outside this transaction under MVCC, and it is the
  -- SAFE intermediate state to be interrupted in: a failure at any point leaves
  -- the previously-current week serving readers untouched.
  --
  -- There is no `supersedes` column to populate on the way in. Doc 05 § 5.1
  -- models the relation in one direction only, and adding an inverse column
  -- would be a schema change, not a repair.
  insert into public.portfolio_publications
    (id, upload_id, upload_kind, as_of_date, revision, published_by, is_current,
     admin_note, parser_version, metadata)
  values
    (v_pub_id, p_upload_id, 'portfolio', p_as_of_date, v_revision, p_published_by, false,
     p_admin_note, p_parser_version, coalesce(p_metadata, '{}'::jsonb));

  insert into public.portfolio_snapshot_rows
    (publication_id, scope, as_of_date, row_key, parent_row_key, depth, display_order,
     row_type, label_es, label_en, currency, value, value_class, source_sheet, source_cell, metadata)
  select v_pub_id, r.scope, p_as_of_date, r.row_key, r.parent_row_key, r.depth, r.display_order,
         r.row_type, r.label_es, r.label_en, coalesce(r.currency, 'USD'),
         -- A JSON null arrives as SQL NULL and STAYS NULL. `unavailable` is not
         -- zero (doc 02 § 9); coalescing here would fabricate a baseline.
         r.value, r.value_class, r.source_sheet, r.source_cell, coalesce(r.metadata, '{}'::jsonb)
    from jsonb_to_recordset(p_rows) as r(
      scope text, row_key text, parent_row_key text, depth int, display_order int,
      row_type text, label_es text, label_en text, currency text, value numeric,
      value_class text, source_sheet text, source_cell text, metadata jsonb);

  if p_performance is not null and jsonb_typeof(p_performance) = 'array'
     and jsonb_array_length(p_performance) > 0 then
    insert into public.portfolio_performance_rows
      (publication_id, scope, as_of_date, basis, metric, value, value_class,
       source_sheet, source_cell, metadata)
    select v_pub_id, m.scope, p_as_of_date, m.basis, m.metric, m.value, m.value_class,
           m.source_sheet, m.source_cell, coalesce(m.metadata, '{}'::jsonb)
      from jsonb_to_recordset(p_performance) as m(
        scope text, basis text, metric text, value numeric, value_class text,
        source_sheet text, source_cell text, metadata jsonb);
  end if;

  -- The complete revision now exists. Demote the predecessor and point it at a
  -- row that is real, then promote. Demote MUST precede promote: the partial
  -- index tolerates zero current rows for an instant, never two.
  if v_previous is not null then
    update public.portfolio_publications
       set is_current = false, superseded_by = v_pub_id
     where id = v_previous;
  end if;

  update public.portfolio_publications set is_current = true where id = v_pub_id;

  perform public.nmi_sync_upload_status(p_upload_id);
  if v_prev_upload is not null and v_prev_upload <> p_upload_id then
    perform public.nmi_sync_upload_status(v_prev_upload);
  end if;

  return v_pub_id;
end $$;

-- ── 5. Alternatives publication — independent lifecycle (doc 05 § 6) ─────────
--
-- Holdings carry client-supplied ids so events can reference them WITHOUT a
-- name join. Matching an event to its holding by (investment, sociedad,
-- currency) would be ambiguous the moment one investment appears under two
-- categories, and the failure would be silent — an event attached to the wrong
-- holding still looks like a valid timeline.
create or replace function public.nmi_publish_alternatives(
  p_upload_id      uuid,
  p_as_of_date     date,
  p_published_by   uuid,
  p_parser_version text,
  p_holdings       jsonb,
  p_events         jsonb  default '[]'::jsonb,
  p_admin_note     text   default null,
  p_metadata       jsonb  default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_pub_id      uuid := gen_random_uuid();
  v_revision    int;
  v_previous    uuid;
  v_prev_upload uuid;
  v_prev_parser text;
begin
  perform public.nmi_assert_publishable(p_upload_id);

  if p_holdings is null or jsonb_typeof(p_holdings) <> 'array' or jsonb_array_length(p_holdings) = 0 then
    raise exception 'publication_refused_nothing_to_publish';
  end if;

  -- Doc 03 § 3.4 / doc 05 § 5.4: an unclassified event is ingestible into a
  -- DRAFT but blocks publication until an administrator classifies it.
  -- Publishing a timeline that silently omits a value-bearing cell would
  -- present an incomplete event history as though it were complete.
  if p_events is not null and jsonb_typeof(p_events) = 'array' and exists (
    select 1 from jsonb_to_recordset(p_events) as e(event_type text)
     where e.event_type = 'unclassified'
  ) then
    raise exception 'publication_refused_unclassified_events';
  end if;

  -- Same series lock as the portfolio path, taken through the same helper so
  -- the key can never drift between the two lifecycles.
  perform public.nmi_lock_publication_series('alternatives', p_as_of_date);

  select coalesce(max(revision), 0) + 1 into v_revision
    from public.portfolio_publications
   where upload_kind = 'alternatives' and as_of_date = p_as_of_date;

  select id, upload_id, parser_version into v_previous, v_prev_upload, v_prev_parser
    from public.portfolio_publications
   where upload_kind = 'alternatives' and as_of_date = p_as_of_date and is_current;

  -- Duplicate-submission guard — see the portfolio function for the reasoning.
  if v_previous is not null and v_prev_upload = p_upload_id
     and v_prev_parser is not distinct from p_parser_version then
    raise exception 'publication_refused_duplicate_submission';
  end if;

  -- INSERT NON-CURRENT, FILL, DEMOTE, PROMOTE — identical to the portfolio path,
  -- and for the identical reason: the partial current-row index forbids two
  -- current rows, while the non-deferrable `superseded_by` FK forbids naming a
  -- row that does not exist yet. See the portfolio function for the full note.
  insert into public.portfolio_publications
    (id, upload_id, upload_kind, as_of_date, revision, published_by, is_current,
     admin_note, parser_version, metadata)
  values
    (v_pub_id, p_upload_id, 'alternatives', p_as_of_date, v_revision, p_published_by, false,
     p_admin_note, p_parser_version, coalesce(p_metadata, '{}'::jsonb));

  insert into public.alternatives_holdings
    (id, publication_id, as_of_date, category, currency, investment_name, sociedad,
     capital_committed, contributions, unfunded, last_statement_date, last_statement_label,
     last_valuation, flow_since_statement, current_value, reported_irr, calculated_irr,
     source_sheet, source_row, source_cell, metadata)
  select h.id, v_pub_id, p_as_of_date, h.category, h.currency, h.investment_name, h.sociedad,
         h.capital_committed, h.contributions, h.unfunded, h.last_statement_date, h.last_statement_label,
         h.last_valuation, h.flow_since_statement, h.current_value, h.reported_irr, h.calculated_irr,
         h.source_sheet, h.source_row, h.source_cell, coalesce(h.metadata, '{}'::jsonb)
    from jsonb_to_recordset(p_holdings) as h(
      id uuid, category text, currency text, investment_name text, sociedad text,
      capital_committed numeric, contributions numeric, unfunded numeric,
      last_statement_date date, last_statement_label text, last_valuation numeric,
      flow_since_statement numeric, current_value numeric, reported_irr numeric,
      calculated_irr numeric, source_sheet text, source_row int, source_cell text, metadata jsonb);

  if p_events is not null and jsonb_typeof(p_events) = 'array' and jsonb_array_length(p_events) > 0 then
    insert into public.alternatives_events
      (publication_id, holding_id, event_date, amount, currency, event_type,
       raw_fill, resolved_hex, classification_method, source_sheet, source_cell, source_row, metadata)
    select v_pub_id, e.holding_id, e.event_date, e.amount, e.currency, e.event_type,
           e.raw_fill, e.resolved_hex, e.classification_method,
           e.source_sheet, e.source_cell, e.source_row, coalesce(e.metadata, '{}'::jsonb)
      from jsonb_to_recordset(p_events) as e(
        holding_id uuid, event_date date, amount numeric, currency text, event_type text,
        raw_fill text, resolved_hex text, classification_method text,
        source_sheet text, source_cell text, source_row int, metadata jsonb);
  end if;

  -- Complete revision exists; demote the predecessor onto a real row, then
  -- promote. Demote strictly before promote.
  if v_previous is not null then
    update public.portfolio_publications
       set is_current = false, superseded_by = v_pub_id
     where id = v_previous;
  end if;

  update public.portfolio_publications set is_current = true where id = v_pub_id;

  perform public.nmi_sync_upload_status(p_upload_id);
  if v_prev_upload is not null and v_prev_upload <> p_upload_id then
    perform public.nmi_sync_upload_status(v_prev_upload);
  end if;

  return v_pub_id;
end $$;

-- ── 6. Rollback — a pointer move, never a delete (doc 05 § 5.1) ──────────────
create or replace function public.nmi_rollback_publication(
  p_target_id  uuid,
  p_actor_id   uuid,
  p_note       text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_kind    text;
  v_date    date;
  v_current uuid;
  v_current_upload uuid;
  v_target_upload  uuid;
begin
  -- THE LIFECYCLE IS DERIVED FROM THE TARGET, NEVER SUPPLIED BY THE CALLER.
  -- The request names one publication id and nothing else; its own row states
  -- which (kind, date) series it belongs to, and every read and write below is
  -- confined to that series. There is therefore no parameter through which a
  -- caller could demote a publication of a different week or a different
  -- dataset — the only thing a wrong id can do is roll back the wrong series
  -- entirely, which is a caller naming the wrong object, not a boundary
  -- crossing.
  select upload_kind, as_of_date, upload_id into v_kind, v_date, v_target_upload
    from public.portfolio_publications where id = p_target_id;
  if v_kind is null then
    raise exception 'rollback_refused_publication_not_found';
  end if;

  -- Serialise against concurrent publishes AND concurrent rollbacks of the same
  -- series, through the same helper both of those use. Taken BEFORE the
  -- already-current test, so that test reads state no other writer can still
  -- change underneath it.
  perform public.nmi_lock_publication_series(v_kind, v_date);

  if exists (select 1 from public.portfolio_publications where id = p_target_id and is_current) then
    raise exception 'rollback_refused_already_current';
  end if;

  select id, upload_id into v_current, v_current_upload
    from public.portfolio_publications
   where upload_kind = v_kind and as_of_date = v_date and is_current;
  if v_current is null then
    raise exception 'rollback_refused_no_current_publication';
  end if;

  -- Demote before promote, for the partial unique index. NOTHING IS DELETED:
  -- the demoted revision keeps its rows and can be rolled forward again.
  --
  -- Reviewed against the repaired publication ordering: rollback needs no
  -- equivalent change. Both rows already exist before either statement runs, and
  -- both statements CLEAR `superseded_by` rather than setting it, so no
  -- forward reference to a not-yet-inserted row is possible here.
  update public.portfolio_publications
     set is_current = false, superseded_by = null
   where id = v_current;

  update public.portfolio_publications
     set is_current = true,
         superseded_by = null,
         admin_note = coalesce(p_note, admin_note),
         metadata = metadata || jsonb_build_object(
           'rolledBackFrom', v_current::text,
           'rolledBackBy', p_actor_id::text)
   where id = p_target_id;

  perform public.nmi_sync_upload_status(v_current_upload);
  perform public.nmi_sync_upload_status(v_target_upload);

  return p_target_id;
end $$;

-- ── 7. Commentary upsert — append-and-supersede ──────────────────────────────
create or replace function public.nmi_upsert_portfolio_commentary(
  p_publication_id uuid,
  p_scope          text,
  p_body           text,
  p_author         uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id       uuid := gen_random_uuid();
  v_revision int;
  v_prior    uuid;
begin
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'commentary_refused_empty';
  end if;
  if not exists (select 1 from public.portfolio_publications where id = p_publication_id) then
    raise exception 'commentary_refused_publication_not_found';
  end if;

  -- Serialise writers of THIS (publication, scope) commentary chain.
  --
  -- The one-live partial index guarantees at most one live revision, and the
  -- `(publication_id, scope, revision)` unique key guarantees revision numbers
  -- cannot duplicate — so two racing edits could never corrupt the chain. But
  -- without a lock the loser aborts on a raw constraint violation instead of
  -- taking its turn and becoming the next revision, which is what an
  -- append-and-supersede model is supposed to do. The key is namespaced apart
  -- from the publication-series lock so the two can never collide.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('nmi_commentary_chain'),
    pg_catalog.hashtext(p_publication_id::text || ':' || p_scope));

  select coalesce(max(revision), 0) + 1 into v_revision
    from public.portfolio_commentary
   where publication_id = p_publication_id and scope = p_scope;

  select id into v_prior
    from public.portfolio_commentary
   where publication_id = p_publication_id and scope = p_scope and superseded_by is null;

  -- INSERT NON-LIVE, DEMOTE, PROMOTE — the same shape as a publication, adapted
  -- to a table that has no `is_current` column: here LIVENESS IS
  -- `superseded_by is null`, and `portfolio_commentary_current_idx` is unique
  -- over (publication_id, scope) on exactly that predicate.
  --
  -- So the two constraints bite in the same way as on the publication ledger.
  -- Superseding the prior revision first would point it at a row that does not
  -- exist yet and raise 23503 on the non-deferrable self-FK; inserting the new
  -- revision live while the prior is still live would put two live rows under
  -- the partial index.
  --
  -- The new revision is therefore inserted pointing AT ITS PREDECESSOR, which
  -- already exists. That makes it non-live, so the index is satisfied, and the
  -- FK is valid. The predecessor is then pointed at the new row — also real by
  -- now — and only then is the new row's pointer cleared to make it live.
  --
  -- Between those last two statements the two rows briefly reference each other.
  -- That is confined to this transaction, invisible under MVCC, and resolved by
  -- the final statement; the committed chain is strictly one-directional from
  -- older revision to newer, which is what the acyclicity assertions check.
  --
  -- With no predecessor the insert is live immediately and both updates are
  -- skipped, so the first revision and every later one share one code path.
  insert into public.portfolio_commentary
    (id, publication_id, scope, body, author, revision, superseded_by)
  values (v_id, p_publication_id, p_scope, btrim(p_body), p_author, v_revision, v_prior);

  if v_prior is not null then
    update public.portfolio_commentary
       set superseded_by = v_id, updated_at = now()
     where id = v_prior;

    update public.portfolio_commentary
       set superseded_by = null
     where id = v_id;
  end if;

  return v_id;
end $$;

-- ── 8. Function privileges — service-role only ───────────────────────────────
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.nmi_sync_upload_status(uuid)',
    'public.nmi_assert_publishable(uuid)',
    'public.nmi_lock_publication_series(text,date)',
    'public.nmi_publish_portfolio(uuid,date,uuid,text,jsonb,jsonb,text,jsonb)',
    'public.nmi_publish_alternatives(uuid,date,uuid,text,jsonb,jsonb,text,jsonb)',
    'public.nmi_rollback_publication(uuid,uuid,text)',
    'public.nmi_upsert_portfolio_commentary(uuid,text,text,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;

-- ── 9. Postconditions ────────────────────────────────────────────────────────

-- 9a. Every function exists, is INVOKER, and pins search_path.
do $$
declare
  fn         text;
  v_secdef   boolean;
  v_config   text[];
begin
  foreach fn in array array[
    'nmi_sync_upload_status','nmi_assert_publishable','nmi_lock_publication_series',
    'nmi_publish_portfolio','nmi_publish_alternatives','nmi_rollback_publication',
    'nmi_upsert_portfolio_commentary'
  ] loop
    select pr.prosecdef, pr.proconfig into v_secdef, v_config
      from pg_catalog.pg_proc pr
      join pg_catalog.pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'public' and pr.proname = fn;
    if not found then
      raise exception 'R13.5 function public.% was not created', fn;
    end if;
    -- INVOKER is the deliberate choice (see the header). A DEFINER publication
    -- function would run as the owner and hand any caller who could execute it
    -- write access to the entire book.
    if v_secdef then
      raise exception 'public.% is SECURITY DEFINER — publication functions must run as the caller', fn;
    end if;
    if v_config is null or not exists (
      select 1 from unnest(v_config) cfg where cfg like 'search\_path=%'
    ) then
      raise exception 'public.% does not pin search_path', fn;
    end if;
  end loop;
end $$;

-- 9b. No non-service role can execute a publication function.
do $$
declare
  sig  text;
  role text;
begin
  foreach sig in array array[
    'public.nmi_publish_portfolio(uuid,date,uuid,text,jsonb,jsonb,text,jsonb)',
    'public.nmi_publish_alternatives(uuid,date,uuid,text,jsonb,jsonb,text,jsonb)',
    'public.nmi_rollback_publication(uuid,uuid,text)',
    'public.nmi_upsert_portfolio_commentary(uuid,text,text,uuid)'
  ] loop
    foreach role in array array['anon','authenticated'] loop
      if has_function_privilege(role, sig, 'EXECUTE') then
        raise exception '% can EXECUTE % — publication must stay service-role only', role, sig;
      end if;
    end loop;
    if not has_function_privilege('service_role', sig, 'EXECUTE') then
      raise exception 'service_role cannot EXECUTE % — publication would fail closed', sig;
    end if;
  end loop;
end $$;

-- 9c. Commentary table posture.
do $$
declare
  n int;
begin
  if to_regclass('public.portfolio_commentary') is null then
    raise exception 'public.portfolio_commentary was not created';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'portfolio_commentary' and c.relrowsecurity
  ) then
    raise exception 'row level security is not enabled on portfolio_commentary';
  end if;

  select count(*) into n from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'portfolio_commentary';
  if n <> 1 then
    raise exception 'expected exactly one policy on portfolio_commentary, found %', n;
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'portfolio_commentary' and cmd <> 'SELECT'
  ) then
    raise exception 'a non-SELECT policy exists on portfolio_commentary';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'portfolio_commentary'
      and qual like '%nmi_can_access_scope%'
  ) then
    raise exception 'portfolio_commentary does not read through the scope predicate';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'portfolio_commentary_current_idx'
  ) then
    raise exception 'the one-live-revision index on portfolio_commentary is missing';
  end if;

  if has_table_privilege('authenticated', 'public.portfolio_commentary', 'INSERT')
     or has_table_privilege('authenticated', 'public.portfolio_commentary', 'UPDATE')
     or has_table_privilege('authenticated', 'public.portfolio_commentary', 'DELETE') then
    raise exception 'authenticated can write portfolio_commentary';
  end if;
  if has_table_privilege('anon', 'public.portfolio_commentary', 'SELECT') then
    raise exception 'anon can read portfolio_commentary';
  end if;
end $$;

-- 9c-bis. Every writer serialises its series through the SHARED helper.
--
-- A hand-rolled advisory key in one function would look correct and silently
-- fail to serialise against the others, so the helper being called is asserted
-- rather than assumed. `FOR UPDATE` must NOT come back as the mechanism: it
-- locks nothing on the first publication of a week, which is exactly the case
-- that needs serialising.
do $$
declare
  fn  text;
  src text;
begin
  foreach fn in array array['nmi_publish_portfolio','nmi_publish_alternatives',
                            'nmi_rollback_publication'] loop
    select p.prosrc into src
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if src is null or src not like '%nmi_lock_publication_series%' then
      raise exception 'public.% does not serialise through nmi_lock_publication_series', fn;
    end if;
    if src like '%for update%' then
      raise exception 'public.% still relies on FOR UPDATE, which locks nothing on a first publication', fn;
    end if;
  end loop;

  select p.prosrc into src
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'nmi_upsert_portfolio_commentary';
  if src is null or src not like '%pg_advisory_xact_lock%' then
    raise exception 'nmi_upsert_portfolio_commentary does not serialise its revision chain';
  end if;

  -- The revision key is what makes duplicate revision numbers impossible even
  -- if a lock were ever removed. Losing it would make the lock load-bearing.
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'portfolio_publications_revision_key' and contype = 'u'
  ) then
    raise exception 'the (upload_kind, as_of_date, revision) unique key is missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'portfolio_commentary_revision_key' and contype = 'u'
  ) then
    raise exception 'the (publication_id, scope, revision) unique key is missing';
  end if;
end $$;

-- 9d. Earlier-stage posture untouched.
do $$
begin
  if has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE') then
    raise exception 'authenticated gained UPDATE on user_profiles — self-elevation must remain impossible';
  end if;
  if has_table_privilege('authenticated', 'public.portfolio_snapshot_rows', 'INSERT') then
    raise exception 'authenticated gained INSERT on portfolio_snapshot_rows — R13.3 posture broken';
  end if;
  if has_table_privilege('authenticated', 'public.alternatives_events', 'INSERT') then
    raise exception 'authenticated gained INSERT on alternatives_events — R13.4 posture broken';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'portfolio_publications_current_idx'
  ) then
    raise exception 'the one-current-publication index disappeared — atomic swap would be unsound';
  end if;
end $$;
