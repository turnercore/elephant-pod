import CloudKit
import Foundation

enum AppleAccountState: String, Codable, Equatable {
  case checking
  case available
  case noAccount
  case restricted
  case couldNotDetermine
  case temporarilyUnavailable
}

struct AppleAccountStatusProviding {
  var accountStatus: @MainActor () async -> AppleAccountState

  static let live = AppleAccountStatusProviding {
    let container = CKContainer(identifier: DaisyPodCloudKit.containerIdentifier)
    return await withCheckedContinuation { (continuation: CheckedContinuation<AppleAccountState, Never>) in
      container.accountStatus { status, error in
        if error != nil {
          continuation.resume(returning: .temporarilyUnavailable)
          return
        }
        switch status {
        case .available:
          continuation.resume(returning: .available)
        case .noAccount:
          continuation.resume(returning: .noAccount)
        case .restricted:
          continuation.resume(returning: .restricted)
        case .couldNotDetermine:
          continuation.resume(returning: .couldNotDetermine)
        case .temporarilyUnavailable:
          continuation.resume(returning: .temporarilyUnavailable)
        @unknown default:
          continuation.resume(returning: .couldNotDetermine)
        }
      }
    }
  }
}

enum DaisyPodCloudKit {
  static let containerIdentifier = "iCloud.com.elephanthand.daisypod"
}
