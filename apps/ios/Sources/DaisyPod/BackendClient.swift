import Foundation
import UIKit

struct BackendHealth: Decodable {
  var ok: Bool
  var service: String?
  var time: String?
}

struct BackendCapabilities: Decodable {
  struct Feature: Decodable {
    var enabled: Bool
  }
  var youtubeImport: Feature?
  var podcastIndex: Feature?
  var clips: Feature?
  var silenceMaps: Feature?
  var smartSkip: Feature?
}

struct AppleSignInResponse: Decodable {
  var accessToken: String
  var account: BackendSession.Account
  var createdAt: Date?
}

struct BackendClientError: Error, Equatable {
  var statusCode: Int
  var message: String?
  var code: String?
  var details: [String: String]?

  var isNativeAppAccessRequired: Bool {
    statusCode == 401
  }
}

private struct BackendErrorResponse: Decodable {
  var error: String?
  var code: String?
  var details: [String: String]?

  enum CodingKeys: String, CodingKey {
    case error
    case code
    case details
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    error = try container.decodeIfPresent(String.self, forKey: .error)
    code = try container.decodeIfPresent(String.self, forKey: .code)
    details = try? container.decodeIfPresent([String: String].self, forKey: .details)
  }
}

enum YouTubeURLClassifier {
  enum SourceKind: String {
    case video
    case playlist
    case channel
    case podcast
  }

  static func sourceKind(for rawValue: String) -> SourceKind? {
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: trimmed), let host = url.host?.lowercased() else { return nil }
    let normalizedHost = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    guard ["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].contains(normalizedHost) else { return nil }
    if url.path.lowercased().hasPrefix("/shorts/") { return nil }
    if normalizedHost == "youtu.be" { return .video }

    let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    if components?.queryItems?.contains(where: { $0.name == "list" && $0.value?.isEmpty == false }) == true {
      if components?.queryItems?.contains(where: { $0.name == "podcast" }) == true {
        return .podcast
      }
      return .playlist
    }
    if url.path == "/watch" || url.path.hasPrefix("/embed/") || url.path.hasPrefix("/live/") {
      return .video
    }
    if url.path.hasPrefix("/channel/") || url.path.hasPrefix("/c/") || url.path.hasPrefix("/user/") || url.path.hasPrefix("/@") {
      return .channel
    }
    return nil
  }
}

struct PodcastDiscoveryResult: Identifiable, Decodable, Hashable {
  var id: String
  var title: String
  var author: String?
  var description: String?
  var imageUrl: String?
  var feedUrl: String
  var categories: [String]

  enum CodingKeys: String, CodingKey {
    case id
    case feedId
    case feed_id
    case title
    case name
    case author
    case authorName
    case author_name
    case description
    case summary
    case itunesSummary
    case imageUrl
    case image
    case itunesImage
    case artwork
    case feedUrl
    case feed_url
    case url
    case originalUrl
    case feed
    case categories
  }

  init(id: String? = nil, title: String, author: String? = nil, description: String? = nil, imageUrl: String? = nil, feedUrl: String, categories: [String] = []) {
    self.feedUrl = feedUrl
    self.title = title
    self.author = author
    self.description = description
    self.imageUrl = imageUrl
    self.categories = categories
    self.id = id ?? stableId("\(title)|\(feedUrl)", prefix: "podcast")
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    guard let feedUrl = Self.firstString(container, [.feedUrl, .feed_url, .url, .originalUrl, .feed]) else {
      throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Podcast search result is missing a feed URL."))
    }
    let title = Self.firstString(container, [.title, .name]) ?? feedUrl
    self.init(
      id: Self.firstString(container, [.id, .feedId, .feed_id]),
      title: title,
      author: Self.firstString(container, [.author, .authorName, .author_name]),
      description: Self.firstString(container, [.description, .summary, .itunesSummary]),
      imageUrl: Self.firstString(container, [.imageUrl, .image, .itunesImage, .artwork]),
      feedUrl: feedUrl,
      categories: Self.categories(container)
    )
  }

