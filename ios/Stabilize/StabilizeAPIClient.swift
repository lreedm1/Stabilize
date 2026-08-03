import Foundation

struct StabilizeChatResponse: Decodable, Sendable {
    let route: String
    let reply: String
    let showEmergency: Bool?
    let awaitingSafetyAnswer: Bool?
}

private struct StabilizeChatRequest: Encodable {
    let message: String
    let awaitingSafetyAnswer: Bool
}

private struct StabilizeErrorResponse: Decodable {
    let error: String
    let reference: String?
}

enum StabilizeAPIError: LocalizedError {
    case invalidResponse
    case service(message: String, reference: String?)
    case connection

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Stabilize returned an unreadable response. Try again."
        case let .service(message, reference):
            guard let reference, !reference.isEmpty else {
                return message
            }
            return "\(message)\n\nError reference: \(reference)"
        case .connection:
            return "Stabilize couldn't reach the site. Check your connection and try again."
        }
    }
}

actor StabilizeAPIClient {
    private let endpoint: URL
    private let session: URLSession

    init(endpoint: URL = AppConfiguration.chatEndpoint) {
        self.endpoint = endpoint

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = AppConfiguration.requestTimeout
        configuration.timeoutIntervalForResource = AppConfiguration.requestTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.waitsForConnectivity = true

        session = URLSession(configuration: configuration)
    }

    func send(
        message: String,
        awaitingSafetyAnswer: Bool
    ) async throws -> StabilizeChatResponse {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = AppConfiguration.requestTimeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(
            StabilizeChatRequest(
                message: message,
                awaitingSafetyAnswer: awaitingSafetyAnswer
            )
        )

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw StabilizeAPIError.connection
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw StabilizeAPIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if let serviceError = try? JSONDecoder().decode(
                StabilizeErrorResponse.self,
                from: data
            ) {
                throw StabilizeAPIError.service(
                    message: serviceError.error,
                    reference: serviceError.reference
                )
            }
            throw StabilizeAPIError.invalidResponse
        }

        do {
            return try JSONDecoder().decode(StabilizeChatResponse.self, from: data)
        } catch {
            throw StabilizeAPIError.invalidResponse
        }
    }
}
