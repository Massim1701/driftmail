import SwiftUI

/// Single place wiring up which `APIClient` and `AiAdapter` the app uses.
///
/// [2026-09-21] WEB_INBOX.md 19.09. "Onboarding: Provider-Auswahlbildschirm"
/// ("voll verdrahten" per Rückfrage an Massimo, 21.09.): `apiClient` is now
/// swappable at runtime instead of a fixed `let` — the app boots against
/// `MockAPIClient` until an account is connected (`RootView` gates on
/// `isAuthenticated`), then `completeAccountConnection(account:token:)`
/// swaps it for a token-bearing `RemoteAPIClient` for the rest of the
/// session. If a session token is already in the Keychain at launch (a
/// previous connection), the app skips straight to `RemoteAPIClient`.
@MainActor
final class AppEnvironment: ObservableObject {
    @Published private(set) var apiClient: APIClient
    /// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09., ersetzt WEB_INBOX.md
    /// "ECHTE KI-ANBINDUNG" c3ec563): einziger lokaler AI-Adapter -- versucht
    /// intern zuerst echte Apple-Foundation-Models-Aufrufe, faellt sonst auf
    /// eine deterministische Heuristik zurueck (siehe OnDeviceAiAdapter.swift
    /// Kopfkommentar). `CloudFallbackAiAdapter` (gemockter Fake-Cloud-Pfad)
    /// entfaellt ersatzlos -- ein echter Cloud-Pfad laeuft jetzt ausschliesslich
    /// ueber `apiClient` gegen das Backend (BYOK, siehe `summarize(messageId:
    /// bodyText:)`/`requestReplyDraft(messageId:originalBodyText:)` unten).
    let onDeviceAdapter: AiAdapter = OnDeviceAiAdapter()

    /// KI-Cloud-Einstellung (BYOK) des Users, gespiegelt von `GET
    /// /ai-settings` -- `nil` bis zum ersten `loadAiSettings()`-Aufruf
    /// (z.B. beim Oeffnen der Einstellungen).
    @Published var aiSettings: AiSettings?

    /// Gates `RootView`: false until an account is connected (fresh
    /// install) or found in the Keychain (relaunch after a previous
    /// connection). See type-level comment above.
    @Published private(set) var isAuthenticated: Bool

    @Published var capability: UserAiCapability?

    /// [2026-09-08] Contract-Änderung: Ordner sind jetzt benutzerdefiniert
    /// (`GET /folders`), keine feste Liste mehr. Zentral hier gehalten
    /// (statt in jeder View einzeln geladen), damit `FolderListView` und
    /// `MessageDetailView` (Verschieben-Menü) dieselbe Liste sehen, ohne
    /// den Endpunkt doppelt zu treffen.
    @Published var folders: [Folder] = []

    /// [2026-09-15] WEB_INBOX.md 10.09. "UX-Fund im echten Geräte-Test":
    /// der Header soll die E-Mail-Adresse des verbundenen Kontos zeigen,
    /// nicht das App-Branding -- damit klar ist, in welchem Postfach man
    /// gerade ist. [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09.
    /// Punkt 2): mehrere Konten statt eines einzelnen, `activeAccountId`
    /// bestimmt, welches Konto gerade angezeigt wird ("getrennte Ansichten
    /// pro Konto", Massimos Entscheidung per Rückfrage).
    @Published var accounts: [MailAccount] = []
    @Published var activeAccountId: String?

    var activeAccount: MailAccount? {
        accounts.first { $0.id == activeAccountId }
    }

    /// `GET /trusted-senders` (WEB_INBOX.md 15.09.), kombiniert mit
    /// `MessageDetail.isNewSender` in `MessageDetailView`'s Badges. Nur die
    /// Adressen, nicht die vollen `TrustedSender`-Objekte -- schnellerer
    /// Lookup, hier reicht Mitgliedschaft.
    @Published var trustedSenderAddresses: Set<String> = []

