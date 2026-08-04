import SwiftUI
import UIKit

struct CheckInView: View {
  @Bindable var model: CheckInModel

  @Environment(\.openURL) private var openURL
  @AppStorage(AppConfiguration.aiProcessingConsentKey)
  private var hasAllowedThirdPartyAIProcessing = false
  @FocusState private var composerFocused: Bool
  @State private var presentedSheet: CheckInSheet?
  @State private var copiedReply = false

  private let starters = [
    Starter(
      title: "Everything feels urgent",
      message: "Everything feels urgent and I cannot tell what to do first."
    ),
    Starter(
      title: "I haven't eaten",
      message: "I have not eaten and everything feels impossible right now."
    ),
    Starter(
      title: "I'm stuck on a message",
      message: "I need to send a difficult message, but I keep spiraling instead."
    ),
  ]

  var body: some View {
    ZStack {
      CalmBackground()

      ScrollView {
        VStack(spacing: 18) {
          header

          if let response = model.response {
            ResponseCard(
              response: response,
              copiedReply: copiedReply,
              copyAction: copyReply,
              clearAction: model.clearResponse,
              openURL: openURL
            )
            .transition(.opacity.combined(with: .move(edge: .bottom)))
          } else {
            starterCard
          }

          if let errorMessage = model.errorMessage {
            ErrorCard(
              message: errorMessage,
              reference: model.errorReference
            )
          }
        }
        .frame(maxWidth: 680)
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 150)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      Composer(
        draft: $model.draft,
        isFocused: $composerFocused,
        isSending: model.isSending,
        canSend: model.canSend,
        remainingCharacters: model.remainingCharacters,
        awaitingSafetyAnswer: model.awaitingSafetyAnswer,
        sendAction: send
      )
    }
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          presentedSheet = .about
        } label: {
          Label("Information", systemImage: "info.circle")
        }
        .accessibilityIdentifier("infoButton")
      }
    }
    .toolbarBackground(.hidden, for: .navigationBar)
    .sheet(item: $presentedSheet) { destination in
      switch destination {
      case .about:
        InfoView()
      case .aiProcessingConsent:
        AIProcessingConsentView(sendAction: sendAuthorizedMessage)
      }
    }
    .animation(.easeOut(duration: 0.22), value: model.response)
    .sensoryFeedback(.success, trigger: model.response?.reply)
    .onChange(of: model.draft) { _, newValue in
      if newValue.count > AppConfiguration.maximumMessageLength {
        model.draft = String(newValue.prefix(AppConfiguration.maximumMessageLength))
      }
    }
  }

  private var header: some View {
    VStack(spacing: 9) {
      Image(systemName: "leaf.fill")
        .font(.system(size: 32, weight: .semibold))
        .foregroundStyle(Color(red: 0.10, green: 0.28, blue: 0.21))
        .accessibilityHidden(true)

      Text("Get unstuck.")
        .font(.largeTitle.bold())
        .multilineTextAlignment(.center)
        .foregroundStyle(.primary)

      Text("Tell Stabilize what is happening. Get one clear next step.")
        .font(.headline)
        .fontWeight(.regular)
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)

      Text("Free AI support for overloaded moments—not emergency care.")
        .font(.footnote)
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
    }
    .padding(.top, 8)
  }

  private var starterCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Start here")
        .font(.headline)

      ForEach(starters) { starter in
        Button {
          model.useStarter(starter.message)
          composerFocused = true
        } label: {
          HStack(spacing: 12) {
            Text(starter.title)
              .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "arrow.down.to.line")
              .foregroundStyle(.secondary)
          }
          .padding(14)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityIdentifier("starter-\(starter.id)")
      }

      Text("No on-device transcript. Provider storage applies. Adults 18+.")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
    .padding(18)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
    .overlay {
      RoundedRectangle(cornerRadius: 24)
        .stroke(.white.opacity(0.46), lineWidth: 1)
    }
  }

  private func send() {
    composerFocused = false

    guard hasAllowedThirdPartyAIProcessing else {
      presentedSheet = .aiProcessingConsent
      return
    }

    sendAuthorizedMessage()
  }

  private func sendAuthorizedMessage() {
    Task {
      await model.send()
    }
  }

  private func copyReply() {
    guard let reply = model.response?.reply else { return }
    UIPasteboard.general.string = reply
    copiedReply = true
    Task {
      try? await Task.sleep(for: .seconds(1.4))
      copiedReply = false
    }
  }
}

private enum CheckInSheet: String, Identifiable {
  case about
  case aiProcessingConsent

  var id: String { rawValue }
}

private struct Starter: Identifiable {
  let title: String
  let message: String

  var id: String { title }
}

