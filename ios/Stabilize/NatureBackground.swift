import SwiftUI

struct NatureBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            LinearGradient(
                colors: colorScheme == .dark
                    ? [
                        Color(red: 0.04, green: 0.10, blue: 0.13),
                        Color(red: 0.08, green: 0.18, blue: 0.18),
                        Color(red: 0.12, green: 0.22, blue: 0.18)
                    ]
                    : [
                        Color(red: 0.78, green: 0.88, blue: 0.86),
                        Color(red: 0.55, green: 0.72, blue: 0.66),
                        Color(red: 0.30, green: 0.48, blue: 0.38)
                    ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Circle()
                .fill(.white.opacity(colorScheme == .dark ? 0.06 : 0.28))
                .frame(width: 260, height: 260)
                .blur(radius: 24)
                .offset(x: 130, y: -260)

            MountainShape(amplitude: 0.16, baseline: 0.54)
                .fill(.black.opacity(colorScheme == .dark ? 0.22 : 0.10))
                .offset(y: 20)

            MountainShape(amplitude: 0.22, baseline: 0.68)
                .fill(.black.opacity(colorScheme == .dark ? 0.34 : 0.17))
                .offset(y: 70)

            LinearGradient(
                colors: [
                    .clear,
                    .black.opacity(colorScheme == .dark ? 0.30 : 0.10)
                ],
                startPoint: .center,
                endPoint: .bottom
            )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

private struct MountainShape: Shape {
    let amplitude: CGFloat
    let baseline: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let width = rect.width
        let height = rect.height

        path.move(to: CGPoint(x: 0, y: height))

        for step in 0...24 {
            let progress = CGFloat(step) / 24
            let x = progress * width
            let firstWave = sin(progress * .pi * 3.2)
            let secondWave = sin(progress * .pi * 7.0 + 0.8) * 0.28
            let y = height * (baseline - amplitude * (firstWave + secondWave))
            path.addLine(to: CGPoint(x: x, y: y))
        }

        path.addLine(to: CGPoint(x: width, y: height))
        path.closeSubpath()
        return path
    }
}