    /// [2026-09-21] "Einstellungsbereich"-Auftrag (WEB_INBOX.md 21.09.):
    /// gespiegelt von `GET /settings`, Default `teal` bis zum ersten
    /// `loadSettings()`-Aufruf. `@Published`, damit Views, die `environment`
    /// bereits als `@EnvironmentObject` beobachten, bei jeder
    /// `applyAccentTheme()`-Aenderung automatisch neu zeichnen -- siehe
    /// `DesignTokens.Color.accent`-Kommentar.
    @Published private(set) var accentTheme: AccentTheme = .teal

    /// [2026-09-21] Session-Bootstrap: `RemoteAPIClient` nur, wenn bereits
    /// ein Token in der Keychain liegt (vorherige Verbindung), sonst wie
    /// bisher `MockAPIClient` -- siehe Typ-Kommentar oben.
    init() {
        if let token = SessionStore.loadToken() {
            self.apiClient = RemoteAPIClient(token: token)
            self.isAuthenticated = true
        } else {
            self.apiClient = MockAPIClient()
            self.isAuthenticated = false
        }
    }

    /// Test-/Preview-Hook: erzwingt einen bestimmten Client unabhängig von
    /// der Keychain (z.B. `AppEnvironment(previewClient: MockAPIClient())`
    /// in `#Preview`-Blöcken, die bewusst den Onboarding-Zustand überspringen
    /// wollen).
    init(previewClient: APIClient, authenticated: Bool = true) {
        self.apiClient = previewClient
        self.isAuthenticated = authenticated
    }

    /// Called once `OnboardingAccountConnectView` gets a successful
    /// `{account, token}` back from `POST /accounts` (or a future Gmail
    /// OAuth callback). Persists the token to the Keychain and switches the
    /// whole app over to a real, token-bearing `RemoteAPIClient` — nothing
    /// downstream needs to change since views only ever talk to the
    /// `APIClient` protocol.
    func completeAccountConnection(account: MailAccount, token: String) {
        SessionStore.save(token: token)
        self.accounts = [account]
        self.activeAccountId = account.id
        self.apiClient = RemoteAPIClient(token: token)
        self.isAuthenticated = true
    }

    /// [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): ein
    /// weiteres Konto wurde über `OnboardingAccountConnectView` (im
    /// `addAccount`-Modus, aus `FolderListView`s Settings-Sheet heraus)
    /// erfolgreich verbunden -- `accounts` neu laden (statt nur lokal
    /// anzuhängen, damit der Server die Quelle der Wahrheit bleibt) und
    /// direkt zu diesem Konto wechseln.
    func handleAccountAdded(_ account: MailAccount) async {
        await loadAccounts(forceRefresh: true)
        switchAccount(to: account.id)
    }

    /// Wechselt das aktive Konto ("getrennte Ansichten pro Konto") --
    /// Ordner/Trusted-Senders gehören zum vorherigen Konto und werden
    /// verworfen, Aufrufer (`FolderListView`) laden für das neue Konto neu.
    func switchAccount(to accountId: String) {
        guard accountId != activeAccountId else { return }
        activeAccountId = accountId
        folders = []
        trustedSenderAddresses = []
    }

    /// "Abmelden" (`SettingsView`) — löscht den Token, fällt zurück auf
    /// `MockAPIClient` und cached lokalen Zustand, damit `RootView` wieder
    /// den Onboarding-Provider-Auswahlbildschirm zeigt statt mit veralteten
    /// Konto-Daten in der Hauptansicht hängen zu bleiben.
    func logOut() {
        SessionStore.clear()
        apiClient = MockAPIClient()
        isAuthenticated = false
        accounts = []
        activeAccountId = nil
        folders = []
        trustedSenderAddresses = []
        contacts = []
    }

