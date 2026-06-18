import Foundation
import Security

struct BackendSession: Codable, Hashable {
  struct Account: Codable, Hashable {
    var id: String
    var email: String?
  }

  var accessToken: String
  var account: Account
  var createdAt: Date?
}

enum BackendSessionStore {
  private static let service = "com.elephanthand.daisypod.backend-session"
  private static let account = "apple"

  static func load() -> BackendSession? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data
    else {
      return nil
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try? decoder.decode(BackendSession.self, from: data)
  }

  static func save(_ session: BackendSession) throws {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    let data = try encoder.encode(session)
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ]
    let status = SecItemUpdate(baseQuery() as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      var query = baseQuery()
      query[kSecValueData as String] = data
      query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let addStatus = SecItemAdd(query as CFDictionary, nil)
      guard addStatus == errSecSuccess else { throw KeychainError(status: addStatus) }
    } else if status != errSecSuccess {
      throw KeychainError(status: status)
    }
  }

  static func clear() {
    SecItemDelete(baseQuery() as CFDictionary)
  }

  static var accessToken: String? {
    load()?.accessToken
  }

  private static func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
  }
}

struct KeychainError: Error {
  var status: OSStatus
}
