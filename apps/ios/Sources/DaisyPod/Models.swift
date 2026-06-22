import Foundation
import CryptoKit

extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }

  var searchFolded: String {
    folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
      .lowercased()
  }

  var strippedHTML: String {
    guard let data = data(using: .utf8),
          let attributed = try? NSAttributedString(
            data: data,
            options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue],
            documentAttributes: nil
          )
    else {
      return self
    }
    return attributed.string.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

enum SectionKey: String, Codable, CaseIterable, Identifiable {
  case inbox
  case queue
  case library
  case search
  case history
  case downloads
  case settings

  var id: String { rawValue }

  static var primaryNavigationCases: [SectionKey] {
    [.inbox, .library, .search, .history, .downloads, .settings]
  }

  var visibleSection: SectionKey {
    self == .queue ? .inbox : self
  }

  var title: String {
    switch self {
    case .inbox: "Inbox"
    case .queue: "Queue"
    case .library: "Library"
    case .search: "Add"
    case .history: "History"
    case .downloads: "Downloads"
    case .settings: "Settings"
    }
  }

  var systemImage: String {
    switch self {
    case .inbox: "tray.full"
    case .queue: "text.line.first.and.arrowtriangle.forward"
    case .library: "books.vertical"
    case .search: "plus.magnifyingglass"
    case .history: "clock.arrow.circlepath"
    case .downloads: "arrow.down.circle"
    case .settings: "gearshape"
    }
  }

  var accessibilityIdentifier: String {
    "Tab.\(rawValue)"
  }
}

enum InboxState: String, Codable {
  case new
  case dismissed
  case archived
}

enum SortDirection: String, Codable {
  case newest
  case oldest
}

enum PodcastEpisodeFilter: String, Codable, CaseIterable, Identifiable {
  case all
  case unplayed
  case played

  var id: String { rawValue }

  var title: String {
    switch self {
    case .all:
      return "All"
    case .unplayed:
      return "Unplayed"
    case .played:
      return "Played"
    }
  }
}

enum PodcastSourceType: String, Codable {
  case rss
  case youtubeChannel = "youtube-channel"
  case youtubePlaylist = "youtube-playlist"
  case youtubeAdHoc = "youtube-ad-hoc"

  var isYouTube: Bool {
    switch self {
    case .youtubeChannel, .youtubePlaylist, .youtubeAdHoc:
      return true
    case .rss:
      return false
    }
  }
}

enum EpisodeSourceType: String, Codable {
  case rss
  case youtube
}

enum ExtractionStatus: String, Codable {
  case none
  case queued
  case processing
  case ready
  case failed
}

enum ClipRenderStatus: String, Codable {
  case localOnly = "local-only"
  case queued
  case pending
  case rendering
  case ready
  case rendered
  case failed
  case rangeLink = "range-link"
  case timeRangeOnly = "time-range-only"
}

enum ServerCacheStatus: String, Codable {
  case queued
  case processing
  case ready
  case failed
  case stale
  case missing
  case unavailable
}

enum SmartSkipSegmentType: String, Codable {
  case ad
  case sponsorship
  case networkPromo = "network_promo"
  case selfPromo = "self_promo"
  case intro
  case outro
}

enum SmartSkipAction: String, Codable {
  case autoSkip = "auto_skip"
  case softSkip = "soft_skip"
  case labelOnly = "label_only"
  case doNotSkip = "do_not_skip"
}

enum SmartSkipSource: String, Codable {
  case rssMetadata = "rss_metadata"
  case whisperTranscript = "whisper_transcript"
  case codexSegmenter = "codex_segmenter"
  case boundaryRefiner = "boundary_refiner"
  case ensemble
}

struct Podcast: Identifiable, Codable, Hashable {
  var id: String
  var title: String
  var author: String?
  var description: String?
  var imageUrl: String?
  var feedUrl: String
  var websiteUrl: String?
  var tags: [String]
  var sourceType: PodcastSourceType?
  var sourceUrl: String?
  var externalId: String?
  var lastRefreshedAt: Date?
  var createdAt: Date
  var updatedAt: Date
  var serverRevision: Int? = nil
}

