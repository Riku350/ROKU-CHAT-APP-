# RIKZEN CHAT — Supabase, Google OAuth, Push & Netlify Setup Guide

RIKZEN CHAT ships with a **working full-stack Express + WebSocket + SQLite backend** right out of the box so every chat, friend request, group, status, call, and admin feature works immediately.

To connect your cloud Supabase project (`https://valhypvjykgrdtklyiim.supabase.co`) for multi-region cloud Auth, Google OAuth, PostgreSQL, Realtime, and Storage:

## 1. Inspect Your Existing Supabase Project
1. Open **Supabase Dashboard** → **SQL Editor**.
2. Run:
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
   ```
3. Check **Authentication → Users** and **Storage → Buckets** so you know what data already exists.

## 2. Apply the RIKZEN CHAT Schema
1. Copy the contents of `supabase/schema.sql` into the Supabase SQL Editor and click **Run**.
2. Grant yourself owner admin privileges in SQL Editor (replace `<YOUR_AUTH_USER_UUID>`):
   ```sql
   INSERT INTO public.admin_roles (user_id, role)
   VALUES ('<YOUR_AUTH_USER_UUID>', 'owner')
   ON CONFLICT (user_id) DO NOTHING;
   ```
3. Enable Realtime in **Database → Replication** for `messages`, `message_receipts`, `friend_requests`, `statuses`, `calls`, and `notifications`.

## 3. Enable Google OAuth
1. Go to **Google Cloud Console → APIs & Services → Credentials → Create OAuth Client ID (Web application)**.
2. Add Authorized Redirect URI:
   `https://valhypvjykgrdtklyiim.supabase.co/auth/v1/callback`
3. Copy the Client ID & Secret into **Supabase → Authentication → Providers → Google**.
4. Add your app URL (and `http://localhost:3000`) to **Supabase → Authentication → URL Configuration → Redirect URLs**.

## 4. Add Environment Variables
In AI Studio Secrets (or `.env` locally / Netlify Environment Variables):
- `VITE_SUPABASE_URL=https://valhypvjykgrdtklyiim.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<your-anon-public-key>`
- `RIKZEN_ADMIN_EMAILS=phonedata9955@gmail.com`

## 5. Deploy to Netlify
- Build command: `npm run build`
- Publish directory: `dist`
- If deploying full-stack Node/WebSockets (`server.ts`), deploy the Node server to Cloud Run / Render / Fly.io with `npm run start`.
