import XCTest

@testable import Stabilize

final class StabilizeAPITests: XCTestCase {
  func testRequestUsesNativeNonBrowserContract() throws {
    let request = try LiveStabilizeAPI.makeRequest(
      chatURL: URL(string: "https://stabilize.info/api/chat")!,
      message: "  I feel overloaded.  ",
      awaitingSafetyAnswer: true
    )

    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
    XCTAssertEqual(
      request.value(forHTTPHeaderField: "Content-Type"), "application/json; charset=utf-8")
    XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))

    let body = try XCTUnwrap(request.httpBody)
    let decoded = try JSONDecoder().decode(ChatRequest.self, from: body)
    XCTAssertEqual(decoded.message, "I feel overloaded.")
    XCTAssertTrue(decoded.awaitingSafetyAnswer)
  }

  func testRequestRejectsWhitespaceOnlyMessage() {
    XCTAssertThrowsError(
      try LiveStabilizeAPI.makeRequest(
        chatURL: URL(string: "https://stabilize.info/api/chat")!,
        message: "   \n ",
        awaitingSafetyAnswer: false
      )
    ) { error in
      XCTAssertEqual(error as? StabilizeAPIError, .invalidRequest)
    }
  }

  func testChatResponseDecodesFixedRoute() throws {
    let data = Data(
      #"{"route":"SAFETY_UNCLEAR","reply":"Might you hurt yourself in the next few hours?","showEmergency":false,"awaitingSafetyAnswer":true}"#
        .utf8
    )

    let response = try JSONDecoder().decode(ChatResponse.self, from: data)

    XCTAssertEqual(response.route, "SAFETY_UNCLEAR")
    XCTAssertTrue(response.awaitingSafetyAnswer)
    XCTAssertFalse(response.showEmergency)
  }
}
