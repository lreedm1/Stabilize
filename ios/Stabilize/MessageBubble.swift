import SwiftUI

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user {
                Spacer(minLength: 48)
            }

            bubble

            if message.role == .assistant {
                Spacer(minLength: 32)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            message.role == .user ? "Your message" : "Stabilize response"
        )
    }

    @ViewBuilder
    private var bubble: some View {
        if message.role == .user {
            Text(message.text)
                .font(.body)
                .foregroundStyle(.white)
                .textSelection(.enabled)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    Color.accentColor.opacity(0.88),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                )
        } else {
            AdaptiveSurface(cornerRadius: 22) {
                VStack(alignment: .leading, spacing: 10) {
                    if message.isUrgent {
                        Label("Urgent human help", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.red)
                    }

                    Text(message.text)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .textSelection(.enabled)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
        }
    }
}
