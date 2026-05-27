# Roadmap

## V2 hardening

- Compile and fix the Rust/Tauri shell with a local Rust toolchain.
- Generate the real Tauri mobile plugin package and wire Swift/Kotlin command handlers.
- Validate iOS background playback, lock-screen controls, interruptions, and route changes on device.
- Validate Android foreground media service, notifications, media session, and Bluetooth/noisy-audio handling on device.
- Add Playwright smoke tests.
- Add mocked RSS fixtures.
- Add two-device sync integration tests.
- Add storage-cap automation tests.

## V3 production podcast features

- Native DSP silence shortening.
- Background clip render queue instead of request-time rendering.
- Podcasting 2.0 chapters/transcripts/funding/person tags.
- Smart playlists and per-podcast priorities.
- Per-podcast intro/outro skip.
- Private feed credential vault.
- Full-text search over transcripts/show notes.
- Web push/new episode notifications.
- CarPlay/Android Auto exploration after core mobile playback is solid.
