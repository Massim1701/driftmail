import Foundation

/// Swift-side client for contracts/api-spec.yaml. Kept as a protocol so the
/// app can run entirely against `MockAPIClient` today and swap in a real
/// `RemoteAPIClient` (URLSession against https://api.driftware.online/v1)
/// once Track A's backend is live — no call sites should need to change.
protocol APIClient {
    func fetchAccounts() async throws -> [MailAccount]

    // Ordner (contracts/api-spec.yaml `/folders`, `/folders/{folderId}`).
    // [2026-09-08] Neu seit der Ordner-Contract-Änderung: Ordner sind
    // jetzt benutzerdefiniert (anlegen/umbenennen/löschen), nicht mehr
    // eine feste Liste.
    func fetchFolders() async throws -> [Folder]
    func createFolder(name: String, icon: String?) async throws -> Folder
    func updateFolder(id: String, name: String?, icon: String?, sortOrder: Int?) async throws -> Folder
    func deleteFolder(id: String) async throws

    func fetchMessages(folderId: String?, accountId: String?) async throws -> [Message]
    func fetchMessageDetail(id: String) async throws -> MessageDetail
    func quarantineMessage(id: String) async throws
    /// `POST /messages/{messageId}/unsubscribe` — manuelle Abmeldung über
    /// den List-Unsubscribe-Header der Nachricht (WEB_INBOX.md 09.09.
    /// "Automatische Abmeldung bei Spam"). Nur sinnvoll aufrufbar, wenn
    /// `MessageDetail.canUnsubscribe == true`; der Server prüft das
    /// zusätzlich selbst (400, falls kein gültiger Header vorliegt).
    /// Unabhängig von `classification` — läuft NICHT automatisch bei
    /// phishing, aber der User kann trotzdem manuell abmelden, siehe
    /// backend/README.md. Gibt den resultierenden Status zurück.
    func unsubscribeFromMessage(id: String) async throws -> UnsubscribeStatus
    /// `POST /messages/{messageId}/move` — Nachricht in einen anderen
    /// (System- oder eigenen) Ordner verschieben.
    func moveMessage(id: String, toFolderId: String) async throws -> Message
    /// `DELETE /messages/{messageId}` — Nachricht in den Papierkorb
    /// verschieben (soft delete, analog Gmail). [2026-09-08]
    /// WEB_INBOX.md "Fehlende Basis-Funktion entdeckt" / Contract-Commit
    /// 156f0fd. Verhält sich wie `moveMessage(id:toFolderId:)` in den
    /// Papierkorb-Ordner, ist aber ein eigener Endpunkt, damit ein echtes
    /// Backend zusätzlich die Provider-API spiegeln kann (Gmail
    /// `messages.trash` / IMAP `\Deleted`).
    func deleteMessage(id: String) async throws
    /// `DELETE /messages/{messageId}/permanent` — Nachricht endgültig
    /// löschen (laut Contract nur aus dem Papierkorb heraus sinnvoll; das
    /// UI bietet den Button entsprechend nur dort an, der Endpunkt selbst
    /// prüft das serverseitig).
    func permanentlyDeleteMessage(id: String) async throws
    func fetchSummary(messageId: String) async throws -> MailSummary
    func requestReplyDraft(messageId: String) async throws -> String
    /// `POST /messages/send` — sendet eine Antwort auf `inReplyToMessageId`
    /// (das Konto wird backend-seitig aus der Ursprungsnachricht
    /// abgeleitet, siehe backend/README.md "Versand"). Gibt die
    /// provider-seitige `sentMessageId` zurück. Wirft `APIError.blocked`,
    /// wenn der serverseitige Phishing-Check den Versand verhindert hat
    /// (422, siehe api-spec.yaml). [2026-09-09] WEB_INBOX.md "Fehlender
    /// Senden-Endpunkt".
    /// `attachmentIds` (WEB_INBOX.md 09.09. "Erweiterung des Send-Endpunkt-
    /// Eintrags von eben"): jede ID muss aus `uploadAttachment(...)`
    /// stammen und `scanStatus == .clean` gehabt haben, sonst wirft der
    /// Server 422 (`APIError.blocked`) — leeres Array, wenn keine Anhänge.
    /// `draftId` (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
    /// Ordner-Umbau-Eintrags"): falls gesetzt, verwirft der Server den
    /// Entwurf nach erfolgreichem Versand automatisch (intern).
    func sendMessage(inReplyToMessageId: String, to: [String], subject: String?, bodyText: String, attachmentIds: [String], draftId: String?) async throws -> String
    /// `POST /attachments` — lädt eine Datei hoch und lässt sie sofort
    /// scannen (siehe backend/README.md "Anhänge").
    func uploadAttachment(filename: String, mimeType: String, data: Data) async throws -> AttachmentUploadResult
    /// `GET /drafts` — Inhalt des "entwuerfe"-Systemordners (WEB_INBOX.md
    /// 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"), NICHT
    /// `fetchMessages(...)`.
    func fetchDrafts() async throws -> [Draft]
    /// `DELETE /drafts/{draftId}` — Entwurf verwerfen.
    func deleteDraft(id: String) async throws
    func fetchContracts() async throws -> [Contract]
    func confirmContract(_ contract: Contract) async throws
    func reportCapabilityCheck(_ capability: UserAiCapability) async throws
}

enum APIError: Error {
    case notFound
    case decodingFailed(Error)
    case network(Error)
    case notImplemented
    /// Operation not permitted by the contract (e.g. renaming
    /// quarantaene/spam, deleting a system folder).
    case forbidden
    /// `POST /messages/send` was rejected by the server-side phishing
    /// check (422, `blocked: true`) — `reason` is the human-readable
    /// explanation from the response body, if the server sent one.
    case blocked(reason: String?)
}
