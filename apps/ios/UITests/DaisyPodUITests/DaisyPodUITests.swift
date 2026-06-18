import XCTest

final class DaisyPodUITests: XCTestCase {
  @MainActor
  func testFirstLaunchShowsInboxAndPlayerReadyNavigation() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launch()

    XCTAssertTrue(app.buttons["Tab.inbox"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.navigationBars["Inbox"].exists)
    XCTAssertTrue(app.buttons["Tab.library"].exists)
    XCTAssertTrue(app.buttons["Tab.settings"].exists)
  }

  @MainActor
  func testAddPodcastFlowHasAccessibleControls() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-tab=search")
    app.launch()

    XCTAssertTrue(app.buttons["Tab.search"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.navigationBars["Add"].waitForExistence(timeout: 5))
    let addInput = app.textFields["AddPodcastInput"]
    XCTAssertTrue(addInput.exists)
    let primaryAction = app.buttons["AddPodcastPrimaryAction"]
    XCTAssertTrue(primaryAction.exists)
    XCTAssertFalse(primaryAction.isEnabled)

    addInput.tap()
    addInput.typeText("https://example.com/feed.xml")
    let rssActionEnabled = NSPredicate(format: "isEnabled == true")
    expectation(for: rssActionEnabled, evaluatedWith: primaryAction)
    waitForExpectations(timeout: 2)
    XCTAssertTrue(app.staticTexts["Server Features"].exists)
  }

  @MainActor
  func testYouTubeImportModeRequiresBackend() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-tab=search")
    app.launch()

    XCTAssertTrue(app.navigationBars["Add"].waitForExistence(timeout: 5))
    let addInput = app.textFields["AddPodcastInput"]
    XCTAssertTrue(addInput.exists)
    addInput.tap()
    addInput.typeText("https://www.youtube.com/watch?v=abc123")

