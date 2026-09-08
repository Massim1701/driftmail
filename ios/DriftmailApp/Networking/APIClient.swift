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
    /// `POST /messages/{messageId}/move` — Nachricht in einen anderen
    /// (System- oder eigenen) Ordner verschieben.
    func moveMessage(id: String, toFolderId: String) async throws -> Message
    func fetchSummary(messageId: String) async throws -> MailSummary
    func requestReplyDraft(messageId: String) async throws -> String
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
}
