package com.elephanthand.elephantears.audio

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.MoreExecutors

@InvokeArg
class PrepareArgs {
    lateinit var episodeId: String
    lateinit var sourceUrl: String
    lateinit var title: String
    lateinit var podcastTitle: String
    var artworkUrl: String? = null
    var durationSec: Double? = null
    var playbackRate: Double = 1.0
}

@InvokeArg
class PositionArgs {
    var positionSec: Double = 0.0
}

@TauriPlugin
class ElephantEarsAudioPlugin(private val activity: Activity) : Plugin(activity) {
    private var controller: MediaController? = null

    @Command
    fun prepare(invoke: Invoke) {
        val args = invoke.parseArgs(PrepareArgs::class.java)
        getController { mediaController ->
            val metadata = MediaMetadata.Builder()
                .setTitle(args.title)
                .setArtist(args.podcastTitle)
                .setArtworkUri(args.artworkUrl?.let(Uri::parse))
                .build()
            val item = MediaItem.Builder()
                .setUri(args.sourceUrl)
                .setMediaId(args.episodeId)
                .setMediaMetadata(metadata)
                .build()
            mediaController.setMediaItem(item)
            mediaController.prepare()
            mediaController.setPlaybackSpeed(args.playbackRate.toFloat())
            invoke.resolve()
        }
    }

    @Command
    fun play(invoke: Invoke) {
        val args = try { invoke.parseArgs(PositionArgs::class.java) } catch (_: Exception) { null }
        getController { mediaController ->
            args?.let { mediaController.seekTo((it.positionSec * 1000).toLong()) }
            mediaController.play()
            invoke.resolve()
        }
    }

    @Command
    fun pause(invoke: Invoke) {
        getController { mediaController ->
            mediaController.pause()
            invoke.resolve()
        }
    }

    @Command
    fun seek(invoke: Invoke) {
        val args = invoke.parseArgs(PositionArgs::class.java)
        getController { mediaController ->
            mediaController.seekTo((args.positionSec * 1000).toLong())
            invoke.resolve()
        }
    }

    @Command
    fun clear(invoke: Invoke) {
        getController { mediaController ->
            mediaController.stop()
            mediaController.clearMediaItems()
            invoke.resolve()
        }
    }

    private fun getController(callback: (MediaController) -> Unit) {
        controller?.let(callback) ?: run {
            val token = SessionToken(activity, ComponentName(activity, ElephantEarsPlaybackService::class.java))
            val future = MediaController.Builder(activity, token).buildAsync()
            future.addListener({
                controller = future.get()
                callback(future.get())
            }, MoreExecutors.directExecutor())
            activity.startService(Intent(activity, ElephantEarsPlaybackService::class.java))
        }
    }

    private fun emitCommand(command: String, seconds: Double? = null) {
        val payload = JSObject()
        payload.put("command", command)
        seconds?.let { payload.put("seconds", it) }
        trigger("elephant-ears://media-command", payload)
    }
}
