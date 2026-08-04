import SwiftUI

struct AIProcessingConsentView: View {
  @AppStorage(AppConfiguration.aiProcessingConsentKey)
  private var hasAllowedThirdPartyAIProcessing = false

  @Environment(\.dismiss) private var dismiss

  let sendAction: () -> Void

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          Label("Your message may contain personal information", systemImage: "hand.raised.fill")
            .font(.title2.bold())
            .foregroundStyle(Color(red: 0.09, green: 0.27, blue: 0.20))

          Text(
            "Stabilize sends your message to its Cloudflare-hosted service. For an ordinary AI reply, the service shares the message with OpenAI, a third-party AI provider. Some urgent messages receive a fixed response without an OpenAI request."
          )

          VStack(alignment: .leading, spacing: 12) {
            DisclosureRow(
              title: "What is shared",
              detail: "The message you choose to send and bounded request metadata needed to operate the service."
            )
            DisclosureRow(
              title: "Why it is shared",
              detail: "To generate and return an ordinary Stabilize reply."
            )
            DisclosureRow(
              title: "How long OpenAI stores it",
              detail: "Stabilize uses store: true. OpenAI currently documents at least 30 days of Responses API storage unless project data controls override the request."
            )
            DisclosureRow(
              title: "What the app keeps",
              detail: "The native app does not intentionally save a chat transcript. It remembers only this permission choice in app-specific settings."
            )
          }
          .padding(16)
          .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))

          Link(destination: AppConfiguration.privacyURL) {
            Label("Read the privacy policy", systemImage: "arrow.up.right.square")
          }

          Text(
            "Choosing Not now sends nothing. You can revoke permission later under About; revocation cannot recall a message already transmitted."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
        }
        .frame(maxWidth: 620, alignment: .leading)
        .padding(20)
        .frame(maxWidth: .infinity)
      }
      .navigationTitle("Before you send")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Not now") { dismiss() }
        }
      }
      .safeAreaInset(edge: .bottom, spacing: 0) {
        VStack(spacing: 10) {
          Button(action: allowAndSend) {
            Text("Allow & Send Message")
              .font(.headline)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 5)
          }
          .buttonStyle(.borderedProminent)
          .tint(Color(red: 0.09, green: 0.27, blue: 0.20))
          .accessibilityHint("Allows this and future messages to be shared with OpenAI")
          .accessibilityIdentifier("allowAIProcessingButton")

          Button("Not now", role: .cancel) { dismiss() }
            .accessibilityIdentifier("cancelAIProcessingButton")
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(.ultraThinMaterial)
      }
    }
  }

  private func allowAndSend() {
    hasAllowedThirdPartyAIProcessing = true
    dismiss()
    sendAction()
  }
}

private struct DisclosureRow: View {
  let title: String
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title)
        .font(.subheadline.weight(.semibold))
      Text(detail)
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

#Preview {
  AIProcessingConsentView(sendAction: {})
}
