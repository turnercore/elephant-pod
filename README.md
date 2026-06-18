# DaisyPod

DaisyPod is now an iOS-first, local-first podcast app backed by the DaisyPod server. The supported frontend surface is the native SwiftUI app in `apps/ios`; the retired React/Tauri frontend has been removed from the runtime repository.

The backend in `apps/server` remains the durable service boundary for RSS parsing, PodcastIndex discovery, YouTube import and audio extraction, public clips, silence maps, Smart Skip, health, and capabilities. Personal app state belongs to the iOS app's local SQLite store and the CloudKit/iCloud sync boundary, not to the server.

## Repository Map

```text
apps/ios        Native SwiftUI iPhone app, SQLite local store, AVPlayer engine, tests
apps/server     Express backend for RSS, clips, PodcastIndex, YouTube, silence maps, Smart Skip
infra           Docker Compose and Postgres schema for local backend development
deploy          Superzima deployment compose files
workers         Optional Smart Skip worker services
docs            Architecture, audio, accessibility, iCloud sync, roadmap, validation
```

## What Works Now

- Native iOS Inbox, Library, Add/Search, History, Downloads, Settings, episode detail, podcast detail, bottom player, and expanded Now Playing queue sheet.
- Native Light, Dark, and Vaporwave appearance themes selected from Settings. Themes change colors, effects, and motion only; playback, sync, downloads, and server behavior stay local-first and unchanged.
- Local-first SQLite persistence for podcasts, episodes, episode state, queue, Inbox, preferences, clips, settings, tombstones, sync actions, downloads, and listening stats.
- Native AVPlayer playback with app-container downloads, progress persistence, Now Playing metadata plumbing, remote commands, sleep timer, speed/skip controls, autoplay next, chapters, and queue reorder.
- OPML import/export and JSON backup/restore through iOS document flows.
- Server-mediated RSS parsing with direct native RSS/Atom parsing as fallback.
- Server-mediated PodcastIndex search through native service headers.
- Server-mediated YouTube source import, metadata enrichment, and audio extraction.
- Public clip publishing and ffmpeg-rendered clip MP3s.
- Server-generated silence maps and Smart Skip metadata, cached locally for offline playback behavior and prepared for CloudKit personal sync.
- Sign in with Apple backed server sessions for protected backend processing and publishing routes.

## Local Development

```bash
cp .env.example .env
npm install
npm run dev:server
```

Build the iOS app from Xcode, with XcodeBuildMCP, or from the root scripts:

```bash
npm run ios:generate
npm run ios:build
npm run ios:test
```

The scripted simulator target is iPhone 13 mini.

Private physical-device installs can target the live Superzima backend token
without copying secrets into the shell history:

```bash
DAISYPOD_DEVELOPMENT_TEAM=<apple-team-id> \
npm run ios:install:superzima -- <device-udid> <coredevice-id>
```

## Root Checks

```bash
npm run typecheck
npm run test
npm run build
```

- `typecheck`: server TypeScript check plus iPhone 13 mini simulator build.
- `test`: server tests plus iPhone 13 mini iOS unit/UI tests.
- `build`: server build plus iPhone 13 mini simulator build.

## Server Runtime Contract

The native app can run without a server. When a backend is configured, server features are additive and gated by:

- `/api/capabilities` from the backend,
- native service headers for discovery,
- and Sign in with Apple sessions for protected processing and publishing routes.

Important environment variables:

- `SERVER_PUBLIC_URL`
- `DATABASE_URL`
- `PODCASTINDEX_API_KEY`
- `PODCASTINDEX_API_SECRET`
- `PODCASTINDEX_USER_AGENT`
- `APPLE_SIGN_IN_AUDIENCE` or `APPLE_BUNDLE_ID` when the Apple identity-token audience differs from `com.elephanthand.daisypod`
- `YOUTUBE_IMPORT_ENABLED`
- `YTDLP_PATH`
- `SERVER_MAX_JOBS`
- `CLIP_RENDER_ENABLED`
- `FFMPEG_PATH`
- `SMART_SKIP_ENABLED`
- `SMART_SKIP_WHISPER_BASE_URL`
- `SMART_SKIP_SEGMENTER_BASE_URL`

Server secrets must stay server-side. Do not put PodcastIndex, database, account-session tokens, or processing-service credentials into public client config. PodcastIndex discovery accepts native service headers; protected processing and publishing features require an Apple-backed backend session stored in the iOS Keychain.

## Docker

Direct server image:

```bash
docker build -f apps/server/Dockerfile -t daisy-pod:local .
docker run --env-file .env -p 8787:8787 daisy-pod:local
```

Local app server plus Postgres:

```bash
cd infra
docker compose up -d
```

Optional Smart Skip workers:

```bash
cd infra
SMART_SKIP_ENABLED=true docker compose --profile smart-skip up --build
```

## Deployment

Forgejo Actions builds and publishes:

- `forge.elephanthand.com/elephant-hand-games/daisy-pod-server`
- `forge.elephanthand.com/elephant-hand-games/daisy-pod-segmenter`
- `forge.elephanthand.com/elephant-hand-games/daisy-pod-whisper-worker`

Superzima pulls those images through `deploy/superzima/docker-compose.yml`. The live app server is published on Tailscale at `100.92.133.126:20001`, with the public proxy expected to route `pod.elephanthand.com` there.

## Sync Direction

The old server `/api/sync` product path is retired. Native personal sync targets CloudKit private database records prepared from local SQLite. The server should not receive private queue, playback, preference, subscription, or native file-path state just to sync Apple devices.

See:

- `apps/ios/README.md`
- `docs/ARCHITECTURE.md`
- `docs/ICLOUD_SYNC_MIGRATION.md`
- `docs/AUDIO_ENGINE.md`
- `docs/VALIDATION.md`
