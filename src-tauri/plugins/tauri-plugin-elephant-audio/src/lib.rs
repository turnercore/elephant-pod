mod models;

use tauri::{plugin::{Builder, TauriPlugin}, AppHandle, Manager, Runtime};
pub use models::*;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use std::sync::{Mutex, OnceLock};

#[cfg(not(any(target_os = "ios", target_os = "android")))]
static STATUS: OnceLock<Mutex<AudioStatus>> = OnceLock::new();

#[cfg(any(target_os = "ios", target_os = "android"))]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.elephanthand.elephantpod.audio";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_elephant_audio);

struct ElephantAudio<R: Runtime> {
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    _marker: std::marker::PhantomData<fn() -> R>,
    #[cfg(any(target_os = "ios", target_os = "android"))]
    mobile_plugin_handle: PluginHandle<R>,
}

#[cfg(any(target_os = "ios", target_os = "android"))]
impl<R: Runtime> ElephantAudio<R> {
    fn run<T: serde::de::DeserializeOwned>(&self, command: &str, payload: impl serde::Serialize) -> Result<T, String> {
        self.mobile_plugin_handle
            .run_mobile_plugin(command, payload)
            .map_err(|error| error.to_string())
    }
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn status_store() -> &'static Mutex<AudioStatus> {
    STATUS.get_or_init(|| Mutex::new(AudioStatus {
        native_available: false,
        episode_id: None,
        playing: false,
        position_sec: 0.0,
        duration_sec: None,
        playback_rate: 1.0,
        message: Some("Native mobile bridge not bound in this desktop build.".to_string()),
    }))
}

#[tauri::command]
fn capabilities<R: Runtime>(_app: AppHandle<R>) -> AudioCapabilities {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        if let Ok(capabilities) = _app.state::<ElephantAudio<R>>().run("capabilities", serde_json::json!({})) {
            return capabilities;
        }
    }

    AudioCapabilities {
        available: false,
        background_playback: false,
        lock_screen_controls: false,
        media_session: false,
        silence_shortening: false,
        reason: Some("Native audio plugin is not available in this build.".to_string()),
    }
}

#[tauri::command(rename_all = "camelCase")]
fn prepare<R: Runtime>(
    _app: AppHandle<R>,
    episode_id: String,
    url: String,
    title: String,
    podcast_title: String,
    artwork_url: Option<String>,
    duration_sec: Option<f64>,
    start_sec: f64,
    playback_rate: f64,
) -> Result<bool, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        let request = PrepareRequest { episode_id, url, title, podcast_title, artwork_url, duration_sec, start_sec, playback_rate };
        _app.state::<ElephantAudio<R>>().run("prepare", request)
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let _ = (&url, &title, &podcast_title, &artwork_url, duration_sec);
        let mut status = status_store().lock().map_err(|error| error.to_string())?;
        status.episode_id = Some(episode_id);
        status.position_sec = start_sec;
        status.playback_rate = playback_rate;
        status.playing = false;
        Ok(false)
    }
}

#[tauri::command]
fn now_playing<R: Runtime>(_app: AppHandle<R>, payload: NowPlayingRequest) -> Result<(), String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        _app.state::<ElephantAudio<R>>().run("now_playing", serde_json::json!({ "payload": payload }))
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let mut status = status_store().lock().map_err(|error| error.to_string())?;
        status.episode_id = Some(payload.episode_id.clone());
        status.position_sec = payload.elapsed_sec;
        status.duration_sec = payload.duration_sec;
        status.playback_rate = payload.playback_rate;
        status.playing = payload.playing;
        Ok(())
    }
}

#[tauri::command]
fn play<R: Runtime>(_app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        _app.state::<ElephantAudio<R>>().run("play", serde_json::json!({}))
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let mut status = status_store().lock().map_err(|error| error.to_string())?;
        status.playing = true;
        Ok(false)
    }
}

#[tauri::command]
fn pause<R: Runtime>(_app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        _app.state::<ElephantAudio<R>>().run("pause", serde_json::json!({}))
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let mut status = status_store().lock().map_err(|error| error.to_string())?;
        status.playing = false;
        Ok(false)
    }
}

#[tauri::command]
fn stop<R: Runtime>(_app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        _app.state::<ElephantAudio<R>>().run("stop", serde_json::json!({}))
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let mut status = status_store().lock().map_err(|error| error.to_string())?;
        status.playing = false;
        status.position_sec = 0.0;
        Ok(false)
    }
}

#[tauri::command]
fn seek<R: Runtime>(_app: AppHandle<R>, seconds: Option<f64>, position_sec: Option<f64>) -> Result<AudioStatus, String> {
    let target = seconds.or(position_sec).unwrap_or(0.0).max(0.0);
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        _app.state::<ElephantAudio<R>>().run("seek", serde_json::json!({ "seconds": target, "positionSec": target }))
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let mut status = status_store().lock().map_err(|error| error.to_string())?;
        status.position_sec = target;
        Ok(status.clone())
    }
}

#[tauri::command(rename_all = "camelCase")]
fn set_rate<R: Runtime>(_app: AppHandle<R>, playback_rate: f64) -> Result<bool, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        _app.state::<ElephantAudio<R>>().run("set_rate", serde_json::json!({ "playbackRate": playback_rate, "playback_rate": playback_rate }))
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let mut status = status_store().lock().map_err(|error| error.to_string())?;
        status.playback_rate = playback_rate.clamp(0.5, 3.0);
        Ok(false)
    }
}

#[tauri::command]
fn status<R: Runtime>(_app: AppHandle<R>) -> Result<AudioStatus, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        _app.state::<ElephantAudio<R>>().run("status", serde_json::json!({}))
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        Ok(status_store().lock().map_err(|error| error.to_string())?.clone())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("elephant-audio")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let handle = _api.register_android_plugin(PLUGIN_IDENTIFIER, "ElephantAudioPlugin")?;
            #[cfg(target_os = "ios")]
            let handle = _api.register_ios_plugin(init_plugin_elephant_audio)?;

            app.manage(ElephantAudio {
                #[cfg(not(any(target_os = "ios", target_os = "android")))]
                _marker: std::marker::PhantomData::<fn() -> R>,
                #[cfg(any(target_os = "ios", target_os = "android"))]
                mobile_plugin_handle: handle,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capabilities,
            prepare,
            now_playing,
            play,
            pause,
            stop,
            seek,
            set_rate,
            status
        ])
        .build()
}
