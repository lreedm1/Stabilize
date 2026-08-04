import SwiftUI

struct MarkdownText: View {
  let markdown: String

  private var attributed: AttributedString {
    (try? AttributedString(
      markdown: markdown,
      options: AttributedString.MarkdownParsingOptions(
        interpretedSyntax: .full,
        failurePolicy: .returnPartiallyParsedIfPossible
      )
    )) ?? AttributedString(markdown)
  }

  var body: some View {
    Text(attributed)
      .textSelection(.enabled)
  }
}
