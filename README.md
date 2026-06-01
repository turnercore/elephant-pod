# Elephant Pod

Elephant Pod is a local-first podcast app for web, desktop, iOS, and Android via Tauri. It combines an AntennaPod-style inbox/queue workflow, Overcast-style listening polish, optional self-hosted Supabase sync, server-rendered clips, and Elephant Hand Games branding.

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
- Signed-in server-owned Smart Skip V1 metadata jobs for transcript-backed ad/sponsor/promo segment maps.
- Optional account-based features through a server-owned auth+sync contract: magic-link auth, automatic signed-in sync for subscriptions/episodes/episode state/clips/settings/tombstones, and optional PodcastIndex discovery.
- Screen-reader labels on icon-first controls.
- Tauri v2 config for desktop/mobile packaging.
- Full local Supabase-style Docker bundle under `infra/supabase`.

## New in this pass

- `src-tauri/src/downloads.rs`: native app-data episode downloads, manifest tracking, storage stats, deletion, and oldest-first pruning.
- `src-tauri/src/native_audio.rs`: desktop-safe Rust command surface for native audio session state.
- `src-tauri/plugins/tauri-plugin-elephant-audio`: local Tauri audio plugin scaffold registered in the app shell.
- `src-tauri/mobile/ios/ElephantPodAudioPlugin.swift`: AVAudioSession / AVPlayer / MPRemoteCommandCenter implementation reference.
- `src-tauri/mobile/android/.../ElephantPodAudioPlugin.kt` and `ElephantPodPlaybackService.kt`: Android Media3 / ExoPlayer / MediaSessionService reference.
- `apps/server/src/mediaJobs.ts`: ffmpeg clip rendering and silence-shortening jobs.
- `apps/web/src/lib/audio/silenceMaps.ts`: frontend handoff to signed-in server-generated silence maps.
- `apps/web/src/lib/sync/syncEngine.ts`: bidirectional Supabase sync with merge conflict accounting.
- `infra/docker-compose.yml`: local Postgres plus Elephant Pod server for local development.
- `.forgejo/workflows/publish-container.yml`: Forgejo Actions build-and-push flow for the server image.
- `.forgejo/workflows/deploy-superzima.yml`: SSH deploy flow that pulls the Forgejo registry image on `superzima`.

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

- `SERVER_PUBLIC_URL` (browser-facing base URL for clip links and OAuth redirect targets, for example `https://pod.elephanthand.com` in production)
- `VITE_RUNTIME_MODE=server` for hosted browser builds; the Docker server image sets this at build time so the web app uses its own origin instead of a user-editable server URL
- `DATABASE_URL` (local Postgres for sync data, public clip registry, and server-owned metadata)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` when you are using a self-hosted Supabase stack or need privileged server-side Supabase calls
- `PODCASTINDEX_API_KEY`
- `PODCASTINDEX_API_SECRET`
- `PODCASTINDEX_USER_AGENT`
- `GOTRUE_EXTERNAL_GITHUB_ENABLED`
- `GOTRUE_EXTERNAL_GITHUB_CLIENT_ID`
- `GOTRUE_EXTERNAL_GITHUB_SECRET`
- `GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI`
- `SITE_URL` and `API_EXTERNAL_URL` for Supabase auth redirects/hosting expectations
- `SILENCE_THRESHOLD_DB`, `SILENCE_MINIMUM_SEC`, `SILENCE_RETAINED_SEC`, and `SILENCE_ANALYZER_VERSION` for signed-in server silence-map analysis defaults
- `SMART_SKIP_ENABLED`, `SMART_SKIP_REQUIRE_AUTH`, `SMART_SKIP_WHISPER_BASE_URL`, `SMART_SKIP_SEGMENTER_BASE_URL`, and related `SMART_SKIP_*` limits for signed-in Smart Skip processing

Security assumptions:

- `DATABASE_URL`, `SUPABASE_*`, and `PODCASTINDEX_*` stay server-only.
- Client runtime variables remain public and should only include `VITE_API_BASE_URL`.
- Server should validate and forward bearer tokens for logged-in sync/discovery calls.
- Tauri local mode works with zero server keys present; accounts and sync/discovery stay disabled until sign-in.
- Smart Skip benefits require a configured app server and a signed-in session. Local/offline playback does not request or apply Smart Skip metadata.
- Server boots with `dotenv` support, so a repository-root `.env` is loaded automatically during local dev.

### Server setup

There are two supported server layouts:

1. Bare local Postgres plus an auth provider you control. Use this when you want the smallest server footprint.
2. Full self-hosted Supabase for auth and Postgres. Use this when you want the auth stack and database bundled together.

Default bare-Postgres setup:

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d postgres
npm install
npm run dev:server
```

