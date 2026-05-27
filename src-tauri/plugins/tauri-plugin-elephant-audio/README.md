# tauri-plugin-elephant-audio

Native audio plugin scaffold for Elephant Ears.

The Rust side is registered in `src-tauri/src/lib.rs`. On desktop it reports unavailable native audio so the app falls back to HTML audio. On mobile, the Swift/Kotlin sources in this package are the starting point for real AVPlayer/Media3 playback.

## Command surface

The frontend calls these Tauri plugin commands first, then falls back to desktop-safe shim commands when unavailable:

- `plugin:elephant-audio|capabilities`
- `plugin:elephant-audio|prepare`
- `plugin:elephant-audio|play`
- `plugin:elephant-audio|pause`
- `plugin:elephant-audio|stop`
- `plugin:elephant-audio|seek`
- `plugin:elephant-audio|set_rate`
- `plugin:elephant-audio|status`
- `plugin:elephant-audio|now_playing`

## Target behavior

- iOS: `AVPlayer`, `AVAudioSession.playback`, background audio mode, `MPNowPlayingInfoCenter`, `MPRemoteCommandCenter`, interruptions, route changes.
- Android: Media3 `ExoPlayer`, `MediaController`, `MediaSessionService`, foreground playback service, notification controls, noisy-audio route handling, lifecycle recovery.
- Desktop: HTML audio fallback today; native media-key integration can be added later.

## Integration notes

1. Run the current Tauri mobile initialization flow for iOS/Android.
2. Wire this local plugin into the generated mobile projects.
3. Apply the Android manifest and iOS background-mode snippets from `docs/MOBILE_TAURI_NOTES.md`.
4. Validate on physical devices with locked screen, backgrounding, Bluetooth/headphones, and network changes.
