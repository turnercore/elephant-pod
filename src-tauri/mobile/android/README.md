# Android native audio plugin notes

This folder contains the Kotlin side of the Elephant Pod mobile audio bridge. It should be wired as a Tauri mobile plugin after `tauri android init` generates the Android project.

Production responsibilities:

- AndroidX Media3 `MediaSessionService` for background playback.
- `ExoPlayer` as the playback engine.
- foreground-service permissions and `foregroundServiceType="mediaPlayback"`.
- lock-screen notification and headset/Bluetooth controls through Media3.
- interruption/audio-focus handling before release.
- optional WorkManager/DownloadManager handoff for background downloads.

The TypeScript app speaks to the same command surface used by desktop: prepare, play, pause, seek, clear, and media-command events.
