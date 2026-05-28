# Elephant Ears

Elephant Ears is a local-first podcast app for web, desktop, iOS, and Android via Tauri. It combines an AntennaPod-style inbox/queue workflow, Overcast-style listening polish, optional self-hosted Supabase sync, server-rendered clips, and Elephant Hand Games branding.

This repository is a **v2 production-oriented scaffold**. The web/server app builds and runs. The Tauri shell now has native filesystem download commands and a stable command boundary for native audio. A local Tauri audio plugin package is included and registered for desktop-safe fallback; the iOS/Android implementations are still scaffolds that need generated-project wiring and physical-device validation.

## What works now

- Local-first podcast library with IndexedDB/Dexie.
- Demo seed library.
- Inbox triage: queue, dismiss, mark played, download.
- Obvious queue and autoplay-next behavior.
- Player controls: play/pause, skip forward/back, speed, sleep timer, resume rewind, chapters panel.
- Configurable skip amounts: 10/15/30/60 seconds.
- Episode state: played/unplayed, progress, queue position, downloaded flag, favorite flag.
- Filtering/sorting: played/unplayed/all, newest/oldest.
- Mark all episodes in a show as played.
- RSS import via app server proxy endpoint.
- OPML import/export and JSON backup/export/import.
- Web offline fallback through Cache Storage where the podcast host allows CORS.
- Native filesystem download commands in `src-tauri/src/downloads.rs` for Tauri builds.
- Auto-download setting, Wi-Fi-only preference, auto-delete after listen, and storage-cap pruning.
- Public clip publishing with ffmpeg-rendered MP3 files and source time-range fallback.
- Server-side silence-shortening render jobs through ffmpeg.
- Optional account-based features through a server-owned auth+sync contract: magic-link auth, authenticated sync for subscriptions/episodes/episode state/clips/settings/tombstones, and optional PodcastIndex discovery.
- Screen-reader labels on icon-first controls.
- Tauri v2 config for desktop/mobile packaging.
- Full local Supabase-style Docker bundle under `infra/supabase`.

## New in this pass

- `src-tauri/src/downloads.rs`: native app-data episode downloads, manifest tracking, storage stats, deletion, and oldest-first pruning.
- `src-tauri/src/native_audio.rs`: desktop-safe Rust command surface for native audio session state.
- `src-tauri/plugins/tauri-plugin-elephant-audio`: local Tauri audio plugin scaffold registered in the app shell.
- `src-tauri/mobile/ios/ElephantEarsAudioPlugin.swift`: AVAudioSession / AVPlayer / MPRemoteCommandCenter implementation reference.
- `src-tauri/mobile/android/.../ElephantEarsAudioPlugin.kt` and `ElephantEarsPlaybackService.kt`: Android Media3 / ExoPlayer / MediaSessionService reference.
- `apps/server/src/mediaJobs.ts`: ffmpeg clip rendering and silence-shortening jobs.
- `apps/web/src/lib/audio/serverSilence.ts`: frontend handoff to server-rendered silence-shortened audio.
- `apps/web/src/lib/sync/syncEngine.ts`: bidirectional Supabase sync with merge conflict accounting.
- `infra/supabase/docker-compose.yml`: self-hosted Supabase-style stack plus Elephant Ears server.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev:server
# In another terminal:
npm run dev:web
```

Open `http://localhost:5173`.

### Server runtime contract

The shared UI is IndexedDB-first and never receives Supabase or PodcastIndex secrets. Browser/web runtime is server-account gated: it requires a trusted server URL plus GitHub sign-in before use. Tauri/native runtime remains local-first and can run without a server connection or sign-in.

Set these in the app server environment (example in `.env.example`):

- `SERVER_PUBLIC_URL` (public URL for clip links/redirects)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (if used by server-side auth and admin operations)
- `PODCASTINDEX_API_KEY`
- `PODCASTINDEX_API_SECRET`
- `PODCASTINDEX_USER_AGENT`
- `GOTRUE_EXTERNAL_GITHUB_ENABLED`
- `GOTRUE_EXTERNAL_GITHUB_CLIENT_ID`
- `GOTRUE_EXTERNAL_GITHUB_SECRET`
- `GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI`
- `SITE_URL` and `API_EXTERNAL_URL` for Supabase auth redirects/hosting expectations

Security assumptions:

- `SUPABASE_*` and `PODCASTINDEX_*` stay server-only.
- Client runtime variables remain public and should only include `VITE_API_BASE_URL`.
- Server should validate and forward bearer tokens for logged-in sync/discovery calls.
- Tauri local mode works with zero server keys present; accounts and sync/discovery stay disabled until sign-in.
- Server boots with `dotenv` support, so a repository-root `.env` is loaded automatically during local dev.

## Build web + server

```bash
npm install
npm run typecheck
npm run build
npm run start:server
```

The server serves the web build when `WEB_DIST=apps/web/dist`.

## Docker app server only

```bash
cp .env.example .env
docker build -f apps/server/Dockerfile -t elephant-ears:local .
docker run --env-file .env -p 8787:8787 elephant-ears:local
```

Or from the `infra` folder:

```bash
cd infra
docker compose up --build
```

## Self-hosted Supabase + Elephant Ears

```bash
cd infra/supabase
cp .env.example .env
# Replace JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, POSTGRES_PASSWORD, and dashboard credentials.
docker compose pull
docker compose up -d
```

Services:

- App/server: `http://localhost:8787`
- Supabase gateway: `http://localhost:8000`
- Mailpit: `http://localhost:8025`
- Direct dev Postgres: `localhost:54322`

A fresh database mounts `volumes/db/init/01-elephant-ears-schema.sql` to create the Elephant Ears sync tables and RLS policies.

## Tauri desktop/mobile

Install Rust and the Tauri prerequisites for your OS, then:

```bash
npm install
npm run tauri:dev
```

For iOS/Android, run the normal Tauri mobile initialization flow, then wire the local plugin package in `src-tauri/plugins/tauri-plugin-elephant-audio` and the platform reference files in `src-tauri/mobile` into the generated projects. See `docs/MOBILE_TAURI_NOTES.md`.

## Repository map

```text
apps/web        React + Vite + Tailwind app shared by browser and Tauri
apps/server     Express RSS proxy, ffmpeg jobs, static hosting, clip pages
src-tauri       Tauri v2 shell, native download commands, audio command boundary
infra           Docker Compose, Caddy, Supabase schema/full local stack
docs            Architecture, audio, accessibility, sync, roadmap
Agents.md       Instructions for future coding agents
```

## Current limitations

- Native audio plugin code is included but not yet compiled into generated Tauri mobile projects.
- iOS/Android background playback, lock-screen controls, interruptions, and foreground service behavior require device validation.
- Server-side silence shortening renders a cached processed file; it does not yet stream progressively while ffmpeg is processing.
- Supabase sync uses latest `updated_at` as the conflict rule. A CRDT/mutation-log model would be stronger for collaborative/shared accounts.
- Public clips are public. Do not use public clip sharing for private feeds until the authorization model is extended.