That starts the app server against the local Postgres container in `infra/docker-compose.yml`. Point `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the auth provider you control. If you also need privileged Supabase calls, add `SUPABASE_SERVICE_ROLE_KEY` to the root `.env`.

Self-hosted Supabase setup:

```bash
cd infra/supabase
cp .env.example .env
docker compose up -d
cd ../..
cp .env.example .env
npm install
npm run dev:server
```

The Supabase bundle gives you auth, Postgres, Kong, Studio, and Mailpit in one stack. Use `SUPABASE_URL=http://localhost:8000`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from that bundle in the app server env. If you use the Supabase Postgres for sync/data instead of the bare local `postgres` container, set `DATABASE_URL` to the Supabase Postgres connection string from that stack.

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
docker build -f apps/server/Dockerfile -t elephant-pod:local .
docker run --env-file .env -p 8787:8787 elephant-pod:local
```

That is the smallest direct server path. If you prefer Compose, use the `infra` folder:

```bash
cd infra
docker compose up --build
```

## Compose examples

Default app-server + local Postgres:

```bash
cd infra
cp .env.example .env
docker compose up -d
```

Services:

- App/server: `http://localhost:8787`
- Local Postgres: `localhost:54322`

Optional Smart Skip workers:

```bash
cd infra
SMART_SKIP_ENABLED=true docker compose --profile smart-skip up --build
```

The profile starts `whisper-worker` on `/v1/transcribe` and `codex-segmenter` on `/v1/segment`. The checked-in Whisper worker defaults to deterministic mock mode for local validation only. The segmenter can run in real mode with `MOCK_SEGMENTER=false` and `OPENAI_API_KEY`; it uses `gpt-5.4-mini` by default. Real Smart Skip processing requires a live `SMART_SKIP_WHISPER_BASE_URL` and `SMART_SKIP_SEGMENTER_BASE_URL`; the likely Superzima layout is app server plus segmenter on Superzima, with Whisper running on an Aero X16, Mac, or other GPU-capable host.

For an existing database, apply the Smart Skip V1 migration before enabling real workers:

```bash
psql "$DATABASE_URL" -f infra/postgres/migrations/20260601_smart_skip_v1.sql
```

A fresh database mounts `postgres/init.sql` to create the Elephant Pod sync tables and clip registry.

If you want to use Supabase only for auth, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and optionally `SUPABASE_SERVICE_ROLE_KEY` to the auth provider you control, then point `DATABASE_URL` at the local Postgres container.

If you want the full self-hosted Supabase stack instead of the bare Postgres container, use `infra/supabase/docker-compose.yml` and `infra/supabase/.env.example`:

```bash
cd infra/supabase
cp .env.example .env
docker compose up -d
```

That bundle provides auth and Postgres together and is the recommended example to follow when you want a single local stack with Supabase-managed auth.

## Forgejo deployment

The production container images are built by Forgejo Actions and pushed to the Forgejo container registry:

- `forge.elephanthand.com/elephant-hand-games/elephant-pod-server`
- `forge.elephanthand.com/elephant-hand-games/elephant-pod-segmenter`
- `forge.elephanthand.com/elephant-hand-games/elephant-pod-whisper-worker`

`superzima` then pulls those images through its Compose file instead of building from a copied checkout.

The Superzima deployment publishes the app server as `100.92.133.126:20001` on Tailscale. Racknerd's public Caddy proxy should route `pod.elephanthand.com` to that address.

Required deployment secrets:

- `SUPERZIMA_SSH_PRIVATE_KEY`
- `REGISTRY_USERNAME`
- `REGISTRY_TOKEN`

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
