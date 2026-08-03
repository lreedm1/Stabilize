import SwiftUI

struct CalmBackground: View {
  var body: some View {
    GeometryReader { geometry in
      ZStack {
        LinearGradient(
          colors: [
            Color(red: 0.86, green: 0.91, blue: 0.84),
            Color(red: 0.64, green: 0.77, blue: 0.68),
            Color(red: 0.18, green: 0.35, blue: 0.28),
          ],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )

        Circle()
          .fill(.white.opacity(0.28))
          .frame(width: geometry.size.width * 0.72)
          .blur(radius: 44)
          .offset(
            x: geometry.size.width * 0.24,
            y: -geometry.size.height * 0.28
          )

        Path { path in
          let width = geometry.size.width
          let height = geometry.size.height
          path.move(to: CGPoint(x: 0, y: height * 0.62))
          path.addCurve(
            to: CGPoint(x: width, y: height * 0.50),
            control1: CGPoint(x: width * 0.24, y: height * 0.44),
            control2: CGPoint(x: width * 0.66, y: height * 0.70)
          )
          path.addLine(to: CGPoint(x: width, y: height))
          path.addLine(to: CGPoint(x: 0, y: height))
          path.closeSubpath()
        }
        .fill(Color(red: 0.12, green: 0.29, blue: 0.23).opacity(0.74))

        Path { path in
          let width = geometry.size.width
          let height = geometry.size.height
          path.move(to: CGPoint(x: width * 0.48, y: height))
          path.addCurve(
            to: CGPoint(x: width * 0.60, y: height * 0.49),
            control1: CGPoint(x: width * 0.52, y: height * 0.82),
            control2: CGPoint(x: width * 0.52, y: height * 0.61)
          )
          path.addCurve(
            to: CGPoint(x: width * 0.70, y: height * 0.36),
            control1: CGPoint(x: width * 0.63, y: height * 0.43),
            control2: CGPoint(x: width * 0.67, y: height * 0.39)
          )
        }
        .stroke(
          Color(red: 0.86, green: 0.82, blue: 0.66).opacity(0.62),
          style: StrokeStyle(lineWidth: max(24, geometry.size.width * 0.09), lineCap: .round)
        )
        .blur(radius: 1.5)
      }
      .ignoresSafeArea()
    }
    .accessibilityHidden(true)
  }
}
