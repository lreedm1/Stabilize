import Foundation

protocol StabilizeAPI: Sendable {
  func send(
    message: String,
    awaitingSafetyAnswer: Bool
  ) async throws -> ChatResponse
}

enum StabilizeAPIError: Error, LocalizedError, Equatable, Sendable {
  case invalidRequest
  case invalidResponse
  case server(status: Int, message: String, reference: String?)
  case offline
  case timedOut
  case cancelled
  case transport

  var errorDescription: String? {
    switch self {
    case .invalidRequest:
      return "Please enter a message."
    case .invalidResponse:
      return "Stabilize returned an unreadable response. Try again."
    case .server(_, let message, _):
      return message
    case .offline:
      return "Stabilize couldn't reach the internet. Check your connection and try again."
    case .timedOut:
      return "The reply took too long. Try sending the message again."
    case .cancelled:
      return "The request was cancelled."
    case .transport:
      return "Stabilize couldn't reach the service. Try again in a moment."
    }
  }

  var reference: String? {
    guard case .server(_, _, let reference) = self else { return nil }
    return reference
  }
}

struct LiveStabilizeAPI: StabilizeAPI {
  private let session: URLSession
  private let chatURL: URL

  init(
    session: URLSession = .shared,
    chatURL: URL = AppConfiguration.chatURL
  ) {
    self.session = session
    self.chatURL = chatURL
  }

  func send(
    message: String,
    awaitingSafetyAnswer: Bool
  ) async throws -> ChatResponse {
    let request = try Self.makeRequest(
      chatURL: chatURL,
      message: message,
      awaitingSafetyAnswer: awaitingSafetyAnswer
    )

    do {
      let (data, response) = try await session.data(for: request)
      guard let httpResponse = response as? HTTPURLResponse else {
        throw StabilizeAPIError.invalidResponse
      }

      guard (200..<300).contains(httpResponse.statusCode) else {
        let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data)
        throw StabilizeAPIError.server(
          status: httpResponse.statusCode,
          message: payload?.error ?? "Stabilize couldn't get a reply this time.",
          reference: payload?.reference
        )
      }

      let decoded = try JSONDecoder().decode(ChatResponse.self, from: data)
      guard !decoded.reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw StabilizeAPIError.invalidResponse
      }
      return decoded
    } catch let error as StabilizeAPIError {
      throw error
    } catch let error as URLError {
      switch error.code {
      case .notConnectedToInternet, .networkConnectionLost:
        throw StabilizeAPIError.offline
      case .timedOut:
        throw StabilizeAPIError.timedOut
      case .cancelled:
        throw StabilizeAPIError.cancelled
      default:
        throw StabilizeAPIError.transport
      }
    } catch is CancellationError {
      throw StabilizeAPIError.cancelled
    } catch {
      throw StabilizeAPIError.invalidResponse
    }
  }

  static func makeRequest(
    chatURL: URL,
    message: String,
    awaitingSafetyAnswer: Bool
  ) throws -> URLRequest {
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw StabilizeAPIError.invalidRequest
    }

    var request = URLRequest(
      url: chatURL,
      cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
      timeoutInterval: AppConfiguration.requestTimeout
    )
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
    request.setValue("Stabilize-iOS/1", forHTTPHeaderField: "X-Stabilize-Client")
    request.httpBody = try JSONEncoder().encode(
      ChatRequest(
        message: String(trimmed.prefix(AppConfiguration.maximumMessageLength)),
        awaitingSafetyAnswer: awaitingSafetyAnswer
      )
    )
    return request
  }
}

struct PreviewStabilizeAPI: StabilizeAPI {
  func send(
    message: String,
    awaitingSafetyAnswer: Bool
  ) async throws -> ChatResponse {
    try await Task.sleep(for: .milliseconds(250))

    let normalized = message.lowercased()

    if !awaitingSafetyAnswer,
      normalized.contains("review safety check") || normalized.contains("not sure i am safe")
    {
      return ChatResponse(
        route: "SAFETY_UNCLEAR",
        reply: "Might you hurt yourself in the next few hours? Reply yes, no, or unsure.",
        showEmergency: false,
        awaitingSafetyAnswer: true
      )
    }

    if awaitingSafetyAnswer {
      if normalized.contains("yes") || normalized.contains("unsure") {
        return ChatResponse(
          route: "IMMEDIATE_DANGER",
          reply:
            "Move toward a safe person or staffed place now. In the U.S., call or text 988. If an attempt, overdose, serious injury, or immediate danger may be happening, call 911 or go to an emergency department. Tell someone: “I may not be safe alone right now. Please stay with me.”",
          showEmergency: true,
          awaitingSafetyAnswer: false
        )
      }

      if normalized.contains("no") {
        return ChatResponse(
          route: "SUPPORT",
          reply:
            "Thank you for answering. Since you are not in immediate danger, lower the load first: move near a safe person or into a calmer shared place, then choose one small body or logistics need to handle next.",
          showEmergency: false,
          awaitingSafetyAnswer: false
        )
      }

      return ChatResponse(
        route: "SAFETY_UNCLEAR",
        reply: "Please reply yes, no, or unsure: might you hurt yourself in the next few hours?",
        showEmergency: false,
        awaitingSafetyAnswer: true
      )
    }

    return ChatResponse(
      route: "DIRECT",
      reply:
        "The smallest useful move is to lower the load before solving the whole problem. Put both feet on the floor, take one slow breath, and write the next task in a single sentence. Then do only its first two-minute step.",
      showEmergency: false,
      awaitingSafetyAnswer: false
    )
  }
}
