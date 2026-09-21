import Foundation

/// `POST /attachments` (WEB_INBOX.md 09.09. "Erweiterung des Send-Endpunkt-
/// Eintrags von eben", siehe contracts/api-spec.yaml + backend/README.md
/// "Anhänge"). Ein Anhang muss `scanStatus == .clean` haben, bevor seine
/// `attachmentId` bei `APIClient.sendMessage(...)` mitgegeben werden darf.
enum AttachmentScanStatus: String, Codable, Hashable {
    case pending
    case clean
    case malicious
    case blockedType = "blocked_type"
    case scanFailed = "scan_failed"

    /// Deutsche Kurzbeschreibung -- geteilt zwischen dem Compose-Screen
    /// (`ComposeAttachmentUiStatus.label`, MessageDetailView.swift) und der
    /// Anzeige bereits empfangener Anhaenge (`attachmentsCard(_:)`, ebenda).
    var label: String {
        switch self {
        case .pending: return "Wird geprüft…"
        case .clean: return "Geprüft"
        case .malicious: return "Gefährlich"
        case .blockedType: return "Dateityp nicht erlaubt"
        case .scanFailed: return "Prüfung fehlgeschlagen"
        }
    }
}

struct AttachmentUploadResult: Codable, Hashable {
    let attachmentId: String
    let scanStatus: AttachmentScanStatus
}

/// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": mirrors
/// `components/schemas/MessageAttachment` -- Anhänge einer bereits
/// empfangenen/gesendeten Nachricht (`MessageDetail.attachments`), NICHT zu
/// verwechseln mit `AttachmentUploadResult` (Antwort direkt nach dem
/// Hochladen im Compose-Screen, bevor die Mail überhaupt existiert).
struct MessageAttachment: Codable, Identifiable, Hashable {
    let id: String
    let filename: String
    let mimeType: String?
    let sizeBytes: Int?
    let scanStatus: AttachmentScanStatus
    let isDangerousType: Bool
    let containsSensitiveDocument: SensitiveDocumentKind
}

/// Mirrors the `containsSensitiveDocument`-Enum aus api-spec.yaml
/// `MessageAttachment` (WEB_INBOX.md 15.09. "Sensible-Daten-Erkennung um
/// Fotos von Ausweisen/Kreditkarten erweitern").
enum SensitiveDocumentKind: String, Codable, Hashable {
    case none
    case creditCard = "credit_card"
    case idDocument = "id_document"
}
