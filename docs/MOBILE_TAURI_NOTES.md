# Mobile Tauri Notes

Tauri v2 can package iOS and Android apps, but a serious podcast app needs native audio and storage integration.

## Added native pieces

- `src-tauri/src/downloads.rs`: app-local file downloads, manifests, delete, storage stats, oldest-first pruning.
- `src-tauri/src/native_audio.rs`: app-level audio command shim used by desktop/web fallback.
- `src-tauri/plugins/tauri-plugin-elephant-audio`: local Tauri plugin registered by the app shell. iOS builds package its Swift AVPlayer implementation from `ios/Sources/ElephantAudioPlugin`.
- `src-tauri/mobile/ios/ElephantPodAudioPlugin.swift`: older AVAudioSession/AVPlayer/lock-screen command reference retained for comparison while the packaged plugin is validated.
- `src-tauri/mobile/android/.../ElephantPodAudioPlugin.kt`: Media3 MediaController/MediaSession implementation reference.
- `src-tauri/mobile/android/.../ElephantPodPlaybackService.kt`: MediaSessionService reference.

## Frontend command surface

```ts
nativePrepareAudio(metadata)
nativePlaybackState(state)
nativeClearAudioSession()
nativeSetSilenceShortening(options)
listenNativeMediaCommands(handler)
nativeDownloadEpisode(request)
nativeDeleteEpisode(episodeId)
nativeDownloadedUrl(episodeId)
nativeStorageStats()
nativePruneDownloads(maxBytes)
```

Native playback should use local filesystem URLs for downloaded episodes. The webview asset URL returned by `nativeDownloadedUrl` is for HTML media fallback; iOS AVPlayer should receive a `file://` URL from the stored native download path.

Desktop Tauri downloaded playback uses the HTML audio fallback, so it depends on Tauri v2's asset protocol. Keep `tauri/protocol-asset` enabled and keep `app.security.assetProtocol.scope` limited to `$APPDATA/downloads/**`; widening that scope would expose more local files to the WebView than the podcast player needs.

Native download manifests store file paths for quick lookup, but mobile updates can leave absolute paths stale. The download commands must repair path lookups by scanning the current `$APPDATA/downloads` directory for files prefixed with the episode id, and delete should remove matching files even when the manifest entry points at an old container path.

## iOS entitlements/config

- Enable Audio, AirPlay, and Picture in Picture background mode.
- Keep `viewport-fit=cover` in the web entrypoint and reserve `env(safe-area-inset-top)` in the mobile navigation so icons do not overlap the Dynamic Island or system status icons.
- Lock horizontal overflow on mobile pages. Queue, History, podcast episode lists, and other repeated rows should render as full-width rows on phone viewports, not cards that create left/right page scrolling.
- Register the `elephant-pod://auth/callback` deep-link scheme for native GitHub auth returns. The OAuth launch uses the system browser so passkeys/WebAuthn are not trapped inside the webview.
- Keep signed-in app-server sessions device-local. The frontend stores the session in browser `localStorage` and an IndexedDB `authSessions` fallback so iOS/Tauri launches can restore sign-in without syncing token material through settings or backups.
- Use `AVAudioSession.Category.playback` with spoken-audio mode for native playback.
- Use `MPNowPlayingInfoCenter` for metadata. The current iOS plugin updates title, artist/show, artwork, duration, elapsed position, playback rate, and playback state from the frontend `now_playing` command.
- Keep Now Playing metadata driven by the frontend `now_playing` payload: episode id, episode title, podcast title, artwork URL, elapsed position, duration, playback rate, and play/pause state. Refresh metadata after cue, play, pause, seek, rate changes, and native status polling. The web audio fallback must also keep `navigator.mediaSession` metadata and position state current because iOS may expose that session on the lock screen when the native plugin is not active.
- Use `MPRemoteCommandCenter` for play/pause/toggle/skip.
- Handle `AVAudioSession.interruptionNotification`.
- Handle `AVAudioSession.routeChangeNotification`.
- Validate on physical device with locked screen, AirPods/Bluetooth, Control Center, and cellular/wifi transitions.

## Mobile interaction model

- The collapsed mobile player shows episode/podcast/progress information on the left and larger artwork plus transport controls on the right.
- Mobile queue access is swipe-up on the player. The queue/player sheet should track the finger during drag, support velocity, and snap open or closed instead of waiting for touch end.
- Inbox and queue rows use Mail-style horizontal swipes. Half swipes reveal actions; full swipes perform the primary contextual action. Desktop keeps explicit controls and drag handles instead of requiring gestures.

## Android config

- Foreground service permission.
- Foreground media playback service declaration.
- Notification permission on modern Android.
- Notification channel.
- Media3 ExoPlayer + MediaSession.
- Handle noisy-audio route changes.
- Validate on physical device with Bluetooth, backgrounding, lock screen, and battery optimization.

## Next implementation step

Validate the packaged iOS AVPlayer plugin on a locked physical device while audio is playing, paused, seeking, changing rate, changing episodes, and receiving Control Center commands. Then promote Android foreground media playback from the Kotlin reference into the production plugin.
