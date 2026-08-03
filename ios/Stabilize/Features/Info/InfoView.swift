import SwiftUI

enum InfoDestination: String, Identifiable {
  case about

  var id: String { rawValue }
}

struct InfoView: View {
  let initialDestination: InfoDestination

  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL

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
            "The native app does not intentionally save your prompt or reply. Messages are sent to Stabilize's Cloudflare Worker and ordinary AI replies are processed by OpenAI. Guest app chats do not create server-side conversation memory."
          )
          .font(.footnote)
          .foregroundStyle(.secondary)
          LinkRow(
            title: "Privacy policy", systemImage: "hand.raised", url: AppConfiguration.privacyURL)
          LinkRow(
            title: "Safety and limits", systemImage: "shield", url: AppConfiguration.safetyURL)
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
