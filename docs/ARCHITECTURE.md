# Architecture

Elephant Ears is split into four layers.

```text
React/Vite UI
  - local-first app state
  - IndexedDB/Dexie persistence
  - shared web/Tauri UI
  - browser audio fallback behind server sign-in
  - serverUrl-only backend endpoint config

Tauri shell
  - desktop/mobile packaging
  - Rust filesystem downloads
  - native audio command boundary
  - local Tauri audio plugin scaffold plus iOS/Android implementation references

Express app server
  - RSS fetch/parse proxy
  - static web app hosting
  - public clip pages
  - ffmpeg rendered clip files
  - ffmpeg silence-shortening jobs
  - authenticated API boundary for Supabase sync and PodcastIndex discovery

Self-hosted Supabase
  - optional accounts/auth
  - sync tables with RLS
  - user settings, subscriptions, episodes, states, clips, tombstones
```

## Local-first model

The app always writes to local IndexedDB first. Supabase sync is a second layer that can pull, merge, and push state for signed-in accounts.

Runtime policy:

- Browser/web runtime is account-required and blocks the app behind a server GitHub sign-in before playback, library actions, sync, or PodcastIndex discovery.
- Tauri/native runtime remains local-first and can run without a server or account. If a server is configured and the user signs in, sync and server discovery are additive.
- Both runtimes use local IndexedDB/Dexie app state. Tauri adds native filesystem/audio bridges where available.

Local tables:

- `feeds`
- `episodes`
- `states`
- `clips`
- `settings`
- `syncMeta`
- `tombstones`

The queue is represented by `EpisodeState.queuePosition`, which keeps queue state easy to sync and backup.

## Native model

Browser/web mode uses an HTML audio element. Tauri builds can use the bridge in `apps/web/src/lib/native/tauriBridge.ts`.

Implemented native-facing pieces:

- `src-tauri/src/downloads.rs`: app-local native downloads and pruning.
- `src-tauri/src/native_audio.rs`: desktop-safe command shim for native audio state.
- `src-tauri/plugins/tauri-plugin-elephant-audio`: local Tauri plugin package with a desktop shim and mobile source scaffolds.
- `src-tauri/mobile/ios`: AVPlayer/AVAudioSession/remote-command reference implementation.
- `src-tauri/mobile/android`: Media3/ExoPlayer/MediaSessionService reference implementation.

The plugin is registered in the Tauri shell so desktop builds degrade safely. Mobile projects still need generated Tauri plugin wiring, native entitlement/manifest work, and physical-device validation.

## Server model

The server is required for the hosted browser build because that runtime is account-gated. It remains optional for Tauri/native builds. It adds:

- RSS proxying to avoid browser CORS issues.
- Static web app hosting.
- Public clip pages.
- Rendered MP3 clip files via ffmpeg.
- Silence-shortened MP3 render jobs via ffmpeg.
- Sync/search mediation layer (server validates auth and calls Supabase/PodcastIndex)

Future server jobs should include:

- scheduled feed refresh
- push notifications
- web-push subscription management
- optional server-side search index
- durable background queues for clip/silence rendering

## Sync model

The current sync contract is:

```text
client -> sends bearer token + user state hints to the app server -> server validates auth token -> server syncs against Supabase using server secrets -> app server returns merged rows/tombstones -> client applies updates locally
```

Client ownership:

- UI/settings should only store `serverUrl`.
- The UI does not store Supabase URLs/anon keys/service keys.
- All searches are local by default and can run with no account.

Authenticated discovery:

- PodcastIndex-backed discovery is available to logged-in users via the server, with `PODCASTINDEX_*` keys kept server-only.

Conflict rule:

- Last writer wins by `updated_at` at row level.
- Downloads are device-local and are never synced.
- Tombstones can propagate deletes for future delete UI.

This is good enough for a v2 prototype. Production should move to a mutation log with server revisions and paginated pull cursors before heavy real-world use.
