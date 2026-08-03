import Foundation

enum AppConfiguration {
    static let baseURL = URL(string: "https://stabilize.info")!
    static let chatEndpoint = baseURL.appending(path: "api/chat")
    static let privacyURL = baseURL.appending(path: "privacy.html")
    static let safetyURL = baseURL.appending(path: "safety.html")
    static let supportURL = baseURL.appending(path: "support.html")
    static let aiProcessingConsentKey = "hasAllowedThirdPartyAIProcessing"
    static let requestTimeout: TimeInterval = 65
    static let maximumMessageLength = 4_000
}
