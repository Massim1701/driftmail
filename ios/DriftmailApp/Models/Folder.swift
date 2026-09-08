import SwiftUI

/// Mirrors `components/schemas/Folder` in contracts/api-spec.yaml
/// and the `folders` array in contracts/design-tokens.json.
enum Folder: String, Codable, CaseIterable, Identifiable {
    case wichtig
    case sonstiges
    case rechnungen
    case quarantaene
    case spam

    var id: String { rawValue }

    /// Label + icon per contracts/design-tokens.json → "folders".
    var label: String {
        switch self {
        case .wichtig: return "Wichtig"
        case .sonstiges: return "Sonstiges"
        case .rechnungen: return "Rechnungen"
        case .quarantaene: return "Quarantäne"
        case .spam: return "Spam"
        }
    }

    /// SF Symbol standing in for the design-tokens icon keys
    /// ("star", "inbox", "receipt", "shield-exclamation", "trash").
    var systemImage: String {
        switch self {
        case .wichtig: return "star.fill"
        case .sonstiges: return "tray.fill"
        case .rechnungen: return "doc.text.fill"
        case .quarantaene: return "exclamationmark.shield.fill"
        case .spam: return "trash.fill"
        }
    }

    /// design-tokens.json marks quarantaene with colorRole "danger".
    var usesDangerColor: Bool { self == .quarantaene }

    /// design-tokens.json marks spam as "muted".
    var isMuted: Bool { self == .spam }
}