    /// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): Geraete-eigene KI
    /// zuerst versuchen (Inhalt verlaesst dann nie das Geraet), `apiClient`
    /// nur als Fallback -- das ruft bei `RemoteAPIClient` den echten
    /// BYOK-/Heuristik-Pfad im Backend auf (siehe backend/README.md
    /// "KI-Anbindung (BYOK)"), bei `MockAPIClient` dessen eigenen
    /// On-Device-Stub-Aufruf. `OnDeviceAiAdapter.summarize()` faellt selbst
    /// schon auf eine Heuristik zurueck, wenn Foundation Models nicht
    /// verfuegbar ist -- deshalb hier nur einmal ueber
    /// `OnDeviceModelAvailability.isAvailable` gegated (kein Sinn, den
    /// echten Foundation-Models-Call zu versuchen, wenn er sicher
    /// scheitert -- sofortiges Foundation-Models-Skip statt eines
    /// garantiert fehlschlagenden Versuchs).
    func summarize(messageId: String, bodyText: String) async -> MailSummary {
        if OnDeviceModelAvailability.isAvailable, let result = try? await onDeviceAdapter.summarize(rawText: bodyText) {
            return result
        }
        if let result = try? await apiClient.fetchSummary(messageId: messageId) {
            return result
        }
        return MailSummary(summaryText: "Zusammenfassung nicht verfügbar.", actionRequired: false, actionDescription: nil, deadline: nil, source: .heuristic)
    }

    /// Analog zu `summarize(messageId:bodyText:)` oben, fuer den
    /// KI-Entwurf-Button. `thread` wird vom Aufrufer (MessageDetailView)
    /// aus der bereits geladenen `MessageDetail` zusammengebaut -- kein
    /// zusaetzlicher Netzwerk-Roundtrip fuer den On-Device-Versuch noetig.
    func requestReplyDraft(messageId: String, thread: MailThread) async -> (draftText: String, source: AiSource) {
        if OnDeviceModelAvailability.isAvailable, let text = try? await onDeviceAdapter.draftReply(thread: thread), !text.isEmpty {
            return (text, .onDevice)
        }
        if let result = try? await apiClient.requestReplyDraft(messageId: messageId) {
            return result
        }
        return ("", .heuristic)
    }

    /// `GET /ai-settings` -- lädt die aktuelle BYOK-Einstellung. Stiller
    /// Fehlschlag (z.B. `MockAPIClient`, das den Endpunkt nicht kennt) lässt
    /// `aiSettings` einfach `nil`, die Settings-UI zeigt dann eine
    /// Fehlermeldung statt eines veralteten Zustands.
    func loadAiSettings() async {
        aiSettings = try? await apiClient.fetchAiSettings()
    }

    /// `PUT /ai-settings`. Aktualisiert `aiSettings` bei Erfolg direkt aus
    /// der Server-Antwort (Quelle der Wahrheit, kein optimistisches Update).
    @discardableResult
    func updateAiSettings(mode: AiPreferenceMode, byokProvider: AiProvider?, apiKey: String?, cloudConsent: Bool?) async throws -> AiSettings {
        let updated = try await apiClient.updateAiSettings(mode: mode, byokProvider: byokProvider, apiKey: apiKey, cloudConsent: cloudConsent)
        aiSettings = updated
        return updated
    }

    /// Loads `folders` for the ACTIVE account once and caches it; pass
    /// `forceRefresh` after a mutation (create/rename/delete/move) or on
    /// pull-to-refresh. [2026-09-21] Mehrfach-Konten: scoped auf
    /// `activeAccountId` -- ohne aktives Konto (noch nicht geladen) ein
    /// No-Op, `FolderListView` ruft das nach `loadAccounts()` erneut auf.
    func loadFolders(forceRefresh: Bool = false) async {
        guard let activeAccountId else { return }
        if !forceRefresh && !folders.isEmpty { return }
        do {
            folders = try await apiClient.fetchFolders(accountId: activeAccountId).sorted { $0.sortOrder < $1.sortOrder }
        } catch {
            // Leave the previous list in place; callers show their own
            // loading/error state and can retry via pull-to-refresh.
        }
    }