    let primaryAction = app.buttons["AddPodcastPrimaryAction"]
    XCTAssertTrue(primaryAction.exists)
    XCTAssertTrue(primaryAction.isEnabled)
    XCTAssertTrue(app.staticTexts["YouTube import uses the existing backend"].exists)
  }

  @MainActor
  func testNativeDeepLinkPrefillsAddPodcastURL() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-open-url=daisypod://add?url=https%3A%2F%2Fexample.com%2Fdeep-link-feed.xml")
    app.launch()

    XCTAssertTrue(app.navigationBars["Add"].waitForExistence(timeout: 5))
    let addInput = app.textFields["AddPodcastInput"]
    XCTAssertTrue(addInput.waitForExistence(timeout: 5))
    XCTAssertEqual(addInput.value as? String, "https://example.com/deep-link-feed.xml")

    let primaryAction = app.buttons["AddPodcastPrimaryAction"]
    XCTAssertTrue(primaryAction.exists)
    XCTAssertTrue(primaryAction.isEnabled)
    XCTAssertTrue(primaryAction.label.contains("Add RSS Feed"))
  }

  @MainActor
  func testLibrarySearchFiltersLocalPodcasts() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-tab=library")
    app.launch()

    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["DaisyPod Field Notes"].exists)
    XCTAssertTrue(app.staticTexts["Open Podcast Lab"].exists)

    let searchField = app.textFields["LibrarySearch"]
    XCTAssertTrue(searchField.waitForExistence(timeout: 5))
    searchField.tap()
    searchField.typeText("testing queueing")

    XCTAssertTrue(app.staticTexts["Open Podcast Lab"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["1 podcast"].waitForExistence(timeout: 2))
  }

  @MainActor
  func testPodcastDetailExposesNativeShowManagementControls() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-tab=library")
    app.launch()

    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    let podcastRow = app.buttons["LibraryPodcastRow_DaisyPod Field Notes"]
    XCTAssertTrue(podcastRow.waitForExistence(timeout: 5))
    podcastRow.tap()

    XCTAssertTrue(app.navigationBars["DaisyPod Field Notes"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["In Library"].exists)
    XCTAssertTrue(app.staticTexts["Subscribed"].exists)
    XCTAssertTrue(app.staticTexts["3 episodes"].exists)
    XCTAssertTrue(app.staticTexts["3 unplayed"].exists)
    XCTAssertTrue(app.buttons["PodcastLibraryButton"].exists)
    XCTAssertTrue(app.buttons["PodcastSubscriptionButton"].exists)
    XCTAssertTrue(app.switches["PodcastNewEpisodesToInboxToggle"].exists)
    XCTAssertTrue(app.buttons["PodcastRefreshButton"].exists)
    XCTAssertTrue(app.segmentedControls["PodcastEpisodeFilter"].exists)
    XCTAssertTrue(app.buttons["PodcastSortButton"].exists)
    XCTAssertTrue(app.buttons["PodcastActionsMenu"].exists)
    XCTAssertTrue(scrollTo(app.descendants(matching: .any)["PodcastPlaybackRateStepper"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.descendants(matching: .any)["PodcastSkipForwardStepper"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.descendants(matching: .any)["PodcastSkipBackStepper"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.switches["PodcastSilenceShorteningToggle"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.switches["PodcastSmartSkipToggle"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.switches["PodcastSmartSkipCommercialsToggle"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.switches["PodcastSmartSkipSoftMatchesToggle"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.buttons["PodcastResetPlaybackSettingsButton"], in: app, maxSwipes: 2))

    let episodeRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "PodcastEpisodeRow_")).element(boundBy: 0)
    XCTAssertTrue(scrollTo(episodeRow, in: app, maxSwipes: 4))
    episodeRow.tap()

    XCTAssertTrue(app.buttons["EpisodePlayNowButton"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["EpisodePlayNextButton"].exists)
    XCTAssertTrue(app.buttons["EpisodeQueueEndButton"].exists)
    XCTAssertTrue(app.buttons["EpisodeSendInboxButton"].exists)
    XCTAssertTrue(app.buttons["EpisodeFavoriteButton"].exists)
    XCTAssertTrue(app.buttons["EpisodeMarkPlayedButton"].exists)
    XCTAssertTrue(app.buttons["EpisodeDownloadButton"].exists)
    XCTAssertTrue(app.buttons["EpisodeCreateClipButton"].exists)
  }

  @MainActor
  func testEpisodeDetailChaptersClipComposerAndServerIntelligenceControls() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-tab=library")
    app.launch()

    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    let podcastRow = app.buttons["LibraryPodcastRow_DaisyPod Field Notes"]
    XCTAssertTrue(podcastRow.waitForExistence(timeout: 5))
    podcastRow.tap()

    let episodeRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "PodcastEpisodeRow_")).element(boundBy: 0)
    XCTAssertTrue(scrollTo(episodeRow, in: app, maxSwipes: 4))
    episodeRow.tap()

    XCTAssertTrue(app.buttons["EpisodeCreateClipButton"].waitForExistence(timeout: 5))
    app.buttons["EpisodeCreateClipButton"].tap()
    XCTAssertTrue(app.navigationBars["Create Clip"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.textFields["ClipTitleInput"].exists)
    XCTAssertTrue(app.descendants(matching: .any)["ClipNoteInput"].exists)
    XCTAssertTrue(app.descendants(matching: .any)["ClipStartStepper"].exists)
    XCTAssertTrue(app.descendants(matching: .any)["ClipEndStepper"].exists)
    XCTAssertTrue(app.buttons["ClipSaveButton"].exists)
    app.buttons["Cancel"].tap()

    XCTAssertTrue(app.navigationBars["Episode"].waitForExistence(timeout: 5))
    let chapterButton = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "EpisodeChapter_")).element(boundBy: 0)
    XCTAssertTrue(scrollTo(chapterButton, in: app, maxSwipes: 4))

    XCTAssertTrue(scrollTo(app.buttons["ServerIntelligenceDisclosure"], in: app, maxSwipes: 2))
    app.buttons["ServerIntelligenceDisclosure"].tap()
    XCTAssertTrue(scrollTo(app.buttons["RequestSilenceMapButton"], in: app, maxSwipes: 2))
    XCTAssertTrue(app.buttons["RequestSilenceMapButton"].exists)
    XCTAssertTrue(app.buttons["RefreshSilenceMapButton"].exists)
    XCTAssertTrue(scrollTo(app.buttons["RequestSmartSkipButton"], in: app, maxSwipes: 2))
    XCTAssertTrue(app.buttons["RequestSmartSkipButton"].exists)
    XCTAssertTrue(app.buttons["RefreshSmartSkipButton"].exists)

    XCTAssertTrue(scrollTo(chapterButton, in: app, maxSwipes: 4))
    chapterButton.tap()
    XCTAssertTrue(app.navigationBars["Episode"].waitForExistence(timeout: 2))
  }

  @MainActor
  func testEpisodeDetailSavesLocalClipFromComposer() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-tab=library")
    app.launch()

    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    let podcastRow = app.buttons["LibraryPodcastRow_DaisyPod Field Notes"]
    XCTAssertTrue(podcastRow.waitForExistence(timeout: 5))
    podcastRow.tap()

    let episodeRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "PodcastEpisodeRow_")).element(boundBy: 0)
    XCTAssertTrue(scrollTo(episodeRow, in: app, maxSwipes: 4))
    episodeRow.tap()

    XCTAssertTrue(app.buttons["EpisodeCreateClipButton"].waitForExistence(timeout: 5))
    app.buttons["EpisodeCreateClipButton"].tap()
    XCTAssertTrue(app.navigationBars["Create Clip"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["ClipSaveButton"].waitForExistence(timeout: 5))
    app.buttons["ClipSaveButton"].tap()

    let clipRow = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "ClipRow_")).element(boundBy: 0)
    XCTAssertTrue(scrollTo(clipRow, in: app, maxSwipes: 5))
  }

  @MainActor
  func testSettingsExposeBackendAndPortableDataControls() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-tab=settings")
    app.launch()

    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    XCTAssertTrue(scrollTo(app.segmentedControls["ThemePicker"], in: app, maxSwipes: 1))
    XCTAssertTrue(scrollTo(app.descendants(matching: .any)["FeedRefreshIntervalStepper"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.staticTexts["StatsEmptyMessage"], in: app, maxSwipes: 3))
    XCTAssertTrue(scrollTo(app.textFields["ServerURLInput"], in: app))
    XCTAssertTrue(scrollTo(app.buttons["SaveServerURLButton"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.buttons["TestServerButton"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.staticTexts["AppleAccountStatusValue"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.buttons["SyncNowButton"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.staticTexts["SyncPendingActionsValue"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.staticTexts["SyncRetainedActionsValue"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.staticTexts["SyncLocalSnapshotValue"], in: app, maxSwipes: 2))

    XCTAssertTrue(scrollTo(app.buttons["ImportOPMLButton"], in: app))
    XCTAssertTrue(scrollTo(app.buttons["ExportOPMLButton"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.buttons["RestoreBackupButton"], in: app, maxSwipes: 2))
    XCTAssertTrue(scrollTo(app.buttons["ExportBackupButton"], in: app, maxSwipes: 2))
  }

  @MainActor
  func testOfflineModeFiltersLibraryAndKeepsDownloadsVisible() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-downloaded-seed")
    app.launchArguments.append("--daisy-ui-test-offline-mode-off")
    app.launchArguments.append("--daisy-ui-test-tab=settings")
    app.launch()

    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    let offlineMode = app.switches["OfflineModeToggle"]
    XCTAssertTrue(scrollTo(offlineMode, in: app, maxSwipes: 2))
    offlineMode.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()

    app.terminate()
    app.launchArguments = ["--daisy-ui-test-downloaded-seed", "--daisy-ui-test-tab=library"]
    app.launch()
    XCTAssertTrue(app.navigationBars["Library"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["DaisyPod Field Notes"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["1 podcast"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["Open Podcast Lab"].exists)

    app.terminate()
    app.launchArguments = ["--daisy-ui-test-downloaded-seed", "--daisy-ui-test-tab=downloads"]
    app.launch()
    XCTAssertTrue(app.navigationBars["Downloads"].waitForExistence(timeout: 5))
    let downloadedRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "EpisodeRow_")).element(boundBy: 0)
    XCTAssertTrue(downloadedRow.waitForExistence(timeout: 5))
  }

  @MainActor
  func testInboxVisibleRowActionsExposeQueueChoices() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-tab=inbox")
    app.launch()

    XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 5))
    let inboxActions = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "EpisodeRowActions_")).element(boundBy: 0)
    XCTAssertTrue(inboxActions.waitForExistence(timeout: 5))
    inboxActions.tap()
    XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 2))
    XCTAssertTrue(app.buttons["Queue"].exists)
    XCTAssertTrue(app.buttons["Add Last"].exists)
    XCTAssertTrue(app.buttons["Dismiss"].exists)
    XCTAssertTrue(app.buttons["Mark Played"].exists)
    XCTAssertFalse(app.buttons["Download"].exists)
    XCTAssertFalse(app.buttons["Delete Download"].exists)
    app.buttons["Add Last"].tap()

    XCTAssertTrue(app.navigationBars["Inbox"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "EpisodeRowActions_")).element(boundBy: 0).waitForExistence(timeout: 5))
  }

  @MainActor
  func testQueueSheetExposesEditAndPlayerControls() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-player")
    app.launch()

    XCTAssertTrue(app.buttons["OpenPlayer"].exists)
    app.buttons["OpenPlayer"].tap()
    XCTAssertTrue(app.navigationBars["Now Playing"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Edit"].exists)
    XCTAssertTrue(app.buttons["Play"].exists || app.buttons["Pause"].exists)
  }

  @MainActor
  func testPlayerBarOpensExpandedQueueSheet() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-player")
    app.launch()

    XCTAssertTrue(app.buttons["OpenPlayer"].waitForExistence(timeout: 5))
    app.buttons["OpenPlayer"].tap()

    XCTAssertTrue(app.navigationBars["Now Playing"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Queue"].exists)
    XCTAssertTrue(app.buttons["SleepTimerMenu"].exists)
    XCTAssertTrue(app.buttons["Play"].exists || app.buttons["Pause"].exists)
    app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["OpenPlayer"].waitForExistence(timeout: 2))
  }

  @MainActor
  func testExpandedPlayerSleepTimerAndFavoriteControlsAreUsable() {
    let app = XCUIApplication()
    app.launchArguments.append("--daisy-ui-test-reset-store")
    app.launchArguments.append("--daisy-ui-test-player")
    app.launch()

    XCTAssertTrue(app.buttons["OpenPlayer"].waitForExistence(timeout: 5))
    app.buttons["OpenPlayer"].tap()

    XCTAssertTrue(app.navigationBars["Now Playing"].waitForExistence(timeout: 5))
    let favoriteButton = app.buttons["ExpandedPlayerFavoriteButton"]
    XCTAssertTrue(favoriteButton.waitForExistence(timeout: 5))
    let expectedFavoriteLabel = favoriteButton.label.contains("Remove Favorite") ? "Favorite" : "Remove Favorite"
    favoriteButton.tap()
    let favoriteUpdated = NSPredicate(format: "label == %@", expectedFavoriteLabel)
    expectation(for: favoriteUpdated, evaluatedWith: favoriteButton)
    waitForExpectations(timeout: 2)

    let sleepTimer = app.buttons["SleepTimerMenu"]
    XCTAssertTrue(sleepTimer.exists)
    sleepTimer.tap()
    XCTAssertTrue(app.buttons["15 minutes"].waitForExistence(timeout: 2))
    app.buttons["15 minutes"].tap()
    let timerUpdated = NSPredicate(format: "label CONTAINS %@", "15 minutes remaining")
    expectation(for: timerUpdated, evaluatedWith: app.buttons["SleepTimerMenu"])
    waitForExpectations(timeout: 2)
  }

  @MainActor
  private func scrollTo(_ element: XCUIElement, in app: XCUIApplication, maxSwipes: Int = 8) -> Bool {
    if element.waitForExistence(timeout: 1) { return true }
    for _ in 0..<maxSwipes {
      app.swipeUp()
      if element.waitForExistence(timeout: 1) { return true }
    }
    return false
  }
}
