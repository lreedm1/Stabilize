import SwiftUI

struct ConversationView: View {
    let messages: [ChatMessage]
    let isSending: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                AdaptiveGlassContainer(spacing: 14) {
                    LazyVStack(spacing: 14) {
                        if messages.isEmpty {
                            WelcomeCard()
                                .padding(.top, 42)
                        }

                        ForEach(messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }

                        if isSending {
                            ThinkingBubble()
                                .id("thinking")
                        }

                        Color.clear
                            .frame(height: 1)
                            .id("bottom")
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.count) {
                scrollToBottom(proxy)
            }
            .onChange(of: isSending) {
                scrollToBottom(proxy)
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.22)) {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }
}

private struct WelcomeCard: View {
    var body: some View {
        AdaptiveSurface {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: "leaf.fill")
                    .font(.title2)
                    .foregroundStyle(.secondary)

                Text("What is happening right now?")
                    .font(.title2.weight(.semibold))

                Text("Free AI support for overloaded moments—not emergency care.")
                    .font(.body)
                    .foregroundStyle(.secondary)

                Text("Guest chats are not remembered by the server. This on-screen conversation clears when you start over or close the app.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
    }
}

private struct ThinkingBubble: View {
    var body: some View {
        HStack {
            AdaptiveSurface(cornerRadius: 20) {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Thinking…")
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }

            Spacer(minLength: 80)
        }
        .accessibilityLabel("Stabilize is thinking")
    }
}