struct CachedPodcast: Identifiable, Codable, Hashable {
  var id: String
  var podcast: Podcast
  var cachedAt: Date
  var cacheExpiresAt: Date?
  var podcastIndexId: String?
  var categories: [String]
}

struct Chapter: Identifiable, Codable, Hashable {
  var id: String
  var title: String
  var startsAt: TimeInterval
  var url: String?
}

struct Episode: Identifiable, Codable, Hashable {
  var id: String
  var podcastId: String
  var podcastTitle: String
  var title: String
  var description: String?
  var audioUrl: String
  var websiteUrl: String?
  var imageUrl: String?
  var publishedAt: Date
  var durationSec: TimeInterval?
  var seasonNumber: Int?
  var episodeNumber: Int?
  var explicit: Bool?
  var chapters: [Chapter]
  var guid: String
  var enclosureLength: Int?
  var sourceType: EpisodeSourceType?
  var sourceUrl: String?
  var externalId: String?
  var extractionStatus: ExtractionStatus?
  var createdAt: Date
  var updatedAt: Date
  var serverRevision: Int? = nil

  var youtubeSourceURL: String? {
    guard sourceType == .youtube else { return nil }
    return sourceUrl ?? websiteUrl
  }
}

struct EpisodeState: Codable, Hashable {
  var episodeId: String
  var played: Bool
  var playedAt: Date?
  var lastPlayedAt: Date?
  var progressSec: TimeInterval
  var inboxState: InboxState
  var inboxPosition: Int?
  var queuedAt: Date?
  var queuePosition: Int?
  var downloaded: Bool
  var downloadedAt: Date?
  var downloadPath: String?
  var downloadBytes: Int?
  var downloadBackend: String?
  var downloadSource: String?
  var favorite: Bool
  var deletedAt: Date?
  var clipCount: Int
  var updatedAt: Date
  var serverRevision: Int? = nil
}

struct EpisodeWithState: Identifiable, Hashable {
  var episode: Episode
  var state: EpisodeState
  var id: String { episode.id }
}

struct PodcastPreference: Codable, Hashable {
  var podcastId: String
  var inLibrary: Bool?
  var wasSubscribedBeforeLibraryRemoval: Bool?
  var playbackRate: Double?
  var skipForwardSec: Int?
  var skipBackSec: Int?
  var skipIntroSec: Int?
  var skipOutroSec: Int?
  var silenceShortening: Bool?
  var smartSkipEnabled: Bool?
  var smartSkipCommercials: Bool?
  var smartSkipSelfPromo: Bool?
  var smartSkipIntros: Bool?
  var smartSkipOutros: Bool?
  var smartSkipIncludeSoftMatches: Bool?
  var sortDirection: SortDirection
  var addNewEpisodesToInbox: Bool
  var updatedAt: Date
  var serverRevision: Int? = nil
}

struct Clip: Identifiable, Codable, Hashable {
  var id: String
  var episodeId: String
  var podcastTitle: String
  var episodeTitle: String
  var sourceAudioUrl: String
  var startSec: TimeInterval
  var endSec: TimeInterval
  var title: String
  var note: String?
  var publicUrl: String?
  var serverClipId: String?
  var renderedUrl: String?
  var renderedAudioUrl: String?
  var renderedVideoUrl: String?
  var renderStatus: ClipRenderStatus?
  var renderError: String?
  var fileSizeBytes: Int?
  var createdAt: Date
  var updatedAt: Date
  var serverRevision: Int? = nil
}

struct SilenceMapSegment: Codable, Hashable {
  var silenceStartSec: TimeInterval
  var silenceEndSec: TimeInterval
  var skipFromSec: TimeInterval
  var skipToSec: TimeInterval
  var retainedSilenceSec: TimeInterval
}

struct SilenceMap: Identifiable, Codable, Hashable {
  var id: String
  var episodeId: String
  var audioUrl: String
  var status: ServerCacheStatus
  var segments: [SilenceMapSegment]
  var durationSec: TimeInterval?
  var thresholdDb: Double?
  var minimumSilenceSec: TimeInterval?
  var retainedSilenceSec: TimeInterval?
  var analyzerVersion: String?
  var error: String?
  var createdAt: Date?
  var updatedAt: Date
  var lastRequestedAt: Date?
  var lastCheckedAt: Date?
}

