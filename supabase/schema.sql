-- ============================================================================
-- RIKZEN CHAT — PRODUCTION SUPABASE POSTGRESQL SCHEMA & RLS POLICIES
-- Target Project: https://valhypvjykgrdtklyiim.supabase.co
-- Run safely in Supabase SQL Editor (uses IF NOT EXISTS where safe).
-- Before running on an existing project, inspect existing tables via:
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Helper: Generate permanent unique RIKZEN-XXXXXX ID (never reused)
-- ----------------------------------------------------------------------------
create or replace function public.generate_unique_rikzen_id()
returns text
language plpgsql
security definer
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  exists_already boolean;
  i int;
begin
  loop
    candidate := 'RIKZEN-';
    for i in 1..6 loop
      candidate := candidate || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    end loop;
    select exists(select 1 from public.profiles where rikzen_id = candidate) into exists_already;
    exit when not exists_already;
  end loop;
  return candidate;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. profiles
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  rikzen_id text unique not null default public.generate_unique_rikzen_id(),
  email text,
  full_name text not null,
  avatar_url text,
  bio text default 'Hey there! I am using RIKZEN CHAT.',
  phone text,
  phone_verified boolean not null default false,
  email_verified boolean not null default false,
  date_of_birth date,
  is_suspended boolean not null default false,
  is_online boolean not null default false,
  last_seen_at timestamptz not null default now(),
  privacy_settings jsonb not null default '{
    "lastSeen": "friends",
    "onlineStatus": "everyone",
    "profilePhoto": "everyone",
    "bioVisibility": "everyone",
    "readReceipts": true,
    "friendRequests": "everyone",
    "discoverableByPhone": true,
    "discoverableByName": true,
    "emailVisibility": "nobody"
  }'::jsonb,
  appearance_settings jsonb not null default '{
    "theme": "dark",
    "wallpaper": "obsidian-web",
    "accentColor": "gold",
    "fontSize": "medium",
    "bubbleStyle": "rounded"
  }'::jsonb,
  notification_settings jsonb not null default '{
    "messages": true,
    "friendRequests": true,
    "groups": true,
    "calls": true,
    "statuses": true,
    "sound": true,
    "vibration": true
  }'::jsonb,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_rikzen_id on public.profiles (upper(rikzen_id));
create index if not exists idx_profiles_phone on public.profiles (phone) where phone is not null;
create index if not exists idx_profiles_full_name on public.profiles using gin (to_tsvector('simple', full_name));

-- Prevent duplicate profiles & immutable rikzen_id
create or replace function public.protect_immutable_rikzen_id()
returns trigger language plpgsql as $$
begin
  if old.rikzen_id is not null and new.rikzen_id <> old.rikzen_id then
    raise exception 'RIKZEN ID is permanent and cannot be modified.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_protect_rikzen_id on public.profiles;
create trigger trg_protect_rikzen_id
  before update on public.profiles
  for each row execute function public.protect_immutable_rikzen_id();

-- ----------------------------------------------------------------------------
-- 2. friend_requests
-- ----------------------------------------------------------------------------
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_self_request check (sender_id <> receiver_id),
  constraint unique_friend_request unique (sender_id, receiver_id)
);

create index if not exists idx_friend_requests_receiver on public.friend_requests (receiver_id, status);
create index if not exists idx_friend_requests_sender on public.friend_requests (sender_id, status);

-- ----------------------------------------------------------------------------
-- 3. friendships
-- ----------------------------------------------------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_one uuid not null references public.profiles(id) on delete cascade,
  user_two uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint ordered_pair check (user_one < user_two),
  constraint unique_friendship unique (user_one, user_two)
);

