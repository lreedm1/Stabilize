import Foundation

struct ChatRequest: Codable, Equatable, Sendable {
  let message: String
  let awaitingSafetyAnswer: Bool
}

struct ChatResponse: Codable, Equatable, Sendable {
  let route: String
  let reply: String
  let showEmergency: Bool
  let awaitingSafetyAnswer: Bool
}

struct APIErrorPayload: Decodable, Equatable, Sendable {
  let error: String
  let reference: String?
}
