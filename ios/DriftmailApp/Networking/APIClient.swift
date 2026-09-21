import Foundation

/// Swift-side client for contracts/api-spec.yaml. Kept as a protocol so the
/// app can run entirely against `MockAPIClient` today and swap in a real
/// `RemoteAPIClient` (URLSession against https://api.driftware.online/v1)
/// once Track A's backend is live — no call sites should need to change.
protocol APIClient {
    /// `GET /mail-providers` (WEB_INBOX.md 15.09./19.09. "Onboarding:
    /// Provider-Auswahlbildschirm") -- öffentlich (kein Token nötig, läuft
    /// vor jedem Login), treibt den Provider-Auswahlbildschirm samt
    /// IMAP-Preset-Vorbefüllung.
    func fetchMailProviders() async throws -> [MailProvider]
    /// `POST /accounts` mit `provider=imap` -- Login-/Registrierungsweg für
    /// Anbieter ohne OAuth (iCloud/GMX/web.de/generisches IMAP). Ebenfalls
    /// öffentlich; liefert bei Erfolg das verbundene Konto + einen neuen
    /// Session-Token (vom Aufrufer in der Keychain zu speichern, siehe
    /// `Security/SessionStore.swift`). Wirft `APIError.verificationFailed`
    /// bei fehlgeschlagenem IMAP-Login (422) und `APIError.notAllowlisted`
    /// bei nicht freigeschalteter Adresse (403).
    func connectImapAccount(emailAddress: String, imapHost: String, imapPort: Int, imapSecure: Bool, imapUser: String?, imapPassword: String, smtpHost: String?, smtpPort: Int?, smtpSecure: Bool?) async throws -> (account: MailAccount, token: String)
    /// `GET /trusted-senders` (WEB_INBOX.md 15.09. "Whitelist
    /// vertrauenswürdiger Absender") -- kombiniert sich mit
    /// `MessageDetail.isNewSender` (siehe dortigen Kommentar).
    func fetchTrustedSenders() async throws -> [TrustedSender]
    /// `POST /trusted-senders` (WEB_INBOX.md 21.09. "KLEINE VERKNUEPFUNG -
    /// Neuer-Absender-Badge mit Whitelist verbinden") -- idempotent laut
    /// Contract, liefert den bestehenden Eintrag auch wenn die Adresse
    /// schon vorhanden war.
    func addTrustedSender(senderAddress: String) async throws -> TrustedSender

    func fetchAccounts() async throws -> [MailAccount]
    /// `POST /accounts/{accountId}/sync` (WEB_INBOX.md 21.09. "SEHR
    /// WICHTIGE LUECKE - HOECHSTE PRIORITAET", Punkt 1) -- fuer Pull-to-
    /// Refresh: loest sofort einen Mail-Abruf fuer EIN Konto aus, statt auf
    /// das automatische Backend-Intervall zu warten.
    func syncAccount(id: String) async throws -> SyncResult

    // Ordner (contracts/api-spec.yaml `/folders`, `/folders/{folderId}`).
    // [2026-09-08] Neu seit der Ordner-Contract-Änderung: Ordner sind
    // jetzt benutzerdefiniert (anlegen/umbenennen/löschen), nicht mehr
    // eine feste Liste.
    /// [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): mit
    /// `accountId` nur die Ordner dieses Kontos ("getrennte Ansichten pro
    /// Konto"), `nil` liefert die Ordner ALLER eigenen Konten zusammen.
    func fetchFolders(accountId: String?) async throws -> [Folder]
    /// `accountId` ist erforderlich, sobald mehr als ein Konto verbunden
    /// ist (siehe backend/README.md) -- bei genau einem Konto optional.
    func createFolder(name: String, icon: String?, accountId: String?) async throws -> Folder
    func updateFolder(id: String, name: String?, icon: String?, sortOrder: Int?) async throws -> Folder
    func deleteFolder(id: String) async throws