struct SmartSkipSegment: Identifiable, Codable, Hashable {
  var id: String
  var type: SmartSkipSegmentType
  var subtype: String?
  var startMs: Int
  var endMs: Int
  var confidence: Double
  var action: SmartSkipAction
  var source: SmartSkipSource
  var label: String
  var evidence: [String]?
  var originalStartMs: Int?
  var originalEndMs: Int?
}

struct SmartSkipSegmentMap: Codable, Hashable {
  var schemaVersion: String
  var episodeId: String
  var podcastId: String?
  var mediaVersionId: String
  var audioUrl: String
  var durationMs: Int?
  var generatedAt: Date
  var status: ServerCacheStatus
  var segments: [SmartSkipSegment]

  var isReadyForPlayback: Bool {
    schemaVersion == "daisypod.smart-skip.v1" && status == .ready && !segments.isEmpty
  }
}

struct SmartSkipTranscriptSegment: Codable, Hashable {
  var startMs: Int
  var endMs: Int
  var speaker: String?
  var text: String
}

struct SmartSkipTranscript: Codable, Hashable {
  var mediaVersionId: String
  var provider: String
  var model: String?
  var language: String?
  var durationMs: Int?
  var segments: [SmartSkipTranscriptSegment]
}

struct SmartSkipMapCacheEntry: Identifiable, Codable, Hashable {
  var id: String
  var episodeId: String
  var audioUrl: String
  var map: SmartSkipSegmentMap?
  var transcript: SmartSkipTranscript?
  var status: ServerCacheStatus
  var jobId: String?
  var reason: String?
  var error: String?
  var lastRequestedAt: Date?
  var cachedAt: Date
  var updatedAt: Date
}

struct AppSettings: Codable, Hashable {
  var id: String = "local"
  var skipForwardSec: Int = 30
  var skipBackSec: Int = 15
  var resumeRewindSec: Int = 8
  var playbackRate: Double = 1
  var autoPlayNext: Bool = true
  var autoDownload: Bool = true
  var autoDownloadInbox: Bool = false
  var autoDeleteAfterListen: Bool = true
  var downloadOnlyWifi: Bool = true
  var storageCapMb: Int = 2048
  var inboxSortDirection: SortDirection = .newest
  var refreshIntervalMinutes: Int = 720
  var silenceShortening: Bool = false
  var smartSkipEnabled: Bool = true
  var smartSkipCommercials: Bool = true
  var smartSkipSelfPromo: Bool = false
  var smartSkipIntros: Bool = false
  var smartSkipOutros: Bool = false
  var smartSkipIncludeSoftMatches: Bool = false
  var smartSkipUseServerMedia: Bool = true
  var nativeAudioPreferred: Bool = true
  var serverUrl: String?
  var lastSyncAt: Date?
  var lastSyncRevision: Int? = nil
  var sleepTimerEndsAt: Date?
  var deviceId: String = UUID().uuidString
  var updatedAt: Date = Date()
  var serverRevision: Int? = nil
  var theme: AppTheme = .light
  var themeSchemaVersion: Int = AppTheme.currentSchemaVersion

  init() {}

  enum CodingKeys: String, CodingKey {
    case id
    case skipForwardSec
    case skipBackSec
    case resumeRewindSec
    case playbackRate
    case autoPlayNext
    case autoDownload
    case autoDownloadInbox
    case autoDeleteAfterListen
    case downloadOnlyWifi
    case storageCapMb
    case inboxSortDirection
    case refreshIntervalMinutes
    case silenceShortening
    case smartSkipEnabled
    case smartSkipCommercials
    case smartSkipSelfPromo
    case smartSkipIntros
    case smartSkipOutros
    case smartSkipIncludeSoftMatches
    case smartSkipUseServerMedia
    case nativeAudioPreferred
    case serverUrl
    case lastSyncAt
    case lastSyncRevision
    case sleepTimerEndsAt
    case deviceId
    case updatedAt
    case serverRevision
    case theme
    case themeSchemaVersion
  }

