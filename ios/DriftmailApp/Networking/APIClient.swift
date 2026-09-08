import Foundation

/// Swift-side client for contracts/api-spec.yaml. Kept as a protocol so the
/// app can run entirely against `MockAPIClient` today and swap in a real
/// `RemoteAPIClient` (URLSession against https://api.driftware.online/v1)
/// once Track A's backend is live — no call sites should need to change.
protocol APIClient {
    func fetchAccounts() async throws -> [MailAccount]
    func fetchMessages(folder: Folder?, accountId: String?) async throws -> [Message]
    func fetchMessageDetail(id: String) async throws -> MessageDetail
    func quarantineMessage(id: String) async throws
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
}
