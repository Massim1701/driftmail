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
enum AiSource: String, Codable {
    case onDevice = "on_device"
    case cloudFallback = "cloud_fallback"
}

enum PassFailNone: String, Codable {
    case pass, fail, none
}
