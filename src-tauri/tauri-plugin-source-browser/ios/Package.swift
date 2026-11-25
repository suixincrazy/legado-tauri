// swift-tools-version:5.5
import PackageDescription
let package = Package(
  name: "tauri-plugin-source-browser",
  platforms: [.iOS(.v15)],
  products: [.library(name: "tauri-plugin-source-browser", type: .static, targets: ["tauri-plugin-source-browser"])],
  dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
  targets: [.target(name: "tauri-plugin-source-browser", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
