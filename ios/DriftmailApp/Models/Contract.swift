import Foundation

/// Mirrors `components/schemas/Contract` in contracts/api-spec.yaml
/// and contracts/ai-adapter-interface.ts `ContractData`.
struct Contract: Codable, Identifiable, Hashable {
    enum Status: String, Codable {
        case active
        case cancelled
        case expired
        case needsReview = "needs_review"
    }

    let id: String
    let providerName: String
    let contractStart: Date?
    let contractEnd: Date?
    let cancellationDeadline: Date?
    let cancellationPeriodDays: Int?
    let status: Status
    let extractedConfidence: Double
}

/// Mirrors `components/schemas/MailSummary` in contracts/api-spec.yaml
/// and contracts/ai-adapter-interface.ts `MailSummary`.
struct MailSummary: Codable, Hashable {
    let summaryText: String
    let actionRequired: Bool
    let actionDescription: String?
    let deadline: Date?
    let source: AiSource
}

/// Mirrors `components/schemas/UserAiCapability` in contracts/api-spec.yaml
/// and db-schema.sql `user_ai_capability`.
struct UserAiCapability: Codable, Hashable {
    enum Platform: String, Codable {
        case ios, android, windows, web
    }

    let platform: Platform
    let deviceModel: String?
    let osVersion: String?
    let onDeviceSupported: Bool
    let activeMode: AiSource
}
