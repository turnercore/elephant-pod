import CloudKit
import Foundation

enum CloudKitPersonalRecordType: String, Codable, CaseIterable {
  case podcast = "Podcast"
  case episode = "Episode"
  case episodeState = "EpisodeState"
  case podcastPreference = "PodcastPreference"
  case clip = "Clip"
  case silenceMap = "SilenceMap"
  case smartSkipMap = "SmartSkipMap"
  case tombstone = "Tombstone"
  case syncAction = "SyncAction"
  case settings = "Settings"
}

struct CloudKitPersonalRecordPayload: Codable, Equatable {
  var recordType: CloudKitPersonalRecordType
  var recordName: String
  var modifiedAt: Date
  var encodedJSON: Data

  func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(T.self, from: encodedJSON)
  }
}

struct CloudKitPersonalSyncSnapshot: Equatable {
  var exportedAt: Date
  var records: [CloudKitPersonalRecordPayload]

  var recordCount: Int { records.count }

  func records(ofType type: CloudKitPersonalRecordType) -> [CloudKitPersonalRecordPayload] {
    records.filter { $0.recordType == type }
  }
}

protocol CloudKitPersonalSyncStoring {
  @MainActor
  func upload(_ snapshot: CloudKitPersonalSyncSnapshot) async throws -> CloudKitPersonalSyncResult

  @MainActor
  func downloadSnapshot() async throws -> CloudKitPersonalSyncSnapshot?
}

extension CloudKitPersonalSyncStoring {
  @MainActor
  func downloadSnapshot() async throws -> CloudKitPersonalSyncSnapshot? {
    nil
  }
}

protocol CloudKitChangeTokenPersisting {
  func changeTokenData(for zoneName: String) -> Data?
  func saveChangeTokenData(_ data: Data, for zoneName: String)
  func clearChangeTokenData(for zoneName: String)
}

struct UserDefaultsCloudKitChangeTokenStore: CloudKitChangeTokenPersisting {
  var defaults: UserDefaults = .standard
  var keyPrefix = "DaisyPod.CloudKitPersonalSync.zoneChangeToken"

  func changeTokenData(for zoneName: String) -> Data? {
    defaults.data(forKey: key(for: zoneName))
  }

  func saveChangeTokenData(_ data: Data, for zoneName: String) {
    defaults.set(data, forKey: key(for: zoneName))
  }

  func clearChangeTokenData(for zoneName: String) {
    defaults.removeObject(forKey: key(for: zoneName))
  }

  private func key(for zoneName: String) -> String {
    "\(keyPrefix).\(zoneName)"
  }
}

struct CloudKitPersonalSyncResult: Equatable {
  var uploadedRecordCount: Int
  var downloadedRecordCount: Int = 0
  var message: String
}

struct PersonalSyncResult: Equatable {
  var pageCount: Int
  var message: String
}

struct CloudKitPersonalSyncEngine {
  var repository: PodcastRepository
  var store: CloudKitPersonalSyncStoring

  @MainActor
  func sync(protectedPlaybackEpisodeId: String?) async throws -> PersonalSyncResult {
    let localSnapshot = try Self.snapshot(from: repository)
    let remoteSnapshot = try await store.downloadSnapshot()
    let outboundSnapshot: CloudKitPersonalSyncSnapshot
    if let remoteSnapshot {
      outboundSnapshot = Self.mergedSnapshot(
        local: localSnapshot,
        remote: remoteSnapshot,
        protectedPlaybackEpisodeId: protectedPlaybackEpisodeId
      )
      try repository.restoreBackup(Self.backup(from: outboundSnapshot))
    } else {
      outboundSnapshot = localSnapshot
    }
    let result = try await store.upload(outboundSnapshot)
    if result.uploadedRecordCount > 0 || result.downloadedRecordCount > 0 {
      var settings = try repository.settings()
      settings.lastSyncAt = Date()
      try repository.saveSettings(settings)
    }
    return PersonalSyncResult(pageCount: 1, message: result.message)
  }

