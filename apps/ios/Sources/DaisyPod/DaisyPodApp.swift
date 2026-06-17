import SwiftUI

@main
struct DaisyPodApp: App {
  @StateObject private var model: AppModel
  @Environment(\.scenePhase) private var scenePhase

  init() {
    let repository = (try? PodcastRepository.live()) ?? (try! PodcastRepository.inMemoryForTests())
    _model = StateObject(wrappedValue: AppModel(repository: repository, backgroundDownloadScheduler: NativeBackgroundDownloadScheduler()))
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(model)
        .task { model.start() }
        .onOpenURL { model.handleOpenURL($0) }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active {
            model.appBecameActive()
          }
        }
    }
  }
}
