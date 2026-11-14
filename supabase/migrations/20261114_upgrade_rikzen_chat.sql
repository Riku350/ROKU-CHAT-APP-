-- ============================================================================
-- RIKZEN CHAT — 20261114 FULL REAL-TIME MESSAGING, PRESENCE, CALLS & STATUS UPGRADE
-- Non-destructive migration script for Supabase PostgreSQL.
-- Preserves all existing tables, rows, permanent RIKZEN IDs, and policies.
-- ============================================================================

-- 1. Extend conversation_members with WhatsApp-style chat controls
alter table if exists public.conversation_members
  add column if not exists pinned boolean not null default false,
  add column if not exists pinned_at timestamptz,
  add column if not exists marked_unread boolean not null default false,
  add column if not exists disappearing_seconds int not null default 0,
  add column if not exists chat_theme text,
  add column if not exists custom_list text not null default '',
  add column if not exists cleared_at timestamptz;

create index if not exists idx_cm_user_pinned
  on public.conversation_members (user_id, pinned desc, archived);

-- 2. Extend groups with invitation links
alter table if exists public.groups
  add column if not exists invite_code text unique;

create index if not exists idx_groups_invite_code
  on public.groups (invite_code)
  where invite_code is not null;

-- 3. Extend messages with disappearing message expiration
alter table if exists public.messages
  add column if not exists expires_at timestamptz;

create index if not exists idx_messages_expires_at
  on public.messages (expires_at)
  where expires_at is not null;

-- 4. Extend statuses with privacy controls
alter table if exists public.statuses
  add column if not exists privacy text not null default 'friends' check (privacy in ('everyone', 'friends', 'contacts', 'selected')),
  add column if not exists allowed_viewer_ids uuid[] not null default '{}',
  add column if not exists excluded_viewer_ids uuid[] not null default '{}';

-- 5. Extend calls with WebRTC SDP fields and busy status
alter table if exists public.calls
  add column if not exists offer_sdp text,
  add column if not exists answer_sdp text;

alter table if exists public.calls
  drop constraint if exists calls_status_check;

alter table if exists public.calls
  add constraint calls_status_check
  check (status in ('ringing', 'connected', 'ended', 'missed', 'rejected', 'busy'));

-- 6. Dedicated user_presence table for multi-device Realtime presence
create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  active_devices int not null default 0,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. Typing & Audio-Recording indicators
create table if not exists public.typing_indicators (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity text not null default 'typing' check (activity in ('typing', 'recording', 'idle')),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- 8. Dedicated status_reactions table (complements status_views)
create table if not exists public.status_reactions (
  id uuid primary key default gen_random_uuid(),
  status_id uuid not null references public.statuses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (status_id, user_id, emoji)
);

-- 9. Contacts & User Settings normalized tables
create table if not exists public.contacts (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.profiles(id) on delete cascade,
  nickname text,
  custom_list text default '',
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_id)
);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_privacy text not null default 'friends' check (last_seen_privacy in ('everyone', 'friends', 'nobody')),
  online_privacy text not null default 'everyone' check (online_privacy in ('everyone', 'friends', 'nobody')),
  status_privacy text not null default 'friends' check (status_privacy in ('everyone', 'friends', 'selected')),
  read_receipts boolean not null default true,
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 10. WebRTC ICE Candidates Signaling table
create table if not exists public.call_ice_candidates (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  candidate jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_call_ice_call_id on public.call_ice_candidates (call_id, created_at);

-- 11. View alias chat_requests over friend_requests for compatibility
create or replace view public.chat_requests as
  select id, sender_id, receiver_id, status, created_at, updated_at
  from public.friend_requests;

-- 12. RLS Policies for newly added tables
alter table public.user_presence enable row level security;
alter table public.typing_indicators enable row level security;
alter table public.status_reactions enable row level security;
alter table public.contacts enable row level security;
alter table public.user_settings enable row level security;
alter table public.call_ice_candidates enable row level security;

drop policy if exists "presence_select_authed" on public.user_presence;
create policy "presence_select_authed" on public.user_presence
  for select to authenticated using (true);

drop policy if exists "presence_upsert_own" on public.user_presence;
create policy "presence_upsert_own" on public.user_presence
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "typing_members_all" on public.typing_indicators;
create policy "typing_members_all" on public.typing_indicators
  for all to authenticated
  using (
    exists(
      select 1 from public.conversation_members cm
      where cm.conversation_id = typing_indicators.conversation_id and cm.user_id = auth.uid()
    )
  )
  with check (user_id = auth.uid());

drop policy if exists "status_reactions_access" on public.status_reactions;
create policy "status_reactions_access" on public.status_reactions
  for all to authenticated
  using (true)
  with check (user_id = auth.uid());

drop policy if exists "contacts_owner_only" on public.contacts;
create policy "contacts_owner_only" on public.contacts
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "user_settings_owner_only" on public.user_settings;
create policy "user_settings_owner_only" on public.user_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "call_ice_participants" on public.call_ice_candidates;
create policy "call_ice_participants" on public.call_ice_candidates
  for all to authenticated
  using (
    exists(
      select 1 from public.calls c
      where c.id = call_ice_candidates.call_id
        and (c.caller_id = auth.uid() or c.callee_id = auth.uid())
    )
  )
  with check (sender_id = auth.uid());

-- 13. Storage Bucket (rikzen-media) & Secure Policies
insert into storage.buckets (id, name, public)
values ('rikzen-media', 'rikzen-media', true)
on conflict (id) do nothing;

drop policy if exists "rikzen_media_authenticated_upload" on storage.objects;
create policy "rikzen_media_authenticated_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'rikzen-media' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "rikzen_media_authenticated_read" on storage.objects;
create policy "rikzen_media_authenticated_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'rikzen-media');

-- 14. Enable Realtime Publication safely
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'messages', 'message_receipts', 'message_reactions',
    'conversations', 'conversation_members',
    'friend_requests', 'statuses', 'status_views', 'status_reactions',
    'calls', 'call_ice_candidates', 'notifications',
    'user_presence', 'typing_indicators'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;
