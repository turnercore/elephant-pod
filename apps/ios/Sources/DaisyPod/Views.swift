import AuthenticationServices
import SwiftUI
import UniformTypeIdentifiers

enum AppRoute: Hashable {
  case episode(String)
  case podcast(String)
}

struct NavigateToRouteKey: EnvironmentKey {
  typealias Value = @MainActor @Sendable (AppRoute) -> Void
  static let defaultValue: Value = { _ in }
}

extension EnvironmentValues {
  var navigateToRoute: NavigateToRouteKey.Value {
    get { self[NavigateToRouteKey.self] }
    set { self[NavigateToRouteKey.self] = newValue }
  }
}

struct RootView: View {
  @EnvironmentObject private var model: AppModel
  @State private var path = NavigationPath()

  var body: some View {
    let visibleSection = model.selectedTab.visibleSection
    let theme = model.settings.theme
    let themeStyle = theme.style
    NavigationStack(path: $path) {
      VStack(spacing: 0) {
        TopSectionNavigation(selection: Binding(
          get: { model.selectedTab.visibleSection },
          set: { model.selectedTab = $0.visibleSection }
        ))
        Divider()
        sectionView(visibleSection)
          .id(visibleSection)
          .themedContentSurface()
      }
      .overlay(alignment: .top) {
        if let status = model.status {
          StatusToast(message: status) {
            model.dismissStatus()
          }
          .padding(.top, 8)
          .zIndex(10)
          .transition(.move(edge: .top).combined(with: .opacity))
          .task(id: status) {
            try? await Task.sleep(for: .seconds(3))
            if model.status == status {
              model.dismissStatus()
            }
          }
        }
      }
      .background(AppThemeBackground(theme: theme).ignoresSafeArea())
      .navigationTitle(visibleSection.title)
      .navigationBarTitleDisplayMode(.inline)
      .navigationDestination(for: AppRoute.self) { route in
        switch route {
        case .episode(let episodeId):
          if let episode = model.episodes.first(where: { $0.id == episodeId }) {
            EpisodeDetailView(episode: episode)
          } else {
            ContentUnavailableView("Episode not found", systemImage: "waveform")
          }
        case .podcast(let podcastId):
          if let podcast = model.podcast(id: podcastId) {
            PodcastDetailView(podcast: podcast)
          } else {
            ContentUnavailableView("Podcast not found", systemImage: "podcast")
          }
        }
      }
    }
    .environment(\.appThemeStyle, themeStyle)
    .preferredColorScheme(theme.colorScheme)
    .tint(themeStyle.tint)
    .toolbarBackground(themeStyle.elevatedSurface.opacity(theme == .vaporwave ? 0.94 : 0.88), for: .navigationBar)
    .toolbarBackground(.visible, for: .navigationBar)
    .toolbarColorScheme(theme.colorScheme, for: .navigationBar)
    .environment(\.navigateToRoute) { route in
      path.append(route)
    }
    .background(AppThemeBackground(theme: theme).ignoresSafeArea())
    .overlay {
      AppThemeForegroundEffects(theme: theme)
        .ignoresSafeArea()
    }
    .safeAreaInset(edge: .bottom) {
      PlayerBar(audio: model.audio)
        .environmentObject(model)
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }
    .animation(.snappy, value: model.status)
  }

  @ViewBuilder
  private func sectionView(_ section: SectionKey) -> some View {
    switch section {
    case .inbox:
      EpisodeListView(episodes: model.inbox, emptyTitle: "Inbox is clear", showInboxActions: true)
    case .queue:
      EpisodeListView(episodes: model.queue, emptyTitle: "Queue is empty", showQueueActions: true)
    case .library:
      LibraryView()
    case .search:
      SearchAddView()
    case .history:
      EpisodeListView(episodes: model.history, emptyTitle: "No playback history yet")
    case .downloads:
      EpisodeListView(episodes: model.downloads, emptyTitle: "No downloaded episodes yet")
    case .settings:
      SettingsView()
    }
  }
}

struct StatusToast: View {
  @Environment(\.appThemeStyle) private var theme
  var message: String
  var onDismiss: () -> Void

  var body: some View {
    Button(action: onDismiss) {
      HStack(spacing: 8) {
        Text(message)
          .font(.footnote.weight(.medium))
          .lineLimit(2)
        Image(systemName: "xmark.circle.fill")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .background(theme.elevatedSurface.opacity(theme.isVaporwave ? 0.88 : 0.72), in: Capsule())
      .overlay {
        Capsule().stroke(theme.tint.opacity(theme.isVaporwave ? 0.8 : theme.separatorOpacity), lineWidth: theme.isVaporwave ? 1.2 : 0.5)
      }
      .shadow(color: theme.isVaporwave ? theme.tint.opacity(0.42) : .black.opacity(0.16), radius: theme.isVaporwave ? 18 : 12, y: 5)
      .padding(.horizontal, 14)
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(message). Dismiss")
    .accessibilityIdentifier("RootStatusMessage")
  }
}

struct TopSectionNavigation: View {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @Environment(\.appThemeStyle) private var theme
  @Binding var selection: SectionKey

  private var iconOnly: Bool {
    horizontalSizeClass == .compact
  }

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 8) {
        ForEach(SectionKey.primaryNavigationCases) { section in
          TopSectionButton(
            section: section,
            isSelected: selection == section,
            iconOnly: iconOnly
          ) {
            selection = section
          }
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
    }
    .background {
      if theme.isVaporwave {
        LinearGradient(
          colors: [theme.elevatedSurface, theme.surface.opacity(0.84)],
          startPoint: .leading,
          endPoint: .trailing
        )
      } else {
        theme.elevatedSurface.opacity(0.94)
      }
    }
    .overlay(alignment: .bottom) {
      Rectangle()
        .fill(theme.isVaporwave ? theme.secondaryTint.opacity(0.82) : Color(.separator).opacity(theme.separatorOpacity))
        .frame(height: theme.isVaporwave ? 1.5 : 0.5)
        .shadow(color: theme.isVaporwave ? theme.secondaryTint.opacity(0.8) : .clear, radius: 8)
    }
    .accessibilityIdentifier("TopSectionNavigation")
  }
}

struct TopSectionButton: View {
  @Environment(\.appThemeStyle) private var theme
  var section: SectionKey
  var isSelected: Bool
  var iconOnly: Bool
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      content
    }
    .buttonStyle(.plain)
    .foregroundStyle(isSelected ? theme.tint : Color.primary)
    .accessibilityLabel(section.title)
    .accessibilityIdentifier(section.accessibilityIdentifier)
  }

  @ViewBuilder
  private var content: some View {
    if iconOnly {
      Label(section.title, systemImage: section.systemImage)
        .labelStyle(.iconOnly)
        .font(.subheadline.weight(isSelected ? .semibold : .regular))
        .frame(minWidth: 42)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(navigationButtonBackground)
        .shadow(color: isSelected && theme.isVaporwave ? theme.tint.opacity(0.28) : .clear, radius: 10)
    } else {
      Label(section.title, systemImage: section.systemImage)
        .labelStyle(.titleAndIcon)
        .font(.subheadline.weight(isSelected ? .semibold : .regular))
        .lineLimit(1)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(navigationButtonBackground)
        .shadow(color: isSelected && theme.isVaporwave ? theme.tint.opacity(0.28) : .clear, radius: 10)
    }
  }

  private var navigationButtonBackground: some View {
    Capsule()
      .fill(isSelected ? theme.tint.opacity(theme.isVaporwave ? 0.20 : 0.16) : Color.clear)
      .overlay {
        Capsule()
          .stroke(isSelected && theme.isVaporwave ? theme.tint.opacity(0.72) : .clear, lineWidth: 1)
      }
  }
}

struct EpisodeListView: View {
  @EnvironmentObject private var model: AppModel
  var episodes: [EpisodeWithState]
  var emptyTitle: String
  var showInboxActions = false
  var showQueueActions = false

  var body: some View {
    Group {
      if episodes.isEmpty {
        ContentUnavailableView(emptyTitle, systemImage: "waveform", description: Text("Local-first data is ready for real feeds."))
      } else {
        List {
          ForEach(episodes) { episode in
            HStack(spacing: 8) {
              EpisodeRow(episode: episode)
              .accessibilityIdentifier("EpisodeRow_\(episode.id)")

              EpisodeRowActionsMenu(
                episode: episode,
                showInboxActions: showInboxActions,
                showQueueActions: showQueueActions
              )
            }
            .swipeActions(edge: .leading) {
              Button {
                model.play(episode)
              } label: {
                Label("Play", systemImage: "play.fill")
              }
              .tint(.green)
              Button {
                model.playNext(episode)
              } label: {
                Label("Queue", systemImage: "text.line.first.and.arrowtriangle.forward")
              }
              .tint(.blue)
              Button {
                model.queueEpisode(episode)
              } label: {
                Label("Add Last", systemImage: "text.line.last.and.arrowtriangle.forward")
              }
              .tint(.indigo)
            }
            .swipeActions(edge: .trailing) {
              if episode.state.downloaded && !showInboxActions {
                Button(role: .destructive) {
                  model.deleteDownload(episode)
                } label: {
                  Label("Delete Download", systemImage: "trash")
                }
              }
              if showInboxActions {
                Button {
                  model.archiveInboxEpisode(episode)
                } label: {
                  Label("Dismiss", systemImage: "archivebox")
                }
                .tint(.orange)
              }
              if showQueueActions {
                Button(role: .destructive) {
                  model.removeQueueEpisode(episode)
                } label: {
                  Label("Remove", systemImage: "minus.circle")
                }
              }
              if showInboxActions {
                Button {
                  model.markPlayed(episode, played: true)
                } label: {
                  Label("Mark Played", systemImage: "checkmark.circle")
                }
              } else {
                Button {
                  model.markPlayed(episode, played: !episode.state.played)
                } label: {
                  Label(episode.state.played ? "Mark Unplayed" : "Mark Played", systemImage: episode.state.played ? "circle" : "checkmark.circle")
                }
              }
            }
          }
          .onMove { source, destination in
            if showQueueActions {
              model.moveQueueEpisodes(from: source, to: destination)
            }
          }
        }
        .accessibilityIdentifier(showQueueActions ? "QueueEpisodeList" : "EpisodeList")
        .toolbar {
          if showQueueActions {
            EditButton()
              .accessibilityIdentifier("QueueEditButton")
          }
        }
      }
    }
  }
}

