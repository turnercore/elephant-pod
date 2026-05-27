package com.elephanthand.elephantears.audio

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.MoreExecutors

@InvokeArg
class PrepareArgs {
  var episodeId: String = ""
  var url: String = ""
  var title: String = ""
  var podcastTitle: String = ""
  var artworkUrl: String? = null
  var startSec: Double = 0.0
  var playbackRate: Double = 1.0
}

@InvokeArg
class PositionArgs {
  var seconds: Double? = null
  var positionSec: Double? = null
}

@InvokeArg
class RateArgs {
  var playbackRate: Double = 1.0
}

@TauriPlugin
class ElephantAudioPlugin(private val activity: Activity) : Plugin(activity) {
  private var controller: MediaController? = null
  private var currentEpisodeId: String? = null

  override fun load(webView: WebView) {
    ensureController { }
  }

  @Command
  fun capabilities(invoke: Invoke) {
    invoke.resolve(mapOf(
      "available" to true,
      "backgroundPlayback" to true,
      "lockScreenControls" to true,
      "mediaSession" to true,
      "silenceShortening" to false,
      "reason" to null
    ))
  }

  @Command
  fun prepare(invoke: Invoke) {
    val args = invoke.parseArgs(PrepareArgs::class.java)
    ensureController { mediaController ->
      currentEpisodeId = args.episodeId
      val metadata = MediaMetadata.Builder()
        .setTitle(args.title)
        .setArtist(args.podcastTitle)
        .setArtworkUri(args.artworkUrl?.let(Uri::parse))
        .build()
      val item = MediaItem.Builder()
        .setUri(args.url)
        .setMediaId(args.episodeId)
        .setMediaMetadata(metadata)
        .build()
      mediaController.setMediaItem(item, (args.startSec * 1000.0).toLong())
      mediaController.setPlaybackSpeed(args.playbackRate.toFloat())
      mediaController.prepare()
      invoke.resolve(true)
    }
  }

  @Command fun play(invoke: Invoke) { ensureController { it.play(); invoke.resolve(true) } }
  @Command fun pause(invoke: Invoke) { ensureController { it.pause(); invoke.resolve(true) } }
  @Command fun stop(invoke: Invoke) { ensureController { it.stop(); invoke.resolve(true) } }

  @Command
  fun seek(invoke: Invoke) {
    val args = invoke.parseArgs(PositionArgs::class.java)
    val target = args.seconds ?: args.positionSec ?: 0.0
    ensureController { mediaController ->
      mediaController.seekTo((target * 1000.0).toLong())
      invoke.resolve(statusPayload(mediaController))
    }
  }

  @Command
  fun set_rate(invoke: Invoke) {
    val args = invoke.parseArgs(RateArgs::class.java)
    ensureController { mediaController ->
      mediaController.setPlaybackSpeed(args.playbackRate.toFloat())
      invoke.resolve(true)
    }
  }

  @Command fun status(invoke: Invoke) { ensureController { invoke.resolve(statusPayload(it)) } }

  @Command
  fun now_playing(invoke: Invoke) {
    // Android Media3 metadata is supplied during prepare. Keep this command so the frontend can
    // update both platforms through the same command surface.
    invoke.resolve()
  }

  private fun ensureController(callback: (MediaController) -> Unit) {
    controller?.let(callback) ?: run {
      val intent = Intent(activity, ElephantPlaybackService::class.java)
      activity.startService(intent)
      val token = SessionToken(activity, ComponentName(activity, ElephantPlaybackService::class.java))
      val future = MediaController.Builder(activity, token).buildAsync()
      future.addListener({
        controller = future.get()
        callback(future.get())
      }, MoreExecutors.directExecutor())
    }
  }

  private fun statusPayload(mediaController: MediaController): Map<String, Any?> = mapOf(
    "nativeAvailable" to true,
    "episodeId" to currentEpisodeId,
    "playing" to mediaController.isPlaying,
    "positionSec" to (mediaController.currentPosition / 1000.0),
    "durationSec" to mediaController.duration.takeIf { it > 0 }?.let { it / 1000.0 },
    "playbackRate" to mediaController.playbackParameters.speed.toDouble(),
    "message" to null
  )
}
