import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UTType {
  static let opmlDocument = UTType(exportedAs: "org.opml.opml")
  static let daisyPodBackup = UTType(exportedAs: "com.elephanthand.daisypod.backup")
}

struct TextFileDocument: FileDocument {
  static var readableContentTypes: [UTType] { [.plainText, .json, .xml, .opmlDocument, .daisyPodBackup] }
  static var writableContentTypes: [UTType] { [.plainText, .json, .xml, .opmlDocument, .daisyPodBackup] }

  var text: String

  init(text: String = "") {
    self.text = text
  }

  init(configuration: ReadConfiguration) throws {
    let data = configuration.file.regularFileContents ?? Data()
    text = String(decoding: data, as: UTF8.self)
  }

  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: Data(text.utf8))
  }
}

struct OPMLSubscription: Codable, Hashable {
  var title: String?
  var feedUrl: String
  var websiteUrl: String?
}

enum OPMLCodec {
  static func export(podcasts: [Podcast]) -> String {
    let outlines = podcasts
      .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
      .map { podcast in
        let title = escapeXML(podcast.title)
        let feedUrl = escapeXML(podcast.feedUrl)
        let website = podcast.websiteUrl.map { #" htmlUrl="\#(escapeXML($0))""# } ?? ""
        return #"    <outline text="\#(title)" title="\#(title)" type="rss" xmlUrl="\#(feedUrl)"\#(website) />"#
      }
      .joined(separator: "\n")
    return """
    <?xml version="1.0" encoding="UTF-8"?>
    <opml version="2.0">
      <head>
        <title>DaisyPod Subscriptions</title>
      </head>
      <body>
    \(outlines)
      </body>
    </opml>
    """
  }

  static func parse(_ data: Data) throws -> [OPMLSubscription] {
    let parser = XMLParser(data: data)
    let delegate = OPMLParserDelegate()
    parser.delegate = delegate
    guard parser.parse() else {
      throw parser.parserError ?? CocoaError(.fileReadCorruptFile)
    }
    return delegate.subscriptions.uniquedByFeedUrl()
  }

  private static func escapeXML(_ value: String) -> String {
    value
      .replacingOccurrences(of: "&", with: "&amp;")
      .replacingOccurrences(of: "\"", with: "&quot;")
      .replacingOccurrences(of: "'", with: "&apos;")
      .replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
  }
}

private final class OPMLParserDelegate: NSObject, XMLParserDelegate {
  var subscriptions: [OPMLSubscription] = []

  func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
    guard elementName.lowercased() == "outline" else { return }
    let feedUrl = attributeDict["xmlUrl"] ?? attributeDict["xmlurl"]
    guard let feedUrl, URL(string: feedUrl)?.scheme != nil else { return }
    subscriptions.append(OPMLSubscription(
      title: attributeDict["title"] ?? attributeDict["text"],
      feedUrl: feedUrl,
      websiteUrl: attributeDict["htmlUrl"] ?? attributeDict["htmlurl"]
    ))
  }
}

private extension Array where Element == OPMLSubscription {
  func uniquedByFeedUrl() -> [OPMLSubscription] {
    var seen = Set<String>()
    return filter { subscription in
      let key = subscription.feedUrl.lowercased()
      guard !seen.contains(key) else { return false }
      seen.insert(key)
      return true
    }
  }
}

struct DaisyPodBackup: Codable, Hashable {
  var version: Int
  var exportedAt: Date
  var feeds: [Podcast]
  var episodes: [Episode]
  var states: [EpisodeState]
  var podcastPreferences: [PodcastPreference]
  var clips: [Clip]
  var silenceMaps: [SilenceMap] = []
  var smartSkipMaps: [SmartSkipMapCacheEntry] = []
  var tombstones: [SyncTombstone]
  var syncActions: [SyncAction]
  var settings: AppSettings
  var listeningStats: ListeningStats?

  static let currentVersion = 1

  var portable: DaisyPodBackup {
    var copy = self
    copy.settings.serverUrl = nil
    copy.settings.lastSyncAt = nil
    copy.settings.sleepTimerEndsAt = nil
    copy.settings.offlineMode = false
    copy.states = states.map { state in
      var portable = state
      portable.downloaded = false
      portable.downloadedAt = nil
      portable.downloadPath = nil
      portable.downloadBytes = nil
      portable.downloadBackend = nil
      portable.downloadSource = nil
      return portable
    }
    return copy
  }

  func encodedString() throws -> String {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return String(decoding: try encoder.encode(portable), as: UTF8.self)
  }

  static func decode(_ data: Data) throws -> DaisyPodBackup {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(DaisyPodBackup.self, from: data)
  }
}