private struct Composer: View {
  @Binding var draft: String
  var isFocused: FocusState<Bool>.Binding
  let isSending: Bool
  let canSend: Bool
  let remainingCharacters: Int
  let awaitingSafetyAnswer: Bool
  let sendAction: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if awaitingSafetyAnswer {
        Label("Reply yes, no, or unsure.", systemImage: "exclamationmark.shield")
          .font(.footnote.weight(.semibold))
          .foregroundStyle(.primary)
      }

      HStack(alignment: .bottom, spacing: 10) {
        ZStack(alignment: .topLeading) {
          if draft.isEmpty {
            Text("What is happening right now?")
              .foregroundStyle(.tertiary)
              .padding(.horizontal, 12)
              .padding(.vertical, 13)
              .allowsHitTesting(false)
          }

          TextEditor(text: $draft)
            .focused(isFocused)
            .scrollContentBackground(.hidden)
            .frame(minHeight: 48, maxHeight: 116)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .accessibilityLabel("Your message")
            .accessibilityIdentifier("messageEditor")
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))

        Button(action: sendAction) {
          Group {
            if isSending {
              ProgressView()
                .tint(.white)
            } else {
              Image(systemName: "arrow.up")
                .font(.headline.bold())
            }
          }
          .frame(width: 50, height: 50)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .background(
          canSend
            ? Color(red: 0.09, green: 0.27, blue: 0.20)
            : Color.secondary.opacity(0.42),
          in: Circle()
        )
        .disabled(!canSend)
        .accessibilityLabel(isSending ? "Sending" : "Send")
        .accessibilityIdentifier("sendButton")
      }

      if remainingCharacters < 400 {
        Text("\(remainingCharacters) characters remaining")
          .font(.caption2)
          .foregroundStyle(remainingCharacters < 100 ? .red : .secondary)
          .frame(maxWidth: .infinity, alignment: .trailing)
      }
    }
    .padding(.horizontal, 14)
    .padding(.top, 12)
    .padding(.bottom, 8)
    .background(.ultraThinMaterial)
    .overlay(alignment: .top) {
      Divider().opacity(0.35)
    }
  }
}

private struct ResponseCard: View {
  let response: ChatResponse
  let copiedReply: Bool
  let copyAction: () -> Void
  let clearAction: () -> Void
  let openURL: OpenURLAction

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Label(
        response.showEmergency ? "Urgent next step" : "Stabilize",
        systemImage: response.showEmergency ? "exclamationmark.triangle.fill" : "leaf.fill"
      )
      .font(.headline)
      .foregroundStyle(response.showEmergency ? .red : .primary)

      MarkdownText(markdown: response.reply)
        .font(.body)
        .lineSpacing(4)
        .accessibilityIdentifier("assistantReply")

      if response.showEmergency {
        EmergencyActions(openURL: openURL)
      }

      HStack(spacing: 12) {
        Button(action: copyAction) {
          Label(
            copiedReply ? "Copied" : "Copy", systemImage: copiedReply ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.bordered)

        ShareLink(item: response.reply) {
          Label("Share", systemImage: "square.and.arrow.up")
        }
        .buttonStyle(.bordered)

        Spacer()

        if !response.awaitingSafetyAnswer {
          Button("New check-in", action: clearAction)
            .buttonStyle(.bordered)
        }
      }
      .font(.subheadline)
    }
    .padding(20)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
    .overlay {
      RoundedRectangle(cornerRadius: 24)
        .stroke(
          response.showEmergency ? Color.red.opacity(0.55) : Color.white.opacity(0.5),
          lineWidth: response.showEmergency ? 2 : 1
        )
    }
  }
}

private struct EmergencyActions: View {
  let openURL: OpenURLAction

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("In the United States")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)

      HStack(spacing: 10) {
        Button {
          openURL(URL(string: "tel://988")!)
        } label: {
          Label("Call 988", systemImage: "phone.fill")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)

        Button {
          openURL(URL(string: "sms:988")!)
        } label: {
          Label("Text 988", systemImage: "message.fill")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
      }

      Button(role: .destructive) {
        openURL(URL(string: "tel://911")!)
      } label: {
        Label(
          "Call 911 for immediate danger or a medical emergency", systemImage: "cross.case.fill"
        )
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(.bordered)
    }
    .accessibilityElement(children: .contain)
  }
}

private struct ErrorCard: View {
  let message: String
  let reference: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      Label("Couldn't send", systemImage: "wifi.exclamationmark")
        .font(.headline)
      Text(message)
      if let reference {
        Text("Error reference: \(reference)")
          .font(.caption.monospaced())
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(16)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
    .overlay {
      RoundedRectangle(cornerRadius: 18)
        .stroke(Color.orange.opacity(0.55), lineWidth: 1)
    }
    .accessibilityIdentifier("errorCard")
  }
}
