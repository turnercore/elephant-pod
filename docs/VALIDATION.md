# Validation

This v2 pass was checked in the sandbox on 2026-05-27.

Commands run successfully:

```bash
npm install --ignore-scripts
npm run typecheck
npm run test
npm run build
npx tsc -p src-tauri/plugins/tauri-plugin-elephant-audio/guest-js/tsconfig.json
ffmpeg -version
```

Server smoke check run successfully:

```bash
PORT=8899 WEB_DIST=apps/web/dist node apps/server/dist/index.js
curl -s http://localhost:8899/api/health
```

Results:

- Web TypeScript check: passed.
- Server TypeScript check: passed.
- Vite production build: passed.
- Server TypeScript build: passed.
- Local Tauri audio plugin guest JS TypeScript build: passed.
- Server health endpoint: passed and returned JSON.
- Smart Skip pure server/web tests: passed.
- ffmpeg binary: present in the sandbox (`ffmpeg version 7.1.3`).

Warnings/notes:

- Vite reports one chunk over 500 kB after minification. This is acceptable for the current prototype; future work should split vendor and app chunks.
- `cargo check` was attempted but could not run because Cargo/Rust was not installed in the sandbox.
- Docker and the self-hosted Supabase stack were not run in the sandbox. The Compose/YAML files were parsed successfully with PyYAML.
- iOS/Android native audio plugin code was added as source scaffolding, but generated mobile projects and physical-device background playback were not validated here.
- ffmpeg endpoints were added and compile, and the server detected the ffmpeg binary; actual render jobs against live podcast media were not executed in the sandbox.

Smart Skip local mock check:

```bash
cd infra
SMART_SKIP_ENABLED=true docker compose --profile smart-skip up --build
```

Then sign in to the app server, queue a test episode, and confirm `POST /api/smart-skip/process` requires a bearer token. Local/offline Tauri mode should not show Smart Skip controls and should continue normal playback.
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
`SMART_SKIP_SEGMENTER_BATCH_CHECK_INTERVAL_HOURS` hours, defaulting to `12`.

Existing databases should be migrated before real Smart Skip testing:

```bash
psql "$DATABASE_URL" -f infra/postgres/migrations/20260601_smart_skip_v1.sql
```
