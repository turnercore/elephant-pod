mod models;

use std::sync::{Mutex, OnceLock};
use tauri::{plugin::{Builder, TauriPlugin}, Runtime};
pub use models::*;

static STATUS: OnceLock<Mutex<AudioStatus>> = OnceLock::new();

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
fn capabilities() -> AudioCapabilities {
    AudioCapabilities {
        available: false,
        background_playback: false,
        lock_screen_controls: false,
        media_session: false,
        silence_shortening: false,
        reason: Some("Install the iOS/Android side of tauri-plugin-elephant-audio to enable AVPlayer/Media3 playback.".to_string()),
    }
}

#[tauri::command]
fn prepare(
    episode_id: String,
    url: String,
    title: String,
    podcast_title: String,
    artwork_url: Option<String>,
    start_sec: f64,
    playback_rate: f64,
) -> Result<bool, String> {
    let _request = PrepareRequest { episode_id: episode_id.clone(), url, title, podcast_title, artwork_url, start_sec, playback_rate };
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.episode_id = Some(episode_id);
    status.position_sec = start_sec;
    status.playback_rate = playback_rate;
    status.playing = false;
    Ok(false)
}

#[tauri::command]
fn now_playing(payload: NowPlayingRequest) -> Result<(), String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.episode_id = Some(payload.episode_id);
    status.position_sec = payload.elapsed_sec;
    status.duration_sec = payload.duration_sec;
    status.playback_rate = payload.playback_rate;
    status.playing = payload.playing;
    Ok(())
}

#[tauri::command]
fn play() -> Result<bool, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.playing = true;
    Ok(false)
}

#[tauri::command]
fn pause() -> Result<bool, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.playing = false;
    Ok(false)
}

#[tauri::command]
fn stop() -> Result<bool, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.playing = false;
    status.position_sec = 0.0;
    Ok(false)
}

#[tauri::command]
fn seek(seconds: Option<f64>, position_sec: Option<f64>) -> Result<AudioStatus, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.position_sec = seconds.or(position_sec).unwrap_or(0.0).max(0.0);
    Ok(status.clone())
}

#[tauri::command(rename_all = "camelCase")]
fn set_rate(playback_rate: f64) -> Result<bool, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.playback_rate = playback_rate.clamp(0.5, 3.0);
    Ok(false)
}

#[tauri::command]
fn status() -> Result<AudioStatus, String> {
    Ok(status_store().lock().map_err(|error| error.to_string())?.clone())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("elephant-audio")
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
