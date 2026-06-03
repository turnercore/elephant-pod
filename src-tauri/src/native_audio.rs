use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaMetadata {
    pub episode_id: String,
    pub source_url: String,
    pub title: String,
    pub podcast_title: String,
    pub artwork_url: Option<String>,
    pub duration_sec: Option<f64>,
    pub playback_rate: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativePlaybackState {
    pub episode_id: Option<String>,
    pub playing: bool,
    pub position_sec: f64,
    pub duration_sec: Option<f64>,
    pub playback_rate: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeSilenceOptions {
    pub enabled: bool,
    pub threshold_db: f64,
    pub minimum_duration_sec: f64,
    pub boost_rate: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioCapabilities {
    pub available: bool,
    pub background_playback: bool,
    pub lock_screen_controls: bool,
    pub media_session: bool,
    pub silence_shortening: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub native_available: bool,
    pub episode_id: Option<String>,
    pub position_sec: f64,
    pub duration_sec: Option<f64>,
    pub playback_rate: f64,
    pub playing: bool,
    pub message: Option<String>,
}

static STATUS: OnceLock<Mutex<AudioStatus>> = OnceLock::new();

fn status_store() -> &'static Mutex<AudioStatus> {
    STATUS.get_or_init(|| {
        Mutex::new(AudioStatus {
            native_available: false,
            episode_id: None,
            position_sec: 0.0,
            duration_sec: None,
            playback_rate: 1.0,
            playing: false,
            message: Some(
                "Desktop shim active; mobile plugin owns AVPlayer/Media3 playback.".to_string(),
            ),
        })
    })
}

fn update_state(state: NativePlaybackState) -> Result<(), String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.episode_id = state.episode_id;
    status.position_sec = state.position_sec;
    status.duration_sec = state.duration_sec;
    status.playback_rate = state.playback_rate;
    status.playing = state.playing;
    Ok(())
}

#[tauri::command]
pub async fn native_audio_prepare(metadata: NativeMediaMetadata) -> Result<(), String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.episode_id = Some(metadata.episode_id);
    status.duration_sec = metadata.duration_sec;
    status.playback_rate = metadata.playback_rate;
    status.position_sec = 0.0;
    status.playing = false;
    Ok(())
}

#[tauri::command]
pub async fn native_audio_set_playback_state(state: NativePlaybackState) -> Result<(), String> {
    update_state(state)
}

#[tauri::command]
pub async fn native_audio_set_silence_shortening(
    options: NativeSilenceOptions,
) -> Result<(), String> {
    let _ = options;
    Ok(())
}

#[tauri::command]
pub async fn native_audio_clear_session() -> Result<(), String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.episode_id = None;
    status.position_sec = 0.0;
    status.duration_sec = None;
    status.playing = false;
    Ok(())
}

// Compatibility command set used by the frontend's optional native audio bridge. These commands
// keep desktop builds harmless while the real iOS/Android plugin handles actual playback.
#[tauri::command]
pub async fn audio_capabilities() -> Result<AudioCapabilities, String> {
    Ok(AudioCapabilities {
        available: false,
        background_playback: false,
        lock_screen_controls: false,
        media_session: false,
        silence_shortening: false,
        reason: Some("Native audio is available only in mobile builds with the Elephant Audio plugin installed.".to_string()),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn audio_prepare(
    episode_id: String,
    url: String,
    title: String,
    podcast_title: String,
    artwork_url: Option<String>,
    start_sec: f64,
    playback_rate: f64,
) -> Result<bool, String> {
    let _ = (url, title, podcast_title, artwork_url);
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.episode_id = Some(episode_id);
    status.position_sec = start_sec;
    status.playback_rate = playback_rate;
    status.playing = false;
    Ok(false)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingPayload {
    pub episode_id: String,
    pub duration_sec: Option<f64>,
    pub elapsed_sec: f64,
    pub playback_rate: f64,
    pub playing: bool,
}

#[tauri::command]
pub async fn audio_now_playing(payload: NowPlayingPayload) -> Result<(), String> {
    update_state(NativePlaybackState {
        episode_id: Some(payload.episode_id),
        playing: payload.playing,
        position_sec: payload.elapsed_sec,
        duration_sec: payload.duration_sec,
        playback_rate: payload.playback_rate,
    })
}

#[tauri::command]
pub async fn audio_play() -> Result<bool, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.playing = true;
    Ok(false)
}

#[tauri::command]
pub async fn audio_pause() -> Result<bool, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.playing = false;
    Ok(true)
}

#[tauri::command]
pub async fn audio_stop() -> Result<bool, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.playing = false;
    status.position_sec = 0.0;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn audio_seek(
    seconds: Option<f64>,
    position_sec: Option<f64>,
) -> Result<AudioStatus, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.position_sec = seconds
        .or(position_sec)
        .unwrap_or(status.position_sec)
        .max(0.0);
    Ok(status.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn audio_set_rate(playback_rate: f64) -> Result<bool, String> {
    let mut status = status_store().lock().map_err(|error| error.to_string())?;
    status.playback_rate = playback_rate.clamp(0.5, 3.0);
    Ok(true)
}

#[tauri::command]
pub async fn audio_status() -> Result<AudioStatus, String> {
    Ok(status_store()
        .lock()
        .map_err(|error| error.to_string())?
        .clone())
}
