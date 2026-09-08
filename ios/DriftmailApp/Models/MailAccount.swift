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
