import SwiftUI

enum AppTheme: String, Codable, CaseIterable, Identifiable, Hashable {
  case light
  case dark
  case vaporwave

  static let currentSchemaVersion = 1

  var id: String { rawValue }

  var title: String {
    switch self {
    case .light: "Light"
    case .dark: "Dark"
    case .vaporwave: "Vaporwave"
    }
  }

  var colorScheme: ColorScheme? {
    switch self {
    case .light: .light
    case .dark, .vaporwave: .dark
    }
  }

  var style: AppThemeStyle {
    switch self {
    case .light:
      AppThemeStyle(
        background: Color(.systemGroupedBackground),
        surface: Color(.secondarySystemGroupedBackground),
        elevatedSurface: Color(.systemBackground),
        tint: .accentColor,
        secondaryTint: .blue,
        artworkTint: .blue,
        separatorOpacity: 0.45,
        shadow: .black.opacity(0.12),
        glow: .clear,
        isVaporwave: false
      )
    case .dark:
      AppThemeStyle(
        background: Color(red: 0.055, green: 0.063, blue: 0.078),
        surface: Color(red: 0.092, green: 0.105, blue: 0.128),
        elevatedSurface: Color(red: 0.12, green: 0.135, blue: 0.16),
        tint: Color(red: 0.52, green: 0.72, blue: 1),
        secondaryTint: Color(red: 0.44, green: 0.88, blue: 0.82),
        artworkTint: Color(red: 0.38, green: 0.58, blue: 0.95),
        separatorOpacity: 0.32,
        shadow: .black.opacity(0.34),
        glow: Color(red: 0.24, green: 0.47, blue: 0.95).opacity(0.18),
        isVaporwave: false
      )
    case .vaporwave:
      AppThemeStyle(
        background: Color(red: 0.035, green: 0, blue: 0.078),
        surface: Color(red: 0.102, green: 0.063, blue: 0.235).opacity(0.92),
        elevatedSurface: Color(red: 0.072, green: 0.018, blue: 0.142).opacity(0.94),
        tint: Color(red: 0, green: 1, blue: 1),
        secondaryTint: Color(red: 1, green: 0, blue: 1),
        artworkTint: Color(red: 1, green: 0.6, blue: 0),
        separatorOpacity: 0.58,
        shadow: Color(red: 1, green: 0, blue: 1).opacity(0.24),
        glow: Color(red: 0, green: 1, blue: 1).opacity(0.28),
        isVaporwave: true
      )
    }
  }
}

struct AppThemeStyle {
  var background: Color
  var surface: Color
  var elevatedSurface: Color
  var tint: Color
  var secondaryTint: Color
  var artworkTint: Color
  var separatorOpacity: Double
  var shadow: Color
  var glow: Color
  var isVaporwave: Bool
}

private struct AppThemeStyleKey: EnvironmentKey {
  static let defaultValue = AppTheme.light.style
}

extension EnvironmentValues {
  var appThemeStyle: AppThemeStyle {
    get { self[AppThemeStyleKey.self] }
    set { self[AppThemeStyleKey.self] = newValue }
  }
}

struct AppThemeBackground: View {
  var theme: AppTheme

  var body: some View {
    ZStack {
      theme.style.background
      switch theme {
      case .light:
        Color.clear
      case .dark:
        RadialGradient(
          colors: [theme.style.glow, .clear],
          center: .topTrailing,
          startRadius: 20,
          endRadius: 420
        )
      case .vaporwave:
        VaporwaveBackdrop()
      }
    }
  }
}

struct AppThemeForegroundEffects: View {
  var theme: AppTheme

  var body: some View {
    if theme == .vaporwave {
      ZStack {
        ScanlineOverlay()
          .opacity(0.18)
        VStack {
          LinearGradient(
            colors: [
              Color(red: 0, green: 1, blue: 1).opacity(0.18),
              Color(red: 1, green: 0, blue: 1).opacity(0.08),
              .clear
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
          )
          .frame(height: 140)
          Spacer()
        }
      }
      .allowsHitTesting(false)
    }
  }
}

private struct VaporwaveBackdrop: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
      let phase = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
      ZStack {
        LinearGradient(
          colors: [
            Color(red: 0.035, green: 0, blue: 0.078),
            Color(red: 0.13, green: 0.02, blue: 0.28),
            Color(red: 0.018, green: 0.03, blue: 0.12)
          ],
          startPoint: .top,
          endPoint: .bottom
        )
        Circle()
          .fill(
            LinearGradient(
              colors: [
                Color(red: 1, green: 0.6, blue: 0).opacity(0.48),
                Color(red: 1, green: 0, blue: 1).opacity(0.24)
              ],
              startPoint: .top,
              endPoint: .bottom
            )
          )
          .frame(width: 360, height: 360)
          .blur(radius: 64)
          .offset(y: -260 + CGFloat(sin(phase * 0.55)) * 8)
        VaporwaveGrid()
          .stroke(Color(red: 0, green: 1, blue: 1).opacity(0.24), lineWidth: 0.8)
          .frame(height: 280)
          .offset(y: 260)
        LinearGradient(
          stops: [
            .init(color: .clear, location: 0),
            .init(color: Color(red: 1, green: 0, blue: 1).opacity(0.10), location: 0.55),
            .init(color: Color(red: 0, green: 1, blue: 1).opacity(0.12), location: 1)
          ],
          startPoint: .top,
          endPoint: .bottom
        )
        ScanlineOverlay()
          .opacity(reduceMotion ? 0.16 : 0.22 + 0.04 * sin(phase * 2.4))
      }
    }
  }
}

private struct VaporwaveGrid: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    let spacing: CGFloat = 28
    var y = rect.minY
    while y <= rect.maxY {
      path.move(to: CGPoint(x: rect.minX, y: y))
      path.addLine(to: CGPoint(x: rect.maxX, y: y))
      y += spacing
    }
    var x = rect.minX
    while x <= rect.maxX {
      path.move(to: CGPoint(x: x, y: rect.minY))
      path.addLine(to: CGPoint(x: rect.midX + (x - rect.midX) * 1.7, y: rect.maxY))
      x += spacing
    }
    return path
  }
}

private struct ScanlineOverlay: View {
  var body: some View {
    GeometryReader { proxy in
      Path { path in
        var y: CGFloat = 0
        while y < proxy.size.height {
          path.move(to: CGPoint(x: 0, y: y))
          path.addLine(to: CGPoint(x: proxy.size.width, y: y))
          y += 4
        }
      }
      .stroke(.black.opacity(0.32), lineWidth: 1)
      .blendMode(.overlay)
    }
    .allowsHitTesting(false)
  }
}

struct ThemedContentSurface: ViewModifier {
  @Environment(\.appThemeStyle) private var theme

  func body(content: Content) -> some View {
    content
      .scrollContentBackground(.hidden)
      .background(theme.background)
  }
}

extension View {
  func themedContentSurface() -> some View {
    modifier(ThemedContentSurface())
  }
}
