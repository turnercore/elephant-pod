# iOS native audio plugin notes

This folder contains the Swift side of the Elephant Pod mobile audio plugin. It is intentionally kept separate from the generated Tauri iOS project so future agents can wire it into the mobile build without losing code when `tauri ios init` regenerates files.

Production responsibilities:

- `AVAudioSession` category `.playback` with spoken-audio mode.
- `AVPlayer` ownership outside the WebView so playback survives backgrounding.
- `MPNowPlayingInfoCenter` metadata for lock-screen controls.
- `MPRemoteCommandCenter` handlers for play, pause, seek, skip forward/back.
- interruption and route-change handling.
- `UIBackgroundModes` with `audio` in the generated iOS `Info.plist`.

The web app keeps the same command surface as desktop: prepare, playback-state, clear-session, and media-command events.
