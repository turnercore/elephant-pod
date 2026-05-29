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
silence shortening should use the server-rendered ffmpeg path when available.

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

Clip rendering uses `ffmpeg -ss`, `-t`, `-vn`, and MP3 output. Silence shortening uses ffmpeg's `silenceremove` filter and writes a cached MP3 file under the media directory.

## Silence shortening

The app exposes silence shortening as an on/off preference, not a user-selected engine mode. Runtime resolution is automatic:

- Native builds use the native audio bridge when available and pass silence-shortening options through that path.
- If a server is configured, the app can request a cached ffmpeg `silenceremove` render and use it when ready.
- Web playback does not run low-RMS Web Audio analysis on the primary audio element because cross-origin podcast audio can be silenced by browser CORS protections.

Playback telemetry records real listening time, content time heard, estimated speed-up savings, and estimated silence-skip savings in local profile stats.

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
