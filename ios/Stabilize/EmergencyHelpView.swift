import SwiftUI

struct EmergencyHelpView: View {
    let message: String

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            ZStack {
                NatureBackground()

                ScrollView {
                    VStack(spacing: 16) {
                        AdaptiveSurface {
                            VStack(alignment: .leading, spacing: 14) {
                                Label(
                                    "Move toward human help now",
                                    systemImage: "exclamationmark.triangle.fill"
                                )
                                .font(.title2.weight(.bold))
                                .foregroundStyle(.red)

                                Text(message)
                                    .font(.body)
                                    .textSelection(.enabled)

                                Text("Stabilize cannot call, text, dispatch, or monitor help for you.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(20)
                        }

                        emergencyButton(
                            title: "Call 911",
                            subtitle: "Immediate danger, overdose, serious injury, or medical emergency",
                            symbol: "phone.fill",
                            url: URL(string: "tel://911")
                        )

                        emergencyButton(
                            title: "Call 988",
                            subtitle: "U.S. Suicide & Crisis Lifeline",
                            symbol: "phone.fill",
                            url: URL(string: "tel://988")
                        )

                        emergencyButton(
                            title: "Text 988",
                            subtitle: "U.S. Suicide & Crisis Lifeline",
                            symbol: "message.fill",
                            url: URL(string: "sms:988")
                        )
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Urgent help")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
            }
        }
        .interactiveDismissDisabled(false)
    }

    private func emergencyButton(
        title: String,
        subtitle: String,
        symbol: String,
        url: URL?
    ) -> some View {
        Button {
            guard let url else { return }
            openURL(url)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.title3)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.headline)
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }

                Spacer()

                Image(systemName: "arrow.up.right")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(16)
        }
        .buttonStyle(.borderedProminent)
        .tint(.red)
    }
}
