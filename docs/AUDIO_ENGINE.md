# Audio Engine

Elephant Pod has three audio paths.

## 1. Web fallback

The shared React app uses one hidden HTML `<audio>` element. This path supports:

- play/pause
- seek
- configurable skip forward/back
- playback speed
- resume rewind
- sleep timer
- progress persistence
- autoplay next
- ended handling

The browser path intentionally does not attach a Web Audio analyser to the primary
audio element for remote podcast media. Many podcast CDNs either omit CORS headers
or return invalid duplicated CORS headers after redirects; routing those streams
through `MediaElementAudioSourceNode` can make playback output silence. Browser
silence shortening uses signed-in server-generated silence maps.

## 2. Tauri/native bridge

`apps/web/src/lib/native/tauriBridge.ts` exposes a stable command surface:

- `download_episode`
- `delete_downloaded_episode`
- `downloaded_episode_path`
- `download_storage_stats`
- `prune_downloads`
- `native_audio_prepare`
- `native_audio_set_playback_state`
- `native_audio_set_silence_shortening`
- `native_audio_clear_session`

`src-tauri/src/downloads.rs` implements app-data file downloads for Tauri builds. `src-tauri/src/media_session.rs` is a desktop-safe shim; `src-tauri/plugins/tauri-plugin-elephant-audio` is the local plugin package. iOS builds package the plugin's Swift AVPlayer implementation so the web audio controller can prepare, play, pause, seek, set rate, poll native status, and update lock-screen metadata through `MPNowPlayingInfoCenter`. Android Media3 playback ownership remains the next native step, with reference implementations under `src-tauri/mobile`.

When the app opens or finishes sync/login hydration, the first queued episode is cued as the current episode without starting playback. That keeps the player surface consistent with the queue and lets native mobile builds prepare paused Now Playing metadata. iOS Now Playing uses a frontend `now_playing` payload with the episode id, episode title, podcast title, duration, elapsed position, playback rate, play/pause state, and downloaded/remote artwork URL. The Swift plugin resolves artwork into `MPMediaItemArtwork` and refreshes `MPNowPlayingInfoCenter` after cue, play, pause, seek, rate, and periodic native status updates. The web audio fallback also publishes Media Session metadata and position state so iOS WebKit lock-screen playback shows the episode instead of the app name when the native plugin is not the active audio engine.

## 3. Server ffmpeg processing

`apps/server/src/mediaJobs.ts` implements:

- rendered MP3 clip files for public sharing
- cached silence-shortened MP3 jobs
- signed-in silence-map analysis jobs
- nondestructive silence-map analysis reused by Smart Skip boundary refinement

Clip rendering uses `ffmpeg -ss`, `-t`, `-vn`, and MP3 output. Silence maps use ffmpeg's `silencedetect` filter and cache JSON under the media directory. A segment shortens long silence rather than deleting it: by default a silence over `0.7s` keeps `0.25s` and skips the rest. These defaults are controlled by `SILENCE_THRESHOLD_DB`, `SILENCE_MINIMUM_SEC`, `SILENCE_RETAINED_SEC`, and `SILENCE_ANALYZER_VERSION`. ffmpeg jobs share the app-server subprocess limiter with YouTube `yt-dlp`; `SERVER_MAX_JOBS` defaults to `1`.

## Silence shortening

The app exposes silence shortening as an on/off preference, not a user-selected engine mode. Runtime resolution is automatic:

- Signed-in server builds can request cached ffmpeg `silencedetect` maps and use them when ready.
- Native builds do not analyze silence locally in this pass; native audio remains focused on platform media playback.
- Web playback does not run low-RMS Web Audio analysis on the primary audio element because cross-origin podcast audio can be silenced by browser CORS protections.

Playback telemetry records real listening time, content time heard, estimated speed-up savings, and estimated silence-skip savings in local profile stats.

## Smart Skip V1

Smart Skip is a signed-in server feature. The client never runs browser-side audio analysis for remote podcast streams and does not attempt Smart Skip in local/offline mode.

When global Smart Skip is enabled and the user is signed in to the app server, episodes in Inbox or Queue are proactively submitted to `/api/smart-skip/process`. `202 queued` responses are cached locally as queued/processing state so the client does not spam the server, then the app polls those eligible episodes for a ready segment map. Episode rows show a Smart Skip magic badge only after a ready map is cached; queued work may show a queued badge but does not affect playback.

The server routes are:

- `POST /api/smart-skip/process`
- `GET /api/smart-skip/jobs/:id`
- `GET /api/smart-skip/episodes/:episodeId/segment-map`

Processing always follows the same V1 path: ffmpeg silence boundaries, a Whisper-compatible `/v1/transcribe` service, a segmenter service, deterministic boundary refinement, and SegmentMap storage. In this iteration the segmenter backend is `openai_batch`; the app server only depends on the segmenter HTTP contract. The server records the external batch ID, releases the job with `next_attempt_at`, and later resumes refinement/storage after `/v1/segment-batches/:id` reports completion. The local compose workers are integration mocks unless `MOCK_SEGMENTER=false` and `OPENAI_API_KEY` are set; production needs real Whisper and segmenter endpoints. Playback still goes through `useAudioController.seek`; Smart Skip does not create a second audio engine.

Playback settings resolve from global app defaults first, then nullable per-show overrides. Per-show Smart Skip preferences can independently override enablement, sponsors/ads, self-promo, intros, outros, silence, and whether soft matches are included. `ad`, `sponsorship`, and `network_promo` segments all use the sponsors/ads toggle. `auto_skip` segments are skipped when their category is enabled. `soft_skip` segments are only skipped when "Include soft matches" is enabled; otherwise they remain labeled metadata and are not jumped automatically.

## iOS target behavior

- `AVAudioSession` playback category.
- Background audio mode.
- `AVPlayer` or queue player ownership outside the WebView.
- Lock-screen metadata.
- `MPRemoteCommandCenter` commands.
- Interruption and route-change handling.

## Android target behavior

- Media3/ExoPlayer.
- Foreground media playback service.
- Media session.
- Notification controls.
- Headset/Bluetooth/noisy-audio handling.
