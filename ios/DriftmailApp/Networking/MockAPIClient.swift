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
    /// `GET/POST/DELETE /trusted-senders` (WEB_INBOX.md 15.09.) -- kein
    /// Contract-Pendant in MockDatabase.json nötig (analog zu `drafts`
    /// oben), startet leer, damit die "Neuer Absender"-Badge in der Mock-UI
    /// überhaupt sichtbar wird (siehe die eine Fixture-Nachricht mit
    /// `isNewSender=true` in MockDatabase.json).
    private var trustedSenders: [TrustedSender] = []

    /// `GET`/`PUT /ai-settings` (TERMINAL_INBOX.md 21.09. KORREKTUR, BYOK)
    /// -- rein In-Memory, kein Contract-Pendant in MockDatabase.json noetig
    /// (analog zu `trustedSenders`/`drafts` oben), startet im Default-
    /// Zustand ("aus", kein driftmail-finanzierter Cloud-Zugang).
    private var aiSettings = AiSettings(mode: .off, byokProvider: nil, hasApiKey: false, cloudConsentGiven: false)

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

    func fetchMailProviders() async throws -> [MailProvider] {
        await delay()
        return MailProvider.mocked
    }

    /// `POST /accounts` (`provider=imap`), Mock: nimmt jede Eingabe an
    /// (kein echter IMAP-Verbindungstest möglich ohne echten Server) --
    /// legt/aktualisiert `db.accounts[0]` und liefert einen Platzhalter-
    /// Token, analog zum Mock-Server-Verhalten auf Web
    /// (`web/mock-server/server.mjs` `POST /accounts`).
    func connectImapAccount(emailAddress: String, imapHost: String, imapPort: Int, imapSecure: Bool, imapUser: String?, imapPassword: String, smtpHost: String?, smtpPort: Int?, smtpSecure: Bool?) async throws -> (account: MailAccount, token: String) {
        await delay()
        let account = MailAccount(id: UUID().uuidString, provider: .imap, emailAddress: emailAddress, syncStatus: .ok)
        db.accounts = [account]
        return (account, "mock-session-token")
    }

    func fetchTrustedSenders() async throws -> [TrustedSender] {
        await delay()
        return trustedSenders
    }

    func fetchAccounts() async throws -> [MailAccount] {
        await delay()
        return db.accounts
    }

    /// `POST /accounts/{accountId}/sync`, Mock: kein echter IMAP-Abruf
    /// möglich -- liefert nur einen Platzhalter-Erfolg, damit Pull-to-
    /// Refresh gegen den Mock-Client nicht bricht (gleiches Prinzip wie
    /// web/mock-server/server.mjs).
    func syncAccount(id: String) async throws -> SyncResult {
        await delay()
        guard db.accounts.contains(where: { $0.id == id }) else { throw APIError.notFound }
        return SyncResult(imported: 0, autoDeleted: 0, syncStatus: .ok)
    }

    func fetchFolders(accountId: String?) async throws -> [Folder] {
        await delay()
        let filtered = accountId == nil ? db.folders : db.folders.filter { $0.accountId == accountId }
        return filtered.sorted { $0.sortOrder < $1.sortOrder }
    }

    func createFolder(name: String, icon: String?, accountId: String?) async throws -> Folder {
        await delay()
        // Mock hat wie MockDatabase.json aktuell nur ein Konto -- fällt ohne
        // explizite accountId auf dieses zurück, analog zur echten
        // Backend-Logik bei genau einem verbundenen Konto.
        guard let resolvedAccountId = accountId ?? db.accounts.first?.id else {
            throw APIError.notFound
        }
        let siblingSortOrders = db.folders.filter { $0.accountId == resolvedAccountId }.map(\.sortOrder)
        let folder = Folder(
            id: UUID().uuidString,
            accountId: resolvedAccountId,
            name: name,
            icon: icon ?? DesignTokens.CustomFolder.defaultIcon,
            isSystem: false,
            systemKey: nil,
            sortOrder: (siblingSortOrders.max() ?? -1) + 1
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

    /// `accountId` bleibt hier ungenutzt (Mock kennt wie `MockDatabase.json`
    /// nur ein einziges Konto, siehe Kommentar bei `createFolder`).
    /// `query` (WEB_INBOX.md 21.09. "Suche ueber Mails"): dieselbe
    /// Substring-Semantik wie das echte Backend, siehe
    /// backend/README.md "Suche über Mails".
    func fetchMessages(folderId: String?, accountId: String?, query: String?) async throws -> [Message] {
        await delay()
        let needle = query?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return db.messages
            .filter { folderId == nil || $0.folderId == folderId }
            .filter { message in
                guard let needle, !needle.isEmpty else { return true }
                return (message.subject?.lowercased().contains(needle) ?? false)
                    || message.fromAddress.lowercased().contains(needle)
                    || (message.fromDisplayName?.lowercased().contains(needle) ?? false)
                    || (message.bodyText?.lowercased().contains(needle) ?? false)
            }
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

    /// `POST /messages/{messageId}/unsubscribe` — Mock liefert direkt
    /// `pending_confirmation`, analog zum echten Backend beim manuellen
    /// Pfad (siehe backend/README.md "Automatische Abmeldung bei Spam").
    func unsubscribeFromMessage(id: String) async throws -> UnsubscribeStatus {
        await delay()
        guard let message = db.messages.first(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        guard message.canUnsubscribe else {
            throw APIError.forbidden
        }
        return .pendingConfirmation
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

    func requestReplyDraft(messageId: String) async throws -> (draftText: String, source: AiSource) {
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
        // [2026-09-21] KORREKTUR: OnDeviceAiAdapter entscheidet intern schon
        // selbst zwischen echtem Foundation-Models-Aufruf und Heuristik --
        // der Mock muss diese Entscheidung nicht kennen, nur das Ergebnis
        // ehrlich weiterreichen (nicht mehr pauschal `.onDevice` behaupten).
        let draftText = try await OnDeviceAiAdapter().draftReply(thread: thread)
        let source: AiSource = OnDeviceModelAvailability.isAvailable ? .onDevice : .heuristic
        return (draftText, source)
    }

    /// `GET /ai-settings`, Mock: liefert den In-Memory-Zustand.
    func fetchAiSettings() async throws -> AiSettings {
        await delay()
        return aiSettings
    }

    /// `PUT /ai-settings`, Mock: dieselbe Validierung wie das echte Backend
    /// (`routes/aiSettings.ts`), damit die Settings-UI auch ohne
    /// `RemoteAPIClient` sinnvoll durchtestbar ist.
    func updateAiSettings(mode: AiPreferenceMode, byokProvider: AiProvider?, apiKey: String?, cloudConsent: Bool?) async throws -> AiSettings {
        await delay()
        if mode == .off {
            aiSettings = AiSettings(mode: .off, byokProvider: nil, hasApiKey: false, cloudConsentGiven: false)
            return aiSettings
        }
        guard let provider = byokProvider ?? aiSettings.byokProvider else {
            throw APIError.badRequest(message: "byokProvider ist erforderlich, wenn mode=byok gesetzt wird")
        }
        guard AiProvider.implemented.contains(provider) else {
            throw APIError.badRequest(message: "Anbieter '\(provider.rawValue)' ist noch nicht implementiert.")
        }
        guard apiKey != nil || aiSettings.hasApiKey else {
            throw APIError.badRequest(message: "apiKey ist erforderlich, wenn noch kein Key hinterlegt ist")
        }
        aiSettings = AiSettings(
            mode: .byok,
            byokProvider: provider,
            hasApiKey: apiKey != nil || aiSettings.hasApiKey,
            cloudConsentGiven: cloudConsent ?? aiSettings.cloudConsentGiven
        )
        return aiSettings
    }

    /// `POST /messages/send`, Mock: kein echter Provider-Versand, kein
    /// Phishing-Check (der Mock bildet `checkDraftForPhishing()` nirgends
    /// nach) — simuliert nur den Erfolgsfall mit einer erfundenen
    /// `sentMessageId`, analog zu `requestReplyDraft` oben. Anhang-Gate
    /// (WEB_INBOX.md 09.09.) läuft aber echt, gegen `uploadedAttachments`.
    /// Legt zusätzlich (Ordner-Umbau 09.09.) eine lokale `MessageDetail` im
    /// "gesendet"-Ordner an und verwirft den `draftId`-Entwurf, falls
    /// gesetzt -- analog zum echten Backend.
    /// [2026-09-21] Compose-Screen (WEB_INBOX.md 21.09.): genau eines von
    /// `accountId`/`inReplyToMessageId` erforderlich, analog zum echten
    /// Backend -- `cc`/`bcc` werden vom Mock entgegengenommen, aber (wie
    /// beim echten Versand ohnehin nicht sichtbar) nirgends weiter
    /// ausgewertet.
    func sendMessage(accountId: String?, inReplyToMessageId: String?, to: [String], cc: [String], bcc: [String], subject: String?, bodyText: String, attachmentIds: [String], draftId: String?) async throws -> String {
        await delay()
        if let inReplyToMessageId {
            guard db.messages.contains(where: { $0.id == inReplyToMessageId }) else {
                throw APIError.notFound
            }
        } else {
            guard let accountId, db.accounts.contains(where: { $0.id == accountId }) else {
                throw APIError.notFound
            }
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
                security: nil,
                canUnsubscribe: false,
                isNewSender: false
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