struct EpisodeRowActionsMenu: View {
  @EnvironmentObject private var model: AppModel
  @State private var showsActions = false
  var episode: EpisodeWithState
  var showInboxActions: Bool
  var showQueueActions: Bool

  var body: some View {
    Button {
      showsActions = true
    } label: {
      Image(systemName: "ellipsis.circle")
        .font(.title3)
        .frame(width: 36, height: 36)
        .contentShape(Rectangle())
    }
    .buttonStyle(.borderless)
    .accessibilityLabel("Episode actions for \(episode.episode.title)")
    .accessibilityIdentifier("EpisodeRowActions_\(episode.id)")
    .confirmationDialog("Episode Actions", isPresented: $showsActions, titleVisibility: .visible) {
      Button("Play") {
        model.play(episode)
      }
      Button("Queue") {
        model.playNext(episode)
      }
      Button("Add Last") {
        model.queueEpisode(episode)
      }
      if showInboxActions {
        Button("Dismiss") {
          model.archiveInboxEpisode(episode)
        }
      }
      if showQueueActions {
        Button("Send to Inbox") {
          model.sendQueueEpisodeToInbox(episode)
        }
        Button("Remove from Queue", role: .destructive) {
          model.removeQueueEpisode(episode)
        }
      }
      if showInboxActions {
        Button("Mark Played") {
          model.markPlayed(episode, played: true)
        }
      } else {
        Button(episode.state.played ? "Mark Unplayed" : "Mark Played") {
          model.markPlayed(episode, played: !episode.state.played)
        }
      }
      Button(episode.state.favorite ? "Remove Favorite" : "Favorite") {
        model.toggleFavorite(episode)
      }
      Button("Cancel", role: .cancel) {}
    }
  }
}

