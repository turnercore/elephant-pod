# Server and Sync

## Goals

- Accounts are required in the browser/web runtime because the hosted app runs through the server auth boundary.
- Accounts are optional in Tauri/native runtime.
- The native app is useful on a single device without any backend.
- A self-hosted server plus local Postgres unlocks cross-device sync and public clip sharing.
- Production deployment can pull a prebuilt Forgejo registry image from Forgejo Actions instead of building from a copied source tree on the server.
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
- Serve optional YouTube import for logged-in users when server-side YouTube import is enabled.
- Expose auth/sync endpoints (`/api/auth/*`, `/api/sync`) for client-mediated sign-in and merge.

Auth/sync contract endpoints:

- `GET /api/auth/config`: validates and reports auth configuration availability.
- `POST /api/auth/github/start`: returns a GitHub OAuth authorization URL and callback path. Web callers pass their app URL as `returnTo`; native/Tauri callers pass `elephant-pod://auth/callback`.
- `GET /api/auth/github/callback`: exchanges `code` when possible and returns session payload, redirects to the sanitized `returnTo` URL with session params, or serves a no-store fragment bridge when Supabase returns implicit-flow tokens in the URL hash.
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

Subscriptions and episodes include optional source metadata for RSS and YouTube synthetic sources: `source_type`, `source_url`, `external_id`, and episode `extraction_status`. Existing databases should apply `infra/postgres/migrations/20260602_youtube_sources.sql`.

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

Download-related settings such as queued auto-download, inbox auto-download, delete-after-listen, Inbox sort direction, Wi-Fi-only downloads, and storage cap are part of the synced settings blob. Actual downloaded files, file paths, local download-source tags, downloaded artwork blobs, and cached skip maps remain local-only.

Downloaded episodes are the offline contract. When the browser reports offline, the app shows an offline banner and filters Library, Inbox, Queue, Downloads, and detail navigation to downloaded episodes and their parent podcasts. Episode state mutations still write to local IndexedDB while offline. When connectivity and a valid session return, the client runs sync again so played, progress, queue, Inbox, settings, and subscription changes can be pushed through the normal merge path.

Library membership is broader than subscription membership. A podcast belongs in Library when it is subscribed, cached, downloaded, queued, in Inbox, or otherwise has retained local episode state. Subscription controls automatic feed refresh and whether new releases are added to Inbox. Unsubscribing removes only that automatic subscription; it must not remove retained downloaded, queued, inboxed, cached, or historical episodes.

Listening stats are also local-only. They are profile facts on the device and can be exported in JSON backup, but they are not currently merged through Supabase/server sync.

Silence maps are server-derived cache data. They are created through signed-in server endpoints, cached locally in IndexedDB, and not merged through Supabase/server sync. Downloading an episode attempts to cache the matching silence map so Smart Skip silence can keep working offline when the map is ready.

Smart Skip maps are server-owned cache data. They require signed-in server routes, are stored in server Smart Skip tables, cached locally in IndexedDB when ready, and are not merged through Supabase/server sync. Downloading an episode attempts to cache the matching Smart Skip map so Smart Skip can keep working offline when the map is ready. Local-only Tauri playback, queueing, inbox triage, settings, and downloads must continue without server Smart Skip access.

## Search and Add Podcast contract

- Library filtering is local and covers subscribed podcast title, author, tags, description, feed URL, and source URL.
- The Add Podcast omnibar accepts RSS URLs, PodcastIndex search text, and YouTube URLs.
- PodcastIndex discovery/search is only available when authenticated and runs through server routes.
- YouTube import is only available when authenticated and when `/api/capabilities` reports `youtubeImport.enabled=true`.
- The server never searches YouTube for plain text queries. Users must paste a YouTube video, playlist, channel, or podcast URL.
- YouTube video URLs resolve to the parent channel's canonical synthetic podcast when the channel can be identified, and the requested video is merged into that feed if it is not already present. YouTube playlist, channel, and podcast playlist URLs create refreshable synthetic podcasts. A real RSS feed remains the preferred import path when available.

## YouTube import

`POST /api/youtube/import` and `POST /api/youtube/sources/:id/refresh` require `Authorization: Bearer <token>` and server-side YouTube import enabled. `GET /api/capabilities` exposes only whether import is enabled; it does not expose server paths or tool configuration to the client.

YouTube source import is metadata-first. It creates or updates a canonical server-owned synthetic podcast feed and normal local-first podcast/episode rows without queueing audio extraction. The app server exposes the fake RSS-style feed as `/api/youtube/feed.xml?url=...` so other podcast clients can consume it. Later users importing the same canonical YouTube source reuse the stored feed immediately.

Server-only env:

- `YOUTUBE_IMPORT_ENABLED`
- `YTDLP_PATH`
- `YOUTUBE_METADATA_MAX_ENTRIES`
- `YOUTUBE_AUDIO_QUALITY`

