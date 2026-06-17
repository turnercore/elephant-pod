import BackgroundTasks
import Foundation

@MainActor
protocol BackgroundDownloadScheduling: AnyObject {
  func registerDownloadMaintenance(handler: @escaping @MainActor () async -> Bool)
  func scheduleDownloadMaintenance(settings: AppSettings, hasDownloadWork: Bool)
}

@MainActor
final class NoopBackgroundDownloadScheduler: BackgroundDownloadScheduling {
  func registerDownloadMaintenance(handler: @escaping @MainActor () async -> Bool) {}
  func scheduleDownloadMaintenance(settings: AppSettings, hasDownloadWork: Bool) {}
}

@MainActor
final class NativeBackgroundDownloadScheduler: BackgroundDownloadScheduling {
  static let refreshIdentifier = "com.elephanthand.daisypod.download-refresh"
  static let processingIdentifier = "com.elephanthand.daisypod.download-processing"

  private var registered = false

  func registerDownloadMaintenance(handler: @escaping @MainActor () async -> Bool) {
    guard !registered else { return }
    registered = true

    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshIdentifier, using: nil) { task in
      Self.handle(task, handler: handler)
    }
    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processingIdentifier, using: nil) { task in
      Self.handle(task, handler: handler)
    }
  }

  func scheduleDownloadMaintenance(settings: AppSettings, hasDownloadWork: Bool) {
    guard registered else { return }
    scheduleAppRefresh(hasDownloadWork: hasDownloadWork)
    if hasDownloadWork {
      scheduleProcessing(settings: settings)
    } else {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingIdentifier)
    }
  }

  private static func handle(_ task: BGTask, handler: @escaping @MainActor () async -> Bool) {
    let operation = Task { @MainActor in
      let success = await handler()
      task.setTaskCompleted(success: success)
    }
    task.expirationHandler = {
      operation.cancel()
    }
  }

  private func scheduleAppRefresh(hasDownloadWork: Bool) {
    let request = BGAppRefreshTaskRequest(identifier: Self.refreshIdentifier)
    request.earliestBeginDate = Date().addingTimeInterval(hasDownloadWork ? 15 * 60 : 60 * 60)
    submit(request)
  }

  private func scheduleProcessing(settings: AppSettings) {
    let request = BGProcessingTaskRequest(identifier: Self.processingIdentifier)
    request.requiresNetworkConnectivity = true
    request.requiresExternalPower = false
    request.earliestBeginDate = Date().addingTimeInterval(settings.downloadOnlyWifi ? 30 * 60 : 15 * 60)
    submit(request)
  }

  private func submit(_ request: BGTaskRequest) {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: request.identifier)
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      // The system can reject scheduling in Simulator, Low Power Mode, or managed profiles.
      // Foreground maintenance remains the source of truth.
    }
  }
}
