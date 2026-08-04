import Foundation

enum AppConfiguration {
  static let serviceRoot = URL(string: "https://stabilize.info")!
  static let chatURL = serviceRoot.appending(path: "api/chat")
  static let websiteURL = serviceRoot
  static let aboutURL = serviceRoot.appending(path: "about.html")
  static let safetyURL = serviceRoot.appending(path: "safety.html")
  static let privacyURL = serviceRoot.appending(path: "privacy.html")
  static let supportURL = serviceRoot.appending(path: "support.html")
  static let aiProcessingConsentKey = "hasAllowedThirdPartyAIProcessing"

  static let maximumMessageLength = 4_000
  static let requestTimeout: TimeInterval = 45
}
