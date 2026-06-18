import Foundation
import UIKit

struct RSSImporting {
  var importFeed: @MainActor (String, String?) async throws -> ParsedFeedResult

  static let live = RSSImporting { feedUrl, serverUrl in
    try await NativeRSSClient.importFeed(feedUrl: feedUrl, serverUrl: serverUrl)
  }
}

struct SyncDiagnostics: Hashable {
  var pendingActionCount: Int = 0
  var retainedSyncedActionCount: Int = 0
  var subscriptionCount: Int = 0
  var episodeCount: Int = 0
  var tombstoneCount: Int = 0
}

@MainActor
final class AppModel: ObservableObject {
  @Published var settings = AppSettings()
  @Published var podcasts: [Podcast] = []
  @Published var episodes: [EpisodeWithState] = []
  @Published var clips: [Clip] = []
  @Published var silenceMaps: [SilenceMap] = []
  @Published var smartSkipMaps: [SmartSkipMapCacheEntry] = []
  @Published var listeningStats = ListeningStats()
  @Published var selectedTab: SectionKey = .inbox
  @Published var status: String?
  @Published var addPodcastDraft = ""
  @Published var importingFeed = false
  @Published var syncing = false
  @Published var importingPortableData = false
  @Published var podcastSearchResults: [PodcastDiscoveryResult] = []
  @Published var searchingPodcasts = false
  @Published var importingYouTube = false
  @Published var youtubeProcessingEpisodeIds: Set<String> = []
  @Published var downloadingEpisodeIds: Set<String> = []
  @Published var publishingClipEpisodeIds: Set<String> = []
  @Published var processingIntelligenceEpisodeIds: Set<String> = []
  @Published var refreshingPodcastIds: Set<String> = []
  @Published var autoRefreshingFeeds = false
  @Published var runningDownloadMaintenance = false
  @Published var backendCapabilities: BackendCapabilities?
  @Published var appleAccountState: AppleAccountState = .checking
  @Published var backendSession: BackendSession? = BackendSessionStore.load()
  @Published var signingInWithApple = false
  @Published private(set) var sleepTimerEndsAt: Date?

  let repository: PodcastRepository
  private let downloadManager: NativeDownloadManager
  private let backgroundDownloadScheduler: BackgroundDownloadScheduling
  private let rssImporter: RSSImporting
  private let appleAccountStatusProvider: AppleAccountStatusProviding
  private let podcastRefreshCooldown: TimeInterval
  let audio = NativeAudioEngine()
  private var sleepTimerTask: Task<Void, Never>?
  private var lastPodcastRefreshAt: [String: Date] = [:]
  private var lastPersistedPlaybackProgress: (episodeId: String, second: Int)?

  init(
    repository: PodcastRepository,
    downloadManager: NativeDownloadManager = NativeDownloadManager(),
    backgroundDownloadScheduler: BackgroundDownloadScheduling = NoopBackgroundDownloadScheduler(),
    rssImporter: RSSImporting = .live,
    appleAccountStatusProvider: AppleAccountStatusProviding = .live,
    podcastRefreshCooldown: TimeInterval = 20
  ) {
    self.repository = repository
    self.downloadManager = downloadManager
    self.backgroundDownloadScheduler = backgroundDownloadScheduler
    self.rssImporter = rssImporter
    self.appleAccountStatusProvider = appleAccountStatusProvider
    self.podcastRefreshCooldown = podcastRefreshCooldown
    audio.onEnded = { [weak self] in
      self?.handlePlaybackEnded()
    }
    audio.onPlaybackTelemetry = { [weak self] sample in
      self?.recordPlaybackTelemetry(sample)
    }
  }

  deinit {
    sleepTimerTask?.cancel()
  }

  var inbox: [EpisodeWithState] {
    offlineFiltered((try? repository.inboxEpisodes(settings: settings)) ?? [])
  }

  var queue: [EpisodeWithState] {
    offlineFiltered((try? repository.queuedEpisodes()) ?? [])
  }

  var downloads: [EpisodeWithState] {
    (try? repository.downloadedEpisodes()) ?? []
  }

  var history: [EpisodeWithState] {
    offlineFiltered((try? repository.history()) ?? [])
  }

  var topListeningPodcasts: [PodcastListeningStats] {
    listeningStats.byPodcast.values
      .filter { $0.listeningSec > 0 || $0.contentSec > 0 || $0.speedSavedSec > 0 || $0.silenceSavedSec > 0 }
      .sorted {
        if $0.listeningSec == $1.listeningSec {
          return $0.podcastTitle.localizedCaseInsensitiveCompare($1.podcastTitle) == .orderedAscending
        }
        return $0.listeningSec > $1.listeningSec
      }
  }

  var libraryPodcasts: [Podcast] {
    let visible = podcasts.filter { isPodcastInLibrary($0) }
    guard settings.offlineMode else { return visible }
    let downloadedPodcastIds = Set(downloads.map(\.episode.podcastId))
    return visible.filter { downloadedPodcastIds.contains($0.id) }
  }

