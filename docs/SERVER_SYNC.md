# Native Sync And Server Services

DaisyPod is now an iOS-first app. Personal podcast state is local-first in native SQLite and targets iCloud/CloudKit private-database sync. The app server is no longer the product login or personal sync authority.

## Local And iCloud State

The native app must remain useful offline. Playback, subscriptions, Library, Inbox, Queue, History, downloads, settings, OPML import/export, and JSON backup/restore work from the local store without a server.

CloudKit is the target cross-device sync layer for personal state:

- podcasts and episodes
- episode state, including played/progress/Inbox/Queue/favorite
- podcast preferences
- local clip metadata
- silence maps, Smart Skip maps, and transcripts that make ready server intelligence work offline
- tombstones
- idempotent local action records used for conflict-safe replay
- portable settings

Device-local data is not synced:

- native file paths
- downloaded media/artwork files
- download byte counts and download backend metadata
- sleep timer deadlines
- offline-mode browsing state
- listening analytics
- server URL
- native app tokens

`CloudKitPersonalSyncEngine` prepares deterministic private-record snapshots from the portable backup shape, strips device-local fields before upload, downloads CloudKit private-zone changes with a persisted server change token, merges newer local and remote records by `modifiedAt`, protects actively playing episode state during restore, and uses a private CloudKit zone when an iCloud account is available.

## Server Role

The server remains a processing and discovery boundary:

- `GET /api/health`
- `GET /api/capabilities`
- `GET /api/rss/parse`
- PodcastIndex search/browse
- YouTube source import, refresh, metadata enrichment, fake RSS feeds, and audio extraction
- public clip publishing and rendered clip files
- silence maps
- Smart Skip processing and segment-map cache
- static media serving for generated server artifacts

The server no longer exposes product auth routes or `/api/sync` from the app runtime. Personal sync should not require the server.

## Native Service Access

Native processing routes accept app-origin requests through service headers:

- `x-daisypod-client: ios`
- `x-daisypod-native-account: icloud`
- `x-daisypod-app-token: <token>` when `SERVER_NATIVE_APP_TOKEN` is configured

Build private iOS installs with `DAISYPOD_NATIVE_APP_TOKEN=...` matching the server's `SERVER_NATIVE_APP_TOKEN=...`.

This is a practical random-internet filter for a private app/server deployment. It is not marketplace-grade anti-tamper. Add App Attest or a stronger Apple-token verification path before exposing abuse-sensitive processing broadly.

Protected processing/discovery routes no longer accept product-login bearer tokens. Native service access requires the iOS service headers, and requires `SERVER_NATIVE_APP_TOKEN` when that token is configured. Local CloudKit account status is used for personal iCloud sync, not as the app-side gate for PodcastIndex, YouTube, clips, silence maps, or Smart Skip.

## Capabilities

`GET /api/capabilities` is the native feature contract. It reports whether server-backed features are enabled:

```json
{
  "youtubeImport": { "enabled": true },
  "podcastIndex": { "enabled": true },
  "clips": { "enabled": true },
  "silenceMaps": { "enabled": true },
  "smartSkip": { "enabled": false }
}
```

The capabilities payload must not expose PodcastIndex keys, database secrets, filesystem paths, worker URLs, native app tokens, or other private server configuration.

## Offline Behavior

When offline or when the server is unavailable, the app continues normal local use. Server-powered actions should fail locally with clear status text and leave existing local data intact. Cached ready silence maps and Smart Skip maps can still be displayed or used during playback according to local settings.

Queue and Inbox are listening-intent signals. Native iOS should ask the server to process Smart Skip and silence-map metadata for queued or inboxed episodes when the backend is available, then keep the ready maps and transcripts locally and in CloudKit personal sync. Downloaded audio files remain device-local; the derived metadata is portable.
