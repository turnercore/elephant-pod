# Architecture

DaisyPod is now a native iOS app plus an Express backend. The retired React/Tauri frontend has been removed from the supported runtime repository.

```text
Native SwiftUI iOS app
  - local-first app state
  - SQLite persistence with explicit schema versioning
  - AVPlayer/AVAudioSession playback
  - native downloads, background audio, Now Playing controls
  - server URL configuration for optional backend services
  - CloudKit private-database sync target for personal state

Express app server
  - RSS fetch/parse proxy
  - PodcastIndex mediation
  - public clip pages and rendered media
  - YouTube source metadata and audio extraction
  - silence maps and Smart Skip processing
  - health and capability contracts
  - native service gate for private iOS deployments

CloudKit personal sync
  - target private-database sync for podcasts, episodes, queue, Inbox,
    preferences, clips, tombstones, settings, silence maps, Smart Skip maps,
    and transcripts
  - implemented as deterministic private-zone records with live CloudKit
    upload/download and persisted per-zone change tokens for incremental fetches
  - never syncs native file paths, downloads, tokens, sleep timers, offline
    mode, or listening stats
```

## Local-First Model

The iOS app writes to SQLite first. Playback, subscriptions, Inbox, Queue, downloads, settings, OPML, JSON backup/restore, and local browsing must work without sign-in or server access.

The server is additive. If a server URL is configured and backend capabilities allow a feature, the iOS app can request server-owned work such as PodcastIndex discovery, YouTube import, clips, silence maps, or Smart Skip. The app has no user-facing server-login state.

Local collections include:

- `feeds`
- `episodes`
- `states`
- `podcastPreferences`
- `clips`
- `settings`
- `syncActions`
- `tombstones`
- `listeningStats`
- silence-map and Smart Skip caches

The queue is represented by `EpisodeState.queuePosition`. Starting playback with Play inserts the episode at the head of the queue; Play Next inserts after the current first queue item; Add Last appends. Playback history uses `lastPlayedAt`, while `playedAt` remains the completion/mark-played timestamp.

Inbox triage is explicit:

- Play starts the episode.
- Queue adds it next.
- Add Last appends it.
- Mark Played removes it from Inbox and marks played.
- Dismiss removes it from Inbox. If Inbox auto-download is enabled and the episode had an Inbox-sourced download, the app deletes that download while preserving manual downloads.

Downloads are device-local. The app stores native paths only in local SQLite, strips them from sync/export payloads, and verifies that a file exists before using it for playback.

## Native iOS Model

Core native files:

- `LocalStore.swift`: SQLite object store and typed repository operations.
- `AppModel.swift`: app coordination, local-first workflows, background maintenance, backend feature gates.
- `Views.swift`: SwiftUI shell, navigation, list surfaces, player, detail views, settings.
- `NativeAudioEngine.swift`: AVPlayer playback and system media integration.
- `NativeDownloadManager.swift`: app-container media and artwork downloads.
- `BackendClient.swift`: server contracts for RSS, capabilities, PodcastIndex, YouTube, clips, silence maps, and Smart Skip.
- `CloudKitPersonalSyncEngine.swift`: CloudKit private-record boundary with incremental private-zone downloads.
- `DataPortability.swift`: OPML and JSON backup codecs.

The iOS app fetches `/api/capabilities` from the configured backend and uses the response as the feature contract. Older servers that omit newer capability fields are treated as available so route-level failures remain graceful during upgrades.

## Server Model

The backend is optional for ordinary playback and library management, but required for:

- PodcastIndex search,
- YouTube source import and audio extraction,
- public clip publishing,
- silence maps,
- Smart Skip processing,
- health/capability checks.

Native service requests include iOS service headers. PodcastIndex search and browse stop at that lightweight native gate so normal device installs can discover shows. Protected processing and publishing routes such as YouTube import, clips, silence maps, and Smart Skip require a backend session issued after Sign in with Apple. The server verifies Apple's identity JWT, links the stable Apple subject to a backend account, stores only a hash of the app session token, and the iOS app stores the session token in Keychain. CloudKit account status remains separate from backend allowance; public distribution may add App Attest on top of Apple Sign In.

The server does not own personal sync. It should receive only the payload needed for a server feature, such as an episode media URL or source URL.

## Sync Model

```text
local SQLite write -> prepare CloudKit private records -> CloudKit propagates
personal state between Apple devices -> clients merge back into SQLite
```

Current implementation:

- `CloudKitPersonalSyncEngine` exports deterministic private-record payloads.
- Device-local fields are stripped.
- Silence maps, Smart Skip maps, and transcripts are included so offline playback behavior can follow the episode.
- `LiveCloudKitPersonalSyncStore` persists a private-zone server change token and uses CloudKit zone changes for incremental downloads, falling back to a fresh zone fetch when CloudKit expires the token.

Still pending:

- broader conflict replay validation,
- two-device physical validation.

Target conflict rules:

- Last writer wins by `updated_at` at row level.
- Downloads never sync.
- Tombstones propagate deletes.

## Deployment Shape

The server image is backend-only. It does not build or serve a web frontend. Superzima pulls the Forgejo registry images and runs the app server plus optional Smart Skip services through Compose.
