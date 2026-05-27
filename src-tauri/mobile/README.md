# Mobile native audio reference sources

This folder contains reference native code for the Elephant Ears mobile audio bridge. The canonical plugin scaffold lives in `src-tauri/plugins/tauri-plugin-elephant-audio`; these files are preserved as easy-to-read platform references for the generated iOS/Android projects.

Tauri v2 mobile plugins can expose Kotlin/Java on Android and Swift on iOS through plugin commands. The desktop Rust commands in `src-tauri/src/lib.rs` keep the app buildable and provide native filesystem downloads.

## Commands expected by the web app

- `plugin:elephant-audio|capabilities`
- `plugin:elephant-audio|prepare`
- `plugin:elephant-audio|play`
- `plugin:elephant-audio|pause`
- `plugin:elephant-audio|seek`
- `plugin:elephant-audio|set_rate`
- `plugin:elephant-audio|stop`
- `plugin:elephant-audio|status`
- `plugin:elephant-audio|now_playing`

## iOS capabilities

Add the following capability in the generated iOS app target:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
```

The Swift source configures `AVAudioSession`, `AVPlayer`, lock-screen metadata through `MPNowPlayingInfoCenter`, and remote commands through `MPRemoteCommandCenter`.

## Android capabilities

The Android source targets Media3 with an `ExoPlayer`, `MediaController`, `MediaSession`, and `MediaSessionService`. Merge the service declaration from `android/AndroidManifest.media-session-snippet.xml` into the generated Android app manifest and add the Media3 dependencies in the generated Gradle module.
