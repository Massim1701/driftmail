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
    let onDeviceAdapter: AiAdapter = OnDeviceAiAdapter()
    let cloudFallbackAdapter: AiAdapter = CloudFallbackAiAdapter()

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
    /// gerade ist. Zentral hier gehalten (wie `folders`), sobald mehrere
    /// Konten unterstützt werden ist das derselbe Ort für einen
    /// Account-Switcher (laut Auftrag aber kein Muss für diesen Schritt).
    @Published var account: MailAccount?

    /// `GET /trusted-senders` (WEB_INBOX.md 15.09.), kombiniert mit
    /// `MessageDetail.isNewSender` in `MessageDetailView`'s Badges. Nur die
    /// Adressen, nicht die vollen `TrustedSender`-Objekte -- schnellerer
    /// Lookup, hier reicht Mitgliedschaft.
    @Published var trustedSenderAddresses: Set<String> = []

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
        self.account = account
        self.apiClient = RemoteAPIClient(token: token)
        self.isAuthenticated = true
    }

    /// "Abmelden" (`SettingsView`) — löscht den Token, fällt zurück auf
    /// `MockAPIClient` und cached lokalen Zustand, damit `RootView` wieder
    /// den Onboarding-Provider-Auswahlbildschirm zeigt statt mit veralteten
    /// Konto-Daten in der Hauptansicht hängen zu bleiben.
    func logOut() {
        SessionStore.clear()
        apiClient = MockAPIClient()
        isAuthenticated = false
        account = nil
        folders = []
        trustedSenderAddresses = []
    }

    /// Whichever adapter matches the capability check result, defaulting
    /// to cloud fallback until the check has run.
    var activeAdapter: AiAdapter {
        capability?.activeMode == .onDevice ? onDeviceAdapter : cloudFallbackAdapter
    }

    /// Loads `folders` once and caches it; pass `forceRefresh` after a
    /// mutation (create/rename/delete/move) or on pull-to-refresh.
    func loadFolders(forceRefresh: Bool = false) async {
        if !forceRefresh && !folders.isEmpty { return }
        do {
            folders = try await apiClient.fetchFolders().sorted { $0.sortOrder < $1.sortOrder }
        } catch {
            // Leave the previous list in place; callers show their own
            // loading/error state and can retry via pull-to-refresh.
        }
    }

    /// Lädt das aktive Mail-Konto einmalig (gecacht, wie `loadFolders()`).
    /// `fetchAccounts()` liefert laut Contract alle verbundenen Konten des
    /// Users -- solange driftmail nur ein Konto pro User unterstützt,
    /// reicht das erste. Kein Fehler-State nötig: bleibt `nil`, der
    /// Aufrufer zeigt dann einfach das App-Branding statt der Adresse.
    func loadAccount() async {
        if account != nil { return }
        account = try? await apiClient.fetchAccounts().first
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
}
