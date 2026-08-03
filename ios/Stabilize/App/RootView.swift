import SwiftUI

struct RootView: View {
  @State private var model: CheckInModel

  init(api: any StabilizeAPI) {
    _model = State(initialValue: CheckInModel(api: api))
  }

  var body: some View {
    NavigationStack {
      CheckInView(model: model)
    }
  }
}

#Preview {
  RootView(api: PreviewStabilizeAPI())
}
