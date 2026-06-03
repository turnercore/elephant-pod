# Agents.md

## Operating principles

- Preserve local-first behavior. The app must be usable with no account and no server.
- Sync must be additive and recoverable. Never make Supabase required for playback, subscriptions, queueing, triage, or settings.
- Keep web, server, Tauri, native mobile, and Supabase boundaries explicit.
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
6. `docs/MOBILE_TAURI_NOTES.md` - Notes and guidelines for mobile development with Tauri.
7. `docs/ACCESSIBILITY.md` - Accessibility guidelines and implementation details.
8. `infra/supabase/schema.sql` - Database schema and sync contract documentation for Supabase.
9. `infra/supabase/README.md` - Setup instructions, environment variable documentation, and security guidelines for Supabase.

## Project boundaries

### `apps/web`

The product UI and local-first application logic. Uses React, TypeScript, Tailwind, Dexie/IndexedDB, shadcn-style components, and lucide icons.

Do not put trusted server secrets here. `VITE_*` variables are public.

### `apps/server`

RSS proxying, clip-link publishing, ffmpeg rendering, static app hosting, and future background jobs. It may use service-role Supabase credentials, but those credentials must never cross into the browser bundle.

### `src-tauri`

Native wrapper. Contains native filesystem download commands, audio shim commands, and mobile audio plugin scaffolds.

### `infra/supabase`
Superbase is only used for authentication while the local postgres database is the source of truth for sync and data.