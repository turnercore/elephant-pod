# V2 Pass Notes

This pass targeted the major production-facing gaps from the first scaffold.

## Added or upgraded

- Tauri/Rust download command layer for app-local podcast files.
- Native download bridge in the web app with browser Cache Storage fallback.
- Storage stats and delete-oldest pruning path for native downloads.
- Local `tauri-plugin-elephant-audio` scaffold registered in the Tauri shell, with desktop-safe fallback behavior.
- Swift and Kotlin source references for future AVPlayer/Media3 mobile plugin packaging.
- ffmpeg clip rendering on the Express server.
- Public clip pages that prefer rendered MP3 files and fall back to source time-range links.
- Server ffmpeg endpoint for silence-shortened audio files.
- Server/native silence-shortening settings. Browser Web Audio analysis is not used for remote podcast playback because CDN CORS behavior can make media output silence.
- Bidirectional Supabase sync cycle: pull, merge, push, settings sync, and tombstones.
- Self-hosted Supabase-style Docker bundle under `infra/supabase`, plus an official-distribution bootstrap helper.
- Updated docs, env file, validation notes, and agent guidance.

## Explicitly not finished

- iOS/Android generated mobile projects still need final plugin wiring.
- iOS/Android device testing was not possible in the sandbox.
- `cargo check` was not possible because Rust/Cargo was not installed in the sandbox.
- Docker and the Supabase stack were not run in the sandbox.
- Full mutation-log/CRDT sync remains future hardening beyond the row-level latest-update merge now implemented.
