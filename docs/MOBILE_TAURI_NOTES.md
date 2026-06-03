# Mobile Tauri Notes

Tauri v2 can package iOS and Android apps, but a serious podcast app needs native audio and storage integration.

## Added native pieces

- `src-tauri/src/downloads.rs`: app-local file downloads, manifests, delete, storage stats, oldest-first pruning.
- `src-tauri/src/native_audio.rs`: app-level audio command shim used by desktop/web fallback.
- `src-tauri/plugins/tauri-plugin-elephant-audio`: local Tauri plugin scaffold registered by the app shell.
- `src-tauri/mobile/ios/ElephantPodAudioPlugin.swift`: AVAudioSession/AVPlayer/lock-screen command reference.
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

## iOS entitlements/config

- Enable Audio, AirPlay, and Picture in Picture background mode.
- Keep `viewport-fit=cover` in the web entrypoint and reserve `env(safe-area-inset-top)` in the mobile navigation so icons do not overlap the Dynamic Island or system status icons.
- Lock horizontal overflow on mobile pages. Queue, History, podcast episode lists, and other repeated rows should render as full-width rows on phone viewports, not cards that create left/right page scrolling.
- Register the `elephant-pod://auth/callback` deep-link scheme for native GitHub auth returns. The OAuth launch uses the system browser so passkeys/WebAuthn are not trapped inside the webview.
- Use `AVAudioSession.Category.playback` with spoken-audio mode.
- Use `MPNowPlayingInfoCenter` for metadata.
- Use `MPRemoteCommandCenter` for play/pause/toggle/skip.
- Handle `AVAudioSession.interruptionNotification`.
- Handle `AVAudioSession.routeChangeNotification`.
- Validate on physical device with locked screen, AirPods/Bluetooth, Control Center, and cellular/wifi transitions.

## Android config

- Foreground service permission.
- Foreground media playback service declaration.
- Notification permission on modern Android.
- Notification channel.
- Media3 ExoPlayer + MediaSession.
- Handle noisy-audio route changes.
- Validate on physical device with Bluetooth, backgrounding, lock screen, and battery optimization.

## Next implementation step

Use the included local plugin as the starting point, then run the current Tauri mobile initialization flow and wire its Swift/Kotlin sources into the generated iOS/Android projects.

After that, enable mobile permissions/entitlements, replace desktop shim responses with real native capability responses, and validate locked-screen/background behavior on physical devices.
