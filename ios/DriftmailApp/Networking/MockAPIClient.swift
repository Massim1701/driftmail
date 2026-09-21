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

    /// `GET`/`PUT /settings` (WEB_INBOX.md 21.09. "Einstellungsbereich",
    /// `strictUnknownSenders` in "FUENF NEUE KOMFORT-FEATURES" Punkt 1) --
    /// rein In-Memory, kein Contract-Pendant in MockDatabase.json noetig,
    /// analog zu `aiSettings` oben.
    private var userSettings = UserSettings(accentTheme: .teal, strictUnknownSenders: true)

    /// `GET`/`PUT /privacy-settings` (WEB_INBOX.md 21.09. "5
    /// Wettbewerbs-Luecken" Punkt 1) -- rein In-Memory, analog zu
    /// `userSettings`. Beide Schalter starten aktiviert, wie beim echten
    /// Backend-Default.
    private var privacySettings = PrivacySettings(blockRemoteImages: true, blockTrackingLinks: true)

    /// `GET`/`PATCH /security/breaches` (WEB_INBOX.md 21.09. "5
    /// Wettbewerbs-Luecken" Punkt 3, "Darkweb-/Datenleck-Ueberwachung") --
    /// zwei feste Beispiel-Funde, analog zum `leaktest@example.com`-Muster
    /// des echten (gemockten) Backends, damit die UI auch im Mock-Betrieb
    /// etwas zum Anzeigen/Bestaetigen hat.
    private var breaches: [DataBreachFinding] = [
        DataBreachFinding(
            id: "breach-mock-001",
            accountId: "mock-account",
            breachName: "ExampleForum-Leak-2024",
            breachDate: Calendar.current.date(byAdding: .month, value: -8, to: Date()),
            discoveredAt: Date(timeIntervalSinceNow: -86_400),
            acknowledged: false
        ),
        DataBreachFinding(
            id: "breach-mock-002",
            accountId: "mock-account",
            breachName: "SocialApp-Datenpanne-2023",
            breachDate: Calendar.current.date(byAdding: .month, value: -20, to: Date()),
            discoveredAt: Date(timeIntervalSinceNow: -86_400),
            acknowledged: false
        ),
    ]

    /// `GET`/`PUT /absence-responder` (WEB_INBOX.md 21.09. "NEUER AUFTRAG -
    /// Abwesenheitsassistent") -- rein In-Memory, kein Contract-Pendant in
    /// MockDatabase.json noetig, analog zu `aiSettings`/`userSettings` oben.
    /// Startet inaktiv/leer, exakt wie die echte Backend-Default-Antwort.
    private var absenceResponder = AbsenceResponder(active: false, startDate: nil, endDate: nil, subject: nil, body: nil)

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

    func addTrustedSender(senderAddress: String) async throws -> TrustedSender {
        await delay()
        if let existing = trustedSenders.first(where: { $0.senderAddress == senderAddress }) {
            return existing
        }
        let created = TrustedSender(id: UUID().uuidString, senderAddress: senderAddress, addedAt: Date())
        trustedSenders.append(created)
        return created
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
        let now = Date()
        return db.messages
            .filter { folderId == nil || $0.folderId == folderId }
            // Snooze (WEB_INBOX.md 21.09. "5 Wettbewerbs-Luecken" Punkt 5):
            // eine noch in der Zukunft snoozte Nachricht ist hier unsichtbar,
            // genau wie beim echten Backend (`store.listMessages()`).
            .filter { message in
                guard let snoozedUntil = message.snoozedUntil else { return true }
                return snoozedUntil <= now
            }
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

    /// `POST /messages/{messageId}/unsubscribe` — [2026-09-21] "LUECKE
    /// SCHLIESSEN": Mock liefert direkt `confirmed`, analog zum echten
    /// Backend, das den Aufruf jetzt synchron und real ausführt (siehe
    /// backend/README.md "Automatische Abmeldung bei Spam").
    func unsubscribeFromMessage(id: String) async throws -> UnsubscribeStatus {
        await delay()
        guard let message = db.messages.first(where: { $0.id == id }) else {
            throw APIError.notFound
        }
        guard message.canUnsubscribe else {
            throw APIError.forbidden
        }
        return .confirmed
    }

    /// `POST /messages/{messageId}/snooze` (WEB_INBOX.md 21.09. "5
    /// Wettbewerbs-Luecken" Punkt 5). `until: nil` hebt ein bestehendes
    /// Snooze sofort wieder auf.
    func snoozeMessage(id: String, until: Date?) async throws -> Message {
        await delay()
        guard let index = db.messages.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        let updated = db.messages[index].snoozed(until: until)
        db.messages[index] = updated
        return updated.asMessage
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

    /// `DELETE /accounts/{accountId}`, Mock: dieselbe letztes-Konto-
    /// Validierung wie das echte Backend (`routes/accounts.ts`).
    func deleteAccount(id: String) async throws {
        await delay()
        guard db.accounts.contains(where: { $0.id == id }) else { throw APIError.notFound }
        guard db.accounts.count > 1 else {
            throw APIError.badRequest(message: "Das letzte verbundene Konto kann nicht entfernt werden.")
        }
        db.accounts.removeAll { $0.id == id }
        db.folders.removeAll { $0.accountId == id }
    }

    /// `GET /settings`, Mock: liefert den In-Memory-Zustand.
    func fetchSettings() async throws -> UserSettings {
        await delay()
        return userSettings
    }

    /// `PUT /settings`. `nil`-Parameter lassen das jeweilige Feld
    /// unangetastet, analog zum echten Backend (`COALESCE`).
    func updateSettings(accentTheme: AccentTheme?, strictUnknownSenders: Bool?, nudgeUnansweredEnabled: Bool?) async throws -> UserSettings {
        await delay()
        userSettings = UserSettings(
            accentTheme: accentTheme ?? userSettings.accentTheme,
            strictUnknownSenders: strictUnknownSenders ?? userSettings.strictUnknownSenders,
            nudgeUnansweredEnabled: nudgeUnansweredEnabled ?? userSettings.nudgeUnansweredEnabled
        )
        return userSettings
    }

    /// `GET /privacy-settings`, Mock: liefert den In-Memory-Zustand.
    func fetchPrivacySettings() async throws -> PrivacySettings {
        await delay()
        return privacySettings
    }

    /// `PUT /privacy-settings`. `nil`-Parameter unangetastet, analog `updateSettings(...)`.
    func updatePrivacySettings(blockRemoteImages: Bool?, blockTrackingLinks: Bool?) async throws -> PrivacySettings {
        await delay()
        privacySettings = PrivacySettings(
            blockRemoteImages: blockRemoteImages ?? privacySettings.blockRemoteImages,
            blockTrackingLinks: blockTrackingLinks ?? privacySettings.blockTrackingLinks
        )
        return privacySettings
    }

    /// `GET /security/breaches`, Mock: liefert den In-Memory-Zustand.
    func fetchBreaches() async throws -> [DataBreachFinding] {
        await delay()
        return breaches
    }

    /// `PATCH /security/breaches/{breachId}`.
    func acknowledgeBreach(id: String, acknowledged: Bool) async throws -> DataBreachFinding {
        await delay()
        guard let index = breaches.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        breaches[index].acknowledged = acknowledged
        return breaches[index]
    }

    /// `GET /absence-responder`, Mock: liefert den In-Memory-Zustand.
    func fetchAbsenceResponder() async throws -> AbsenceResponder {
        await delay()
        return absenceResponder
    }

    /// `PUT /absence-responder`, Mock: dieselbe Pflichtfeld-Validierung wie
    /// das echte Backend (`routes/absenceResponder.ts`), damit die
    /// Settings-UI auch ohne `RemoteAPIClient` sinnvoll durchtestbar ist.
    /// `nil`-Parameter lassen das jeweilige Feld unangetastet (COALESCE-
    /// artig), analog zu `updateSettings(accentTheme:strictUnknownSenders:)`;
    /// `clearEndDate: true` entfernt ein zuvor gesetztes Enddatum explizit
    /// (siehe Protokoll-Kommentar in APIClient.swift).
    func updateAbsenceResponder(active: Bool?, startDate: String?, endDate: String?, clearEndDate: Bool, subject: String?, body: String?) async throws -> AbsenceResponder {
        await delay()
        let resultingActive = active ?? absenceResponder.active
        let resultingStartDate = startDate ?? absenceResponder.startDate
        let resultingEndDate = clearEndDate ? nil : (endDate ?? absenceResponder.endDate)
        let resultingSubject = subject ?? absenceResponder.subject
        let resultingBody = body ?? absenceResponder.body
        if resultingActive {
            guard let resultingStartDate, let resultingSubject, !resultingSubject.trimmingCharacters(in: .whitespaces).isEmpty,
                  let resultingBody, !resultingBody.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw APIError.badRequest(message: "active=true verlangt startDate, subject und body")
            }
        }
        absenceResponder = AbsenceResponder(
            active: resultingActive,
            startDate: resultingStartDate,
            endDate: resultingEndDate,
            subject: resultingSubject,
            body: resultingBody
        )
        return absenceResponder
    }

    /// `GET /contacts` (WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES"
    /// Punkt 2) -- einfache Ableitung aus den Absenderadressen der
    /// Mock-Nachrichten, analog zur echten Backend-Logik (dort zusaetzlich
    /// `outgoing_send_log`, das dieser Mock-Client nicht fuehrt).
    func fetchContacts() async throws -> [String] {
        await delay()
        let addresses = Set(db.messages.map { $0.fromAddress.lowercased() })
        return addresses.sorted()
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
    /// `confidentialUntil` (WEB_INBOX.md 21.09. "Vertraulicher Modus"): Mock
    /// speichert es unveraendert auf der "gesendet"-Kopie, loescht aber
    /// (anders als das echte Backend) `bodyText` nie automatisch nach Ablauf
    /// -- kein periodischer Job im Mock-Client, dokumentierte Vereinfachung.
    func sendMessage(accountId: String?, inReplyToMessageId: String?, to: [String], cc: [String], bcc: [String], subject: String?, bodyText: String, attachmentIds: [String], draftId: String?, confidentialUntil: Date?) async throws -> String {
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
                isNewSender: false,
                inReplyToMessageId: inReplyToMessageId,
                confidentialUntil: confidentialUntil
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

    /// `POST /drafts` (WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES"
    /// Punkt 3 "Entwuerfe automatisch speichern") -- Mock legt einen echten
    /// neuen Eintrag im `drafts`-Array an, analog zum echten Backend.
    func createDraft(inReplyToMessageId: String?, to: [String], cc: [String], subject: String?, bodyText: String?) async throws -> Draft {
        await delay()
        let draft = Draft(
            id: UUID().uuidString,
            inReplyToMessageId: inReplyToMessageId,
            to: to,
            cc: cc,
            subject: subject,
            bodyText: bodyText,
            updatedAt: Date()
        )
        drafts.append(draft)
        return draft
    }

    /// `PATCH /drafts/{draftId}`.
    func updateDraft(id: String, to: [String], cc: [String], subject: String?, bodyText: String?) async throws -> Draft {
        await delay()
        guard let index = drafts.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        let updated = Draft(
            id: id,
            inReplyToMessageId: drafts[index].inReplyToMessageId,
            to: to,
            cc: cc,
            subject: subject,
            bodyText: bodyText,
            updatedAt: Date()
        )
        drafts[index] = updated
        return updated
    }

    /// `POST /drafts` mit gesetztem `scheduledFor` (WEB_INBOX.md 21.09. "5
    /// Wettbewerbs-Luecken" Punkt 4, "Schedule Send"). Mock: gleiche
    /// Pflichtfeld-Validierung wie das echte Backend (`to`+`bodyText` nicht
    /// leer), `scheduledFor` muss in der Zukunft liegen -- kein
    /// periodischer Versand-Job im Mock-Client (dokumentierte
    /// Vereinfachung, siehe `sendMessage`-Kommentar).
    func scheduleDraft(accountId: String?, inReplyToMessageId: String?, to: [String], cc: [String], bcc: [String], subject: String?, bodyText: String?, scheduledFor: Date) async throws -> Draft {
        await delay()
        guard !to.isEmpty, let bodyText, !bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw APIError.badRequest(message: "to und bodyText sind fuer Schedule Send erforderlich")
        }
        guard scheduledFor > Date() else {
            throw APIError.badRequest(message: "scheduledFor muss in der Zukunft liegen")
        }
        let draft = Draft(
            id: UUID().uuidString,
            inReplyToMessageId: inReplyToMessageId,
            to: to,
            cc: cc,
            bcc: bcc,
            subject: subject,
            bodyText: bodyText,
            scheduledFor: scheduledFor,
            updatedAt: Date()
        )
        drafts.append(draft)
        return draft
    }

    /// `PATCH /drafts/{draftId}` mit `scheduledFor: null` -- hebt die
    /// Planung auf, der Entwurf selbst bleibt erhalten.
    func cancelScheduledDraft(id: String) async throws -> Draft {
        await delay()
        guard let index = drafts.firstIndex(where: { $0.id == id }) else { throw APIError.notFound }
        let existing = drafts[index]
        let updated = Draft(
            id: existing.id,
            inReplyToMessageId: existing.inReplyToMessageId,
            to: existing.to,
            cc: existing.cc,
            bcc: existing.bcc,
            subject: existing.subject,
            bodyText: existing.bodyText,
            scheduledFor: nil,
            updatedAt: Date()
        )
        drafts[index] = updated
        return updated
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