struct EpisodeRow: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.navigateToRoute) private var navigateToRoute
  var episode: EpisodeWithState

  var body: some View {
    HStack(spacing: 12) {
      ArtworkThumb(
        remoteURL: episode.episode.imageUrl ?? model.podcast(for: episode)?.imageUrl,
        cachedURL: model.cachedArtworkURL(for: episode),
        fallbackSystemImage: episode.state.downloaded ? "arrow.down.circle.fill" : "waveform",
        size: 56,
        tint: .blue
      )
      if episode.state.played {
        PlayedBadge()
      }
      VStack(alignment: .leading, spacing: 4) {
        Button {
          navigateToRoute(.episode(episode.id))
        } label: {
          Text(episode.episode.title)
            .font(.headline)
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("EpisodeTitleLink_\(episode.id)")

        Button {
          navigateToRoute(.podcast(episode.episode.podcastId))
        } label: {
          Text(episode.episode.podcastTitle)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("EpisodePodcastLink_\(episode.id)")
        HStack {
          Text((episode.episode.durationSec ?? 0).clockString)
          if episode.state.progressSec > 0 { Text("• \(episode.state.progressSec.clockString)") }
          if episode.state.played { Text("• Played") }
          if episode.state.favorite { Text("• Favorite") }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      if episode.state.favorite {
        Image(systemName: "star.fill")
          .foregroundStyle(.yellow)
          .accessibilityLabel("Favorite")
      }
    }
  }
}

struct PlayedBadge: View {
  var body: some View {
    Image(systemName: "checkmark.circle.fill")
      .font(.caption)
      .foregroundStyle(.green)
      .accessibilityLabel("Played")
  }
}

struct LibraryView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.navigateToRoute) private var navigateToRoute
  @State private var searchText = ""

  private var filteredPodcasts: [Podcast] {
    model.libraryPodcasts(matching: searchText)
  }

  var body: some View {
    List {
      Section {
        HStack(spacing: 8) {
          Image(systemName: "magnifyingglass")
            .foregroundStyle(.secondary)
          TextField("Filter Library", text: $searchText)
            .textInputAutocapitalization(.never)
            .disableAutocorrection(true)
            .accessibilityIdentifier("LibrarySearchField")
          if !searchText.isEmpty {
            Button {
              searchText = ""
            } label: {
              Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Clear Library Search")
          }
        }
        .accessibilityIdentifier("LibrarySearch")

        Text(libraryResultCountTitle)
          .font(.caption)
          .foregroundStyle(.secondary)
          .accessibilityIdentifier("LibraryResultCount")
      }

      if filteredPodcasts.isEmpty {
        Section {
          ContentUnavailableView(
            searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Library is empty" : "No matching podcasts",
            systemImage: "books.vertical",
            description: Text("Local library search checks titles, authors, tags, descriptions, and feed URLs.")
          )
        }
      } else {
        ForEach(filteredPodcasts) { podcast in
          Button {
            navigateToRoute(.podcast(podcast.id))
          } label: {
            HStack(spacing: 12) {
              ArtworkThumb(remoteURL: podcast.imageUrl, fallbackSystemImage: "podcast", size: 52, tint: .purple)
              VStack(alignment: .leading, spacing: 4) {
                Text(podcast.title).font(.headline)
                Text(podcast.author ?? podcast.feedUrl).font(.subheadline).foregroundStyle(.secondary)
                Text("\(model.episodes.filter { $0.episode.podcastId == podcast.id }.count) episodes")
                  .font(.caption)
                  .foregroundStyle(.secondary)
              }
            }
            .accessibilityElement(children: .combine)
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("LibraryPodcastRow_\(podcast.title)")
        }
      }
    }
    .accessibilityIdentifier("LibraryPodcastList")
  }

  private var libraryResultCountTitle: String {
    filteredPodcasts.count == 1 ? "1 podcast" : "\(filteredPodcasts.count) podcasts"
  }
}

struct PodcastDetailView: View {
  @EnvironmentObject private var model: AppModel
  var podcast: Podcast
  @State private var filter: PodcastEpisodeFilter = .all
  @State private var descriptionExpanded = false

  private var preference: PodcastPreference {
    model.podcastPreference(for: podcast)
  }

  private var episodes: [EpisodeWithState] {
    model.podcastEpisodes(for: podcast, filter: filter)
  }

  private var allEpisodes: [EpisodeWithState] {
    model.podcastEpisodes(for: podcast)
  }

  private var unplayedCount: Int {
    allEpisodes.filter { !$0.state.played }.count
  }

  private var inLibrary: Bool {
    preference.inLibrary != false
  }

  private var subscribed: Bool {
    preference.addNewEpisodesToInbox
  }

  private var isRefreshing: Bool {
    model.refreshingPodcastIds.contains(podcast.id)
  }

  var body: some View {
    List {
      Section {
        HStack(alignment: .top, spacing: 14) {
          ArtworkThumb(remoteURL: podcast.imageUrl, fallbackSystemImage: "podcast", size: 72, tint: .purple)
          VStack(alignment: .leading, spacing: 6) {
            Text(podcast.title)
              .font(.title3.weight(.semibold))
            if let author = podcast.author {
              Text(author)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            HStack {
              Text(inLibrary ? "In Library" : "Not in Library")
              Text(subscribed ? "Subscribed" : "Not subscribed")
              Text("\(allEpisodes.count) episodes")
              Text("\(unplayedCount) unplayed")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
          }
        }
        if let description = podcast.description?.strippedHTML.nilIfEmpty {
          ExpandableDescription(
            text: description,
            collapsedLineLimit: 3,
            isExpanded: $descriptionExpanded
          )
        }
      }

      Section {
        Button {
          inLibrary ? model.removePodcastFromLibrary(podcast) : model.addPodcastToLibrary(podcast)
        } label: {
          Label(inLibrary ? "Remove from Library" : "Add to Library", systemImage: inLibrary ? "books.vertical.fill" : "books.vertical")
        }
        .accessibilityIdentifier("PodcastLibraryButton")

        Button {
          subscribed ? model.unsubscribePodcast(podcast) : model.subscribePodcast(podcast)
        } label: {
          Label(subscribed ? "Unsubscribe" : "Subscribe", systemImage: subscribed ? "checkmark.circle.fill" : "plus.circle")
        }
        .accessibilityIdentifier("PodcastSubscriptionButton")

        Toggle("New episodes to Inbox", isOn: Binding(
          get: { preference.addNewEpisodesToInbox },
          set: { enabled in
            model.updatePodcastPreference(podcast) { preference in
              preference.inLibrary = true
              preference.addNewEpisodesToInbox = enabled
              if enabled {
                preference.wasSubscribedBeforeLibraryRemoval = false
              }
            }
          }
        ))
        .accessibilityIdentifier("PodcastNewEpisodesToInboxToggle")

        Button {
          model.refreshPodcast(podcast)
        } label: {
          Label(isRefreshing ? "Refreshing" : "Refresh Podcast", systemImage: "arrow.clockwise")
        }
        .disabled(isRefreshing)
        .accessibilityIdentifier("PodcastRefreshButton")

        Picker("Filter episodes", selection: $filter) {
          ForEach(PodcastEpisodeFilter.allCases) { value in
            Text(value.title).tag(value)
          }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("PodcastEpisodeFilter")

        Button {
          model.updatePodcastPreference(podcast) { preference in
            preference.sortDirection = preference.sortDirection == .newest ? .oldest : .newest
          }
        } label: {
          Label(
            preference.sortDirection == .newest ? "Sort oldest first" : "Sort newest first",
            systemImage: preference.sortDirection == .newest ? "arrow.down" : "arrow.up"
          )
        }
        .accessibilityIdentifier("PodcastSortButton")

        Menu {
          Button {
            model.sendAllUnplayedInPodcastToInbox(podcast)
          } label: {
            Label("Send unplayed to Inbox", systemImage: "tray.and.arrow.down")
          }
          Button {
            model.markAllInPodcast(podcast, played: true)
          } label: {
            Label("Mark all played", systemImage: "checkmark.circle")
          }
          Button {
            model.markAllInPodcast(podcast, played: false)
          } label: {
            Label("Mark all unplayed", systemImage: "arrow.counterclockwise")
          }
        } label: {
          Label("Show Actions", systemImage: "ellipsis.circle")
        }
        .accessibilityIdentifier("PodcastActionsMenu")
      }

      Section("Show Playback") {
        Stepper("Playback speed: \(showPlaybackRate, specifier: "%.2fx")", value: Binding(
          get: { showPlaybackRate },
          set: { value in
            model.updatePodcastPreference(podcast) { preference in
              preference.playbackRate = value
            }
          }
        ), in: 0.75...2.0, step: 0.05)
        .accessibilityIdentifier("PodcastPlaybackRateStepper")

        Stepper("Skip forward: \(showSkipForwardSec)s", value: Binding(
          get: { showSkipForwardSec },
          set: { value in
            model.updatePodcastPreference(podcast) { preference in
              preference.skipForwardSec = value
            }
          }
        ), in: 10...60, step: 5)
        .accessibilityIdentifier("PodcastSkipForwardStepper")

        Stepper("Skip back: \(showSkipBackSec)s", value: Binding(
          get: { showSkipBackSec },
          set: { value in
            model.updatePodcastPreference(podcast) { preference in
              preference.skipBackSec = value
            }
          }
        ), in: 5...60, step: 5)
        .accessibilityIdentifier("PodcastSkipBackStepper")

        Toggle("Shorten Silence", isOn: Binding(
          get: { preference.silenceShortening ?? model.settings.silenceShortening },
          set: { value in
            model.updatePodcastPreference(podcast) { preference in
              preference.silenceShortening = value
            }
          }
        ))
        .accessibilityIdentifier("PodcastSilenceShorteningToggle")

        Toggle("Smart Skip", isOn: Binding(
          get: { preference.smartSkipEnabled ?? model.settings.smartSkipEnabled },
          set: { value in
            model.updatePodcastPreference(podcast) { preference in
              preference.smartSkipEnabled = value
            }
          }
        ))
        .accessibilityIdentifier("PodcastSmartSkipToggle")

        Toggle("Skip sponsors and ads", isOn: Binding(
          get: { preference.smartSkipCommercials ?? model.settings.smartSkipCommercials },
          set: { value in
            model.updatePodcastPreference(podcast) { preference in
              preference.smartSkipCommercials = value
            }
          }
        ))
        .accessibilityIdentifier("PodcastSmartSkipCommercialsToggle")

        Toggle("Include soft matches", isOn: Binding(
          get: { preference.smartSkipIncludeSoftMatches ?? model.settings.smartSkipIncludeSoftMatches },
          set: { value in
            model.updatePodcastPreference(podcast) { preference in
              preference.smartSkipIncludeSoftMatches = value
            }
          }
        ))
        .accessibilityIdentifier("PodcastSmartSkipSoftMatchesToggle")

        Button {
          model.updatePodcastPreference(podcast) { preference in
            preference.playbackRate = nil
            preference.skipForwardSec = nil
            preference.skipBackSec = nil
            preference.silenceShortening = nil
            preference.smartSkipEnabled = nil
            preference.smartSkipCommercials = nil
            preference.smartSkipSelfPromo = nil
            preference.smartSkipIntros = nil
            preference.smartSkipOutros = nil
            preference.smartSkipIncludeSoftMatches = nil
          }
        } label: {
          Label("Use Global Playback Settings", systemImage: "arrow.counterclockwise")
        }
        .accessibilityIdentifier("PodcastResetPlaybackSettingsButton")
      }

      Section {
        if episodes.isEmpty {
          ContentUnavailableView("No matching episodes", systemImage: "waveform", description: Text("Change the filter or refresh this feed."))
        } else {
          ForEach(episodes) { episode in
            NavigationLink {
              EpisodeDetailView(episode: episode)
            } label: {
              EpisodeRow(episode: episode)
            }
            .accessibilityIdentifier("PodcastEpisodeRow_\(episode.id)")
            .swipeActions(edge: .leading) {
              Button {
                model.play(episode)
              } label: {
                Label("Play", systemImage: "play.fill")
              }
              .tint(.green)
              Button {
                model.queueEpisode(episode)
              } label: {
                Label("Queue", systemImage: "text.line.first.and.arrowtriangle.forward")
              }
              .tint(.blue)
              Button {
                episode.state.downloaded ? model.deleteDownload(episode) : model.downloadEpisode(episode)
              } label: {
                Label(episode.state.downloaded ? "Delete Download" : "Download", systemImage: episode.state.downloaded ? "trash" : "arrow.down.circle")
              }
              .tint(episode.state.downloaded ? .red : .teal)
            }
            .swipeActions(edge: .trailing) {
              Button {
                model.markPlayed(episode, played: !episode.state.played)
              } label: {
                Label(episode.state.played ? "Mark Unplayed" : "Mark Played", systemImage: episode.state.played ? "circle" : "checkmark.circle")
              }
            }
          }
        }
      }
    }
    .navigationTitle(podcast.title)
  }

  private var showPlaybackRate: Double {
    preference.playbackRate ?? model.settings.playbackRate
  }

  private var showSkipForwardSec: Int {
    preference.skipForwardSec ?? model.settings.skipForwardSec
  }

  private var showSkipBackSec: Int {
    preference.skipBackSec ?? model.settings.skipBackSec
  }
}

struct EpisodeDetailView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.navigateToRoute) private var navigateToRoute
  var episode: EpisodeWithState
  @State private var clipComposer: ClipComposerContext?
  @State private var descriptionExpanded = false

  private var currentEpisode: EpisodeWithState {
    model.episodes.first { $0.id == episode.id } ?? episode
  }

  private var episodeClips: [Clip] {
    model.clips.filter { $0.episodeId == currentEpisode.id }
  }

  var body: some View {
    let episode = currentEpisode
    List {
      Section {
        VStack(alignment: .leading, spacing: 14) {
          HStack(alignment: .top, spacing: 14) {
            ArtworkThumb(
              remoteURL: episode.episode.imageUrl ?? model.podcast(for: episode)?.imageUrl,
              cachedURL: model.cachedArtworkURL(for: episode),
              fallbackSystemImage: episode.state.downloaded ? "arrow.down.circle.fill" : "waveform",
              size: 88,
              tint: .blue
            )
            VStack(alignment: .leading, spacing: 8) {
              Text(episode.episode.title)
                .font(.title2.weight(.semibold))
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
              if model.podcast(for: episode) != nil {
                Button {
                  navigateToRoute(.podcast(episode.episode.podcastId))
                } label: {
                  Label(episode.episode.podcastTitle, systemImage: "podcast")
                    .font(.subheadline)
                    .lineLimit(2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("EpisodeDetailPodcastLink")
              } else {
                Text(episode.episode.podcastTitle)
                  .font(.subheadline)
                  .foregroundStyle(.secondary)
              }
            }
          }

          ExpandableDescription(
            text: episode.episode.description?.strippedHTML.nilIfEmpty ?? "No description.",
            collapsedLineLimit: 3,
            isExpanded: $descriptionExpanded
          )
        }
      }
      Section {
        CompactEpisodeActionRows(
          episode: episode,
          downloadTitle: downloadTitle(for: episode),
          downloadDisabled: model.downloadingEpisodeIds.contains(episode.id),
          clipDisabled: model.publishingClipEpisodeIds.contains(episode.id),
          onPlay: { model.play(episode) },
          onPlayNext: { model.playNext(episode) },
          onQueueEnd: { model.queueEpisode(episode) },
          onInbox: { model.sendEpisodeToInbox(episode) },
          onFavorite: { model.toggleFavorite(episode) },
          onPlayed: { model.markPlayed(episode, played: !episode.state.played) },
          onDownload: { episode.state.downloaded ? model.deleteDownload(episode) : model.downloadEpisode(episode) },
          onClip: { clipComposer = ClipComposerContext(episode: episode, playbackPosition: clipStartPosition(for: episode)) }
        )
      }
      if !episodeClips.isEmpty {
        Section("Clips") {
          ForEach(episodeClips) { clip in
            ClipRow(clip: clip)
          }
        }
      }
      if !episode.episode.chapters.isEmpty {
        Section("Chapters") {
          ForEach(Array(episode.episode.chapters.enumerated()), id: \.element.id) { index, chapter in
            Button {
              model.seekToChapter(chapter, in: episode)
            } label: {
              ChapterRow(
                chapter: chapter,
                active: isActiveChapter(chapter, at: index, in: episode)
              )
            }
            .accessibilityIdentifier("EpisodeChapter_\(chapter.id)")
            .accessibilityAddTraits(isActiveChapter(chapter, at: index, in: episode) ? [.isSelected] : [])
          }
        }
      }
      ServerIntelligenceControls(episode: episode)
      if episode.episode.sourceType == .youtube {
        YouTubeEpisodeControls(episode: episode)
      }
    }
    .navigationTitle("Episode")
    .sheet(item: $clipComposer) { context in
      ClipComposerView(context: context)
        .environmentObject(model)
    }
  }

  private func downloadTitle(for episode: EpisodeWithState) -> String {
    if model.downloadingEpisodeIds.contains(episode.id) {
      return episode.state.downloaded ? "Deleting Download" : "Downloading"
    }
    return episode.state.downloaded ? "Delete Download" : "Download"
  }

  private func clipStartPosition(for episode: EpisodeWithState) -> TimeInterval {
    if model.audio.current?.id == episode.id {
      return max(0, model.audio.position - 15)
    }
    return max(0, episode.state.progressSec - 15)
  }

  private func isActiveChapter(_ chapter: Chapter, at index: Int, in episode: EpisodeWithState) -> Bool {
    guard model.audio.current?.id == episode.id else { return false }
    let nextStart = episode.episode.chapters.indices.contains(index + 1)
      ? episode.episode.chapters[index + 1].startsAt
      : (episode.episode.durationSec ?? .greatestFiniteMagnitude)
    return model.audio.position >= chapter.startsAt && model.audio.position < nextStart
  }
}

struct CompactEpisodeActionRows: View {
  var episode: EpisodeWithState
  var downloadTitle: String
  var downloadDisabled: Bool
  var clipDisabled: Bool
  var onPlay: () -> Void
  var onPlayNext: () -> Void
  var onQueueEnd: () -> Void
  var onInbox: () -> Void
  var onFavorite: () -> Void
  var onPlayed: () -> Void
  var onDownload: () -> Void
  var onClip: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      HStack(spacing: 12) {
        CompactEpisodeActionButton(title: "Play", systemImage: "play.fill", identifier: "EpisodePlayNowButton", action: onPlay)
        CompactEpisodeActionButton(title: "Next", systemImage: "text.line.first.and.arrowtriangle.forward", identifier: "EpisodePlayNextButton", action: onPlayNext)
        CompactEpisodeActionButton(title: "End", systemImage: "text.line.last.and.arrowtriangle.forward", identifier: "EpisodeQueueEndButton", action: onQueueEnd)
        CompactEpisodeActionButton(title: "Inbox", systemImage: "tray.and.arrow.down", identifier: "EpisodeSendInboxButton", action: onInbox)
      }
      HStack(spacing: 12) {
        CompactEpisodeActionButton(
          title: episode.state.favorite ? "Unfavorite" : "Favorite",
          systemImage: episode.state.favorite ? "star.fill" : "star",
          identifier: "EpisodeFavoriteButton",
          action: onFavorite
        )
        CompactEpisodeActionButton(
          title: episode.state.played ? "Unplayed" : "Played",
          systemImage: episode.state.played ? "circle" : "checkmark.circle",
          identifier: "EpisodeMarkPlayedButton",
          action: onPlayed
        )
        CompactEpisodeActionButton(
          title: downloadTitle,
          systemImage: episode.state.downloaded ? "trash" : "arrow.down.circle",
          identifier: "EpisodeDownloadButton",
          disabled: downloadDisabled,
          action: onDownload
        )
        CompactEpisodeActionButton(
          title: clipDisabled ? "Publishing Clip" : "Clip",
          systemImage: "waveform.path.badge.plus",
          identifier: "EpisodeCreateClipButton",
          disabled: clipDisabled,
          action: onClip
        )
      }
    }
    .padding(.vertical, 2)
  }
}

struct CompactEpisodeActionButton: View {
  var title: String
  var systemImage: String
  var identifier: String
  var disabled = false
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 4) {
        Image(systemName: systemImage)
          .font(.title3)
          .frame(width: 34, height: 28)
        Text(title)
          .font(.caption2)
          .lineLimit(1)
          .minimumScaleFactor(0.72)
      }
      .frame(maxWidth: .infinity, minHeight: 48)
      .contentShape(Rectangle())
    }
    .buttonStyle(.borderless)
    .disabled(disabled)
    .accessibilityLabel(title)
    .accessibilityIdentifier(identifier)
  }
}

struct ExpandableDescription: View {
  var text: String
  var collapsedLineLimit: Int
  @Binding var isExpanded: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(text)
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(shouldOfferExpansion && !isExpanded ? collapsedLineLimit : nil)
        .fixedSize(horizontal: false, vertical: true)
      if shouldOfferExpansion {
        Button(isExpanded ? "Show Less" : "Show More") {
          isExpanded.toggle()
        }
        .font(.caption.weight(.semibold))
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
        .accessibilityIdentifier(isExpanded ? "DescriptionShowLessButton" : "DescriptionShowMoreButton")
      }
    }
  }

  private var shouldOfferExpansion: Bool {
    text.count > 180 || text.contains("\n")
  }
}

