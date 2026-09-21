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
    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send"): war
    /// vorher gar nicht Teil des Draft-Contracts (nur bei `POST
    /// /messages/send` selbst) -- jetzt nachgezogen, damit ein per Schedule
    /// Send angelegter Entwurf seinen BCC nicht verliert. `Optional` mit
    /// Default `[]`, damit ältere Mock-Daten ohne dieses Feld nicht crashen.
    let bcc: [String]
    let subject: String?
    let bodyText: String?
    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send"):
    /// gesetzt = dieser Entwurf wird automatisch verschickt, sobald der
    /// Zeitpunkt erreicht ist (siehe backend/README.md). `nil` = normaler
    /// Entwurf ohne automatischen Versand.
    let scheduledFor: Date?
    let updatedAt: Date

    init(id: String, inReplyToMessageId: String?, to: [String], cc: [String], bcc: [String] = [], subject: String?, bodyText: String?, scheduledFor: Date? = nil, updatedAt: Date) {
        self.id = id
        self.inReplyToMessageId = inReplyToMessageId
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.subject = subject
        self.bodyText = bodyText
        self.scheduledFor = scheduledFor
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        inReplyToMessageId = try container.decodeIfPresent(String.self, forKey: .inReplyToMessageId)
        to = try container.decode([String].self, forKey: .to)
        cc = try container.decode([String].self, forKey: .cc)
        bcc = try container.decodeIfPresent([String].self, forKey: .bcc) ?? []
        subject = try container.decodeIfPresent(String.self, forKey: .subject)
        bodyText = try container.decodeIfPresent(String.self, forKey: .bodyText)
        scheduledFor = try container.decodeIfPresent(Date.self, forKey: .scheduledFor)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
    }
}
