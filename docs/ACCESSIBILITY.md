# Accessibility

DaisyPod uses an icon-first native iOS UI, so accessible names are mandatory. The primary audit target is the SwiftUI app in `apps/ios`.

Current baseline:

- Primary navigation buttons have stable accessibility labels and identifiers.
- Icon buttons use visible system symbols plus VoiceOver labels.
- Profile/status controls should describe iCloud/backend availability without presenting a separate server login state.
- Swipe rows keep visible row-menu alternatives for play, Play Next, queue-to-end, Inbox, favorite, remove, download, clips, and played actions. Swipe gestures are shortcuts, not the only way to act.
- The native iOS player queue sheet opens from the compact player, exposes labeled transport, favorite, and timer controls, keeps the loaded episode state fresh after local changes, and keeps row menu alternatives for play, favorite, send to Inbox, remove, and played-state actions. Sheet and row animations should respect reduced-motion preferences.
- The native iOS clip composer is a SwiftUI sheet with titled fields and explicit Cancel/Publish actions.
- The native iOS sleep timer uses a SwiftUI `Menu` with a VoiceOver label and text labels for every preset and cancel action.
- The Settings theme picker exposes Light, Dark, and Vaporwave as a segmented control. Themes change color, glow, backdrop, and animation only; controls keep their labels, identifiers, and local-first behavior.
- The Vaporwave backdrop uses reduced-motion state to pause its animated scanline/grid timing when iOS Reduce Motion is enabled.
- The native iOS Add, deep-link Add prefill, YouTube import mode, Library search, podcast detail Library/subscription/refresh/show-management/per-show playback controls, episode list row actions, episode detail playback/queue/Inbox/favorite/download/clip/chapter, clip composer, saved clip rows, server-intelligence capability states, Settings profile stats, theme picker, feed-refresh interval, Queue, portable-data, backend URL/status/account controls, expanded-player favorite, sleep timer, and player controls have stable accessibility identifiers covered by simulator UI tests on iPhone 13 mini. These tests verify discoverability for automation; they do not replace a manual VoiceOver pass.
- Status messages are dismissible overlay toasts that do not shift layout.
- Controls use SwiftUI `Button`, `Menu`, `Toggle`, `Stepper`, `TextField`, `Picker`, and `NavigationStack` surfaces.

Required future audit:

- Test with VoiceOver on iOS, including Add/Search, Library search, podcast detail Library/subscription/refresh/filtering/sorting/bulk actions, episode list row action menus, episode detail playback/queue/Inbox/favorite/download/clip/chapter actions, Settings profile stats/import/export, queue reorder, expanded player, clip composer, and server-intelligence controls.
- Continue expanding reduced-motion coverage for sheet and row transitions beyond the themed backdrop.
- Ensure color-coded badges have text equivalents.
- Add transcript support as an accessibility feature, not only a search feature.
