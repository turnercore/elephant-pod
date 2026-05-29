# Feature Matrix

| Feature | V2 Status | Notes |
|---|---:|---|
| Resume rewind | Implemented | Rewinds by configured seconds when resuming. |
| Sleep timer | Implemented | Footer player control. |
| Chapters | Implemented UI | Parses demo/RSS-derived chapters where present; broader Podcasting 2.0 ingestion remains future work. |
| Playback speed | Implemented | Web playbackRate; native command boundary exists. |
| Skip controls | Implemented | Configurable 10/15/30/60s. |
| Play/Pause | Implemented | Web fallback; native command bridge scaffolded. |
| Mark played/unplayed | Implemented | Local state and sync schema. |
| Playback history | Implemented | `lastPlayedAt` records starts/resumes separately from completion so History can show recently played episodes in order. |
| Rendered clips/public links | Implemented server path | ffmpeg renders MP3 clips; fallback to source time-range links. |
| Auto-download | Partial native-ready | Queued auto-download is on by default in Tauri/native builds. Browser auto-download only attempts same-origin media; manual browser downloads can still try Cache Storage where hosts allow CORS. |
| Episode triage | Implemented | Inbox -> queue/dismiss/archive. |
| Silence shortening | Server-map partial | Signed-in server ffmpeg analysis creates silence maps. Long silences are shortened to a retained duration; browser Web Audio analysis is disabled for remote podcast streams. |
| Smart Skip V1 | Partial | Signed-in server route, storage, worker contract, UI settings, auto-skip, undo, and pure tests exist. Real Whisper/Codex workers and proactive active-user discovery are deployment follow-ups. |
| Listening stats | Implemented local | Tracks real listening time, per-podcast totals, speed-up savings, and silence-skip savings in local profile stats. |
| RSS-first/no lock-in | Implemented | Add RSS URL, OPML import/export, JSON backup. |
| Episode artwork | Implemented | RSS item-level `<itunes:image>` and `media:thumbnail` artwork is preserved; episode views fall back to show artwork when item art is absent. |
| Search (local catalog) | Implemented | Local search over on-device titles/show/description without account. |
| Search (PodcastIndex discovery) | Logged-in only | Server-mediated discovery for new feeds using PodcastIndex credentials. |
| Browser/web runtime sign-in gate | Implemented | Non-Tauri browser builds require a valid server GitHub session before app use. |
| Tauri/native local-only runtime | Implemented | Native builds can run without server connection or sign-in and keep local/native storage behavior. |
| Offline downloads/streaming | Partial native-ready | Streaming works; native filesystem commands are present but need Tauri/mobile validation. |
| Played/unplayed tracking | Implemented | Filter and sync schema. |
| Mark all as played in show | Implemented | Library action. |
| Sorting newest/oldest | Implemented | Library filters plus configurable Inbox newest/oldest triage ordering. |
| Bidirectional server sync | Implemented prototype | Pull/merge/push Supabase flow; needs incremental cursor/mutation-log hardening. |
| Auto refresh feeds | Implemented basic | Timer in app; server cron planned. |
| Wi-Fi-only download | Partial | Browser Network Information API where available; native OS constraints still needed. |
| Player queue manager | Implemented | Bottom player opens into a full-screen queue surface with transport controls, drag reorder, play now/next/end, send to Inbox, remove, and mark played actions. |
| Auto play next | Implemented | Plays next queued episode after end. |
| Auto-delete after listen | Implemented | Enabled by default. Non-favorite downloads are deleted when the episode is no longer queued or inboxed; manual downloads are retained while active. |
| Storage cap/prioritized prune | Partial native-ready | App prunes by priority: favorites, queue top-to-bottom, then inbox top-to-bottom. |
| Screen reader support | Implemented baseline | Labels, focus states, semantic regions. Needs audit. |
| Tauri mobile native audio | Scaffolded | Swift/Kotlin implementation shape and command contract; not device-validated. |
| Self-hosted Supabase bundle | Included | `infra/supabase/docker-compose.yml` plus schema and app service. |
