import XCTest

@testable import Stabilize

@MainActor
final class CheckInModelTests: XCTestCase {
  func testSuccessfulSendClearsDraftAndUpdatesSafetyState() async {
    let response = ChatResponse(
      route: "SAFETY_UNCLEAR",
      reply: "Reply yes, no, or unsure.",
      showEmergency: false,
      awaitingSafetyAnswer: true
    )
    let model = CheckInModel(api: StubAPI(result: .success(response)))
    model.draft = "I do not know if I am safe."

    await model.send()

    XCTAssertEqual(model.response, response)
    XCTAssertEqual(model.draft, "")
    XCTAssertTrue(model.awaitingSafetyAnswer)
    XCTAssertNil(model.errorMessage)
  }

  func testFailedSendRestoresDraft() async {
    let model = CheckInModel(api: StubAPI(result: .failure(.offline)))
    model.draft = "I need help sorting this out."

    await model.send()

    XCTAssertEqual(model.draft, "I need help sorting this out.")
    XCTAssertEqual(model.errorMessage, StabilizeAPIError.offline.errorDescription)
    XCTAssertNil(model.response)
  }
}

private struct StubAPI: StabilizeAPI {
  let result: Result<ChatResponse, StabilizeAPIError>

  func send(
    message: String,
    awaitingSafetyAnswer: Bool
  ) async throws -> ChatResponse {
    try result.get()
  }
}
