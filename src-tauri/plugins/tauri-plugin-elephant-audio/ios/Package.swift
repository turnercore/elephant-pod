// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-elephant-audio",
  platforms: [.iOS(.v15)],
  products: [.library(name: "tauri-plugin-elephant-audio", type: .static, targets: ["tauri-plugin-elephant-audio"])],
  dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
  targets: [.target(name: "tauri-plugin-elephant-audio", dependencies: ["Tauri"], path: "Sources/ElephantAudioPlugin")]
)