  @MainActor
  static func snapshot(from repository: PodcastRepository) throws -> CloudKitPersonalSyncSnapshot {
    try snapshot(from: repository.exportBackup())
  }

  static func snapshot(from backup: DaisyPodBackup) throws -> CloudKitPersonalSyncSnapshot {
    let portable = backup.portable
    var records: [CloudKitPersonalRecordPayload] = []

    try records.append(contentsOf: portable.feeds.map { try record(.podcast, name: $0.id, modifiedAt: $0.updatedAt, value: $0) })
    try records.append(contentsOf: portable.episodes.map { try record(.episode, name: $0.id, modifiedAt: $0.updatedAt, value: $0) })
    try records.append(contentsOf: portable.states.map { try record(.episodeState, name: $0.episodeId, modifiedAt: $0.updatedAt, value: $0) })
    try records.append(contentsOf: portable.podcastPreferences.map { try record(.podcastPreference, name: $0.podcastId, modifiedAt: $0.updatedAt, value: $0) })
    try records.append(contentsOf: portable.clips.map { try record(.clip, name: $0.id, modifiedAt: $0.updatedAt, value: $0) })
    try records.append(contentsOf: portable.silenceMaps.map { try record(.silenceMap, name: $0.id, modifiedAt: $0.updatedAt, value: $0) })
    try records.append(contentsOf: portable.smartSkipMaps.map { try record(.smartSkipMap, name: $0.id, modifiedAt: $0.updatedAt, value: $0) })
    try records.append(contentsOf: portable.tombstones.map { try record(.tombstone, name: $0.id, modifiedAt: $0.deletedAt, value: $0) })
    try records.append(contentsOf: portable.syncActions.map { try record(.syncAction, name: $0.id, modifiedAt: $0.createdAt, value: $0) })
    records.append(try record(.settings, name: "local", modifiedAt: portable.settings.updatedAt, value: portable.settings))

    return CloudKitPersonalSyncSnapshot(
      exportedAt: portable.exportedAt,
      records: records.sorted { lhs, rhs in
        if lhs.recordType.rawValue == rhs.recordType.rawValue {
          return lhs.recordName < rhs.recordName
        }
        return lhs.recordType.rawValue < rhs.recordType.rawValue
      }
    )
  }

  static func mergedSnapshot(
    local: CloudKitPersonalSyncSnapshot,
    remote: CloudKitPersonalSyncSnapshot,
    protectedPlaybackEpisodeId: String? = nil
  ) -> CloudKitPersonalSyncSnapshot {
    var recordsByKey: [String: CloudKitPersonalRecordPayload] = [:]
    let protectedEpisodeStateRecordName = protectedPlaybackEpisodeId.map { "EpisodeState.\(stableRecordNameComponent($0))" }
    for record in remote.records {
      recordsByKey[recordKey(record)] = record
    }
    for record in local.records {
      let key = recordKey(record)
      if record.recordType == .episodeState, record.recordName == protectedEpisodeStateRecordName {
        recordsByKey[key] = record
        continue
      }
      if let existing = recordsByKey[key], existing.modifiedAt > record.modifiedAt {
        continue
      }
      recordsByKey[key] = record
    }
    let records = recordsByKey.values.sorted { lhs, rhs in
      if lhs.recordType.rawValue == rhs.recordType.rawValue {
        return lhs.recordName < rhs.recordName
      }
      return lhs.recordType.rawValue < rhs.recordType.rawValue
    }
    return CloudKitPersonalSyncSnapshot(
      exportedAt: max(local.exportedAt, remote.exportedAt),
      records: records
    )
  }

