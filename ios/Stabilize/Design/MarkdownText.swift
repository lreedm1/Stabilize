import Foundation
import SwiftUI

struct MarkdownText: View {
  let markdown: String

  private static let allowedLinkSchemes: Set<String> = ["http", "https", "mailto", "tel"]

  private var attributed: AttributedString {
    Self.attributedString(from: markdown)
  }

  static func attributedString(from markdown: String) -> AttributedString {
    var attributed = (try? AttributedString(
      markdown: markdown,
      options: AttributedString.MarkdownParsingOptions(
        interpretedSyntax: .full,
        failurePolicy: .returnPartiallyParsedIfPossible
      )
    )) ?? AttributedString(markdown)

    let untrustedLinkRanges = attributed.runs.compactMap { run -> Range<AttributedString.Index>? in
      guard let link = run.link else { return nil }
      guard let scheme = link.scheme?.lowercased() else { return run.range }
      return allowedLinkSchemes.contains(scheme) ? nil : run.range
    }

    for range in untrustedLinkRanges {
      attributed[range].link = nil
    }

    return attributed
  }

  var body: some View {
    Text(attributed)
      .textSelection(.enabled)
  }
}
