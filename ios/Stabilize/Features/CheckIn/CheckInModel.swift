import Foundation
import Observation

@MainActor
@Observable
final class CheckInModel {
  var draft = ""
  var response: ChatResponse?
  var isSending = false
  var errorMessage: String?
  var errorReference: String?
  var awaitingSafetyAnswer = false

  @ObservationIgnored
  private let api: any StabilizeAPI

  init(api: any StabilizeAPI) {
    self.api = api
  }

  var canSend: Bool {
    !isSending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var remainingCharacters: Int {
    max(0, AppConfiguration.maximumMessageLength - draft.count)
  }

  func useStarter(_ text: String) {
    draft = String(text.prefix(AppConfiguration.maximumMessageLength))
    errorMessage = nil
    errorReference = nil
  }

  func clearResponse() {
    guard !awaitingSafetyAnswer else { return }
    response = nil
    errorMessage = nil
    errorReference = nil
  }

  func send() async {
    guard canSend else { return }

    let originalDraft = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    let safetyState = awaitingSafetyAnswer
    draft = ""
    isSending = true
    errorMessage = nil
    errorReference = nil

    defer { isSending = false }

    do {
      let result = try await api.send(
        message: originalDraft,
        awaitingSafetyAnswer: safetyState
      )
      response = result
      awaitingSafetyAnswer = result.awaitingSafetyAnswer
    } catch let error as StabilizeAPIError {
      if error != .cancelled {
        draft = originalDraft
        errorMessage = error.errorDescription
        errorReference = error.reference
      }
    } catch {
      draft = originalDraft
      errorMessage = "Stabilize couldn't get a reply this time. Try again in a moment."
      errorReference = nil
    }
  }
}
