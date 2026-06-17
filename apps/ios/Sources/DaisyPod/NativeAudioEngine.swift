import AVFoundation
import Foundation
import MediaPlayer
import UIKit

struct PlaybackJump: Hashable {
  var source: String
  var startSec: TimeInterval
  var endSec: TimeInterval
}

struct PlaybackJumpPlan: Hashable {
  var jumps: [PlaybackJump]

  static let empty = PlaybackJumpPlan(jumps: [])

  init(jumps: [PlaybackJump]) {
    self.jumps = jumps
      .filter { $0.endSec > $0.startSec }
      .sorted { lhs, rhs in
        if lhs.startSec == rhs.startSec { return lhs.endSec < rhs.endSec }
        return lhs.startSec < rhs.startSec
      }
  }

  init(settings: AppSettings, silenceMap: SilenceMap?, smartSkipEntry: SmartSkipMapCacheEntry?) {
    var next: [PlaybackJump] = []

    if settings.silenceShortening, let silenceMap, silenceMap.status == .ready {
      next += silenceMap.segments.map {
        PlaybackJump(source: "silence-map", startSec: $0.skipFromSec, endSec: $0.skipToSec)
      }
    }

    if settings.smartSkipEnabled,
       let map = smartSkipEntry?.map,
       map.isReadyForPlayback {
      next += map.segments.compactMap { segment in
        guard Self.shouldJump(segment, settings: settings) else { return nil }
        return PlaybackJump(
          source: "smart-skip",
          startSec: TimeInterval(segment.startMs) / 1000,
          endSec: TimeInterval(segment.endMs) / 1000
        )
      }
    }

    self.init(jumps: next)
  }

  func jumpTarget(at position: TimeInterval) -> TimeInterval? {
    let tolerance: TimeInterval = 0.05
    guard let jump = jumps.first(where: { position + tolerance >= $0.startSec && position < $0.endSec - tolerance }) else {
      return nil
    }
    return jump.endSec
  }

  private static func shouldJump(_ segment: SmartSkipSegment, settings: AppSettings) -> Bool {
    switch segment.action {
    case .autoSkip:
      break
    case .softSkip:
      guard settings.smartSkipIncludeSoftMatches else { return false }
    case .labelOnly, .doNotSkip:
      return false
    }

    switch segment.type {
    case .ad, .sponsorship, .networkPromo:
      return settings.smartSkipCommercials
    case .selfPromo:
      return settings.smartSkipSelfPromo
    case .intro:
      return settings.smartSkipIntros
    case .outro:
      return settings.smartSkipOutros
    }
  }
}

struct PlaybackTelemetrySample: Hashable {
  var episode: EpisodeWithState
  var mediaPositionSec: TimeInterval
  var mediaDeltaSec: TimeInterval
  var wallDeltaSec: TimeInterval
}

@MainActor
final class NativeAudioEngine: ObservableObject {
  @Published private(set) var current: EpisodeWithState?
  @Published private(set) var isPlaying = false
  @Published private(set) var position: TimeInterval = 0
  @Published private(set) var duration: TimeInterval = 0
  @Published private(set) var lastLoadedURL: URL?

  var onEnded: (() -> Void)?
  var onPlaybackTelemetry: ((PlaybackTelemetrySample) -> Void)?

  private let fileManager: FileManager
  private var player: AVPlayer?
  private var timeObserver: Any?
  private var itemEndObserver: NSObjectProtocol?
  private var jumpPlan = PlaybackJumpPlan.empty
  private var activeSettings = AppSettings()
  private var lastTelemetry: (episodeId: String, mediaAt: TimeInterval, wallAt: Date)?

