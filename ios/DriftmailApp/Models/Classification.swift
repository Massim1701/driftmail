import Foundation

/// Mirrors `Classification` in contracts/ai-adapter-interface.ts
/// and the `classification` enums in api-spec.yaml / db-schema.sql.
enum Classification: String, Codable {
    case safe
    case spam
    case phishing
    case unclear
}

/// Mirrors `AiSource` in contracts/ai-adapter-interface.ts
/// and message_ai_summary.source in db-schema.sql.
/// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): dritter Wert
/// `.heuristic` -- kein KI-Modell, kein externer Anbieter beteiligt,
/// vorher fälschlich immer als `.cloudFallback` gelabelt (siehe
/// backend/README.md "KI-Anbindung (BYOK)").
enum AiSource: String, Codable {
    case onDevice = "on_device"
    case cloudFallback = "cloud_fallback"
    case heuristic
}

enum PassFailNone: String, Codable {
    case pass, fail, none
}

/// Response of `POST /messages/{messageId}/unsubscribe` (WEB_INBOX.md 09.09.
/// "Automatische Abmeldung bei Spam"), mirrors `unsubscribe_actions.status`
/// in contracts/db-schema.sql.
enum UnsubscribeStatus: String, Codable {
    case pendingConfirmation = "pending_confirmation"
    case confirmed
    case rejected
}
