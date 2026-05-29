# Architecture

Elephant Pod is split into four layers.

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

The app always writes to local IndexedDB first. Supabase sync is a second layer that can pull, merge, and push state for signed-in accounts. Sign-in is the sync opt-in; signing out is the opt-out.

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
- `listeningStats`

The queue is represented by `EpisodeState.queuePosition`, which keeps queue state easy to sync and backup. Starting playback with a row-level Play action inserts that episode at queue position 1 so playback state survives refresh; the previously current unfinished episode is displaced to Play Next. Playback history is tracked separately with `EpisodeState.lastPlayedAt`, while `playedAt` remains the completion/mark-played timestamp.

Per-podcast preferences are keyed by podcast/feed id. They can override speed, skip forward/back, skip intro, skip outro, silence shortening, episode sort direction, and whether new subscribed episodes enter Inbox. Skip intro/outro default to `0` seconds.

Listening stats are local profile facts stored in `listeningStats`: real time spent listening, podcast content time heard, per-podcast listening totals, estimated time saved by speed, and estimated time saved by silence skipping. They are exported in JSON backups but are not part of server sync.

Silence maps are derived cache facts. Signed-in server analysis creates maps for playback, clients cache them locally, and maps are not part of Supabase sync.

Smart Skip segment maps are also server-derived cache facts. They require a signed-in server session, store transcripts and segment metadata on the server, and are not part of Supabase sync. Local/offline playback ignores Smart Skip entirely.

Downloaded episode storage is device-local. Automatic queued downloads are enabled by default in Tauri/native builds; browser builds only auto-download same-origin media because most podcast CDNs block cross-origin `fetch()` even when an `<audio>` element can play the stream. Optional inbox downloads are lower priority. Delete-after-listen is enabled by default and treats an episode as inactive once it is no longer in Queue or Inbox; inactive non-favorite downloads are removed. Manual downloads are tagged locally so they can remain while active, then follow the same delete-after-listen/favorite retention rule once played, dismissed, or removed from the triage stack. Storage pruning preserves downloads in this order:

1. Favorited episodes.
2. Queued episodes from top to bottom.
3. Inbox episodes from the current triage top to bottom.

## Native model

Browser/web mode uses an HTML audio element without routing remote podcast media through Web Audio. Tauri builds can use the bridge in `apps/web/src/lib/native/tauriBridge.ts`.

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
- Signed-in silence-map analysis jobs via ffmpeg.
- Signed-in Smart Skip metadata jobs for media versions, transcripts, segment maps, segments, feedback, and worker orchestration.
- Sync/search mediation layer (server validates auth and calls Supabase/PodcastIndex)

Future server jobs should include:

- scheduled feed refresh
- push notifications
- web-push subscription management
- optional server-side search index
- durable background queues for clip/silence rendering
- active-user discovery for proactive Smart Skip processing

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
