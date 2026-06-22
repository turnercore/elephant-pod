# Agents.md

## Operating principles

- Preserve local-first behavior. The app must be usable with no account and no server.
- Sync must be additive and recoverable. Never make the server required for playback, subscriptions, queueing, triage, or settings.
- Keep native iOS, server, worker, deployment, and local Postgres boundaries explicit.
- Update docs in the same change when behavior, commands, schemas, env variables, security assumptions, storage behavior, or sync contracts change.
- Do not bundle font files. Reference fonts via CSS or document where maintainers can place their licensed local copies.
- Keep icon-only controls accessible: every interactive icon needs `aria-label`, visible focus, keyboard operation, and non-color-only state.
- Favor boring data models. Podcast apps fail through edge cases, not lack of clever abstractions.
- Treat downloads as device-local. Do not sync native file paths between devices.
- Treat public clips as public. Do not add private-feed clip sharing without explicit privacy and rights checks.

## Documentation
Please read the following documentation as it relates to your task. Please keep documentation up to date as you work, and add new documentation as needed.

1. `README.md` - Readme with project overview, development setup, and contribution guidelines.
2. `docs/ARCHITECTURE.md` - High-level architecture overview, including data flow, sync contracts, and component boundaries.
3. `docs/FEATURE_MATRIX.md` - Feature matrix comparing Elephant Pod to other podcast apps and listing planned features.
4. `docs/SERVER_SYNC.md` - Documentation for server-side sync logic.
5. `docs/AUDIO_ENGINE.md` - Documentation for the audio engine implementation.
6. `docs/ICLOUD_SYNC_MIGRATION.md` - iCloud/CloudKit personal-sync migration notes and validation scope.
7. `docs/ACCESSIBILITY.md` - Accessibility guidelines and implementation details.
8. `docs/VALIDATION.md` - Current validation commands, results, and remaining physical-device checks.
9. `infra/postgres/init.sql` - Server-owned Postgres schema for clips, accounts, sessions, and Smart Skip data.

## Project boundaries

### `apps/ios`

The supported product UI and local-first application logic. Uses SwiftUI, SQLite, AVPlayer, CloudKit, App Intents, and native iOS storage.

Do not make server access required for local playback, subscriptions, downloads, queueing, triage, settings, OPML, or backups.

### `apps/server`

RSS proxying, PodcastIndex mediation, clip-link publishing, ffmpeg rendering, YouTube import, Smart Skip processing, health, and capabilities. Server secrets stay server-side.

### `apps/segmenter` and `workers/whisper`

Optional Smart Skip worker surfaces. Local compose can run mock workers; production must point at real processing endpoints.

### `infra/postgres`

Server-owned Postgres schema. Personal podcast sync belongs to native SQLite plus CloudKit private database records, not to the server database.
