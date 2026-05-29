# Server and Sync

## Goals

- Accounts are required in the browser/web runtime because the hosted app runs through the server auth boundary.
- Accounts are optional in Tauri/native runtime.
- The native app is useful on a single device without any backend.
- A self-hosted server plus local Postgres unlocks cross-device sync and public clip sharing.
- Production deployment can pull a prebuilt GHCR image from GitHub Actions instead of building from a copied source tree on the server.
- Sign-in is the sync opt-in. There is no separate sync opt-out toggle; signing out returns the app to local-only behavior.
- Core playback, RSS/OPML, and local backup remain first-class in Tauri local-only mode.

## Runtime sync contract

The web/Tauri client keeps a local IndexedDB-first model and stores only `serverUrl` in settings. Browser/web runtime blocks on a valid server session before exposing app actions. Tauri/native runtime can skip sign-in and use the same local store without server connectivity. Once a valid session exists, sync is considered active automatically.

Client responsibilities:

- Keep local tables as the source of truth for UI state.
- Use authenticated server routes with an `Authorization: Bearer <token>` header.
- Store no Supabase or PodcastIndex credentials in app settings, query params, or persisted UI config.

Server responsibilities:

- Validate bearer tokens from the app session.
- Use local Postgres for sync tables, public clip registry, and server-owned metadata.
- Serve optional PodcastIndex discovery for logged-in users.
- Expose auth/sync endpoints (`/api/auth/*`, `/api/sync`) for client-mediated sign-in and merge.

Auth/sync contract endpoints:

- `GET /api/auth/config`: validates and reports auth configuration availability.
- `POST /api/auth/github/start`: returns a GitHub OAuth authorization URL and callback path.
- `GET /api/auth/github/callback`: exchanges `code` when possible and returns session payload.
- `GET /api/auth/session`: validates bearer token and returns user info.
- `POST /api/sync`: accepts local payload and returns merged `pulledData` + merge stats.

The v2 sync flow is:

```text
client local rows -> POST sync request + bearer token -> server validates token -> server reads/writes local Postgres -> server resolves conflicts -> server returns merged rows + tombstones -> client applies IndexedDB updates -> local sync metadata updates
```

Current tables and entities:

- `subscriptions`
- `episodes`
- `episode_states`
- `clips`
- `user_settings`
- `sync_tombstones`
- `public_clips`

## Conflict rules implemented

| Data | Merge rule |
|---|---|
| Subscriptions | Newer `updated_at` row wins. |
| Episodes | Newer `updated_at` row wins. |
| Episode state | Newer `updated_at` row wins. |
| Queue | Queue fields are part of episode state, so newer state wins. |
| Settings | Newer settings blob wins. |
| Podcast preferences | Newer per-podcast row wins, including speed, skip forward/back, skip intro/outro, silence, sort, and new-episode Inbox behavior. |
| Clips | Newer clip row wins. |
| Tombstones | Pulled tombstones delete matching local rows. |
| Downloads | Not synced; every device owns its own downloaded files. |

Download-related settings such as queued auto-download, inbox auto-download, delete-after-listen, Inbox sort direction, Wi-Fi-only downloads, and storage cap are part of the synced settings blob. Actual downloaded files, file paths, and local download-source tags remain local-only.

Listening stats are also local-only. They are profile facts on the device and can be exported in JSON backup, but they are not currently merged through Supabase/server sync.

Silence maps are server-derived cache data. They are created through signed-in server endpoints, cached locally in IndexedDB, and not merged through Supabase/server sync.

Smart Skip maps are server-owned cache data. They require signed-in server routes, are stored in Smart Skip tables, and are not merged through Supabase/server sync. Local-only Tauri playback, queueing, inbox triage, settings, and downloads must continue without them.

## Search contract

- Local search is available without authentication in Tauri/native local-only mode.
- Browser/web runtime requires authentication before local or remote search UI is available.
- Local search covers on-device feed and episode metadata (`title`, `description`, `podcast` fields).
- PodcastIndex discovery/search is only available when authenticated and runs through server routes.

## Silence maps

`POST /api/audio/silence-maps` and `GET /api/audio/silence-maps/:id` require `Authorization: Bearer <token>`.

The server uses ffmpeg `silencedetect` and server env defaults to create map segments. Defaults are `SILENCE_THRESHOLD_DB=-42`, `SILENCE_MINIMUM_SEC=0.7`, `SILENCE_RETAINED_SEC=0.25`, and `SILENCE_ANALYZER_VERSION=v1`. Segments shorten long silences by keeping the retained portion and skipping the rest.

## Smart Skip

`POST /api/smart-skip/process`, `GET /api/smart-skip/jobs/:id`, `GET /api/smart-skip/episodes/:episodeId/segment-map`, and `POST /api/smart-skip/feedback` require `Authorization: Bearer <token>` by default.

The server stores media versions, transcripts, segment maps, segments, jobs, and feedback in local Postgres when `DATABASE_URL` is configured. If no database is configured, the server keeps an in-memory fallback for local development only. Worker services are configured with `SMART_SKIP_WHISPER_BASE_URL` and `SMART_SKIP_SEGMENTER_BASE_URL`.

## Public clips

Public clip links use the Express server.

`POST /api/clips` stores the clip, returns a public page URL, and starts an ffmpeg render job for an MP3 excerpt. If rendering fails or is disabled, the public page falls back to a source audio time-range URL.

Security rules:

- Do not expose private-feed credentials through public clips.
- Do not render/share paid/private audio unless the user has rights to share it.
- Supabase auth keys belong only in server env; UI code must not persist them.
- Supabase and PodcastIndex credentials are server-only.
- `DATABASE_URL` belongs only in server env and points at the local Postgres instance.
- Browsers should only be configured with `VITE_API_BASE_URL` in build-time env.

## Remaining sync hardening

- Add paginated incremental pulls by cursor.
- Add mutation-log table and server revisions.
- Add per-field settings merge instead of blob merge.
- Add queue-specific merge rules for multi-device concurrent reordering.
- Add integration tests with two simulated devices.

## Validation notes

- Tauri/native runtime should function in local-only mode with `serverUrl` unset or unreachable:
  - RSS feed import, playback queue, OPML import/export, and backups remain usable.
- Browser/web runtime should show the sign-in gate until a valid server session is present.
- When `serverUrl` is reachable:
  - `GET /api/health` should return `{ "ok": true }`.
  - A valid bearer token should return authenticated sync responses.
  - A missing or invalid token should keep sync/search disabled and return auth-related errors.
- Local Postgres should contain the sync tables listed above and the server should refuse sync with a clear 503 if `DATABASE_URL` is unset.
