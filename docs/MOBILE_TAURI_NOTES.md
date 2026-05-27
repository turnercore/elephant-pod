# Mobile Tauri Notes

Tauri v2 can package iOS and Android apps, but a serious podcast app needs native audio and storage integration.

## Added native pieces

- `src-tauri/src/downloads.rs`: app-local file downloads, manifests, delete, storage stats, oldest-first pruning.
- `src-tauri/src/native_audio.rs`: app-level audio command shim used by desktop/web fallback.
- `src-tauri/plugins/tauri-plugin-elephant-audio`: local Tauri plugin scaffold registered by the app shell.
- `src-tauri/mobile/ios/ElephantEarsAudioPlugin.swift`: AVAudioSession/AVPlayer/lock-screen command reference.
- `src-tauri/mobile/android/.../ElephantEarsAudioPlugin.kt`: Media3 MediaController/MediaSession implementation reference.
- `src-tauri/mobile/android/.../ElephantEarsPlaybackService.kt`: MediaSessionService reference.

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

## iOS entitlements/config

- Enable Audio, AirPlay, and Picture in Picture background mode.
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
