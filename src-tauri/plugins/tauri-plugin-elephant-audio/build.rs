fn main() {
    tauri_plugin::Builder::new(&[
        "capabilities",
        "prepare",
        "now_playing",
        "play",
        "pause",
        "stop",
        "seek",
        "set_rate",
        "status",
    ])
    .android_path("android")
    .ios_path("ios")
    .build();
}
