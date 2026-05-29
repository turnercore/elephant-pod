mod downloads;
mod native_audio;

#[tauri::command]
fn platform_name() -> &'static str {
    std::env::consts::OS
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_elephant_audio::init())
        .invoke_handler(tauri::generate_handler![
            platform_name,
            downloads::download_episode,
            downloads::delete_downloaded_episode,
            downloads::downloaded_episode_path,
            downloads::download_storage_stats,
            downloads::prune_downloads,
            native_audio::native_audio_prepare,
            native_audio::native_audio_set_playback_state,
            native_audio::native_audio_set_silence_shortening,
            native_audio::native_audio_clear_session,
            native_audio::audio_capabilities,
            native_audio::audio_prepare,
            native_audio::audio_now_playing,
            native_audio::audio_play,
            native_audio::audio_pause,
            native_audio::audio_stop,
            native_audio::audio_seek,
            native_audio::audio_set_rate,
            native_audio::audio_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Elephant Pod");
}
