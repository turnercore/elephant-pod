import Foundation

enum AppIntentHandoffAction: String, Codable {
  case openSection
  case addPodcast
  case togglePlayback
  case syncNow
}

struct AppIntentHandoffPayload: Codable, Equatable {
  var action: AppIntentHandoffAction
  var section: SectionKey?
  var value: String?
  var createdAt: Date = Date()
}

enum AppIntentHandoff {
  private static let key = "DaisyPod.PendingAppIntentHandoff"

  static func store(_ payload: AppIntentHandoffPayload, defaults: UserDefaults = .standard) {
    if let data = try? JSONEncoder().encode(payload) {
      defaults.set(data, forKey: key)
    }
  }

  static func consume(defaults: UserDefaults = .standard) -> AppIntentHandoffPayload? {
    guard let data = defaults.data(forKey: key) else { return nil }
    defaults.removeObject(forKey: key)
    return try? JSONDecoder().decode(AppIntentHandoffPayload.self, from: data)
  }
}
