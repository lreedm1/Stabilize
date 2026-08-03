import SwiftUI

struct ComposerView: View {
    @Bindable var session: ChatSession
    @AppStorage(AppConfiguration.aiProcessingConsentKey)
    private var hasAllowedThirdPartyAIProcessing = false
    @FocusState private var isFocused: Bool
    @State private var isShowingAIProcessingConsent = false

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
                    requestSend()
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
        .sheet(isPresented: $isShowingAIProcessingConsent) {
            AIProcessingConsentView {
                hasAllowedThirdPartyAIProcessing = true

                Task {
                    await session.send()
                }
            }
        }
    }

    @ViewBuilder
    private var sendButton: some View {
        if #available(iOS 26.0, *) {
            Button {
                requestSend()
            } label: {
                sendIcon
            }
            .buttonStyle(.glassProminent)
            .disabled(!session.canSend)
            .accessibilityLabel("Send")
        } else {
            Button {
                requestSend()
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

    private func requestSend() {
        guard session.canSend else { return }

        guard hasAllowedThirdPartyAIProcessing else {
            isShowingAIProcessingConsent = true
            return
        }

        Task {
            await session.send()
        }
    }
}

private struct AIProcessingConsentView: View {
    @Environment(\.dismiss) private var dismiss

    let onAllow: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Label("Your message and third-party AI", systemImage: "lock.shield.fill")
                    .font(.title2.weight(.semibold))

                Text(
                    "Stabilize sends the message you wrote to stabilize.info. "
                        + "For ordinary replies, the service shares it with OpenAI, "
                        + "a third-party AI provider. Your message may include "
                        + "personal information."
                )

                Text(
                    "Nothing is sent until you choose Allow & Send Message. "
                        + "You can revoke this permission at any time in About; "
                        + "your next message will ask again."
                )
                .foregroundStyle(.secondary)

                Link(destination: AppConfiguration.privacyURL) {
                    Label("Read Privacy Policy", systemImage: "hand.raised.fill")
                }

                Spacer(minLength: 0)

                Button {
                    dismiss()
                    onAllow()
                } label: {
                    Text("Allow & Send Message")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityHint(
                    "Allows this message and future messages to be shared with OpenAI"
                )

                Button("Not Now", role: .cancel) {
                    dismiss()
                }
                .frame(maxWidth: .infinity)
                .accessibilityHint("Keeps your draft without sending it")
            }
            .padding(24)
            .navigationTitle("Before Sending")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
