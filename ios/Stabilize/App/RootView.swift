import SwiftUI

struct RootView: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var model: CheckInModel

  init(api: any StabilizeAPI) {
    _model = State(initialValue: CheckInModel(api: api))
  }

  var body: some View {
    ZStack {
      NavigationStack {
        CheckInView(model: model)
      }

      if scenePhase != .active {
        PrivacyCover()
          .transition(.opacity)
          .zIndex(10)
      }
    }
    .animation(.easeOut(duration: 0.12), value: scenePhase)
  }
}

private struct PrivacyCover: View {
  var body: some View {
    ZStack {
      Color(red: 0.12, green: 0.29, blue: 0.23)
        .ignoresSafeArea()

      VStack(spacing: 12) {
        Image(systemName: "leaf.fill")
          .font(.system(size: 36, weight: .semibold))
          .accessibilityHidden(true)

        Text("Stabilize")
          .font(.title.bold())

        Text("Your check-in is hidden while the app is in the background.")
          .font(.subheadline)
          .multilineTextAlignment(.center)
          .foregroundStyle(.white.opacity(0.86))
          .frame(maxWidth: 320)
      }
      .foregroundStyle(.white)
      .padding(28)
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Stabilize. Your check-in is hidden while the app is in the background.")
  }
}

#Preview {
  RootView(api: PreviewStabilizeAPI())
}
