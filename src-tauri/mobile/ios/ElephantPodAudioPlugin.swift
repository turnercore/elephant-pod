import AVFoundation
import MediaPlayer
import Tauri
import WebKit

// Production mobile audio bridge for Tauri iOS builds.
// Wire this Swift package as a Tauri mobile plugin, then forward the frontend commands
// native_audio_prepare, native_audio_set_playback_state, and native_audio_clear_session here.
public final class ElephantPodAudioPlugin: Plugin {
    private var player: AVPlayer?
    private var currentEpisodeId: String?
    private var commandCenterConfigured = false

    @objc public override func load(webview: WKWebView) {
        configureAudioSession()
        configureRemoteCommands()
    }

    @objc public func prepare(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PrepareArgs.self)
        currentEpisodeId = args.episodeId
        guard let url = URL(string: args.sourceUrl) else {
            invoke.reject("Invalid audio URL")
            return
        }
        let item = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: item)
        player?.rate = Float(args.playbackRate)
        updateNowPlaying(args: args, elapsed: 0, playing: false)
        invoke.resolve()
    }

    @objc public func play(_ invoke: Invoke) throws {
        let args = try? invoke.parseArgs(PositionArgs.self)
        if let seconds = args?.positionSec {
            player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
        }
        player?.play()
        emitPlaybackState(playing: true)
        invoke.resolve()
    }

    @objc public func pause(_ invoke: Invoke) throws {
        player?.pause()
        emitPlaybackState(playing: false)
        invoke.resolve()
    }

    @objc public func seek(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(PositionArgs.self)
        player?.seek(to: CMTime(seconds: args.positionSec, preferredTimescale: 600))
        emitPlaybackState(playing: player?.timeControlStatus == .playing)
        invoke.resolve()
    }

    @objc public func clear(_ invoke: Invoke) throws {
        player?.pause()
        player = nil
        currentEpisodeId = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        invoke.resolve()
    }

    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [.allowAirPlay, .allowBluetooth])
            try session.setActive(true)
            NotificationCenter.default.addObserver(self, selector: #selector(handleInterruption(_:)), name: AVAudioSession.interruptionNotification, object: session)
            NotificationCenter.default.addObserver(self, selector: #selector(handleRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: session)
        } catch {
            print("ElephantPodAudioPlugin audio session error: \(error)")
        }
    }

    private func configureRemoteCommands() {
        guard !commandCenterConfigured else { return }
        commandCenterConfigured = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            self?.player?.play()
            self?.emitFrontendCommand(command: "play")
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.player?.pause()
            self?.emitFrontendCommand(command: "pause")
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            if self.player?.timeControlStatus == .playing { self.player?.pause(); self.emitFrontendCommand(command: "pause") }
            else { self.player?.play(); self.emitFrontendCommand(command: "play") }
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [30]
        center.skipForwardCommand.addTarget { [weak self] event in
            let seconds = (event as? MPSkipIntervalCommandEvent)?.interval ?? 30
            self?.skip(seconds: seconds)
            self?.emitFrontendCommand(command: "skip-forward", seconds: seconds)
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] event in
            let seconds = (event as? MPSkipIntervalCommandEvent)?.interval ?? 15
            self?.skip(seconds: -seconds)
            self?.emitFrontendCommand(command: "skip-back", seconds: seconds)
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let position = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.player?.seek(to: CMTime(seconds: position.positionTime, preferredTimescale: 600))
            self?.emitFrontendCommand(command: "seek", seconds: position.positionTime)
            return .success
        }
    }

    private func skip(seconds: Double) {
        guard let player else { return }
        let current = CMTimeGetSeconds(player.currentTime())
        player.seek(to: CMTime(seconds: max(0, current + seconds), preferredTimescale: 600))
    }

    private func updateNowPlaying(args: PrepareArgs, elapsed: Double, playing: Bool) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: args.title,
            MPMediaItemPropertyArtist: args.podcastTitle,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsed,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? args.playbackRate : 0
        ]
        if let duration = args.durationSec { info[MPMediaItemPropertyPlaybackDuration] = duration }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func emitPlaybackState(playing: Bool) {
        emitFrontendCommand(command: playing ? "play" : "pause")
    }

    private func emitFrontendCommand(command: String, seconds: Double? = nil) {
        var payload: [String: Any] = ["command": command]
        if let seconds { payload["seconds"] = seconds }
        trigger("elephant-pod://media-command", data: payload)
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        if type == .began {
            player?.pause()
            emitFrontendCommand(command: "pause")
        }
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        // Keep the session alive, but pause on old-device-unavailable events such as unplugged headphones.
        guard let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else { return }
        if reason == .oldDeviceUnavailable {
            player?.pause()
            emitFrontendCommand(command: "pause")
        }
    }
}

struct PrepareArgs: Decodable {
    let episodeId: String
    let sourceUrl: String
    let title: String
    let podcastTitle: String
    let artworkUrl: String?
    let durationSec: Double?
    let playbackRate: Double
}

struct PositionArgs: Decodable {
    let positionSec: Double
}
