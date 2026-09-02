-- Run this once in Supabase: Project > SQL Editor > New query > paste > Run

create table entries (
  id         text primary key,              -- generated in the browser, so the
                                            -- same entry keeps one id everywhere
  user_id    uuid not null default auth.uid()
             references auth.users(id) on delete cascade,
  ts         timestamptz not null,          -- when the writing session started
  text       text not null,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false -- tombstone, so a delete on one
                                            -- device also deletes on the other
);

create index entries_user_updated on entries (user_id, updated_at);

-- Each row belongs to one account and is invisible to every other account.
alter table entries enable row level security;

create policy "own entries" on entries
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- With "automatically expose new tables" off, the API role needs explicit
-- access on top of the RLS policy above. Note: authenticated only, never anon —
-- a signed-out visitor must not be able to touch this table at all.
grant usage on schema public to authenticated;
grant select, insert, update, delete on entries to authenticated;