  static func backup(from snapshot: CloudKitPersonalSyncSnapshot) throws -> DaisyPodBackup {
    let settings = try snapshot.records(ofType: .settings).first?.decode(AppSettings.self) ?? AppSettings()
    return DaisyPodBackup(
      version: DaisyPodBackup.currentVersion,
      exportedAt: snapshot.exportedAt,
      feeds: try snapshot.records(ofType: .podcast).map { try $0.decode(Podcast.self) },
      episodes: try snapshot.records(ofType: .episode).map { try $0.decode(Episode.self) },
      states: try snapshot.records(ofType: .episodeState).map { try $0.decode(EpisodeState.self) },
      podcastPreferences: try snapshot.records(ofType: .podcastPreference).map { try $0.decode(PodcastPreference.self) },
      clips: try snapshot.records(ofType: .clip).map { try $0.decode(Clip.self) },
      silenceMaps: try snapshot.records(ofType: .silenceMap).map { try $0.decode(SilenceMap.self) },
      smartSkipMaps: try snapshot.records(ofType: .smartSkipMap).map { try $0.decode(SmartSkipMapCacheEntry.self) },
      tombstones: try snapshot.records(ofType: .tombstone).map { try $0.decode(SyncTombstone.self) },
      syncActions: try snapshot.records(ofType: .syncAction).map { try $0.decode(SyncAction.self) },
      settings: settings,
      listeningStats: nil
    ).portable
  }

  private static func record<T: Encodable>(
    _ type: CloudKitPersonalRecordType,
    name: String,
    modifiedAt: Date,
    value: T
  ) throws -> CloudKitPersonalRecordPayload {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys]
    return CloudKitPersonalRecordPayload(
      recordType: type,
      recordName: "\(type.rawValue).\(stableRecordNameComponent(name))",
      modifiedAt: modifiedAt,
      encodedJSON: try encoder.encode(value)
    )
  }

  private static func stableRecordNameComponent(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    let scalars = value.unicodeScalars.map { scalar in
      allowed.contains(scalar) ? Character(scalar).description : "_"
    }
    let sanitized = scalars.joined()
    return sanitized.isEmpty ? stableId(value, prefix: "record") : sanitized
  }

  private static func recordKey(_ record: CloudKitPersonalRecordPayload) -> String {
    "\(record.recordType.rawValue):\(record.recordName)"
  }
}

struct LiveCloudKitPersonalSyncStore: CloudKitPersonalSyncStoring {
  private let container: CKContainer
  private let zoneID: CKRecordZone.ID
  private let changeTokenStore: CloudKitChangeTokenPersisting

  init(
    container: CKContainer = CKContainer(identifier: DaisyPodCloudKit.containerIdentifier),
    zoneName: String = "DaisyPodPersonalSync",
    changeTokenStore: CloudKitChangeTokenPersisting = UserDefaultsCloudKitChangeTokenStore()
  ) {
    self.container = container
    self.zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
    self.changeTokenStore = changeTokenStore
  }

  @MainActor
  func upload(_ snapshot: CloudKitPersonalSyncSnapshot) async throws -> CloudKitPersonalSyncResult {
    try await ensureZone()
    let records = snapshot.records.map { record(from: $0, exportedAt: snapshot.exportedAt) }
    var uploaded = 0
    for batch in records.chunked(into: 200) {
      let result = try await database.modifyRecords(
        saving: batch,
        deleting: [],
        savePolicy: .allKeys,
        atomically: false
      )
      for saveResult in result.saveResults.values {
        switch saveResult {
        case .success:
          uploaded += 1
        case .failure(let error):
          throw error
        }
      }
    }
    return CloudKitPersonalSyncResult(
      uploadedRecordCount: uploaded,
      message: uploaded == 1 ? "iCloud synced 1 record." : "iCloud synced \(uploaded) records."
    )
  }

  @MainActor
  func downloadSnapshot() async throws -> CloudKitPersonalSyncSnapshot? {
    try await ensureZone()
    do {
      return try await changedSnapshot(since: storedChangeToken())
    } catch let error as CKError where error.code == .changeTokenExpired {
      changeTokenStore.clearChangeTokenData(for: zoneID.zoneName)
      return try await changedSnapshot(since: nil)
    }
  }

