import Foundation

/// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09., ersetzt WEB_INBOX.md
/// "ECHTE KI-ANBINDUNG" c3ec563): mirrors `components/schemas/AiSettings`
/// in contracts/api-spec.yaml and db-schema.sql `user_ai_preference`
/// (ohne den Key selbst, siehe backend/README.md "KI-Anbindung (BYOK)").
enum AiPreferenceMode: String, Codable, CaseIterable {
    case off
    case byok
}

/// Nur `.anthropic`/`.openai` sind serverseitig wirklich angebunden
/// (`backend/src/ai/cloudAdapter.ts`) -- `.google`/`.other` existieren im
/// Contract/DB-Enum fuer spaetere Erweiterung, werden aber von `PUT
/// /ai-settings` mit 400 abgelehnt. Die Settings-UI bietet deshalb bewusst
/// nur `AiProvider.implemented` als Auswahl an, nicht alle Faelle.
enum AiProvider: String, Codable, CaseIterable {
    case anthropic
    case openai
    case google
    case other

    /// Tatsaechlich nutzbare Anbieter -- siehe Kommentar oben.
    static let implemented: [AiProvider] = [.anthropic, .openai]

    var displayName: String {
        switch self {
        case .anthropic: return "Anthropic (Claude)"
        case .openai: return "OpenAI"
        case .google: return "Google"
        case .other: return "Andere"
        }
    }
}

struct AiSettings: Codable, Hashable {
    let mode: AiPreferenceMode
    let byokProvider: AiProvider?
    let hasApiKey: Bool
    let cloudConsentGiven: Bool
}
