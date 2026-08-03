import SwiftUI

struct InfoView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppConfiguration.aiProcessingConsentKey)
    private var hasAllowedThirdPartyAIProcessing = false

    var body: some View {
        NavigationStack {
            ZStack {
                NatureBackground()

                ScrollView {
                    AdaptiveGlassContainer(spacing: 14) {
                        VStack(spacing: 14) {
                            infoCard(
                                title: "What Stabilize is",
                                symbol: "leaf.fill",
                                text: "A free, floor-first AI check-in for adults 18+ in overloaded moments. It aims to reduce cognitive load and help identify one safe, reversible next step."
                            )

                            infoCard(
                                title: "What it is not",
                                symbol: "cross.case",
                                text: "Not therapy, diagnosis, medical care, emergency monitoring, or a substitute for a qualified professional or emergency service."
                            )

                            infoCard(
                                title: "Privacy",
                                symbol: "lock.shield",
                                text: "This native version uses guest chat only. For ordinary replies, messages go to stabilize.info, which sends them to OpenAI. The app asks for your permission before the first message is sent. The app does not store a transcript on disk, and its network session does not retain cookies. The visible conversation lasts only while the app remains open."
                            )

                            aiProcessingPermissionCard

                            infoCard(
                                title: "Urgent situations",
                                symbol: "exclamationmark.triangle",
                                text: "The server keeps its deterministic urgent-safety routes. When it marks a reply urgent, the app surfaces immediate human-help options. The app cannot contact help or guarantee safety for you."
                            )

                            VStack(spacing: 10) {
                                resourceLink(
                                    "Privacy Policy",
                                    symbol: "hand.raised.fill",
                                    destination: AppConfiguration.privacyURL
                                )

                                resourceLink(
                                    "Safety and Limits",
                                    symbol: "cross.case.fill",
                                    destination: AppConfiguration.safetyURL
                                )

                                resourceLink(
                                    "Contact Support",
                                    symbol: "questionmark.circle.fill",
                                    destination: AppConfiguration.supportURL
                                )
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle("About")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func infoCard(
        title: String,
        symbol: String,
        text: String
    ) -> some View {
        AdaptiveSurface {
            VStack(alignment: .leading, spacing: 10) {
                Label(title, systemImage: symbol)
                    .font(.headline)

                Text(text)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
        }
    }

    private func resourceLink(
        _ title: String,
        symbol: String,
        destination: URL
    ) -> some View {
        Link(destination: destination) {
            Label(title, systemImage: symbol)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }

    private var aiProcessingPermissionCard: some View {
        AdaptiveSurface {
            VStack(alignment: .leading, spacing: 10) {
                Label("AI sharing permission", systemImage: "person.crop.circle.badge.checkmark")
                    .font(.headline)

                if hasAllowedThirdPartyAIProcessing {
                    Text(
                        "Permission is currently granted. Revoking it stops future "
                            + "messages from being sent until you allow sharing again. "
                            + "Your current draft will not change."
                    )
                    .foregroundStyle(.secondary)

                    Button("Revoke AI Sharing Permission", role: .destructive) {
                        hasAllowedThirdPartyAIProcessing = false
                    }
                    .buttonStyle(.bordered)
                    .accessibilityHint(
                        "Makes Stabilize ask again before sending your next message to OpenAI"
                    )
                } else {
                    Text(
                        "Permission is not granted. Stabilize will ask before it sends "
                            + "your next message to OpenAI."
                    )
                    .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(18)
        }
    }
}
