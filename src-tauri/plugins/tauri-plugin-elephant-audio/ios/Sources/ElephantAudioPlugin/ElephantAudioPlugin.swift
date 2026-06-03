import AVFoundation
import MediaPlayer
import Tauri
import UIKit
import WebKit

struct PrepareArgs: Decodable {
  let episodeId: String
  let url: String
  let title: String
  let podcastTitle: String
  let artworkUrl: String?
  let durationSec: Double?
  let startSec: Double
  let playbackRate: Double
}

struct NowPlayingEnvelope: Decodable {
  let payload: NowPlayingPayload
}

struct NowPlayingPayload: Decodable {
  let title: String
  let podcastTitle: String
  let artworkUrl: String?
  let durationSec: Double?
  let elapsedSec: Double
  let playbackRate: Double
  let playing: Bool
}

@objc(ElephantAudioPlugin)
public class ElephantAudioPlugin: Plugin {
  private var player: AVPlayer?
  private var episodeId: String?
  private var title: String = ""
  private var podcastTitle: String = ""
  private var artworkUrl: String?
  private var artwork: MPMediaItemArtwork?
  private var durationSec: Double?

  @objc public override func load(webview: WKWebView) {
    configureAudioSession()
    configureRemoteCommands()
    NotificationCenter.default.addObserver(self, selector: #selector(handleInterruption), name: AVAudioSession.interruptionNotification, object: nil)
    NotificationCenter.default.addObserver(self, selector: #selector(handleRouteChange), name: AVAudioSession.routeChangeNotification, object: nil)
  }

  @objc public func capabilities(_ invoke: Invoke) {
    invoke.resolve([
      "available": true,
      "backgroundPlayback": true,
      "lockScreenControls": true,
      "mediaSession": true,
      "silenceShortening": false,
      "reason": NSNull()
    ])
  }

  @objc public func prepare(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(PrepareArgs.self)
      guard let url = audioURL(args.url) else { invoke.reject("Invalid audio URL"); return }
      episodeId = args.episodeId
      title = args.title
      podcastTitle = args.podcastTitle
      artworkUrl = args.artworkUrl
      artwork = nil
      durationSec = args.durationSec
      let item = AVPlayerItem(url: url)
      player = AVPlayer(playerItem: item)
      player?.rate = Float(args.playbackRate)
      player?.seek(to: CMTime(seconds: args.startSec, preferredTimescale: 600))
      updateNowPlaying(elapsed: args.startSec, playing: false, playbackRate: args.playbackRate)
      loadArtwork(args.artworkUrl, episodeId: args.episodeId, elapsed: args.startSec, playing: false, playbackRate: args.playbackRate)
      invoke.resolve(true)
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc public func play(_ invoke: Invoke) {
    player?.play()
    updateNowPlaying(elapsed: currentSeconds(), playing: true, playbackRate: Double(player?.rate ?? 1))
    invoke.resolve(true)
  }

  @objc public func pause(_ invoke: Invoke) {
    player?.pause()
    updateNowPlaying(elapsed: currentSeconds(), playing: false, playbackRate: Double(player?.rate ?? 1))
    invoke.resolve(true)
  }

  @objc public func stop(_ invoke: Invoke) {
    player?.pause()
    player = nil
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    invoke.resolve(true)
  }

  @objc public func seek(_ invoke: Invoke) {
    let seconds = invoke.getDouble("seconds") ?? 0
    player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    updateNowPlaying(elapsed: seconds, playing: player?.timeControlStatus == .playing, playbackRate: Double(player?.rate ?? 1))
    invoke.resolve(statusPayload())
  }

  @objc(set_rate:) public func set_rate(_ invoke: Invoke) {
    let playbackRate = invoke.getDouble("playbackRate") ?? 1
    player?.rate = Float(playbackRate)
    updateNowPlaying(elapsed: currentSeconds(), playing: player?.timeControlStatus == .playing, playbackRate: playbackRate)
    invoke.resolve(true)
  }

  @objc public func status(_ invoke: Invoke) {
    invoke.resolve(statusPayload())
  }

  @objc(now_playing:) public func now_playing(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(NowPlayingEnvelope.self).payload
      title = args.title
      podcastTitle = args.podcastTitle
      durationSec = args.durationSec
      if artworkUrl != args.artworkUrl {
        artworkUrl = args.artworkUrl
        artwork = nil
        loadArtwork(args.artworkUrl, episodeId: episodeId, elapsed: args.elapsedSec, playing: args.playing, playbackRate: args.playbackRate)
      }
      updateNowPlaying(elapsed: args.elapsedSec, playing: args.playing, playbackRate: args.playbackRate)
      invoke.resolve()
    } catch {
      if let elapsed = invoke.getDouble("elapsedSec") {
        updateNowPlaying(elapsed: elapsed, playing: player?.timeControlStatus == .playing, playbackRate: Double(player?.rate ?? 1))
      }
      invoke.resolve()
    }
  }

  private func configureAudioSession() {
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .spokenAudio, options: [.allowAirPlay, .allowBluetooth])
      try session.setActive(true)
    } catch {
      NSLog("ElephantAudioPlugin audio session error: \(error)")
    }
  }