-- ----------------------------------------------------------------------------
-- 4. conversations & 5. conversation_members
-- ----------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type in ('direct', 'group')),
  group_id uuid,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  muted boolean not null default false,
  archived boolean not null default false,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 6. messages, 7. message_receipts, 8. message_reactions, 9. attachments
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  message_type text not null default 'text' check (message_type in ('text', 'image', 'video', 'document', 'audio', 'voice', 'location', 'system')),
  reply_to_id uuid references public.messages(id) on delete set null,
  forwarded_from_id uuid references public.messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  is_edited boolean not null default false,
  is_deleted boolean not null default false,
  deleted_for_users uuid[] not null default '{}',
  is_pinned boolean not null default false,
  pinned_by uuid references public.profiles(id),
  starred_by uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation_time on public.messages (conversation_id, created_at desc);

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 10. groups & 11. group_members
-- ----------------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid unique references public.conversations(id) on delete cascade,
  name text not null,
  description text default '',
  avatar_url text,
  created_by uuid not null references public.profiles(id),
  only_admins_message boolean not null default false,
  only_admins_edit_info boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 12. statuses & 13. status_views (24h auto expiration)
-- ----------------------------------------------------------------------------
create table if not exists public.statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null default 'text' check (media_type in ('text', 'image', 'video')),
  content text default '',
  media_url text,
  caption text default '',
  background_color text default '#141418',
  muted_by uuid[] not null default '{}',
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index if not exists idx_statuses_active on public.statuses (expires_at, user_id);

create table if not exists public.status_views (
  status_id uuid not null references public.statuses(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  reaction text,
  viewed_at timestamptz not null default now(),
  primary key (status_id, viewer_id)
);

-- ----------------------------------------------------------------------------
-- 14. channels & 15. channel_followers
-- ----------------------------------------------------------------------------
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  avatar_url text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  is_verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.channel_followers (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'follower' check (role in ('admin', 'follower')),
  followed_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.channel_posts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  media_url text,
  media_type text default 'text',
  reactions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 16. communities & 17. community_members
-- ----------------------------------------------------------------------------
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  avatar_url text,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  linked_group_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 18. calls, 19. notifications, 20. blocked_users, 21. user_devices, 22. reports, 23. admin_roles
-- ----------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  call_type text not null check (call_type in ('voice', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'connected', 'ended', 'missed', 'rejected')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int not null default 0
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_name text not null,
  platform text not null,
  fcm_token text,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'message', 'group', 'channel')),
  target_id text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin', 'moderator')),
  granted_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) & CROSS-DEVICE SECURE SEARCH RPC
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
alter table public.message_reactions enable row level security;
alter table public.attachments enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.statuses enable row level security;
alter table public.status_views enable row level security;
alter table public.channels enable row level security;
alter table public.channel_followers enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.calls enable row level security;
alter table public.notifications enable row level security;
alter table public.blocked_users enable row level security;
alter table public.user_devices enable row level security;
alter table public.reports enable row level security;
alter table public.admin_roles enable row level security;

-- Helper: Check if user is admin (cannot be modified by normal users)
create or replace function public.is_rikzen_admin(uid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists(select 1 from public.admin_roles where user_id = uid);
$$;

-- Profiles: Users read own profile, friends' profiles, or admin; edit only own profile
create policy "profiles_select_self_or_friends" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_rikzen_admin(auth.uid())
    or exists(
      select 1 from public.friendships f
      where (f.user_one = auth.uid() and f.user_two = id)
         or (f.user_two = auth.uid() and f.user_one = id)
    )
    or exists(
      select 1 from public.friend_requests fr
      where (fr.sender_id = auth.uid() and fr.receiver_id = id)
         or (fr.receiver_id = auth.uid() and fr.sender_id = id)
    )
  );

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_rikzen_admin(auth.uid()))
  with check (id = auth.uid() or public.is_rikzen_admin(auth.uid()));

-- SECURE CROSS-DEVICE DISCOVERY RPC (Solves RIIKU CHAT cross-device search bug!)
-- Returns ONLY permitted public fields, never exposing private emails or hidden phone numbers.
create or replace function public.search_discoverable_profiles(search_query text)
returns table (
  id uuid,
  rikzen_id text,
  full_name text,
  avatar_url text,
  bio text,
  phone text,
  is_online boolean
)
language plpgsql
security definer
as $$
declare
  q text := trim(search_query);
