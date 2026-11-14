-- ============================================================================
-- RIKZEN CHAT — MEDIA BUCKETS, GRANULAR STORAGE RLS & MESSAGE/STATUS MEDIA COLUMNS
-- Safe idempotent migration for Supabase PostgreSQL + Storage
-- ============================================================================

-- 1. Ensure all 5 dedicated media storage buckets exist with clean limits & MIME allowlists
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'profile-photos',
    'profile-photos',
    true,
    10485760,
    array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
  ),
  (
    'chat-media',
    'chat-media',
    true,
    52428800,
    array[
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/3gpp'
    ]
  ),
  (
    'chat-documents',
    'chat-documents',
    true,
    26214400,
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/octet-stream'
    ]
  ),
  (
    'voice-messages',
    'voice-messages',
    true,
    26214400,
    array[
      'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus',
      'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'
    ]
  ),
  (
    'user-status',
    'user-status',
    true,
    52428800,
    array[
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'video/mp4', 'video/webm', 'video/quicktime'
    ]
  )
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. Granular Storage RLS Policies (DROP + CREATE idempotently)
drop policy if exists "rikzen_buckets_insert_own_folder" on storage.objects;
create policy "rikzen_buckets_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('profile-photos', 'chat-media', 'chat-documents', 'voice-messages', 'user-status', 'rikzen-media', 'avatars', 'statuses')
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or owner = auth.uid()
    )
  );

drop policy if exists "rikzen_buckets_update_own" on storage.objects;
create policy "rikzen_buckets_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id in ('profile-photos', 'chat-media', 'chat-documents', 'voice-messages', 'user-status', 'rikzen-media', 'avatars', 'statuses')
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or owner = auth.uid()
    )
  )
  with check (
    auth.uid()::text = (storage.foldername(name))[1]
    or owner = auth.uid()
  );

drop policy if exists "rikzen_buckets_delete_own" on storage.objects;
create policy "rikzen_buckets_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('profile-photos', 'chat-media', 'chat-documents', 'voice-messages', 'user-status', 'rikzen-media', 'avatars', 'statuses')
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or owner = auth.uid()
    )
  );

drop policy if exists "rikzen_buckets_select_authenticated" on storage.objects;
create policy "rikzen_buckets_select_authenticated" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('profile-photos', 'chat-media', 'chat-documents', 'voice-messages', 'user-status', 'rikzen-media', 'avatars', 'statuses')
  );

drop policy if exists "rikzen_profile_status_public_read" on storage.objects;
create policy "rikzen_profile_status_public_read" on storage.objects
  for select to anon
  using (bucket_id in ('profile-photos', 'avatars'));

-- 3. Explicit Media Columns on public.messages, public.statuses, public.attachments
alter table if exists public.messages
  add column if not exists media_url text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text,
  add column if not exists duration int,
  add column if not exists thumbnail_url text,
  add column if not exists delivery_status text not null default 'sent'
    check (delivery_status in ('sending', 'sent', 'delivered', 'seen'));

alter table if exists public.statuses
  add column if not exists font_style text not null default 'sans',
  add column if not exists duration int,
  add column if not exists thumbnail_url text;

alter table if exists public.attachments
  add column if not exists bucket_name text,
  add column if not exists storage_path text,
  add column if not exists thumbnail_url text,
  add column if not exists duration int;

-- Ensure statuses UPDATE & DELETE policies exist cleanly
drop policy if exists "statuses_select_permitted" on public.statuses;
create policy "statuses_select_permitted" on public.statuses
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      expires_at > now()
      and (
        privacy = 'everyone'
        or exists (
          select 1 from public.friendships f
          where (f.user_one = auth.uid() and f.user_two = statuses.user_id)
             or (f.user_two = auth.uid() and f.user_one = statuses.user_id)
        )
      )
    )
  );

drop policy if exists "statuses_insert_own" on public.statuses;
create policy "statuses_insert_own" on public.statuses
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "statuses_delete_own" on public.statuses;
create policy "statuses_delete_own" on public.statuses
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "status_views_access" on public.status_views;
create policy "status_views_access" on public.status_views
  for all to authenticated
  using (
    viewer_id = auth.uid()
    or exists (
      select 1 from public.statuses s
      where s.id = status_views.status_id and s.user_id = auth.uid()
    )
  )
  with check (viewer_id = auth.uid());

drop policy if exists "attachments_member_access" on public.attachments;
create policy "attachments_member_access" on public.attachments
  for all to authenticated
  using (
    uploader_id = auth.uid()
    or exists (
      select 1 from public.messages m
      join public.conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = attachments.message_id and cm.user_id = auth.uid()
    )
  )
  with check (uploader_id = auth.uid());
