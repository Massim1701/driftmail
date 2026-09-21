import Foundation

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
    case teal
    case oceanBlue = "ocean_blue"
    case violett
    case koralle
    case oceanVerlauf = "ocean_verlauf"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .teal: return "Teal"
        case .oceanBlue: return "Ocean Blue"
        case .violett: return "Violett"
        case .koralle: return "Koralle"
        case .oceanVerlauf: return "Ocean-Verlauf"
        }
    }

    var accentHex: String {
        switch self {
        case .teal: return "#1D9E75"
        case .oceanBlue: return "#378ADD"
        case .violett: return "#7F77DD"
        case .koralle: return "#D85A30"
        case .oceanVerlauf: return "#378ADD"
        }
    }

    /// Only `.oceanVerlauf` is a two-stop gradient (matches
    /// design-tokens.json `color.accentThemes[].gradient`); every other
    /// theme is a flat color, so this is `nil` for those.
    var gradientHexes: [String]? {
        self == .oceanVerlauf ? ["#378ADD", "#1D9E75"] : nil
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
