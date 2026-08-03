import Foundation
import Observation

struct AlertPresentation: Identifiable {
    let id = UUID()
    let title: String
    let message: String
}

@MainActor
@Observable
final class ChatSession {
    var messages: [ChatMessage] = []
    var draft = ""
    var isSending = false
    var alert: AlertPresentation?
    var awaitingSafetyAnswer = false
    var emergencyReply: String?

    private let apiClient: StabilizeAPIClient

    init(apiClient: StabilizeAPIClient = StabilizeAPIClient()) {
        self.apiClient = apiClient
    }

    var canSend: Bool {
        !isSending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func send() async {
        let trimmed = draft
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .prefix(AppConfiguration.maximumMessageLength)

        let text = String(trimmed)
        guard !text.isEmpty, !isSending else { return }

        draft = ""
        isSending = true

        let userMessage = ChatMessage(role: .user, text: text)
        messages.append(userMessage)

        defer {
            isSending = false
        }

        do {
            let response = try await apiClient.send(
                message: text,
                awaitingSafetyAnswer: awaitingSafetyAnswer
            )

            awaitingSafetyAnswer = response.awaitingSafetyAnswer ?? false
            let isUrgent = response.showEmergency ?? false

            messages.append(
                ChatMessage(
                    role: .assistant,
                    text: response.reply,
                    route: response.route,
                    isUrgent: isUrgent
                )
            )

            emergencyReply = isUrgent ? response.reply : nil
        } catch is CancellationError {
            restoreDraft(text, removing: userMessage.id)
        } catch {
            restoreDraft(text, removing: userMessage.id)
            alert = AlertPresentation(
                title: "Message not sent",
                message: (error as? LocalizedError)?.errorDescription
                    ?? "The request failed. Try again."
            )
        }
    }

    func startNewConversation() {
        messages.removeAll()
        draft = ""
        alert = nil
        awaitingSafetyAnswer = false
        emergencyReply = nil
    }

    func dismissEmergency() {
        emergencyReply = nil
    }

    private func restoreDraft(_ text: String, removing messageID: UUID) {
        if messages.last?.id == messageID {
            messages.removeLast()
        }

        if draft.isEmpty {
            draft = text
        }
    }
}
