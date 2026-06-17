import Foundation

struct NativeDownloadResult: Hashable {
  var episodeId: String
  var path: String
  var bytes: Int
  var artworkPath: String?
}

struct NativeDownloadPolicy: Hashable {
  var wifiOnly: Bool

  static let unrestricted = NativeDownloadPolicy(wifiOnly: false)

  init(settings: AppSettings) {
    wifiOnly = settings.downloadOnlyWifi
  }

  init(wifiOnly: Bool) {
    self.wifiOnly = wifiOnly
  }
}

@MainActor
struct NativeDownloadManager {
  var fileManager: FileManager = .default
  var session: URLSession = .shared
  var downloadsRoot: URL?

  func download(_ episode: EpisodeWithState, policy: NativeDownloadPolicy = .unrestricted) async throws -> NativeDownloadResult {
    guard let source = URL(string: episode.episode.audioUrl) else { throw URLError(.badURL) }
    let destination = try downloadURL(episode: episode)
    try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    let temporaryURL: URL

    if source.isFileURL {
      temporaryURL = destination.appendingPathExtension("download")
      if fileManager.fileExists(atPath: temporaryURL.path) {
        try fileManager.removeItem(at: temporaryURL)
      }
      try fileManager.copyItem(at: source, to: temporaryURL)
    } else {
      var request = URLRequest(url: source)
      request.allowsExpensiveNetworkAccess = !policy.wifiOnly
      request.allowsConstrainedNetworkAccess = !policy.wifiOnly
      let (downloadedURL, response) = try await session.download(for: request)
      if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
        throw URLError(.badServerResponse)
      }
      temporaryURL = downloadedURL
    }

    if fileManager.fileExists(atPath: destination.path) {
      try fileManager.removeItem(at: destination)
    }
    try fileManager.moveItem(at: temporaryURL, to: destination)
    let artworkURL = try? await cacheArtwork(for: episode, policy: policy)
    let size = try fileManager.attributesOfItem(atPath: destination.path)[.size] as? NSNumber
    return NativeDownloadResult(episodeId: episode.id, path: destination.path, bytes: size?.intValue ?? 0, artworkPath: artworkURL?.path)
  }

  @discardableResult
  func delete(episodeId: String, storedPath: String?) throws -> Bool {
    var deleted = false
    if let storedPath, fileManager.fileExists(atPath: storedPath) {
      try fileManager.removeItem(atPath: storedPath)
      deleted = true
    }
    let prefix = "\(safeFileName(episodeId))__"
    let directory = try downloadsDirectory()
    if let contents = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
      for file in contents where file.lastPathComponent.hasPrefix(prefix) {
        try fileManager.removeItem(at: file)
        deleted = true
      }
    }
    return deleted
  }

  @discardableResult
  func cacheArtwork(for episode: EpisodeWithState, policy: NativeDownloadPolicy = .unrestricted) async throws -> URL? {
    guard let raw = episode.episode.imageUrl, let source = URL(string: raw) else { return nil }
    let destination = try artworkURL(episode: episode, source: source)
    try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    let data: Data
    if source.isFileURL {
      data = try Data(contentsOf: source)
    } else {
      var request = URLRequest(url: source)
      request.allowsExpensiveNetworkAccess = !policy.wifiOnly
      request.allowsConstrainedNetworkAccess = !policy.wifiOnly
      let (downloadedData, response) = try await session.data(for: request)
      if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
        throw URLError(.badServerResponse)
      }
      data = downloadedData
    }
    try data.write(to: destination, options: .atomic)
    return destination
  }

  func cachedArtworkURL(for episode: EpisodeWithState) -> URL? {
    guard let source = URL(string: episode.episode.imageUrl ?? "") else { return nil }
    guard let destination = try? artworkURL(episode: episode, source: source) else { return nil }
    return fileManager.fileExists(atPath: destination.path) ? destination : nil
  }

  func hasDownloadedFile(at path: String?) -> Bool {
    guard let path, !path.isEmpty else { return false }
    return fileManager.fileExists(atPath: path)
  }

  func downloadURL(episode: EpisodeWithState) throws -> URL {
    try downloadsDirectory()
      .appendingPathComponent("\(safeFileName(episode.id))__\(safeFileName(fileName(for: episode)))")
  }

  func artworkURL(episode: EpisodeWithState, source: URL) throws -> URL {
    let ext = source.pathExtension.isEmpty ? "img" : source.pathExtension
    return try artworkDirectory()
      .appendingPathComponent("\(safeFileName(episode.id)).\(safeFileName(ext))")
  }

  func downloadsDirectory() throws -> URL {
    if let downloadsRoot {
      return downloadsRoot
    }
    let appSupport = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let current = appSupport.appending(path: "DaisyPod/Downloads", directoryHint: .isDirectory)
    try migrateLegacyDirectoryIfNeeded(from: appSupport.appending(path: "ElephantPod/Downloads", directoryHint: .isDirectory), to: current)
    return current
  }

  func artworkDirectory() throws -> URL {
    if let downloadsRoot {
      return downloadsRoot.deletingLastPathComponent().appending(path: "Artwork", directoryHint: .isDirectory)
    }
    let appSupport = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let current = appSupport.appending(path: "DaisyPod/Artwork", directoryHint: .isDirectory)
    try migrateLegacyDirectoryIfNeeded(from: appSupport.appending(path: "ElephantPod/Artwork", directoryHint: .isDirectory), to: current)
    return current
  }

  private func migrateLegacyDirectoryIfNeeded(from legacyURL: URL, to currentURL: URL) throws {
    var isDirectory: ObjCBool = false
    guard fileManager.fileExists(atPath: legacyURL.path, isDirectory: &isDirectory), isDirectory.boolValue else { return }
    guard !fileManager.fileExists(atPath: currentURL.path) else { return }
    try fileManager.createDirectory(at: currentURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try fileManager.moveItem(at: legacyURL, to: currentURL)
  }

  private func fileName(for episode: EpisodeWithState) -> String {
    if let url = URL(string: episode.episode.audioUrl), !url.lastPathComponent.isEmpty {
      return url.lastPathComponent
    }
    return "\(episode.id).mp3"
  }

  private func safeFileName(_ raw: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
    let scalars = raw.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
    let cleaned = String(scalars).trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
    return cleaned.isEmpty ? "episode" : String(cleaned.prefix(160))
  }
}
