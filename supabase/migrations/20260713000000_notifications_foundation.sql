-- Platform notifications foundation. Apply via Supabase Dashboard → SQL Editor. Idempotent.
--
-- A general-purpose notification system (not specific to Structured Notes,
-- though that is the first feature to write into it): a shared feed of
-- events, per-user read tracking, and an editable email distribution list
-- for outbound alerts. Mirrors the Phase 9B "shared book" + Phase 9D
-- "system-level audit table, service-role writes only" patterns already
-- established for structured notes.

-- ── Notifications feed (shared — like structured_notes itself) ──────────────
-- Any authenticated user can read the whole feed. Written only by the
-- service-role client from a cron/server context (e.g. the structured-notes
-- monitoring cron) — there is no user-facing insert/update/delete path.
create table if not exists notifications (
  id                   uuid primary key default gen_random_uuid(),
  notification_type    text not null, -- e.g. 'structured_note_called' — open vocabulary, extended per feature
  title                text not null,
  body                 text,
  link_url             text,
  related_entity_type  text, -- e.g. 'structured_note'
  related_entity_id    uuid,
  metadata             jsonb not null default '{}',
  created_at           timestamptz not null default now()
);

create index if not exists notifications_created_at_idx on notifications (created_at desc);
create index if not exists notifications_related_entity_idx on notifications (related_entity_type, related_entity_id);

alter table notifications enable row level security;
drop policy if exists "notifications_select" on notifications;
create policy "notifications_select" on notifications for select using (auth.uid() is not null);
-- No insert/update/delete policy for regular (anon-key) clients — writes come
-- only from a service-role admin client (cron/server context).

-- ── Per-user read state ──────────────────────────────────────────────────────
-- Each user must dismiss their own copy of a shared notification — read state
-- is not shared, matching how the "called" banner already worked per-browser,
-- now persisted per-account instead so it survives across devices/sessions.
create table if not exists notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade default auth.uid(),
  read_at          timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_reads_user_idx on notification_reads (user_id);

alter table notification_reads enable row level security;
drop policy if exists "notification_reads_select" on notification_reads;
drop policy if exists "notification_reads_insert" on notification_reads;
drop policy if exists "notification_reads_delete" on notification_reads;
create policy "notification_reads_select" on notification_reads for select using (auth.uid() = user_id);
create policy "notification_reads_insert" on notification_reads for insert with check (auth.uid() = user_id);
create policy "notification_reads_delete" on notification_reads for delete using (auth.uid() = user_id);

-- ── Email distribution list (editable, not tied to app accounts) ────────────
-- A recipient does not need to be a registered user of the app (e.g. a
-- shared family-office inbox) — this is a plain address book, managed from
-- /settings/notifications. Any authenticated user can manage it, matching
-- the shared-trust model the rest of this app already uses (Phase 9B).
-- citext already enabled by 20260701120000_username_password_auth.sql; repeated
-- here defensively so this migration is runnable standalone too.
create extension if not exists citext;

create table if not exists notification_recipients (
  id          uuid primary key default gen_random_uuid(),
  email       citext not null unique,
  label       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table notification_recipients enable row level security;
drop policy if exists "notification_recipients_select" on notification_recipients;
drop policy if exists "notification_recipients_insert" on notification_recipients;
drop policy if exists "notification_recipients_update" on notification_recipients;
drop policy if exists "notification_recipients_delete" on notification_recipients;
create policy "notification_recipients_select" on notification_recipients for select using (auth.uid() is not null);
create policy "notification_recipients_insert" on notification_recipients for insert with check (auth.uid() is not null);
create policy "notification_recipients_update" on notification_recipients for update using (auth.uid() is not null);
create policy "notification_recipients_delete" on notification_recipients for delete using (auth.uid() is not null);

create or replace function set_notification_recipients_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists notification_recipients_updated_at on notification_recipients;
create trigger notification_recipients_updated_at
  before update on notification_recipients
  for each row execute function set_notification_recipients_updated_at();
