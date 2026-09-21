import Foundation

/// Real `APIClient` implementation against Track A's backend
/// (contracts/api-spec.yaml). Was a "skeleton, not wired up" until
/// WEB_INBOX.md 19.09. "Onboarding: Provider-Auswahlbildschirm" ("voll
/// verdrahten" per Rückfrage an Massimo, 21.09.) — now the real client once
/// an account is connected (see `AppEnvironment.completeAccountConnection`).
///
/// **Base URL:** defaults to `servers[0].url` from api-spec.yaml
/// (`https://api.driftware.online/v1`), overridable via the
/// `DRIFTMAIL_API_BASE_URL` environment variable (Xcode scheme → Run →
/// Arguments → Environment Variables) for local development against
/// `backend/` (e.g. `http://localhost:3000/v1`, same pattern as
/// `web/`'s `VITE_API_BASE_URL`). Plain-HTTP localhost needs the
/// `NSAllowsLocalNetworking` ATS exception in the build settings
/// (`INFOPLIST_FILE_ADDITIONAL_CONTENT`) — see `ios/README.md`.
///
/// **Token:** the session token from `POST /accounts`/`GET
/// /auth/google/callback` is attached as `Authorization: Bearer <token>`
/// on every request once set — persisted by the caller in the Keychain
/// (`Security/SessionStore.swift`), never here (this struct is stateless
/// beyond the token string itself, matching `MockAPIClient`'s "no I/O
/// beyond its own responsibility" shape).
struct RemoteAPIClient: APIClient {
    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let token: String?

    init(session: URLSession = .shared, token: String? = nil) {
        self.session = session
        self.decoder = DriftmailDateDecoding.makeDecoder()
        self.token = token
        if let override = ProcessInfo.processInfo.environment["DRIFTMAIL_API_BASE_URL"], let url = URL(string: override) {
            self.baseURL = url
        } else {
            self.baseURL = URL(string: "https://api.driftware.online/v1")!
        }
    }

    /// `GET /mail-providers` — unauthenticated (`security: []` im
    /// Contract, läuft vor jedem Login).
    func fetchMailProviders() async throws -> [MailProvider] {
        try await get("/mail-providers")
    }

    /// `POST /accounts` (`provider=imap`) — ebenfalls unauthenticated.
    /// Eigene Status-Code-Behandlung wie bei `sendMessage`, weil 422
    /// (Zugangsdaten falsch) und 403 (nicht freigeschaltet) aussagekräftige,
    /// vom generischen Netzwerkfehler verschiedene Ergebnisse sind.
    func connectImapAccount(emailAddress: String, imapHost: String, imapPort: Int, imapSecure: Bool, imapUser: String?, imapPassword: String, smtpHost: String?, smtpPort: Int?, smtpSecure: Bool?) async throws -> (account: MailAccount, token: String) {
        struct Body: Encodable {
            let provider = "imap"
            let emailAddress: String
            let imapHost: String
            let imapPort: Int
            let imapSecure: Bool
            let imapUser: String?
            let imapPassword: String
            let smtpHost: String?
            let smtpPort: Int?
            let smtpSecure: Bool?
        }
        struct Response: Decodable { let account: MailAccount; let token: String }

        var request = URLRequest(url: baseURL.appendingPathComponent("/accounts"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(emailAddress: emailAddress, imapHost: imapHost, imapPort: imapPort, imapSecure: imapSecure, imapUser: imapUser, imapPassword: imapPassword, smtpHost: smtpHost, smtpPort: smtpPort, smtpSecure: smtpSecure))

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.network(error)
        }
        switch (response as? HTTPURLResponse)?.statusCode ?? 200 {
        case 422: throw APIError.verificationFailed
        case 403: throw APIError.notAllowlisted
        default: break
        }
        do {
            let decoded = try decoder.decode(Response.self, from: data)
            return (decoded.account, decoded.token)
        } catch let error as DecodingError {
            throw APIError.decodingFailed(error)
        }
    }

    func fetchTrustedSenders() async throws -> [TrustedSender] {
        try await get("/trusted-senders")
    }

    func fetchAccounts() async throws -> [MailAccount] {
        try await get("/accounts")
    }

    func syncAccount(id: String) async throws -> SyncResult {
        try await post("/accounts/\(id)/sync", body: Optional<String>.none)
    }

    func fetchFolders(accountId: String?) async throws -> [Folder] {
        if let accountId {
            var components = URLComponents(url: baseURL.appendingPathComponent("/folders"), resolvingAgainstBaseURL: false)!
            components.queryItems = [.init(name: "accountId", value: accountId)]
            return try await get(components.url!)
        }
        return try await get("/folders")
    }

    func createFolder(name: String, icon: String?, accountId: String?) async throws -> Folder {
        struct Body: Encodable { let name: String; let icon: String?; let accountId: String? }
        return try await post("/folders", body: Body(name: name, icon: icon, accountId: accountId))
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

    func unsubscribeFromMessage(id: String) async throws -> UnsubscribeStatus {
        struct Response: Decodable { let status: UnsubscribeStatus }
        let response: Response = try await post("/messages/\(id)/unsubscribe", body: Optional<String>.none)
        return response.status
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
    func sendMessage(inReplyToMessageId: String, to: [String], subject: String?, bodyText: String, attachmentIds: [String], draftId: String?) async throws -> String {
        struct Body: Encodable {
            let inReplyToMessageId: String
            let to: [String]
            let subject: String?
            let bodyText: String
            let attachmentIds: [String]
            let draftId: String?
        }
        struct SendResponse: Decodable { let sentMessageId: String }
        struct BlockedResponse: Decodable { let blocked: Bool; let reason: String? }

        var request = URLRequest(url: baseURL.appendingPathComponent("/messages/send"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authorize(&request)
        request.httpBody = try JSONEncoder().encode(Body(inReplyToMessageId: inReplyToMessageId, to: to, subject: subject, bodyText: bodyText, attachmentIds: attachmentIds, draftId: draftId))

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

    /// `POST /attachments` — `multipart/form-data` statt JSON, deshalb ein
    /// von Hand gebautes Multipart-Body (kein `post()`-Helper hier, der
    /// setzt immer `Content-Type: application/json`).
    func uploadAttachment(filename: String, mimeType: String, data: Data) async throws -> AttachmentUploadResult {
        let boundary = "driftmail-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: baseURL.appendingPathComponent("/attachments"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        authorize(&request)
        request.httpBody = body

        do {
            let (responseData, _) = try await session.data(for: request)
            return try decoder.decode(AttachmentUploadResult.self, from: responseData)
        } catch let error as DecodingError {
            throw APIError.decodingFailed(error)
        } catch {
            throw APIError.network(error)
        }
    }

    /// `GET /drafts` — Inhalt des "entwuerfe"-Systemordners.
    func fetchDrafts() async throws -> [Draft] {
        try await get("/drafts")
    }

    /// `DELETE /drafts/{draftId}`.
    func deleteDraft(id: String) async throws {
        try await delete("/drafts/\(id)")
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

    /// Attaches `Authorization: Bearer <token>` when a token is set (i.e.
    /// for every real endpoint once an account is connected). No-op for the
    /// two unauthenticated onboarding endpoints, where `token` is still nil.
    private func authorize(_ request: inout URLRequest) {
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await get(baseURL.appendingPathComponent(path))
    }

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        var request = URLRequest(url: url)
        authorize(&request)
        do {
            let (data, _) = try await session.data(for: request)
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
        authorize(&request)
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
        authorize(&request)
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
        authorize(&request)
        do {
            _ = try await session.data(for: request)
        } catch {
            throw APIError.network(error)
        }
    }
}
