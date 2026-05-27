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
| Rendered clips/public links | Implemented server path | ffmpeg renders MP3 clips; fallback to source time-range links. |
| Auto-download | Partial native-ready | Browser Cache Storage fallback plus Tauri filesystem download commands. |
| Episode triage | Implemented | Inbox -> queue/dismiss/archive. |
| Silence shortening | Multi-path partial | Web Audio fallback and server ffmpeg jobs; native DSP reserved. |
| RSS-first/no lock-in | Implemented | Add RSS URL, OPML import/export, JSON backup. |
| Search (local catalog) | Implemented | Local search over on-device titles/show/description without account. |
| Search (PodcastIndex discovery) | Logged-in only | Server-mediated discovery for new feeds using PodcastIndex credentials. |
| Offline downloads/streaming | Partial native-ready | Streaming works; native filesystem commands are present but need Tauri/mobile validation. |
| Played/unplayed tracking | Implemented | Filter and sync schema. |
| Mark all as played in show | Implemented | Library action. |
| Sorting newest/oldest | Implemented | Library filters. |
| Bidirectional server sync | Implemented prototype | Pull/merge/push Supabase flow; needs incremental cursor/mutation-log hardening. |
| Auto refresh feeds | Implemented basic | Timer in app; server cron planned. |
| Wi-Fi-only download | Partial | Browser Network Information API where available; native OS constraints still needed. |
| Obvious queue | Implemented | Dedicated queue page and player next control. |
| Auto play next | Implemented | Plays next queued episode after end. |
| Auto-delete after listen | Partial | State path exists; native deletion command available. Needs full automation test. |
| Storage cap/delete oldest | Partial native-ready | Rust prune command exists; app calls it when cap changes. |
| Screen reader support | Implemented baseline | Labels, focus states, semantic regions. Needs audit. |
| Tauri mobile native audio | Scaffolded | Swift/Kotlin implementation shape and command contract; not device-validated. |
| Self-hosted Supabase bundle | Included | `infra/supabase/docker-compose.yml` plus schema and app service. |
