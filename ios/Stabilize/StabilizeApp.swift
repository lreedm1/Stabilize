import SwiftUI

@main
struct StabilizeApp: App {
    @State private var session = ChatSession()

    var body: some Scene {
        WindowGroup {
            ChatView(session: session)
        }
    }
}