  private func audioURL(_ raw: String) -> URL? {
    if raw.hasPrefix("/") {
      return URL(fileURLWithPath: raw)
    }
    guard let parsed = URL(string: raw) else { return nil }
    if parsed.scheme == "file" || parsed.scheme == "http" || parsed.scheme == "https" {
      return parsed
    }
    return nil
  }

  private func configureRemoteCommands() {
    let center = MPRemoteCommandCenter.shared()
    center.playCommand.addTarget { [weak self] _ in
      self?.player?.play()
      self?.updateNowPlaying(elapsed: self?.currentSeconds() ?? 0, playing: true, playbackRate: Double(self?.player?.rate ?? 1))
      return .success
    }
    center.pauseCommand.addTarget { [weak self] _ in
      self?.player?.pause()
      self?.updateNowPlaying(elapsed: self?.currentSeconds() ?? 0, playing: false, playbackRate: Double(self?.player?.rate ?? 1))
      return .success
    }
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
      self?.player?.seek(to: CMTime(seconds: event.positionTime, preferredTimescale: 600))
      self?.updateNowPlaying(elapsed: event.positionTime, playing: self?.player?.timeControlStatus == .playing, playbackRate: Double(self?.player?.rate ?? 1))
      return .success
    }
  }

  private func updateNowPlaying(elapsed: Double, playing: Bool, playbackRate: Double) {
    var info: [String: Any] = [
      MPMediaItemPropertyTitle: title,
      MPMediaItemPropertyArtist: podcastTitle,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
      MPNowPlayingInfoPropertyPlaybackRate: playing ? playbackRate : 0
    ]
    if let durationSec { info[MPMediaItemPropertyPlaybackDuration] = durationSec }
    if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private func loadArtwork(_ raw: String?, episodeId targetEpisodeId: String?, elapsed: Double, playing: Bool, playbackRate: Double) {
    guard let raw, let url = URL(string: raw) else { return }
    URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
      guard
        let self,
        self.episodeId == targetEpisodeId,
        let data,
        let image = UIImage(data: data)
      else { return }
      let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
      DispatchQueue.main.async {
        guard self.episodeId == targetEpisodeId else { return }
        self.artwork = artwork
        self.updateNowPlaying(elapsed: elapsed, playing: playing, playbackRate: playbackRate)
      }
    }.resume()
  }

  private func currentSeconds() -> Double {
    player?.currentTime().seconds.isFinite == true ? player!.currentTime().seconds : 0
  }

  private func statusPayload() -> [String: Any?] {
    return [
      "episodeId": episodeId,
      "playing": player?.timeControlStatus == .playing,
      "positionSec": currentSeconds(),
      "durationSec": player?.currentItem?.duration.seconds,
      "playbackRate": Double(player?.rate ?? 1)
    ]
  }

  @objc private func handleInterruption(notification: Notification) {
    guard let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
    if type == .began { player?.pause() }
  }

  @objc private func handleRouteChange(notification: Notification) {
    // Hook for headphones unplugged / Bluetooth route changes.
  }
}
