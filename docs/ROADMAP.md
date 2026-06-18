# Roadmap

## V2 hardening

- Validate native iOS background playback, background download scheduling, lock-screen controls, interruptions, route changes, AirPods/Bluetooth, and cellular/Wi-Fi transitions on a physical iPhone.
- Continue adding XCUITest coverage for any remaining parity workflows that can be proven in Simulator. Current coverage includes visible Inbox/Queue row action triage, Offline Mode Library/Downloads filtering, Add/YouTube mode, native Add deep-link handoff, Library search, podcast and episode detail controls, clip composer, expanded player, and Settings.
- Add more feed refresh fixtures for unusual publisher changes. Native unit coverage now includes mocked RSS and Atom fixtures for artwork, enclosure, inline chapter metadata, local Inbox import behavior, and RSS refresh merge behavior that preserves device-local playback/download/queue state while adding new Inbox items.
- Validate live CloudKit two-device sync on physical Apple devices after provisioning, imports, incremental private-zone sync, and conflict replay are exercised on real devices.
- Harden CloudKit private-database sync for personal podcast state with more two-device conflict testing, following `docs/ICLOUD_SYNC_MIGRATION.md`; the old server `/api/sync` product path is retired.
- Add App Attest if this deployment needs stronger abuse controls on top of Sign in with Apple backend sessions.
- Add live storage-cap validation with real app-container pressure. Native unit coverage now verifies storage-cap pruning removes the lowest-priority backlog download before Inbox, Queue, and favorite downloads, and iOS background task scheduling now reuses the same maintenance path.
- Keep retired frontend references out of the runtime repo; the supported product surface is native iOS plus the backend server.

## V3 production podcast features

- Native DSP silence shortening if server-generated maps are not enough for offline-only workflows.
- Background clip render queue instead of request-time rendering.
- Podcasting 2.0 transcripts, funding, person tags, and richer native chapter presentation.
- Smart playlists and per-podcast priorities.
- Per-podcast intro/outro skip.
- Private feed credential vault.
- Full-text search over transcripts/show notes.
- Native iOS new-episode notifications.
- CarPlay exploration after core mobile playback is solid.