    /// `query` (WEB_INBOX.md 21.09. "DREI WEITERE GRUNDFUNKTIONEN" Punkt 2,
    /// "Suche ueber Mails"): Substring-Suche ueber subject/fromAddress/
    /// fromDisplayName/bodyText (siehe backend/README.md "Suche über
    /// Mails"), kombinierbar mit `folderId`/`accountId`. `nil` = kein
    /// Suchfilter, unveraendertes Verhalten.
    func fetchMessages(folderId: String?, accountId: String?, query: String?) async throws -> [Message]
    func fetchMessageDetail(id: String) async throws -> MessageDetail
    func quarantineMessage(id: String) async throws
    /// `POST /messages/{messageId}/unsubscribe` — manuelle Abmeldung über
    /// den List-Unsubscribe-Header der Nachricht (WEB_INBOX.md 09.09.
    /// "Automatische Abmeldung bei Spam"). Nur sinnvoll aufrufbar, wenn
    /// `MessageDetail.canUnsubscribe == true`; der Server prüft das
    /// zusätzlich selbst (400, falls kein gültiger Header vorliegt).
    /// Unabhängig von `classification` — läuft NICHT automatisch bei
    /// phishing, aber der User kann trotzdem manuell abmelden, siehe
    /// backend/README.md. Gibt den resultierenden Status zurück.
    func unsubscribeFromMessage(id: String) async throws -> UnsubscribeStatus
    /// `POST /messages/{messageId}/move` — Nachricht in einen anderen
    /// (System- oder eigenen) Ordner verschieben.
    func moveMessage(id: String, toFolderId: String) async throws -> Message
    /// `DELETE /messages/{messageId}` — Nachricht in den Papierkorb
    /// verschieben (soft delete, analog Gmail). [2026-09-08]
    /// WEB_INBOX.md "Fehlende Basis-Funktion entdeckt" / Contract-Commit
    /// 156f0fd. Verhält sich wie `moveMessage(id:toFolderId:)` in den
    /// Papierkorb-Ordner, ist aber ein eigener Endpunkt, damit ein echtes
    /// Backend zusätzlich die Provider-API spiegeln kann (Gmail
    /// `messages.trash` / IMAP `\Deleted`).
    func deleteMessage(id: String) async throws
    /// `DELETE /messages/{messageId}/permanent` — Nachricht endgültig
    /// löschen (laut Contract nur aus dem Papierkorb heraus sinnvoll; das
    /// UI bietet den Button entsprechend nur dort an, der Endpunkt selbst
    /// prüft das serverseitig).
    func permanentlyDeleteMessage(id: String) async throws
    func fetchSummary(messageId: String) async throws -> MailSummary
    /// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): liefert jetzt auch
    /// `source` (vorher fehlte das Feld komplett in der Backend-Antwort,
    /// siehe api-spec.yaml-Kommentar am Endpunkt) -- `AppEnvironment.
    /// requestReplyDraft(messageId:thread:)` versucht davor bereits lokal
    /// Foundation Models, dieser Aufruf ist nur der Fallback-Pfad.
    func requestReplyDraft(messageId: String) async throws -> (draftText: String, source: AiSource)

    /// `GET /ai-settings` (TERMINAL_INBOX.md 21.09. KORREKTUR, BYOK) --
    /// eigene Cloud-KI-Einstellung des Users, ohne den Key selbst.
    func fetchAiSettings() async throws -> AiSettings
    /// `PUT /ai-settings`. `apiKey` darf `nil` sein, wenn nur `cloudConsent`
    /// geändert wird und bereits ein Key hinterlegt ist (siehe
    /// backend/README.md "KI-Anbindung (BYOK)"). Wirft `APIError.forbidden`
    /// bei einem serverseitig noch nicht implementierten `byokProvider`
    /// (400 -- Web-Client zeigt ohnehin nur `AiProvider.implemented` an).
    func updateAiSettings(mode: AiPreferenceMode, byokProvider: AiProvider?, apiKey: String?, cloudConsent: Bool?) async throws -> AiSettings

    /// `DELETE /accounts/{accountId}` (WEB_INBOX.md 21.09.
    /// "Einstellungsbereich", Konten-Verwaltung) -- entfernt ein Konto
    /// inkl. aller daran haengenden Daten. Wirft `APIError.badRequest`
    /// (400), wenn es das letzte Konto des Users waere.
    func deleteAccount(id: String) async throws
    /// `GET /settings` (WEB_INBOX.md 21.09. "Einstellungsbereich", Ansicht:
    /// Akzentfarben-Auswahl; erweitert um `strictUnknownSenders` in
    /// "FUENF NEUE KOMFORT-FEATURES" Punkt 1) -- allgemeine UI-Praeferenzen
    /// des Users.
    func fetchSettings() async throws -> UserSettings
    /// `PUT /settings`. Beide Parameter `nil` lassen das jeweilige Feld
    /// serverseitig unangetastet (siehe backend/README.md -- `PUT` nutzt
    /// `COALESCE`).
    func updateSettings(accentTheme: AccentTheme?, strictUnknownSenders: Bool?) async throws -> UserSettings

    /// `GET /contacts` (WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES"
    /// Punkt 2 "Kontakt-Autovervollstaendigung") -- bekannte Adressen fuer
    /// An/CC/BCC-Vorschlaege im Compose-Screen, dedupliziert und
    /// alphabetisch sortiert.
    func fetchContacts() async throws -> [String]

