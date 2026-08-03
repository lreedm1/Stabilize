import SwiftUI

struct ChatView: View {
    @Bindable var session: ChatSession
    @State private var activeSheet: ActiveSheet?

    var body: some View {
        NavigationStack {
            ZStack {
                NatureBackground()

                ConversationView(
                    messages: session.messages,
                    isSending: session.isSending
                )
            }
            .navigationTitle("Stabilize")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Image(systemName: "leaf.fill")
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }

                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        activeSheet = .info
                    } label: {
                        Image(systemName: "info.circle")
                    }
                    .accessibilityLabel("About Stabilize")

                    Button {
                        session.startNewConversation()
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .disabled(session.messages.isEmpty && session.draft.isEmpty)
                    .accessibilityLabel("Start over")
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ComposerView(session: session)
            }
            .overlay(alignment: .top) {
                if let emergencyReply = session.emergencyReply {
                    EmergencyBanner {
                        activeSheet = .emergency(emergencyReply)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.22), value: session.emergencyReply)
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .info:
                    InfoView()
                case let .emergency(message):
                    EmergencyHelpView(message: message)
                }
            }
            .alert(item: $session.alert) { alert in
                Alert(
                    title: Text(alert.title),
                    message: Text(alert.message),
                    dismissButton: .default(Text("OK"))
                )
            }
            .onChange(of: session.emergencyReply) {
                guard let message = session.emergencyReply else { return }
                activeSheet = .emergency(message)
            }
        }
    }
}

private enum ActiveSheet: Identifiable {
    case info
    case emergency(String)

    var id: String {
        switch self {
        case .info:
            return "info"
        case let .emergency(message):
            return "emergency-\(message.hashValue)"
        }
    }
}

private struct EmergencyBanner: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(
                "Urgent help options",
                systemImage: "exclamationmark.triangle.fill"
            )
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }
        .buttonStyle(.borderedProminent)
        .tint(.red)
        .accessibilityHint("Shows phone and text options for immediate human help")
    }
}
