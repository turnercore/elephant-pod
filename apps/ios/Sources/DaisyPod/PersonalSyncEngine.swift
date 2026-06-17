import Foundation

enum PersonalSyncError: Error, Equatable {
}

struct PersonalSyncResult: Equatable {
  var pageCount: Int
  var message: String
}

protocol PersonalSyncing {
  @MainActor
  func sync(protectedPlaybackEpisodeId: String?) async throws -> PersonalSyncResult
}
