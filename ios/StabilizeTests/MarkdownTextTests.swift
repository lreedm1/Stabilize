import XCTest

@testable import Stabilize

final class MarkdownTextTests: XCTestCase {
  func testAllowsOnlySupportedMarkdownLinkSchemes() throws {
    let attributed = MarkdownText.attributedString(
      from: """
        [HTTP](http://example.com) [HTTPS](HTTPS://example.com/help) \
        [Email](mailto:help@example.com) [Call](tel:988)
        """)

    let links = attributed.runs.compactMap { $0.link }

    XCTAssertEqual(
      links.map { $0.scheme?.lowercased() },
      ["http", "https", "mailto", "tel"])
  }

  func testStripsUntrustedMarkdownLinksWhilePreservingTheirText() throws {
    let attributed = MarkdownText.attributedString(
      from: """
        [Script](javascript:alert%281%29) [Data](data:text/plain,secret) \
        [File](file:///tmp/secret) [Custom](stabilize://settings) [Relative](/privacy)
        """)

    XCTAssertEqual(
      String(attributed.characters),
      "Script Data File Custom Relative")
    XCTAssertTrue(attributed.runs.allSatisfy { $0.link == nil })
  }
}
