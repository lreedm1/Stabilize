import SwiftUI

struct InfoView: View {
  @Environment(\.dismiss) private var dismiss
  @AppStorage(AppConfiguration.aiProcessingConsentKey)
  private var hasAllowedThirdPartyAIProcessing = false

  var body: some View {
    NavigationStack {
      List {
        Section {
          VStack(alignment: .leading, spacing: 10) {
            Text("Stabilize")
              .font(.title2.bold())
            Text(
              "A floor-first AI check-in for overloaded moments. It aims to reduce cognitive load and help identify one safe, manageable next step."
            )
            .foregroundStyle(.secondary)
          }
          .padding(.vertical, 6)
        }

        Section("Important limits") {
          Label("Not therapy or diagnosis", systemImage: "person.crop.circle.badge.exclamationmark")
          Label("Not emergency care", systemImage: "cross.case")
          Label("Cannot guarantee safety or accuracy", systemImage: "checkmark.shield")
          Text(
            "For immediate danger or a medical emergency, contact a person or service able to respond now."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
        }

        Section("Privacy") {
          Text(
            "The native app does not intentionally save your prompt or reply. Messages are sent to Stabilize's Cloudflare Worker and ordinary AI replies are shared with OpenAI. Stabilize uses store: true, so OpenAI currently stores resulting Responses API data for at least 30 days unless project data controls override the request."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
          LinkRow(
            title: "Privacy policy", systemImage: "hand.raised", url: AppConfiguration.privacyURL)
          LinkRow(
            title: "Safety and limits", systemImage: "shield", url: AppConfiguration.safetyURL)
        }

        Section("AI sharing permission") {
          if hasAllowedThirdPartyAIProcessing {
            Text(
              "Allowed. Future messages may be shared with OpenAI for ordinary replies without asking again."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)

            Button("Revoke AI sharing permission", role: .destructive) {
              hasAllowedThirdPartyAIProcessing = false
            }
            .accessibilityHint("Makes Stabilize ask again before sending another message")
            .accessibilityIdentifier("revokeAIProcessingButton")
          } else {
            Text(
              "Not allowed. Stabilize will ask before it sends a message that may be shared with OpenAI."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
          }

          Text("Revocation applies to future sends and cannot recall data already transmitted.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }

        Section("Project") {
          LinkRow(
            title: "About Stabilize", systemImage: "info.circle", url: AppConfiguration.aboutURL)
          LinkRow(
            title: "Support", systemImage: "questionmark.circle", url: AppConfiguration.supportURL)
          LinkRow(
            title: "Open stabilize.info", systemImage: "safari", url: AppConfiguration.websiteURL)
        }

        Section {
          HStack {
            Text("Version")
            Spacer()
            Text(versionText)
              .foregroundStyle(.secondary)
          }
          Text("Adults 18+. Built by Reed Lokken.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .navigationTitle("About")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
        }
      }
    }
  }

  private var versionText: String {
    let version =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
    return "\(version) (\(build))"
  }
}

private struct LinkRow: View {
  let title: String
  let systemImage: String
  let url: URL

  @Environment(\.openURL) private var openURL

  var body: some View {
    Button {
      openURL(url)
    } label: {
      HStack {
        Label(title, systemImage: systemImage)
        Spacer()
        Image(systemName: "arrow.up.right")
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
    }
    .foregroundStyle(.primary)
  }
}
