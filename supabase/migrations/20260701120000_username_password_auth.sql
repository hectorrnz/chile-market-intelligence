-- Phase 6B — Username + Password Auth
-- Adds a case-insensitive unique username to user_profiles so users can sign in
-- with a username instead of an email. Email remains for recovery/reset only.
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

-- citext gives case-insensitive uniqueness (Hector == hector) without extra indexes.
create extension if not exists citext;

alter table user_profiles
  add column if not exists username citext;

-- Enforce uniqueness (case-insensitive via citext). Idempotent guard.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_profiles_username_key'
  ) then
    alter table user_profiles
      add constraint user_profiles_username_key unique (username);
  end if;
end $$;

create index if not exists user_profiles_username_idx on user_profiles (username);

-- No RLS change needed: username lookup at login time is performed server-side
-- with the service-role admin client (bypasses RLS); the email is never returned
-- to the browser. Own-row select/insert/update policies from Phase 6A still apply.
