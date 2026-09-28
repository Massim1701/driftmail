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
        /// [2026-09-21] "Einstellungsbereich"-Auftrag (WEB_INBOX.md 21.09.):
        /// mutable now (was `let`) -- `AppEnvironment.applyAccentTheme()`
        /// overwrites this at runtime when the user picks a different theme
        /// in Settings. Views that already observe `environment` as an
        /// `@EnvironmentObject` (`FolderListView`, `MessageDetailView`,
        /// `OnboardingCapabilityCheckView`, `RootView`) pick up the new
        /// value on their next body re-evaluation, triggered by
        /// `AppEnvironment`'s own `@Published accentTheme` bump -- no need
        /// to touch every individual `DesignTokens.Color.accent` call site.
        /// `AppLockGateView`/`OnboardingAccountConnectView` intentionally
        /// keep reading the static default: both run before any settings
        /// have loaded (lock screen / onboarding), so there is no
        /// personalized theme to reflect there yet.
        // [2026-09-25] WEB_INBOX.md 24.09. "DESIGN-RICHTUNG PRAEZISIERT -
        // Outlook-inspiriert": Default-Akzent auf Microsoft-Blau umgestellt
        // (ersetzt das vorherige Teal), siehe contracts/design-tokens.json
        // `color.accent` + `AccentTheme.outlookBlue`.
        // [2026-09-28] Redesign: Default `AccentTheme.gruen` (hell/dunkel
        // dynamisch), siehe Models/UserSettings.swift.
        static var accent = AccentTheme.gruen.color
        /// [2026-09-28] Redesign "ruhig & warm": Markenfarbe fuer Logo,
        /// Zweig-Deko und Fokus -- NICHT fuer Text/Buttons (bei Gruen/Gelb
        /// auf hellem Grund unter 3:1), dafuer ist `accent` da.
        static var brand = AccentTheme.gruen.brandColor
        /// Hintergrund/Text der ausgewaehlten Zeile bzw. des aktiven Ordners,
        /// folgt dem Akzent-Theme (design-tokens.json
        /// `accentThemes[].selectedBg/selectedText`).
        static var selectedBackground = AccentTheme.gruen.selectedBackground
        static var selectedText = AccentTheme.gruen.selectedText

        // [2026-09-28] Sicherheits-Farbrollen: fest fuer alle Themes, jetzt
        // mit eigenen Dunkel-Werten (design-tokens.json `danger*`,
        // `warning*`, `dangerDark`).
        static let danger = SwiftUI.Color(light: "#B3261E", dark: "#E5605A")
        static let dangerBg = SwiftUI.Color(light: "#FBE9E7", dark: "#2E1918")
        static let dangerText = SwiftUI.Color(light: "#A1231B", dark: "#F2B8B5")
        static let warning = SwiftUI.Color(light: "#B7791F", dark: "#E0A84A")
        static let warningBg = SwiftUI.Color(light: "#F6E7C8", dark: "#33280F")
        static let warningText = SwiftUI.Color(light: "#7A5212", dark: "#F0C877")
        static let success = SwiftUI.Color(light: "#2A7D50", dark: "#5CC08A")

        // [2026-09-28] Redesign "ruhig & warm": warmes Elfenbein statt Weiss,
        // gruenlich getoentes Dunkel (design-tokens.json `color.light/.dark`).
        static let surfacePage = SwiftUI.Color(light: "#F6F4EE", dark: "#121714")
        static let surfaceSidebar = SwiftUI.Color(light: "#EEECE3", dark: "#0E1310")
        static let surfaceList = SwiftUI.Color(light: "#FBFAF6", dark: "#141A16")
        static let surfaceCard = SwiftUI.Color(light: "#FFFFFF", dark: "#181F1B")
        static let surfaceSubtle = SwiftUI.Color(light: "#F4F7F1", dark: "#18211C")
        static let textPrimary = SwiftUI.Color(light: "#1F2A24", dark: "#E9EEE8")
        static let textSecondary = SwiftUI.Color(light: "#4A554E", dark: "#C9D1CA")
        static let textMuted = SwiftUI.Color(light: "#626C65", dark: "#909B93")
        static let border = SwiftUI.Color(light: "#E3E0D6", dark: "#26302A")
        static let borderSubtle = SwiftUI.Color(light: "#EEEBE3", dark: "#1F2722")
    }

    enum Typography {
        static let fontFamily = "system-ui" // -> .system() font on iOS

        // [2026-09-28] Redesign: etwas groesser (design-tokens.json
        // typography.sizes), plus `title` fuer die Serif-Ueberschriften.
        enum Size {
            static let caption: CGFloat = 12
            static let small: CGFloat = 13
            static let body: CGFloat = 15
            static let bodyLarge: CGFloat = 16
            static let heading: CGFloat = 17
            static let title: CGFloat = 28
        }

        enum Weight {
            static let regular: SwiftUI.Font.Weight = .regular   // 400
            static let medium: SwiftUI.Font.Weight = .medium     // 500
            static let semibold: SwiftUI.Font.Weight = .semibold // 600
        }

        /// [2026-09-28] Ueberschriften in der eingebauten Serif-Schrift
        /// (New York), Gegenstueck zu Fraunces auf Web -- kein eigener
        /// Font-Import noetig (design-tokens.json `fontFamilyDisplayIos`).
        static func display(_ size: CGFloat, weight: SwiftUI.Font.Weight = .medium) -> SwiftUI.Font {
            .system(size: size, weight: weight, design: .serif)
        }
    }

    enum Radius {
        // [2026-09-25] WEB_INBOX.md 24.09. Outlook-Design: "dezente Rundung
        // (4px), keine starken Schatten" -- control/card von vormals 8/12
        // auf 4 reduziert (Fluent-Stil statt Card-Schatten-Optik).
        // [2026-09-28] Redesign "ruhig & warm": weichere Rundung (10/14).
        static let control: CGFloat = 10
        static let card: CGFloat = 14
        static let pill: CGFloat = 20
    }

    enum Spacing {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
    }

    /// Swift mirror of design-tokens.json `systemFolders` /
    /// `customFolder`. [2026-09-08] Contract-Änderung: replaces the old
    /// `folders` array (5 fixed folders) — folders are now user-manageable,
    /// so this only ships the *defaults* used to seed a new account's
    /// system folders (`Models/Folder.swift` carries the actual per-folder
    /// data coming back from the API). Used by `MockAPIClient` to seed
    /// `MockDatabase.json`-shaped data and by the UI as a fallback label/
    /// icon before the real folder list has loaded.
    enum SystemFolders {
        struct SystemDefault {
            let systemKey: SystemFolderKey
            let defaultLabel: String
            let icon: String
            /// design-tokens.json `colorRole: "danger"` (quarantaene only).
            let usesDangerColor: Bool
            /// design-tokens.json `muted: true` (spam only).
            let isMuted: Bool
            /// design-tokens.json `renamable` — false only for
            /// quarantaene/spam.
            let renamable: Bool
        }

        // [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09. "KORREKTUR/
        // ERWEITERUNG des Ordner-Umbau-Eintrags"): wichtig/rechnungen
        // entfallen als System-Ordner, eingang/entwuerfe/gesendet sind neu.
        // Reihenfolge hier = Sidebar-Reihenfolge (Vorschlag laut Auftrag).
        static let defaults: [SystemDefault] = [
            SystemDefault(systemKey: .eingang, defaultLabel: "Eingang", icon: "inbox", usesDangerColor: false, isMuted: false, renamable: true),
            SystemDefault(systemKey: .entwuerfe, defaultLabel: "Entwürfe", icon: "file-pencil", usesDangerColor: false, isMuted: false, renamable: false),
            SystemDefault(systemKey: .gesendet, defaultLabel: "Gesendet", icon: "send", usesDangerColor: false, isMuted: false, renamable: false),
            SystemDefault(systemKey: .sonstiges, defaultLabel: "Sonstiges", icon: "folder", usesDangerColor: false, isMuted: false, renamable: true),
            SystemDefault(systemKey: .quarantaene, defaultLabel: "Quarantäne", icon: "shield-exclamation", usesDangerColor: true, isMuted: false, renamable: false),
            SystemDefault(systemKey: .spam, defaultLabel: "Spam", icon: "trash", usesDangerColor: false, isMuted: true, renamable: false),
            // [2026-09-08] Neu: Papierkorb (soft-delete-Ziel), siehe
            // WEB_INBOX.md "Fehlende Basis-Funktion entdeckt" / Contract-
            // Commit 156f0fd. Weder umbenennbar noch löschbar, wie
            // quarantaene/spam, aber ohne eigene Farbrolle/muted-Flag laut
            // design-tokens.json.
            SystemDefault(systemKey: .papierkorb, defaultLabel: "Papierkorb", icon: "trash-2", usesDangerColor: false, isMuted: false, renamable: false),
        ]
    }

    /// design-tokens.json `customFolder.defaultIcon` — used when the user
    /// creates a new folder without picking an icon (`POST /folders`).
    enum CustomFolder {
        static let defaultIcon = "folder"
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