  init(from decoder: Decoder) throws {
    self.init()
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decodeIfPresent(String.self, forKey: .id) ?? id
    skipForwardSec = try container.decodeIfPresent(Int.self, forKey: .skipForwardSec) ?? skipForwardSec
    skipBackSec = try container.decodeIfPresent(Int.self, forKey: .skipBackSec) ?? skipBackSec
    resumeRewindSec = try container.decodeIfPresent(Int.self, forKey: .resumeRewindSec) ?? resumeRewindSec
    playbackRate = try container.decodeIfPresent(Double.self, forKey: .playbackRate) ?? playbackRate
    autoPlayNext = try container.decodeIfPresent(Bool.self, forKey: .autoPlayNext) ?? autoPlayNext
    autoDownload = try container.decodeIfPresent(Bool.self, forKey: .autoDownload) ?? autoDownload
    autoDownloadInbox = try container.decodeIfPresent(Bool.self, forKey: .autoDownloadInbox) ?? autoDownloadInbox
    autoDeleteAfterListen = try container.decodeIfPresent(Bool.self, forKey: .autoDeleteAfterListen) ?? autoDeleteAfterListen
    downloadOnlyWifi = try container.decodeIfPresent(Bool.self, forKey: .downloadOnlyWifi) ?? downloadOnlyWifi
    storageCapMb = try container.decodeIfPresent(Int.self, forKey: .storageCapMb) ?? storageCapMb
    inboxSortDirection = try container.decodeIfPresent(SortDirection.self, forKey: .inboxSortDirection) ?? inboxSortDirection
    refreshIntervalMinutes = try container.decodeIfPresent(Int.self, forKey: .refreshIntervalMinutes) ?? refreshIntervalMinutes
    silenceShortening = try container.decodeIfPresent(Bool.self, forKey: .silenceShortening) ?? silenceShortening
    smartSkipEnabled = try container.decodeIfPresent(Bool.self, forKey: .smartSkipEnabled) ?? smartSkipEnabled
    smartSkipCommercials = try container.decodeIfPresent(Bool.self, forKey: .smartSkipCommercials) ?? smartSkipCommercials
    smartSkipSelfPromo = try container.decodeIfPresent(Bool.self, forKey: .smartSkipSelfPromo) ?? smartSkipSelfPromo
    smartSkipIntros = try container.decodeIfPresent(Bool.self, forKey: .smartSkipIntros) ?? smartSkipIntros
    smartSkipOutros = try container.decodeIfPresent(Bool.self, forKey: .smartSkipOutros) ?? smartSkipOutros
    smartSkipIncludeSoftMatches = try container.decodeIfPresent(Bool.self, forKey: .smartSkipIncludeSoftMatches) ?? smartSkipIncludeSoftMatches
    smartSkipUseServerMedia = try container.decodeIfPresent(Bool.self, forKey: .smartSkipUseServerMedia) ?? smartSkipUseServerMedia
    nativeAudioPreferred = try container.decodeIfPresent(Bool.self, forKey: .nativeAudioPreferred) ?? nativeAudioPreferred
    serverUrl = try container.decodeIfPresent(String.self, forKey: .serverUrl) ?? serverUrl
    lastSyncAt = try container.decodeIfPresent(Date.self, forKey: .lastSyncAt) ?? lastSyncAt
    lastSyncRevision = try container.decodeIfPresent(Int.self, forKey: .lastSyncRevision) ?? lastSyncRevision
    sleepTimerEndsAt = try container.decodeIfPresent(Date.self, forKey: .sleepTimerEndsAt) ?? sleepTimerEndsAt
    deviceId = try container.decodeIfPresent(String.self, forKey: .deviceId) ?? deviceId
    updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? updatedAt
    serverRevision = try container.decodeIfPresent(Int.self, forKey: .serverRevision) ?? serverRevision
    themeSchemaVersion = try container.decodeIfPresent(Int.self, forKey: .themeSchemaVersion) ?? 0
    if themeSchemaVersion >= AppTheme.currentSchemaVersion {
      let rawTheme = try container.decodeIfPresent(String.self, forKey: .theme)
      theme = rawTheme.flatMap(AppTheme.init(rawValue:)) ?? theme
    } else {
      theme = .light
      themeSchemaVersion = AppTheme.currentSchemaVersion
    }
  }
}

