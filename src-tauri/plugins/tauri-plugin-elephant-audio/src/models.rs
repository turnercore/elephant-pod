use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareRequest {
    pub episode_id: String,
    pub url: String,
    pub title: String,
    pub podcast_title: String,
    pub artwork_url: Option<String>,
    pub start_sec: f64,
    pub playback_rate: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingRequest {
    pub episode_id: String,
    pub title: String,
    pub podcast_title: String,
    pub artwork_url: Option<String>,
    pub duration_sec: Option<f64>,
    pub elapsed_sec: f64,
    pub playback_rate: f64,
    pub playing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCapabilities {
    pub available: bool,
    pub background_playback: bool,
    pub lock_screen_controls: bool,
    pub media_session: bool,
    pub silence_shortening: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub native_available: bool,
    pub episode_id: Option<String>,
    pub playing: bool,
    pub position_sec: f64,
    pub duration_sec: Option<f64>,
    pub playback_rate: f64,
    pub message: Option<String>,
}