struct ChapterRow: View {
  var chapter: Chapter
  var active: Bool

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: active ? "largecircle.fill.circle" : "circle")
        .foregroundStyle(active ? .blue : .secondary)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text(chapter.title)
          .font(.body.weight(active ? .semibold : .regular))
          .foregroundStyle(active ? .primary : .secondary)
        Text(chapter.startsAt.clockString)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Spacer()
      Image(systemName: "goforward")
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    }
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(active ? "Current chapter, " : "")\(chapter.title), \(chapter.startsAt.clockString)")
  }
}

struct ServerIntelligenceControls: View {
  @EnvironmentObject private var model: AppModel
  var episode: EpisodeWithState
  @State private var expanded = false

  private var silenceMap: SilenceMap? {
    model.cachedSilenceMap(for: episode)
  }

  private var smartSkipEntry: SmartSkipMapCacheEntry? {
    model.cachedSmartSkipEntry(for: episode)
  }

  private var isProcessing: Bool {
    model.processingIntelligenceEpisodeIds.contains(episode.id)
  }

  var body: some View {
    Section {
      DisclosureGroup(isExpanded: $expanded) {
        Toggle("Smart Skip", isOn: Binding(
          get: { model.settings.smartSkipEnabled },
          set: { value in model.updateSettings { $0.smartSkipEnabled = value } }
        ))
        Toggle("Shorten Silence", isOn: Binding(
          get: { model.settings.silenceShortening },
          set: { value in model.updateSettings {
            $0.silenceShortening = value
          } }
        ))
        CacheStatusRow(
          title: "Shorten Silence",
          status: silenceMap?.status,
          detail: silenceMapDetail,
          systemImage: "waveform.path.ecg"
        )
        .accessibilityIdentifier("SilenceMapStatus")
        HStack {
          Button {
            model.requestSilenceMap(episode)
          } label: {
            Label("Request Map", systemImage: "arrow.down.doc")
          }
          .accessibilityIdentifier("RequestSilenceMapButton")
          Spacer()
          Button {
            model.refreshSilenceMap(episode)
          } label: {
            Label("Check", systemImage: "arrow.clockwise")
          }
          .accessibilityIdentifier("RefreshSilenceMapButton")
        }
        .disabled(isProcessing || !model.silenceMapsAvailable)

        CacheStatusRow(
          title: "Smart Skip",
          status: smartSkipEntry?.status,
          detail: smartSkipDetail,
          systemImage: "sparkles"
        )
        .accessibilityIdentifier("SmartSkipStatus")
        HStack {
          Button {
            model.requestSmartSkip(episode)
          } label: {
            Label("Process", systemImage: "sparkles")
          }
          .accessibilityIdentifier("RequestSmartSkipButton")
          Spacer()
          Button {
            model.fetchSmartSkip(episode)
          } label: {
            Label("Check", systemImage: "arrow.clockwise")
          }
          .accessibilityIdentifier("RefreshSmartSkipButton")
        }
        .disabled(isProcessing || !model.settings.smartSkipEnabled || !model.smartSkipProcessingAvailable)

        if !model.silenceMapsAvailable || !model.smartSkipProcessingAvailable {
          HStack {
            Label(serverCapabilityMessage, systemImage: "exclamationmark.triangle")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          .accessibilityElement(children: .combine)
          .accessibilityIdentifier("ServerIntelligenceCapabilityMessage")
        }
      } label: {
        Label("Server Intelligence", systemImage: "sparkles")
          .accessibilityIdentifier("ServerIntelligenceDisclosure")
      }
    }
  }

  private var silenceMapDetail: String {
    guard let silenceMap else { return "Not cached on this device." }
    if silenceMap.status == .ready {
      return "\(silenceMap.segments.count) silence jumps cached."
    }
    return silenceMap.error ?? "Last checked \(silenceMap.updatedAt.formatted(date: .abbreviated, time: .shortened))."
  }

  private var smartSkipDetail: String {
    guard let smartSkipEntry else { return "No segment map cached on this device." }
    if let map = smartSkipEntry.map, map.isReadyForPlayback {
      return "\(map.segments.count) segments cached."
    }
    return smartSkipEntry.error ?? "Status is \(smartSkipEntry.status.rawValue)."
  }

  private var serverCapabilityMessage: String {
    switch (model.smartSkipProcessingAvailable, model.silenceMapsAvailable) {
    case (false, false):
      return "This server reports Smart Skip and Shorten Silence are disabled."
    case (false, true):
      return "This server reports Smart Skip is disabled."
    case (true, false):
      return "This server reports Shorten Silence is disabled."
    case (true, true):
      return ""
    }
  }
}

struct CacheStatusRow: View {
  var title: String
  var status: ServerCacheStatus?
  var detail: String
  var systemImage: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label(title, systemImage: systemImage)
        .font(.headline)
      HStack {
        Text(statusTitle)
          .font(.caption.weight(.semibold))
          .foregroundStyle(statusColor)
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var statusTitle: String {
    guard let status else { return "Not cached" }
    switch status {
    case .queued:
      return "Queued"
    case .processing:
      return "Processing"
    case .ready:
      return "Ready"
    case .failed:
      return "Failed"
    case .stale:
      return "Stale"
    case .missing:
      return "Missing"
    case .unavailable:
      return "Unavailable"
    }
  }

  private var statusColor: Color {
    switch status {
    case .ready:
      return .green
    case .failed, .unavailable:
      return .red
    case .queued, .processing, .stale:
      return .orange
    case .missing, nil:
      return .secondary
    }
  }
}

struct ClipComposerContext: Identifiable {
  var id: String { episode.id }
  var episode: EpisodeWithState
  var playbackPosition: TimeInterval
}

struct ClipComposerView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  var context: ClipComposerContext
  @State private var title: String
  @State private var note: String = ""
  @State private var startSec: Double
  @State private var endSec: Double

