import XCTest
@testable import DaisyPod

@MainActor
final class LocalStoreTests: XCTestCase {
  func testSeedDataCreatesLocalLibrary() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()

    XCTAssertEqual(try repository.podcasts().count, 2)
    XCTAssertEqual(try repository.episodes().count, 6)
    XCTAssertFalse(try repository.inboxEpisodes(settings: repository.settings()).isEmpty)
  }

  func testQueueActionsPersistAndNormalize() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let first = try repository.episodes()[0]
    let second = try repository.episodes()[1]

    try repository.addToQueueEnd(first.id)
    try repository.addToQueueEnd(second.id)
    try repository.removeFromQueue(first.id)

    let queue = try repository.queuedEpisodes()
    XCTAssertEqual(queue.count, 1)
    XCTAssertEqual(queue[0].id, second.id)
    XCTAssertEqual(queue[0].state.queuePosition, 1)
  }

  func testQueueReorderPersistsPositions() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()

    try repository.addToQueueEnd(episodes[0].id)
    try repository.addToQueueEnd(episodes[1].id)
    try repository.addToQueueEnd(episodes[2].id)
    try repository.moveQueueItems(from: IndexSet(integer: 0), to: 3)

    let queue = try repository.queuedEpisodes()
    XCTAssertEqual(queue.map(\.id), [episodes[1].id, episodes[2].id, episodes[0].id])
    XCTAssertEqual(queue.map { $0.state.queuePosition }, [1, 2, 3])
    XCTAssertGreaterThan(try repository.syncActions(includePushed: false).count, 3)
  }

  func testPlayNextInsertsEpisodeAfterCurrentQueueItem() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    try repository.addToQueueEnd(episodes[0].id)
    try repository.addToQueueEnd(episodes[1].id)
    let model = AppModel(repository: repository)
    model.start()
    let target = try XCTUnwrap(model.episodes.first { $0.id == episodes[2].id })

    model.playNext(target)

    let queue = try repository.queuedEpisodes()
    XCTAssertEqual(queue.map(\.id), [episodes[0].id, episodes[2].id, episodes[1].id])
    XCTAssertEqual(queue.map { $0.state.queuePosition }, [1, 2, 3])
    XCTAssertEqual(model.status, "Added to Play Next.")
    XCTAssertGreaterThan(try repository.syncActions(includePushed: false).count, 3)
  }

  func testQueueItemCanReturnToInboxThroughAppModel() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.addToQueueEnd(episode.id)
    let model = AppModel(repository: repository)
    model.start()
    let queued = try XCTUnwrap(model.queue.first { $0.id == episode.id })

    model.sendQueueEpisodeToInbox(queued)

    XCTAssertFalse(model.queue.contains { $0.id == episode.id })
    let inboxState = try XCTUnwrap(model.inbox.first { $0.id == episode.id }?.state)
    XCTAssertEqual(inboxState.inboxState, .new)
    XCTAssertNil(inboxState.queuePosition)
    XCTAssertGreaterThan(try repository.syncActions(includePushed: false).count, 1)
  }

  func testEpisodeDetailSendToInboxClearsQueuePosition() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.addToQueueEnd(episode.id)
    let model = AppModel(repository: repository)
    model.start()
    let queued = try XCTUnwrap(model.queue.first { $0.id == episode.id })

    model.sendEpisodeToInbox(queued)

    let refreshed = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id })
    XCTAssertEqual(refreshed.state.inboxState, .new)
    XCTAssertNotNil(refreshed.state.inboxPosition)
    XCTAssertNil(refreshed.state.queuePosition)
    XCTAssertNil(refreshed.state.queuedAt)
    XCTAssertEqual(model.status, "Moved to Inbox.")
  }

  func testFavoriteTogglePersistsAndProtectsDownloadedEpisode() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.setDownloaded(episode.id, path: "/tmp/favorite.mp3", bytes: 10, source: "manual")
    try repository.markPlayed(episode.id, played: true)
    let model = AppModel(repository: repository)
    model.start()
    let downloaded = try XCTUnwrap(model.episodes.first { $0.id == episode.id })

    model.toggleFavorite(downloaded)

    let favorited = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id })
    XCTAssertTrue(favorited.state.favorite)
    XCTAssertFalse(try repository.inactiveDownloadedEpisodes(settings: repository.settings()).contains { $0.id == episode.id })
    XCTAssertEqual(model.status, "Added to Favorites.")

    model.toggleFavorite(favorited)

    let unfavorited = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id })
    XCTAssertFalse(unfavorited.state.favorite)
    XCTAssertTrue(try repository.inactiveDownloadedEpisodes(settings: repository.settings()).contains { $0.id == episode.id })
    XCTAssertEqual(model.status, "Removed from Favorites.")
    XCTAssertGreaterThan(try repository.syncActions(includePushed: false).count, 2)
  }

  func testFavoriteToggleRefreshesCurrentPlaybackSnapshot() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()
    let episode = try XCTUnwrap(model.episodes.first)
    model.audio.prepare(episode, settings: model.settings)

    model.toggleFavorite(episode)

    XCTAssertEqual(model.audio.current?.id, episode.id)
    XCTAssertEqual(model.audio.current?.state.favorite, true)

    let current = try XCTUnwrap(model.audio.current)
    model.toggleFavorite(current)

    XCTAssertEqual(model.audio.current?.id, episode.id)
    XCTAssertEqual(model.audio.current?.state.favorite, false)
  }

  func testListeningStatsDecodeLegacyRowsAndSortTopPodcasts() throws {
    let legacyJSON = """
    {
      "id": "local",
      "listeningSec": 3600,
      "contentSec": 4200,
      "speedSavedSec": 300,
      "silenceSavedSec": 120,
      "updatedAt": "2026-06-17T00:00:00Z"
    }
    """
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let legacyStats = try decoder.decode(ListeningStats.self, from: Data(legacyJSON.utf8))
    XCTAssertEqual(legacyStats.listeningSec, 3600)
    XCTAssertEqual(legacyStats.byPodcast, [:])

    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let podcasts = try repository.podcasts()
    try repository.saveListeningStats(ListeningStats(
      listeningSec: 7200,
      contentSec: 8100,
      speedSavedSec: 900,
      silenceSavedSec: 180,
      byPodcast: [
        podcasts[0].id: PodcastListeningStats(podcastId: podcasts[0].id, podcastTitle: podcasts[0].title, listeningSec: 1800, contentSec: 2100, speedSavedSec: 120, silenceSavedSec: 60),
        podcasts[1].id: PodcastListeningStats(podcastId: podcasts[1].id, podcastTitle: podcasts[1].title, listeningSec: 3600, contentSec: 3900, speedSavedSec: 300, silenceSavedSec: 90)
      ]
    ))
    let model = AppModel(repository: repository)
    model.start()

    XCTAssertEqual(model.listeningStats.listeningSec, 7200)
    XCTAssertEqual(model.topListeningPodcasts.map(\.podcastId), [podcasts[1].id, podcasts[0].id])
    XCTAssertEqual(model.topListeningPodcasts.first?.speedSavedSec, 300)
  }

  func testPlaybackTelemetryRecordsListeningStatsAndProgress() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    let model = AppModel(repository: repository)
    model.start()
    model.updateSettings {
      $0.playbackRate = 1.5
      $0.silenceShortening = true
    }

    model.recordPlaybackTelemetry(PlaybackTelemetrySample(
      episode: episode,
      mediaPositionSec: 30,
      mediaDeltaSec: 20,
      wallDeltaSec: 10
    ))

    let stats = try repository.listeningStats()
    XCTAssertEqual(stats.listeningSec, 10, accuracy: 0.001)
    XCTAssertEqual(stats.contentSec, 20, accuracy: 0.001)
    XCTAssertEqual(stats.speedSavedSec, 5, accuracy: 0.001)
    XCTAssertEqual(stats.silenceSavedSec, 5, accuracy: 0.001)
    let podcastStats = try XCTUnwrap(stats.byPodcast[episode.episode.podcastId])
    XCTAssertEqual(podcastStats.podcastTitle, episode.episode.podcastTitle)
    XCTAssertEqual(podcastStats.listeningSec, 10, accuracy: 0.001)

    let updated = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id })
    XCTAssertEqual(updated.state.progressSec, 30)
  }

  func testPodcastPlaybackOverridesApplyToEffectiveSettingsAndTelemetry() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    let podcast = try XCTUnwrap(try repository.podcasts().first { $0.id == episode.episode.podcastId })
    let model = AppModel(repository: repository)
    model.start()
    model.updateSettings {
      $0.playbackRate = 1.0
      $0.skipForwardSec = 30
      $0.skipBackSec = 15
      $0.silenceShortening = false
      $0.smartSkipCommercials = true
    }
    model.updatePodcastPreference(podcast) {
      $0.playbackRate = 1.75
      $0.skipForwardSec = 45
      $0.skipBackSec = 10
      $0.silenceShortening = true
      $0.smartSkipCommercials = false
    }

    let effective = model.effectivePlaybackSettings(for: episode)
    XCTAssertEqual(effective.playbackRate, 1.75)
    XCTAssertEqual(effective.skipForwardSec, 45)
    XCTAssertEqual(effective.skipBackSec, 10)
    XCTAssertEqual(effective.silenceShortening, true)
    XCTAssertEqual(effective.smartSkipCommercials, false)

    model.recordPlaybackTelemetry(PlaybackTelemetrySample(
      episode: episode,
      mediaPositionSec: 30,
      mediaDeltaSec: 20,
      wallDeltaSec: 10
    ))

    let stats = try repository.listeningStats()
    XCTAssertEqual(stats.speedSavedSec, 7.5, accuracy: 0.001)
    XCTAssertEqual(stats.silenceSavedSec, 2.5, accuracy: 0.001)
  }

  func testListeningSampleIgnoresInvalidTelemetryAndClampsLargeValues() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]

    try repository.addListeningSample(
      episode: episode,
      listeningSec: -.infinity,
      contentSec: 0,
      speedSavedSec: Double.nan,
      silenceSavedSec: -5
    )
    XCTAssertEqual(try repository.listeningStats().listeningSec, 0)

    try repository.addListeningSample(
      episode: episode,
      listeningSec: 180,
      contentSec: 240,
      speedSavedSec: 130,
      silenceSavedSec: 121
    )

    let stats = try repository.listeningStats()
    XCTAssertEqual(stats.listeningSec, 120)
    XCTAssertEqual(stats.contentSec, 120)
    XCTAssertEqual(stats.speedSavedSec, 120)
    XCTAssertEqual(stats.silenceSavedSec, 120)
    XCTAssertEqual(try XCTUnwrap(stats.byPodcast[episode.episode.podcastId]).contentSec, 120)
  }

  func testServerUrlNormalization() {
    XCTAssertEqual(BackendClient.normalizeServerUrl("localhost:8787"), "http://localhost:8787")
    XCTAssertEqual(BackendClient.normalizeServerUrl("pod.elephanthand.com/"), "https://pod.elephanthand.com")
  }

  func testAppModelReportsServerUrlSaveAndClearFeedback() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)

    model.saveServerUrl("")

    XCTAssertNil(model.settings.serverUrl)
    XCTAssertEqual(model.status, "Server URL cleared. Backend features are off.")
  }

  func testAppModelReportsServerTestProgressImmediately() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.settings.serverUrl = "https://pod.example.com"

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    BackendClient.defaultSession = URLSession(configuration: configuration)
    defer {
      BackendClient.defaultSession = .shared
      MockURLProtocol.handler = nil
    }

    MockURLProtocol.handler = { request in
      let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["content-type": "application/json"])!
      switch request.url?.path {
      case "/api/health":
        return (response, Data(#"{"ok":true}"#.utf8))
      case "/api/capabilities":
        return (response, Data(#"{}"#.utf8))
      default:
        XCTFail("Unexpected server test request: \(request.url?.path ?? "")")
        return (response, Data(#"{}"#.utf8))
      }
    }

    model.testServer()

    XCTAssertEqual(model.status, "Testing server.")
  }

  func testAppleSignInShowsBackendErrorMessage() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.settings.serverUrl = "https://pod.example.com"

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    BackendClient.defaultSession = URLSession(configuration: configuration)
    defer {
      BackendClient.defaultSession = .shared
      MockURLProtocol.handler = nil
    }

    MockURLProtocol.handler = { request in
      XCTAssertEqual(request.url?.path, "/api/auth/apple")
      let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: ["content-type": "application/json"])!
      return (response, Data(#"{"error":"Apple identity token audience is invalid.","code":"invalid_identity_token_audience"}"#.utf8))
    }

    model.signInWithApple(identityToken: Data("identity-token".utf8))
    XCTAssertEqual(model.status, "Signing in with Apple.")
    try await waitUntil { !model.signingInWithApple }

    XCTAssertEqual(model.status, "Apple sign-in failed: app bundle ID does not match the server audience.")
  }

  func testAppModelUpdateSettingsPersistsPlaybackAndDownloadPreferences() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()

    model.updateSettings {
      $0.skipForwardSec = 45
      $0.skipBackSec = 20
      $0.resumeRewindSec = 12
      $0.playbackRate = 1.35
      $0.autoPlayNext = false
      $0.nativeAudioPreferred = false
      $0.autoDownload = false
      $0.autoDownloadInbox = true
      $0.autoDeleteAfterListen = false
      $0.downloadOnlyWifi = false
      $0.storageCapMb = 4096
      $0.inboxSortDirection = .oldest
    }

    let saved = try repository.settings()
    XCTAssertEqual(saved.skipForwardSec, 45)
    XCTAssertEqual(saved.skipBackSec, 20)
    XCTAssertEqual(saved.resumeRewindSec, 12)
    XCTAssertEqual(saved.playbackRate, 1.35)
    XCTAssertEqual(saved.autoPlayNext, false)
    XCTAssertEqual(saved.nativeAudioPreferred, false)
    XCTAssertEqual(saved.autoDownload, false)
    XCTAssertEqual(saved.autoDownloadInbox, true)
    XCTAssertEqual(saved.autoDeleteAfterListen, false)
    XCTAssertEqual(saved.downloadOnlyWifi, false)
    XCTAssertEqual(saved.storageCapMb, 4096)
    XCTAssertEqual(saved.inboxSortDirection, .oldest)
  }

  func testOfflineModeFiltersPlayableLocalSurfaces() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    try repository.addToQueueEnd(episodes[0].id)
    try repository.addToQueueEnd(episodes[1].id)
    try repository.setDownloaded(episodes[1].id, path: "/tmp/downloaded.mp3", bytes: 10)
    try repository.setDownloaded(episodes[2].id, path: "/tmp/inbox-downloaded.mp3", bytes: 10)
    try repository.updateEpisodeState(episodes[2].id) { state in
      state.lastPlayedAt = Date()
    }
    let model = AppModel(repository: repository)
    model.start()

    XCTAssertGreaterThan(model.inbox.count, 1)
    XCTAssertEqual(model.queue.count, 2)
    model.setOfflineMode(true)

    XCTAssertTrue(model.settings.offlineMode)
    XCTAssertEqual(model.inbox.map(\.id), [episodes[2].id])
    XCTAssertEqual(model.queue.map(\.id), [episodes[1].id])
    XCTAssertEqual(model.history.map(\.id), [episodes[2].id])
    XCTAssertEqual(Set(model.libraryPodcasts.map(\.id)), Set([episodes[1].episode.podcastId, episodes[2].episode.podcastId]))

    model.setOfflineMode(false)
  }

  func testLibrarySearchMatchesPodcastMetadataAndRespectsOfflineMode() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    try repository.setDownloaded(episodes[3].id, path: "/tmp/open-lab.mp3", bytes: 10)
    let model = AppModel(repository: repository)
    model.start()

    XCTAssertEqual(model.libraryPodcasts(matching: "field notes").map(\.title), ["DaisyPod Field Notes"])
    XCTAssertEqual(model.libraryPodcasts(matching: "testing queueing").map(\.title), ["Open Podcast Lab"])
    XCTAssertEqual(model.libraryPodcasts(matching: "daisy-pod.xml").map(\.title), ["DaisyPod Field Notes"])
    XCTAssertEqual(model.libraryPodcasts(matching: "Local First Radio").map(\.title), ["Open Podcast Lab"])

    model.setOfflineMode(true)

    XCTAssertEqual(model.libraryPodcasts(matching: "").map(\.title), ["Open Podcast Lab"])
    XCTAssertEqual(model.libraryPodcasts(matching: "field notes"), [])
  }

  func testPodcastDetailSortFilterAndBulkActionsUseLocalStateAndSyncActions() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let podcast = try XCTUnwrap(try repository.podcasts().first { $0.title == "DaisyPod Field Notes" })
    let model = AppModel(repository: repository)
    model.start()

    XCTAssertEqual(model.podcastEpisodes(for: podcast).map(\.episode.title), [
      "Inbox, Queue, and the Shape of Attention",
      "Designing With Fewer Words and Better Buttons",
      "The Local-First Listening Machine"
    ])

    model.updatePodcastPreference(podcast) { preference in
      preference.sortDirection = .oldest
    }

    XCTAssertEqual(model.podcastEpisodes(for: podcast).map(\.episode.title), [
      "The Local-First Listening Machine",
      "Designing With Fewer Words and Better Buttons",
      "Inbox, Queue, and the Shape of Attention"
    ])

    let firstEpisode = try XCTUnwrap(model.podcastEpisodes(for: podcast).first)
    try repository.addToQueueEnd(firstEpisode.id)
    try model.refresh()

    model.markAllInPodcast(podcast, played: true)

    XCTAssertTrue(model.podcastEpisodes(for: podcast).allSatisfy(\.state.played))
    XCTAssertTrue(model.podcastEpisodes(for: podcast, filter: .unplayed).isEmpty)
    XCTAssertEqual(model.podcastEpisodes(for: podcast, filter: .played).count, 3)
    XCTAssertFalse(model.queue.contains { $0.episode.podcastId == podcast.id })

    model.markAllInPodcast(podcast, played: false)
    model.sendAllUnplayedInPodcastToInbox(podcast)

    let restored = model.podcastEpisodes(for: podcast)
    XCTAssertTrue(restored.allSatisfy { !$0.state.played })
    XCTAssertTrue(restored.allSatisfy { $0.state.inboxState == .new })
    XCTAssertTrue(restored.allSatisfy { $0.state.queuePosition == nil })
    XCTAssertGreaterThan(try repository.syncActions(includePushed: false).count, 6)
  }

  func testPodcastLibraryAndSubscriptionControlsPreserveLocalFirstState() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let podcast = try XCTUnwrap(try repository.podcasts().first { $0.title == "DaisyPod Field Notes" })
    let episode = try XCTUnwrap(try repository.podcastEpisodes(podcast.id).first)
    try repository.addToQueueEnd(episode.id)
    let model = AppModel(repository: repository)
    model.start()

    XCTAssertTrue(model.libraryPodcasts.contains { $0.id == podcast.id })
    XCTAssertTrue(model.isPodcastSubscribed(podcast))

    model.unsubscribePodcast(podcast)

    XCTAssertTrue(model.libraryPodcasts.contains { $0.id == podcast.id })
    XCTAssertFalse(model.isPodcastSubscribed(podcast))
    XCTAssertEqual(try repository.podcastPreference(for: podcast.id).inLibrary, true)

    model.subscribePodcast(podcast)
    model.removePodcastFromLibrary(podcast)

    XCTAssertFalse(model.libraryPodcasts.contains { $0.id == podcast.id })
    XCTAssertFalse(model.isPodcastSubscribed(podcast))
    XCTAssertFalse(model.queue.contains { $0.episode.podcastId == podcast.id })
    let hiddenPreference = try repository.podcastPreference(for: podcast.id)
    XCTAssertEqual(hiddenPreference.inLibrary, false)
    XCTAssertEqual(hiddenPreference.wasSubscribedBeforeLibraryRemoval, true)
    XCTAssertTrue(model.podcastEpisodes(for: podcast).allSatisfy { $0.state.inboxState == .archived && $0.state.queuePosition == nil })

    model.addPodcastToLibrary(podcast)

    XCTAssertTrue(model.libraryPodcasts.contains { $0.id == podcast.id })
    XCTAssertTrue(model.isPodcastSubscribed(podcast))
    let restoredPreference = try repository.podcastPreference(for: podcast.id)
    XCTAssertEqual(restoredPreference.inLibrary, true)
    XCTAssertEqual(restoredPreference.wasSubscribedBeforeLibraryRemoval, false)
    XCTAssertEqual(restoredPreference.addNewEpisodesToInbox, true)
  }

  func testPodcastRefreshUpsertsFeedAndRateLimitsImmediateRepeats() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let podcast = try XCTUnwrap(try repository.podcasts().first { $0.title == "DaisyPod Field Notes" })
    let refreshedAt = Date()
    let newEpisode = Episode(
      id: "ep_refresh_new",
      podcastId: podcast.id,
      podcastTitle: podcast.title,
      title: "Fresh Native Refresh Episode",
      description: "Pulled by manual refresh.",
      audioUrl: "https://example.com/audio/fresh.mp3",
      websiteUrl: podcast.websiteUrl,
      imageUrl: podcast.imageUrl,
      publishedAt: refreshedAt,
      durationSec: 900,
      explicit: false,
      chapters: [],
      guid: "refresh-new",
      enclosureLength: 1200,
      sourceType: .rss,
      sourceUrl: podcast.feedUrl,
      extractionStatus: ExtractionStatus.none,
      createdAt: refreshedAt,
      updatedAt: refreshedAt
    )
    var importCount = 0
    let model = AppModel(
      repository: repository,
      importRSS: { feedUrl, _ in
        importCount += 1
        var refreshedPodcast = podcast
        refreshedPodcast.title = "DaisyPod Field Notes"
        refreshedPodcast.feedUrl = feedUrl
        refreshedPodcast.updatedAt = refreshedAt
        return ParsedFeedResult(podcast: refreshedPodcast, episodes: [newEpisode])
      },
      podcastRefreshCooldown: 20
    )
    model.start()

    model.refreshPodcast(podcast, now: Date(timeIntervalSince1970: 100))
    try await waitUntil { !model.refreshingPodcastIds.contains(podcast.id) }

    XCTAssertEqual(importCount, 1)
    XCTAssertTrue(model.podcastEpisodes(for: podcast).contains { $0.id == newEpisode.id })
    XCTAssertEqual(model.status, "Refreshed DaisyPod Field Notes.")

    model.refreshPodcast(podcast, now: Date(timeIntervalSince1970: 105))

    XCTAssertEqual(importCount, 1)
    XCTAssertEqual(model.status, "DaisyPod Field Notes was just refreshed. Try again in a moment.")
  }

  func testAutomaticPodcastRefreshOnlyRefreshesDueLibraryFeeds() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    var backup = try repository.exportBackup()
    let now = Date(timeIntervalSince1970: 10_000)
    let oldRefresh = now.addingTimeInterval(-2 * 60 * 60)
    let recentRefresh = now.addingTimeInterval(-15 * 60)
    let duePodcastId = "feed_due"
    let recentPodcastId = "feed_recent"
    let removedPodcastId = "feed_removed"

    backup.settings.refreshIntervalMinutes = 60
    backup.feeds = [
      testPodcast(id: duePodcastId, title: "Due Show", feedUrl: "https://example.com/due.xml", lastRefreshedAt: oldRefresh),
      testPodcast(id: recentPodcastId, title: "Recent Show", feedUrl: "https://example.com/recent.xml", lastRefreshedAt: recentRefresh),
      testPodcast(id: removedPodcastId, title: "Removed Show", feedUrl: "https://example.com/removed.xml", lastRefreshedAt: oldRefresh)
    ]
    backup.episodes = []
    backup.states = []
    backup.podcastPreferences = [
      PodcastPreference(podcastId: duePodcastId, inLibrary: true, wasSubscribedBeforeLibraryRemoval: false, sortDirection: .newest, addNewEpisodesToInbox: true, updatedAt: oldRefresh),
      PodcastPreference(podcastId: recentPodcastId, inLibrary: true, wasSubscribedBeforeLibraryRemoval: false, sortDirection: .newest, addNewEpisodesToInbox: true, updatedAt: oldRefresh),
      PodcastPreference(podcastId: removedPodcastId, inLibrary: false, wasSubscribedBeforeLibraryRemoval: true, sortDirection: .newest, addNewEpisodesToInbox: false, updatedAt: oldRefresh)
    ]
    try repository.restoreBackup(backup)

    var importedFeedUrls: [String] = []
    let model = AppModel(
      repository: repository,
      importRSS: { feedUrl, _ in
        importedFeedUrls.append(feedUrl)
        let podcast = self.testPodcast(id: duePodcastId, title: "Due Show Refreshed", feedUrl: feedUrl, lastRefreshedAt: now)
        let episode = self.testEpisode(id: "ep_due_auto_refresh", podcast: podcast, title: "Automatic Refresh Episode", publishedAt: now)
        return ParsedFeedResult(podcast: podcast, episodes: [episode])
      }
    )
    model.start()

    let refreshedCount = await model.runAutomaticPodcastRefreshNow(now: now)

    XCTAssertEqual(refreshedCount, 1)
    XCTAssertEqual(importedFeedUrls, ["https://example.com/due.xml"])
    XCTAssertTrue(model.podcastEpisodes(for: try XCTUnwrap(model.podcasts.first { $0.id == duePodcastId })).contains { $0.id == "ep_due_auto_refresh" })
    XCTAssertEqual(model.status, "Refreshed 1 feed.")
  }

  func testOfflineModePersistsWithoutChangingSettingsSyncTimestamp() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let before = try repository.settings()
    let model = AppModel(repository: repository)
    model.start()

    model.setOfflineMode(true)

    let saved = try repository.settings()
    XCTAssertEqual(saved.offlineMode, true)
    XCTAssertEqual(saved.updatedAt, before.updatedAt)
    model.setOfflineMode(false)
  }

  func testAppSettingsDecodeKeepsDefaultsForMissingNewKeys() throws {
    let json = """
    {
      "id": "local",
      "skipForwardSec": 45,
      "smartSkipEnabled": true,
      "smartSkipCommercials": false,
      "deviceId": "device_a",
      "updatedAt": "2026-06-17T12:00:00Z"
    }
    """
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601

    let settings = try decoder.decode(AppSettings.self, from: Data(json.utf8))

    XCTAssertEqual(settings.skipForwardSec, 45)
    XCTAssertEqual(settings.smartSkipCommercials, false)
    XCTAssertEqual(settings.deviceId, "device_a")
    XCTAssertEqual(settings.smartSkipSelfPromo, false)
    XCTAssertEqual(settings.smartSkipIntros, false)
    XCTAssertEqual(settings.smartSkipOutros, false)
    XCTAssertEqual(settings.smartSkipUseServerMedia, true)
    XCTAssertEqual(settings.nativeAudioPreferred, true)
    XCTAssertEqual(settings.downloadOnlyWifi, true)
    XCTAssertEqual(settings.offlineMode, false)
    XCTAssertEqual(settings.theme, .light)
    XCTAssertEqual(settings.themeSchemaVersion, AppTheme.currentSchemaVersion)
    XCTAssertNil(settings.sleepTimerEndsAt)
  }

  func testAppSettingsMigratesLegacyThemeToLight() throws {
    let json = """
    {
      "id": "local",
      "theme": "dark",
      "deviceId": "device_a",
      "updatedAt": "2026-06-17T12:00:00Z"
    }
    """
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601

    let settings = try decoder.decode(AppSettings.self, from: Data(json.utf8))

    XCTAssertEqual(settings.theme, .light)
    XCTAssertEqual(settings.themeSchemaVersion, AppTheme.currentSchemaVersion)
  }

  func testAppSettingsDecodesCurrentThemeSelection() throws {
    let json = """
    {
      "id": "local",
      "theme": "vaporwave",
      "themeSchemaVersion": 1,
      "deviceId": "device_a",
      "updatedAt": "2026-06-17T12:00:00Z"
    }
    """
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601

    let settings = try decoder.decode(AppSettings.self, from: Data(json.utf8))

    XCTAssertEqual(settings.theme, .vaporwave)
    XCTAssertEqual(settings.themeSchemaVersion, AppTheme.currentSchemaVersion)
  }

  func testPodcastIndexDiscoveryResponseDecodesServerShape() throws {
    let json = """
    {
      "items": [
        {
          "id": 123,
          "title": "Native Podcast",
          "author": "Example Network",
          "description": "A show from PodcastIndex.",
          "image": "https://example.com/art.jpg",
          "feedUrl": "https://example.com/feed.xml",
          "categories": { "1": "Technology", "2": "News" }
        }
      ],
      "max": 30,
      "total": 1
    }
    """
    let response = try JSONDecoder().decode(PodcastDiscoveryResponse.self, from: Data(json.utf8))

    XCTAssertEqual(response.items.count, 1)
    XCTAssertEqual(response.items[0].id, "123")
    XCTAssertEqual(response.items[0].title, "Native Podcast")
    XCTAssertEqual(response.items[0].author, "Example Network")
    XCTAssertEqual(response.items[0].imageUrl, "https://example.com/art.jpg")
    XCTAssertEqual(response.items[0].feedUrl, "https://example.com/feed.xml")
    XCTAssertEqual(Set(response.items[0].categories), Set(["Technology", "News"]))
  }

  func testBackendCapabilitiesDecodeNativeFeatureFlags() throws {
    let json = """
    {
      "youtubeImport": { "enabled": false },
      "podcastIndex": { "enabled": true },
      "clips": { "enabled": true },
      "silenceMaps": { "enabled": false },
      "smartSkip": { "enabled": true }
    }
    """

    let capabilities = try JSONDecoder().decode(BackendCapabilities.self, from: Data(json.utf8))

    XCTAssertEqual(capabilities.youtubeImport?.enabled, false)
    XCTAssertEqual(capabilities.podcastIndex?.enabled, true)
    XCTAssertEqual(capabilities.clips?.enabled, true)
    XCTAssertEqual(capabilities.silenceMaps?.enabled, false)
    XCTAssertEqual(capabilities.smartSkip?.enabled, true)
  }

  func testYouTubeURLClassifierSupportsBackendImportShapes() {
    XCTAssertEqual(YouTubeURLClassifier.sourceKind(for: "https://www.youtube.com/watch?v=abc123"), .video)
    XCTAssertEqual(YouTubeURLClassifier.sourceKind(for: "https://youtu.be/abc123"), .video)
    XCTAssertEqual(YouTubeURLClassifier.sourceKind(for: "https://www.youtube.com/playlist?list=PL123"), .playlist)
    XCTAssertEqual(YouTubeURLClassifier.sourceKind(for: "https://www.youtube.com/@DaisyPod"), .channel)
    XCTAssertNil(YouTubeURLClassifier.sourceKind(for: "https://www.youtube.com/shorts/abc123"))
    XCTAssertNil(YouTubeURLClassifier.sourceKind(for: "https://example.com/feed.xml"))
  }

  func testYouTubeImportResponseDecodesSyntheticFeed() throws {
    let json = """
    {
      "podcast": {
        "id": "feed_youtube",
        "title": "YouTube Channel",
        "author": "Example Creator",
        "description": "Synthetic podcast feed for a YouTube channel.",
        "imageUrl": "https://pod.example/media/youtube-thumbnails/thumb.jpg",
        "feedUrl": "https://pod.example/api/youtube/feed.xml?url=https%3A%2F%2Fwww.youtube.com%2Fchannel%2FUC123",
        "websiteUrl": "https://www.youtube.com/channel/UC123",
        "tags": ["YouTube"],
        "sourceType": "youtube-channel",
        "sourceUrl": "https://www.youtube.com/channel/UC123",
        "externalId": "UC123",
        "createdAt": "2026-06-17T00:00:00Z",
        "updatedAt": "2026-06-17T00:00:00Z"
      },
      "episodes": [
        {
          "id": "ep_youtube",
          "podcastId": "feed_youtube",
          "podcastTitle": "YouTube Channel",
          "title": "Native YouTube Episode",
          "description": "Imported from YouTube.",
          "audioUrl": "https://pod.example/media/youtube/ep_youtube.mp3",
          "websiteUrl": "https://www.youtube.com/watch?v=abc123",
          "publishedAt": "2026-06-17T00:00:00Z",
          "durationSec": 1200,
          "chapters": [],
          "guid": "youtube:abc123",
          "sourceType": "youtube",
          "sourceUrl": "https://www.youtube.com/watch?v=abc123",
          "externalId": "abc123",
          "extractionStatus": "queued",
          "createdAt": "2026-06-17T00:00:00Z",
          "updatedAt": "2026-06-17T00:00:00Z"
        }
      ]
    }
    """
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let result = try decoder.decode(ParsedFeedResult.self, from: Data(json.utf8))

    XCTAssertEqual(result.podcast.sourceType, .youtubeChannel)
    XCTAssertEqual(result.podcast.tags, ["YouTube"])
    XCTAssertEqual(result.episodes.count, 1)
    XCTAssertEqual(result.episodes[0].sourceType, .youtube)
    XCTAssertEqual(result.episodes[0].extractionStatus, .queued)
    XCTAssertEqual(result.episodes[0].audioUrl, "https://pod.example/media/youtube/ep_youtube.mp3")
  }

  func testYouTubeEnrichmentAndExtractionResponsesDecode() throws {
    let enrichmentJSON = """
    {
      "episodeId": "ep_youtube",
      "patch": {
        "id": "ep_youtube",
        "title": "Enriched Title",
        "description": "Better metadata",
        "websiteUrl": "https://www.youtube.com/watch?v=abc123",
        "imageUrl": "https://img.youtube.com/vi/abc123/hqdefault.jpg",
        "publishedAt": "2026-06-17T00:00:00Z",
        "durationSec": 1210,
        "sourceUrl": "https://www.youtube.com/watch?v=abc123",
        "externalId": "abc123",
        "updatedAt": "2026-06-17T00:00:01Z"
      }
    }
    """
    let extractionJSON = """
    {
      "episodeId": "ep_youtube",
      "sourceUrl": "https://www.youtube.com/watch?v=abc123",
      "extractionStatus": "processing",
      "audioReady": false
    }
    """
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    let enrichment = try decoder.decode(YouTubeEnrichmentResponse.self, from: Data(enrichmentJSON.utf8))
    let extraction = try decoder.decode(YouTubeExtractionResponse.self, from: Data(extractionJSON.utf8))

    XCTAssertEqual(enrichment.episodeId, "ep_youtube")
    XCTAssertEqual(enrichment.patch.title, "Enriched Title")
    XCTAssertEqual(enrichment.patch.durationSec, 1210)
    XCTAssertEqual(extraction.extractionStatus, .processing)
    XCTAssertFalse(extraction.audioReady)
  }

  func testRepositoryAppliesYouTubeEpisodeMetadataPatch() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    let timestamp = ISO8601DateFormatter().date(from: "2026-06-17T00:00:00Z")!
    let podcast = Podcast(
      id: "feed_youtube",
      title: "YouTube Channel",
      author: nil,
      description: nil,
      imageUrl: nil,
      feedUrl: "https://pod.example/api/youtube/feed.xml",
      websiteUrl: "https://www.youtube.com/channel/UC123",
      tags: ["YouTube"],
      sourceType: .youtubeChannel,
      sourceUrl: "https://www.youtube.com/channel/UC123",
      externalId: "UC123",
      lastRefreshedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    )
    let episode = Episode(
      id: "ep_youtube",
      podcastId: podcast.id,
      podcastTitle: podcast.title,
      title: "Original Title",
      description: nil,
      audioUrl: "https://pod.example/media/youtube/ep_youtube.mp3",
      websiteUrl: "https://www.youtube.com/watch?v=abc123",
      imageUrl: nil,
      publishedAt: timestamp,
      durationSec: nil,
      explicit: false,
      chapters: [],
      guid: "youtube:abc123",
      sourceType: .youtube,
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
      externalId: "abc123",
      extractionStatus: ExtractionStatus.none,
      createdAt: timestamp,
      updatedAt: timestamp
    )
    try repository.upsertParsedFeed(ParsedFeedResult(podcast: podcast, episodes: [episode]))
    try repository.updateEpisodeMetadata("ep_youtube", patch: YouTubeEpisodePatch(title: "Enriched Title", durationSec: 1210, extractionStatus: .ready))

    let updated = try XCTUnwrap(repository.episodes().first { $0.id == "ep_youtube" })
    XCTAssertEqual(updated.episode.title, "Enriched Title")
    XCTAssertEqual(updated.episode.durationSec, 1210)
    XCTAssertEqual(updated.episode.extractionStatus, .ready)
    XCTAssertEqual(updated.state.progressSec, 0)
  }

  func testPublishClipResponseDecodesServerShape() throws {
    let json = """
    {
      "id": "clip_server",
      "publicUrl": "https://pod.example/clip/clip_server",
      "renderedAudioUrl": "https://pod.example/media/clips/clip_server.mp3",
      "renderedUrl": "https://pod.example/media/clips/clip_server.mp3",
      "renderStatus": "pending",
      "fileSizeBytes": 1234
    }
    """

    let response = try JSONDecoder().decode(PublishClipResponse.self, from: Data(json.utf8))

    XCTAssertEqual(response.id, "clip_server")
    XCTAssertEqual(response.publicUrl, "https://pod.example/clip/clip_server")
    XCTAssertEqual(response.renderedAudioUrl, "https://pod.example/media/clips/clip_server.mp3")
    XCTAssertEqual(response.renderStatus, .pending)
    XCTAssertEqual(response.fileSizeBytes, 1234)
  }

  func testBackendClientPublishesClipPayload() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    let session = URLSession(configuration: configuration)
    let expectedURL = URL(string: "https://pod.example.com/api/clips")!
    let timestamp = Date()
    let clip = Clip(
      id: "clip_local",
      episodeId: "episode_1",
      podcastTitle: "Show",
      episodeTitle: "Episode",
      sourceAudioUrl: "https://audio.example.com/episode.mp3",
      startSec: 15,
      endSec: 45,
      title: "Shareable moment",
      note: "A useful note",
      renderStatus: .pending,
      createdAt: timestamp,
      updatedAt: timestamp
    )
    MockURLProtocol.handler = { request in
      XCTAssertEqual(request.url, expectedURL)
      XCTAssertEqual(request.httpMethod, "POST")
      XCTAssertEqual(request.value(forHTTPHeaderField: "x-daisypod-client"), "ios")
      XCTAssertEqual(request.value(forHTTPHeaderField: "x-daisypod-native-account"), "icloud")
      XCTAssertNil(request.value(forHTTPHeaderField: "authorization"))
      let response = HTTPURLResponse(url: expectedURL, statusCode: 201, httpVersion: nil, headerFields: ["content-type": "application/json"])!
      let data = Data("""
      {
        "id": "clip_local",
        "publicUrl": "https://pod.example.com/clip/clip_local",
        "renderStatus": "pending"
      }
      """.utf8)
      return (response, data)
    }
    var client = try XCTUnwrap(BackendClient(serverUrl: "https://pod.example.com"))
    client.session = session

    let response = try await client.publishClip(clip)

    XCTAssertEqual(response.id, "clip_local")
    XCTAssertEqual(response.publicUrl, "https://pod.example.com/clip/clip_local")
    XCTAssertEqual(response.renderStatus, .pending)
  }

  func testRepositorySavesClipAndIncrementsEpisodeClipCountOnce() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    let timestamp = Date()
    let clip = Clip(
      id: "clip_1",
      episodeId: episode.id,
      podcastTitle: episode.episode.podcastTitle,
      episodeTitle: episode.episode.title,
      sourceAudioUrl: episode.episode.audioUrl,
      startSec: 10,
      endSec: 40,
      title: "Shareable moment",
      note: "Local note",
      publicUrl: "https://pod.example/clip/clip_1",
      renderStatus: .pending,
      createdAt: timestamp,
      updatedAt: timestamp
    )

    try repository.saveClip(clip)
    var updatedClip = clip
    updatedClip.renderStatus = .ready
    updatedClip.renderedAudioUrl = "https://pod.example/media/clips/clip_1.mp3"
    try repository.saveClip(updatedClip)

    let stored = try XCTUnwrap(repository.clips().first { $0.id == "clip_1" })
    let state = try XCTUnwrap(repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertEqual(stored.renderStatus, .ready)
    XCTAssertEqual(stored.renderedAudioUrl, "https://pod.example/media/clips/clip_1.mp3")
    XCTAssertEqual(state.clipCount, 1)
  }

  func testAppModelPublishesLocalClipWithoutServer() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()
    let episode = try XCTUnwrap(model.episodes.first)

    model.publishClip(
      episode: episode,
      title: "Local share moment",
      note: "Saved on device",
      startSec: 5,
      endSec: 25
    )

    try await waitUntil {
      model.status == "Clip saved locally."
    }

    let stored = try XCTUnwrap(try repository.clips().first { $0.title == "Local share moment" })
    let state = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertEqual(stored.renderStatus, .localOnly)
    XCTAssertEqual(stored.note, "Saved on device")
    XCTAssertNil(stored.publicUrl)
    XCTAssertEqual(state.clipCount, 1)
    XCTAssertTrue(model.clips.contains { $0.id == stored.id })
  }

  func testAppModelKeepsClipLocalWhenServerDisablesClipPublishing() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()
    model.settings.serverUrl = "https://pod.example.com"
    model.backendCapabilities = try disabledCapabilities(clips: false)
    let episode = try XCTUnwrap(model.episodes.first)

    model.publishClip(
      episode: episode,
      title: "Server disabled local moment",
      note: nil,
      startSec: 5,
      endSec: 25
    )

    let stored = try XCTUnwrap(try repository.clips().first { $0.title == "Server disabled local moment" })
    XCTAssertEqual(stored.renderStatus, .localOnly)
    XCTAssertNil(stored.publicUrl)
    XCTAssertEqual(model.status, "Clip saved locally; publishing disabled on this server.")
  }

  func testServerCapabilityGatesShortCircuitNativeActions() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()
    model.settings.serverUrl = "https://pod.example.com"
    model.appleAccountState = .available
    model.backendCapabilities = try disabledCapabilities(
      podcastIndex: false,
      youtubeImport: false,
      silenceMaps: false,
      smartSkip: false
    )
    let episode = try XCTUnwrap(model.episodes.first)

    model.searchPodcasts("native podcasts")
    XCTAssertEqual(model.status, "PodcastIndex search is disabled on this server.")

    model.importYouTubeSource("https://www.youtube.com/watch?v=abc123")
    XCTAssertEqual(model.status, "YouTube import is disabled on this server.")

    model.requestSilenceMap(episode)
    XCTAssertEqual(model.status, "Shorten Silence is disabled on this server.")

    model.requestSmartSkip(episode)
    XCTAssertEqual(model.status, "Smart Skip is disabled on this server.")
  }

  func testNativeServerFeaturesDoNotRequireAppleAccountState() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()
    model.settings.serverUrl = "https://pod.example.com"
    model.appleAccountState = .noAccount
    model.backendCapabilities = try disabledCapabilities()
    let episode = try XCTUnwrap(model.episodes.first)

    XCTAssertEqual(model.appleAccountStatusText, "iCloud sync not active")

    model.searchPodcasts("native podcasts")
    XCTAssertTrue(model.searchingPodcasts)

    model.importYouTubeSource("https://www.youtube.com/watch?v=abc123")
    XCTAssertTrue(model.importingYouTube)

    model.requestSilenceMap(episode)
    XCTAssertEqual(model.status, "Preparing Shorten Silence.")
  }

  func testPodcastIndexUnauthorizedSearchReportsPrivateTokenRequirement() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()
    model.settings.serverUrl = "https://pod.example.com"

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    BackendClient.defaultSession = URLSession(configuration: configuration)
    defer {
      BackendClient.defaultSession = .shared
      MockURLProtocol.handler = nil
    }

    MockURLProtocol.handler = { request in
      XCTAssertEqual(request.url?.path, "/api/podcast-index/search")
      XCTAssertEqual(request.value(forHTTPHeaderField: "x-daisypod-client"), "ios")
      XCTAssertEqual(request.value(forHTTPHeaderField: "x-daisypod-native-account"), "icloud")
      let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: ["content-type": "application/json"])!
      return (response, Data(#"{"error":"Native iOS app access is required."}"#.utf8))
    }

    model.searchPodcasts("native podcasts")
    for _ in 0..<100 where model.searchingPodcasts {
      try await Task.sleep(nanoseconds: 10_000_000)
    }

    XCTAssertFalse(model.searchingPodcasts)
    XCTAssertEqual(model.status, "PodcastIndex search needs a private app token for this server.")
  }

  func testSilenceMapAndSmartSkipResponsesDecode() throws {
    let silenceJSON = """
    {
      "id": "silence_ep1",
      "episodeId": "ep1",
      "audioUrl": "https://audio.example.com/ep1.mp3",
      "status": "ready",
      "segments": [
        {
          "silenceStartSec": 10,
          "silenceEndSec": 14,
          "skipFromSec": 10.25,
          "skipToSec": 13.75,
          "retainedSilenceSec": 0.25
        }
      ],
      "durationSec": 120,
      "thresholdDb": -42,
      "minimumSilenceSec": 0.7,
      "retainedSilenceSec": 0.25,
      "analyzerVersion": "v1",
      "createdAt": "2026-06-17T00:00:00Z",
      "updatedAt": "2026-06-17T00:00:01Z"
    }
    """
    let smartSkipJSON = """
    {
      "jobId": "job1",
      "status": "ready",
      "segmentMap": {
        "schemaVersion": "daisypod.smart-skip.v1",
        "episodeId": "ep1",
        "podcastId": "pod1",
        "mediaVersionId": "media1",
        "audioUrl": "https://audio.example.com/ep1.mp3",
        "durationMs": 120000,
        "generatedAt": "2026-06-17T00:00:02Z",
        "status": "ready",
        "segments": [
          {
            "id": "seg1",
            "type": "sponsorship",
            "startMs": 30000,
            "endMs": 45000,
            "confidence": 0.93,
            "action": "auto_skip",
            "source": "codex_segmenter",
            "label": "Sponsor read",
            "evidence": ["discount code"]
          }
        ]
      }
    }
    """
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601

    let silence = try decoder.decode(SilenceMap.self, from: Data(silenceJSON.utf8))
    let smartSkip = try decoder.decode(SmartSkipProcessResponse.self, from: Data(smartSkipJSON.utf8))

    XCTAssertEqual(silence.status, .ready)
    XCTAssertEqual(silence.segments.count, 1)
    XCTAssertEqual(silence.segments[0].skipToSec, 13.75)
    XCTAssertEqual(smartSkip.status, .ready)
    XCTAssertEqual(smartSkip.segmentMap?.segments.first?.type, .sponsorship)
    XCTAssertEqual(smartSkip.segmentMap?.segments.first?.action, .autoSkip)
  }

  func testRepositoryCachesServerDerivedMapsWithoutSyncingThem() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    let timestamp = Date()
    let silence = SilenceMap(
      id: "silence_1",
      episodeId: episode.id,
      audioUrl: episode.episode.audioUrl,
      status: .ready,
      segments: [SilenceMapSegment(silenceStartSec: 1, silenceEndSec: 4, skipFromSec: 1.25, skipToSec: 3.75, retainedSilenceSec: 0.25)],
      durationSec: episode.episode.durationSec,
      thresholdDb: -42,
      minimumSilenceSec: 0.7,
      retainedSilenceSec: 0.25,
      analyzerVersion: "v1",
      error: nil,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRequestedAt: nil,
      lastCheckedAt: nil
    )
    let segmentMap = SmartSkipSegmentMap(
      schemaVersion: "daisypod.smart-skip.v1",
      episodeId: episode.id,
      podcastId: episode.episode.podcastId,
      mediaVersionId: "media_1",
      audioUrl: episode.episode.audioUrl,
      durationMs: 120000,
      generatedAt: timestamp,
      status: .ready,
      segments: [
        SmartSkipSegment(
          id: "seg_1",
          type: .ad,
          subtype: nil,
          startMs: 1000,
          endMs: 5000,
          confidence: 0.9,
          action: .autoSkip,
          source: .codexSegmenter,
          label: "Ad",
          evidence: nil,
          originalStartMs: nil,
          originalEndMs: nil
        )
      ]
    )

    try repository.saveSilenceMap(silence, requestedAt: timestamp, checkedAt: timestamp)
    let transcript = SmartSkipTranscript(
      mediaVersionId: "media_1",
      provider: "whisper",
      model: "large-v3-turbo",
      language: "en",
      durationMs: 120000,
      segments: [
        SmartSkipTranscriptSegment(startMs: 1000, endMs: 5000, speaker: nil, text: "Sponsor message.")
      ]
    )

    try repository.saveSmartSkipSegmentMap(segmentMap, transcript: transcript)

    XCTAssertEqual(try repository.cachedSilenceMap(for: episode)?.segments.count, 1)
    XCTAssertEqual(try repository.cachedSmartSkipEntry(for: episode)?.map?.segments.count, 1)
    XCTAssertEqual(try repository.cachedSmartSkipEntry(for: episode)?.transcript?.segments.first?.text, "Sponsor message.")

    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let backupJSON = String(decoding: try encoder.encode(try repository.exportBackup()), as: UTF8.self)
    XCTAssertTrue(backupJSON.contains("silence_1"))
    XCTAssertTrue(backupJSON.contains("daisypod.smart-skip.v1"))
    XCTAssertTrue(backupJSON.contains("Sponsor message."))
  }

  func testNativeDownloadManagerCopiesAndDeletesLocalFile() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-download-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    let source = root.appending(path: "source.mp3")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try Data("audio bytes".utf8).write(to: source)
    defer { try? FileManager.default.removeItem(at: root) }

    var episode = SeedData.episodes[0]
    episode.audioUrl = source.absoluteString
    let item = EpisodeWithState(episode: episode, state: SeedData.defaultState(for: episode.id))
    let manager = NativeDownloadManager(downloadsRoot: root.appending(path: "Downloads", directoryHint: .isDirectory))

    let result = try await manager.download(item)

    XCTAssertEqual(result.episodeId, episode.id)
    XCTAssertEqual(result.bytes, 11)
    XCTAssertTrue(FileManager.default.fileExists(atPath: result.path))
    XCTAssertTrue(try manager.delete(episodeId: episode.id, storedPath: result.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: result.path))
  }

  func testNativeDownloadManagerAppliesWifiOnlyNetworkPolicy() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-remote-download-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    defer { MockURLProtocol.handler = nil }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    let session = URLSession(configuration: configuration)
    var observedAllowsExpensive: Bool?
    var observedAllowsConstrained: Bool?
    MockURLProtocol.handler = { request in
      observedAllowsExpensive = request.allowsExpensiveNetworkAccess
      observedAllowsConstrained = request.allowsConstrainedNetworkAccess
      let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      return (response, Data("remote audio".utf8))
    }

    var episode = SeedData.episodes[0]
    episode.audioUrl = "https://example.com/audio.mp3"
    let item = EpisodeWithState(episode: episode, state: SeedData.defaultState(for: episode.id))
    let manager = NativeDownloadManager(session: session, downloadsRoot: root.appending(path: "Downloads", directoryHint: .isDirectory))

    let result = try await manager.download(item, policy: NativeDownloadPolicy(wifiOnly: true))

    XCTAssertEqual(result.bytes, 12)
    XCTAssertEqual(observedAllowsExpensive, false)
    XCTAssertEqual(observedAllowsConstrained, false)
  }

  func testNativeDownloadManagerPrefetchesArtworkWithDownloadPolicy() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-artwork-download-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    defer { MockURLProtocol.handler = nil }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    let session = URLSession(configuration: configuration)
    var artworkAllowsExpensive: Bool?
    var artworkAllowsConstrained: Bool?
    MockURLProtocol.handler = { request in
      let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      if request.url?.lastPathComponent == "art.jpg" {
        artworkAllowsExpensive = request.allowsExpensiveNetworkAccess
        artworkAllowsConstrained = request.allowsConstrainedNetworkAccess
        return (response, Data("art bytes".utf8))
      }
      return (response, Data("remote audio".utf8))
    }

    var episode = SeedData.episodes[0]
    episode.audioUrl = "https://example.com/audio.mp3"
    episode.imageUrl = "https://example.com/art.jpg"
    let item = EpisodeWithState(episode: episode, state: SeedData.defaultState(for: episode.id))
    let manager = NativeDownloadManager(session: session, downloadsRoot: root.appending(path: "Downloads", directoryHint: .isDirectory))

    let result = try await manager.download(item, policy: NativeDownloadPolicy(wifiOnly: true))
    let cachedArtwork = try XCTUnwrap(result.artworkPath)

    XCTAssertEqual(try String(contentsOfFile: cachedArtwork, encoding: .utf8), "art bytes")
    XCTAssertEqual(manager.cachedArtworkURL(for: item)?.path, cachedArtwork)
    XCTAssertEqual(artworkAllowsExpensive, false)
    XCTAssertEqual(artworkAllowsConstrained, false)
  }

  func testAutomaticDownloadCandidatesPreferQueueThenInbox() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    try repository.addToQueueEnd(episodes[2].id)
    try repository.addToQueueEnd(episodes[1].id)
    var settings = try repository.settings()
    settings.autoDownload = true
    settings.autoDownloadInbox = true

    let candidates = try repository.automaticDownloadCandidates(settings: settings, limit: 4)

    XCTAssertEqual(candidates[0].episode.id, episodes[2].id)
    XCTAssertEqual(candidates[0].source, "queue")
    XCTAssertEqual(candidates[1].episode.id, episodes[1].id)
    XCTAssertEqual(candidates[1].source, "queue")
    XCTAssertTrue(candidates.dropFirst(2).allSatisfy { $0.source == "inbox" })
  }

  func testBackgroundDownloadSchedulerRegistersAndSeesQueuedWorkOnStart() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.addToQueueEnd(episode.id)
    let scheduler = SpyBackgroundDownloadScheduler()
    let model = AppModel(
      repository: repository,
      backgroundDownloadScheduler: scheduler
    )

    model.start()

    XCTAssertEqual(scheduler.registerCount, 1)
    XCTAssertEqual(scheduler.scheduleCalls.first?.hasDownloadWork, true)
    XCTAssertEqual(scheduler.scheduleCalls.first?.downloadOnlyWifi, true)
  }

  func testBackgroundDownloadSchedulerReschedulesAfterDownloadMaintenance() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    var settings = try repository.settings()
    settings.autoDownload = false
    settings.autoDownloadInbox = false
    try repository.saveSettings(settings)
    let scheduler = SpyBackgroundDownloadScheduler()
    let model = AppModel(
      repository: repository,
      backgroundDownloadScheduler: scheduler
    )
    try model.refresh()

    let success = await model.runDownloadMaintenanceNow()

    XCTAssertTrue(success)
    XCTAssertEqual(scheduler.scheduleCalls.last?.hasDownloadWork, false)
  }

  func testDownloadMaintenanceRequestsServerIntelligenceForQueueAndInboxIntent() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    for episode in episodes {
      try repository.removeFromInbox(episode.id)
    }
    let queued = episodes[0]
    let inbox = episodes[1]
    try repository.addToQueueEnd(queued.id)
    try repository.sendEpisodeToInbox(inbox.id)
    var settings = try repository.settings()
    settings.serverUrl = "https://pod.example.test"
    settings.autoDownload = false
    settings.autoDownloadInbox = false
    settings.smartSkipEnabled = true
    try repository.saveSettings(settings)

    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [MockURLProtocol.self]
    BackendClient.defaultSession = URLSession(configuration: configuration)
    defer {
      BackendClient.defaultSession = .shared
      MockURLProtocol.handler = nil
    }

    let recorder = ServerIntelligenceRequestRecorder()
    MockURLProtocol.handler = { request in
      recorder.recordHeaders(from: request)
      guard let url = request.url else { throw URLError(.badURL) }
      let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["content-type": "application/json"])!
      let body = request.bodyData
      let payload = (try JSONSerialization.jsonObject(with: body) as? [String: Any]) ?? [:]
      let path = url.path
      if path == "/api/audio/silence-maps" {
        guard let episodeId = payload["episodeId"] as? String,
              let audioUrl = payload["audioUrl"] as? String
        else {
          throw URLError(.cannotParseResponse)
        }
        recorder.recordSilenceMapRequest(episodeId: episodeId)
        let json = """
        {
          "id": "silence-\(episodeId)",
          "episodeId": "\(episodeId)",
          "audioUrl": "\(audioUrl)",
          "status": "ready",
          "segments": [],
          "durationSec": 120,
          "thresholdDb": -42,
          "minimumSilenceSec": 0.7,
          "retainedSilenceSec": 0.25,
          "analyzerVersion": "test",
          "createdAt": "2026-06-17T00:00:00Z",
          "updatedAt": "2026-06-17T00:00:00Z"
        }
        """
        return (response, Data(json.utf8))
      }
      if path == "/api/smart-skip/process" {
        guard let episodeId = payload["episodeId"] as? String else {
          throw URLError(.cannotParseResponse)
        }
        recorder.recordSmartSkipRequest(
          episodeId: episodeId,
          priority: payload["priority"] as? String
        )
        let json = """
        {
          "jobId": "smart-\(episodeId)",
          "status": "queued",
          "stage": "queued",
          "segmentMap": null,
          "transcript": null,
          "error": null
        }
        """
        return (response, Data(json.utf8))
      }
      throw URLError(.unsupportedURL)
    }
    let model = AppModel(repository: repository)
    try model.refresh()

    let success = await model.runDownloadMaintenanceNow()

    XCTAssertTrue(success)
    XCTAssertEqual(recorder.clientHeaders, ["ios"])
    XCTAssertEqual(recorder.nativeAccountHeaders, ["icloud"])
    XCTAssertEqual(recorder.silenceEpisodeIds, [queued.id, inbox.id])
    XCTAssertEqual(recorder.smartSkipPriorities[queued.id], "queue")
    XCTAssertEqual(recorder.smartSkipPriorities[inbox.id], "inbox")
    let refreshedQueued = try XCTUnwrap(try repository.episodes().first { $0.id == queued.id })
    let refreshedInbox = try XCTUnwrap(try repository.episodes().first { $0.id == inbox.id })
    XCTAssertEqual(try repository.cachedSilenceMap(for: refreshedQueued)?.status, .ready)
    XCTAssertEqual(try repository.cachedSilenceMap(for: refreshedInbox)?.status, .ready)
    XCTAssertEqual(try repository.cachedSmartSkipEntry(for: refreshedQueued)?.status, .queued)
    XCTAssertEqual(try repository.cachedSmartSkipEntry(for: refreshedQueued)?.reason, "queue")
    XCTAssertEqual(try repository.cachedSmartSkipEntry(for: refreshedInbox)?.status, .queued)
    XCTAssertEqual(try repository.cachedSmartSkipEntry(for: refreshedInbox)?.reason, "inbox")
  }

  func testInactiveDownloadEligibilityKeepsManualQueueInboxAndFavorites() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    try repository.setDownloaded(episodes[0].id, path: "/tmp/queued.mp3", bytes: 10, source: "queue")
    try repository.addToQueueEnd(episodes[0].id)
    try repository.setDownloaded(episodes[1].id, path: "/tmp/inbox.mp3", bytes: 10, source: "inbox")
    try repository.setDownloaded(episodes[2].id, path: "/tmp/played.mp3", bytes: 10, source: "queue")
    try repository.markPlayed(episodes[2].id, played: true)
    try repository.setDownloaded(episodes[3].id, path: "/tmp/manual.mp3", bytes: 10, source: "manual")

    let inactive = try repository.inactiveDownloadedEpisodes(settings: repository.settings())

    XCTAssertTrue(inactive.contains { $0.id == episodes[2].id })
    XCTAssertFalse(inactive.contains { $0.id == episodes[0].id })
    XCTAssertFalse(inactive.contains { $0.id == episodes[1].id })
    XCTAssertFalse(inactive.contains { $0.id == episodes[3].id && $0.state.downloadSource == "manual" && !$0.state.played })
  }

  func testDismissInboxDeletesInboxDownloadWhenInboxAutoDownloadIsEnabled() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-inbox-dismiss-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    var settings = try repository.settings()
    settings.autoDownload = false
    settings.autoDownloadInbox = true
    try repository.saveSettings(settings)
    let episode = try repository.episodes()[0]
    let path = try writeDownloadStub(root: root, episodeId: episode.id)
    try repository.setDownloaded(episode.id, path: path, bytes: 10, source: "inbox")
    let model = AppModel(
      repository: repository,
      downloadManager: NativeDownloadManager(downloadsRoot: root)
    )
    try model.refresh()
    let inboxEpisode = try XCTUnwrap(model.inbox.first { $0.id == episode.id })

    model.archiveInboxEpisode(inboxEpisode)

    try await waitUntil {
      ((try? repository.episodes().first { $0.id == episode.id }?.state.downloaded) ?? true) == false
    }
    let state = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertEqual(state.inboxState, .archived)
    XCTAssertNil(state.inboxPosition)
    XCTAssertFalse(state.downloaded)
    XCTAssertNil(state.downloadPath)
    XCTAssertFalse(FileManager.default.fileExists(atPath: path))
  }

  func testDismissInboxPreservesInboxDownloadWhenInboxAutoDownloadIsDisabled() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-inbox-dismiss-disabled-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    var settings = try repository.settings()
    settings.autoDownload = false
    settings.autoDownloadInbox = false
    try repository.saveSettings(settings)
    let episode = try repository.episodes()[0]
    let path = try writeDownloadStub(root: root, episodeId: episode.id)
    try repository.setDownloaded(episode.id, path: path, bytes: 10, source: "inbox")
    let model = AppModel(
      repository: repository,
      downloadManager: NativeDownloadManager(downloadsRoot: root)
    )
    try model.refresh()
    let inboxEpisode = try XCTUnwrap(model.inbox.first { $0.id == episode.id })

    model.archiveInboxEpisode(inboxEpisode)

    try await waitUntil {
      ((try? repository.episodes().first { $0.id == episode.id }?.state.inboxState) ?? .new) == .archived
    }
    let state = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertTrue(state.downloaded)
    XCTAssertEqual(state.downloadPath, path)
    XCTAssertEqual(state.downloadSource, "inbox")
    XCTAssertTrue(FileManager.default.fileExists(atPath: path))
  }

  func testDismissInboxPreservesManualDownload() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-inbox-manual-dismiss-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    var settings = try repository.settings()
    settings.autoDownload = false
    settings.autoDownloadInbox = false
    try repository.saveSettings(settings)
    let episode = try repository.episodes()[0]
    let path = try writeDownloadStub(root: root, episodeId: episode.id)
    try repository.setDownloaded(episode.id, path: path, bytes: 10, source: "manual")
    let model = AppModel(
      repository: repository,
      downloadManager: NativeDownloadManager(downloadsRoot: root)
    )
    try model.refresh()
    let inboxEpisode = try XCTUnwrap(model.inbox.first { $0.id == episode.id })

    model.archiveInboxEpisode(inboxEpisode)

    try await waitUntil {
      ((try? repository.episodes().first { $0.id == episode.id }?.state.inboxState) ?? .new) == .archived
    }
    let state = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertTrue(state.downloaded)
    XCTAssertEqual(state.downloadPath, path)
    XCTAssertEqual(state.downloadSource, "manual")
    XCTAssertTrue(FileManager.default.fileExists(atPath: path))
  }

  func testMarkPlayedRemovesEpisodeFromInboxWithoutDeletingDownload() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.setDownloaded(episode.id, path: "/tmp/inbox-auto-download.mp3", bytes: 10, source: "inbox")

    try repository.markPlayed(episode.id, played: true)

    let state = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertTrue(state.played)
    XCTAssertNotNil(state.playedAt)
    XCTAssertEqual(state.inboxState, .archived)
    XCTAssertNil(state.inboxPosition)
    XCTAssertTrue(state.downloaded)
    XCTAssertEqual(state.downloadPath, "/tmp/inbox-auto-download.mp3")
    XCTAssertEqual(state.downloadSource, "inbox")
  }

  func testDownloadPruneCandidatesPreserveQueueAndInboxPriority() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    try repository.setDownloaded(episodes[0].id, path: "/tmp/queued.mp3", bytes: 10, source: "queue")
    try repository.addToQueueEnd(episodes[0].id)
    try repository.setDownloaded(episodes[1].id, path: "/tmp/inbox.mp3", bytes: 10, source: "inbox")
    try repository.setDownloaded(episodes[4].id, path: "/tmp/backlog.mp3", bytes: 10, source: "manual")

    let candidates = try repository.downloadPruneCandidates(settings: repository.settings())

    XCTAssertEqual(candidates.first?.id, episodes[4].id)
    XCTAssertEqual(candidates.last?.id, episodes[0].id)
  }

  func testStorageCapPruningDeletesLowestPriorityDownloadOnly() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-storage-prune-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    let queued = episodes[0]
    let inbox = episodes[1]
    let backlog = episodes[4]
    let favorite = episodes[5]
    let bytes = 600_000
    let queuedPath = try writeDownloadStub(root: root, episodeId: queued.id)
    let inboxPath = try writeDownloadStub(root: root, episodeId: inbox.id)
    let backlogPath = try writeDownloadStub(root: root, episodeId: backlog.id)
    let favoritePath = try writeDownloadStub(root: root, episodeId: favorite.id)

    try repository.addToQueueEnd(queued.id)
    try repository.setDownloaded(queued.id, path: queuedPath, bytes: bytes, source: "queue")
    try repository.setDownloaded(inbox.id, path: inboxPath, bytes: bytes, source: "inbox")
    try repository.setDownloaded(backlog.id, path: backlogPath, bytes: bytes, source: "manual")
    try repository.updateEpisodeState(favorite.id) { state in
      state.favorite = true
    }
    try repository.setDownloaded(favorite.id, path: favoritePath, bytes: bytes, source: "manual")
    var settings = try repository.settings()
    settings.storageCapMb = 2
    try repository.saveSettings(settings)
    let model = AppModel(
      repository: repository,
      downloadManager: NativeDownloadManager(downloadsRoot: root)
    )
    try model.refresh()

    let pruned = try await model.pruneDownloadsIfNeeded()

    XCTAssertEqual(pruned, 1)
    let states = Dictionary(uniqueKeysWithValues: try repository.episodes().map { ($0.id, $0.state) })
    XCTAssertEqual(states[backlog.id]?.downloaded, false)
    XCTAssertNil(states[backlog.id]?.downloadPath)
    XCTAssertEqual(states[queued.id]?.downloadPath, queuedPath)
    XCTAssertEqual(states[inbox.id]?.downloadPath, inboxPath)
    XCTAssertEqual(states[favorite.id]?.downloadPath, favoritePath)
    XCTAssertFalse(FileManager.default.fileExists(atPath: backlogPath))
    XCTAssertTrue(FileManager.default.fileExists(atPath: queuedPath))
    XCTAssertTrue(FileManager.default.fileExists(atPath: inboxPath))
    XCTAssertTrue(FileManager.default.fileExists(atPath: favoritePath))
  }

  func testStaleDownloadedEpisodesDetectMissingLocalFiles() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    try repository.setDownloaded(episodes[0].id, path: "/tmp/present.mp3", bytes: 10, source: "manual")
    try repository.setDownloaded(episodes[1].id, path: "/tmp/missing.mp3", bytes: 10, source: "manual")
    try repository.setDownloaded(episodes[2].id, path: "", bytes: 10, source: "manual")

    let stale = try repository.staleDownloadedEpisodes { path in
      path == "/tmp/present.mp3"
    }

    XCTAssertEqual(Set(stale.map(\.id)), Set([episodes[1].id, episodes[2].id]))
  }

  func testNativeAudioEngineFallsBackWhenDownloadedFileIsMissing() async throws {
    let missingPath = "/tmp/daisy-pod-missing-\(UUID().uuidString).mp3"
    var state = SeedData.defaultState(for: SeedData.episodes[0].id)
    state.downloaded = true
    state.downloadPath = missingPath
    var episode = SeedData.episodes[0]
    episode.audioUrl = "https://example.com/fallback.mp3"
    let item = EpisodeWithState(episode: episode, state: state)

    let loadedURL = await MainActor.run {
      let engine = NativeAudioEngine()
      engine.prepare(item, settings: AppSettings())
      return engine.lastLoadedURL
    }

    XCTAssertEqual(loadedURL?.absoluteString, "https://example.com/fallback.mp3")
  }

  func testAppModelDetectsSubscribedDiscoveryFeed() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()

    XCTAssertTrue(model.isSubscribed(feedUrl: "https://example.com/daisy-pod.xml/"))
    XCTAssertFalse(model.isSubscribed(feedUrl: "https://example.com/other.xml"))
  }

  func testPlaybackEndedMarksCurrentPlayedAndAutoplaysNextQueuedEpisode() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episodes = try repository.episodes()
    let first = episodes[0]
    let second = episodes[1]
    var settings = try repository.settings()
    settings.autoDownload = false
    settings.autoPlayNext = true
    try repository.saveSettings(settings)
    try repository.addToQueueEnd(first.id)
    try repository.addToQueueEnd(second.id)

    let model = AppModel(repository: repository)
    model.start()
    model.audio.prepare(first, settings: model.settings)

    model.handlePlaybackEnded()

    let refreshed = try repository.episodes()
    let firstState = refreshed.first { $0.id == first.id }?.state
    let secondState = refreshed.first { $0.id == second.id }?.state
    XCTAssertEqual(firstState?.played, true)
    XCTAssertNil(firstState?.queuePosition)
    XCTAssertEqual(secondState?.queuePosition, 1)
    XCTAssertEqual(model.audio.current?.id, second.id)
  }

  func testCueFirstQueuedEpisodePreparesPausedPlayer() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let first = try repository.episodes()[0]
    try repository.addToQueueEnd(first.id)

    let model = AppModel(repository: repository)
    model.start()

    XCTAssertEqual(model.audio.current?.id, first.id)
    XCTAssertEqual(model.audio.isPlaying, false)
  }

  func testSleepTimerPausesPlaybackWhenExpired() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    let model = AppModel(repository: repository)
    model.start()
    model.audio.prepare(episode, settings: model.settings)
    model.audio.play(rate: 1)

    model.setSleepTimer(seconds: 0.05)

    XCTAssertNotNil(model.sleepTimerEndsAt)
    XCTAssertEqual(model.audio.isPlaying, true)
    try await Task.sleep(nanoseconds: 200_000_000)
    XCTAssertNil(model.sleepTimerEndsAt)
    XCTAssertNil(try repository.settings().sleepTimerEndsAt)
    XCTAssertEqual(model.audio.isPlaying, false)
    XCTAssertEqual(model.status, "Sleep timer ended.")
  }

  func testSleepTimerCanBeCanceled() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()

    model.setSleepTimer(minutes: 15)

    XCTAssertEqual(model.sleepTimerRemainingMinutes(), 15)
    XCTAssertNotNil(try repository.settings().sleepTimerEndsAt)
    model.cancelSleepTimer()
    XCTAssertNil(model.sleepTimerEndsAt)
    XCTAssertNil(try repository.settings().sleepTimerEndsAt)
    XCTAssertNil(model.sleepTimerRemainingMinutes())
    XCTAssertEqual(model.status, "Sleep timer canceled.")
  }

  func testSleepTimerPersistsWithoutChangingSettingsSyncTimestamp() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let before = try repository.settings()
    let model = AppModel(repository: repository)
    model.start()

    model.setSleepTimer(minutes: 15)

    let saved = try repository.settings()
    XCTAssertNotNil(saved.sleepTimerEndsAt)
    XCTAssertEqual(saved.updatedAt, before.updatedAt)
    model.cancelSleepTimer()
  }

  func testSleepTimerRestoresFutureDeadlineOnLaunch() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let deadline = Date().addingTimeInterval(15 * 60)
    try repository.saveSleepTimerDeadline(deadline)

    let model = AppModel(repository: repository)
    model.start()

    XCTAssertLessThan(abs(try XCTUnwrap(model.sleepTimerEndsAt).timeIntervalSince(deadline)), 1)
    XCTAssertEqual(model.sleepTimerRemainingMinutes(), 15)
    model.cancelSleepTimer()
  }

  func testSleepTimerClearsExpiredDeadlineOnLaunch() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    try repository.saveSleepTimerDeadline(Date().addingTimeInterval(-60))

    let model = AppModel(repository: repository)
    model.start()

    XCTAssertNil(model.sleepTimerEndsAt)
    XCTAssertNil(try repository.settings().sleepTimerEndsAt)
  }

  func testNativeDeepLinksRouteToAddAndSections() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    let model = AppModel(repository: repository)
    model.start()

    model.handleOpenURL(URL(string: "daisypod://add?url=https%3A%2F%2Fexample.com%2Ffeed.xml")!)
    XCTAssertEqual(model.selectedTab, .search)
    XCTAssertEqual(model.addPodcastDraft, "https://example.com/feed.xml")

    model.handleOpenURL(URL(string: "daisypod://queue")!)
    XCTAssertEqual(model.selectedTab, .inbox)
    XCTAssertEqual(model.status, "Opened Inbox.")

    model.handleOpenURL(URL(string: "daisypod://open?section=downloads")!)
    XCTAssertEqual(model.selectedTab, .downloads)

    model.handleOpenURL(URL(string: "daisypod://open/add")!)
    XCTAssertEqual(model.selectedTab, .search)
  }

  func testRetiredElephantPodDeepLinksAreUnsupported() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    let model = AppModel(repository: repository)
    model.start()

    model.handleOpenURL(URL(string: "elephant-pod://open?section=downloads")!)

    XCTAssertEqual(model.selectedTab, .inbox)
    XCTAssertEqual(model.status, "Unsupported DaisyPod link.")
  }

  func testNativeDeepLinksRouteToPlaybackAndSync() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()

    let first = try repository.episodes()[0]
    try repository.addToQueueEnd(first.id)
    try model.refresh()
    model.handleOpenURL(URL(string: "daisypod://playback/toggle")!)
    XCTAssertEqual(model.audio.current?.id, first.id)

    model.handleOpenURL(URL(string: "daisypod://sync")!)
    XCTAssertEqual(model.selectedTab, .settings)
    XCTAssertTrue(model.syncing || model.status?.hasPrefix("iCloud sync prepared") == true)
  }

  func testChapterSeekLoadsEpisodeAndPersistsProgress() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()

    let episode = try XCTUnwrap(try repository.episodes().first { !$0.episode.chapters.isEmpty })
    let chapter = try XCTUnwrap(episode.episode.chapters.dropFirst().first)

    model.seekToChapter(chapter, in: episode)

    XCTAssertEqual(model.audio.current?.id, episode.id)
    XCTAssertEqual(model.audio.position, chapter.startsAt, accuracy: 0.5)
    XCTAssertEqual(try repository.episodes().first { $0.id == episode.id }?.state.progressSec, chapter.startsAt)
  }

  func testAppIntentHandoffStoresConsumesAndRoutesToAddDraft() throws {
    let defaults = UserDefaults(suiteName: "DaisyPodTests.\(UUID().uuidString)")!
    let payload = AppIntentHandoffPayload(action: .addPodcast, value: "https://example.com/new-feed.xml")

    AppIntentHandoff.store(payload, defaults: defaults)
    XCTAssertEqual(AppIntentHandoff.consume(defaults: defaults), payload)
    XCTAssertNil(AppIntentHandoff.consume(defaults: defaults))

    let repository = try PodcastRepository.inMemoryForTests()
    let model = AppModel(repository: repository)
    model.handleAppIntentHandoff(payload)

    XCTAssertEqual(model.selectedTab, .search)
    XCTAssertEqual(model.addPodcastDraft, "https://example.com/new-feed.xml")
  }

  func testAppIntentHandoffRoutesToSectionAndPlayback() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let model = AppModel(repository: repository)
    model.start()

    model.handleAppIntentHandoff(AppIntentHandoffPayload(action: .openSection, section: .downloads))
    XCTAssertEqual(model.selectedTab, .downloads)

    let first = try repository.episodes()[0]
    try repository.addToQueueEnd(first.id)
    try model.refresh()
    model.handleAppIntentHandoff(AppIntentHandoffPayload(action: .togglePlayback))

    XCTAssertEqual(model.audio.current?.id, first.id)
  }

  func testRSSParserAndRepositoryImportFeed() throws {
    let xml = """
    <rss version="2.0">
      <channel>
        <title>Example Show</title>
        <itunes:author>Example Network</itunes:author>
        <description>Example description</description>
        <image><url>https://example.com/art.jpg</url></image>
        <item>
          <title>First Episode</title>
          <guid>episode-1</guid>
          <pubDate>Wed, 17 Jun 2026 10:00:00 +0000</pubDate>
          <itunes:duration>01:02:03</itunes:duration>
          <enclosure url="https://example.com/audio.mp3" length="12345" type="audio/mpeg" />
        </item>
      </channel>
    </rss>
    """
    let result = try RSSFeedParser.parse(data: Data(xml.utf8), feedUrl: "https://example.com/feed.xml")
    XCTAssertEqual(result.podcast.title, "Example Show")
    XCTAssertEqual(result.episodes.count, 1)
    XCTAssertEqual(result.episodes[0].durationSec, 3723)

    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    try repository.upsertParsedFeed(result)

    XCTAssertTrue(try repository.podcasts().contains { $0.title == "Example Show" })
    XCTAssertTrue(try repository.inboxEpisodes(settings: repository.settings()).contains { $0.episode.title == "First Episode" })
  }

  func testRSSFixtureParsesArtworkDurationAndEpisodeMetadata() throws {
    let result = try RSSFeedParser.parse(data: fixtureData("rss-rich", extension: "xml"), feedUrl: "https://example.com/rss.xml")

    XCTAssertEqual(result.podcast.title, "Fixture RSS Show")
    XCTAssertEqual(result.podcast.author, "Fixture Network")
    XCTAssertEqual(result.podcast.imageUrl, "https://example.com/show-art.jpg")
    XCTAssertEqual(result.episodes.count, 2)
    XCTAssertEqual(result.episodes[0].title, "RSS Fixture Episode One")
    XCTAssertEqual(result.episodes[0].audioUrl, "https://media.example.com/episode-one.mp3")
    XCTAssertEqual(result.episodes[0].imageUrl, "https://example.com/episode-one.jpg")
    XCTAssertEqual(result.episodes[0].durationSec, 3723)
    XCTAssertEqual(result.episodes[0].seasonNumber, 2)
    XCTAssertEqual(result.episodes[0].episodeNumber, 7)
    XCTAssertEqual(result.episodes[0].explicit, true)
    XCTAssertEqual(result.episodes[0].enclosureLength, 123456)
    XCTAssertEqual(result.episodes[0].chapters.count, 2)
    XCTAssertEqual(result.episodes[0].chapters[0].title, "Opening")
    XCTAssertEqual(result.episodes[0].chapters[0].startsAt, 0, accuracy: 0.001)
    XCTAssertEqual(result.episodes[0].chapters[0].url, "https://example.com/chapter/opening")
    XCTAssertEqual(result.episodes[0].chapters[1].title, "Deep Dive")
    XCTAssertEqual(result.episodes[0].chapters[1].startsAt, 754.5, accuracy: 0.001)
    XCTAssertEqual(result.episodes[1].imageUrl, "https://example.com/show-art.jpg")
    let secondEpisodeChapter = try XCTUnwrap(result.episodes[1].chapters.first)
    XCTAssertEqual(secondEpisodeChapter.title, "Second Start")
    XCTAssertEqual(secondEpisodeChapter.startsAt, 90, accuracy: 0.001)
    XCTAssertEqual(secondEpisodeChapter.url, "https://example.com/chapter/second")
  }

  func testAtomFixtureParsesAlternateAndEnclosureLinks() throws {
    let result = try RSSFeedParser.parse(data: fixtureData("atom-rich", extension: "xml"), feedUrl: "https://example.com/atom.xml")

    XCTAssertEqual(result.podcast.title, "Fixture Atom Show")
    XCTAssertEqual(result.podcast.author, "Atom Network")
    XCTAssertEqual(result.podcast.websiteUrl, "https://example.com/atom-show")
    XCTAssertEqual(result.podcast.imageUrl, "https://example.com/atom-show.jpg")
    XCTAssertEqual(result.episodes.count, 1)
    XCTAssertEqual(result.episodes[0].title, "Atom Fixture Episode")
    XCTAssertEqual(result.episodes[0].audioUrl, "https://media.example.com/atom-episode.mp3")
    XCTAssertEqual(result.episodes[0].websiteUrl, "https://example.com/atom-episode")
    XCTAssertEqual(result.episodes[0].imageUrl, "https://example.com/atom-episode.jpg")
    XCTAssertEqual(result.episodes[0].guid, "tag:example.com,2026:atom-episode")
  }

  func testRepositoryImportUsesRSSFixtureAsNewInboxEpisodes() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let result = try RSSFeedParser.parse(data: fixtureData("rss-rich", extension: "xml"), feedUrl: "https://example.com/rss.xml")

    try repository.upsertParsedFeed(result)

    let importedPodcast = try XCTUnwrap(try repository.podcasts().first { $0.feedUrl == "https://example.com/rss.xml" })
    let importedInbox = try repository.inboxEpisodes(settings: repository.settings()).filter { $0.episode.podcastId == importedPodcast.id }
    XCTAssertEqual(importedPodcast.title, "Fixture RSS Show")
    XCTAssertEqual(importedInbox.map(\.episode.title), ["RSS Fixture Episode Two", "RSS Fixture Episode One"])
    XCTAssertEqual(importedInbox.first { $0.episode.title == "RSS Fixture Episode One" }?.episode.chapters.count, 2)
    XCTAssertTrue(importedInbox.allSatisfy { $0.state.inboxState == .new })
    XCTAssertTrue(importedInbox.allSatisfy { $0.state.downloadPath == nil })
  }

  func testFeedRefreshFixturePreservesLocalEpisodeStateAndAddsNewInboxItems() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let feedUrl = "https://example.com/rss.xml"
    let initial = try RSSFeedParser.parse(data: fixtureData("rss-rich", extension: "xml"), feedUrl: feedUrl)
    try repository.upsertParsedFeed(initial)

    let importedPodcast = try XCTUnwrap(try repository.podcasts().first { $0.feedUrl == feedUrl })
    let firstEpisode = try XCTUnwrap(try repository.podcastEpisodes(importedPodcast.id).first { $0.episode.guid == "rss-episode-one" })
    try repository.addToQueueEnd(firstEpisode.id)
    try repository.setDownloaded(firstEpisode.id, path: "/private/var/mobile/Containers/Data/Application/audio/episode-one.mp3", bytes: 123456)
    try repository.updateEpisodeState(firstEpisode.id) { state in
      state.progressSec = 321
      state.lastPlayedAt = Date(timeIntervalSince1970: 1_780_000_000)
    }

    let refresh = try RSSFeedParser.parse(data: fixtureData("rss-refresh", extension: "xml"), feedUrl: feedUrl)
    try repository.upsertParsedFeed(refresh)

    let refreshedPodcast = try XCTUnwrap(try repository.podcasts().first { $0.feedUrl == feedUrl })
    XCTAssertEqual(refreshedPodcast.id, importedPodcast.id)
    XCTAssertEqual(refreshedPodcast.title, "Fixture RSS Show Refreshed")
    XCTAssertEqual(refreshedPodcast.imageUrl, "https://example.com/show-art-refresh.jpg")

    let refreshedFirst = try XCTUnwrap(try repository.podcastEpisodes(refreshedPodcast.id).first { $0.episode.guid == "rss-episode-one" })
    XCTAssertEqual(refreshedFirst.id, firstEpisode.id)
    XCTAssertEqual(refreshedFirst.episode.title, "RSS Fixture Episode One Revised")
    XCTAssertEqual(refreshedFirst.episode.durationSec, 3900)
    XCTAssertEqual(refreshedFirst.episode.chapters.map(\.title), ["Updated Opening", "New Middle"])
    XCTAssertEqual(refreshedFirst.state.progressSec, 321)
    XCTAssertEqual(refreshedFirst.state.queuePosition, 1)
    XCTAssertEqual(refreshedFirst.state.downloadPath, "/private/var/mobile/Containers/Data/Application/audio/episode-one.mp3")
    XCTAssertEqual(refreshedFirst.state.downloadBytes, 123456)

    let newEpisode = try XCTUnwrap(try repository.podcastEpisodes(refreshedPodcast.id).first { $0.episode.guid == "rss-episode-three" })
    XCTAssertEqual(newEpisode.state.inboxState, .new)
    XCTAssertNotNil(newEpisode.state.inboxPosition)
    XCTAssertNil(newEpisode.state.queuePosition)
    XCTAssertNil(newEpisode.state.downloadPath)
  }

  func testPortableBackupDoesNotExportDeviceDownloadPaths() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.setDownloaded(episode.id, path: "/private/var/mobile/Containers/Data/audio.mp3", bytes: 42)
    try repository.saveSleepTimerDeadline(Date().addingTimeInterval(15 * 60))
    try repository.saveOfflineMode(true)

    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(try repository.exportBackup())
    let json = String(decoding: data, as: UTF8.self)

    XCTAssertFalse(json.contains("/private/var/mobile"))
    XCTAssertFalse(json.contains("ios-filesystem"))
    XCTAssertFalse(json.contains("sleepTimerEndsAt"))
    XCTAssertFalse(json.contains(#""offlineMode":true"#))
  }

  func testNativeDownloadUpdatesDoNotCreateSyncActionsOrAdvanceStateTimestamp() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    let before = try XCTUnwrap(repository.episodes().first { $0.id == episode.id }?.state)
    let pendingBefore = try repository.syncActions(includePushed: false).count

    try repository.setDownloaded(episode.id, path: "/private/device/audio.mp3", bytes: 42)

    let after = try XCTUnwrap(repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertEqual(after.downloadPath, "/private/device/audio.mp3")
    XCTAssertEqual(after.downloadBytes, 42)
    XCTAssertEqual(after.updatedAt, before.updatedAt)
    XCTAssertEqual(try repository.syncActions(includePushed: false).count, pendingBefore)
  }

  func testCloudKitSnapshotUsesPortablePersonalRecords() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    var settings = try repository.settings()
    settings.serverUrl = "https://pod.example.com"
    settings.sleepTimerEndsAt = Date().addingTimeInterval(300)
    settings.offlineMode = true
    try repository.saveSettings(settings)
    let episode = try repository.episodes()[0]
    try repository.setDownloaded(episode.id, path: "/private/device/audio.mp3", bytes: 42_000, source: "manual")
    try repository.addToQueueEnd(episode.id)
    try repository.addListeningSample(episode: episode, listeningSec: 60, contentSec: 60, speedSavedSec: 0, silenceSavedSec: 0)

    let snapshot = try CloudKitPersonalSyncEngine.snapshot(from: repository)

    XCTAssertEqual(snapshot.records(ofType: .settings).count, 1)
    let cloudSettings = try XCTUnwrap(snapshot.records(ofType: .settings).first).decode(AppSettings.self)
    XCTAssertNil(cloudSettings.serverUrl)
    XCTAssertNil(cloudSettings.sleepTimerEndsAt)
    XCTAssertFalse(cloudSettings.offlineMode)

    let cloudState = try XCTUnwrap(snapshot.records(ofType: .episodeState).first { $0.recordName == "EpisodeState.\(episode.id)" }).decode(EpisodeState.self)
    XCTAssertFalse(cloudState.downloaded)
    XCTAssertNil(cloudState.downloadedAt)
    XCTAssertNil(cloudState.downloadPath)
    XCTAssertNil(cloudState.downloadBytes)
    XCTAssertNil(cloudState.downloadBackend)
    XCTAssertNil(cloudState.downloadSource)

    XCTAssertFalse(snapshot.records.contains { $0.recordType.rawValue.localizedCaseInsensitiveContains("listening") })
    XCTAssertEqual(snapshot.records(ofType: .silenceMap).count, 0)
    XCTAssertEqual(snapshot.records(ofType: .smartSkipMap).count, 0)
    XCTAssertTrue(snapshot.records(ofType: .syncAction).contains { $0.recordName.hasPrefix("SyncAction.") })
  }

  func testCloudKitSnapshotIncludesOfflineServerIntelligenceMetadata() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    let timestamp = Date()
    let silence = SilenceMap(
      id: "silence_icloud",
      episodeId: episode.id,
      audioUrl: episode.episode.audioUrl,
      status: .ready,
      segments: [SilenceMapSegment(silenceStartSec: 12, silenceEndSec: 18, skipFromSec: 12.25, skipToSec: 17, retainedSilenceSec: 0.25)],
      durationSec: 120,
      thresholdDb: -42,
      minimumSilenceSec: 0.7,
      retainedSilenceSec: 0.25,
      analyzerVersion: "v1",
      error: nil,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRequestedAt: timestamp,
      lastCheckedAt: timestamp
    )
    let map = SmartSkipSegmentMap(
      schemaVersion: "daisypod.smart-skip.v1",
      episodeId: episode.id,
      podcastId: episode.episode.podcastId,
      mediaVersionId: "media_icloud",
      audioUrl: episode.episode.audioUrl,
      durationMs: 120000,
      generatedAt: timestamp,
      status: .ready,
      segments: [
        SmartSkipSegment(
          id: "segment_icloud",
          type: .sponsorship,
          subtype: nil,
          startMs: 1000,
          endMs: 6000,
          confidence: 0.95,
          action: .autoSkip,
          source: .codexSegmenter,
          label: "Sponsor",
          evidence: ["promo code"],
          originalStartMs: nil,
          originalEndMs: nil
        )
      ]
    )
    let transcript = SmartSkipTranscript(
      mediaVersionId: "media_icloud",
      provider: "whisper",
      model: "large-v3-turbo",
      language: "en",
      durationMs: 120000,
      segments: [SmartSkipTranscriptSegment(startMs: 1000, endMs: 6000, speaker: nil, text: "Use promo code.")]
    )
    try repository.saveSilenceMap(silence, requestedAt: timestamp, checkedAt: timestamp)
    try repository.saveSmartSkipSegmentMap(map, transcript: transcript)

    let snapshot = try CloudKitPersonalSyncEngine.snapshot(from: repository)

    let cloudSilence = try XCTUnwrap(snapshot.records(ofType: .silenceMap).first).decode(SilenceMap.self)
    XCTAssertEqual(cloudSilence.id, "silence_icloud")
    let cloudSmartSkip = try XCTUnwrap(snapshot.records(ofType: .smartSkipMap).first).decode(SmartSkipMapCacheEntry.self)
    XCTAssertEqual(cloudSmartSkip.map?.segments.first?.id, "segment_icloud")
    XCTAssertEqual(cloudSmartSkip.transcript?.segments.first?.text, "Use promo code.")
  }

  func testCloudKitPersonalSyncEngineUploadsSnapshotThroughBoundary() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let store = CapturingCloudKitPersonalSyncStore()
    let engine = CloudKitPersonalSyncEngine(repository: repository, store: store)
    let backup = try repository.exportBackup().portable
    let expectedRecordCount = backup.feeds.count
      + backup.episodes.count
      + backup.states.count
      + backup.podcastPreferences.count
      + backup.clips.count
      + backup.silenceMaps.count
      + backup.smartSkipMaps.count
      + backup.tombstones.count
      + backup.syncActions.count
      + 1

    let result = try await engine.sync(protectedPlaybackEpisodeId: nil)

    XCTAssertEqual(result.pageCount, 1)
    XCTAssertEqual(result.message, "iCloud sync prepared \(expectedRecordCount) records.")
    let uploaded = try XCTUnwrap(store.uploadedSnapshots.first)
    XCTAssertEqual(uploaded.records(ofType: .podcast).count, try repository.podcasts().count)
    XCTAssertEqual(uploaded.records(ofType: .episode).count, try repository.episodes().count)
  }

  func testCloudKitPersonalSyncEngineMergesNewerRemoteSnapshotIntoLocalStore() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    var remoteBackup = try repository.exportBackup()
    let future = Date().addingTimeInterval(3600)
    remoteBackup.states = remoteBackup.states.map { state in
      guard state.episodeId == episode.id else { return state }
      var next = state
      next.favorite = true
      next.updatedAt = future
      return next
    }
    let remoteSnapshot = try CloudKitPersonalSyncEngine.snapshot(from: remoteBackup)
    let store = CapturingCloudKitPersonalSyncStore(remoteSnapshot: remoteSnapshot)
    let engine = CloudKitPersonalSyncEngine(repository: repository, store: store)

    _ = try await engine.sync(protectedPlaybackEpisodeId: nil)

    let mergedState = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertTrue(mergedState.favorite)
    XCTAssertEqual(mergedState.updatedAt.timeIntervalSince1970, future.timeIntervalSince1970, accuracy: 1)
    let uploadedState = try XCTUnwrap(store.uploadedSnapshots.last?.records(ofType: .episodeState).first { $0.recordName == "EpisodeState.\(episode.id)" })
      .decode(EpisodeState.self)
    XCTAssertTrue(uploadedState.favorite)
  }

  func testCloudKitPersonalSyncEngineKeepsNewerLocalSnapshotOverStaleRemote() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    var staleRemoteBackup = try repository.exportBackup()
    let staleDate = Date().addingTimeInterval(-3600)
    staleRemoteBackup.states = staleRemoteBackup.states.map { state in
      guard state.episodeId == episode.id else { return state }
      var next = state
      next.favorite = false
      next.updatedAt = staleDate
      return next
    }
    try repository.setFavorite(episode.id, favorite: true)
    let localFavoriteState = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    let remoteSnapshot = try CloudKitPersonalSyncEngine.snapshot(from: staleRemoteBackup)
    let store = CapturingCloudKitPersonalSyncStore(remoteSnapshot: remoteSnapshot)
    let engine = CloudKitPersonalSyncEngine(repository: repository, store: store)

    _ = try await engine.sync(protectedPlaybackEpisodeId: nil)

    let mergedState = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertTrue(mergedState.favorite)
    XCTAssertEqual(mergedState.updatedAt, localFavoriteState.updatedAt)
    let uploadedState = try XCTUnwrap(store.uploadedSnapshots.last?.records(ofType: .episodeState).first { $0.recordName == "EpisodeState.\(episode.id)" })
      .decode(EpisodeState.self)
    XCTAssertTrue(uploadedState.favorite)
  }

  func testCloudKitPersonalSyncEngineProtectsActivePlaybackStateDuringRemoteMerge() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.updateEpisodeState(episode.id) { state in
      state.progressSec = 120
      state.played = false
    }
    let localState = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    var remoteBackup = try repository.exportBackup()
    let future = Date().addingTimeInterval(7200)
    remoteBackup.states = remoteBackup.states.map { state in
      guard state.episodeId == episode.id else { return state }
      var next = state
      next.progressSec = 2500
      next.played = true
      next.updatedAt = future
      return next
    }
    let remoteSnapshot = try CloudKitPersonalSyncEngine.snapshot(from: remoteBackup)
    let store = CapturingCloudKitPersonalSyncStore(remoteSnapshot: remoteSnapshot)
    let engine = CloudKitPersonalSyncEngine(repository: repository, store: store)

    _ = try await engine.sync(protectedPlaybackEpisodeId: episode.id)

    let mergedState = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    XCTAssertEqual(mergedState.progressSec, 120)
    XCTAssertFalse(mergedState.played)
    XCTAssertEqual(mergedState.updatedAt, localState.updatedAt)
    let uploadedState = try XCTUnwrap(store.uploadedSnapshots.last?.records(ofType: .episodeState).first { $0.recordName == "EpisodeState.\(episode.id)" })
      .decode(EpisodeState.self)
    XCTAssertEqual(uploadedState.progressSec, 120)
    XCTAssertFalse(uploadedState.played)
  }

  func testCloudKitPersonalSyncEngineAppliesNewerEpisodeTombstoneWithoutDeletingDeviceFile() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-tombstone-sync-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    let path = try writeDownloadStub(root: root, episodeId: episode.id)
    try repository.setDownloaded(episode.id, path: path, bytes: 10, source: "manual")
    var remoteBackup = try repository.exportBackup()
    remoteBackup.tombstones.append(SyncTombstone(
      id: "tombstone_\(episode.id)",
      tableName: "episodes",
      localId: episode.id,
      deletedAt: Date().addingTimeInterval(7200),
      pushedAt: nil
    ))
    let remoteSnapshot = try CloudKitPersonalSyncEngine.snapshot(from: remoteBackup)
    let store = CapturingCloudKitPersonalSyncStore(remoteSnapshot: remoteSnapshot)
    let engine = CloudKitPersonalSyncEngine(repository: repository, store: store)

    _ = try await engine.sync(protectedPlaybackEpisodeId: nil)

    XCTAssertFalse(try repository.episodes().contains { $0.id == episode.id })
    XCTAssertTrue(try repository.tombstones().contains { $0.localId == episode.id && $0.tableName == "episodes" })
    XCTAssertTrue(FileManager.default.fileExists(atPath: path))
  }

  func testCloudKitPersonalSyncEngineIgnoresStaleEpisodeTombstoneForNewerLocalRecord() async throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.updateEpisodeState(episode.id) { state in
      state.favorite = true
    }
    let localState = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id }?.state)
    var remoteBackup = try repository.exportBackup()
    remoteBackup.tombstones.append(SyncTombstone(
      id: "stale_tombstone_\(episode.id)",
      tableName: "episodes",
      localId: episode.id,
      deletedAt: localState.updatedAt.addingTimeInterval(-7200),
      pushedAt: nil
    ))
    let remoteSnapshot = try CloudKitPersonalSyncEngine.snapshot(from: remoteBackup)
    let store = CapturingCloudKitPersonalSyncStore(remoteSnapshot: remoteSnapshot)
    let engine = CloudKitPersonalSyncEngine(repository: repository, store: store)

    _ = try await engine.sync(protectedPlaybackEpisodeId: nil)

    let retained = try XCTUnwrap(try repository.episodes().first { $0.id == episode.id })
    XCTAssertTrue(retained.state.favorite)
    XCTAssertTrue(try repository.tombstones().contains { $0.localId == episode.id && $0.tableName == "episodes" })
  }

  func testCloudKitChangeTokenStorePersistsPerZoneData() throws {
    let suiteName = "DaisyPodCloudKitChangeTokenTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    defer { defaults.removePersistentDomain(forName: suiteName) }
    let store = UserDefaultsCloudKitChangeTokenStore(defaults: defaults, keyPrefix: "test.changeToken")
    let zoneName = "DaisyPodPersonalSync"
    let tokenData = Data("token-data".utf8)

    XCTAssertNil(store.changeTokenData(for: zoneName))

    store.saveChangeTokenData(tokenData, for: zoneName)

    XCTAssertEqual(store.changeTokenData(for: zoneName), tokenData)

    store.clearChangeTokenData(for: zoneName)

    XCTAssertNil(store.changeTokenData(for: zoneName))
  }

  func testOPMLRoundTripKeepsSubscriptionsPortable() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()

    let opml = try repository.exportOPML()
    let subscriptions = try OPMLCodec.parse(Data(opml.utf8))

    XCTAssertEqual(subscriptions.count, 2)
    XCTAssertTrue(subscriptions.contains { $0.feedUrl == "https://example.com/daisy-pod.xml" })
    XCTAssertTrue(opml.contains("DaisyPod Subscriptions"))
  }

  func testAppModelImportsOPMLThroughInjectedRSSImporter() async throws {
    let root = FileManager.default.temporaryDirectory.appending(path: "daisy-pod-opml-import-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let opmlURL = root.appending(path: "subscriptions.opml")
    let feedUrl = "https://feeds.example.com/native-show.xml"
    let opml = """
    <?xml version="1.0" encoding="UTF-8"?>
    <opml version="2.0">
      <body>
        <outline text="Native Show" title="Native Show" type="rss" xmlUrl="\(feedUrl)" />
      </body>
    </opml>
    """
    try Data(opml.utf8).write(to: opmlURL)

    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let timestamp = Date(timeIntervalSince1970: 1_783_008_000)
    var importedURLs: [String] = []
    let model = AppModel(
      repository: repository,
      importRSS: { requestedFeedUrl, serverUrl in
        importedURLs.append(requestedFeedUrl)
        XCTAssertNil(serverUrl)
        let podcast = Podcast(
          id: "feed_native_show",
          title: "Native Show",
          author: "DaisyPod",
          description: "Imported from OPML",
          imageUrl: nil,
          feedUrl: requestedFeedUrl,
          websiteUrl: "https://example.com/native-show",
          tags: ["Swift"],
          sourceType: .rss,
          sourceUrl: requestedFeedUrl,
          externalId: nil,
          lastRefreshedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp
        )
        let episode = Episode(
          id: "ep_native_show_1",
          podcastId: podcast.id,
          podcastTitle: podcast.title,
          title: "OPML Imported Episode",
          description: nil,
          audioUrl: "https://cdn.example.com/native-show/1.mp3",
          websiteUrl: nil,
          imageUrl: nil,
          publishedAt: timestamp,
          durationSec: 1800,
          explicit: false,
          chapters: [],
          guid: "native-show-1",
          enclosureLength: 12345,
          sourceType: .rss,
          sourceUrl: requestedFeedUrl,
          extractionStatus: ExtractionStatus.none,
          createdAt: timestamp,
          updatedAt: timestamp
        )
        return ParsedFeedResult(podcast: podcast, episodes: [episode])
      }
    )
    model.start()

    model.importOPML(from: opmlURL)
    try await waitUntil { !model.importingPortableData }

    XCTAssertEqual(importedURLs, [feedUrl])
    XCTAssertEqual(model.selectedTab, .library)
    XCTAssertEqual(model.status, "Imported 1 subscription.")
    XCTAssertTrue(model.libraryPodcasts.contains { $0.feedUrl == feedUrl })
    XCTAssertTrue(model.inbox.contains { $0.episode.id == "ep_native_show_1" })
  }

  func testJSONBackupStripsDeviceLocalDownloadData() throws {
    let repository = try PodcastRepository.inMemoryForTests()
    try repository.ensureSeedData()
    let episode = try repository.episodes()[0]
    try repository.setDownloaded(episode.id, path: "/private/var/mobile/Containers/Data/audio.mp3", bytes: 42)
    try repository.saveSleepTimerDeadline(Date().addingTimeInterval(15 * 60))
    try repository.saveOfflineMode(true)

    let json = try repository.exportBackup().encodedString()

    XCTAssertFalse(json.contains("/private/var/mobile"))
    XCTAssertFalse(json.contains("ios-filesystem"))
    XCTAssertFalse(json.contains("sleepTimerEndsAt"))
    XCTAssertFalse(json.contains(#""offlineMode" : true"#))
    XCTAssertTrue(json.contains("\"feeds\""))
  }

  func testBackupRestorePreservesCurrentDeviceSettingsAndDownloads() throws {
    let source = try PodcastRepository.inMemoryForTests()
    try source.ensureSeedData()
    let backup = try source.exportBackup()

    let target = try PodcastRepository.inMemoryForTests()
    try target.ensureSeedData()
    let episode = try target.episodes()[0]
    try target.setDownloaded(episode.id, path: "/tmp/local-audio.mp3", bytes: 99)
    var settings = try target.settings()
    settings.serverUrl = "https://pod.example.com"
    let deviceId = settings.deviceId
    try target.saveSettings(settings)

    try target.restoreBackup(backup)

    let restoredSettings = try target.settings()
    let restoredState = try target.episodes().first { $0.id == episode.id }?.state

    XCTAssertEqual(restoredSettings.deviceId, deviceId)
    XCTAssertEqual(restoredSettings.serverUrl, "https://pod.example.com")
    XCTAssertEqual(restoredState?.downloadPath, "/tmp/local-audio.mp3")
    XCTAssertEqual(restoredState?.downloadBytes, 99)
  }

  func testPlaybackJumpPlanUsesReadySilenceMapsAndSmartSkipFilters() {
    let timestamp = Date(timeIntervalSince1970: 1_783_008_000)
    var settings = AppSettings()
    settings.silenceShortening = true
    settings.smartSkipEnabled = true
    settings.smartSkipCommercials = true
    settings.smartSkipIncludeSoftMatches = false

    let silence = SilenceMap(
      id: "silence_episode",
      episodeId: "episode",
      audioUrl: "https://example.com/episode.mp3",
      status: .ready,
      segments: [SilenceMapSegment(silenceStartSec: 10, silenceEndSec: 14, skipFromSec: 10.25, skipToSec: 13.75, retainedSilenceSec: 0.25)],
      durationSec: 600,
      thresholdDb: -45,
      minimumSilenceSec: 0.7,
      retainedSilenceSec: 0.25,
      analyzerVersion: "test",
      error: nil,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRequestedAt: timestamp,
      lastCheckedAt: timestamp
    )

    let map = SmartSkipSegmentMap(
      schemaVersion: "daisypod.smart-skip.v1",
      episodeId: "episode",
      podcastId: "podcast",
      mediaVersionId: "media",
      audioUrl: "https://example.com/episode.mp3",
      durationMs: 600_000,
      generatedAt: timestamp,
      status: .ready,
      segments: [
        SmartSkipSegment(id: "sponsor", type: .sponsorship, subtype: nil, startMs: 20_000, endMs: 35_000, confidence: 0.91, action: .autoSkip, source: .codexSegmenter, label: "Sponsor", evidence: nil, originalStartMs: nil, originalEndMs: nil),
        SmartSkipSegment(id: "soft-ad", type: .ad, subtype: nil, startMs: 40_000, endMs: 50_000, confidence: 0.62, action: .softSkip, source: .codexSegmenter, label: "Possible ad", evidence: nil, originalStartMs: nil, originalEndMs: nil),
        SmartSkipSegment(id: "self-promo", type: .selfPromo, subtype: nil, startMs: 70_000, endMs: 75_000, confidence: 0.85, action: .autoSkip, source: .codexSegmenter, label: "Self promo", evidence: nil, originalStartMs: nil, originalEndMs: nil),
        SmartSkipSegment(id: "intro", type: .intro, subtype: nil, startMs: 80_000, endMs: 85_000, confidence: 0.88, action: .autoSkip, source: .codexSegmenter, label: "Intro", evidence: nil, originalStartMs: nil, originalEndMs: nil),
        SmartSkipSegment(id: "outro", type: .outro, subtype: nil, startMs: 90_000, endMs: 95_000, confidence: 0.89, action: .autoSkip, source: .codexSegmenter, label: "Outro", evidence: nil, originalStartMs: nil, originalEndMs: nil)
      ]
    )
    let entry = SmartSkipMapCacheEntry(
      id: "smart_episode",
      episodeId: "episode",
      audioUrl: "https://example.com/episode.mp3",
      map: map,
      status: .ready,
      jobId: nil,
      reason: nil,
      error: nil,
      lastRequestedAt: timestamp,
      cachedAt: timestamp,
      updatedAt: timestamp
    )

    var plan = PlaybackJumpPlan(settings: settings, silenceMap: silence, smartSkipEntry: entry)
    XCTAssertEqual(plan.jumpTarget(at: 10.5), 13.75)
    XCTAssertEqual(plan.jumpTarget(at: 21), 35)
    XCTAssertNil(plan.jumpTarget(at: 41))
    XCTAssertNil(plan.jumpTarget(at: 71))
    XCTAssertNil(plan.jumpTarget(at: 81))
    XCTAssertNil(plan.jumpTarget(at: 91))

    settings.smartSkipIncludeSoftMatches = true
    settings.smartSkipSelfPromo = true
    settings.smartSkipIntros = true
    settings.smartSkipOutros = true
    plan = PlaybackJumpPlan(settings: settings, silenceMap: silence, smartSkipEntry: entry)
    XCTAssertEqual(plan.jumpTarget(at: 41), 50)
    XCTAssertEqual(plan.jumpTarget(at: 71), 75)
    XCTAssertEqual(plan.jumpTarget(at: 81), 85)
    XCTAssertEqual(plan.jumpTarget(at: 91), 95)

    settings.smartSkipEnabled = false
    plan = PlaybackJumpPlan(settings: settings, silenceMap: silence, smartSkipEntry: entry)
    XCTAssertEqual(plan.jumpTarget(at: 10.5), 13.75)
    XCTAssertNil(plan.jumpTarget(at: 21))
    XCTAssertNil(plan.jumpTarget(at: 71))

    settings.silenceShortening = false
    plan = PlaybackJumpPlan(settings: settings, silenceMap: silence, smartSkipEntry: entry)
    XCTAssertNil(plan.jumpTarget(at: 10.5))
  }

  private func writeDownloadStub(root: URL, episodeId: String) throws -> String {
    let url = root.appending(path: "\(episodeId).mp3")
    try Data("download-\(episodeId)".utf8).write(to: url)
    return url.path
  }

  private func fixtureData(_ name: String, extension ext: String) throws -> Data {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: ext))
    return try Data(contentsOf: url)
  }

  private func testPodcast(id: String, title: String, feedUrl: String, lastRefreshedAt: Date?) -> Podcast {
    Podcast(
      id: id,
      title: title,
      author: "Test Author",
      description: "Test podcast",
      imageUrl: nil,
      feedUrl: feedUrl,
      websiteUrl: "https://example.com/\(id)",
      tags: [],
      sourceType: .rss,
      sourceUrl: feedUrl,
      externalId: nil,
      lastRefreshedAt: lastRefreshedAt,
      createdAt: lastRefreshedAt ?? Date(timeIntervalSince1970: 0),
      updatedAt: lastRefreshedAt ?? Date(timeIntervalSince1970: 0)
    )
  }

  private func testEpisode(id: String, podcast: Podcast, title: String, publishedAt: Date) -> Episode {
    Episode(
      id: id,
      podcastId: podcast.id,
      podcastTitle: podcast.title,
      title: title,
      description: "Test episode",
      audioUrl: "https://example.com/audio/\(id).mp3",
      websiteUrl: podcast.websiteUrl,
      imageUrl: podcast.imageUrl,
      publishedAt: publishedAt,
      durationSec: 1800,
      explicit: false,
      chapters: [],
      guid: id,
      enclosureLength: 1000,
      sourceType: .rss,
      sourceUrl: podcast.feedUrl,
      extractionStatus: ExtractionStatus.none,
      createdAt: publishedAt,
      updatedAt: publishedAt
    )
  }

  private func waitUntil(timeout: TimeInterval = 2, condition: @MainActor @escaping () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if await MainActor.run(body: condition) {
        return
      }
      try await Task.sleep(nanoseconds: 25_000_000)
    }
    XCTFail("Timed out waiting for condition.")
  }

  private func disabledCapabilities(
    podcastIndex: Bool = true,
    youtubeImport: Bool = true,
    clips: Bool = true,
    silenceMaps: Bool = true,
    smartSkip: Bool = true
  ) throws -> BackendCapabilities {
    let json = """
    {
      "youtubeImport": { "enabled": \(youtubeImport) },
      "podcastIndex": { "enabled": \(podcastIndex) },
      "clips": { "enabled": \(clips) },
      "silenceMaps": { "enabled": \(silenceMaps) },
      "smartSkip": { "enabled": \(smartSkip) }
    }
    """
    return try JSONDecoder().decode(BackendCapabilities.self, from: Data(json.utf8))
  }
}