  @MainActor
  private func changedSnapshot(since changeToken: CKServerChangeToken?) async throws -> CloudKitPersonalSyncSnapshot {
    var downloadedRecords: [CloudKitPersonalRecordPayload] = []
    var nextChangeToken = changeToken
    var moreComing = true
    while moreComing {
      let changeSet = try await database.recordZoneChanges(
        inZoneWith: zoneID,
        since: nextChangeToken,
        desiredKeys: ["encodedJSON", "modifiedAt"],
        resultsLimit: CKQueryOperation.maximumResults
      )
      for result in changeSet.modificationResultsByID.values {
        let modification = try result.get()
        if let payload = payload(from: modification.record) {
          downloadedRecords.append(payload)
        }
      }
      nextChangeToken = changeSet.changeToken
      moreComing = changeSet.moreComing
    }
    if let nextChangeToken {
      try saveChangeToken(nextChangeToken)
    }
    return CloudKitPersonalSyncSnapshot(
      exportedAt: downloadedRecords.map(\.modifiedAt).max() ?? Date(),
      records: sorted(downloadedRecords)
    )
  }

  private var database: CKDatabase {
    container.privateCloudDatabase
  }

  @MainActor
  private func ensureZone() async throws {
    let zone = CKRecordZone(zoneID: zoneID)
    let result = try await database.modifyRecordZones(saving: [zone], deleting: [])
    if let saveResult = result.saveResults[zoneID] {
      switch saveResult {
      case .success:
        return
      case .failure(let error as CKError) where error.code == .serverRecordChanged:
        return
      case .failure(let error):
        throw error
      }
    }
  }

  private func record(from payload: CloudKitPersonalRecordPayload, exportedAt: Date) -> CKRecord {
    let recordID = CKRecord.ID(recordName: payload.recordName, zoneID: zoneID)
    let record = CKRecord(recordType: payload.recordType.rawValue, recordID: recordID)
    record["encodedJSON"] = payload.encodedJSON as NSData
    record["modifiedAt"] = payload.modifiedAt as NSDate
    record["exportedAt"] = exportedAt as NSDate
    return record
  }

  private func payload(from record: CKRecord) -> CloudKitPersonalRecordPayload? {
    guard let type = CloudKitPersonalRecordType(rawValue: record.recordType) else { return nil }
    let encodedJSON = (record["encodedJSON"] as? Data) ?? (record["encodedJSON"] as? NSData).map { Data(referencing: $0) }
    guard let encodedJSON else { return nil }
    return CloudKitPersonalRecordPayload(
      recordType: type,
      recordName: record.recordID.recordName,
      modifiedAt: (record["modifiedAt"] as? Date) ?? record.modificationDate ?? .distantPast,
      encodedJSON: encodedJSON
    )
  }

  private func sorted(_ records: [CloudKitPersonalRecordPayload]) -> [CloudKitPersonalRecordPayload] {
    records.sorted { lhs, rhs in
      if lhs.recordType.rawValue == rhs.recordType.rawValue {
        return lhs.recordName < rhs.recordName
      }
      return lhs.recordType.rawValue < rhs.recordType.rawValue
    }
  }

  private func storedChangeToken() throws -> CKServerChangeToken? {
    guard let data = changeTokenStore.changeTokenData(for: zoneID.zoneName) else { return nil }
    return try NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
  }

  private func saveChangeToken(_ changeToken: CKServerChangeToken) throws {
    let data = try NSKeyedArchiver.archivedData(withRootObject: changeToken, requiringSecureCoding: true)
    changeTokenStore.saveChangeTokenData(data, for: zoneID.zoneName)
  }
}

private extension Array {
  func chunked(into size: Int) -> [[Element]] {
    guard size > 0 else { return [self] }
    return stride(from: 0, to: count, by: size).map { start in
      Array(self[start..<Swift.min(start + size, count)])
    }
  }
}

struct PreparedCloudKitPersonalSyncStore: CloudKitPersonalSyncStoring {
  @MainActor
  func upload(_ snapshot: CloudKitPersonalSyncSnapshot) async throws -> CloudKitPersonalSyncResult {
    CloudKitPersonalSyncResult(
      uploadedRecordCount: snapshot.recordCount,
      message: snapshot.recordCount == 1 ? "iCloud sync prepared 1 record." : "iCloud sync prepared \(snapshot.recordCount) records."
    )
  }
}