begin
  if auth.uid() is null or length(q) < 2 then
    return;
  end if;

  return query
  select
    p.id,
    p.rikzen_id,
    p.full_name,
    case when (p.privacy_settings->>'profilePhoto') = 'nobody' then null else p.avatar_url end,
    case when (p.privacy_settings->>'bioVisibility') = 'nobody' then null else p.bio end,
    case when (p.privacy_settings->>'discoverableByPhone')::boolean = true and p.phone = q then p.phone else null end,
    case when (p.privacy_settings->>'onlineStatus') = 'everyone' then p.is_online else false end
  from public.profiles p
  where p.id <> auth.uid()
    and p.is_suspended = false
    and not exists(
      select 1 from public.blocked_users b
      where (b.blocker_id = p.id and b.blocked_id = auth.uid())
         or (b.blocker_id = auth.uid() and b.blocked_id = p.id)
    )
    and (
      upper(p.rikzen_id) = upper(q)
      or (
        coalesce((p.privacy_settings->>'discoverableByPhone')::boolean, false) = true
        and p.phone_verified = true
        and p.phone = q
      )
      or (
        coalesce((p.privacy_settings->>'discoverableByName')::boolean, true) = true
        and p.full_name ilike ('%' || q || '%')
      )
    )
  limit 20;
end;
$$;

-- Friend requests policies
create policy "friend_requests_access" on public.friend_requests
  for all to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid())
  with check (sender_id = auth.uid() or receiver_id = auth.uid());

-- Friendships policies
create policy "friendships_select" on public.friendships
  for select to authenticated
  using (user_one = auth.uid() or user_two = auth.uid());

-- Conversations & Messages: Strictly connected members only
create policy "conversation_members_select" on public.conversation_members
  for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation_id and cm.user_id = auth.uid()
  ));

create policy "messages_member_access" on public.messages
  for all to authenticated
  using (exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  ))
  with check (sender_id = auth.uid() and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  ));

-- Admin roles: Normal users can NEVER insert/update/delete admin_roles
create policy "admin_roles_read_own" on public.admin_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_rikzen_admin(auth.uid()));

-- Notifications & Devices: Owner only
create policy "notifications_own" on public.notifications
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_devices_own" on public.user_devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Storage Buckets
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('chat-media', 'chat-media', true),
       ('statuses', 'statuses', true)
on conflict (id) do nothing;

create policy "storage_authenticated_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('avatars', 'chat-media', 'statuses') and owner = auth.uid());

create policy "storage_authenticated_read" on storage.objects
  for select to authenticated
  using (bucket_id in ('avatars', 'chat-media', 'statuses'));

-- ============================================================================
-- RIKZEN CHAT 20261114 UPGRADE EXTENSIONS (See also supabase/migrations/)
-- ============================================================================
alter table if exists public.conversation_members
  add column if not exists pinned boolean not null default false,
  add column if not exists pinned_at timestamptz,
  add column if not exists marked_unread boolean not null default false,
  add column if not exists disappearing_seconds int not null default 0,
  add column if not exists chat_theme text,
  add column if not exists custom_list text not null default '',
  add column if not exists cleared_at timestamptz;

alter table if exists public.groups
  add column if not exists invite_code text unique;

alter table if exists public.messages
  add column if not exists expires_at timestamptz;

alter table if exists public.statuses
  add column if not exists privacy text not null default 'friends',
  add column if not exists allowed_viewer_ids uuid[] not null default '{}',
  add column if not exists excluded_viewer_ids uuid[] not null default '{}';

create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  active_devices int not null default 0,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.typing_indicators (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity text not null default 'typing' check (activity in ('typing', 'recording', 'idle')),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.status_reactions (
  id uuid primary key default gen_random_uuid(),
  status_id uuid not null references public.statuses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (status_id, user_id, emoji)
);

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
  last_seen_privacy text not null default 'friends',
  online_privacy text not null default 'everyone',
  status_privacy text not null default 'friends',
  read_receipts boolean not null default true,
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace view public.chat_requests as
  select id, sender_id, receiver_id, status, created_at, updated_at
  from public.friend_requests;