@MainActor
private final class CapturingCloudKitPersonalSyncStore: CloudKitPersonalSyncStoring {
  private(set) var uploadedSnapshots: [CloudKitPersonalSyncSnapshot] = []
  private let remoteSnapshot: CloudKitPersonalSyncSnapshot?

  init(remoteSnapshot: CloudKitPersonalSyncSnapshot? = nil) {
    self.remoteSnapshot = remoteSnapshot
  }

  func upload(_ snapshot: CloudKitPersonalSyncSnapshot) async throws -> CloudKitPersonalSyncResult {
    uploadedSnapshots.append(snapshot)
    return CloudKitPersonalSyncResult(
      uploadedRecordCount: snapshot.recordCount,
      message: snapshot.recordCount == 1 ? "iCloud sync prepared 1 record." : "iCloud sync prepared \(snapshot.recordCount) records."
    )
  }

  func downloadSnapshot() async throws -> CloudKitPersonalSyncSnapshot? {
    remoteSnapshot
  }
}

@MainActor
private final class SpyBackgroundDownloadScheduler: BackgroundDownloadScheduling {
  struct ScheduleCall: Equatable {
    var downloadOnlyWifi: Bool
    var hasDownloadWork: Bool
  }

  private(set) var registerCount = 0
  private(set) var scheduleCalls: [ScheduleCall] = []
  private(set) var handler: (() async -> Bool)?

