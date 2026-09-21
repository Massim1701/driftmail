import Foundation

/// Mirrors `components/schemas/MailAccount` in contracts/api-spec.yaml.
struct MailAccount: Codable, Identifiable, Hashable {
    enum Provider: String, Codable {
        case gmail
        case imap
    }

    enum SyncStatus: String, Codable {
        case pending
        case syncing
        case ok
        case error
    }

    let id: String
    let provider: Provider
    let emailAddress: String
    let syncStatus: SyncStatus
}

/// Antwort von `POST /accounts/{accountId}/sync` (WEB_INBOX.md 21.09.
/// "SEHR WICHTIGE LUECKE - HOECHSTE PRIORITAET", Punkt 1).
struct SyncResult: Codable {
    let imported: Int
    let autoDeleted: Int
    let syncStatus: MailAccount.SyncStatus
}