struct PodcastListeningStats: Codable, Hashable {
  var podcastId: String
  var podcastTitle: String
  var listeningSec: TimeInterval = 0
  var contentSec: TimeInterval = 0
  var speedSavedSec: TimeInterval = 0
  var silenceSavedSec: TimeInterval = 0
}

struct ListeningStats: Codable, Hashable {
  var id: String = "local"
  var listeningSec: TimeInterval = 0
  var contentSec: TimeInterval = 0
  var speedSavedSec: TimeInterval = 0
  var silenceSavedSec: TimeInterval = 0
  var byPodcast: [String: PodcastListeningStats] = [:]
  var updatedAt: Date = Date()

  enum CodingKeys: String, CodingKey {
    case id
    case listeningSec
    case contentSec
    case speedSavedSec
    case silenceSavedSec
    case byPodcast
    case updatedAt
  }

  init() {}

  init(
    id: String = "local",
    listeningSec: TimeInterval = 0,
    contentSec: TimeInterval = 0,
    speedSavedSec: TimeInterval = 0,
    silenceSavedSec: TimeInterval = 0,
    byPodcast: [String: PodcastListeningStats] = [:],
    updatedAt: Date = Date()
  ) {
    self.id = id
    self.listeningSec = listeningSec
    self.contentSec = contentSec
    self.speedSavedSec = speedSavedSec
    self.silenceSavedSec = silenceSavedSec
    self.byPodcast = byPodcast
    self.updatedAt = updatedAt
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decodeIfPresent(String.self, forKey: .id) ?? "local"
    listeningSec = try container.decodeIfPresent(TimeInterval.self, forKey: .listeningSec) ?? 0
    contentSec = try container.decodeIfPresent(TimeInterval.self, forKey: .contentSec) ?? 0
    speedSavedSec = try container.decodeIfPresent(TimeInterval.self, forKey: .speedSavedSec) ?? 0
    silenceSavedSec = try container.decodeIfPresent(TimeInterval.self, forKey: .silenceSavedSec) ?? 0
    byPodcast = try container.decodeIfPresent([String: PodcastListeningStats].self, forKey: .byPodcast) ?? [:]
    updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()
  }
}

struct SyncTombstone: Identifiable, Codable, Hashable {
  var id: String
  var tableName: String
  var localId: String
  var deletedAt: Date
  var pushedAt: Date?
  var serverRevision: Int? = nil
}

struct SyncAction: Identifiable, Codable, Hashable {
  struct Payload: Codable, Hashable {
    var state: SyncUploadState?
  }

  var id: String
  var deviceId: String
  var sequence: Int
  var entityType: String
  var entityId: String
  var actionType: String
  var payload: Payload
  var createdAt: Date
  var pushedAt: Date?
  var appliedAt: Date?
  var serverRevision: Int? = nil
}

struct ParsedFeedResult: Codable, Hashable {
  var podcast: Podcast
  var episodes: [Episode]
}

enum SeedData {
  static let createdAt = ISO8601DateFormatter().date(from: "2026-05-27T08:00:00.000Z") ?? Date()

  static let podcasts: [Podcast] = [
    Podcast(
      id: stableId("daisy-pod-show", prefix: "feed"),
      title: "DaisyPod Field Notes",
      author: "DaisyPod",
      description: "Design notes, devlogs, and local-first podcast systems.",
      imageUrl: "asset://DebugPodcastDaisyPod",
      feedUrl: "https://example.com/daisy-pod.xml",
      websiteUrl: "https://elephanthand.com",
      tags: ["studio", "design"],
      lastRefreshedAt: createdAt,
      createdAt: createdAt,
      updatedAt: createdAt
    ),
    Podcast(
      id: stableId("open-podcast-lab", prefix: "feed"),
      title: "Open Podcast Lab",
      author: "Local First Radio",
      description: "A demo feed for testing queueing, sync, RSS, and offline flows.",
      imageUrl: "asset://DebugPodcastOpenLab",
      feedUrl: "https://example.com/open-podcast-lab.xml",
      websiteUrl: "https://example.com",
      tags: ["tech", "local-first"],
      lastRefreshedAt: createdAt,
      createdAt: createdAt,
      updatedAt: createdAt
    )
  ]

