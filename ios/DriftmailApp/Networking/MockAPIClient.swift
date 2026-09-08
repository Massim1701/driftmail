import Foundation

/// Loads Networking/MockData/MockDatabase.json (bundled as an app resource)
/// and serves it through the same `APIClient` protocol a real backend
/// (Track A, contracts/api-spec.yaml) would use. This is the default
/// client for this first pass — see README.md "Was ist gemockt".
actor MockAPIClient: APIClient {

    private struct MockDatabase: Codable {
        var accounts: [MailAccount]
        var messages: [MessageDetail]
        var contracts: [Contract]
        var summaries: [String: MailSummary]
    }

    private var db: MockDatabase

    /// Simulated network latency so loading states in the UI are visible
    /// even against local mock data.
    private let simulatedLatencyNanoseconds: UInt64 = 250_000_000

    init(bundle: Bundle = .main) {
        guard
            let url = bundle.url(forResource: "MockDatabase", withExtension: "json"),
            let data = try? Data(contentsOf: url)
        else {
            fatalError("MockDatabase.json missing from app bundle — check it's added to the DriftmailApp target's resources.")
        }
        let decoder = DriftmailDateDecoding.makeDecoder()
        do {
            self.db = try decoder.decode(MockDatabase.self, from: data)
        } catch {
            fatalError("MockDatabase.json failed to decode against the api-spec.yaml-derived models: \(error)")
        }
    }

    private func delay() async {
        try? await Task.sleep(nanoseconds: simulatedLatencyNanoseconds)
    }

    func fetchAccounts() async throws -> [MailAccount] {
        await delay()
        return db.accounts
    }

    func fetchMessages(folder: Folder?, accountId: String?) async throws -> [Message] {
        await delay()
        return db.messages
            .filter { folder == nil || $0.folder == folder }
            .sorted { $0.receivedAt > $1.receivedAt }
            .map(\.asMessage)
    }

    func fetchMessageDetail(id: String) async throws -> MessageDetail {
        await delay()
        guard let detail = db.messages.first(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        return detail
    }

    func quarantineMessage(id: String) async throws {
        await delay()
        guard let index = db.messages.firstIndex(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        let existing = db.messages[index]
        db.messages[index] = MessageDetail(
            id: existing.id,
            fromAddress: existing.fromAddress,
            fromDisplayName: existing.fromDisplayName,
            subject: existing.subject,
            receivedAt: existing.receivedAt,
            folder: .quarantaene,
            classification: existing.classification,
            bodyText: existing.bodyText,
            security: existing.security
        )
    }

    func fetchSummary(messageId: String) async throws -> MailSummary {
        await delay()
        if let cached = db.summaries[messageId] {
            return cached
        }
        // Fall back to the on-device adapter stub for messages without a
        // canned summary, so every message row still leads somewhere.
        guard let detail = db.messages.first(where: { $0.id == messageId }) else {
            throw APIError.notFound
        }
        return try await OnDeviceAiAdapter().summarize(rawText: detail.bodyText ?? "")
    }

    func requestReplyDraft(messageId: String) async throws -> String {
        await delay()
        guard let detail = db.messages.first(where: { $0.id == messageId }) else {
            throw APIError.notFound
        }
        let thread = MailThread(messages: [
            .init(
                fromAddress: detail.fromAddress,
                subject: detail.subject ?? "",
                bodyText: detail.bodyText ?? "",
                receivedAt: ISO8601DateFormatter().string(from: detail.receivedAt)
            )
        ])
        return try await OnDeviceAiAdapter().draftReply(thread: thread)
    }

    func fetchContracts() async throws -> [Contract] {
        await delay()
        return db.contracts
    }

    func confirmContract(_ contract: Contract) async throws {
        await delay()
        guard let index = db.contracts.firstIndex(where: { $0.id == contract.id }) else {
            throw APIError.notFound
        }
        db.contracts[index] = contract
    }

    func reportCapabilityCheck(_ capability: UserAiCapability) async throws {
        await delay()
        // Mock: nothing to persist server-side; a real backend would store
        // this in db-schema.sql `user_ai_capability` via POST /capability-check.
    }
}
