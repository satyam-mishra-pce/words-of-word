# Google sign-in & Supabase (optional identity sync)

Sign-in is **optional**. Without any Supabase env vars the game runs exactly as
before — fully anonymous — and the "Sign in with Google" UI hides itself.
When configured, signing in with Google links a player's **username + avatar**
to their account so their identity follows them across devices. The realtime
game server stays anonymous; nothing about gameplay changes.

## Architecture

| Piece | Location |
| --- | --- |
| Supabase client (degrades to `null` when unconfigured) | `apps/web/src/services/supabase.ts` |
| Auth context: session, `signInWithGoogle`, `signOut`, native callback | `apps/web/src/auth/AuthProvider.tsx` |
| Profile read/write + local↔remote reconcile | `apps/web/src/services/profile.ts` |
| Sign-in button / signed-in menu (self-hiding) | `apps/web/src/components/AuthControl.tsx` |
| Native deep-link OAuth callback handler | `apps/web/src/components/NativeAppBridge.tsx` |
| DB schema (profiles + RLS + signup trigger) | `supabase/migrations/*_create_profiles.sql` |
| Local/config-push auth + provider config | `supabase/config.toml` |

Flow: `signInWithOAuth({ provider: 'google' })`.
- **Web/PWA**: full-page redirect back to the current origin; supabase-js parses
  the session from the URL.
- **Native (Capacitor)**: opens the system browser, Google redirects to
  `wordsofword://auth/callback`, the app's `appUrlOpen` listener catches it and
  calls `exchangeCodeForSession`. The `wordsofword://auth` host is registered in
  `ios/App/App/Info.plist` and `android/.../AndroidManifest.xml`.

Data model: one `public.profiles` row per user (`id` → `auth.users`), RLS so a
user only sees/edits their own row, and an `on_auth_user_created` trigger that
auto-creates the row (seeding the username from the Google name/email).

## One-time setup

### 1. Google OAuth credentials
In Google Cloud Console → APIs & Services → Credentials → **OAuth client ID**
(type: *Web application*):
- Authorized redirect URI: `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
- Copy the **Client ID** and **Client secret**.

### 2. Supabase dashboard
- Authentication → Providers → **Google**: enable, paste Client ID + secret.
- Authentication → URL Configuration:
  - Site URL: `https://wordsofword.in`
  - Additional Redirect URLs:
    `https://wordsofword.in/**`, `http://localhost:3000`, `wordsofword://auth/callback`

### 3. Push the database schema
From the repo root, with the CLI installed (`brew install supabase/tap/supabase`):

```bash
supabase login                 # opens browser for an access token
supabase link --project-ref <PROJECT-REF>
supabase db push               # applies supabase/migrations/*
```

### 4. Frontend env vars
Both are safe to expose (the anon key is a public, RLS-protected key):

```
VITE_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<public anon key>
```

- Local dev: copy `apps/web/.env.example` → `apps/web/.env.local`.
- Mobile: add them to `apps/web/.env.mobile` (see `.env.mobile.example`).
- Render (wordsofword.in): set both in the dashboard (declared in `render.yaml`).
- Vercel (portfolio): set both in Project → Settings → Environment Variables.

After a mobile env change run `pnpm mobile:sync` to rebuild the native apps.
