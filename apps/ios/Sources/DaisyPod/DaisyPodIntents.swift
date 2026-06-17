import AppIntents
import Foundation

enum DaisyPodIntentSection: String, AppEnum {
  case inbox
  case library
  case add
  case history
  case downloads
  case settings

  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "DaisyPod Section")

  static let caseDisplayRepresentations: [DaisyPodIntentSection: DisplayRepresentation] = [
    .inbox: "Inbox",
    .library: "Library",
    .add: "Add Podcast",
    .history: "History",
    .downloads: "Downloads",
    .settings: "Settings"
  ]

  var sectionKey: SectionKey {
    switch self {
    case .inbox:
      return .inbox
    case .library:
      return .library
    case .add:
      return .search
    case .history:
      return .history
    case .downloads:
      return .downloads
    case .settings:
      return .settings
    }
  }
}

struct OpenDaisyPodSectionIntent: AppIntent {
  static let title: LocalizedStringResource = "Open DaisyPod Section"
  static let description = IntentDescription("Opens DaisyPod to a main app section.")
  static let openAppWhenRun = true

  @Parameter(title: "Section")
  var section: DaisyPodIntentSection

  init() {
    section = .inbox
  }

  init(section: DaisyPodIntentSection) {
    self.section = section
  }

  func perform() async throws -> some IntentResult {
    AppIntentHandoff.store(AppIntentHandoffPayload(action: .openSection, section: section.sectionKey))
    return .result()
  }
}

struct AddPodcastURLIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Podcast URL"
  static let description = IntentDescription("Opens DaisyPod with a podcast or YouTube URL ready to add.")
  static let openAppWhenRun = true

  @Parameter(title: "Podcast URL")
  var url: String

  init() {
    url = "https://example.com/feed.xml"
  }

  init(url: String) {
    self.url = url
  }

  func perform() async throws -> some IntentResult {
    AppIntentHandoff.store(AppIntentHandoffPayload(action: .addPodcast, value: url))
    return .result()
  }
}

struct ToggleDaisyPodPlaybackIntent: AppIntent {
  static let title: LocalizedStringResource = "Play or Pause DaisyPod"
  static let description = IntentDescription("Opens DaisyPod and toggles the current player.")
  static let openAppWhenRun = true

  func perform() async throws -> some IntentResult {
    AppIntentHandoff.store(AppIntentHandoffPayload(action: .togglePlayback))
    return .result()
  }
}

struct SyncDaisyPodIntent: AppIntent {
  static let title: LocalizedStringResource = "Sync DaisyPod"
  static let description = IntentDescription("Opens DaisyPod and starts iCloud sync.")
  static let openAppWhenRun = true

  func perform() async throws -> some IntentResult {
    AppIntentHandoff.store(AppIntentHandoffPayload(action: .syncNow))
    return .result()
  }
}

struct DaisyPodShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: OpenDaisyPodSectionIntent(),
      phrases: [
        "Open \(\.$section) in \(.applicationName)",
        "Show \(\.$section) in \(.applicationName)"
      ],
      shortTitle: "Open Section",
      systemImageName: "rectangle.grid.1x2"
    )
    AppShortcut(
      intent: AddPodcastURLIntent(),
      phrases: [
        "Add podcast URL in \(.applicationName)",
        "Import podcast URL in \(.applicationName)"
      ],
      shortTitle: "Add Podcast URL",
      systemImageName: "plus.magnifyingglass"
    )
    AppShortcut(
      intent: ToggleDaisyPodPlaybackIntent(),
      phrases: [
        "Play or pause \(.applicationName)",
        "Toggle \(.applicationName) playback"
      ],
      shortTitle: "Play or Pause",
      systemImageName: "playpause.fill"
    )
    AppShortcut(
      intent: SyncDaisyPodIntent(),
      phrases: [
        "Sync \(.applicationName)"
      ],
      shortTitle: "Sync",
      systemImageName: "arrow.triangle.2.circlepath"
    )
  }
}
