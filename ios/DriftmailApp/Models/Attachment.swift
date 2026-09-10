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
}

struct AttachmentUploadResult: Codable, Hashable {
    let attachmentId: String
    let scanStatus: AttachmentScanStatus
}
