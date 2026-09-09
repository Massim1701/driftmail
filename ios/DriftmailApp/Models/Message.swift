import Foundation

/// Mirrors `components/schemas/Message` in contracts/api-spec.yaml.
/// [2026-09-08] Contract-Änderung: `folder: Folder` (Enum) → `folderId`
/// (Referenz auf `Folder.id`), da Ordner jetzt benutzerdefiniert sind.
struct Message: Codable, Identifiable, Hashable {
    let id: String
    let fromAddress: String
    let fromDisplayName: String?
    let subject: String?
    let receivedAt: Date
    let folderId: String
    let classification: Classification
}

/// Mirrors `components/schemas/SecurityResult` in contracts/api-spec.yaml
/// (1:1 with contracts/ai-adapter-interface.ts SecurityResult and
/// db-schema.sql message_security).
struct SecurityResult: Codable, Hashable {
    let spfStatus: PassFailNone
    let dkimStatus: PassFailNone
    let dmarcStatus: PassFailNone
    let senderDomainAgeDays: Int?
    let domainReputationScore: Double?
    let homoglyphDetected: Bool
    let linkMismatchDetected: Bool
    let urgencyLanguageScore: Double?
    let containsNewIban: Bool
    let classification: Classification
    let confidenceScore: Double
}

/// Mirrors `components/schemas/MessageDetail` in contracts/api-spec.yaml
/// (Message + bodyText + security, via allOf).
struct MessageDetail: Codable, Identifiable, Hashable {
    let id: String
    let fromAddress: String
    let fromDisplayName: String?
    let subject: String?
    let receivedAt: Date
    let folderId: String
    let classification: Classification
    let bodyText: String?
    let security: SecurityResult?

    var asMessage: Message {
        Message(
            id: id,
            fromAddress: fromAddress,
            fromDisplayName: fromDisplayName,
            subject: subject,
            receivedAt: receivedAt,
            folderId: folderId,
            classification: classification
        )
    }

    /// Convenience for `MockAPIClient` — returns a copy moved to another
    /// folder (`POST /messages/{messageId}/move` and the quarantine
    /// shortcut both go through this).
    func movedTo(folderId newFolderId: String) -> MessageDetail {
        MessageDetail(
            id: id,
            fromAddress: fromAddress,
            fromDisplayName: fromDisplayName,
            subject: subject,
            receivedAt: receivedAt,
            folderId: newFolderId,
            classification: classification,
            bodyText: bodyText,
            security: security
        )
    }
}
