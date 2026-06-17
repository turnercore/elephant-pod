# Validation

The native iOS/server migration pass is validated with root scripts that target the supported product surface: the SwiftUI iPhone app plus the backend server.

Commands run successfully:

```bash
npm --workspace @daisy-pod/server run typecheck
npm --workspace @daisy-pod/server run test
npm --workspace @daisy-pod/server run build
npm run typecheck
npm run test
npm run build
```

There is no supported live backend sync validation command anymore. Personal sync validation belongs to CloudKit and physical Apple devices.

The root commands do the following:

- `npm run typecheck`: server typecheck plus iPhone 13 mini simulator build.
- `npm run test`: server tests plus iPhone 13 mini iOS unit/UI tests.
- `npm run build`: server build plus iPhone 13 mini simulator build.

XcodeBuildMCP simulator check run successfully:

```text
session_show_defaults
build_run_sim
screenshot
```

Result: the `DaisyPod` scheme built, installed, and launched on the configured iPhone 13 mini simulator with bundle id `com.elephanthand.daisypod`; the screenshot showed the native Inbox and bottom player.

Current physical iPhone/iPad install check:

```bash
xcrun devicectl list devices
xcrun xctrace list devices
DAISYPOD_DEVELOPMENT_TEAM=BWDKW435B4 \
IOS_DEVICE_UDID=00008110-001959E22178801E \
IOS_COREDEVICE_ID=26975EF1-D3E3-53AE-8AC5-D581B8AADC89 \
npm run ios:install:device
```

Result:

- iPhone 13 mini is connected to CoreDevice and Xcode: device UDID `00008110-001959E22178801E`, CoreDevice id `26975EF1-D3E3-53AE-8AC5-D581B8AADC89`.
- iPad mini is paired but offline to xctrace: device UDID `00008130-00066DAC1091401C`, CoreDevice id `61B3A04C-C6FD-59F2-AF99-7513B2F169AB`.

The iPhone build reaches provisioning and fails while the Apple Developer
membership is expired/inactive in the Apple Developer account:

```text
No Account for Team "BWDKW435B4". Add a new account in Accounts settings or verify that your accounts have valid credentials.
No profiles for 'com.elephanthand.daisypod' were found: Xcode couldn't find any iOS App Development provisioning profiles matching 'com.elephanthand.daisypod'.
Personal development teams, including "Turner Monroe", do not support the iCloud capability.
```

This must be resolved by renewing/activating the Apple Developer Program
membership, refreshing Xcode Accounts, and provisioning the `com.elephanthand.daisypod`
App ID with the `iCloud.com.elephanthand.daisypod` CloudKit container before
CloudKit physical-device validation can pass.

Server smoke check:

```bash
PORT=8899 node apps/server/dist/index.js
curl -s http://localhost:8899/api/health
```

Results:

