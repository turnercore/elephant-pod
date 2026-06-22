import Foundation
import SQLite3

enum LocalStoreError: Error {
  case openFailed(String)
  case sqlite(String)
  case decodeFailed
}

final class SQLiteObjectStore {
  private let url: URL
  private var db: OpaquePointer?
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(url: URL) throws {
    self.url = url
    encoder.dateEncodingStrategy = .iso8601
    decoder.dateDecodingStrategy = .iso8601
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard sqlite3_open(url.path, &db) == SQLITE_OK else {
      throw LocalStoreError.openFailed(String(cString: sqlite3_errmsg(db)))
    }
    try migrate()
  }

  deinit {
    sqlite3_close(db)
  }

  func migrate() throws {
    try execute("PRAGMA journal_mode=WAL")
    try execute("""
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )
      """)
    try execute("""
      CREATE TABLE IF NOT EXISTS objects (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(collection, id)
      )
      """)
    try execute("CREATE INDEX IF NOT EXISTS objects_collection_updated_idx ON objects(collection, updated_at)")
    try execute("INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('version', '1')")
  }

  func put<T: Encodable>(_ value: T, id: String, collection: String, updatedAt: Date = Date()) throws {
    let json = String(decoding: try encoder.encode(value), as: UTF8.self)
    try withStatement("INSERT OR REPLACE INTO objects(collection, id, json, updated_at) VALUES (?, ?, ?, ?)") { statement in
      sqlite3_bind_text(statement, 1, collection, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(statement, 2, id, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(statement, 3, json, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(statement, 4, ISO8601DateFormatter().string(from: updatedAt), -1, SQLITE_TRANSIENT)
      guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteError() }
    }
  }

  func get<T: Decodable>(_ type: T.Type, id: String, collection: String) throws -> T? {
    try withStatement("SELECT json FROM objects WHERE collection = ? AND id = ? LIMIT 1") { statement in
      sqlite3_bind_text(statement, 1, collection, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(statement, 2, id, -1, SQLITE_TRANSIENT)
      guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
      guard let text = sqlite3_column_text(statement, 0) else { return nil }
      return try decoder.decode(T.self, from: Data(String(cString: text).utf8))
    }
  }

  func list<T: Decodable>(_ type: T.Type, collection: String) throws -> [T] {
    try withStatement("SELECT json FROM objects WHERE collection = ?") { statement in
      sqlite3_bind_text(statement, 1, collection, -1, SQLITE_TRANSIENT)
      var values: [T] = []
      while sqlite3_step(statement) == SQLITE_ROW {
        guard let text = sqlite3_column_text(statement, 0) else { continue }
        values.append(try decoder.decode(T.self, from: Data(String(cString: text).utf8)))
      }
      return values
    }
  }

  func delete(id: String, collection: String) throws {
    try withStatement("DELETE FROM objects WHERE collection = ? AND id = ?") { statement in
      sqlite3_bind_text(statement, 1, collection, -1, SQLITE_TRANSIENT)
      sqlite3_bind_text(statement, 2, id, -1, SQLITE_TRANSIENT)
      guard sqlite3_step(statement) == SQLITE_DONE else { throw sqliteError() }
    }
  }

  func deleteAllObjects() throws {
    try execute("DELETE FROM objects")
  }

  func count(collection: String) throws -> Int {
    try withStatement("SELECT COUNT(*) FROM objects WHERE collection = ?") { statement in
      sqlite3_bind_text(statement, 1, collection, -1, SQLITE_TRANSIENT)
      guard sqlite3_step(statement) == SQLITE_ROW else { return 0 }
      return Int(sqlite3_column_int(statement, 0))
    }
  }

  private func execute(_ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw sqliteError() }
  }

  private func withStatement<T>(_ sql: String, _ body: (OpaquePointer?) throws -> T) throws -> T {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw sqliteError() }
    defer { sqlite3_finalize(statement) }
    return try body(statement)
  }

  private func sqliteError() -> LocalStoreError {
    LocalStoreError.sqlite(db.map { String(cString: sqlite3_errmsg($0)) } ?? "Unknown SQLite error")
  }
}

private func clampTelemetry(_ value: TimeInterval) -> TimeInterval {
  guard value.isFinite, value > 0 else { return 0 }
  return min(value, 120)
}

private func migrateLegacyFileIfNeeded(from legacyURL: URL, to currentURL: URL, fileManager: FileManager = .default) throws {
  guard fileManager.fileExists(atPath: legacyURL.path), !fileManager.fileExists(atPath: currentURL.path) else { return }
  try fileManager.createDirectory(at: currentURL.deletingLastPathComponent(), withIntermediateDirectories: true)
  try fileManager.moveItem(at: legacyURL, to: currentURL)
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

@MainActor
final class PodcastRepository: ObservableObject {
  private let store: SQLiteObjectStore

  init(store: SQLiteObjectStore) {
    self.store = store
  }

  static func live() throws -> PodcastRepository {
    let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let legacyURL = appSupport.appending(path: "ElephantPod/elephant-pod.sqlite")
    let currentURL = appSupport.appending(path: "DaisyPod/daisypod.sqlite")
    try migrateLegacyFileIfNeeded(from: legacyURL, to: currentURL)
    return PodcastRepository(store: try SQLiteObjectStore(url: currentURL))
  }

  static func inMemoryForTests() throws -> PodcastRepository {
    PodcastRepository(store: try SQLiteObjectStore(url: URL(fileURLWithPath: "/tmp/daisy-pod-tests-\(UUID().uuidString).sqlite")))
  }

  func ensureSeedData() throws {
    if try store.get(AppSettings.self, id: "local", collection: "settings") == nil {
      try saveSettings(AppSettings())
    }
    guard try store.count(collection: "feeds") == 0 else { return }
    for podcast in SeedData.podcasts {
      try store.put(podcast, id: podcast.id, collection: "feeds", updatedAt: podcast.updatedAt)
      let preference = PodcastPreference(
        podcastId: podcast.id,
        inLibrary: true,
        wasSubscribedBeforeLibraryRemoval: false,
        sortDirection: .newest,
        addNewEpisodesToInbox: true,
        updatedAt: Date()
      )
      try store.put(preference, id: podcast.id, collection: "podcastPreferences", updatedAt: preference.updatedAt)
    }
    for (index, episode) in SeedData.episodes.enumerated() {
      try store.put(episode, id: episode.id, collection: "episodes", updatedAt: episode.updatedAt)
      let state = SeedData.defaultState(for: episode.id, index: index)
      try store.put(state, id: episode.id, collection: "states", updatedAt: state.updatedAt)
    }
    try store.put(ListeningStats(), id: "local", collection: "listeningStats")
  }

  #if DEBUG
  func resetForUITests() throws {
    try store.deleteAllObjects()
    try ensureSeedData()
  }
  #endif

  func settings() throws -> AppSettings {
    try store.get(AppSettings.self, id: "local", collection: "settings") ?? AppSettings()
  }

  func saveSettings(_ settings: AppSettings) throws {
    var next = settings
    next.id = "local"
    next.updatedAt = Date()
    try store.put(next, id: "local", collection: "settings", updatedAt: next.updatedAt)
  }

  func saveSleepTimerDeadline(_ deadline: Date?) throws {
    var next = try settings()
    next.id = "local"
    next.sleepTimerEndsAt = deadline
    try store.put(next, id: "local", collection: "settings", updatedAt: next.updatedAt)
  }

  func podcasts() throws -> [Podcast] {
    try store.list(Podcast.self, collection: "feeds").sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
  }

  func podcastPreferences() throws -> [PodcastPreference] {
    try store.list(PodcastPreference.self, collection: "podcastPreferences")
  }

  func podcastPreference(for podcastId: String) throws -> PodcastPreference {
    try store.get(PodcastPreference.self, id: podcastId, collection: "podcastPreferences") ?? PodcastPreference(
      podcastId: podcastId,
      inLibrary: true,
      wasSubscribedBeforeLibraryRemoval: false,
      sortDirection: .newest,
      addNewEpisodesToInbox: true,
      updatedAt: Date()
    )
  }

  func updatePodcastPreference(_ podcastId: String, patch: (inout PodcastPreference) -> Void) throws {
    var preference = try podcastPreference(for: podcastId)
    patch(&preference)
    preference.updatedAt = Date()
    try store.put(preference, id: podcastId, collection: "podcastPreferences", updatedAt: preference.updatedAt)
  }

  func addPodcastToLibrary(_ podcastId: String) throws {
    var preference = try podcastPreference(for: podcastId)
    let shouldResubscribe = preference.wasSubscribedBeforeLibraryRemoval == true
    preference.inLibrary = true
    preference.wasSubscribedBeforeLibraryRemoval = false
    if shouldResubscribe {
      preference.addNewEpisodesToInbox = true
    }
    preference.updatedAt = Date()
    try store.put(preference, id: podcastId, collection: "podcastPreferences", updatedAt: preference.updatedAt)
  }

  func removePodcastFromLibrary(_ podcastId: String) throws {
    var preference = try podcastPreference(for: podcastId)
    let wasSubscribed = preference.addNewEpisodesToInbox
    preference.inLibrary = false
    preference.wasSubscribedBeforeLibraryRemoval = wasSubscribed || (preference.wasSubscribedBeforeLibraryRemoval == true)
    preference.addNewEpisodesToInbox = false
    preference.updatedAt = Date()
    try store.put(preference, id: podcastId, collection: "podcastPreferences", updatedAt: preference.updatedAt)

    for item in try episodes().filter({ $0.episode.podcastId == podcastId }) {
      try updateEpisodeState(item.id) { state in
        state.inboxState = .archived
        state.inboxPosition = nil
        state.queuePosition = nil
        state.queuedAt = nil
        state.downloaded = false
        state.downloadedAt = nil
        state.downloadPath = nil
        state.downloadBytes = nil
        state.downloadBackend = nil
        state.downloadSource = nil
      }
    }
    try normalizeQueuePositions()
    try normalizeInboxPositions()
  }

  func subscribePodcast(_ podcastId: String) throws {
    try updatePodcastPreference(podcastId) { preference in
      preference.inLibrary = true
      preference.wasSubscribedBeforeLibraryRemoval = false
      preference.addNewEpisodesToInbox = true
    }
  }

  func unsubscribePodcast(_ podcastId: String) throws {
    try updatePodcastPreference(podcastId) { preference in
      preference.inLibrary = true
      preference.addNewEpisodesToInbox = false
    }
  }

  func clips() throws -> [Clip] {
    try store.list(Clip.self, collection: "clips").sorted { $0.createdAt > $1.createdAt }
  }

  func silenceMaps() throws -> [SilenceMap] {
    try store.list(SilenceMap.self, collection: "silenceMaps").sorted { $0.updatedAt > $1.updatedAt }
  }

  func smartSkipMaps() throws -> [SmartSkipMapCacheEntry] {
    try store.list(SmartSkipMapCacheEntry.self, collection: "smartSkipMaps").sorted { $0.updatedAt > $1.updatedAt }
  }

  func cachedSilenceMap(for episode: EpisodeWithState) throws -> SilenceMap? {
    try silenceMaps().first { $0.episodeId == episode.id && $0.audioUrl == episode.episode.audioUrl }
  }

  func cachedSmartSkipEntry(for episode: EpisodeWithState) throws -> SmartSkipMapCacheEntry? {
    try store.get(SmartSkipMapCacheEntry.self, id: smartSkipCacheId(episodeId: episode.id, audioUrl: episode.episode.audioUrl), collection: "smartSkipMaps")
  }

  func listeningStats() throws -> ListeningStats {
    try store.get(ListeningStats.self, id: "local", collection: "listeningStats") ?? ListeningStats()
  }

  func saveListeningStats(_ stats: ListeningStats) throws {
    var next = stats
    next.id = "local"
    next.updatedAt = Date()
    try store.put(next, id: "local", collection: "listeningStats", updatedAt: next.updatedAt)
  }

  func addListeningSample(
    episode: EpisodeWithState,
    listeningSec rawListeningSec: TimeInterval,
    contentSec rawContentSec: TimeInterval,
    speedSavedSec rawSpeedSavedSec: TimeInterval,
    silenceSavedSec rawSilenceSavedSec: TimeInterval
  ) throws {
    let listeningSec = clampTelemetry(rawListeningSec)
    let contentSec = clampTelemetry(rawContentSec)
    let speedSavedSec = clampTelemetry(rawSpeedSavedSec)
    let silenceSavedSec = clampTelemetry(rawSilenceSavedSec)
    guard listeningSec > 0 || contentSec > 0 || speedSavedSec > 0 || silenceSavedSec > 0 else { return }

    var stats = try listeningStats()
    let timestamp = Date()
    var podcastStats = stats.byPodcast[episode.episode.podcastId] ?? PodcastListeningStats(
      podcastId: episode.episode.podcastId,
      podcastTitle: episode.episode.podcastTitle
    )

    stats.listeningSec += listeningSec
    stats.contentSec += contentSec
    stats.speedSavedSec += speedSavedSec
    stats.silenceSavedSec += silenceSavedSec
    stats.updatedAt = timestamp

    podcastStats.podcastTitle = episode.episode.podcastTitle
    podcastStats.listeningSec += listeningSec
    podcastStats.contentSec += contentSec
    podcastStats.speedSavedSec += speedSavedSec
    podcastStats.silenceSavedSec += silenceSavedSec
    stats.byPodcast[episode.episode.podcastId] = podcastStats

    try store.put(stats, id: "local", collection: "listeningStats", updatedAt: timestamp)
  }

  func tombstones() throws -> [SyncTombstone] {
    try store.list(SyncTombstone.self, collection: "tombstones")
  }

  func syncActions(includePushed: Bool = true) throws -> [SyncAction] {
    let actions = sortedSyncActions(try store.list(SyncAction.self, collection: "syncActions"))
    return includePushed ? actions : actions.filter { $0.pushedAt == nil }
  }

  func upsertParsedFeed(_ result: ParsedFeedResult) throws {
    let timestamp = Date()
    var podcast = result.podcast
    podcast.lastRefreshedAt = timestamp
    podcast.updatedAt = timestamp
    try store.put(podcast, id: podcast.id, collection: "feeds", updatedAt: timestamp)

    var preference = try store.get(PodcastPreference.self, id: podcast.id, collection: "podcastPreferences") ?? PodcastPreference(
      podcastId: podcast.id,
      inLibrary: true,
      wasSubscribedBeforeLibraryRemoval: false,
      sortDirection: .newest,
      addNewEpisodesToInbox: true,
      updatedAt: timestamp
    )
    preference.inLibrary = true
    preference.wasSubscribedBeforeLibraryRemoval = false
    preference.updatedAt = timestamp
    try store.put(preference, id: podcast.id, collection: "podcastPreferences", updatedAt: timestamp)

    for episode in result.episodes {
      var nextEpisode = episode
      nextEpisode.podcastId = podcast.id
      nextEpisode.podcastTitle = podcast.title
      nextEpisode.updatedAt = timestamp
      try store.put(nextEpisode, id: nextEpisode.id, collection: "episodes", updatedAt: timestamp)

      if try store.get(EpisodeState.self, id: nextEpisode.id, collection: "states") == nil {
        let state = EpisodeState(
          episodeId: nextEpisode.id,
          played: false,
          progressSec: 0,
          inboxState: preference.addNewEpisodesToInbox ? .new : .archived,
          inboxPosition: preference.addNewEpisodesToInbox ? try nextInboxPosition() : nil,
          downloaded: false,
          favorite: false,
          clipCount: 0,
          updatedAt: timestamp
        )
        try store.put(state, id: nextEpisode.id, collection: "states", updatedAt: timestamp)
      }
    }
    try normalizeInboxPositions()
  }

  func exportOPML() throws -> String {
    try OPMLCodec.export(podcasts: podcasts())
  }

  func importOPML(_ data: Data, serverUrl: String?) async throws -> Int {
    let subscriptions = try OPMLCodec.parse(data)
    var importedCount = 0
    for subscription in subscriptions {
      guard URL(string: subscription.feedUrl)?.scheme != nil else { continue }
      let parsed = try await NativeRSSClient.importFeed(feedUrl: subscription.feedUrl, serverUrl: serverUrl)
      try upsertParsedFeed(parsed)
      importedCount += 1
    }
    return importedCount
  }

  func exportBackup() throws -> DaisyPodBackup {
    DaisyPodBackup(
      version: DaisyPodBackup.currentVersion,
      exportedAt: Date(),
      feeds: try podcasts(),
      episodes: try episodes().map(\.episode),
      states: try episodes().map(\.state),
      podcastPreferences: try podcastPreferences(),
      clips: try clips(),
      silenceMaps: try silenceMaps(),
      smartSkipMaps: try smartSkipMaps(),
      tombstones: try tombstones(),
      syncActions: try syncActions(),
      settings: try settings(),
      listeningStats: try listeningStats()
    ).portable
  }

  func restoreBackup(_ backup: DaisyPodBackup) throws {
    let currentSettings = try settings()
    let timestamp = Date()
    for feed in backup.feeds {
      try store.put(feed, id: feed.id, collection: "feeds", updatedAt: feed.updatedAt)
    }
    for episode in backup.episodes {
      try store.put(episode, id: episode.id, collection: "episodes", updatedAt: episode.updatedAt)
    }
    for restoredState in backup.states {
      var state = restoredState
      if let local = try store.get(EpisodeState.self, id: state.episodeId, collection: "states") {
        state.downloaded = local.downloaded
        state.downloadedAt = local.downloadedAt
        state.downloadPath = local.downloadPath
        state.downloadBytes = local.downloadBytes
        state.downloadBackend = local.downloadBackend
        state.downloadSource = local.downloadSource
      } else {
        state.downloaded = false
        state.downloadedAt = nil
        state.downloadPath = nil
        state.downloadBytes = nil
        state.downloadBackend = nil
        state.downloadSource = nil
      }
      try store.put(state, id: state.episodeId, collection: "states", updatedAt: state.updatedAt)
    }
    for preference in backup.podcastPreferences {
      try store.put(preference, id: preference.podcastId, collection: "podcastPreferences", updatedAt: preference.updatedAt)
    }
    for clip in backup.clips {
      try store.put(clip, id: clip.id, collection: "clips", updatedAt: clip.updatedAt)
    }
    for silenceMap in backup.silenceMaps {
      try store.put(silenceMap, id: silenceMap.id, collection: "silenceMaps", updatedAt: silenceMap.updatedAt)
    }
    for smartSkipMap in backup.smartSkipMaps {
      try store.put(smartSkipMap, id: smartSkipMap.id, collection: "smartSkipMaps", updatedAt: smartSkipMap.updatedAt)
    }
    for tombstone in backup.tombstones {
      try store.put(tombstone, id: tombstone.id, collection: "tombstones", updatedAt: tombstone.deletedAt)
      try applyTombstoneIfCurrent(tombstone)
    }
    for action in backup.syncActions {
      try store.put(action, id: action.id, collection: "syncActions", updatedAt: action.createdAt)
    }
    if var stats = backup.listeningStats {
      stats.id = "local"
      try store.put(stats, id: "local", collection: "listeningStats", updatedAt: stats.updatedAt)
    }
    var restoredSettings = backup.settings
    restoredSettings.id = "local"
    restoredSettings.deviceId = currentSettings.deviceId
    restoredSettings.serverUrl = currentSettings.serverUrl
    restoredSettings.lastSyncAt = currentSettings.lastSyncAt
    restoredSettings.sleepTimerEndsAt = currentSettings.sleepTimerEndsAt
    restoredSettings.updatedAt = timestamp
    try saveSettings(restoredSettings)
    try normalizeQueuePositions()
    try normalizeInboxPositions()
  }

  private func sortedSyncActions(_ actions: [SyncAction]) -> [SyncAction] {
    actions.sorted {
      if $0.createdAt != $1.createdAt {
        return $0.createdAt < $1.createdAt
      }
      if $0.sequence != $1.sequence {
        return $0.sequence < $1.sequence
      }
      return $0.deviceId < $1.deviceId
    }
  }

  func episodes() throws -> [EpisodeWithState] {
    let episodes = try store.list(Episode.self, collection: "episodes")
    let states = Dictionary(uniqueKeysWithValues: try store.list(EpisodeState.self, collection: "states").map { ($0.episodeId, $0) })
    return episodes.map { episode in
      EpisodeWithState(episode: episode, state: states[episode.id] ?? SeedData.defaultState(for: episode.id))
    }
  }

  func updateEpisodeState(_ episodeId: String, patch: (inout EpisodeState) -> Void) throws {
    var state = try store.get(EpisodeState.self, id: episodeId, collection: "states") ?? SeedData.defaultState(for: episodeId)
    patch(&state)
    if state.queuePosition != nil {
      state.inboxState = .archived
      state.inboxPosition = nil
    }
    if state.inboxState == .new {
      state.queuePosition = nil
      state.queuedAt = nil
    }
    state.updatedAt = Date()
    try store.put(state, id: episodeId, collection: "states", updatedAt: state.updatedAt)
    try appendEpisodeStateAction(state)
    try normalizeQueuePositions()
    try normalizeInboxPositions()
  }

  func updateEpisodeMetadata(_ episodeId: String, patch: YouTubeEpisodePatch) throws {
    guard var episode = try store.get(Episode.self, id: episodeId, collection: "episodes") else { return }
    if let title = patch.title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      episode.title = title
    }
    if let description = patch.description {
      episode.description = description
    }
    if let websiteUrl = patch.websiteUrl {
      episode.websiteUrl = websiteUrl
    }
    if let imageUrl = patch.imageUrl {
      episode.imageUrl = imageUrl
    }
    if let publishedAt = patch.publishedAt {
      episode.publishedAt = publishedAt
    }
    if let durationSec = patch.durationSec {
      episode.durationSec = durationSec
    }
    if let sourceUrl = patch.sourceUrl {
      episode.sourceUrl = sourceUrl
    }
    if let externalId = patch.externalId {
      episode.externalId = externalId
    }
    if let extractionStatus = patch.extractionStatus {
      episode.extractionStatus = extractionStatus
    }
    episode.updatedAt = Date()
    try store.put(episode, id: episode.id, collection: "episodes", updatedAt: episode.updatedAt)
  }

  func saveClip(_ clip: Clip) throws {
    let existing = try store.get(Clip.self, id: clip.id, collection: "clips")
    var next = clip
    next.updatedAt = Date()
    try store.put(next, id: next.id, collection: "clips", updatedAt: next.updatedAt)
    if existing == nil {
      try updateEpisodeState(next.episodeId) { state in
        state.clipCount += 1
      }
    }
  }

  func saveSilenceMap(_ map: SilenceMap, requestedAt: Date? = nil, checkedAt: Date? = nil) throws {
    var next = map
    next.lastRequestedAt = requestedAt ?? next.lastRequestedAt
    next.lastCheckedAt = checkedAt ?? next.lastCheckedAt
    next.updatedAt = Date()
    try store.put(next, id: next.id, collection: "silenceMaps", updatedAt: next.updatedAt)
  }

  func saveSmartSkipSegmentMap(_ map: SmartSkipSegmentMap, transcript: SmartSkipTranscript? = nil) throws {
    let timestamp = Date()
    let existing = try store.get(SmartSkipMapCacheEntry.self, id: smartSkipCacheId(episodeId: map.episodeId, audioUrl: map.audioUrl), collection: "smartSkipMaps")
    let entry = SmartSkipMapCacheEntry(
      id: smartSkipCacheId(episodeId: map.episodeId, audioUrl: map.audioUrl),
      episodeId: map.episodeId,
      audioUrl: map.audioUrl,
      map: map,
      transcript: transcript ?? existing?.transcript,
      status: map.status,
      jobId: nil,
      reason: nil,
      error: nil,
      lastRequestedAt: nil,
      cachedAt: timestamp,
      updatedAt: timestamp
    )
    try store.put(entry, id: entry.id, collection: "smartSkipMaps", updatedAt: timestamp)
  }

  func saveSmartSkipStatus(for episode: EpisodeWithState, status: ServerCacheStatus, jobId: String?, reason: String?, error: String?) throws {
    let id = smartSkipCacheId(episodeId: episode.id, audioUrl: episode.episode.audioUrl)
    var entry = try store.get(SmartSkipMapCacheEntry.self, id: id, collection: "smartSkipMaps") ?? SmartSkipMapCacheEntry(
      id: id,
      episodeId: episode.id,
      audioUrl: episode.episode.audioUrl,
      map: nil,
      transcript: nil,
      status: status,
      jobId: nil,
      reason: nil,
      error: nil,
      lastRequestedAt: nil,
      cachedAt: Date(),
      updatedAt: Date()
    )
    if entry.status == .ready, status != .ready { return }
    entry.status = status
    entry.jobId = jobId ?? entry.jobId
    entry.reason = reason ?? entry.reason
    entry.error = error
    entry.lastRequestedAt = Date()
    entry.updatedAt = Date()
    try store.put(entry, id: id, collection: "smartSkipMaps", updatedAt: entry.updatedAt)
  }

  func playNow(_ episodeId: String) throws {
    let queue = try queuedEpisodes()
    for item in queue {
      try updateEpisodeState(item.id) { state in
        state.queuePosition = (state.queuePosition ?? 0) + 1
      }
    }
    try updateEpisodeState(episodeId) { state in
      state.queuePosition = 1
      state.queuedAt = Date()
      state.lastPlayedAt = Date()
    }
  }

  func addToQueueEnd(_ episodeId: String) throws {
    let next = ((try queuedEpisodes().map { $0.state.queuePosition ?? 0 }.max()) ?? 0) + 1
    try updateEpisodeState(episodeId) { state in
      state.queuePosition = next
      state.queuedAt = Date()
    }
  }

  func addToQueueNext(_ episodeId: String) throws {
    let allEpisodes = try episodes()
    guard let target = allEpisodes.first(where: { $0.id == episodeId }) else { return }
    var reordered = try queuedEpisodes().filter { $0.id != episodeId }
    let insertionIndex = min(1, reordered.count)
    reordered.insert(target, at: insertionIndex)

    let timestamp = Date()
    for (index, item) in reordered.enumerated() {
      var state = item.state
      let nextPosition = index + 1
      let isTarget = item.id == episodeId
      let shouldUpdate = isTarget
        || state.queuePosition != nextPosition
        || state.queuedAt == nil
        || state.inboxState != .archived
        || state.inboxPosition != nil
      guard shouldUpdate else { continue }
      state.queuePosition = nextPosition
      state.queuedAt = isTarget ? timestamp : (state.queuedAt ?? timestamp)
      state.inboxState = .archived
      state.inboxPosition = nil
      state.updatedAt = timestamp
      try store.put(state, id: state.episodeId, collection: "states", updatedAt: state.updatedAt)
      try appendEpisodeStateAction(state)
    }
    try normalizeQueuePositions()
  }

  func removeFromQueue(_ episodeId: String) throws {
    try updateEpisodeState(episodeId) { state in
      state.queuePosition = nil
      state.queuedAt = nil
    }
  }

  func moveQueueItems(from source: IndexSet, to destination: Int) throws {
    let current = try queuedEpisodes()
    let validSource = IndexSet(source.filter { current.indices.contains($0) })
    guard !validSource.isEmpty else { return }
    var reordered = current
    let movingItems = validSource.sorted().map { reordered[$0] }
    for index in validSource.sorted(by: >) {
      reordered.remove(at: index)
    }
    let removedBeforeDestination = validSource.filter { $0 < destination }.count
    let insertionIndex = max(0, min(destination - removedBeforeDestination, reordered.count))
    reordered.insert(contentsOf: movingItems, at: insertionIndex)

    for (index, item) in reordered.enumerated() {
      let nextPosition = index + 1
      guard item.state.queuePosition != nextPosition else { continue }
      var state = item.state
      state.queuePosition = nextPosition
      state.queuedAt = state.queuedAt ?? Date()
      state.inboxState = .archived
      state.inboxPosition = nil
      state.updatedAt = Date()
      try store.put(state, id: state.episodeId, collection: "states", updatedAt: state.updatedAt)
      try appendEpisodeStateAction(state)
    }
    try normalizeQueuePositions()
  }

  func removeFromInbox(_ episodeId: String) throws {
    try updateEpisodeState(episodeId) { state in
      state.inboxState = .archived
      state.inboxPosition = nil
    }
  }

  func sendEpisodeToInbox(_ episodeId: String) throws {
    try updateEpisodeState(episodeId) { state in
      state.queuePosition = nil
      state.queuedAt = nil
      state.inboxState = .new
      state.inboxPosition = Int.max
    }
  }

  func setFavorite(_ episodeId: String, favorite: Bool) throws {
    try updateEpisodeState(episodeId) { state in
      state.favorite = favorite
    }
  }

  func markPlayed(_ episodeId: String, played: Bool) throws {
    try updateEpisodeState(episodeId) { state in
      state.played = played
      state.playedAt = played ? Date() : nil
      if played {
        state.progressSec = 0
        state.inboxState = .archived
        state.inboxPosition = nil
      }
    }
  }

  func markAllInPodcast(_ podcastId: String, played: Bool) throws {
    let timestamp = Date()
    for item in try episodes().filter({ $0.episode.podcastId == podcastId }) {
      var state = item.state
      state.played = played
      state.playedAt = played ? timestamp : nil
      state.progressSec = 0
      if played {
        state.inboxState = .archived
        state.inboxPosition = nil
        state.queuePosition = nil
        state.queuedAt = nil
      }
      state.updatedAt = Date()
      try store.put(state, id: state.episodeId, collection: "states", updatedAt: state.updatedAt)
      try appendEpisodeStateAction(state)
    }
    try normalizeQueuePositions()
    try normalizeInboxPositions()
  }

  func sendAllUnplayedInPodcastToInbox(_ podcastId: String) throws {
    for item in try episodes().filter({ $0.episode.podcastId == podcastId && !$0.state.played }) {
      try updateEpisodeState(item.id) { state in
        state.inboxState = .new
        state.inboxPosition = Int.max
        state.queuePosition = nil
        state.queuedAt = nil
      }
    }
    try normalizeQueuePositions()
    try normalizeInboxPositions()
  }

  func setDownloaded(_ episodeId: String, path: String?, bytes: Int?, source: String? = "manual") throws {
    var state = try store.get(EpisodeState.self, id: episodeId, collection: "states") ?? SeedData.defaultState(for: episodeId)
    state.downloaded = path != nil
    state.downloadedAt = path == nil ? nil : Date()
    state.downloadPath = path
    state.downloadBytes = bytes
    state.downloadBackend = path == nil ? nil : "ios-filesystem"
    state.downloadSource = path == nil ? nil : source
    try store.put(state, id: episodeId, collection: "states", updatedAt: Date())
  }

  func automaticDownloadCandidates(settings: AppSettings, limit: Int = 8) throws -> [(episode: EpisodeWithState, source: String)] {
    var candidates: [(episode: EpisodeWithState, source: String)] = []
    if settings.autoDownload {
      candidates += try queuedEpisodes()
        .filter { !$0.state.downloaded }
        .map { (episode: $0, source: "queue") }
    }
    if settings.autoDownloadInbox {
      candidates += try inboxEpisodes(settings: settings)
        .filter { !$0.state.downloaded && !$0.state.played && $0.state.queuePosition == nil }
        .map { (episode: $0, source: "inbox") }
    }
    return Array(candidates.prefix(limit))
  }

  func inactiveDownloadedEpisodes(settings: AppSettings) throws -> [EpisodeWithState] {
    guard settings.autoDeleteAfterListen else { return [] }
    return try episodes().filter { shouldDeleteInactiveDownload($0) }
  }

  func downloadPruneCandidates(settings: AppSettings) throws -> [EpisodeWithState] {
    let downloaded = try episodes().filter { $0.state.downloaded }
    let queueRanks = Dictionary(uniqueKeysWithValues: try queuedEpisodes().enumerated().map { ($0.element.id, $0.offset + 1) })
    let inboxRanks = Dictionary(uniqueKeysWithValues: try inboxEpisodes(settings: settings).enumerated().map { ($0.element.id, $0.offset + 1) })
    return downloaded.sorted { lhs, rhs in
      storagePriority(lhs, queueRanks: queueRanks, inboxRanks: inboxRanks) < storagePriority(rhs, queueRanks: queueRanks, inboxRanks: inboxRanks)
    }
  }

  func downloadedStorageBytes() throws -> Int {
    try downloadedEpisodes().reduce(0) { total, item in
      total + (item.state.downloadBytes ?? estimatedDownloadBytes(item))
    }
  }

  func estimatedDownloadBytes(_ episode: EpisodeWithState) -> Int {
    episode.episode.enclosureLength ?? Int(max(episode.episode.durationSec ?? 1, 1) * 32_000)
  }

  func queuedEpisodes() throws -> [EpisodeWithState] {
    try episodes()
      .filter { $0.state.queuePosition != nil }
      .sorted { ($0.state.queuePosition ?? Int.max) < ($1.state.queuePosition ?? Int.max) }
  }

  func inboxEpisodes(settings: AppSettings) throws -> [EpisodeWithState] {
    let values = try episodes().filter { $0.state.inboxState == .new && !$0.state.played && $0.state.queuePosition == nil }
    switch settings.inboxSortDirection {
    case .newest:
      return values.sorted { $0.episode.publishedAt > $1.episode.publishedAt }
    case .oldest:
      return values.sorted { $0.episode.publishedAt < $1.episode.publishedAt }
    }
  }

  func podcastEpisodes(_ podcastId: String, filter: PodcastEpisodeFilter = .all) throws -> [EpisodeWithState] {
    let preference = try podcastPreference(for: podcastId)
    let values = try episodes()
      .filter { $0.episode.podcastId == podcastId }
      .filter { item in
        switch filter {
        case .all:
          return true
        case .unplayed:
          return !item.state.played
        case .played:
          return item.state.played
        }
      }
    switch preference.sortDirection {
    case .newest:
      return values.sorted { $0.episode.publishedAt > $1.episode.publishedAt }
    case .oldest:
      return values.sorted { $0.episode.publishedAt < $1.episode.publishedAt }
    }
  }

  func downloadedEpisodes() throws -> [EpisodeWithState] {
    try episodes().filter { $0.state.downloaded }.sorted { ($0.state.downloadedAt ?? .distantPast) > ($1.state.downloadedAt ?? .distantPast) }
  }

  func staleDownloadedEpisodes(fileExists: (String) -> Bool) throws -> [EpisodeWithState] {
    try downloadedEpisodes().filter { episode in
      guard let path = episode.state.downloadPath, !path.isEmpty else { return true }
      return !fileExists(path)
    }
  }

  func history() throws -> [EpisodeWithState] {
    try episodes().filter { $0.state.lastPlayedAt != nil || $0.state.playedAt != nil }.sorted {
      ($0.state.lastPlayedAt ?? $0.state.playedAt ?? .distantPast) > ($1.state.lastPlayedAt ?? $1.state.playedAt ?? .distantPast)
    }
  }

  private func shouldDeleteInactiveDownload(_ episode: EpisodeWithState) -> Bool {
    guard episode.state.downloaded, !episode.state.favorite else { return false }
    if episode.state.queuePosition != nil { return false }
    if episode.state.inboxState == .new && episode.state.inboxPosition != nil && !episode.state.played { return false }
    return true
  }

  private func storagePriority(_ episode: EpisodeWithState, queueRanks: [String: Int], inboxRanks: [String: Int]) -> Int {
    if episode.state.favorite { return 1_000_000 }
    if let rank = queueRanks[episode.id] { return 500_000 - rank }
    if let rank = inboxRanks[episode.id] { return 250_000 - rank }
    return 0
  }

  private func normalizeQueuePositions() throws {
    let queue = try queuedEpisodes()
    for (index, item) in queue.enumerated() where item.state.queuePosition != index + 1 {
      var state = item.state
      state.queuePosition = index + 1
      try store.put(state, id: state.episodeId, collection: "states", updatedAt: state.updatedAt)
    }
  }

  private func normalizeInboxPositions() throws {
    let inbox = try episodes().filter { $0.state.inboxState == .new && $0.state.queuePosition == nil }.sorted {
      ($0.state.inboxPosition ?? Int.max) < ($1.state.inboxPosition ?? Int.max)
    }
    for (index, item) in inbox.enumerated() where item.state.inboxPosition != index + 1 {
      var state = item.state
      state.inboxPosition = index + 1
      try store.put(state, id: state.episodeId, collection: "states", updatedAt: state.updatedAt)
    }
  }

  private func nextInboxPosition() throws -> Int {
    let maxPosition = try store.list(EpisodeState.self, collection: "states").compactMap(\.inboxPosition).max() ?? 0
    return maxPosition + 1
  }

  private func appendEpisodeStateAction(_ state: EpisodeState) throws {
    let settings = try settings()
    let sequence = (try store.list(SyncAction.self, collection: "syncActions").map(\.sequence).max() ?? 0) + 1
    let action = SyncAction(
      id: UUID().uuidString,
      deviceId: settings.deviceId,
      sequence: sequence,
      entityType: "episode_state",
      entityId: state.episodeId,
      actionType: "episode-state-updated",
      payload: .init(state: SyncUploadState(state)),
      createdAt: Date()
    )
    try store.put(action, id: action.id, collection: "syncActions", updatedAt: action.createdAt)
  }

  private func applyTombstoneIfCurrent(_ tombstone: SyncTombstone) throws {
    guard try tombstoneIsAtLeastAsCurrentAsLocalRecord(tombstone) else { return }
    switch tombstone.tableName {
    case "subscriptions":
      try store.delete(id: tombstone.localId, collection: "feeds")
    case "episodes":
      try store.delete(id: tombstone.localId, collection: "episodes")
      try store.delete(id: tombstone.localId, collection: "states")
      try deleteDerivedEpisodeCaches(episodeId: tombstone.localId)
    case "episode_states":
      try store.delete(id: tombstone.localId, collection: "states")
    case "clips":
      try store.delete(id: tombstone.localId, collection: "clips")
    default:
      break
    }
  }

  private func tombstoneIsAtLeastAsCurrentAsLocalRecord(_ tombstone: SyncTombstone) throws -> Bool {
    switch tombstone.tableName {
    case "subscriptions":
      guard let podcast = try store.get(Podcast.self, id: tombstone.localId, collection: "feeds") else { return true }
      return tombstone.deletedAt >= podcast.updatedAt
    case "episodes":
      let episode = try store.get(Episode.self, id: tombstone.localId, collection: "episodes")
      let state = try store.get(EpisodeState.self, id: tombstone.localId, collection: "states")
      let newestLocal = [episode?.updatedAt, state?.updatedAt].compactMap { $0 }.max()
      guard let newestLocal else { return true }
      return tombstone.deletedAt >= newestLocal
    case "episode_states":
      guard let state = try store.get(EpisodeState.self, id: tombstone.localId, collection: "states") else { return true }
      return tombstone.deletedAt >= state.updatedAt
    case "clips":
      guard let clip = try store.get(Clip.self, id: tombstone.localId, collection: "clips") else { return true }
      return tombstone.deletedAt >= clip.updatedAt
    default:
      return false
    }
  }

  private func smartSkipCacheId(episodeId: String, audioUrl: String) -> String {
    stableId("\(episodeId):\(audioUrl)", prefix: "ssk")
  }

  private func deleteDerivedEpisodeCaches(episodeId: String) throws {
    for map in try silenceMaps() where map.episodeId == episodeId {
      try store.delete(id: map.id, collection: "silenceMaps")
    }
    for entry in try smartSkipMaps() where entry.episodeId == episodeId {
      try store.delete(id: entry.id, collection: "smartSkipMaps")
    }
  }
}