  func registerDownloadMaintenance(handler: @escaping @MainActor () async -> Bool) {
    registerCount += 1
    self.handler = handler
  }

  func scheduleDownloadMaintenance(settings: AppSettings, hasDownloadWork: Bool) {
    scheduleCalls.append(ScheduleCall(downloadOnlyWifi: settings.downloadOnlyWifi, hasDownloadWork: hasDownloadWork))
  }
}

private final class ServerIntelligenceRequestRecorder {
  private let lock = NSLock()
  private var recordedClientHeaders: Set<String> = []
  private var recordedNativeAccountHeaders: Set<String> = []
  private var recordedSilenceEpisodeIds: [String] = []
  private var recordedSmartSkipPriorities: [String: String] = [:]

  var clientHeaders: Set<String> {
    lock.withLock { recordedClientHeaders }
  }

  var nativeAccountHeaders: Set<String> {
    lock.withLock { recordedNativeAccountHeaders }
  }

  var silenceEpisodeIds: [String] {
    lock.withLock { recordedSilenceEpisodeIds }
  }

  var smartSkipPriorities: [String: String] {
    lock.withLock { recordedSmartSkipPriorities }
  }

  func recordHeaders(from request: URLRequest) {
    lock.withLock {
      if let value = request.value(forHTTPHeaderField: "x-daisypod-client") {
        recordedClientHeaders.insert(value)
      }
      if let value = request.value(forHTTPHeaderField: "x-daisypod-native-account") {
        recordedNativeAccountHeaders.insert(value)
      }
    }
  }

  func recordSilenceMapRequest(episodeId: String) {
    lock.withLock {
      recordedSilenceEpisodeIds.append(episodeId)
    }
  }

  func recordSmartSkipRequest(episodeId: String, priority: String?) {
    lock.withLock {
      recordedSmartSkipPriorities[episodeId] = priority
    }
  }
}

private final class MockURLProtocol: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

  override class func canInit(with request: URLRequest) -> Bool {
    true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    guard let handler = Self.handler else {
      client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
      return
    }
    do {
      let (response, data) = try handler(request)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}

private extension URLRequest {
  var bodyData: Data {
    if let httpBody {
      return httpBody
    }
    guard let stream = httpBodyStream else {
      return Data()
    }
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 1024)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: buffer.count)
      if count <= 0 { break }
      data.append(buffer, count: count)
    }
    return data
  }
}
