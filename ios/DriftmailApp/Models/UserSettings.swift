import Foundation
import SwiftUI
import UIKit

/// [2026-09-21] "Einstellungsbereich"-Auftrag (WEB_INBOX.md 21.09. "NEUER
/// AUFTRAG - Einstellungsbereich + Info-Seite"): mirrors
/// `components/schemas/UserSettings` in contracts/api-spec.yaml and
/// db-schema.sql `users.accent_theme`. Five selectable accent themes, see
/// contracts/design-tokens.json `color.accentThemes` -- hand-copied here
/// like the rest of DesignTokens.swift, update both if the contract
/// changes. `danger`/`warning`/`success` are intentionally NOT part of
/// this enum -- an earlier Massimo decision keeps those fixed for every
/// user so the existing security-warning system never loses its clarity.
enum AccentTheme: String, Codable, CaseIterable, Identifiable {
    /// [2026-09-28] Redesign "ruhig & warm" + WEB_INBOX.md 27.09. "WAEHLBARE
    /// AKZENTFARBEN": fuenf Themes, `.gruen` ist Default. Die frueheren
    /// Werte (teal/ocean_blue/violett/koralle/ocean_verlauf) migriert das
    /// Backend auf `gruen`; `init(from:)` unten faengt trotzdem jeden
    /// unbekannten Wert ab, damit ein neuer Server-Wert nie das Laden der
    /// Einstellungen bricht. Werte 1:1 aus design-tokens.json
    /// `color.accentThemes[].light/.dark.accentStrong`.
    case gruen
    case gelb
    case outlookBlue = "outlook_blue"
    case rosa
    case schwarz

    var id: String { rawValue }

    var label: String {
        switch self {
        case .gruen: return "Grün"
        case .gelb: return "Gelb"
        case .outlookBlue: return "Blau"
        case .rosa: return "Rosa"
        case .schwarz: return "Schwarz"
        }
    }

    /// Hell-Modus: Flaeche fuer Buttons mit weissem Text (>= 4.5:1).
    var accentHex: String {
        switch self {
        case .gruen: return "#2A7D50"
        case .gelb: return "#8A6415"
        case .outlookBlue: return "#0067B8"
        case .rosa: return "#B8325F"
        case .schwarz: return "#1F1F1F"
        }
    }

    /// Dunkel-Modus-Gegenstueck (sonst waere z.B. Schwarz auf dunklem Grund
    /// unsichtbar).
    var accentHexDark: String {
        switch self {
        case .gruen: return "#5CC08A"
        case .gelb: return "#E6B85C"
        case .outlookBlue: return "#4BA3E8"
        case .rosa: return "#EC7AA0"
        case .schwarz: return "#E6E6E0"
        }
    }

    /// Passt sich Hell/Dunkel automatisch an.
    var color: SwiftUI.Color {
        let light = UIColor(SwiftUI.Color(hex: accentHex))
        let dark = UIColor(SwiftUI.Color(hex: accentHexDark))
        return SwiftUI.Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AccentTheme(rawValue: raw) ?? .gruen
    }
}

struct UserSettings: Codable, Hashable {
    var accentTheme: AccentTheme
    /// [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt
    /// 1 ("Unbekannte Absender streng behandeln"), Default `true`. Reine
    /// Client-Darstellungsentscheidung -- steuert nur, ob `MessageDetailView`
    /// eine Nachricht von einem unbekannten Absender staerker hervorhebt
    /// als das bestehende dezente "Neuer Absender"-Flag allein.
    var strictUnknownSenders: Bool
    /// [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2
    /// ("Nudge"), Default `true` (wie Gmail). Steuert `Message.awaitingReply`
    /// serverseitig -- bei `false` liefert das Backend nie `true`.
    var nudgeUnansweredEnabled: Bool

    init(accentTheme: AccentTheme, strictUnknownSenders: Bool, nudgeUnansweredEnabled: Bool = true) {
        self.accentTheme = accentTheme
        self.strictUnknownSenders = strictUnknownSenders
        self.nudgeUnansweredEnabled = nudgeUnansweredEnabled
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        accentTheme = try container.decode(AccentTheme.self, forKey: .accentTheme)
        strictUnknownSenders = try container.decode(Bool.self, forKey: .strictUnknownSenders)
        nudgeUnansweredEnabled = try container.decodeIfPresent(Bool.self, forKey: .nudgeUnansweredEnabled) ?? true
    }
}