    /// `POST /drafts` (WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES"
    /// Punkt 3 "Entwuerfe automatisch speichern"): legt den ERSTEN Entwurf
    /// beim Compose-Vorgang an, sobald der User etwas Sinnvolles getippt
    /// hat (nicht beim blossen Oeffnen des Compose-Screens). `bcc` ist
    /// bewusst NICHT Teil dieser Methode -- der Contract kennt `bcc` weder
    /// bei `POST` noch bei `PATCH /drafts/{id}` (nur bei `POST
    /// /messages/send` selbst), ein vorhandener BCC-Empfaenger bleibt beim
    /// Autosave also client-seitig, geht aber beim tatsaechlichen Versand
    /// ganz normal mit -- dokumentierte Contract-Luecke, kein Bug hier.
    func createDraft(inReplyToMessageId: String?, to: [String], cc: [String], subject: String?, bodyText: String?) async throws -> Draft
    /// `PATCH /drafts/{draftId}` -- Folge-Speicherungen waehrend des
    /// Tippens.
    func updateDraft(id: String, to: [String], cc: [String], subject: String?, bodyText: String?) async throws -> Draft

    /// `POST /messages/send` — sendet eine Antwort auf `inReplyToMessageId`
    /// (das Konto wird backend-seitig aus der Ursprungsnachricht
    /// abgeleitet, siehe backend/README.md "Versand"). Gibt die
    /// provider-seitige `sentMessageId` zurück. Wirft `APIError.blocked`,
    /// wenn der serverseitige Phishing-Check den Versand verhindert hat
    /// (422, siehe api-spec.yaml). [2026-09-09] WEB_INBOX.md "Fehlender
    /// Senden-Endpunkt".
    /// `attachmentIds` (WEB_INBOX.md 09.09. "Erweiterung des Send-Endpunkt-
    /// Eintrags von eben"): jede ID muss aus `uploadAttachment(...)`
    /// stammen und `scanStatus == .clean` gehabt haben, sonst wirft der
    /// Server 422 (`APIError.blocked`) — leeres Array, wenn keine Anhänge.
    /// `draftId` (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
    /// Ordner-Umbau-Eintrags"): falls gesetzt, verwirft der Server den
    /// Entwurf nach erfolgreichem Versand automatisch (intern).
    /// [2026-09-21] Compose-Screen (WEB_INBOX.md 21.09. "BUG - Massimo beim
    /// echten Live-Test entdeckt" + "DREI WEITERE GRUNDFUNKTIONEN" Punkt
    /// 3): erweitert um `accountId` (neue Mail/Weiterleiten -- kein Bezug
    /// zu einer Ursprungsnachricht, Backend leitet das Konto dann NICHT
    /// aus `inReplyToMessageId` ab) sowie `cc`/`bcc`. Genau eines von
    /// `accountId`/`inReplyToMessageId` ist erforderlich (siehe
    /// backend/README.md "Versand") -- bei einer Antwort reicht
    /// `inReplyToMessageId`, das Backend leitet das Konto daraus ab.
    func sendMessage(accountId: String?, inReplyToMessageId: String?, to: [String], cc: [String], bcc: [String], subject: String?, bodyText: String, attachmentIds: [String], draftId: String?) async throws -> String
    /// `POST /attachments` — lädt eine Datei hoch und lässt sie sofort
    /// scannen (siehe backend/README.md "Anhänge").
    func uploadAttachment(filename: String, mimeType: String, data: Data) async throws -> AttachmentUploadResult
    /// `GET /drafts` — Inhalt des "entwuerfe"-Systemordners (WEB_INBOX.md
    /// 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"), NICHT
    /// `fetchMessages(...)`.
    func fetchDrafts() async throws -> [Draft]
    /// `DELETE /drafts/{draftId}` — Entwurf verwerfen.
    func deleteDraft(id: String) async throws
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
    /// `POST /messages/send` was rejected by the server-side phishing
    /// check (422, `blocked: true`) — `reason` is the human-readable
    /// explanation from the response body, if the server sent one.
    case blocked(reason: String?)
    /// `POST /accounts` (`provider=imap`) — the IMAP credentials could not
    /// be verified against the real mail server (422).
    case verificationFailed
    /// `POST /accounts` — `emailAddress` is not on the backend's
    /// `ALLOWED_EMAILS` allowlist (403).
    case notAllowlisted
    /// [2026-09-21] `PUT /ai-settings` — generische 400-Antwort (z.B. nicht
    /// angebundener `byokProvider`, fehlender `apiKey`), `message` ist der
    /// `error`-Text aus dem Response-Body, falls vorhanden.
    case badRequest(message: String?)
}