  private static func firstString(_ container: KeyedDecodingContainer<CodingKeys>, _ keys: [CodingKeys]) -> String? {
    for key in keys {
      if let decoded = try? container.decodeIfPresent(String.self, forKey: key),
         !decoded.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return decoded.trimmingCharacters(in: .whitespacesAndNewlines)
      }
      if let value = try? container.decodeIfPresent(Int.self, forKey: key) {
        return String(value)
      }
    }
    return nil
  }

  private static func categories(_ container: KeyedDecodingContainer<CodingKeys>) -> [String] {
    if let values = try? container.decodeIfPresent([String].self, forKey: .categories) {
      return values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
    if let raw = try? container.decodeIfPresent(String.self, forKey: .categories) {
      return raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    if let values = try? container.decodeIfPresent([String: String].self, forKey: .categories) {
      return values.values.sorted().filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
    return []
  }
}

struct PodcastDiscoveryResponse: Decodable {
  var items: [PodcastDiscoveryResult]
  var max: Int?
  var total: Int?
}

struct YouTubeEpisodePatch: Decodable, Hashable {
  var id: String?
  var title: String?
  var description: String?
  var websiteUrl: String?
  var imageUrl: String?
  var publishedAt: Date?
  var durationSec: TimeInterval?
  var sourceUrl: String?
  var externalId: String?
  var extractionStatus: ExtractionStatus?
  var updatedAt: Date?

  init(
    id: String? = nil,
    title: String? = nil,
    description: String? = nil,
    websiteUrl: String? = nil,
    imageUrl: String? = nil,
    publishedAt: Date? = nil,
    durationSec: TimeInterval? = nil,
    sourceUrl: String? = nil,
    externalId: String? = nil,
    extractionStatus: ExtractionStatus? = nil,
    updatedAt: Date? = nil
  ) {
    self.id = id
    self.title = title
    self.description = description
    self.websiteUrl = websiteUrl
    self.imageUrl = imageUrl
    self.publishedAt = publishedAt
    self.durationSec = durationSec
    self.sourceUrl = sourceUrl
    self.externalId = externalId
    self.extractionStatus = extractionStatus
    self.updatedAt = updatedAt
  }
}

struct YouTubeEnrichmentResponse: Decodable, Hashable {
  var episodeId: String?
  var patch: YouTubeEpisodePatch
}

struct YouTubeExtractionResponse: Decodable, Hashable {
  var episodeId: String
  var sourceUrl: String
  var extractionStatus: ExtractionStatus
  var audioReady: Bool
}

struct PublishClipResponse: Decodable, Hashable {
  var id: String
  var publicUrl: String?
  var renderedAudioUrl: String?
  var renderedUrl: String?
  var renderedVideoUrl: String?
  var renderStatus: ClipRenderStatus?
  var renderError: String?
  var fileSizeBytes: Int?
}

struct SmartSkipProcessResponse: Decodable, Hashable {
  var jobId: String?
  var status: ServerCacheStatus
  var stage: String?
  var segmentMap: SmartSkipSegmentMap?
  var transcript: SmartSkipTranscript?
  var error: String?
}

struct SmartSkipSegmentMapResponse: Decodable, Hashable {
  var status: ServerCacheStatus
  var segmentMap: SmartSkipSegmentMap?
  var transcript: SmartSkipTranscript?
}

private struct SmartSkipProcessRequest: Encodable {
  var episodeId: String
  var podcastId: String?
  var podcastTitle: String
  var episodeTitle: String
  var description: String?
  var audioUrl: String
  var websiteUrl: String?
  var guid: String
  var durationSec: TimeInterval?
  var publishedAt: Date
  var chapters: [Chapter]
  var priority: String
}

struct SyncUploadState: Codable, Hashable {
  var episodeId: String
  var played: Bool
  var playedAt: Date?
  var lastPlayedAt: Date?
  var progressSec: TimeInterval
  var inboxState: InboxState
  var inboxPosition: Int?
  var queuedAt: Date?
  var queuePosition: Int?
  var downloaded: Bool = false
  var downloadedAt: Date?
  var favorite: Bool
  var deletedAt: Date?
  var clipCount: Int
  var updatedAt: Date

  init(_ state: EpisodeState) {
    episodeId = state.episodeId
    played = state.played
    playedAt = state.playedAt
    lastPlayedAt = state.lastPlayedAt
    progressSec = state.progressSec
    inboxState = state.inboxState
    inboxPosition = state.inboxPosition
    queuedAt = state.queuedAt
    queuePosition = state.queuePosition
    favorite = state.favorite
    deletedAt = state.deletedAt
    clipCount = state.clipCount
    updatedAt = state.updatedAt
  }

  init(
    episodeId: String,
    played: Bool,
    playedAt: Date?,
    lastPlayedAt: Date?,
    progressSec: TimeInterval,
    inboxState: InboxState,
    inboxPosition: Int?,
    queuedAt: Date?,
    queuePosition: Int?,
    favorite: Bool,
    deletedAt: Date?,
    clipCount: Int,
    updatedAt: Date
  ) {
    self.episodeId = episodeId
    self.played = played
    self.playedAt = playedAt
    self.lastPlayedAt = lastPlayedAt
    self.progressSec = progressSec
    self.inboxState = inboxState
    self.inboxPosition = inboxPosition
    self.queuedAt = queuedAt
    self.queuePosition = queuePosition
    self.favorite = favorite
    self.deletedAt = deletedAt
    self.clipCount = clipCount
    self.updatedAt = updatedAt
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    episodeId = try container.decode(String.self, forKey: .episodeId)
    played = try container.decode(Bool.self, forKey: .played)
    playedAt = try container.decodeIfPresent(Date.self, forKey: .playedAt)
    lastPlayedAt = try container.decodeIfPresent(Date.self, forKey: .lastPlayedAt)
    progressSec = try container.decode(TimeInterval.self, forKey: .progressSec)
    inboxState = try container.decode(InboxState.self, forKey: .inboxState)
    inboxPosition = try container.decodeIfPresent(Int.self, forKey: .inboxPosition)
    queuedAt = try container.decodeIfPresent(Date.self, forKey: .queuedAt)
    queuePosition = try container.decodeIfPresent(Int.self, forKey: .queuePosition)
    downloaded = try container.decodeIfPresent(Bool.self, forKey: .downloaded) ?? false
    downloadedAt = try container.decodeIfPresent(Date.self, forKey: .downloadedAt)
    favorite = try container.decode(Bool.self, forKey: .favorite)
    deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    clipCount = try container.decode(Int.self, forKey: .clipCount)
    updatedAt = try container.decode(Date.self, forKey: .updatedAt)
  }
}

struct BackendClient {
  nonisolated(unsafe) static var defaultSession: URLSession = .shared

  var baseURL: URL
  var session: URLSession

  init?(serverUrl: String?) {
    guard let normalized = Self.normalizeServerUrl(serverUrl), let url = URL(string: normalized) else { return nil }
    baseURL = url
    session = Self.defaultSession
  }

  func health() async throws -> BackendHealth {
    try await get("/api/health")
  }

  func capabilities() async throws -> BackendCapabilities {
    try await get("/api/capabilities")
  }

  func signInWithApple(identityToken: String) async throws -> AppleSignInResponse {
    var request = URLRequest(url: baseURL.appending(path: "/api/auth/apple"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    request.httpBody = try JSONEncoder().encode(["identityToken": identityToken])
    return try await perform(request)
  }

  func signOut() async throws {
    var request = URLRequest(url: baseURL.appending(path: "/api/auth/sign-out"))
    request.httpMethod = "POST"
    applyServerServiceAccessHeaders(&request)
    let (_, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw URLError(.badServerResponse)
    }
  }

  func parseRSS(feedUrl: String) async throws -> ParsedFeedResult {
    var components = URLComponents(url: baseURL.appending(path: "/api/rss/parse"), resolvingAgainstBaseURL: false)
    components?.queryItems = [URLQueryItem(name: "url", value: feedUrl)]
    guard let url = components?.url else { throw URLError(.badURL) }
    return try await perform(URLRequest(url: url))
  }

  func importYouTubeSource(url sourceUrl: String) async throws -> ParsedFeedResult {
    guard YouTubeURLClassifier.sourceKind(for: sourceUrl) != nil else { throw URLError(.badURL) }
    var request = URLRequest(url: baseURL.appending(path: "/api/youtube/import"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    request.httpBody = try JSONEncoder().encode(["url": sourceUrl.trimmingCharacters(in: .whitespacesAndNewlines)])
    return try await perform(request)
  }

  func enrichYouTubeEpisode(episodeId: String, sourceUrl: String) async throws -> YouTubeEnrichmentResponse {
    var request = URLRequest(url: baseURL.appending(path: "/api/youtube/episodes/\(episodeId)/enrich"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    request.httpBody = try JSONEncoder().encode(["sourceUrl": sourceUrl])
    return try await perform(request)
  }

  func extractYouTubeEpisode(episodeId: String, sourceUrl: String) async throws -> YouTubeExtractionResponse {
    var request = URLRequest(url: baseURL.appending(path: "/api/youtube/episodes/\(episodeId)/extract"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    request.httpBody = try JSONEncoder().encode(["sourceUrl": sourceUrl])
    return try await perform(request)
  }

  func publishClip(_ clip: Clip) async throws -> PublishClipResponse {
    var request = URLRequest(url: baseURL.appending(path: "/api/clips"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    request.httpBody = try encoder.encode(clip)
    return try await perform(request)
  }

  func requestSilenceMap(for episode: EpisodeWithState) async throws -> SilenceMap {
    var request = URLRequest(url: baseURL.appending(path: "/api/audio/silence-maps"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    request.httpBody = try JSONEncoder().encode(["episodeId": episode.id, "audioUrl": episode.episode.audioUrl])
    return try await perform(request)
  }

  func fetchSilenceMap(id: String) async throws -> SilenceMap {
    var request = URLRequest(url: baseURL.appending(path: "/api/audio/silence-maps/\(id)"))
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    return try await perform(request)
  }

  func requestSmartSkipProcessing(for episode: EpisodeWithState, priority: String) async throws -> SmartSkipProcessResponse {
    var request = URLRequest(url: baseURL.appending(path: "/api/smart-skip/process"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    let body = SmartSkipProcessRequest(
      episodeId: episode.id,
      podcastId: episode.episode.podcastId,
      podcastTitle: episode.episode.podcastTitle,
      episodeTitle: episode.episode.title,
      description: episode.episode.description,
      audioUrl: episode.episode.audioUrl,
      websiteUrl: episode.episode.websiteUrl,
      guid: episode.episode.guid,
      durationSec: episode.episode.durationSec,
      publishedAt: episode.episode.publishedAt,
      chapters: episode.episode.chapters,
      priority: priority
    )
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    request.httpBody = try encoder.encode(body)
    return try await perform(request)
  }

  func fetchSmartSkipSegmentMap(for episode: EpisodeWithState) async throws -> SmartSkipSegmentMapResponse {
    var components = URLComponents(url: baseURL.appending(path: "/api/smart-skip/episodes/\(episode.id)/segment-map"), resolvingAgainstBaseURL: false)
    components?.queryItems = [URLQueryItem(name: "audioUrl", value: episode.episode.audioUrl)]
    guard let url = components?.url else { throw URLError(.badURL) }
    var request = URLRequest(url: url)
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    return try await perform(request)
  }

  func searchPodcastIndex(query: String, max: Int = 30) async throws -> [PodcastDiscoveryResult] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count >= 2 else { return [] }
    var components = URLComponents(url: baseURL.appending(path: "/api/podcast-index/search"), resolvingAgainstBaseURL: false)
    components?.queryItems = [
      URLQueryItem(name: "q", value: trimmed),
      URLQueryItem(name: "max", value: String(max))
    ]
    guard let url = components?.url else { throw URLError(.badURL) }
    var request = URLRequest(url: url)
    request.setValue("application/json", forHTTPHeaderField: "accept")
    applyServerServiceAccessHeaders(&request)
    return try await perform(request, as: PodcastDiscoveryResponse.self).items
  }

  static func normalizeServerUrl(_ input: String?) -> String? {
    guard let input else { return nil }
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let hasScheme = trimmed.contains("://")
    let host = trimmed.split(separator: "/").first?.split(separator: ":").first?.lowercased() ?? ""
    let scheme = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].contains(host) ? "http" : "https"
    let raw = hasScheme ? trimmed : "\(scheme)://\(trimmed)"
    guard var components = URLComponents(string: raw) else { return trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "/")) }
    components.query = nil
    components.fragment = nil
    return components.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }

  private func get<T: Decodable>(_ path: String) async throws -> T {
    try await perform(URLRequest(url: baseURL.appending(path: path)))
  }

  private func applyServerServiceAccessHeaders(_ request: inout URLRequest) {
    request.setValue("ios", forHTTPHeaderField: "x-daisypod-client")
    request.setValue("icloud", forHTTPHeaderField: "x-daisypod-native-account")
    if let accessToken = BackendSessionStore.accessToken {
      request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "authorization")
    }
  }

  private func perform<T: Decodable>(_ request: URLRequest, as type: T.Type = T.self) async throws -> T {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      if let http = response as? HTTPURLResponse {
        let serverError = try? JSONDecoder().decode(BackendErrorResponse.self, from: data)
        throw BackendClientError(
          statusCode: http.statusCode,
          message: serverError?.error,
          code: serverError?.code,
          details: serverError?.details
        )
      }
      throw URLError(.badServerResponse)
    }
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(T.self, from: data)
  }
}

enum NativeRSSClient {
  static func importFeed(feedUrl: String, serverUrl: String?) async throws -> ParsedFeedResult {
    if let client = BackendClient(serverUrl: serverUrl) {
      do {
        return try await client.parseRSS(feedUrl: feedUrl)
      } catch {
        // Native iOS can fetch feeds directly, so keep local-first import working when the optional server is absent or unreachable.
      }
    }

    guard let url = URL(string: feedUrl), ["http", "https"].contains(url.scheme?.lowercased()) else {
      throw URLError(.badURL)
    }
    var request = URLRequest(url: url)
    request.setValue("DaisyPod-iOS/0.4 (+https://elephanthand.com)", forHTTPHeaderField: "user-agent")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw URLError(.badServerResponse)
    }
    return try RSSFeedParser.parse(data: data, feedUrl: feedUrl)
  }
}

final class RSSFeedParser: NSObject, XMLParserDelegate {
  private struct ElementFrame {
    var name: String
    var attributes: [String: String]
    var text = ""
  }

  private struct ParsedItem {
    var values: [String: String] = [:]
    var chapters: [Chapter] = []
  }

  private var stack: [ElementFrame] = []
  private var channel: [String: String] = [:]
  private var channelImageUrl: String?
  private var items: [ParsedItem] = []
  private var currentItem: ParsedItem?
  private var inItem = false
  private var inChannelImage = false
  private var parseError: Error?
  private var feedUrl = ""

  static func parse(data: Data, feedUrl: String) throws -> ParsedFeedResult {
    let parser = XMLParser(data: data)
    let delegate = RSSFeedParser()
    delegate.feedUrl = feedUrl
    parser.delegate = delegate
    guard parser.parse() else {
      throw parser.parserError ?? delegate.parseError ?? URLError(.cannotParseResponse)
    }
    return try delegate.result(feedUrl: feedUrl)
  }

  func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
    let name = normalized(elementName)
    stack.append(ElementFrame(name: name, attributes: attributeDict))
    if name == "item" || name == "entry" {
      inItem = true
      currentItem = ParsedItem()
    } else if name == "image", !inItem {
      inChannelImage = true
    }

    if inItem {
      if name == "enclosure", let url = attributeDict["url"] {
        currentItem?.values["audioUrl"] = url
        currentItem?.values["enclosureLength"] = attributeDict["length"]
      } else if name == "link", let href = attributeDict["href"] {
        let rel = attributeDict["rel"] ?? ""
        let type = attributeDict["type"] ?? ""
        if rel == "enclosure" || type.hasPrefix("audio/") {
          currentItem?.values["audioUrl"] = href
        } else if currentItem?.values["websiteUrl"] == nil {
          currentItem?.values["websiteUrl"] = href
        }
      } else if ["itunes:image", "media:thumbnail", "media:content"].contains(name), let image = attributeDict["href"] ?? attributeDict["url"] {
        currentItem?.values["imageUrl"] = image
      } else if isChapterElement(name) {
        appendChapter(attributes: attributeDict)
      }
    } else if ["itunes:image", "media:thumbnail", "media:content"].contains(name), let image = attributeDict["href"] ?? attributeDict["url"] {
      channelImageUrl = image
    } else if name == "link", let href = attributeDict["href"], channel["websiteUrl"] == nil {
      channel["websiteUrl"] = href
    }
  }

  func parser(_ parser: XMLParser, foundCharacters string: String) {
    guard !stack.isEmpty else { return }
    stack[stack.count - 1].text += string
  }

  func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
    guard let frame = stack.popLast() else { return }
    let value = frame.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty || frame.name == "item" || frame.name == "entry" || frame.name == "image" else { return }

    if inItem {
      switch frame.name {
      case "title", "itunes:title":
        setCurrentItemValueIfMissing("title", value)
      case "description", "content:encoded", "summary", "subtitle":
        setCurrentItemValueIfMissing("description", value)
      case "guid", "id":
        setCurrentItemValueIfMissing("guid", value)
      case "pubdate", "published", "updated":
        setCurrentItemValueIfMissing("publishedAt", value)
      case "link":
        setCurrentItemValueIfMissing("websiteUrl", value)
      case "itunes:duration":
        currentItem?.values["durationSec"] = value
      case "itunes:season":
        currentItem?.values["seasonNumber"] = value
      case "itunes:episode":
        currentItem?.values["episodeNumber"] = value
      case "itunes:explicit":
        currentItem?.values["explicit"] = value
      case "item", "entry":
        if let currentItem { items.append(currentItem) }
        currentItem = nil
        inItem = false
      default:
        break
      }
      return
    }

    if inChannelImage {
      if frame.name == "url" { channelImageUrl = value }
      if frame.name == "image" { inChannelImage = false }
      return
    }

    switch frame.name {
    case "title":
      channel["title"] = channel["title"] ?? value
    case "itunes:author", "author", "name":
      channel["author"] = channel["author"] ?? value
    case "description", "subtitle", "summary":
      channel["description"] = channel["description"] ?? value
    case "link":
      channel["websiteUrl"] = channel["websiteUrl"] ?? value
    default:
      break
    }
  }

  func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) {
    self.parseError = parseError
  }

  private func result(feedUrl: String) throws -> ParsedFeedResult {
    let now = Date()
    let title = channel["title"].flatMap { $0.isEmpty ? nil : $0 } ?? feedUrl
    let podcastId = stableId(feedUrl, prefix: "feed")
    let podcast = Podcast(
      id: podcastId,
      title: title,
      author: channel["author"],
      description: channel["description"],
      imageUrl: channelImageUrl,
      feedUrl: feedUrl,
      websiteUrl: channel["websiteUrl"],
      tags: [],
      sourceType: .rss,
      sourceUrl: feedUrl,
      lastRefreshedAt: now,
      createdAt: now,
      updatedAt: now
    )
    let episodes = items.enumerated().compactMap { index, item -> Episode? in
      let values = item.values
      guard let audioUrl = values["audioUrl"], !audioUrl.isEmpty else { return nil }
      let guid = values["guid"] ?? "\(feedUrl)#\(index)"
      return Episode(
        id: stableId("\(feedUrl):\(guid)", prefix: "ep"),
        podcastId: podcastId,
        podcastTitle: title,
        title: values["title"] ?? "Episode \(index + 1)",
        description: values["description"],
        audioUrl: audioUrl,
        websiteUrl: values["websiteUrl"],
        imageUrl: values["imageUrl"] ?? channelImageUrl,
        publishedAt: parseDate(values["publishedAt"]) ?? now,
        durationSec: parseDuration(values["durationSec"]),
        seasonNumber: parsePositiveInt(values["seasonNumber"]),
        episodeNumber: parsePositiveInt(values["episodeNumber"]),
        explicit: values["explicit"]?.lowercased() == "yes" || values["explicit"]?.lowercased() == "true",
        chapters: item.chapters.sorted { $0.startsAt < $1.startsAt },
        guid: guid,
        enclosureLength: parsePositiveInt(values["enclosureLength"]),
        sourceType: .rss,
        sourceUrl: feedUrl,
        extractionStatus: ExtractionStatus.none,
        createdAt: now,
        updatedAt: now
      )
    }
    guard !episodes.isEmpty else { throw URLError(.cannotParseResponse) }
    return ParsedFeedResult(podcast: podcast, episodes: episodes)
  }

  private func normalized(_ raw: String) -> String {
    raw.lowercased()
  }

  private func setCurrentItemValueIfMissing(_ key: String, _ value: String) {
    guard currentItem?.values[key] == nil else { return }
    currentItem?.values[key] = value
  }

  private func isChapterElement(_ name: String) -> Bool {
    ["podcast:chapter", "psc:chapter", "chapter"].contains(name)
  }

  private func appendChapter(attributes: [String: String]) {
    guard let title = firstAttribute(attributes, ["title"]), let startsAt = parseChapterStart(firstAttribute(attributes, ["startTime", "start", "time", "startsAt"])) else { return }
    let url = firstAttribute(attributes, ["url", "href", "link"])
    let sequence = currentItem?.chapters.count ?? 0
    let idInput = "\(feedUrl):\(currentItem?.values["guid"] ?? currentItem?.values["title"] ?? ""):\(sequence):\(title):\(startsAt)"
    currentItem?.chapters.append(Chapter(id: stableId(idInput, prefix: "ch"), title: title, startsAt: startsAt, url: url))
  }

  private func firstAttribute(_ attributes: [String: String], _ keys: [String]) -> String? {
    for key in keys {
      if let value = attributes[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
        return value
      }
    }
    return nil
  }

  private func parseChapterStart(_ raw: String?) -> TimeInterval? {
    guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
    if let seconds = Double(raw) { return seconds }
    let parts = raw.split(separator: ":").compactMap { Double($0) }
    guard parts.count == raw.split(separator: ":").count else { return nil }
    if parts.count == 3 { return parts[0] * 3600 + parts[1] * 60 + parts[2] }
    if parts.count == 2 { return parts[0] * 60 + parts[1] }
    return nil
  }

  private func parseDate(_ raw: String?) -> Date? {
    guard let raw, !raw.isEmpty else { return nil }
    if let date = ISO8601DateFormatter().date(from: raw) { return date }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "EEE, d MMM yyyy HH:mm:ss Z"
    return formatter.date(from: raw)
  }

  private func parseDuration(_ raw: String?) -> TimeInterval? {
    guard let raw, !raw.isEmpty else { return nil }
    if let seconds = Double(raw) { return seconds }
    let parts = raw.split(separator: ":").compactMap { Double($0) }
    guard parts.count == raw.split(separator: ":").count else { return nil }
    if parts.count == 3 { return parts[0] * 3600 + parts[1] * 60 + parts[2] }
    if parts.count == 2 { return parts[0] * 60 + parts[1] }
    return nil
  }

  private func parsePositiveInt(_ raw: String?) -> Int? {
    guard let raw, let value = Int(raw), value > 0 else { return nil }
    return value
  }
}
