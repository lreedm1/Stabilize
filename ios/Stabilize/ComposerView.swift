import SwiftUI

struct ComposerView: View {
    @Bindable var session: ChatSession
    @FocusState private var isFocused: Bool

    var body: some View {
        AdaptiveSurface(cornerRadius: 26) {
            HStack(alignment: .bottom, spacing: 10) {
                TextField(
                    "What is happening right now?",
                    text: $session.draft,
                    axis: .vertical
                )
                .focused($isFocused)
                .lineLimit(1...6)
                .textFieldStyle(.plain)
                .submitLabel(.send)
                .disabled(session.isSending)
                .onSubmit {
                    guard session.canSend else { return }
                    Task {
                        await session.send()
                    }
                }
                .onChange(of: session.draft) {
                    if session.draft.count > AppConfiguration.maximumMessageLength {
                        session.draft = String(
                            session.draft.prefix(
                                AppConfiguration.maximumMessageLength
                            )
                        )
                    }
                }
                .accessibilityLabel("Your message")

                sendButton
            }
            .padding(12)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var sendButton: some View {
        if #available(iOS 26.0, *) {
            Button {
                Task {
                    await session.send()
                }
            } label: {
                sendIcon
            }
            .buttonStyle(.glassProminent)
            .disabled(!session.canSend)
            .accessibilityLabel("Send")
        } else {
            Button {
                Task {
                    await session.send()
                }
            } label: {
                sendIcon
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.circle)
            .disabled(!session.canSend)
            .accessibilityLabel("Send")
        }
    }

    private var sendIcon: some View {
        Image(systemName: "arrow.up")
            .font(.headline.weight(.bold))
            .frame(width: 24, height: 24)
    }
}