The app server fetches lightweight YouTube text/image metadata during source import and refresh. For playlist and channel sources, it uses `yt-dlp --flat-playlist --dump-json` when available so synthetic feeds are not limited to YouTube's short RSS window. `YOUTUBE_METADATA_MAX_ENTRIES` defaults to 500. Large flat crawls use metadata-only Shorts filtering to avoid one HTML request per episode.

Opening a YouTube episode page triggers `POST /api/youtube/episodes/:id/enrich`, which runs a single-episode `yt-dlp --dump-json --skip-download` metadata enrichment and stores the result under the server media data directory. Later fake RSS generation merges that cached enrichment so title, description, duration, image, and published date improvements persist for other clients.

The server does not queue audio extraction during feed creation, refresh, or episode enrichment. Audio extraction is user-triggered through `POST /api/youtube/episodes/:id/extract` or an RSS client requesting `/media/youtube/:episodeId.mp3`. The server runs yt-dlp, stores the MP3 under the media data directory, marks the stored synthetic feed episode ready, and then serves that stable enclosure URL like a normal podcast media URL. If the file has not been cached yet, the server returns a processing response while the download is in progress. Downloaded files on client devices and native file paths remain device-local after a client chooses to download an episode.

## Silence maps

`POST /api/audio/silence-maps` and `GET /api/audio/silence-maps/:id` require `Authorization: Bearer <token>`.

The server uses ffmpeg `silencedetect` and server env defaults to create map segments. Defaults are `SILENCE_THRESHOLD_DB=-42`, `SILENCE_MINIMUM_SEC=0.7`, `SILENCE_RETAINED_SEC=0.25`, and `SILENCE_ANALYZER_VERSION=v1`. Segments shorten long silences by keeping the retained portion and skipping the rest.

## Smart Skip

`POST /api/smart-skip/process`, `GET /api/smart-skip/jobs/:id`, and `GET /api/smart-skip/episodes/:episodeId/segment-map` require `Authorization: Bearer <token>` by default.

The server stores media versions, transcripts, segment maps, segments, jobs, and external batch task metadata in local Postgres when `DATABASE_URL` is configured. Existing databases should apply `infra/postgres/migrations/20260601_smart_skip_v1.sql` before enabling Smart Skip. If no database is configured, the server keeps an in-memory fallback for local development only. Worker services are configured with `SMART_SKIP_WHISPER_BASE_URL` and `SMART_SKIP_SEGMENTER_BASE_URL`; local compose mocks validate integration only, while production needs real Whisper and a real segmenter endpoint. `SMART_SKIP_WHISPER_FORMAT=contract` calls the repo JSON `/v1/transcribe` worker contract, while `SMART_SKIP_WHISPER_FORMAT=openai` calls multipart `/v1/audio/transcriptions` for OpenAI-compatible Whisper servers. This iteration's segmenter backend is `openai_batch`: pending batches are stored in `smart_skip_external_tasks`, jobs are released with `stage='waiting-for-segment-batch'`, and `next_attempt_at` controls the next poll, defaulting to 12 hours. The authenticated `POST /api/smart-skip/process-now` route is a QA hook that uses the same request body as `/api/smart-skip/process` but forces immediate segmenting without submitting an OpenAI Batch job.

For scripted QA, the server can also accept `SERVER_API_TOKEN` as a bearer token. This token is server-only and must not be shipped in browser or Tauri bundles.

Per-show Smart Skip preference overrides sync through `podcast_preferences` as nullable booleans. `NULL` means "use the global app setting"; true or false is an explicit show override. The synced Smart Skip categories are sponsors/ads, self-promo, intros, outros, silence, and include-soft-matches. Existing databases should apply `infra/postgres/migrations/20260602_smart_skip_preferences.sql` to sync these overrides.

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
- Local preview origins such as `localhost:4173` are app origins, not auth server URLs; GitHub sign-in should target the configured app server, normally `localhost:8787` in local development.
- The Settings server URL input is a draft field. Blur, Enter, or Test server commits it; bare non-local domains normalize to HTTPS.
- Tauri GitHub sign-in opens the system browser through the native opener plugin so passkeys/WebAuthn can use the platform browser. The app receives the completed session through the registered `elephant-pod://auth/callback` deep-link scheme.

## Remaining sync hardening

- Add paginated incremental pulls by cursor.
- Add mutation-log table and server revisions.
- Add per-field settings merge instead of blob merge.
- Add queue-specific merge rules for multi-device concurrent reordering.
- Add integration tests with two simulated devices.

## Validation notes

- Tauri/native runtime should function in local-only mode with `serverUrl` unset or unreachable:
  - RSS feed import, playback queue, OPML import/export, and backups remain usable.
- The profile button should still open in local-only mode and show a login/setup action instead of becoming a dead end.
- Browser/web runtime should show the sign-in gate until a valid server session is present.
- When `serverUrl` is reachable:
  - `GET /api/health` should return `{ "ok": true }`.
  - A valid bearer token should return authenticated sync responses.
  - A missing or invalid token should keep sync/search disabled and return auth-related errors.
- Local Postgres should contain the sync tables listed above and the server should refuse sync with a clear 503 if `DATABASE_URL` is unset.
