import Foundation

/// Mirrors `components/schemas/Draft` in contracts/api-spec.yaml
/// (`GET`/`POST /drafts`, `PATCH`/`DELETE /drafts/{draftId}`). Shows in the
/// "entwuerfe" system folder (`Folder.isDrafts`), NOT `GET /messages` — see
/// WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags".
struct Draft: Codable, Identifiable, Hashable {
    let id: String
    let inReplyToMessageId: String?
    let to: [String]
    let cc: [String]
    let subject: String?
    let bodyText: String?
    let updatedAt: Date
}
