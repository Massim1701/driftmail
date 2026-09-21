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
    // [2026-09-21] WEB_INBOX.md 19.09. "Sichtbare Kennzeichen/Badges für
    // die neuen Sicherheitssignale" -- Felder existieren im Contract/
    // Backend bereits seit den Sicherheits-Ergänzungen vom 15.09., waren
    // hier bisher nicht gespiegelt (analog zum Web-Client vor demselben Fix).
    let displayNameSpoofingDetected: Bool
    let replyToMismatchDetected: Bool
    let urgencyLanguageScore: Double?
    let containsNewIban: Bool
    let ibanChangedInThread: Bool
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
    /// Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.): true, wenn die
    /// Nachricht einen syntaktisch gültigen List-Unsubscribe-Header hat
    /// (unabhängig von classification) -- steuert den "Von Absender
    /// abmelden"-Button in MessageDetailView, siehe backend/README.md.
    let canUnsubscribe: Bool
    /// "Erster Kontakt"-Kennzeichnung (WEB_INBOX.md 15.09./19.09.): true,
    /// wenn es für dieses Konto keine andere Nachricht von derselben
    /// `fromAddress` gibt. Kombiniert sich mit `GET /trusted-senders` --
    /// Badge nur zeigen, wenn `isNewSender=true` UND Absender nicht auf der
    /// Whitelist, siehe api-spec.yaml und `MessageDetailView`.
    let isNewSender: Bool

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
            security: security,
            canUnsubscribe: canUnsubscribe,
            isNewSender: isNewSender
        )
    }
}