    /// Lädt ALLE verbundenen Mail-Konten (gecacht, wie `loadFolders()`) und
    /// aktiviert bei der ersten Ladung automatisch das erste. [2026-09-21]
    /// Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): vorher nur das erste
    /// Konto, jetzt alle -- "getrennte Ansichten pro Konto" statt
    /// implizitem Einzelkonto. Kein Fehler-State nötig: bleibt leer, der
    /// Aufrufer zeigt dann einfach das App-Branding statt der Adresse.
    func loadAccounts(forceRefresh: Bool = false) async {
        if !forceRefresh && !accounts.isEmpty { return }
        let fetched = (try? await apiClient.fetchAccounts()) ?? []
        accounts = fetched
        if let activeAccountId, fetched.contains(where: { $0.id == activeAccountId }) {
            return // bereits aktives Konto ist weiterhin gültig, nicht überschreiben
        }
        activeAccountId = fetched.first?.id
    }

    /// `GET /trusted-senders`, gecacht wie `folders`/`account`. Fehler
    /// bleiben still (leere Liste) -- die "Neuer Absender"-Badge zeigt sich
    /// dann im Zweifel für alle `isNewSender=true`-Nachrichten, statt die
    /// Detailansicht zu blockieren (gleiches Prinzip wie im Web-Client).
    func loadTrustedSenders() async {
        if !trustedSenderAddresses.isEmpty { return }
        let senders = (try? await apiClient.fetchTrustedSenders()) ?? []
        trustedSenderAddresses = Set(senders.map(\.senderAddress))
    }

    /// `POST /trusted-senders` (WEB_INBOX.md 21.09. "KLEINE VERKNUEPFUNG -
    /// Neuer-Absender-Badge mit Whitelist verbinden"): adds directly from
    /// the "Neuer Absender" badge instead of requiring a trip through
    /// Settings. Optimistic local update (mirrors web's `handleTrustSender`)
    /// -- the badge disappears for every message from this sender, not just
    /// the one currently open, without a full re-fetch.
    func trustSender(_ address: String) async {
        guard (try? await apiClient.addTrustedSender(senderAddress: address)) != nil else { return }
        trustedSenderAddresses.insert(address)
    }

    /// [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt
    /// 2 ("Kontakt-Autovervollstaendigung"): bekannte Adressen fuer An/CC/
    /// BCC-Vorschlaege in `ComposeView`, gecacht wie `trustedSenderAddresses`
    /// -- geladen einmal beim Oeffnen des Compose-Screens (siehe dort), kein
    /// erneuter Server-Roundtrip pro Tastendruck.
    @Published var contacts: [String] = []

    func loadContacts() async {
        if !contacts.isEmpty { return }
        contacts = (try? await apiClient.fetchContacts()) ?? []
    }

    /// Overwrites the live `DesignTokens.Color.accent` AND bumps
    /// `accentTheme` (`@Published`) in one place -- every caller (load and
    /// save alike) goes through this, so the two never drift apart.
    private func applyAccentTheme(_ theme: AccentTheme) {
        DesignTokens.Color.accent = SwiftUI.Color(hex: theme.accentHex)
        accentTheme = theme
    }

    /// [2026-09-21] "FUENF NEUE KOMFORT-FEATURES" Punkt 1: gespiegelt von
    /// `GET /settings` wie `accentTheme` -- Default `true`, bis
    /// `loadSettings()` den echten Wert geladen hat.
    @Published private(set) var strictUnknownSenders = true

    /// [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2
    /// ("Nudge"), gespiegelt von `GET /settings`. Default `true` wie das
    /// Backend, bis `loadSettings()` den echten Wert geladen hat.
    @Published private(set) var nudgeUnansweredEnabled = true