  init(fileManager: FileManager = .default) {
    self.fileManager = fileManager
    configureAudioSession()
    configureRemoteCommands()
    NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
      let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      Task { @MainActor in self?.handleInterruption(typeValue: typeValue) }
    }
    NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
      let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
      Task { @MainActor in self?.handleRouteChange(reasonValue: reasonValue) }
    }
  }

  func prepare(
    _ episode: EpisodeWithState,
    settings: AppSettings,
    silenceMap: SilenceMap? = nil,
    smartSkipEntry: SmartSkipMapCacheEntry? = nil,
    cachedArtworkURL: URL? = nil,
    autoPlay: Bool = false
  ) {
    guard let url = playbackURL(for: episode) else { return }
    removeTimeObserver()
    lastLoadedURL = url
    let item = AVPlayerItem(url: url)
    player = AVPlayer(playerItem: item)
    observeEnd(of: item)
    current = episode
    activeSettings = settings
    configureRemoteCommandIntervals(settings: settings)
    jumpPlan = PlaybackJumpPlan(settings: settings, silenceMap: silenceMap, smartSkipEntry: smartSkipEntry)
    position = max(0, episode.state.progressSec - TimeInterval(settings.resumeRewindSec))
    duration = episode.episode.durationSec ?? 0
    seek(to: jumpPlan.jumpTarget(at: position) ?? position)
    resetTelemetry(at: position)
    addTimeObserver()
    updateNowPlaying(playing: false, rate: settings.playbackRate)
    loadArtwork(cachedURL: cachedArtworkURL, remoteRaw: episode.episode.imageUrl)
    if autoPlay {
      play(rate: settings.playbackRate)
    }
  }

  func updatePlaybackIntelligence(settings: AppSettings, silenceMap: SilenceMap?, smartSkipEntry: SmartSkipMapCacheEntry?) {
    activeSettings = settings
    configureRemoteCommandIntervals(settings: settings)
    jumpPlan = PlaybackJumpPlan(settings: settings, silenceMap: silenceMap, smartSkipEntry: smartSkipEntry)
  }

  func updateCurrentEpisode(_ episode: EpisodeWithState, settings: AppSettings, cachedArtworkURL: URL? = nil) {
    guard current?.id == episode.id else { return }
    current = episode
    activeSettings = settings
    configureRemoteCommandIntervals(settings: settings)
    duration = episode.episode.durationSec ?? duration
    updateNowPlaying(playing: isPlaying, rate: Double(player?.rate ?? Float(settings.playbackRate)))
    loadArtwork(cachedURL: cachedArtworkURL, remoteRaw: episode.episode.imageUrl)
  }

  private func playbackURL(for episode: EpisodeWithState) -> URL? {
    if let path = episode.state.downloadPath, !path.isEmpty {
      if path.hasPrefix("file://"), let url = URL(string: path) {
        return fileManager.fileExists(atPath: url.path) ? url : URL(string: episode.episode.audioUrl)
      }
      if fileManager.fileExists(atPath: path) {
        return URL(fileURLWithPath: path)
      }
    }
    return URL(string: episode.episode.audioUrl)
  }

  func play(rate: Double = 1) {
    guard let player else { return }
    player.rate = Float(rate)
    isPlaying = true
    resetTelemetry(at: position)
    updateNowPlaying(playing: true, rate: rate)
  }

  func pause() {
    player?.pause()
    isPlaying = false
    lastTelemetry = nil
    updateNowPlaying(playing: false, rate: 1)
  }

  func seek(to seconds: TimeInterval) {
    position = max(0, seconds)
    player?.seek(to: CMTime(seconds: position, preferredTimescale: 600))
    resetTelemetry(at: position)
    updateNowPlaying(playing: isPlaying, rate: Double(player?.rate ?? 1))
  }

  func skip(by seconds: TimeInterval) {
    seek(to: position + seconds)
  }

  func stop() {
    pause()
    removeTimeObserver()
    removeItemEndObserver()
    player = nil
    current = nil
    position = 0
    duration = 0
    lastTelemetry = nil
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
  }

  private func configureAudioSession() {
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .spokenAudio, options: [.allowAirPlay, .allowBluetoothHFP])
      try session.setActive(true)
    } catch {
      NSLog("DaisyPod audio session error: \(error)")
    }
  }

  private func configureRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    center.playCommand.addTarget { [weak self] _ in
      Task { @MainActor in self?.play(rate: Double(self?.player?.rate ?? 1)) }
      return .success
    }
    center.pauseCommand.addTarget { [weak self] _ in
      Task { @MainActor in self?.pause() }
      return .success
    }
    center.skipForwardCommand.preferredIntervals = [30]
    center.skipForwardCommand.addTarget { [weak self] _ in
      Task { @MainActor in
        guard let self else { return }
        self.skip(by: TimeInterval(self.activeSettings.skipForwardSec))
      }
      return .success
    }
    center.skipBackwardCommand.preferredIntervals = [15]
    center.skipBackwardCommand.addTarget { [weak self] _ in
      Task { @MainActor in
        guard let self else { return }
        self.skip(by: -TimeInterval(self.activeSettings.skipBackSec))
      }
      return .success
    }
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      Task { @MainActor in self?.seek(to: event.positionTime) }
      return .success
    }
  }

  private func configureRemoteCommandIntervals(settings: AppSettings) {
    let center = MPRemoteCommandCenter.shared()
    center.skipForwardCommand.preferredIntervals = [NSNumber(value: settings.skipForwardSec)]
    center.skipBackwardCommand.preferredIntervals = [NSNumber(value: settings.skipBackSec)]
  }

  private func addTimeObserver() {
    timeObserver = player?.addPeriodicTimeObserver(forInterval: CMTime(seconds: 1, preferredTimescale: 2), queue: .main) { [weak self] time in
      Task { @MainActor in
        guard let self else { return }
        let currentPosition = time.seconds.isFinite ? time.seconds : 0
        if let target = self.jumpPlan.jumpTarget(at: currentPosition) {
          self.emitPlaybackTelemetry(at: target)
          self.seek(to: target)
        } else {
          self.emitPlaybackTelemetry(at: currentPosition)
          self.position = currentPosition
          self.duration = self.player?.currentItem?.duration.seconds ?? self.duration
          self.updateNowPlaying(playing: self.isPlaying, rate: Double(self.player?.rate ?? 1))
        }
      }
    }
  }

  private func resetTelemetry(at mediaPosition: TimeInterval) {
    guard isPlaying, let current else {
      lastTelemetry = nil
      return
    }
    lastTelemetry = (episodeId: current.id, mediaAt: max(0, mediaPosition), wallAt: Date())
  }

  private func emitPlaybackTelemetry(at mediaPosition: TimeInterval) {
    guard isPlaying, let current else {
      lastTelemetry = nil
      return
    }

    let now = Date()
    defer {
      lastTelemetry = (episodeId: current.id, mediaAt: max(0, mediaPosition), wallAt: now)
    }

    guard let previous = lastTelemetry, previous.episodeId == current.id else { return }
    let mediaDelta = mediaPosition - previous.mediaAt
    let wallDelta = now.timeIntervalSince(previous.wallAt)
    onPlaybackTelemetry?(PlaybackTelemetrySample(
      episode: current,
      mediaPositionSec: mediaPosition,
      mediaDeltaSec: mediaDelta,
      wallDeltaSec: wallDelta
    ))
  }

  private func removeTimeObserver() {
    if let timeObserver {
      player?.removeTimeObserver(timeObserver)
    }
    timeObserver = nil
  }

  private func observeEnd(of item: AVPlayerItem) {
    removeItemEndObserver()
    itemEndObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
      Task { @MainActor in self?.handleItemEnded() }
    }
  }

  private func removeItemEndObserver() {
    if let itemEndObserver {
      NotificationCenter.default.removeObserver(itemEndObserver)
    }
    itemEndObserver = nil
  }

  private func updateNowPlaying(playing: Bool, rate: Double) {
    guard let current else { return }
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: current.episode.title,
      MPMediaItemPropertyArtist: current.episode.podcastTitle,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: playing ? rate : 0
    ]
    if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func loadArtwork(cachedURL: URL?, remoteRaw: String?) {
    if let cachedURL,
       let image = UIImage(contentsOfFile: cachedURL.path) {
      setArtwork(image)
      return
    }
    guard let remoteRaw, let url = URL(string: remoteRaw) else { return }
    URLSession.shared.dataTask(with: url) { data, _, _ in
      guard let data, let image = UIImage(data: data) else { return }
      Task { @MainActor in
        self.setArtwork(image)
      }
    }.resume()
  }

  private func setArtwork(_ image: UIImage) {
    let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    DispatchQueue.main.async {
      var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
      info[MPMediaItemPropertyArtwork] = artwork
      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
  }

  private func handleInterruption(typeValue: UInt?) {
    guard let typeValue,
          let type = AVAudioSession.InterruptionType(rawValue: typeValue),
          type == .began else { return }
    pause()
  }

  private func handleRouteChange(reasonValue: UInt?) {
    guard let reasonValue,
          let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue),
          reason == .oldDeviceUnavailable else { return }
    pause()
  }

  private func handleItemEnded() {
    isPlaying = false
    onEnded?()
  }
}
