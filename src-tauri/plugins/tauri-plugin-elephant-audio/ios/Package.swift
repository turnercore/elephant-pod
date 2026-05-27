// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "ElephantAudioPlugin",
  platforms: [.iOS(.v15)],
  products: [.library(name: "ElephantAudioPlugin", targets: ["ElephantAudioPlugin"])],
  dependencies: [.package(name: "Tauri", path: "../../../../.tauri/tauri-api")],
  targets: [.target(name: "ElephantAudioPlugin", dependencies: ["Tauri"])]
)