    /// `GET /settings` (WEB_INBOX.md 21.09. "Einstellungsbereich", Ansicht:
    /// Akzentfarben-Auswahl; erweitert um `strictUnknownSenders` in "FUENF
    /// NEUE KOMFORT-FEATURES" Punkt 1) -- lädt einmal beim App-Start (siehe
    /// `FolderListView.task`), analog zu `loadTrustedSenders()`. Stiller
    /// Fehlschlag lässt die Defaults stehen.
    func loadSettings() async {
        guard let settings = try? await apiClient.fetchSettings() else { return }
        applyAccentTheme(settings.accentTheme)
        strictUnknownSenders = settings.strictUnknownSenders
        nudgeUnansweredEnabled = settings.nudgeUnansweredEnabled
    }

    /// `PUT /settings`. Aktualisiert `accentTheme`/die Live-Farbe und
    /// `strictUnknownSenders` erst NACH erfolgreicher Server-Antwort
    /// (Quelle der Wahrheit), kein optimistisches Umfärben/Umschalten.
    @discardableResult
    func updateAccentTheme(_ theme: AccentTheme) async throws -> UserSettings {
        let updated = try await apiClient.updateSettings(accentTheme: theme, strictUnknownSenders: nil, nudgeUnansweredEnabled: nil)
        applyAccentTheme(updated.accentTheme)
        strictUnknownSenders = updated.strictUnknownSenders
        nudgeUnansweredEnabled = updated.nudgeUnansweredEnabled
        return updated
    }

    /// `PUT /settings` fuer den `strictUnknownSenders`-Toggle in
    /// `SettingsView` -- eigene Methode statt eines gemeinsamen Parameters
    /// im Aufrufer, damit jede Einstellung fuer sich unabhaengig speicherbar
    /// bleibt (mirrors `updateAccentTheme(_:)` oben).
    @discardableResult
    func updateStrictUnknownSenders(_ enabled: Bool) async throws -> UserSettings {
        let updated = try await apiClient.updateSettings(accentTheme: nil, strictUnknownSenders: enabled, nudgeUnansweredEnabled: nil)
        applyAccentTheme(updated.accentTheme)
        strictUnknownSenders = updated.strictUnknownSenders
        nudgeUnansweredEnabled = updated.nudgeUnansweredEnabled
        return updated
    }