- Server TypeScript check: passed.
- Server tests: passed for the active server surface, including auth/native service gate behavior, capabilities, Smart Skip, RSS parsing, and media-processing contracts.
- Server capabilities tests: passed, including the native `/api/capabilities` shape for YouTube import, PodcastIndex, clips, silence maps, and Smart Skip, plus a guard that the response does not expose API key names.
- Server TypeScript build: passed.
- iOS unit tests: passed on iPhone 13 mini simulator, including native URL-scheme routing for add/open/playback/sync handoff, native chapter seek/progress persistence, local clip saving without a server, capability-disabled local clip publishing fallback, server capability gates that short-circuit PodcastIndex/YouTube/silence-map/Smart Skip actions, CloudKit personal-sync record preparation, OPML import through the same injectable RSS importer used by Add/refresh, fixture-backed RSS refresh merge behavior, automatic feed refresh selection for due library feeds, and current-player state refresh after local favorite changes.
- iOS UI tests: passed on iPhone 13 mini simulator, including Add YouTube mode, native `daisypod://add?url=...` handoff into the Add field, Settings backend/data diagnostics for pending local changes and local snapshot counts, Settings feed-refresh interval control, visible episode row triage actions moving an episode from Inbox to Queue and back, podcast-detail per-show playback controls, episode-detail chapter/clip/server-intelligence controls, local clip saving from the composer, Offline Mode persistence with Library/Downloads filtering, expanded-player favorite, and sleep-timer controls.
- iOS App Intents metadata export: passed as part of the iPhone 13 mini simulator build.
- iOS simulator build/run: passed through XcodeBuildMCP.
- iOS physical-device build/install: currently blocked by expired/inactive Apple Developer membership and missing Xcode account/provisioning profile for team `BWDKW435B4`.
- CloudKit personal-sync tests: passed on iPhone 13 mini simulator, including deterministic portable personal record snapshots, stripping device-local settings/download fields, excluding listening stats, preserving sync actions, including silence maps/Smart Skip maps/transcripts for offline playback behavior, upload through the `PersonalSyncing` boundary, remote-newer snapshot merge into SQLite, local-newer protection over stale remote records, active playback episode-state protection when a newer remote state exists, current tombstone application, stale tombstone protection, preserving device files when tombstoned rows are removed, and per-zone CloudKit change-token persistence.
- Server health endpoint: passed and returned JSON.
- Live Superzima backend deploy: passed. `forge.elephanthand.com/elephant-hand-games/daisy-pod-server:latest` was built from the current worktree and pushed; Superzima pulled it, removed the retired `elephant-pod` orphan container that held port `20001`, and now runs `daisy-pod` on `100.92.133.126:20001` / `https://pod.elephanthand.com`.
- Live `/api/health`: passed through Superzima local port and the public proxy. The response reported service `daisypod`, ffmpeg available, server job limiter status, and Smart Skip enabled.
- Live `/api/capabilities`: passed through Superzima local port and the public proxy. The response reported YouTube import, PodcastIndex, clips, silence maps, and Smart Skip enabled.
- Live native service gate: passed. A random public PodcastIndex request returned `401`, a native-looking request without the private app token returned `401`, and a token-backed native request from Superzima returned `200` with real PodcastIndex results.
- Smart Skip pure server tests: passed.
- RSS parser contract tests cover native-safe inline chapter payloads from Podcasting 2.0 and Podlove RSS tags, backend-resolved external Podcasting 2.0 chapter JSON, and graceful import when optional external chapter metadata is unavailable.

Warnings/notes:

- Physical iPhone validation is still required for lock-screen metadata, Control Center, AirPods/Bluetooth, interruptions, route changes, cellular/Wi-Fi transitions, deep-link auth, app relaunch, and system-scheduled background download/playback behavior.
- CloudKit account status is linked and calls `accountStatus` on the explicit `iCloud.com.elephanthand.daisypod` container. Physical-device provisioning validation is still required with an online device.
- Live CloudKit two-device validation is still required against physical Apple devices using the change-token optimized incremental sync path.
- Docker Compose backend/Postgres flows are not covered by the root validation commands.
- The retired React/Tauri frontend is no longer part of validation or the runtime repository.

Smart Skip local mock check:

```bash
cd infra
SMART_SKIP_ENABLED=true docker compose --profile smart-skip up --build
```

Then queue a test episode in the native app and confirm `POST /api/smart-skip/process` requires native service access when `SERVER_NATIVE_APP_TOKEN` is configured. Local/offline mode should not show Smart Skip as available and should continue normal playback.
This validates only the local integration contract because the compose workers default to mocks. Real Smart Skip processing requires production `SMART_SKIP_WHISPER_BASE_URL` and `SMART_SKIP_SEGMENTER_BASE_URL` endpoints.

Real segmenter check:

```bash
cd infra
SMART_SKIP_ENABLED=true MOCK_SEGMENTER=false OPENAI_API_KEY=sk-... docker compose --profile smart-skip up --build openai-batch-segmenter
curl http://localhost:8002/health
```

Real episode processing submits segmenting through `/v1/segment-batches` by
default. The app server stores the returned batch ID in
`smart_skip_external_tasks`, sets the Smart Skip job to
`stage='waiting-for-segment-batch'`, and rechecks after
`SMART_SKIP_SEGMENTER_BATCH_CHECK_INTERVAL_MINUTES` minutes, defaulting to `720` (12 hours).

Existing databases should be migrated before real Smart Skip testing:

```bash
psql "$DATABASE_URL" -f infra/postgres/migrations/20260601_smart_skip_v1.sql
```