  init(context: ClipComposerContext) {
    self.context = context
    let start = max(0, context.playbackPosition)
    _startSec = State(initialValue: start)
    _endSec = State(initialValue: min(start + 30, context.episode.episode.durationSec ?? start + 30))
    _title = State(initialValue: "\(context.episode.episode.title) clip")
  }

  var body: some View {
    NavigationStack {
      Form {
        Section("Clip") {
          TextField("Title", text: $title)
            .accessibilityIdentifier("ClipTitleInput")
          TextField("Note", text: $note, axis: .vertical)
            .lineLimit(2...4)
            .accessibilityIdentifier("ClipNoteInput")
        }
        Section("Range") {
          Stepper("Start: \(TimeInterval(startSec).clockString)", value: $startSec, in: 0...maxDuration, step: 5)
            .accessibilityIdentifier("ClipStartStepper")
          Stepper("End: \(TimeInterval(endSec).clockString)", value: $endSec, in: 1...maxDuration, step: 5)
            .accessibilityIdentifier("ClipEndStepper")
          Text("\((max(1, endSec - startSec)).formatted(.number.precision(.fractionLength(0)))) seconds")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Section {
          Button {
            model.publishClip(
              episode: context.episode,
              title: title,
              note: note,
              startSec: startSec,
              endSec: max(startSec + 1, endSec)
            )
            dismiss()
          } label: {
            Label(actionTitle, systemImage: model.settings.serverUrl == nil ? "square.and.arrow.down" : "paperplane")
          }
          .accessibilityIdentifier("ClipSaveButton")
          .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.publishingClipEpisodeIds.contains(context.episode.id))
        }
      }
      .navigationTitle("Create Clip")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
      .onChange(of: startSec) { _, value in
        if endSec <= value {
          endSec = min(value + 30, maxDuration)
        }
      }
      .onChange(of: endSec) { _, value in
        if value <= startSec {
          startSec = max(0, value - 1)
        }
      }
    }
  }

  private var maxDuration: Double {
    max(context.episode.episode.durationSec ?? max(endSec, 180), 1)
  }

  private var actionTitle: String {
    model.settings.serverUrl == nil ? "Save Local Clip" : "Publish Clip"
  }
}

struct ClipRow: View {
  var clip: Clip

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Label(clip.title, systemImage: statusIcon)
          .font(.headline)
        Spacer()
        Text("\(clip.startSec.clockString)-\(clip.endSec.clockString)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      if let note = clip.note {
        Text(note)
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      if let publicUrl = clip.publicUrl, let url = URL(string: publicUrl) {
        Link(destination: url) {
          Label("Open Public Link", systemImage: "safari")
        }
      } else {
        Text(statusText)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("ClipRow_\(clip.id)")
  }

  private var statusIcon: String {
    switch clip.renderStatus {
    case .ready, .rendered:
      return "checkmark.circle.fill"
    case .failed:
      return "exclamationmark.triangle"
    case .localOnly:
      return "iphone"
    default:
      return "clock.arrow.circlepath"
    }
  }

  private var statusText: String {
    switch clip.renderStatus {
    case .localOnly:
      return "Saved locally."
    case .failed:
      return clip.renderError ?? "Publishing failed."
    default:
      return "Rendering or publishing is pending."
    }
  }
}

struct YouTubeEpisodeControls: View {
  @EnvironmentObject private var model: AppModel
  var episode: EpisodeWithState

  private var isProcessing: Bool {
    model.youtubeProcessingEpisodeIds.contains(episode.id)
  }

  private var statusText: String {
    switch episode.episode.extractionStatus ?? .none {
    case .none:
      return "Audio has not been prepared on the server."
    case .queued:
      return "Audio preparation is queued."
    case .processing:
      return "The server is preparing audio."
    case .ready:
      return "Audio is ready from the backend media route."
    case .failed:
      return "Audio preparation failed. Try again."
    }
  }

  var body: some View {
    Section("YouTube") {
      Label(statusText, systemImage: statusIcon)
        .accessibilityIdentifier("YouTubeEpisodeStatus")
      if let sourceUrl = episode.episode.youtubeSourceURL, let url = URL(string: sourceUrl) {
        Link(destination: url) {
          Label("Open Source", systemImage: "safari")
        }
        .accessibilityIdentifier("YouTubeOpenSourceButton")
      }
      Button {
        model.enrichYouTubeEpisode(episode)
      } label: {
        Label(isProcessing ? "Updating Metadata" : "Update Metadata", systemImage: "arrow.clockwise")
      }
      .accessibilityIdentifier("YouTubeUpdateMetadataButton")
      .disabled(isProcessing)
      Button {
        model.extractYouTubeEpisode(episode)
      } label: {
        Label(extractTitle, systemImage: "waveform.badge.plus")
      }
      .accessibilityIdentifier("YouTubePrepareAudioButton")
      .disabled(isProcessing || episode.episode.extractionStatus == .ready)
    }
  }

  private var statusIcon: String {
    switch episode.episode.extractionStatus ?? .none {
    case .ready:
      return "checkmark.circle.fill"
    case .failed:
      return "exclamationmark.triangle"
    case .queued, .processing:
      return "clock.arrow.circlepath"
    case .none:
      return "play.rectangle"
    }
  }

  private var extractTitle: String {
    if isProcessing { return "Preparing Audio" }
    if episode.episode.extractionStatus == .failed { return "Retry Audio Preparation" }
    return "Prepare Audio"
  }
}

struct SearchAddView: View {
  @EnvironmentObject private var model: AppModel

  private var trimmedQuery: String {
    model.addPodcastDraft.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var isRSSURL: Bool {
    guard let url = URL(string: trimmedQuery), ["http", "https"].contains(url.scheme?.lowercased()) else { return false }
    return !isYouTubeURL
  }

  private var isYouTubeURL: Bool {
    YouTubeURLClassifier.sourceKind(for: trimmedQuery) != nil
  }

  private var isSearch: Bool {
    !trimmedQuery.isEmpty && !isRSSURL && !isYouTubeURL
  }

  var body: some View {
    List {
      Section("Add Podcast") {
        TextField("RSS URL, PodcastIndex search, or YouTube URL", text: $model.addPodcastDraft)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled(true)
          .keyboardType(.default)
          .accessibilityIdentifier("AddPodcastInput")
        Button {
          if isYouTubeURL {
            model.importYouTubeSource(model.addPodcastDraft)
          } else if isRSSURL {
            model.importFeed(model.addPodcastDraft)
          } else {
            model.searchPodcasts(model.addPodcastDraft)
          }
        } label: {
          Label(primaryActionTitle, systemImage: primaryActionImage)
        }
        .disabled(actionDisabled)
        .accessibilityIdentifier("AddPodcastPrimaryAction")
        .accessibilityHint(primaryActionHint)
      }

      if !model.podcastSearchResults.isEmpty {
        Section("PodcastIndex Results") {
          ForEach(model.podcastSearchResults) { result in
            PodcastDiscoveryRow(result: result, subscribed: model.isSubscribed(feedUrl: result.feedUrl)) {
              model.subscribeToDiscoveredPodcast(result)
            }
          }
        }
      }

      Section("Server Features") {
        if !model.podcastIndexAvailable {
          Label("PodcastIndex search is disabled on this server", systemImage: "magnifyingglass")
        } else {
          Label("PodcastIndex search uses the configured backend", systemImage: "magnifyingglass")
        }
        Label(
          model.youtubeImportAvailable ? "YouTube import uses the existing backend" : "YouTube import is disabled on this server",
          systemImage: "play.rectangle"
        )
        Label(
          serverIntelligenceSummary,
          systemImage: "sparkles"
        )
      }
    }
    .task {
      model.refreshBackendCapabilities()
      model.refreshAppleAccountStatus()
    }
  }

  private var primaryActionTitle: String {
    if model.importingFeed { return "Importing" }
    if model.importingYouTube { return "Importing YouTube" }
    if model.searchingPodcasts { return "Searching" }
    if isSearch && !model.podcastIndexAvailable { return "PodcastIndex Disabled" }
    if isYouTubeURL { return "Import YouTube" }
    return isRSSURL ? "Add RSS Feed" : "Search PodcastIndex"
  }

  private var primaryActionImage: String {
    if isYouTubeURL { return "play.rectangle" }
    return isRSSURL ? "plus.magnifyingglass" : "magnifyingglass"
  }

  private var primaryActionHint: String {
    if isYouTubeURL {
      return model.youtubeImportAvailable ? "Imports the YouTube source through the configured backend." : "This server reports YouTube import is disabled."
    }
    if isRSSURL { return "Adds this RSS feed to the local library." }
    return model.podcastIndexAvailable ? "Searches PodcastIndex through the configured backend." : "This server reports PodcastIndex search is disabled."
  }

  private var actionDisabled: Bool {
    trimmedQuery.isEmpty ||
      model.importingFeed ||
      model.importingYouTube ||
      model.searchingPodcasts ||
      (isYouTubeURL && !model.youtubeImportAvailable) ||
      (isSearch && !model.podcastIndexAvailable)
  }

  private var serverIntelligenceSummary: String {
    switch (model.smartSkipProcessingAvailable, model.silenceMapsAvailable) {
    case (true, true):
      return "Smart Skip and Shorten Silence stay server processed"
    case (false, true):
      return "Shorten Silence is available; Smart Skip is disabled"
    case (true, false):
      return "Smart Skip is available; Shorten Silence is disabled"
    case (false, false):
      return "Smart Skip and Shorten Silence are disabled on this server"
    }
  }
}

struct PodcastDiscoveryRow: View {
  var result: PodcastDiscoveryResult
  var subscribed: Bool
  var onSubscribe: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .top, spacing: 12) {
        ArtworkThumb(remoteURL: result.imageUrl, fallbackSystemImage: "podcast", size: 48, tint: .teal)
        VStack(alignment: .leading, spacing: 4) {
          Text(result.title)
            .font(.headline)
            .lineLimit(2)
          Text(result.author ?? result.feedUrl)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)
          if let description = result.description, !description.isEmpty {
            Text(description)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(2)
          }
        }
      }
      Button {
        onSubscribe()
      } label: {
        Label(subscribed ? "In Library" : "Subscribe", systemImage: subscribed ? "checkmark.circle.fill" : "plus.circle")
      }
      .disabled(subscribed)
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }
}

