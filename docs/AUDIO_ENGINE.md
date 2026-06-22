# Audio Engine

DaisyPod's supported playback path is the native iOS engine in `apps/ios/Sources/DaisyPod/NativeAudioEngine.swift`.

## Native iOS Engine

The native engine owns:

- `AVPlayer` playback.
- `AVAudioSession.Category.playback` with spoken-audio mode.
- Background audio mode in the iOS target.
- Lock-screen metadata through `MPNowPlayingInfoCenter`.
- Play, pause, seek, skip, and position remote commands through `MPRemoteCommandCenter`.
- Interruption and route-change handling.
- App-container file playback for downloaded episodes.
- Effective per-show/global playback rate and skip settings.
- Playback progress persistence and listening-stat telemetry.
- Sleep timer support.
- Queue-ended autoplay handoff.
- Cached artwork for Now Playing metadata.
- Playback-time jumps over ready Smart Skip and silence-map ranges.

The compact bottom player opens into the native Now Playing queue sheet, where users can play/pause, skip, favorite, set the sleep timer, open episode/podcast detail, reorder Queue, play queued rows, send queued rows to Inbox, remove queued rows, and change played state.

## Downloads And Offline Playback

`NativeDownloadManager` writes episode media and cached artwork under the iOS app container. Download paths are device-local:

- Native file paths are never synced.
- Portable JSON backups strip native download fields.
- Playback verifies that a stored file still exists before using it.
- Missing files fall back to the remote episode URL.
- Wi-Fi-only settings mark remote media/artwork requests as not allowing expensive or constrained network access.

Foreground maintenance runs after launch and after local queue/triage/play-state changes. iOS background refresh and processing tasks reuse the same maintenance path when the system grants runtime. Maintenance reconciles stale file rows, downloads queued episodes first, optionally downloads Inbox episodes, prefetches artwork, deletes inactive non-favorite downloads, and prunes by storage cap.

## Server Media Processing

The backend server still owns expensive or public media processing:

- Rendered MP3 clip files for public clip links.
- Cached silence-map analysis jobs through ffmpeg.
- YouTube metadata and audio caching through yt-dlp.
- Smart Skip processing through ffmpeg silence boundaries, Whisper-compatible transcription, and the segmenter service.

`SERVER_MAX_JOBS` caps expensive app-server subprocess work such as ffmpeg and yt-dlp. Smart Skip also uses its durable queue and `SMART_SKIP_PROCESSING_CONCURRENCY`.

## Silence Shortening

The native app does not analyze remote audio locally in this pass. When enabled, it uses locally cached server-generated silence maps. If no ready map is cached, normal playback continues. Ready maps can be stored in SQLite and prepared for CloudKit personal sync so offline playback can retain the behavior on Apple devices.

## Smart Skip

Smart Skip is a server-processing feature requested by the iOS app when:

- the user has enabled Smart Skip,
- iCloud/Apple account state is available,
- backend capabilities report Smart Skip enabled,
- and the native service gate passes.

Queued or processing results are cached locally so the client does not spam the server. Ready segment maps and transcripts are stored locally, prepared for CloudKit personal sync, and used by `AVPlayer` seek jumps according to the user's category settings.

## Remaining Physical Validation

Simulator coverage proves build and UI behavior, but these need real-device validation:

- lock-screen artwork and controls,
- Control Center,
- AirPods/Bluetooth controls,
- interruption handling,
- route changes,
- cellular/Wi-Fi transitions,
- app relaunch while audio is active,
- background download/playback behavior.
