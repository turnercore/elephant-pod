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

`src-tauri/src/downloads.rs` implements app-data file downloads for Tauri builds. `src-tauri/src/media_session.rs` is a desktop-safe shim; `src-tauri/plugins/tauri-plugin-elephant-audio` is the local plugin package scaffold that should own AVPlayer/Media3 playback in mobile builds, with reference implementations under `src-tauri/mobile`.

## 3. Server ffmpeg processing

`apps/server/src/mediaJobs.ts` implements:

- rendered MP3 clip files for public sharing
- cached silence-shortened MP3 jobs
- signed-in silence-map analysis jobs
- nondestructive silence-map analysis reused by Smart Skip boundary refinement

Clip rendering uses `ffmpeg -ss`, `-t`, `-vn`, and MP3 output. Silence maps use ffmpeg's `silencedetect` filter and cache JSON under the media directory. A segment shortens long silence rather than deleting it: by default a silence over `0.7s` keeps `0.25s` and skips the rest. These defaults are controlled by `SILENCE_THRESHOLD_DB`, `SILENCE_MINIMUM_SEC`, `SILENCE_RETAINED_SEC`, and `SILENCE_ANALYZER_VERSION`.

## Silence shortening

The app exposes silence shortening as an on/off preference, not a user-selected engine mode. Runtime resolution is automatic:

- Signed-in server builds can request cached ffmpeg `silencedetect` maps and use them when ready.
- Native builds do not analyze silence locally in this pass; native audio remains focused on platform media playback.
- Web playback does not run low-RMS Web Audio analysis on the primary audio element because cross-origin podcast audio can be silenced by browser CORS protections.

Playback telemetry records real listening time, content time heard, estimated speed-up savings, and estimated silence-skip savings in local profile stats.

## Smart Skip V1

Smart Skip is a signed-in server feature. The client never runs browser-side audio analysis for remote podcast streams and does not attempt Smart Skip in local/offline mode.

The server routes are:

- `POST /api/smart-skip/process`
- `GET /api/smart-skip/jobs/:id`
- `GET /api/smart-skip/episodes/:episodeId/segment-map`

Processing always follows the same V1 path: ffmpeg silence boundaries, a Whisper-compatible `/v1/transcribe` service, an OpenAI-backed `/v1/segment` service, deterministic boundary refinement, and SegmentMap storage. The local compose workers are integration mocks unless `MOCK_SEGMENTER=false` and `OPENAI_API_KEY` are set; production needs real Whisper and segmenter endpoints. Playback still goes through `useAudioController.seek`; Smart Skip does not create a second audio engine.

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
