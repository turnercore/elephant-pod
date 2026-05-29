# Agents.md

Repo-specific entry point for agents working on Elephant Pod.

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

## First files to read

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/FEATURE_MATRIX.md`
4. `docs/SERVER_SYNC.md`
5. `docs/AUDIO_ENGINE.md`
6. `docs/MOBILE_TAURI_NOTES.md`
7. `docs/ACCESSIBILITY.md`
8. `infra/supabase/schema.sql`
9. `infra/supabase/README.md`

## Project boundaries

### `apps/web`

The product UI and local-first application logic. Uses React, TypeScript, Tailwind, Dexie/IndexedDB, shadcn-style components, and lucide icons.

Do not put trusted server secrets here. `VITE_*` variables are public.

### `apps/server`

RSS proxying, clip-link publishing, ffmpeg rendering, static app hosting, and future background jobs. It may use service-role Supabase credentials, but those credentials must never cross into the browser bundle.

### `src-tauri`

Native wrapper. Contains native filesystem download commands, audio shim commands, and mobile audio plugin scaffolds.

### `infra/supabase`

SQL schema, RLS policies, and a local Supabase-style Docker stack.

## Required validation before handing off

At minimum, run:

```bash
npm install
npm run typecheck
npm run build
```

For server changes:

```bash
PORT=8899 WEB_DIST=apps/web/dist node apps/server/dist/index.js
curl http://localhost:8899/api/health
```

For Tauri changes, also run where Rust is available:

```bash
cd src-tauri
cargo check
cd ..
npm run tauri:dev
```

For UI changes, manually check:

- Keyboard navigation through the sidebar, queue, player, and settings.
- Screen-reader names for icon buttons.
- Local-only mode with no `.env` Supabase keys.
- Refresh/import/export paths.
- Player state after reload.
- Native download fallback path in a Tauri build.
- Public clip creation with and without ffmpeg available.
- Sync from device A → server → device B, then reverse direction.

## High-priority future tasks

1. Compile and validate the mobile audio plugin in generated Tauri iOS/Android projects.
2. Add native queue end-callbacks so autoplay-next works fully in native mode.
3. Add mutation-log sync for stronger conflict handling.
4. Move clip/silence rendering to a durable queue for large deployments.
5. Add feed refresh worker/cron on the server.
6. Add Podcasting 2.0 transcript/chapter ingestion.
7. Add Playwright tests and mobile smoke tests.
