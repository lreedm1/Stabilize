import SwiftUI

@main
struct StabilizeApp: App {
  private let api: any StabilizeAPI

  init() {
    if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
      api = PreviewStabilizeAPI()
    } else {
      api = LiveStabilizeAPI()
    }
  }

  var body: some Scene {
    WindowGroup {
      RootView(api: api)
    }
  }
}