struct SettingsView: View {
  @EnvironmentObject private var model: AppModel
  @State private var serverUrl = ""
  @State private var importingOPML = false
  @State private var restoringBackup = false
  @State private var exportingOPML = false
  @State private var exportingBackup = false
  @State private var opmlDocument = TextFileDocument()
  @State private var backupDocument = TextFileDocument()

  var body: some View {
    Form {
      Section("Appearance") {
        Picker("Theme", selection: Binding(
          get: { model.settings.theme },
          set: { value in model.updateSettings {
            $0.theme = value
            $0.themeSchemaVersion = AppTheme.currentSchemaVersion
          } }
        )) {
          ForEach(AppTheme.allCases) { theme in
            Text(theme.title).tag(theme)
          }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("ThemePicker")
      }
      Section("Playback") {
        Stepper("Skip forward: \(model.settings.skipForwardSec)s", value: Binding(
          get: { model.settings.skipForwardSec },
          set: { value in model.updateSettings { $0.skipForwardSec = value } }
        ), in: 10...60, step: 5)
        Stepper("Skip back: \(model.settings.skipBackSec)s", value: Binding(
          get: { model.settings.skipBackSec },
          set: { value in model.updateSettings { $0.skipBackSec = value } }
        ), in: 5...60, step: 5)
        Stepper("Resume rewind: \(model.settings.resumeRewindSec)s", value: Binding(
          get: { model.settings.resumeRewindSec },
          set: { value in model.updateSettings { $0.resumeRewindSec = value } }
        ), in: 0...30, step: 1)
        Stepper("Playback speed: \(model.settings.playbackRate, specifier: "%.2fx")", value: Binding(
          get: { model.settings.playbackRate },
          set: { value in model.updateSettings { $0.playbackRate = value } }
        ), in: 0.75...2.0, step: 0.05)
        Toggle("Auto play next", isOn: Binding(
          get: { model.settings.autoPlayNext },
          set: { value in model.updateSettings { $0.autoPlayNext = value } }
        ))
        Toggle("Native audio preferred", isOn: Binding(
          get: { model.settings.nativeAudioPreferred },
          set: { value in model.updateSettings { $0.nativeAudioPreferred = value } }
        ))
      }
      Section("Downloads") {
        Toggle("Auto-download Queue", isOn: Binding(
          get: { model.settings.autoDownload },
          set: { value in model.updateSettings { $0.autoDownload = value } }
        ))
        Toggle("Auto-download Inbox", isOn: Binding(
          get: { model.settings.autoDownloadInbox },
          set: { value in model.updateSettings { $0.autoDownloadInbox = value } }
        ))
        Toggle("Delete after listen", isOn: Binding(
          get: { model.settings.autoDeleteAfterListen },
          set: { value in model.updateSettings { $0.autoDeleteAfterListen = value } }
        ))
        Toggle("Wi-Fi only downloads", isOn: Binding(
          get: { model.settings.downloadOnlyWifi },
          set: { value in model.updateSettings { $0.downloadOnlyWifi = value } }
        ))
        Stepper("Storage cap: \(model.settings.storageCapMb) MB", value: Binding(
          get: { model.settings.storageCapMb },
          set: { value in model.updateSettings { $0.storageCapMb = value } }
        ), in: 256...65536, step: 256)
        Picker("Inbox order", selection: Binding(
          get: { model.settings.inboxSortDirection },
          set: { value in model.updateSettings { $0.inboxSortDirection = value } }
        )) {
          Text("Newest first").tag(SortDirection.newest)
          Text("Oldest first").tag(SortDirection.oldest)
        }
        Stepper("Refresh feeds every \(model.settings.refreshIntervalMinutes / 60)h", value: Binding(
          get: { model.settings.refreshIntervalMinutes },
          set: { value in model.updateSettings { $0.refreshIntervalMinutes = value } }
        ), in: 60...2880, step: 60)
        .accessibilityIdentifier("FeedRefreshIntervalStepper")
      }
      Section("Profile Stats") {
        LabeledContent("Time listened", value: model.listeningStats.listeningSec.statDurationString)
          .accessibilityIdentifier("StatsTimeListened")
        LabeledContent("Podcast time heard", value: model.listeningStats.contentSec.statDurationString)
          .accessibilityIdentifier("StatsPodcastTime")
        LabeledContent("Saved by speed", value: model.listeningStats.speedSavedSec.statDurationString)
          .accessibilityIdentifier("StatsSpeedSaved")
        LabeledContent("Saved by silence", value: model.listeningStats.silenceSavedSec.statDurationString)
          .accessibilityIdentifier("StatsSilenceSaved")
        if model.topListeningPodcasts.isEmpty {
          Text("Listening stats start recording while playback is active.")
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("StatsEmptyMessage")
        } else {
          ForEach(model.topListeningPodcasts.prefix(3), id: \.podcastId) { podcast in
            VStack(alignment: .leading, spacing: 4) {
              Text(podcast.podcastTitle)
                .font(.subheadline.weight(.semibold))
              Text("\(podcast.listeningSec.statDurationString) listened · \((podcast.speedSavedSec + podcast.silenceSavedSec).statDurationString) saved")
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("StatsPodcast_\(podcast.podcastId)")
          }
        }
      }
      Section("Server Intelligence") {
        Toggle("Smart Skip", isOn: Binding(
          get: { model.settings.smartSkipEnabled },
          set: { value in model.updateSettings { $0.smartSkipEnabled = value } }
        ))
        Toggle("Skip sponsors and ads", isOn: Binding(
          get: { model.settings.smartSkipCommercials },
          set: { value in model.updateSettings { $0.smartSkipCommercials = value } }
        ))
        Toggle("Skip self-promo", isOn: Binding(
          get: { model.settings.smartSkipSelfPromo },
          set: { value in model.updateSettings { $0.smartSkipSelfPromo = value } }
        ))
        Toggle("Skip intros", isOn: Binding(
          get: { model.settings.smartSkipIntros },
          set: { value in model.updateSettings { $0.smartSkipIntros = value } }
        ))
        Toggle("Skip outros", isOn: Binding(
          get: { model.settings.smartSkipOutros },
          set: { value in model.updateSettings { $0.smartSkipOutros = value } }
        ))
        Toggle("Include soft matches", isOn: Binding(
          get: { model.settings.smartSkipIncludeSoftMatches },
          set: { value in model.updateSettings { $0.smartSkipIncludeSoftMatches = value } }
        ))
        Toggle("Shorten Silence", isOn: Binding(
          get: { model.settings.silenceShortening },
          set: { value in model.updateSettings {
            $0.silenceShortening = value
          } }
        ))
      }
      Section("Backend") {
        TextField("Optional backend URL", text: $serverUrl)
          .textInputAutocapitalization(.never)
          .keyboardType(.URL)
          .onAppear { serverUrl = model.settings.serverUrl ?? "" }
          .accessibilityIdentifier("ServerURLInput")
        Text(model.settings.serverUrl == nil ? "No backend configured. Playback, subscriptions, queueing, triage, and settings stay local." : "Backend: \(model.settings.serverUrl ?? "")")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .accessibilityIdentifier("ServerURLStatus")
        Button {
          model.saveServerUrl(serverUrl)
        } label: {
          Label("Save Server URL", systemImage: "square.and.arrow.down")
        }
          .accessibilityIdentifier("SaveServerURLButton")
        Button {
          model.testServer()
        } label: {
          Label("Test Server", systemImage: "waveform.path.ecg")
        }
          .accessibilityIdentifier("TestServerButton")
        LabeledContent {
          Text(model.backendAccountStatusText)
            .accessibilityIdentifier("BackendAccountStatusValue")
        } label: {
          Label("Backend account", systemImage: model.backendSession == nil ? "person.crop.circle.badge.questionmark" : "person.crop.circle.badge.checkmark")
        }
        if model.backendSession == nil {
          if model.settings.serverUrl == nil {
            Button {
              model.status = "Set and save a server URL before signing in with Apple."
            } label: {
              Label("Sign in with Apple needs a server URL", systemImage: "apple.logo")
            }
            .accessibilityIdentifier("SignInWithAppleNeedsServerButton")
          } else {
            SignInWithAppleButton(.signIn) { request in
              request.requestedScopes = [.email]
            } onCompletion: { result in
              switch result {
              case .success(let authorization):
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential
                model.signInWithApple(identityToken: credential?.identityToken)
              case .failure(let error):
                model.status = "Apple sign-in failed: \(error.localizedDescription)"
              }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 44)
            .disabled(model.signingInWithApple)
            .accessibilityIdentifier("SignInWithAppleButton")
          }
        } else {
          Button(role: .destructive) {
            model.signOutBackend()
          } label: {
            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
          }
          .accessibilityIdentifier("BackendSignOutButton")
        }
      }
      Section {
        LabeledContent {
          Text(model.appleAccountStatusText)
            .accessibilityIdentifier("AppleAccountStatusValue")
        } label: {
          Label("iCloud", systemImage: model.appleAccountAvailable ? "icloud.circle.fill" : "icloud.slash")
        }
        Button(model.syncing ? "Preparing" : "Prepare iCloud Sync") { model.syncNow() }
          .disabled(model.syncing)
          .accessibilityIdentifier("SyncNowButton")
        LabeledContent {
          Text("\(model.syncDiagnostics.pendingActionCount)")
            .accessibilityIdentifier("SyncPendingActionsValue")
        } label: {
          Label("Pending local changes", systemImage: "tray.and.arrow.up")
        }
        LabeledContent {
          Text("\(model.syncDiagnostics.retainedSyncedActionCount)")
            .accessibilityIdentifier("SyncRetainedActionsValue")
        } label: {
          Label("Prepared changes", systemImage: "checkmark.circle")
        }
        LabeledContent {
          Text("\(model.syncDiagnostics.subscriptionCount) shows, \(model.syncDiagnostics.episodeCount) episodes")
            .accessibilityIdentifier("SyncLocalSnapshotValue")
        } label: {
          Label("Local library", systemImage: "externaldrive")
        }
        if model.syncDiagnostics.tombstoneCount > 0 {
          LabeledContent {
            Text("\(model.syncDiagnostics.tombstoneCount)")
              .accessibilityIdentifier("SyncTombstonesValue")
          } label: {
            Label("Retained tombstones", systemImage: "archivebox")
          }
        }
        if let revision = model.settings.lastSyncRevision {
          Text("Revision cursor: \(revision)")
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("SyncRevisionCursor")
        }
        if let lastSyncAt = model.settings.lastSyncAt {
          Text("Last sync: \(lastSyncAt.formatted(date: .abbreviated, time: .shortened))")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      } header: {
        Text("iCloud")
      } footer: {
        Text("DaisyPod works locally without iCloud. iCloud sync needs the device signed into iCloud and a build signed with the DaisyPod CloudKit container.")
      }
      Section("Local-first") {
        Label("Downloads and playback work without an account", systemImage: "iphone")
        Label("Native file paths never sync", systemImage: "lock")
        Label("Server processing is optional", systemImage: "sparkles")
      }
      Section("Import and Export") {
        Button {
          importingOPML = true
        } label: {
          Label(model.importingPortableData ? "Importing OPML" : "Import OPML", systemImage: "square.and.arrow.down")
        }
        .disabled(model.importingPortableData)
        .accessibilityIdentifier("ImportOPMLButton")
        Button {
          if let document = model.opmlExportDocument() {
            opmlDocument = document
            exportingOPML = true
          }
        } label: {
          Label("Export OPML", systemImage: "square.and.arrow.up")
        }
        .accessibilityIdentifier("ExportOPMLButton")
        Button {
          restoringBackup = true
        } label: {
          Label(model.importingPortableData ? "Restoring Backup" : "Restore JSON Backup", systemImage: "externaldrive.badge.plus")
        }
        .disabled(model.importingPortableData)
        .accessibilityIdentifier("RestoreBackupButton")
        Button {
          if let document = model.backupExportDocument() {
            backupDocument = document
            exportingBackup = true
          }
        } label: {
          Label("Export JSON Backup", systemImage: "doc.badge.arrow.up")
        }
        .accessibilityIdentifier("ExportBackupButton")
      }
    }
    .themedContentSurface()
    .fileImporter(isPresented: $importingOPML, allowedContentTypes: [.xml, .opmlDocument, .plainText]) { result in
      if case let .success(url) = result {
        model.importOPML(from: url)
      }
    }
    .fileImporter(isPresented: $restoringBackup, allowedContentTypes: [.json, .daisyPodBackup, .plainText]) { result in
      if case let .success(url) = result {
        model.restoreBackup(from: url)
      }
    }
    .fileExporter(isPresented: $exportingOPML, document: opmlDocument, contentType: .opmlDocument, defaultFilename: "daisypod-subscriptions.opml") { result in
      if case .failure = result { model.status = "Could not write OPML." }
    }
    .fileExporter(isPresented: $exportingBackup, document: backupDocument, contentType: .json, defaultFilename: "daisypod-backup.json") { result in
      if case .failure = result { model.status = "Could not write backup." }
    }
  }
}

struct PlayerBar: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.navigateToRoute) private var navigateToRoute
  @Environment(\.appThemeStyle) private var theme
  @ObservedObject var audio: NativeAudioEngine
  @State private var playerSheet: PlayerSheet?

  var body: some View {
    if let current = audio.current {
      VStack(spacing: 10) {
        Capsule()
          .fill(.secondary.opacity(0.35))
          .frame(width: 38, height: 5)
          .accessibilityHidden(true)

        HStack(spacing: 12) {
          ArtworkThumb(
            remoteURL: current.episode.imageUrl ?? model.podcast(for: current)?.imageUrl,
            cachedURL: model.cachedArtworkURL(for: current),
            fallbackSystemImage: current.state.downloaded ? "arrow.down.circle.fill" : "waveform",
            size: 58,
            tint: current.state.downloaded ? .green : theme.artworkTint
          )

          Button {
            openPlayer()
          } label: {
            VStack(alignment: .leading, spacing: 5) {
              Text(current.episode.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
              Text(current.episode.podcastTitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
              VStack(spacing: 3) {
                ProgressView(value: audio.position, total: playerDuration(for: current))
                  .accessibilityIdentifier("MiniPlayerProgress")
                HStack {
                  Text(audio.position.clockString)
                  Spacer()
                  Text(playerDuration(for: current).clockString)
                }
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Open player")
          .accessibilityIdentifier("OpenPlayer")

          VStack(spacing: 8) {
            HStack(spacing: 12) {
              Button { audio.skip(by: TimeInterval(-model.settings.skipBackSec)) } label: {
                Image(systemName: "gobackward.\(model.settings.skipBackSec)")
              }
              .accessibilityLabel("Skip back \(model.settings.skipBackSec) seconds")

              Button { model.togglePlayPause() } label: {
                Image(systemName: audio.isPlaying ? "pause.fill" : "play.fill")
                  .font(.title3)
                  .frame(width: 32, height: 32)
              }
              .buttonStyle(.borderedProminent)
              .tint(theme.isVaporwave ? theme.secondaryTint : theme.tint)
              .accessibilityLabel(audio.isPlaying ? "Pause" : "Play")

              Button { audio.skip(by: TimeInterval(model.settings.skipForwardSec)) } label: {
                Image(systemName: "goforward.\(model.settings.skipForwardSec)")
              }
              .accessibilityLabel("Skip forward \(model.settings.skipForwardSec) seconds")
            }
            Button {
              openPlayer()
            } label: {
              Label("Queue", systemImage: "text.line.first.and.arrowtriangle.forward")
                .labelStyle(.iconOnly)
            }
            .accessibilityLabel("Open queue")
          }
        }
        if let remaining = model.sleepTimerRemainingMinutes() {
          let sleepTimerText = "Sleep timer: \(remaining)m"
          HStack(spacing: 4) {
            Image(systemName: "timer")
            Text(sleepTimerText)
          }
          .font(.caption2)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .padding(.horizontal, 12)
      .padding(.top, 8)
      .padding(.bottom, 10)
      .modifier(PlayerBarChrome(theme: theme))
      .contentShape(Rectangle())
      .gesture(
        DragGesture(minimumDistance: 18)
          .onEnded { value in
            if value.translation.height < -36 {
              openPlayer()
            }
          }
      )
      .sheet(item: $playerSheet) { _ in
        ExpandedPlayerSheet(audio: audio)
          .environmentObject(model)
          .environment(\.navigateToRoute, navigateToRoute)
          .presentationDetents([.large])
          .presentationDragIndicator(.visible)
      }
    }
  }

  private func openPlayer() {
    playerSheet = .expanded
  }

  private func playerDuration(for episode: EpisodeWithState) -> TimeInterval {
    max(audio.duration, episode.episode.durationSec ?? 1, 1)
  }

  private var sleepTimerAccessibilityLabel: String {
    guard let remaining = model.sleepTimerRemainingMinutes() else { return "Sleep timer" }
    return "Sleep timer, \(remaining) minutes remaining"
  }
}

private struct PlayerBarChrome: ViewModifier {
  var theme: AppThemeStyle

  private var cornerRadius: CGFloat {
    theme.isVaporwave ? 6 : 14
  }

  func body(content: Content) -> some View {
    content
      .background {
        RoundedRectangle(cornerRadius: cornerRadius)
          .fill(theme.elevatedSurface.opacity(theme.isVaporwave ? 0.9 : 0.72))
          .overlay {
            if theme.isVaporwave {
              LinearGradient(
                colors: [theme.tint.opacity(0.20), theme.secondaryTint.opacity(0.17), .clear],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
              )
              .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            }
          }
      }
      .overlay {
        RoundedRectangle(cornerRadius: cornerRadius)
          .stroke(theme.isVaporwave ? theme.tint.opacity(0.78) : Color(.separator).opacity(theme.separatorOpacity), lineWidth: theme.isVaporwave ? 1.2 : 0.5)
      }
      .shadow(color: theme.isVaporwave ? theme.tint.opacity(0.28) : theme.shadow, radius: theme.isVaporwave ? 22 : 10, y: 4)
      .shadow(color: theme.isVaporwave ? theme.secondaryTint.opacity(0.20) : .clear, radius: 32, y: 0)
  }
}

enum PlayerSheet: Identifiable {
  case expanded

  var id: String { "expanded-player" }
}

struct ExpandedPlayerSheet: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.navigateToRoute) private var navigateToRoute
  @ObservedObject var audio: NativeAudioEngine
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        if let current = audio.current {
          Section {
            VStack(alignment: .leading, spacing: 16) {
              VStack(alignment: .leading, spacing: 12) {
                ArtworkThumb(
                  remoteURL: current.episode.imageUrl ?? model.podcast(for: current)?.imageUrl,
                  cachedURL: model.cachedArtworkURL(for: current),
                  fallbackSystemImage: current.state.downloaded ? "arrow.down.circle.fill" : "waveform",
                  size: 128,
                  tint: .blue
                )
                .frame(maxWidth: .infinity, alignment: .center)

                Button {
                  dismiss()
                  navigateToRoute(.episode(current.id))
                } label: {
                  Text(current.episode.title)
                    .font(.title3.weight(.semibold))
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("NowPlayingEpisodeLink")
                .buttonStyle(.plain)

                if model.podcast(for: current) != nil {
                  Button {
                    dismiss()
                    navigateToRoute(.podcast(current.episode.podcastId))
                  } label: {
                    Text(current.episode.podcastTitle)
                      .font(.subheadline)
                      .foregroundStyle(.secondary)
                      .lineLimit(2)
                      .fixedSize(horizontal: false, vertical: true)
                  }
                  .accessibilityIdentifier("NowPlayingPodcastLink")
                  .buttonStyle(.plain)
                } else {
                  Text(current.episode.podcastTitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                }
              }
              ProgressView(value: audio.position, total: max(audio.duration, current.episode.durationSec ?? 1))
              HStack {
                Text(audio.position.clockString)
                Spacer()
                Text((max(audio.duration, current.episode.durationSec ?? 0)).clockString)
              }
              .font(.caption)
              .foregroundStyle(.secondary)
              HStack(spacing: 18) {
                Button { model.audio.skip(by: TimeInterval(-model.settings.skipBackSec)) } label: {
                  Image(systemName: "gobackward.\(model.settings.skipBackSec)")
                    .font(.title2)
                }
                .accessibilityLabel("Skip back \(model.settings.skipBackSec) seconds")
                Button { model.togglePlayPause() } label: {
                  Image(systemName: audio.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title)
                    .frame(width: 54, height: 44)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityLabel(audio.isPlaying ? "Pause" : "Play")
                Button { model.audio.skip(by: TimeInterval(model.settings.skipForwardSec)) } label: {
                  Image(systemName: "goforward.\(model.settings.skipForwardSec)")
                    .font(.title2)
                }
                .accessibilityLabel("Skip forward \(model.settings.skipForwardSec) seconds")
                Button { model.toggleFavorite(current) } label: {
                  Image(systemName: current.state.favorite ? "star.fill" : "star")
                    .font(.title2)
                    .frame(width: 44, height: 44)
                }
                .foregroundStyle(current.state.favorite ? .yellow : .primary)
                .accessibilityLabel(current.state.favorite ? "Remove Favorite" : "Favorite")
                .accessibilityIdentifier("ExpandedPlayerFavoriteButton")
                .buttonStyle(.borderless)
                SleepTimerMenu(iconOnly: true)
                  .buttonStyle(.borderless)
              }
              .frame(maxWidth: .infinity)
              .buttonStyle(.borderless)
            }
            .padding(.vertical, 8)
            .buttonStyle(.borderless)
          }
          Section("Queue") {
            if model.queue.isEmpty {
              ContentUnavailableView("Queue is empty", systemImage: "text.line.first.and.arrowtriangle.forward")
            } else {
              ForEach(model.queue) { episode in
                QueueSheetRow(episode: episode)
              }
              .onMove { source, destination in
                model.moveQueueEpisodes(from: source, to: destination)
              }
            }
          }
        } else {
          ContentUnavailableView("Nothing playing", systemImage: "waveform")
        }
      }
      .navigationTitle("Now Playing")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button("Done") { dismiss() }
        }
        ToolbarItem(placement: .topBarTrailing) {
          EditButton()
            .disabled(model.queue.isEmpty)
        }
      }
    }
  }
}

struct QueueSheetRow: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.navigateToRoute) private var navigateToRoute
  @Environment(\.dismiss) private var dismiss
  var episode: EpisodeWithState

  var body: some View {
    HStack(spacing: 12) {
      ArtworkThumb(
        remoteURL: episode.episode.imageUrl ?? model.podcast(for: episode)?.imageUrl,
        cachedURL: model.cachedArtworkURL(for: episode),
        fallbackSystemImage: episode.id == model.audio.current?.id ? "waveform.circle.fill" : "waveform",
        size: 44,
        tint: episode.id == model.audio.current?.id ? .green : .blue
      )
      if episode.state.played {
        PlayedBadge()
      }
      VStack(alignment: .leading, spacing: 3) {
        Button {
          dismiss()
          navigateToRoute(.episode(episode.id))
        } label: {
          Text(episode.episode.title)
            .font(.subheadline.weight(.semibold))
            .lineLimit(2)
        }
        .buttonStyle(.plain)
        if model.podcast(for: episode) != nil {
          Button {
            dismiss()
            navigateToRoute(.podcast(episode.episode.podcastId))
          } label: {
            Text(episode.episode.podcastTitle)
              .font(.caption)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
          .buttonStyle(.plain)
        } else {
          Text(episode.episode.podcastTitle)
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
      }
      Spacer()
      Button {
        if episode.id == model.audio.current?.id {
          model.togglePlayPause()
        } else {
          model.play(episode)
        }
      } label: {
        Image(systemName: episode.id == model.audio.current?.id && model.audio.isPlaying ? "pause.fill" : "play.fill")
      }
      .accessibilityLabel(episode.id == model.audio.current?.id && model.audio.isPlaying ? "Pause" : "Play \(episode.episode.title)")
      Menu {
        Button {
          model.sendQueueEpisodeToInbox(episode)
        } label: {
          Label("Send to Inbox", systemImage: "tray.and.arrow.down")
        }
        Button {
          model.markPlayed(episode, played: !episode.state.played)
        } label: {
          Label(episode.state.played ? "Mark Unplayed" : "Mark Played", systemImage: episode.state.played ? "circle" : "checkmark.circle")
        }
        Button {
          model.toggleFavorite(episode)
        } label: {
          Label(episode.state.favorite ? "Remove Favorite" : "Favorite", systemImage: episode.state.favorite ? "star.slash" : "star")
        }
        Button(role: .destructive) {
          model.removeQueueEpisode(episode)
        } label: {
          Label("Remove from Queue", systemImage: "minus.circle")
        }
      } label: {
        Image(systemName: "ellipsis.circle")
      }
      .accessibilityLabel("Queue actions for \(episode.episode.title)")
    }
  }
}

struct SleepTimerMenu: View {
  @EnvironmentObject private var model: AppModel
  var iconOnly = false

  var body: some View {
    Menu {
      Button { model.setSleepTimer(minutes: 15) } label: {
        Label("15 minutes", systemImage: "timer")
      }
      Button { model.setSleepTimer(minutes: 30) } label: {
        Label("30 minutes", systemImage: "timer")
      }
      Button { model.setSleepTimer(minutes: 45) } label: {
        Label("45 minutes", systemImage: "timer")
      }
      Button { model.setSleepTimer(minutes: 60) } label: {
        Label("60 minutes", systemImage: "timer")
      }
      if model.sleepTimerEndsAt != nil {
        Divider()
        Button(role: .destructive) {
          model.cancelSleepTimer()
        } label: {
          Label("Cancel timer", systemImage: "xmark.circle")
        }
      }
    } label: {
      if iconOnly {
        Label(model.sleepTimerEndsAt == nil ? "Set Sleep Timer" : "Change Sleep Timer", systemImage: model.sleepTimerEndsAt == nil ? "timer" : "timer.circle.fill")
          .labelStyle(.iconOnly)
          .font(.title2)
          .frame(width: 44, height: 44)
      } else {
        Label(model.sleepTimerEndsAt == nil ? "Set Sleep Timer" : "Change Sleep Timer", systemImage: model.sleepTimerEndsAt == nil ? "timer" : "timer.circle.fill")
      }
    }
    .accessibilityLabel(sleepTimerAccessibilityLabel)
    .accessibilityIdentifier("SleepTimerMenu")
  }

  private var sleepTimerAccessibilityLabel: String {
    guard let remaining = model.sleepTimerRemainingMinutes() else { return "Sleep timer" }
    return "Sleep timer, \(remaining) minutes remaining"
  }
}

struct ArtworkThumb: View {
  var remoteURL: String?
  var cachedURL: URL?
  var fallbackSystemImage: String
  var size: CGFloat
  var tint: Color

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 8)
        .fill(tint.gradient)
      if let cachedURL, let image = UIImage(contentsOfFile: cachedURL.path) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else if let assetName = assetName(from: remoteURL), let image = UIImage(named: assetName) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else if let remoteURL, let url = URL(string: remoteURL) {
        AsyncImage(url: url) { phase in
          switch phase {
          case .success(let image):
            image
              .resizable()
              .scaledToFill()
          default:
            fallback
          }
        }
      } else {
        fallback
      }
    }
    .frame(width: size, height: size)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .accessibilityHidden(true)
  }

  private var fallback: some View {
    Image(systemName: fallbackSystemImage)
      .font(.system(size: size * 0.42, weight: .semibold))
      .foregroundStyle(.white)
  }

  private func assetName(from value: String?) -> String? {
    guard let value, value.hasPrefix("asset://") else { return nil }
    return String(value.dropFirst("asset://".count)).nilIfEmpty
  }
}

#Preview {
  let repo = try! PodcastRepository.inMemoryForTests()
  let model = AppModel(repository: repo)
  RootView()
    .environmentObject(model)
    .task { model.start() }
}
