import SwiftUI

/// Swift mirror of contracts/design-tokens.json.
///
/// This is a hand-maintained port, not a JSON loader: the token file is a
/// cross-platform contract owned by Track 0, values are copied here 1:1.
/// If contracts/design-tokens.json changes, update this file to match and
/// note it in SYNC.md under "Contract-Änderungen" (or, if *this* file
/// drifts from the contract, flag it there as an iOS-side follow-up).
enum DesignTokens {

    enum Color {
        static let accent = SwiftUI.Color(hex: "#1D9E75")
        static let danger = SwiftUI.Color(hex: "#D85A30")
        static let dangerText = SwiftUI.Color(hex: "#993C1D")
        static let warning = SwiftUI.Color(hex: "#EF9F27")
        static let success = SwiftUI.Color(hex: "#1D9E75")

        // Light/dark resolved dynamically via SwiftUI.Color(light:dark:) below,
        // matching design-tokens.json "color.light" / "color.dark".
        static let surfacePage = SwiftUI.Color(
            light: "#FAFAF8", dark: "#141414"
        )
        static let surfaceCard = SwiftUI.Color(
            light: "#FFFFFF", dark: "#1E1E1E"
        )
        static let textPrimary = SwiftUI.Color(
            light: "#141414", dark: "#FAFAF8"
        )
        static let textSecondary = SwiftUI.Color(
            light: "#6B6B66", darkOpacity: (white: 1, opacity: 0.75)
        )
        static let textMuted = SwiftUI.Color(
            light: "#9A9A94", darkOpacity: (white: 1, opacity: 0.4)
        )
        static let border = SwiftUI.Color(
            light: "#EAEAE6", dark: "#2A2A2A"
        )
    }

    enum Typography {
        static let fontFamily = "system-ui" // -> .system() font on iOS

        enum Size {
            static let caption: CGFloat = 11
            static let small: CGFloat = 12
            static let body: CGFloat = 13
            static let bodyLarge: CGFloat = 14
            static let heading: CGFloat = 15
        }

        enum Weight {
            static let regular: SwiftUI.Font.Weight = .regular // 400
            static let medium: SwiftUI.Font.Weight = .medium   // 500
        }
    }

    enum Radius {
        static let control: CGFloat = 8
        static let card: CGFloat = 12
        static let pill: CGFloat = 20
    }

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
    }
}

extension SwiftUI.Color {
    /// #RRGGBB or #RRGGBBAA hex initializer (design-tokens.json ships plain hex strings).
    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        s.removeAll { $0 == "#" }
        var value: UInt64 = 0
        Scanner(string: s).scanHexInt64(&value)

        let r, g, b, a: Double
        switch s.count {
        case 8:
            r = Double((value >> 24) & 0xFF) / 255
            g = Double((value >> 16) & 0xFF) / 255
            b = Double((value >> 8) & 0xFF) / 255
            a = Double(value & 0xFF) / 255
        default: // 6
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8) & 0xFF) / 255
            b = Double(value & 0xFF) / 255
            a = 1.0
        }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }

    /// Dynamic color resolving to a plain hex in light mode and either a
    /// plain hex or a white-with-opacity value in dark mode, matching how
    /// design-tokens.json expresses "dark" colors (some are plain hex,
    /// some are `rgba(255,255,255, x)`).
    init(light: String, dark: String) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(SwiftUI.Color(hex: dark)) : UIColor(SwiftUI.Color(hex: light))
        })
        #else
        self.init(hex: light)
        #endif
    }

    init(light: String, darkOpacity: (white: Double, opacity: Double)) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(white: darkOpacity.white, alpha: darkOpacity.opacity)
                : UIColor(SwiftUI.Color(hex: light))
        })
        #else
        self.init(hex: light)
        #endif
    }
}