  static let episodes: [Episode] = [
    episode(podcasts[0], 1, "Inbox, Queue, and the Shape of Attention", 1, 3280, imageName: "DebugFieldNotesEpisode1"),
    episode(podcasts[0], 2, "Designing With Fewer Words and Better Buttons", 5, 2470, imageName: "DebugFieldNotesEpisode2"),
    episode(podcasts[0], 3, "The Local-First Listening Machine", 9, 3860, imageName: "DebugFieldNotesEpisode3"),
    episode(podcasts[1], 1, "RSS Is Still the Good Weird Internet", 2, 2920, imageName: "DebugOpenLabEpisode1"),
    episode(podcasts[1], 2, "Sync Without Surrender", 6, 3120, imageName: "DebugOpenLabEpisode2"),
    episode(podcasts[1], 3, "Podcast Apps Are Not Music Apps", 10, 4210, imageName: "DebugOpenLabEpisode3")
  ]

  static func defaultState(for episodeId: String, index: Int = 0) -> EpisodeState {
    EpisodeState(
      episodeId: episodeId,
      played: false,
      progressSec: 0,
      inboxState: index < 4 ? .new : .archived,
      inboxPosition: index < 4 ? index + 1 : nil,
      downloaded: false,
      favorite: false,
      clipCount: 0,
      updatedAt: Date()
    )
  }

  private static func episode(_ feed: Podcast, _ number: Int, _ title: String, _ daysAgo: Int, _ duration: TimeInterval, imageName: String? = nil) -> Episode {
    let published = Calendar.current.date(byAdding: .day, value: -daysAgo, to: Date()) ?? Date()
    return Episode(
      id: stableId("\(feed.id):\(number):\(title)", prefix: "ep"),
      podcastId: feed.id,
      podcastTitle: feed.title,
      title: title,
      description: "Demo episode with chapters, playback state, queue actions, and local-first persistence.",
      audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
      websiteUrl: feed.websiteUrl,
      imageUrl: imageName.map { "asset://\($0)" } ?? feed.imageUrl,
      publishedAt: published,
      durationSec: duration,
      explicit: false,
      chapters: [
        Chapter(id: stableId("\(title):intro", prefix: "ch"), title: "Cold open", startsAt: 0),
        Chapter(id: stableId("\(title):main", prefix: "ch"), title: "Main idea", startsAt: duration * 0.22),
        Chapter(id: stableId("\(title):wrap", prefix: "ch"), title: "Wrap", startsAt: duration * 0.83)
      ],
      guid: "\(feed.feedUrl)#\(number)",
      enclosureLength: Int(duration * 32000),
      createdAt: published,
      updatedAt: Date()
    )
  }
}

func stableId(_ raw: String, prefix: String) -> String {
  let digest = Insecure.SHA1.hash(data: Data(raw.utf8))
  let hex = digest.map { String(format: "%02x", $0) }.joined().prefix(18)
  return "\(prefix)_\(hex)"
}

extension TimeInterval {
  var clockString: String {
    guard isFinite else { return "0:00" }
    let total = max(0, Int(self))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let seconds = total % 60
    if hours > 0 {
      return "\(hours):\(String(format: "%02d", minutes)):\(String(format: "%02d", seconds))"
    }
    return "\(minutes):\(String(format: "%02d", seconds))"
  }

  var statDurationString: String {
    guard isFinite else { return "0m" }
    let totalMinutes = max(0, Int((self / 60).rounded()))
    let hours = totalMinutes / 60
    let minutes = totalMinutes % 60
    if hours > 0, minutes > 0 { return "\(hours)h \(minutes)m" }
    if hours > 0 { return "\(hours)h" }
    return "\(minutes)m"
  }
}