    /// `PUT /settings` fuer den Nudge-Toggle (WEB_INBOX.md 21.09. "DREI
    /// WEITERE FEATURES - Gmail-Recherche" Punkt 2) -- mirrors
    /// `updateStrictUnknownSenders(_:)`.
    @discardableResult
    func updateNudgeUnansweredEnabled(_ enabled: Bool) async throws -> UserSettings {
        let updated = try await apiClient.updateSettings(accentTheme: nil, strictUnknownSenders: nil, nudgeUnansweredEnabled: enabled)
        applyAccentTheme(updated.accentTheme)
        strictUnknownSenders = updated.strictUnknownSenders
        nudgeUnansweredEnabled = updated.nudgeUnansweredEnabled
        return updated
    }

    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 1 ("Tracking-Pixel-
    /// Blockierung"), gespiegelt von `GET /privacy-settings`. `nil` bis zum
    /// ersten `loadPrivacySettings()`-Aufruf (analog `absenceResponder`).
    @Published private(set) var privacySettings: PrivacySettings?

    func loadPrivacySettings() async {
        privacySettings = try? await apiClient.fetchPrivacySettings()
    }

    /// `PUT /privacy-settings`. Aktualisiert `privacySettings` erst NACH
    /// erfolgreicher Server-Antwort, analog `updateStrictUnknownSenders(_:)`.
    @discardableResult
    func updatePrivacySettings(blockRemoteImages: Bool? = nil, blockTrackingLinks: Bool? = nil) async throws -> PrivacySettings {
        let updated = try await apiClient.updatePrivacySettings(blockRemoteImages: blockRemoteImages, blockTrackingLinks: blockTrackingLinks)
        privacySettings = updated
        return updated
    }

    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 3 ("Darkweb-/Datenleck-
    /// Ueberwachung"), gespiegelt von `GET /security/breaches`. Leer bis
    /// zum ersten `loadBreaches()`-Aufruf.
    @Published private(set) var breaches: [DataBreachFinding] = []

    /// Anzahl noch nicht bestaetigter Funde -- treibt ein Badge in
    /// `FolderListView`, analog zum Abwesenheits-Banner dort.
    var unacknowledgedBreachCount: Int {
        breaches.filter { !$0.acknowledged }.count
    }

    func loadBreaches() async {
        breaches = (try? await apiClient.fetchBreaches()) ?? []
    }

    /// `PATCH /security/breaches/{breachId}`. Aktualisiert den betroffenen
    /// Eintrag in `breaches` direkt aus der Server-Antwort.
    @discardableResult
    func acknowledgeBreach(id: String, acknowledged: Bool) async throws -> DataBreachFinding {
        let updated = try await apiClient.acknowledgeBreach(id: id, acknowledged: acknowledged)
        if let index = breaches.firstIndex(where: { $0.id == id }) {
            breaches[index] = updated
        }
        return updated
    }

    /// `DELETE /accounts/{accountId}` (WEB_INBOX.md 21.09.
    /// "Einstellungsbereich", Konten-Verwaltung). Wirft `APIError.badRequest`
    /// weiter, wenn es das letzte Konto des Users wäre (Server-Check bleibt
    /// die Wahrheit, auch wenn `SettingsView` denselben Fall schon
    /// client-seitig ausblendet). Lädt `accounts` danach neu -- war das
    /// entfernte Konto das aktive, setzt `loadAccounts()` automatisch ein
    /// verbleibendes als neues aktives Konto (siehe dortige Logik); Ordner/
    /// Trusted-Senders gehörten zum alten Konto und werden dann verworfen,
    /// analog zu `switchAccount(to:)`.
    func removeAccount(_ accountId: String) async throws {
        let wasActive = accountId == activeAccountId
        try await apiClient.deleteAccount(id: accountId)
        await loadAccounts(forceRefresh: true)
        if wasActive {
            folders = []
            trustedSenderAddresses = []
        }
    }

    /// [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG -
    /// Abwesenheitsassistent": gespiegelt von `GET /absence-responder`,
    /// `nil` bis zum ersten `loadAbsenceResponder()`-Aufruf (analog
    /// `aiSettings`). `@Published`, damit `FolderListView`s aktiver
    /// Banner sofort verschwindet/erscheint, sobald sich der Zustand
    /// ändert -- auch aus `AbsenceResponderView` heraus, die auf demselben
    /// `AppEnvironment` sitzt.
    @Published private(set) var absenceResponder: AbsenceResponder?

    func loadAbsenceResponder() async {
        absenceResponder = try? await apiClient.fetchAbsenceResponder()
    }

    /// `PUT /absence-responder`. Aktualisiert `absenceResponder` bei Erfolg
    /// direkt aus der Server-Antwort (Quelle der Wahrheit), kein
    /// optimistisches Update -- analog `updateAiSettings`/`updateSettings`.
    /// `clearEndDate` defaultet auf `false`, damit die "Jetzt beenden"-
    /// Schnellaktion (`FolderListView`) es nicht extra angeben muss.
    @discardableResult
    func updateAbsenceResponder(active: Bool?, startDate: String?, endDate: String?, clearEndDate: Bool = false, subject: String?, body: String?) async throws -> AbsenceResponder {
        let updated = try await apiClient.updateAbsenceResponder(active: active, startDate: startDate, endDate: endDate, clearEndDate: clearEndDate, subject: subject, body: body)
        absenceResponder = updated
        return updated
    }
}