  func libraryPodcasts(matching rawQuery: String) -> [Podcast] {
    let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return libraryPodcasts }
    let foldedQuery = query.searchFolded
    return libraryPodcasts.filter { podcast in
      [
        podcast.title,
        podcast.author,
        podcast.description,
        podcast.feedUrl,
        podcast.websiteUrl,
        podcast.sourceUrl,
        podcast.externalId,
        podcast.tags.joined(separator: " ")
      ]
        .compactMap(\.self)
        .contains { $0.searchFolded.contains(foldedQuery) }
    }
  }

  func podcastPreference(for podcast: Podcast) -> PodcastPreference {
    (try? repository.podcastPreference(for: podcast.id)) ?? PodcastPreference(
      podcastId: podcast.id,
      inLibrary: true,
      wasSubscribedBeforeLibraryRemoval: false,
      sortDirection: .newest,
      addNewEpisodesToInbox: true,
      updatedAt: Date()
    )
  }

  func podcast(id: String) -> Podcast? {
    podcasts.first { $0.id == id }
  }

  func podcast(for episode: EpisodeWithState) -> Podcast? {
    podcast(id: episode.episode.podcastId)
  }

  func effectivePlaybackSettings(for episode: EpisodeWithState) -> AppSettings {
    var effective = settings
    guard let preference = try? repository.podcastPreference(for: episode.episode.podcastId) else {
      return effective
    }
    if let playbackRate = preference.playbackRate {
      effective.playbackRate = playbackRate
    }
    if let skipForwardSec = preference.skipForwardSec {
      effective.skipForwardSec = skipForwardSec
    }
    if let skipBackSec = preference.skipBackSec {
      effective.skipBackSec = skipBackSec
    }
    if let silenceShortening = preference.silenceShortening {
      effective.silenceShortening = silenceShortening
    }
    if let smartSkipEnabled = preference.smartSkipEnabled {
      effective.smartSkipEnabled = smartSkipEnabled
    }
    if let smartSkipCommercials = preference.smartSkipCommercials {
      effective.smartSkipCommercials = smartSkipCommercials
    }
    if let smartSkipSelfPromo = preference.smartSkipSelfPromo {
      effective.smartSkipSelfPromo = smartSkipSelfPromo
    }
    if let smartSkipIntros = preference.smartSkipIntros {
      effective.smartSkipIntros = smartSkipIntros
    }
    if let smartSkipOutros = preference.smartSkipOutros {
      effective.smartSkipOutros = smartSkipOutros
    }
    if let smartSkipIncludeSoftMatches = preference.smartSkipIncludeSoftMatches {
      effective.smartSkipIncludeSoftMatches = smartSkipIncludeSoftMatches
    }
    return effective
  }

  func isPodcastInLibrary(_ podcast: Podcast) -> Bool {
    podcastPreference(for: podcast).inLibrary != false
  }

  func isPodcastSubscribed(_ podcast: Podcast) -> Bool {
    podcastPreference(for: podcast).addNewEpisodesToInbox
  }

  func podcastEpisodes(for podcast: Podcast, filter: PodcastEpisodeFilter = .all) -> [EpisodeWithState] {
    offlineFiltered((try? repository.podcastEpisodes(podcast.id, filter: filter)) ?? [])
  }

  var appleAccountAvailable: Bool {
    appleAccountState == .available
  }

  var appleAccountStatusText: String {
    switch appleAccountState {
    case .checking:
      return "Checking iCloud sync"
    case .available:
      return "iCloud sync available"
    case .noAccount:
      return "iCloud sync not active"
    case .restricted:
      return "iCloud sync restricted"
    case .couldNotDetermine:
      return "iCloud sync not active"
    case .temporarilyUnavailable:
      return "iCloud sync temporarily unavailable"
    }
  }

  var podcastIndexAvailable: Bool {
    backendCapabilities?.podcastIndex?.enabled != false
  }

  var youtubeImportAvailable: Bool {
    backendCapabilities?.youtubeImport?.enabled != false
  }

  var clipPublishingAvailable: Bool {
    backendCapabilities?.clips?.enabled != false
  }

  var silenceMapsAvailable: Bool {
    backendCapabilities?.silenceMaps?.enabled != false
  }

  var smartSkipProcessingAvailable: Bool {
    backendCapabilities?.smartSkip?.enabled != false
  }

  var backendAccountStatusText: String {
    if let email = backendSession?.account.email, !email.isEmpty {
      return "Signed in as \(email)"
    }
    if backendSession != nil {
      return "Signed in with Apple"
    }
    return "Not signed in"
  }

  var syncDiagnostics: SyncDiagnostics {
    do {
      let actions = try repository.syncActions()
      return SyncDiagnostics(
        pendingActionCount: actions.filter { $0.pushedAt == nil }.count,
        retainedSyncedActionCount: actions.filter { $0.pushedAt != nil }.count,
        subscriptionCount: try repository.podcasts().count,
        episodeCount: try repository.episodes().count,
        tombstoneCount: try repository.tombstones().count
      )
    } catch {
      return SyncDiagnostics()
    }
  }

  func start() {
    do {
      try repository.ensureSeedData()
      try refresh()
      #if DEBUG
      try applyUITestLaunchArguments()
      if ProcessInfo.processInfo.arguments.contains("--daisy-ui-test-player"), queue.isEmpty, let firstEpisode = episodes.first {
        try repository.addToQueueEnd(firstEpisode.id)
        try refresh()
      }
      #endif
      cueFirstQueuedEpisodeIfNeeded()
      status = "Local library ready."
      restoreSleepTimerIfNeeded()
      configureBackgroundDownloadMaintenance()
      refreshAppleAccountStatus()
      refreshBackendCapabilities()
      runDownloadMaintenance()
      consumePendingAppIntentHandoff()
    } catch {
      status = "Startup failed: \(error.localizedDescription)"
    }
  }

  #if DEBUG
  private func applyUITestLaunchArguments() throws {
    let arguments = ProcessInfo.processInfo.arguments
    if arguments.contains("--daisy-ui-test-reset-store") {
      try repository.resetForUITests()
      try refresh()
    }
    if arguments.contains("--daisy-ui-test-downloaded-seed"), let firstEpisode = episodes.first {
      let url = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-ui-test-\(firstEpisode.id).mp3")
      try Data("ui-test-download".utf8).write(to: url, options: .atomic)
      try repository.setDownloaded(firstEpisode.id, path: url.path, bytes: 16, source: "ui-test")
      try refresh()
    }
    if arguments.contains("--daisy-ui-test-offline-mode-off") {
      try repository.saveOfflineMode(false)
      try refresh()
    }
    if arguments.contains("--daisy-ui-test-offline-mode") {
      try repository.saveOfflineMode(true)
      try refresh()
    }
    if let tabArgument = arguments.first(where: { $0.hasPrefix("--daisy-ui-test-tab=") }) {
      let rawTab = String(tabArgument.dropFirst("--daisy-ui-test-tab=".count))
      if let tab = SectionKey(rawValue: rawTab) {
        selectedTab = tab
      }
    }
    if let serverURLArgument = arguments.first(where: { $0.hasPrefix("--daisy-ui-test-server-url=") }) {
      let rawServerURL = String(serverURLArgument.dropFirst("--daisy-ui-test-server-url=".count))
      saveServerUrl(rawServerURL)
    }
    if let openURLArgument = arguments.first(where: { $0.hasPrefix("--daisy-ui-test-open-url=") }) {
      let rawURL = String(openURLArgument.dropFirst("--daisy-ui-test-open-url=".count))
      if let url = URL(string: rawURL) {
        handleOpenURL(url)
      }
    }
  }
  #endif

  func cueFirstQueuedEpisodeIfNeeded() {
    guard audio.current == nil, let firstQueued = queue.first else { return }
    let playbackSettings = effectivePlaybackSettings(for: firstQueued)
    audio.prepare(
      firstQueued,
      settings: playbackSettings,
      silenceMap: cachedSilenceMap(for: firstQueued),
      smartSkipEntry: cachedSmartSkipEntry(for: firstQueued),
      cachedArtworkURL: cachedArtworkURL(for: firstQueued),
      autoPlay: false
    )
  }

  func refresh() throws {
    settings = try repository.settings()
    podcasts = try repository.podcasts()
    episodes = try repository.episodes()
    clips = try repository.clips()
    silenceMaps = try repository.silenceMaps()
    smartSkipMaps = try repository.smartSkipMaps()
    listeningStats = try repository.listeningStats()
    refreshCurrentPlaybackIntelligence()
  }

  func appBecameActive() {
    consumePendingAppIntentHandoff()
    refreshAppleAccountStatus()
    runAutomaticPodcastRefresh()
    runDownloadMaintenance()
  }

  func play(_ episode: EpisodeWithState) {
    do {
      try repository.playNow(episode.id)
      try refresh()
      let refreshed = episodes.first { $0.id == episode.id } ?? episode
      let playbackSettings = effectivePlaybackSettings(for: refreshed)
      audio.prepare(
        refreshed,
        settings: playbackSettings,
        silenceMap: cachedSilenceMap(for: refreshed),
        smartSkipEntry: cachedSmartSkipEntry(for: refreshed),
        cachedArtworkURL: cachedArtworkURL(for: refreshed),
        autoPlay: true
      )
    } catch {
      status = "Could not play episode."
    }
  }

  func togglePlayPause() {
    if audio.current == nil {
      cueFirstQueuedEpisodeIfNeeded()
    }
    let playbackSettings = audio.current.map { effectivePlaybackSettings(for: $0) } ?? settings
    audio.isPlaying ? audio.pause() : audio.play(rate: playbackSettings.playbackRate)
  }

  func seekToChapter(_ chapter: Chapter, in episode: EpisodeWithState) {
    let target = max(0, min(chapter.startsAt, episode.episode.durationSec ?? chapter.startsAt))
    do {
      let refreshed = episodes.first { $0.id == episode.id } ?? episode
      if audio.current?.id != episode.id {
        let playbackSettings = effectivePlaybackSettings(for: refreshed)
        audio.prepare(
          refreshed,
          settings: playbackSettings,
          silenceMap: cachedSilenceMap(for: refreshed),
          smartSkipEntry: cachedSmartSkipEntry(for: refreshed),
          cachedArtworkURL: cachedArtworkURL(for: refreshed),
          autoPlay: false
        )
      }
      audio.seek(to: target)
      try repository.updateEpisodeState(episode.id) { state in
        state.progressSec = target
        state.lastPlayedAt = Date()
      }
      try refresh()
      status = "Jumped to \(chapter.title)."
    } catch {
      status = "Could not jump to chapter."
    }
  }

  func consumePendingAppIntentHandoff() {
    guard let payload = AppIntentHandoff.consume() else { return }
    handleAppIntentHandoff(payload)
  }

  func handleAppIntentHandoff(_ payload: AppIntentHandoffPayload) {
    switch payload.action {
    case .openSection:
      selectedTab = payload.section ?? .inbox
      status = "Opened \(selectedTab.title)."
    case .addPodcast:
      addPodcastDraft = payload.value ?? ""
      selectedTab = .search
      status = addPodcastDraft.isEmpty ? "Ready to add a podcast." : "Ready to add \(addPodcastDraft)."
    case .togglePlayback:
      togglePlayPause()
      status = audio.isPlaying ? "Playback started." : "Playback paused."
    case .syncNow:
      selectedTab = .settings
      syncNow()
    }
  }

  func recordPlaybackTelemetry(_ sample: PlaybackTelemetrySample) {
    do {
      let mediaDelta = sample.mediaDeltaSec
      let wallDelta = sample.wallDeltaSec
      if mediaDelta >= 5, mediaDelta < 120, wallDelta >= 2, wallDelta < 120 {
        let playbackSettings = effectivePlaybackSettings(for: sample.episode)
        let rate = max(1, playbackSettings.playbackRate)
        try repository.addListeningSample(
          episode: sample.episode,
          listeningSec: wallDelta,
          contentSec: mediaDelta,
          speedSavedSec: max(0, wallDelta * (rate - 1)),
          silenceSavedSec: playbackSettings.silenceShortening ? max(0, mediaDelta - wallDelta * rate) : 0
        )
        listeningStats = try repository.listeningStats()
      }

      let rounded = Int(floor(sample.mediaPositionSec))
      let shouldPersistProgress = rounded > 0
        && rounded % 15 == 0
        && (lastPersistedPlaybackProgress?.episodeId != sample.episode.id || lastPersistedPlaybackProgress?.second != rounded)
      if shouldPersistProgress {
        lastPersistedPlaybackProgress = (episodeId: sample.episode.id, second: rounded)
        try repository.updateEpisodeState(sample.episode.id) { state in
          state.progressSec = TimeInterval(rounded)
        }
        episodes = try repository.episodes()
      }
    } catch {
      status = "Could not save playback progress."
    }
  }

  func setSleepTimer(minutes: Int) {
    setSleepTimer(seconds: TimeInterval(max(1, minutes) * 60))
  }

  func setSleepTimer(seconds: TimeInterval) {
    let clampedSeconds = max(0.01, seconds)
    let endsAt = Date().addingTimeInterval(clampedSeconds)
    persistSleepTimer(deadline: endsAt)
    scheduleSleepTimer(until: endsAt)
    status = "Sleep timer set."
  }

  func cancelSleepTimer() {
    sleepTimerTask?.cancel()
    sleepTimerTask = nil
    persistSleepTimer(deadline: nil)
    status = "Sleep timer canceled."
  }

  func sleepTimerRemainingMinutes(now: Date = Date()) -> Int? {
    guard let sleepTimerEndsAt else { return nil }
    return max(1, Int(ceil(sleepTimerEndsAt.timeIntervalSince(now) / 60)))
  }

  private func restoreSleepTimerIfNeeded(now: Date = Date()) {
    guard let deadline = settings.sleepTimerEndsAt else { return }
    if deadline <= now {
      persistSleepTimer(deadline: nil)
      return
    }
    scheduleSleepTimer(until: deadline, now: now)
  }

  private func scheduleSleepTimer(until deadline: Date, now: Date = Date()) {
    let remainingSeconds = max(0.01, deadline.timeIntervalSince(now))
    sleepTimerTask?.cancel()
    sleepTimerEndsAt = deadline
    sleepTimerTask = Task { [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(remainingSeconds * 1_000_000_000))
      guard !Task.isCancelled else { return }
      await MainActor.run {
        guard let self, let deadline = self.sleepTimerEndsAt, deadline <= Date().addingTimeInterval(0.5) else { return }
        self.audio.pause()
        self.persistSleepTimer(deadline: nil)
        self.sleepTimerTask = nil
        self.status = "Sleep timer ended."
      }
    }
  }

  private func persistSleepTimer(deadline: Date?) {
    do {
      try repository.saveSleepTimerDeadline(deadline)
      settings = try repository.settings()
      sleepTimerEndsAt = settings.sleepTimerEndsAt
    } catch {
      sleepTimerEndsAt = deadline
      settings.sleepTimerEndsAt = deadline
      status = "Could not save sleep timer."
    }
  }

  func updateSettings(_ patch: (inout AppSettings) -> Void) {
    do {
      var next = settings
      patch(&next)
      try repository.saveSettings(next)
      try refresh()
      scheduleBackgroundDownloadMaintenance()
    } catch {
      status = "Could not save settings."
    }
  }

  func setOfflineMode(_ enabled: Bool) {
    do {
      try repository.saveOfflineMode(enabled)
      try refresh()
      status = enabled ? "Offline mode on." : "Offline mode off."
    } catch {
      settings.offlineMode = enabled
      status = "Could not save offline mode."
    }
  }

  private func offlineFiltered(_ values: [EpisodeWithState]) -> [EpisodeWithState] {
    settings.offlineMode ? values.filter { $0.state.downloaded } : values
  }

  func queueEpisode(_ episode: EpisodeWithState) {
    do {
      try repository.addToQueueEnd(episode.id)
      try refresh()
      status = "Added to queue."
      runDownloadMaintenance()
    } catch {
      status = "Could not queue episode."
    }
  }

  func playNext(_ episode: EpisodeWithState) {
    do {
      try repository.addToQueueNext(episode.id)
      try refresh()
      status = "Added to Play Next."
      runDownloadMaintenance()
    } catch {
      status = "Could not add to Play Next."
    }
  }

  func archiveInboxEpisode(_ episode: EpisodeWithState) {
    do {
      try repository.removeFromInbox(episode.id)
      try refresh()
      if settings.autoDownloadInbox && episode.state.downloadSource == "inbox" {
        deleteInboxDownload(episode)
        return
      }
      scheduleBackgroundDownloadMaintenance()
    } catch {
      status = "Could not archive episode."
    }
  }

  private func deleteInboxDownload(_ episode: EpisodeWithState) {
    guard episode.state.downloaded else {
      scheduleBackgroundDownloadMaintenance()
      return
    }
    guard !downloadingEpisodeIds.contains(episode.id) else { return }
    downloadingEpisodeIds.insert(episode.id)
    Task {
      do {
        _ = try downloadManager.delete(episodeId: episode.id, storedPath: episode.state.downloadPath)
        try repository.setDownloaded(episode.id, path: nil, bytes: nil, source: nil)
        try refresh()
        scheduleBackgroundDownloadMaintenance()
      } catch {
        status = "Could not delete Inbox download."
      }
      downloadingEpisodeIds.remove(episode.id)
    }
  }

  func removeQueueEpisode(_ episode: EpisodeWithState) {
    do {
      try repository.removeFromQueue(episode.id)
      try refresh()
      runDownloadMaintenance()
    } catch {
      status = "Could not remove from queue."
    }
  }

  func sendQueueEpisodeToInbox(_ episode: EpisodeWithState) {
    do {
      try repository.sendEpisodeToInbox(episode.id)
      try refresh()
      runDownloadMaintenance()
      status = "Moved to Inbox."
    } catch {
      status = "Could not move to Inbox."
    }
  }

  func sendEpisodeToInbox(_ episode: EpisodeWithState) {
    do {
      try repository.sendEpisodeToInbox(episode.id)
      try refresh()
      runDownloadMaintenance()
      status = "Moved to Inbox."
    } catch {
      status = "Could not move to Inbox."
    }
  }

  func setFavorite(_ episode: EpisodeWithState, favorite: Bool) {
    do {
      try repository.setFavorite(episode.id, favorite: favorite)
      try refresh()
      runDownloadMaintenance()
      status = favorite ? "Added to Favorites." : "Removed from Favorites."
    } catch {
      status = "Could not update favorite."
    }
  }

  func toggleFavorite(_ episode: EpisodeWithState) {
    setFavorite(episode, favorite: !episode.state.favorite)
  }

  func downloadEpisode(_ episode: EpisodeWithState) {
    guard !downloadingEpisodeIds.contains(episode.id) else { return }
    if episode.episode.sourceType == .youtube && episode.episode.extractionStatus != .ready {
      extractYouTubeEpisode(episode)
      return
    }
    downloadingEpisodeIds.insert(episode.id)
    Task {
      do {
        let result = try await downloadManager.download(episode, policy: NativeDownloadPolicy(settings: settings))
        try repository.setDownloaded(result.episodeId, path: result.path, bytes: result.bytes, source: "manual")
        try refresh()
        try await pruneDownloadsIfNeeded()
        status = "Downloaded \(episode.episode.title)."
      } catch {
        status = "Download failed."
      }
      downloadingEpisodeIds.remove(episode.id)
    }
  }

  func deleteDownload(_ episode: EpisodeWithState) {
    guard !downloadingEpisodeIds.contains(episode.id) else { return }
    downloadingEpisodeIds.insert(episode.id)
    Task {
      do {
        _ = try downloadManager.delete(episodeId: episode.id, storedPath: episode.state.downloadPath)
        try repository.setDownloaded(episode.id, path: nil, bytes: nil, source: nil)
        try refresh()
        status = "Deleted download."
      } catch {
        status = "Could not delete download."
      }
      downloadingEpisodeIds.remove(episode.id)
    }
  }

  func moveQueueEpisodes(from source: IndexSet, to destination: Int) {
    do {
      try repository.moveQueueItems(from: source, to: destination)
      try refresh()
      runDownloadMaintenance()
    } catch {
      status = "Could not reorder queue."
    }
  }

  func markPlayed(_ episode: EpisodeWithState, played: Bool = true) {
    do {
      try repository.markPlayed(episode.id, played: played)
      try refresh()
      runDownloadMaintenance()
    } catch {
      status = "Could not update played state."
    }
  }

  func updatePodcastPreference(_ podcast: Podcast, patch: (inout PodcastPreference) -> Void) {
    do {
      try repository.updatePodcastPreference(podcast.id, patch: patch)
      try refresh()
      status = "Podcast settings saved."
    } catch {
      status = "Could not save podcast settings."
    }
  }

  func addPodcastToLibrary(_ podcast: Podcast) {
    do {
      try repository.addPodcastToLibrary(podcast.id)
      try refresh()
      status = "Added to Library."
      runDownloadMaintenance()
    } catch {
      status = "Could not add show to Library."
    }
  }

  func removePodcastFromLibrary(_ podcast: Podcast) {
    do {
      try repository.removePodcastFromLibrary(podcast.id)
      try refresh()
      status = "Removed from Library."
      runDownloadMaintenance()
    } catch {
      status = "Could not remove show from Library."
    }
  }

  func subscribePodcast(_ podcast: Podcast) {
    do {
      try repository.subscribePodcast(podcast.id)
      try refresh()
      status = "Subscribed."
      runDownloadMaintenance()
    } catch {
      status = "Could not subscribe."
    }
  }

  func unsubscribePodcast(_ podcast: Podcast) {
    do {
      try repository.unsubscribePodcast(podcast.id)
      try refresh()
      status = "Unsubscribed."
      runDownloadMaintenance()
    } catch {
      status = "Could not unsubscribe."
    }
  }

  func markAllInPodcast(_ podcast: Podcast, played: Bool) {
    do {
      try repository.markAllInPodcast(podcast.id, played: played)
      try refresh()
      runDownloadMaintenance()
      status = played ? "Marked show played." : "Marked show unplayed."
    } catch {
      status = "Could not update show episodes."
    }
  }

  func sendAllUnplayedInPodcastToInbox(_ podcast: Podcast) {
    do {
      try repository.sendAllUnplayedInPodcastToInbox(podcast.id)
      try refresh()
      runDownloadMaintenance()
      status = "Sent unplayed episodes to Inbox."
    } catch {
      status = "Could not send episodes to Inbox."
    }
  }

  func handlePlaybackEnded() {
    guard let ended = audio.current else { return }
    do {
      try repository.markPlayed(ended.id, played: true)
      try repository.removeFromQueue(ended.id)
      try refresh()
      runDownloadMaintenance()
      guard settings.autoPlayNext, let next = try repository.queuedEpisodes().first else {
        cancelSleepTimer()
        audio.stop()
        return
      }
      play(next)
    } catch {
      status = "Could not continue playback."
      audio.stop()
    }
  }

  func publishClip(episode: EpisodeWithState, title: String, note: String?, startSec: TimeInterval, endSec: TimeInterval) {
    guard !publishingClipEpisodeIds.contains(episode.id) else { return }
    let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedTitle.isEmpty else {
      status = "Add a clip title."
      return
    }
    let normalizedStart = max(0, startSec)
    let normalizedEnd = max(normalizedStart + 1, endSec)
    guard normalizedEnd - normalizedStart <= 180 else {
      status = "Clips can be up to 3 minutes."
      return
    }
    guard URL(string: episode.episode.audioUrl) != nil else {
      status = "Episode audio URL is not publishable."
      return
    }

    let clipClient = BackendClient(serverUrl: settings.serverUrl)
    let canPublishClip = clipClient != nil && clipPublishingAvailable
    var clip = Clip(
      id: "clip_\(UUID().uuidString)",
      episodeId: episode.id,
      podcastTitle: episode.episode.podcastTitle,
      episodeTitle: episode.episode.title,
      sourceAudioUrl: episode.episode.audioUrl,
      startSec: normalizedStart,
      endSec: normalizedEnd,
      title: trimmedTitle,
      note: note?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
      renderStatus: canPublishClip ? .pending : .localOnly,
      createdAt: Date(),
      updatedAt: Date()
    )

    guard canPublishClip, let client = clipClient else {
      do {
        try repository.saveClip(clip)
        try refresh()
        if !clipPublishingAvailable {
          status = "Clip saved locally; publishing disabled on this server."
        } else {
          status = "Clip saved locally."
        }
      } catch {
        status = "Could not save clip."
      }
      return
    }

    publishingClipEpisodeIds.insert(episode.id)
    Task {
      do {
        let response = try await client.publishClip(clip)
        clip.serverClipId = response.id
        clip.publicUrl = response.publicUrl
        clip.renderedAudioUrl = response.renderedAudioUrl
        clip.renderedUrl = response.renderedUrl ?? response.renderedAudioUrl
        clip.renderedVideoUrl = response.renderedVideoUrl
        clip.renderStatus = response.renderStatus
        clip.renderError = response.renderError
        clip.fileSizeBytes = response.fileSizeBytes
        try repository.saveClip(clip)
        try refresh()
        if clip.publicUrl != nil {
          status = "Clip published."
        } else {
          status = "Clip saved locally."
        }
      } catch {
        clip.renderStatus = .failed
        clip.renderError = "Publish failed."
        try? repository.saveClip(clip)
        try? refresh()
        status = "Clip saved locally; publishing failed."
      }
      publishingClipEpisodeIds.remove(episode.id)
    }
  }

  func cachedSilenceMap(for episode: EpisodeWithState) -> SilenceMap? {
    silenceMaps.first { $0.episodeId == episode.id && $0.audioUrl == episode.episode.audioUrl }
  }

  func cachedSmartSkipEntry(for episode: EpisodeWithState) -> SmartSkipMapCacheEntry? {
    smartSkipMaps.first { $0.episodeId == episode.id && $0.audioUrl == episode.episode.audioUrl }
  }

  func cachedArtworkURL(for episode: EpisodeWithState) -> URL? {
    downloadManager.cachedArtworkURL(for: episode)
  }

  func requestSilenceMap(_ episode: EpisodeWithState) {
    runServerIntelligence(
      episode,
      workingStatus: "Preparing Shorten Silence.",
      capabilityEnabled: silenceMapsAvailable,
      disabledStatus: "Shorten Silence is disabled on this server."
    ) { client in
      let map = try await client.requestSilenceMap(for: episode)
      try self.repository.saveSilenceMap(map, requestedAt: Date(), checkedAt: Date())
      self.status = map.status == .ready ? "Shorten Silence ready." : "Shorten Silence \(map.status.rawValue)."
    }
  }

  func refreshSilenceMap(_ episode: EpisodeWithState) {
    guard let cached = cachedSilenceMap(for: episode) else {
      requestSilenceMap(episode)
      return
    }
    runServerIntelligence(
      episode,
      workingStatus: "Checking Shorten Silence.",
      capabilityEnabled: silenceMapsAvailable,
      disabledStatus: "Shorten Silence is disabled on this server."
    ) { client in
      let map = try await client.fetchSilenceMap(id: cached.id)
      try self.repository.saveSilenceMap(map, requestedAt: cached.lastRequestedAt, checkedAt: Date())
      self.status = map.status == .ready ? "Shorten Silence ready." : "Shorten Silence \(map.status.rawValue)."
    }
  }

  func requestSmartSkip(_ episode: EpisodeWithState) {
    runServerIntelligence(
      episode,
      workingStatus: "Requesting Smart Skip.",
      capabilityEnabled: smartSkipProcessingAvailable,
      disabledStatus: "Smart Skip is disabled on this server."
    ) { client in
      let priority = self.smartSkipPriority(for: episode)
      let response = try await client.requestSmartSkipProcessing(for: episode, priority: priority)
      if let map = response.segmentMap, map.isReadyForPlayback {
        try self.repository.saveSmartSkipSegmentMap(map, transcript: response.transcript)
        self.status = "Smart Skip map ready."
      } else {
        try self.repository.saveSmartSkipStatus(for: episode, status: response.status, jobId: response.jobId, reason: priority, error: response.error)
        self.status = "Smart Skip \(response.status.rawValue)."
      }
    }
  }

  func fetchSmartSkip(_ episode: EpisodeWithState) {
    runServerIntelligence(
      episode,
      workingStatus: "Checking Smart Skip.",
      capabilityEnabled: smartSkipProcessingAvailable,
      disabledStatus: "Smart Skip is disabled on this server."
    ) { client in
      let response = try await client.fetchSmartSkipSegmentMap(for: episode)
      if let map = response.segmentMap, map.isReadyForPlayback {
        try self.repository.saveSmartSkipSegmentMap(map, transcript: response.transcript)
        self.status = "Smart Skip map ready."
      } else {
        try self.repository.saveSmartSkipStatus(for: episode, status: response.status, jobId: nil, reason: nil, error: nil)
        self.status = "Smart Skip \(response.status.rawValue)."
      }
    }
  }

  func saveServerUrl(_ value: String) {
    do {
      let previousServerUrl = settings.serverUrl
      var next = settings
      next.serverUrl = BackendClient.normalizeServerUrl(value)
      try repository.saveSettings(next)
      try refresh()
      status = settings.serverUrl == nil ? "Server URL cleared. Backend features are off." : "Server URL saved."
      if previousServerUrl != settings.serverUrl {
        backendCapabilities = nil
        refreshBackendCapabilities()
      }
    } catch {
      status = "Could not save server URL."
    }
  }

  func testServer() {
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      status = "Server URL is not configured."
      return
    }
    status = "Testing server."
    Task {
      do {
        let health = try await client.health()
        backendCapabilities = try? await client.capabilities()
        status = health.ok ? "Server is reachable." : "Server responded but is not healthy."
      } catch {
        backendCapabilities = nil
        status = "Server check failed."
      }
    }
  }

  func refreshAppleAccountStatus() {
    Task {
      appleAccountState = await appleAccountStatusProvider.accountStatus()
    }
  }

  func signInWithApple(identityToken: Data?) {
    guard let tokenData = identityToken, let token = String(data: tokenData, encoding: .utf8) else {
      status = "Apple sign-in did not return an identity token."
      return
    }
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      status = "Set a server URL before signing in."
      return
    }
    signingInWithApple = true
    status = "Signing in with Apple."
    Task {
      do {
        let response = try await client.signInWithApple(identityToken: token)
        let session = BackendSession(accessToken: response.accessToken, account: response.account, createdAt: response.createdAt)
        try BackendSessionStore.save(session)
        backendSession = session
        status = "Signed in with Apple."
      } catch let error as BackendClientError {
        if let message = error.message, !message.isEmpty {
          status = "Apple sign-in failed: \(message)"
        } else {
          status = "Apple sign-in failed with HTTP \(error.statusCode)."
        }
      } catch {
        status = "Apple sign-in failed."
      }
      signingInWithApple = false
    }
  }

  func signOutBackend() {
    let client = BackendClient(serverUrl: settings.serverUrl)
    BackendSessionStore.clear()
    backendSession = nil
    status = "Signed out."
    Task {
      try? await client?.signOut()
    }
  }

  func dismissStatus() {
    status = nil
  }

  func syncNow() {
    syncing = true
    Task {
      do {
        if appleAccountState == .checking {
          appleAccountState = await appleAccountStatusProvider.accountStatus()
        }
        let syncsToCloud = appleAccountState == .available
        let store: any CloudKitPersonalSyncStoring = syncsToCloud
          ? LiveCloudKitPersonalSyncStore()
          : PreparedCloudKitPersonalSyncStore()
        let engine = CloudKitPersonalSyncEngine(repository: repository, store: store)
        let result = try await engine.sync(protectedPlaybackEpisodeId: audio.current?.id)
        try refresh()
        status = syncsToCloud ? result.message : "\(result.message) iCloud upload will start once this build has iCloud access."
      } catch {
        status = "Sync failed."
      }
      syncing = false
    }
  }

  func importFeed(_ rawValue: String) {
    let feedUrl = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: feedUrl), ["http", "https"].contains(url.scheme?.lowercased()) else {
      status = "Enter a valid RSS feed URL."
      return
    }
    importingFeed = true
    Task {
      do {
        let result = try await rssImporter.importFeed(url.absoluteString, settings.serverUrl)
        try repository.upsertParsedFeed(result)
        try refresh()
        selectedTab = .library
        status = "Added \(result.podcast.title)."
        runDownloadMaintenance()
      } catch {
        status = "Could not import that feed."
      }
      importingFeed = false
    }
  }

  func refreshPodcast(_ podcast: Podcast, now: Date = Date()) {
    guard !refreshingPodcastIds.contains(podcast.id) else { return }
    if let lastRefresh = lastPodcastRefreshAt[podcast.id], now.timeIntervalSince(lastRefresh) < podcastRefreshCooldown {
      status = "\(podcast.title) was just refreshed. Try again in a moment."
      return
    }
    guard !podcast.feedUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      status = "This podcast does not have a refreshable feed URL."
      return
    }
    lastPodcastRefreshAt[podcast.id] = now
    refreshingPodcastIds.insert(podcast.id)
    status = "Refreshing \(podcast.title)..."

    Task {
      do {
        let result: ParsedFeedResult
        if podcast.sourceType?.isYouTube == true {
          result = try await refreshYouTubePodcastSource(podcast)
        } else {
          result = try await rssImporter.importFeed(podcast.feedUrl, settings.serverUrl)
        }
        try repository.upsertParsedFeed(result)
        try refresh()
        status = "Refreshed \(result.podcast.title)."
        runDownloadMaintenance()
      } catch {
        status = "Podcast refresh failed."
      }
      refreshingPodcastIds.remove(podcast.id)
    }
  }

  func runAutomaticPodcastRefresh(now: Date = Date()) {
    Task {
      await runAutomaticPodcastRefreshNow(now: now)
    }
  }

  @discardableResult
  func runAutomaticPodcastRefreshNow(now: Date = Date()) async -> Int {
    guard !autoRefreshingFeeds else { return 0 }
    let interval = max(settings.refreshIntervalMinutes, 0)
    guard interval > 0 else { return 0 }
    let duePodcasts = podcastsDueForAutomaticRefresh(now: now, intervalMinutes: interval)
    guard !duePodcasts.isEmpty else { return 0 }

    autoRefreshingFeeds = true
    defer { autoRefreshingFeeds = false }

    var refreshedCount = 0
    for podcast in duePodcasts {
      guard !Task.isCancelled else { break }
      guard !refreshingPodcastIds.contains(podcast.id) else { continue }
      refreshingPodcastIds.insert(podcast.id)
      do {
        let result: ParsedFeedResult
        if podcast.sourceType?.isYouTube == true {
          result = try await refreshYouTubePodcastSource(podcast)
        } else {
          result = try await rssImporter.importFeed(podcast.feedUrl, settings.serverUrl)
        }
        try repository.upsertParsedFeed(result)
        refreshedCount += 1
      } catch {
        // Automatic refresh is opportunistic. Manual refresh remains the visible recovery path.
      }
      refreshingPodcastIds.remove(podcast.id)
    }

    if refreshedCount > 0 {
      do {
        try refresh()
        runDownloadMaintenance()
        status = refreshedCount == 1 ? "Refreshed 1 feed." : "Refreshed \(refreshedCount) feeds."
      } catch {
        status = "Feed refresh completed, but local reload failed."
      }
    }
    return refreshedCount
  }

  private func podcastsDueForAutomaticRefresh(now: Date, intervalMinutes: Int) -> [Podcast] {
    let cutoff = now.addingTimeInterval(-TimeInterval(intervalMinutes * 60))
    return podcasts.filter { podcast in
      guard isPodcastInLibrary(podcast) else { return false }
      guard !podcast.feedUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
      guard let lastRefreshedAt = podcast.lastRefreshedAt else { return false }
      return lastRefreshedAt <= cutoff
    }
  }

  private func refreshYouTubePodcastSource(_ podcast: Podcast) async throws -> ParsedFeedResult {
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      throw URLError(.badURL)
    }
    guard youtubeImportAvailable else {
      throw URLError(.unsupportedURL)
    }
    let capabilities = try await client.capabilities()
    guard capabilities.youtubeImport?.enabled == true else {
      throw URLError(.unsupportedURL)
    }
    return try await client.importYouTubeSource(url: podcast.sourceUrl ?? podcast.feedUrl)
  }

  func importYouTubeSource(_ rawValue: String) {
    let sourceUrl = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard YouTubeURLClassifier.sourceKind(for: sourceUrl) != nil else {
      status = "Enter a supported YouTube URL."
      return
    }
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      status = "Set a server URL before importing YouTube."
      return
    }
    guard youtubeImportAvailable else {
      status = "YouTube import is disabled on this server."
      return
    }
    importingYouTube = true
    Task {
      do {
        let capabilities = try await client.capabilities()
        backendCapabilities = capabilities
        guard capabilities.youtubeImport?.enabled == true else {
          status = "YouTube import is disabled on this server."
          importingYouTube = false
          return
        }
        let result = try await client.importYouTubeSource(url: sourceUrl)
        try repository.upsertParsedFeed(result)
        try refresh()
        selectedTab = .library
        status = "Imported \(result.podcast.title)."
        runDownloadMaintenance()
      } catch {
        status = "YouTube import failed."
      }
      importingYouTube = false
    }
  }

  func enrichYouTubeEpisode(_ episode: EpisodeWithState) {
    guard let sourceUrl = episode.episode.youtubeSourceURL else {
      status = "This YouTube episode is missing its source URL."
      return
    }
    guard !youtubeProcessingEpisodeIds.contains(episode.id) else { return }
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      status = "Set a server URL before enriching YouTube."
      return
    }
    guard youtubeImportAvailable else {
      status = "YouTube import is disabled on this server."
      return
    }
    youtubeProcessingEpisodeIds.insert(episode.id)
    Task {
      do {
        let capabilities = try await client.capabilities()
        backendCapabilities = capabilities
        guard capabilities.youtubeImport?.enabled == true else {
          status = "YouTube import is disabled on this server."
          youtubeProcessingEpisodeIds.remove(episode.id)
          return
        }
        let response = try await client.enrichYouTubeEpisode(episodeId: episode.id, sourceUrl: sourceUrl)
        try repository.updateEpisodeMetadata(episode.id, patch: response.patch)
        try refresh()
        status = "YouTube metadata updated."
      } catch {
        status = "YouTube metadata update failed."
      }
      youtubeProcessingEpisodeIds.remove(episode.id)
    }
  }

  func extractYouTubeEpisode(_ episode: EpisodeWithState) {
    guard let sourceUrl = episode.episode.youtubeSourceURL else {
      status = "This YouTube episode is missing its source URL."
      return
    }
    guard !youtubeProcessingEpisodeIds.contains(episode.id) else { return }
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      status = "Set a server URL before preparing YouTube audio."
      return
    }
    guard youtubeImportAvailable else {
      status = "YouTube import is disabled on this server."
      return
    }
    youtubeProcessingEpisodeIds.insert(episode.id)
    Task {
      do {
        let capabilities = try await client.capabilities()
        backendCapabilities = capabilities
        guard capabilities.youtubeImport?.enabled == true else {
          status = "YouTube import is disabled on this server."
          youtubeProcessingEpisodeIds.remove(episode.id)
          return
        }
        status = "Preparing YouTube audio..."
        let response = try await client.extractYouTubeEpisode(episodeId: episode.id, sourceUrl: sourceUrl)
        try repository.updateEpisodeMetadata(
          episode.id,
          patch: YouTubeEpisodePatch(extractionStatus: response.audioReady ? .ready : response.extractionStatus)
        )
        try refresh()
        status = response.audioReady ? "YouTube audio is ready." : "Server is preparing YouTube audio."
      } catch {
        try? repository.updateEpisodeMetadata(episode.id, patch: YouTubeEpisodePatch(extractionStatus: .failed))
        try? refresh()
        status = "YouTube audio preparation failed."
      }
      youtubeProcessingEpisodeIds.remove(episode.id)
    }
  }

  func searchPodcasts(_ rawValue: String) {
    let query = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard query.count >= 2 else {
      podcastSearchResults = []
      status = "Enter at least 2 characters."
      return
    }
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      status = "Set a server URL before searching PodcastIndex."
      return
    }
    guard podcastIndexAvailable else {
      status = "PodcastIndex search is disabled on this server."
      return
    }
    searchingPodcasts = true
    Task {
      do {
        podcastSearchResults = try await client.searchPodcastIndex(query: query)
        status = podcastSearchResults.isEmpty ? "No PodcastIndex matches." : "Found \(podcastSearchResults.count) podcasts."
      } catch let error as BackendClientError where error.isNativeAppAccessRequired {
        status = "PodcastIndex search needs a private app token for this server."
      } catch let error as BackendClientError {
        status = error.message ?? "PodcastIndex search failed."
      } catch {
        status = "PodcastIndex search failed."
      }
      searchingPodcasts = false
    }
  }

  func subscribeToDiscoveredPodcast(_ result: PodcastDiscoveryResult) {
    guard !isSubscribed(feedUrl: result.feedUrl) else {
      selectedTab = .library
      status = "Already in Library."
      return
    }
    importFeed(result.feedUrl)
  }

  func isSubscribed(feedUrl: String) -> Bool {
    let normalized = feedUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
    return podcasts.contains { podcast in
      podcast.feedUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased() == normalized
    }
  }

  func opmlExportDocument() -> TextFileDocument? {
    do {
      return TextFileDocument(text: try repository.exportOPML())
    } catch {
      status = "Could not export OPML."
      return nil
    }
  }

  func backupExportDocument() -> TextFileDocument? {
    do {
      return TextFileDocument(text: try repository.exportBackup().encodedString())
    } catch {
      status = "Could not export backup."
      return nil
    }
  }

  func importOPML(from url: URL) {
    importingPortableData = true
    Task {
      do {
        let data = try readSecurityScopedFile(url)
        let subscriptions = try OPMLCodec.parse(data)
        var count = 0
        for subscription in subscriptions {
          guard let url = URL(string: subscription.feedUrl), ["http", "https"].contains(url.scheme?.lowercased()) else { continue }
          let result = try await rssImporter.importFeed(url.absoluteString, settings.serverUrl)
          try repository.upsertParsedFeed(result)
          count += 1
        }
        try refresh()
        selectedTab = .library
        status = count == 1 ? "Imported 1 subscription." : "Imported \(count) subscriptions."
        runDownloadMaintenance()
      } catch {
        status = "Could not import OPML."
      }
      importingPortableData = false
    }
  }

  func restoreBackup(from url: URL) {
    importingPortableData = true
    Task {
      do {
        let data = try readSecurityScopedFile(url)
        let backup = try DaisyPodBackup.decode(data)
        try repository.restoreBackup(backup)
        try refresh()
        selectedTab = .library
        status = "Backup restored."
      } catch {
        status = "Could not restore backup."
      }
      importingPortableData = false
    }
  }

  func handleOpenURL(_ url: URL) {
    if handleNativeDeepLink(url) {
      return
    }

    status = "Unsupported DaisyPod link."
  }

  private func handleNativeDeepLink(_ url: URL) -> Bool {
    guard url.scheme?.lowercased() == "daisypod" else { return false }
    let route = url.host?.lowercased()
    switch route {
    case "add", "import":
      handleAppIntentHandoff(AppIntentHandoffPayload(action: .addPodcast, value: deepLinkValue(from: url)))
      return true
    case "open", "section":
      handleAppIntentHandoff(AppIntentHandoffPayload(action: .openSection, section: deepLinkSection(from: url) ?? .inbox))
      return true
    case "sync":
      handleAppIntentHandoff(AppIntentHandoffPayload(action: .syncNow))
      return true
    case "playback", "player":
      if deepLinkValue(from: url)?.lowercased() == "toggle" || url.path.lowercased().contains("toggle") {
        handleAppIntentHandoff(AppIntentHandoffPayload(action: .togglePlayback))
        return true
      }
      selectedTab = .inbox
      status = "Open the player to manage the queue."
      return true
    default:
      if let section = sectionKey(from: route) {
        handleAppIntentHandoff(AppIntentHandoffPayload(action: .openSection, section: section))
        return true
      }
      return false
    }
  }

  private func deepLinkValue(from url: URL) -> String? {
    let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    let queryValue = components?.queryItems?.first(where: { ["url", "feed", "feed_url", "youtube", "source", "value", "action"].contains($0.name) })?.value
    if let queryValue, !queryValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return queryValue.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let pathValue = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return pathValue.removingPercentEncoding?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
  }

  private func deepLinkSection(from url: URL) -> SectionKey? {
    let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    let queryValue = components?.queryItems?.first(where: { ["section", "tab"].contains($0.name) })?.value
    return sectionKey(from: queryValue) ?? sectionKey(from: deepLinkValue(from: url))
  }

  private func sectionKey(from rawValue: String?) -> SectionKey? {
    guard let rawValue else { return nil }
    let normalized = rawValue
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
      .replacingOccurrences(of: "-", with: "")
      .replacingOccurrences(of: "_", with: "")
    if normalized == "add" || normalized == "search" || normalized == "podcasts" {
      return .search
    }
    if normalized == "queue" {
      return .inbox
    }
    return SectionKey.allCases.first { section in
      section.rawValue.replacingOccurrences(of: "-", with: "") == normalized
        || section.title.lowercased().replacingOccurrences(of: " ", with: "") == normalized
    }
  }

  func runDownloadMaintenance() {
    Task {
      await runDownloadMaintenanceNow()
    }
  }

  @discardableResult
  func runDownloadMaintenanceNow() async -> Bool {
    guard !runningDownloadMaintenance else { return false }
    runningDownloadMaintenance = true
    defer {
      runningDownloadMaintenance = false
      scheduleBackgroundDownloadMaintenance()
    }
    do {
      let reconciled = try reconcileMissingDownloads()
      var downloadedCount = 0
      for candidate in try repository.automaticDownloadCandidates(settings: settings) {
        guard !downloadingEpisodeIds.contains(candidate.episode.id) else { continue }
        guard candidate.episode.episode.sourceType != .youtube || candidate.episode.episode.extractionStatus == .ready else { continue }
        do {
          downloadingEpisodeIds.insert(candidate.episode.id)
          defer { downloadingEpisodeIds.remove(candidate.episode.id) }
          let result = try await downloadManager.download(candidate.episode, policy: NativeDownloadPolicy(settings: settings))
          try repository.setDownloaded(result.episodeId, path: result.path, bytes: result.bytes, source: candidate.source)
          downloadedCount += 1
        } catch {
          // Automatic downloads should never interrupt foreground listening or triage.
        }
      }
      let preparedIntelligence = await prepareServerIntelligenceForListeningIntent()
      let deletedInactive = try await deleteInactiveDownloadsIfNeeded()
      let pruned = try await pruneDownloadsIfNeeded()
      try refresh()
      _ = downloadedCount + reconciled + preparedIntelligence + deletedInactive + pruned
      return true
    } catch {
      status = "Download maintenance failed."
      return false
    }
  }

  private func configureBackgroundDownloadMaintenance() {
    backgroundDownloadScheduler.registerDownloadMaintenance { [weak self] in
      guard let self else { return false }
      return await self.runDownloadMaintenanceNow()
    }
    scheduleBackgroundDownloadMaintenance()
  }

  private func scheduleBackgroundDownloadMaintenance() {
    backgroundDownloadScheduler.scheduleDownloadMaintenance(settings: settings, hasDownloadWork: hasPendingDownloadMaintenanceWork())
  }

  private func hasPendingDownloadMaintenanceWork() -> Bool {
    do {
      if try !repository.automaticDownloadCandidates(settings: settings).isEmpty { return true }
      if try !repository.inactiveDownloadedEpisodes(settings: settings).isEmpty { return true }
      if try repository.downloadedStorageBytes() > max(settings.storageCapMb, 1) * 1024 * 1024 { return true }
      if try !repository.staleDownloadedEpisodes(fileExists: { downloadManager.hasDownloadedFile(at: $0) }).isEmpty { return true }
      return false
    } catch {
      return true
    }
  }

  @discardableResult
  private func reconcileMissingDownloads() throws -> Int {
    let stale = try repository.staleDownloadedEpisodes { path in
      downloadManager.hasDownloadedFile(at: path)
    }
    for episode in stale {
      try repository.setDownloaded(episode.id, path: nil, bytes: nil, source: nil)
    }
    return stale.count
  }

  @discardableResult
  private func deleteInactiveDownloadsIfNeeded() async throws -> Int {
    let inactive = try repository.inactiveDownloadedEpisodes(settings: settings)
    for episode in inactive {
      _ = try downloadManager.delete(episodeId: episode.id, storedPath: episode.state.downloadPath)
      try repository.setDownloaded(episode.id, path: nil, bytes: nil, source: nil)
    }
    return inactive.count
  }

  @discardableResult
  func pruneDownloadsIfNeeded() async throws -> Int {
    let maxBytes = max(settings.storageCapMb, 1) * 1024 * 1024
    var totalBytes = try repository.downloadedStorageBytes()
    guard totalBytes > maxBytes else { return 0 }
    var pruned = 0
    for episode in try repository.downloadPruneCandidates(settings: settings) {
      guard totalBytes > maxBytes else { break }
      _ = try downloadManager.delete(episodeId: episode.id, storedPath: episode.state.downloadPath)
      totalBytes -= episode.state.downloadBytes ?? repository.estimatedDownloadBytes(episode)
      try repository.setDownloaded(episode.id, path: nil, bytes: nil, source: nil)
      pruned += 1
    }
    return pruned
  }

  private func readSecurityScopedFile(_ url: URL) throws -> Data {
    let didAccess = url.startAccessingSecurityScopedResource()
    defer {
      if didAccess { url.stopAccessingSecurityScopedResource() }
    }
    return try Data(contentsOf: url)
  }

  func refreshBackendCapabilities() {
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      backendCapabilities = nil
      return
    }
    Task {
      do {
        backendCapabilities = try await client.capabilities()
      } catch {
        backendCapabilities = nil
      }
    }
  }

  private func runServerIntelligence(
    _ episode: EpisodeWithState,
    workingStatus: String,
    capabilityEnabled: Bool = true,
    disabledStatus: String = "This server feature is disabled.",
    operation: @escaping (BackendClient) async throws -> Void
  ) {
    guard !processingIntelligenceEpisodeIds.contains(episode.id) else { return }
    guard capabilityEnabled else {
      status = disabledStatus
      return
    }
    guard let client = BackendClient(serverUrl: settings.serverUrl) else {
      status = "Set a server URL first."
      return
    }
    processingIntelligenceEpisodeIds.insert(episode.id)
    status = workingStatus
    Task {
      do {
        try await operation(client)
        try refresh()
      } catch {
        status = "Server intelligence request failed."
      }
      processingIntelligenceEpisodeIds.remove(episode.id)
    }
  }

  private func prepareServerIntelligenceForListeningIntent(limit: Int = 4) async -> Int {
    guard silenceMapsAvailable || smartSkipProcessingAvailable,
          let client = BackendClient(serverUrl: settings.serverUrl)
    else {
      return 0
    }

    let candidates: [EpisodeWithState]
    do {
      candidates = try repository.episodes()
        .filter { $0.state.queuePosition != nil || $0.state.inboxState == .new }
        .sorted { lhs, rhs in
          let lhsQueue = lhs.state.queuePosition ?? Int.max
          let rhsQueue = rhs.state.queuePosition ?? Int.max
          if lhsQueue != rhsQueue { return lhsQueue < rhsQueue }
          return (lhs.state.inboxPosition ?? Int.max) < (rhs.state.inboxPosition ?? Int.max)
        }
        .prefix(limit)
        .map { $0 }
    } catch {
      return 0
    }

    var prepared = 0
    for episode in candidates {
      if await prepareSilenceMapIfNeeded(for: episode, client: client) {
        prepared += 1
      }
      if await prepareSmartSkipIfNeeded(for: episode, client: client) {
        prepared += 1
      }
    }
    return prepared
  }

  private func prepareSilenceMapIfNeeded(for episode: EpisodeWithState, client: BackendClient) async -> Bool {
    guard silenceMapsAvailable else { return false }
    do {
      if let cached = try repository.cachedSilenceMap(for: episode) {
        switch cached.status {
        case .ready:
          return false
        case .queued, .processing:
          let map = try await client.fetchSilenceMap(id: cached.id)
          try repository.saveSilenceMap(map, requestedAt: cached.lastRequestedAt, checkedAt: Date())
          return map.status == .ready
        case .failed, .stale, .missing, .unavailable:
          break
        }
      }
      let map = try await client.requestSilenceMap(for: episode)
      try repository.saveSilenceMap(map, requestedAt: Date(), checkedAt: Date())
      return true
    } catch {
      return false
    }
  }

  private func prepareSmartSkipIfNeeded(for episode: EpisodeWithState, client: BackendClient) async -> Bool {
    guard smartSkipProcessingAvailable, effectivePlaybackSettings(for: episode).smartSkipEnabled else { return false }
    do {
      if let cached = try repository.cachedSmartSkipEntry(for: episode) {
        if cached.map?.isReadyForPlayback == true { return false }
        switch cached.status {
        case .queued, .processing:
          let response = try await client.fetchSmartSkipSegmentMap(for: episode)
          if let map = response.segmentMap, map.isReadyForPlayback {
            try repository.saveSmartSkipSegmentMap(map, transcript: response.transcript)
            return true
          }
          try repository.saveSmartSkipStatus(for: episode, status: response.status, jobId: cached.jobId, reason: cached.reason, error: response.status == .failed ? cached.error : nil)
          return false
        case .ready:
          return false
        case .failed, .stale, .missing, .unavailable:
          break
        }
      }

      let response = try await client.requestSmartSkipProcessing(for: episode, priority: smartSkipPriority(for: episode))
      if let map = response.segmentMap, map.isReadyForPlayback {
        try repository.saveSmartSkipSegmentMap(map, transcript: response.transcript)
      } else {
        try repository.saveSmartSkipStatus(for: episode, status: response.status, jobId: response.jobId, reason: smartSkipPriority(for: episode), error: response.error)
      }
      return true
    } catch {
      return false
    }
  }

  private func smartSkipPriority(for episode: EpisodeWithState) -> String {
    if audio.current?.id == episode.id { return "nowPlaying" }
    if episode.state.queuePosition != nil { return "queue" }
    if episode.state.inboxState == .new { return "inbox" }
    return "backlog"
  }

  private func refreshCurrentPlaybackIntelligence() {
    guard let current = audio.current else { return }
    let refreshed = episodes.first { $0.id == current.id } ?? current
    let playbackSettings = effectivePlaybackSettings(for: refreshed)
    audio.updateCurrentEpisode(
      refreshed,
      settings: playbackSettings,
      cachedArtworkURL: cachedArtworkURL(for: refreshed)
    )
    audio.updatePlaybackIntelligence(
      settings: playbackSettings,
      silenceMap: cachedSilenceMap(for: refreshed),
      smartSkipEntry: cachedSmartSkipEntry(for: refreshed)
    )
  }
}
