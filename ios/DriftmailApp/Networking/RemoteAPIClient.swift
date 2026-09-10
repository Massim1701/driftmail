import Foundation

/// SKELETON, not wired up yet — real `APIClient` implementation against
/// Track A's backend once it exists. Base URL taken straight from
/// contracts/api-spec.yaml `servers[0].url`. Endpoint paths are already
/// filled in; only response handling for a couple of endpoints is stubbed
/// with `APIError.notImplemented` since there's nothing live to test
/// against yet. Swap `MockAPIClient()` for `RemoteAPIClient()` in
/// `AppEnvironment` (App/AppEnvironment.swift) once Track A ships.
struct RemoteAPIClient: APIClient {
    private let baseURL = URL(string: "https://api.driftware.online/v1")!
    private let session: URLSession
    private let decoder: JSONDecoder

    init(session: URLSession = .shared) {
        self.session = session
        self.decoder = DriftmailDateDecoding.makeDecoder()
    }

    func fetchAccounts() async throws -> [MailAccount] {
        try await get("/accounts")
    }

    func fetchFolders() async throws -> [Folder] {
        try await get("/folders")
    }

    func createFolder(name: String, icon: String?) async throws -> Folder {
        struct Body: Encodable { let name: String; let icon: String? }
        return try await post("/folders", body: Body(name: name, icon: icon))
    }

    func updateFolder(id: String, name: String?, icon: String?, sortOrder: Int?) async throws -> Folder {
        struct Body: Encodable { let name: String?; let icon: String?; let sortOrder: Int? }
        return try await patch("/folders/\(id)", body: Body(name: name, icon: icon, sortOrder: sortOrder))
    }

    func deleteFolder(id: String) async throws {
        try await delete("/folders/\(id)")
    }

    func fetchMessages(folderId: String?, accountId: String?) async throws -> [Message] {
        var components = URLComponents(url: baseURL.appendingPathComponent("/messages"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        if let folderId { items.append(.init(name: "folderId", value: folderId)) }
        if let accountId { items.append(.init(name: "accountId", value: accountId)) }
        components.queryItems = items.isEmpty ? nil : items
        return try await get(components.url!)
    }

    func fetchMessageDetail(id: String) async throws -> MessageDetail {
        try await get("/messages/\(id)")
    }

    func quarantineMessage(id: String) async throws {
        let _: EmptyResponse = try await post("/messages/\(id)/quarantine", body: Optional<String>.none)
    }

    func moveMessage(id: String, toFolderId: String) async throws -> Message {
        struct Body: Encodable { let folderId: String }
        return try await post("/messages/\(id)/move", body: Body(folderId: toFolderId))
    }

    /// `DELETE /messages/{messageId}` — soft delete in den Papierkorb.
    func deleteMessage(id: String) async throws {
        try await delete("/messages/\(id)")
    }

    /// `DELETE /messages/{messageId}/permanent` — endgültiges Löschen.
    func permanentlyDeleteMessage(id: String) async throws {
        try await delete("/messages/\(id)/permanent")
    }

    func fetchSummary(messageId: String) async throws -> MailSummary {
        try await get("/messages/\(messageId)/summary")
    }

    func requestReplyDraft(messageId: String) async throws -> String {
        struct DraftResponse: Decodable { let draftText: String }
        let response: DraftResponse = try await post("/messages/\(messageId)/reply-draft", body: Optional<String>.none)
        return response.draftText
    }

    /// `POST /messages/send` — anders als die übrigen `post()`-Aufrufe
    /// hier muss der HTTP-Status geprüft werden, weil 422 (`blocked:
    /// true`) ein erwarteter, vom Erfolgsfall inhaltlich verschiedener
    /// Ausgang ist (siehe `APIError.blocked`), keine generische
    /// Netzwerk-/Decoding-Fehlerbedingung.
    func sendMessage(inReplyToMessageId: String, to: [String], subject: String?, bodyText: String) async throws -> String {
        struct Body: Encodable {
            let inReplyToMessageId: String
            let to: [String]
            let subject: String?
            let bodyText: String
        }
        struct SendResponse: Decodable { let sentMessageId: String }
        struct BlockedResponse: Decodable { let blocked: Bool; let reason: String? }

        var request = URLRequest(url: baseURL.appendingPathComponent("/messages/send"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(inReplyToMessageId: inReplyToMessageId, to: to, subject: subject, bodyText: bodyText))

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network(error)
        }
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
        if statusCode == 422 {
            let blocked = try? decoder.decode(BlockedResponse.self, from: data)
            throw APIError.blocked(reason: blocked?.reason)
        }
        do {
            return try decoder.decode(SendResponse.self, from: data).sentMessageId
        } catch let error as DecodingError {
            throw APIError.decodingFailed(error)
        }
    }

    func fetchContracts() async throws -> [Contract] {
        try await get("/contracts")
    }

    func confirmContract(_ contract: Contract) async throws {
        _ = try await post("/contracts/\(contract.id)/confirm", body: contract) as EmptyResponse
    }

    func reportCapabilityCheck(_ capability: UserAiCapability) async throws {
        _ = try await post("/capability-check", body: capability) as EmptyResponse
    }

    // MARK: - Plumbing

    private struct EmptyResponse: Decodable {}

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await get(baseURL.appendingPathComponent(path))
    }

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        do {
            let (data, _) = try await session.data(from: url)
            return try decoder.decode(T.self, from: data)
        } catch let error as DecodingError {
            throw APIError.decodingFailed(error)
        } catch {
            throw APIError.network(error)
        }
    }

    private func post<Body: Encodable, T: Decodable>(_ path: String, body: Body?) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }
        do {
            let (data, _) = try await session.data(for: request)
            return try decoder.decode(T.self, from: data)
        } catch let error as DecodingError {
            throw APIError.decodingFailed(error)
        } catch {
            throw APIError.network(error)
        }
    }

    private func patch<Body: Encodable, T: Decodable>(_ path: String, body: Body) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        do {
            let (data, _) = try await session.data(for: request)
            return try decoder.decode(T.self, from: data)
        } catch let error as DecodingError {
            throw APIError.decodingFailed(error)
        } catch {
            throw APIError.network(error)
        }
    }

    /// For endpoints like `DELETE /folders/{folderId}` that respond
    /// `204 No Content` — no body to decode.
    private func delete(_ path: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "DELETE"
        do {
            _ = try await session.data(for: request)
        } catch {
            throw APIError.network(error)
        }
    }
}
