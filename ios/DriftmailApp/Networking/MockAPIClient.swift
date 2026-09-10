import Foundation

/// Loads Networking/MockData/MockDatabase.json (bundled as an app resource)
/// and serves it through the same `APIClient` protocol a real backend
/// (Track A, contracts/api-spec.yaml) would use. This is the default
/// client for this first pass — see README.md "Was ist gemockt".
actor MockAPIClient: APIClient {

    private struct MockDatabase: Codable {
        var accounts: [MailAccount]
        var folders: [Folder]
        var messages: [MessageDetail]
        var contracts: [Contract]
        var summaries: [String: MailSummary]
    }

    private var db: MockDatabase

    /// Simulated network latency so loading states in the UI are visible
    /// even against local mock data.
    private let simulatedLatencyNanoseconds: UInt64 = 250_000_000

    /// `POST /attachments`-Ergebnisse (WEB_INBOX.md 09.09.) -- rein
    /// In-Memory, kein Contract-Pendant in MockDatabase.json nötig, da
    /// Anhänge nie über einen initialen Seed-Zustand existieren, sondern
    /// immer erst zur Laufzeit hochgeladen werden.
    private var uploadedAttachments: [String: AttachmentScanStatus] = [:]

    /// `/drafts` (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
    /// Ordner-Umbau-Eintrags") -- kein Contract-Pendant in
    /// MockDatabase.json (kein `POST /drafts`/`PATCH /drafts/{id}` in
    /// diesem Client, siehe README "Entwürfe" -- kein Compose-Screen in
    /// diesem Schritt), deshalb ein einzelner fest verdrahteter
    /// Beispiel-Entwurf, damit die "entwuerfe"-Ansicht trotzdem etwas
    /// zeigt statt immer leer zu sein.
    private var drafts: [Draft] = [
        Draft(
            id: "draft-001",
            inReplyToMessageId: nil,
            to: ["kollege@example.com"],
            cc: [],
            subject: "Noch offen: Rückmeldung zum Angebot",
            bodyText: "Hallo, ich wollte noch kurz nachfragen, ob...",
            updatedAt: Date(timeIntervalSinceNow: -3600)
        ),
    ]

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

    func fetchFolders() async throws -> [Folder] {
        await delay()
        return db.folders.sorted { $0.sortOrder < $1.sortOrder }
    }

    func createFolder(name: String, icon: String?) async throws -> Folder {
        await delay()
        let folder = Folder(
            id: UUID().uuidString,
            name: name,
            icon: icon ?? DesignTokens.CustomFolder.defaultIcon,
            isSystem: false,
            systemKey: nil,
            sortOrder: (db.folders.map(\.sortOrder).max() ?? -1) + 1
        )
        db.folders.append(folder)
        return folder
    }

    func updateFolder(id: String, name: String?, icon: String?, sortOrder: Int?) async throws -> Folder {
        await delay()
        guard let index = db.folders.firstIndex(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        var folder = db.folders[index]
        if let name {
            guard folder.isRenamable else { throw APIError.forbidden }
            folder.name = name
        }
        if let icon { folder.icon = icon }
        if let sortOrder { folder.sortOrder = sortOrder }
        db.folders[index] = folder
        return folder
    }

    func deleteFolder(id: String) async throws {
        await delay()
        guard let folder = db.folders.first(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        guard folder.isDeletable else { throw APIError.forbidden }
        // Messages left behind land in "sonstiges", mirroring how a real
        // backend would need to reassign them rather than orphan them.
        if let fallback = db.folders.first(where: { $0.systemKey == .sonstiges }) {
            for index in db.messages.indices where db.messages[index].folderId == id {
                db.messages[index] = db.messages[index].movedTo(folderId: fallback.id)
            }
        }
        db.folders.removeAll { $0.id == id }
    }

    func fetchMessages(folderId: String?, accountId: String?) async throws -> [Message] {
        await delay()
        return db.messages
            .filter { folderId == nil || $0.folderId == folderId }
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
        guard let quarantaeneFolder = db.folders.first(where: { $0.systemKey == .quarantaene }) else {
            throw APIError.notFound
        }
        _ = try await moveMessage(id: id, toFolderId: quarantaeneFolder.id)
    }

    func moveMessage(id: String, toFolderId: String) async throws -> Message {
        await delay()
        guard let index = db.messages.firstIndex(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        guard db.folders.contains(where: { $0.id == toFolderId }) else {
            throw APIError.notFound
        }
        let updated = db.messages[index].movedTo(folderId: toFolderId)
        db.messages[index] = updated
        return updated.asMessage
    }

    /// `DELETE /messages/{messageId}`, soft delete: verschiebt die
    /// Nachricht in den Papierkorb-Ordner, genau wie `moveMessage` — kein
    /// neuer Mechanismus, siehe WEB_INBOX.md 08.09. Ein echtes Backend
    /// würde hier zusätzlich Gmail `messages.trash`/IMAP `\Deleted`
    /// spiegeln; das ist außerhalb dessen, was der Mock simuliert.
    func deleteMessage(id: String) async throws {
        await delay()
        guard let papierkorbFolder = db.folders.first(where: { $0.systemKey == .papierkorb }) else {
            throw APIError.notFound
        }
        _ = try await moveMessage(id: id, toFolderId: papierkorbFolder.id)
    }

    /// `DELETE /messages/{messageId}/permanent`: entfernt die Nachricht
    /// vollständig aus der Mock-DB (kein Undo). Ein echtes Backend löscht
    /// zusätzlich beim Provider (Gmail `messages.delete`/IMAP Expunge).
    func permanentlyDeleteMessage(id: String) async throws {
        await delay()
        guard db.messages.contains(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        db.messages.removeAll { $0.id == id }
        db.summaries.removeValue(forKey: id)
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

    /// `POST /messages/send`, Mock: kein echter Provider-Versand, kein
    /// Phishing-Check (der Mock bildet `checkDraftForPhishing()` nirgends
    /// nach) — simuliert nur den Erfolgsfall mit einer erfundenen
    /// `sentMessageId`, analog zu `requestReplyDraft` oben. Anhang-Gate
    /// (WEB_INBOX.md 09.09.) läuft aber echt, gegen `uploadedAttachments`.
    /// Legt zusätzlich (Ordner-Umbau 09.09.) eine lokale `MessageDetail` im
    /// "gesendet"-Ordner an und verwirft den `draftId`-Entwurf, falls
    /// gesetzt -- analog zum echten Backend.
    func sendMessage(inReplyToMessageId: String, to: [String], subject: String?, bodyText: String, attachmentIds: [String], draftId: String?) async throws -> String {
        await delay()
        guard db.messages.contains(where: { $0.id == inReplyToMessageId }) else {
            throw APIError.notFound
        }
        for attachmentId in attachmentIds {
            guard let status = uploadedAttachments[attachmentId] else { throw APIError.notFound }
            guard status == .clean else { throw APIError.blocked(reason: "Anhang ist nicht freigegeben (Status: \(status.rawValue))") }
        }
        let sentMessageId = "mock-sent-\(UUID().uuidString)"

        if let gesendetFolder = db.folders.first(where: { $0.systemKey == .gesendet }) {
            let accountEmail = db.accounts.first?.emailAddress ?? "ich@example.com"
            let sent = MessageDetail(
                id: sentMessageId,
                fromAddress: accountEmail,
                fromDisplayName: nil,
                subject: subject,
                receivedAt: Date(),
                folderId: gesendetFolder.id,
                classification: .unclear,
                bodyText: bodyText,
                security: nil
            )
            db.messages.append(sent)
        }

        if let draftId {
            drafts.removeAll { $0.id == draftId }
        }

        return sentMessageId
    }

    /// `POST /attachments`, Mock: kein echter Scan-Dienst -- dieselbe
    /// einfache Dateiendungs-Heuristik wie
    /// backend/src/lookups/attachmentScanMock.ts, dupliziert statt geteilt
    /// (unterschiedliche Sprachen/Prozesse, kein gemeinsames Package).
    func uploadAttachment(filename: String, mimeType: String, data: Data) async throws -> AttachmentUploadResult {
        await delay()
        let dangerousExtensions: Set<String> = ["exe", "bat", "cmd", "com", "scr", "pif", "msi", "js", "jse", "vbs", "vbe", "ws", "wsf", "ps1", "jar", "docm", "xlsm", "pptm", "dotm", "xltm"]
        let lowerFilename = filename.lowercased()
        let status: AttachmentScanStatus
        if lowerFilename.contains("virus") || lowerFilename.contains("malware") {
            status = .malicious
        } else if let ext = filename.split(separator: ".").last, dangerousExtensions.contains(String(ext).lowercased()) {
            status = .blockedType
        } else {
            status = .clean
        }
        let attachmentId = UUID().uuidString
        uploadedAttachments[attachmentId] = status
        return AttachmentUploadResult(attachmentId: attachmentId, scanStatus: status)
    }

    /// `GET /drafts`, Mock: siehe `drafts`-Kommentar oben.
    func fetchDrafts() async throws -> [Draft] {
        await delay()
        return drafts.sorted { $0.updatedAt > $1.updatedAt }
    }

    /// `DELETE /drafts/{draftId}`.
    func deleteDraft(id: String) async throws {
        await delay()
        guard drafts.contains(where: { $0.id == id }) else { throw APIError.notFound }
        drafts.removeAll { $0.id == id }
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
