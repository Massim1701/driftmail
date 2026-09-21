import SwiftUI

/// Root inbox screen: the user's folders (System- und eigene, aus
/// `GET /folders`), each with an unread-ish count pulled from
/// `GET /messages`.
///
/// [2026-09-08] Contract-Änderung: liest jetzt aus `environment.folders`
/// (dynamische Liste) statt aus einem festen 5-Werte-Enum
/// (`Folder.allCases`). Zusätzlich ein einfacher "Neuer Ordner"-Button,
/// da `POST /folders` jetzt Teil des Contracts ist.
struct FolderListView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var counts: [String: Int] = [:]
    @State private var isLoading = true
    @State private var isCreatingFolder = false
    @State private var newFolderName = ""
    @State private var errorMessage: String?
    // [2026-09-19] WEB_INBOX.md 15.09. "App-Sperre": erste Settings-Fläche
    // in diesem Scaffold überhaupt, bewusst minimal (nur der eine Toggle)
    // statt eines eigenen Screens/Tabs -- kann bei Bedarf zu einer echten
    // Settings-Liste wachsen, sobald es mehr als eine Einstellung gibt.
    @State private var isShowingSettings = false
    // "Neue Nachricht" (WEB_INBOX.md 21.09. "BUG - Massimo beim echten
    // Live-Test entdeckt"): öffnet `ComposeView` im `.new`-Modus.
    @State private var isComposingNew = false
    // Suche (WEB_INBOX.md 21.09. "DREI WEITERE GRUNDFUNKTIONEN" Punkt 2,
    // "Suche ueber Mails"): kontoweit wie im Web-Client (nicht auf den
    // gerade betrachteten Ordner beschränkt -- diese Ansicht IST die
    // Ordnerliste, es gibt hier gar keinen "aktuellen Ordner"). Ersetzt bei
    // nicht-leerem Suchbegriff die Ordnerliste durch die Trefferliste.
    @State private var searchText = ""
    @State private var searchResults: [Message] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    private var isSearchActive: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.dangerText)
                        .listRowBackground(Color.clear)
                }

                // [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG -
                // Abwesenheitsassistent": aktiver Hinweis mit direkter
                // "Jetzt beenden"-Schnellaktion, solange der Assistent
                // läuft -- nicht während einer aktiven Suche, um die
                // Trefferliste nicht zu verdrängen.
                if !isSearchActive, environment.absenceResponder?.active == true {
                    absenceResponderBanner
                }

                if isSearchActive {
                    if searchResults.isEmpty && !isSearching {
                        ContentUnavailableCompat(title: "Keine Treffer", systemImage: "magnifyingglass")
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                    ForEach(searchResults) { message in
                        NavigationLink(value: message) {
                            MessageRowView(message: message)
                        }
                        .listRowBackground(DesignTokens.Color.surfaceCard)
                    }
                } else {
                    ForEach(environment.folders) { folder in
                        NavigationLink(value: folder) {
                            FolderRow(folder: folder, count: counts[folder.id] ?? 0)
                        }
                        .listRowBackground(DesignTokens.Color.surfaceCard)
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(DesignTokens.Color.surfacePage)
            .searchable(text: $searchText, prompt: "Nach Betreff, Absender oder Inhalt suchen…")
            .onChange(of: searchText) { _, newValue in
                searchTask?.cancel()
                guard !newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    searchResults = []
                    isSearching = false
                    return
                }
                searchTask = Task {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    guard !Task.isCancelled else { return }
                    await runSearch(query: newValue)
                }
            }
            // [2026-09-15] WEB_INBOX.md 10.09.: zeigt die E-Mail-Adresse des
            // AKTIVEN Kontos statt des App-Namens, sobald geladen -- User
            // soll immer sofort sehen, in welchem Postfach er ist. Fällt auf
            // "driftmail" zurück, solange Konten noch laden oder aus einem
            // echten Fehler heraus (loadAccounts() lässt activeAccountId
            // dann bewusst nil statt einen Ladezustand zu erzwingen).
            // [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2):
            // activeAccount statt des einzelnen account.
            .navigationTitle(environment.activeAccount?.emailAddress ?? "driftmail")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Einstellungen")
                }
                // [2026-09-21] Mehrfach-Konten: Umschalter nur sichtbar, wenn
                // es tatsächlich mehr als ein Konto gibt -- kein totes UI
                // für den (häufigeren) Einzelkonto-Fall, gleiches Prinzip
                // wie web/src/components/FolderSidebar.tsx.
                if environment.accounts.count > 1 {
                    ToolbarItem(placement: .topBarLeading) {
                        accountSwitcherMenu
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        newFolderName = ""
                        isCreatingFolder = true
                    } label: {
                        Image(systemName: "folder.badge.plus")
                    }
                    .accessibilityLabel("Neuer Ordner")
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isComposingNew = true
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("Neue Nachricht")
                }
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsView()
            }
            .sheet(isPresented: $isComposingNew) {
                ComposeView(mode: .new, onSent: {})
            }
            .navigationDestination(for: Folder.self) { folder in
                // "entwuerfe" zeigt GET /drafts, nicht GET /messages (siehe
                // Folder.isDrafts, WEB_INBOX.md 09.09. "KORREKTUR/
                // ERWEITERUNG des Ordner-Umbau-Eintrags").
                if folder.isDrafts {
                    DraftListView(folder: folder)
                } else {
                    InboxListView(folder: folder)
                }
            }
            .navigationDestination(for: Message.self) { message in
                MessageDetailView(messageId: message.id)
            }
            .overlay {
                if isLoading && environment.folders.isEmpty {
                    ProgressView()
                }
            }
            .task {
                await environment.loadAccounts()
                await loadFoldersAndCounts()
                // [2026-09-21] "Einstellungsbereich"-Auftrag: Akzentfarbe
                // einmal beim App-Start laden, analog zu loadAccounts()/
                // loadFolders() oben -- damit die gewählte Farbe von Anfang
                // an sichtbar ist, nicht erst nach dem ersten Öffnen der
                // Einstellungen.
                await environment.loadSettings()
                // Abwesenheitsassistent-Zustand für den Banner oben.
                await environment.loadAbsenceResponder()
            }
            .onChange(of: isShowingSettings) { _, isShowing in
                // Nach dem Schließen der Einstellungen neu laden -- ein
                // Konto könnte entfernt worden sein (Ordner/Zähler dieses
                // Kontos wären sonst bis zum nächsten Pull-to-Refresh
                // veraltet). Ebenso den Abwesenheitsassistenten-Zustand, da
                // er ueber AbsenceResponderView (in diesem Sheet) geändert
                // werden konnte.
                guard !isShowing else { return }
                Task {
                    await loadFoldersAndCounts(forceRefresh: true)
                    await environment.loadAbsenceResponder()
                }
            }
            .refreshable {
                // Pull-to-Refresh (WEB_INBOX.md 21.09. "SEHR WICHTIGE
                // LUECKE - HOECHSTE PRIORITAET", Punkt 1): löst zuerst
                // einen echten Mail-Abruf aus (statt nur den lokalen Stand
                // neu zu laden), bevor Ordner/Zähler aktualisiert werden --
                // sonst würde Pull-to-Refresh nie neue Mail zeigen, egal
                // wie oft man zieht. Nur für das AKTIVE Konto (Mehrfach-
                // Konten, WEB_INBOX.md 21.09. Punkt 2).
                if let accountId = environment.activeAccountId {
                    _ = try? await environment.apiClient.syncAccount(id: accountId)
                }
                await loadFoldersAndCounts(forceRefresh: true)
            }
            .alert("Neuer Ordner", isPresented: $isCreatingFolder) {
                // [2026-09-15] WEB_INBOX.md 10.09. "kleine UX-Ergänzung":
                // Namensvorschlag statt leerem Feld, hier als Placeholder
                // statt Chips/Quick-Picks wie im Web -- ein natives
                // SwiftUI .alert() kann außer Textfeldern/Buttons keine
                // eigene Chip-Reihe hosten, siehe SYNC.md.
                TextField("z. B. Dokumente", text: $newFolderName)
                Button("Abbrechen", role: .cancel) {}
                Button("Anlegen") {
                    Task { await createFolder() }
                }
                .disabled(newFolderName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    /// Ausgelagert aus dem `.toolbar`-Builder (verschachtelte `if` +
    /// `ForEach` + bedingtes Label direkt im Toolbar-ViewBuilder ließ den
    /// Swift-Type-Checker mit "unable to type-check in reasonable time"
    /// scheitern -- als eigene computed property kompiliert es sauber).
    private var accountSwitcherMenu: some View {
        Menu {
            ForEach(environment.accounts) { acc in
                Button(accountMenuLabel(acc)) {
                    environment.switchAccount(to: acc.id)
                    Task { await loadFoldersAndCounts() }
                }
            }
        } label: {
            Image(systemName: "person.crop.circle")
        }
        .accessibilityLabel("Konto wechseln")
    }

    private func accountMenuLabel(_ account: MailAccount) -> String {
        account.id == environment.activeAccountId ? "✓ \(account.emailAddress)" : account.emailAddress
    }

    /// [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG -
    /// Abwesenheitsassistent": "Jetzt beenden" setzt nur `active: false`
    /// (Start-/End-Datum, Betreff und Text bleiben gespeichert, siehe
    /// `AppEnvironment.updateAbsenceResponder(...)`-Kommentar) -- ein
    /// erneutes Aktivieren in `AbsenceResponderView` findet die vorherige
    /// Konfiguration unverändert vor.
    private var absenceResponderBanner: some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            Image(systemName: "airplane")
                .foregroundStyle(DesignTokens.Color.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Abwesenheitsassistent aktiv")
                    .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                if let endDate = environment.absenceResponder?.endDate {
                    Text("Bis \(endDate)")
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                }
            }
            Spacer()
            Button("Jetzt beenden") {
                Task { await endAbsenceResponderNow() }
            }
            .font(.system(size: DesignTokens.Typography.Size.small, weight: .semibold))
        }
        .listRowBackground(DesignTokens.Color.surfaceCard)
    }

    private func endAbsenceResponderNow() async {
        _ = try? await environment.updateAbsenceResponder(active: false, startDate: nil, endDate: nil, subject: nil, body: nil)
    }

    private func loadFoldersAndCounts(forceRefresh: Bool = false) async {
        isLoading = counts.isEmpty
        defer { isLoading = false }
        await environment.loadFolders(forceRefresh: forceRefresh)
        do {
            // [2026-09-21] Mehrfach-Konten: explizit auf das AKTIVE Konto
            // scoped -- ohne accountId würde ein zweites Konto seine
            // Nachrichten in die Zähler-Berechnung des ersten mischen
            // (folderId ist zwar pro Konto eindeutig, aber "alle Ordner
            // dieses Kontos" ist genau das, was hier gebraucht wird).
            let all = try await environment.apiClient.fetchMessages(folderId: nil, accountId: environment.activeAccountId, query: nil)
            counts = Dictionary(grouping: all, by: \.folderId).mapValues(\.count)
        } catch {
            counts = [:]
        }
        // "entwuerfe" kommt aus GET /drafts, nicht GET /messages -- der
        // Zähler oben würde sonst immer 0 zeigen (siehe Folder.isDrafts).
        if let entwuerfeFolder = environment.folders.first(where: { $0.isDrafts }) {
            do {
                counts[entwuerfeFolder.id] = try await environment.apiClient.fetchDrafts().count
            } catch {
                counts[entwuerfeFolder.id] = 0
            }
        }
    }

    /// Suche (siehe `searchText`-Kommentar oben) -- 250ms entprellt über
    /// den `.onChange`-Handler, der diese Funktion aufruft. Kontoweit
    /// (`folderId: nil`), analog zu web/src/App.tsx.
    private func runSearch(query: String) async {
        isSearching = true
        defer { isSearching = false }
        do {
            searchResults = try await environment.apiClient.fetchMessages(
                folderId: nil,
                accountId: environment.activeAccountId,
                query: query
            )
        } catch {
            searchResults = []
        }
    }

    private func createFolder() async {
        let name = newFolderName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        do {
            _ = try await environment.apiClient.createFolder(name: name, icon: nil, accountId: environment.activeAccountId)
            await environment.loadFolders(forceRefresh: true)
        } catch {
            errorMessage = "Ordner konnte nicht angelegt werden."
        }
    }
}

private struct FolderRow: View {
    let folder: Folder
    let count: Int

    var body: some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            Image(systemName: folder.systemImage)
                .foregroundStyle(folder.usesDangerColor ? DesignTokens.Color.danger : DesignTokens.Color.accent)
                .frame(width: 24)

            Text(folder.name)
                .font(.system(size: DesignTokens.Typography.Size.bodyLarge))
                .foregroundStyle(folder.isMuted ? DesignTokens.Color.textMuted : DesignTokens.Color.textPrimary)

            Spacer()

            if count > 0 {
                Text("\(count)")
                    .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                    .foregroundStyle(folder.usesDangerColor ? .white : DesignTokens.Color.textSecondary)
                    .padding(.horizontal, DesignTokens.Spacing.sm)
                    .padding(.vertical, 2)
                    .background(
                        Capsule().fill(folder.usesDangerColor ? DesignTokens.Color.danger : DesignTokens.Color.border)
                    )
            }
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }
}

/// Gebündelter Einstellungsbereich (WEB_INBOX.md 21.09. "NEUER AUFTRAG -
/// Einstellungsbereich + Info-Seite", Punkt 1) -- war ursprünglich nur der
/// eine App-Sperre-Toggle (WEB_INBOX.md 15.09.), seither um KI-Anbindung
/// und Mehrfach-Konten gewachsen. Dieser Nachtrag ergänzt: Konto-Entfernen,
/// Akzentfarben-Auswahl ("Ansicht"), eine einfache Sicherheits-Übersicht
/// und einen Anleitung-Link.
private struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environment: AppEnvironment
    private let biometricKind = BiometricLock.availableKind()
    @State private var showLogoutConfirm = false
    // [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2,
    // Übergabe von Track A): "Konto hinzufügen" öffnet denselben
    // Onboarding-Provider-Auswahlbildschirm wie beim Erst-Login, hier als
    // Sheet statt als Vollbild-Gate.
    @State private var isAddingAccount = false
    @State private var removingAccountId: String?
    @State private var accountError: String?

    /// Plain-language overview of what driftmail actively protects
    /// against -- non-technical on purpose (WEB_INBOX.md 21.09.
    /// "Einstellungsbereich", Sicherheit-Sektion). Malware scan is
    /// honestly marked "in Vorbereitung": it's still a mock
    /// (`backend/src/lookups/attachmentScanMock.ts`), not real yet.
    private static let securityOverviewText = """
    driftmail schützt dich automatisch im Hintergrund:
    – Erkennt Spam, Phishing und klassischen Vorschussbetrug automatisch
    – Warnt bei gefälschten Anzeigenamen, abweichenden Antwort-Adressen und plötzlichen IBAN-Wechseln in laufenden Gesprächen
    – Kennzeichnet neue, unbekannte Absender
    – Whitelist: du entscheidest, wem du vertraust
    – Warnt vor dem Versand sensibler Daten (IBAN, Kreditkartennummern)
    – Malware-Scan für Anhänge: in Vorbereitung
    – KI-Funktionen laufen wo möglich direkt auf deinem Gerät – keine Kosten, keine Cloud-Übertragung, außer du richtest ausdrücklich einen eigenen KI-Zugang ein
    """

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(environment.accounts) { acc in
                        HStack {
                            Text(acc.emailAddress)
                                .foregroundStyle(acc.id == environment.activeAccountId ? DesignTokens.Color.accent : DesignTokens.Color.textPrimary)
                            Spacer()
                            if removingAccountId == acc.id {
                                ProgressView()
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            // Letztes verbleibendes Konto client-seitig gar
                            // nicht erst anbieten, statt den User eine
                            // Wischgeste machen zu lassen, die dann eh nur
                            // mit einem 400 zurückkommt (Server prüft das
                            // ohnehin nochmal, siehe AppEnvironment.
                            // removeAccount(_:)).
                            if environment.accounts.count > 1 {
                                Button(role: .destructive) {
                                    Task { await removeAccount(acc) }
                                } label: {
                                    Label("Entfernen", systemImage: "trash")
                                }
                            }
                        }
                    }
                    Button("Konto hinzufügen") {
                        isAddingAccount = true
                    }
                    if let accountError {
                        Text(accountError)
                            .font(.system(size: DesignTokens.Typography.Size.small))
                            .foregroundStyle(DesignTokens.Color.dangerText)
                    }
                } header: {
                    Text("Verbundene Konten")
                } footer: {
                    Text(environment.accounts.count > 1
                        ? "Nach links wischen, um ein Konto zu entfernen."
                        : "Das letzte verbundene Konto kann nicht entfernt werden.")
                }

                // [2026-09-21] "Einstellungsbereich"-Auftrag: Akzentfarben-
                // Auswahl, siehe UserSettings.swift/design-tokens.json
                // color.accentThemes. Nur die neutrale Akzentfarbe ist
                // wählbar -- danger/warning/success bleiben fest.
                Section {
                    HStack(spacing: DesignTokens.Spacing.md) {
                        ForEach(AccentTheme.allCases) { theme in
                            Button {
                                Task { await applyAccentTheme(theme) }
                            } label: {
                                accentSwatch(for: theme)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(theme.label)
                        }
                    }
                    .padding(.vertical, DesignTokens.Spacing.xs)
                } header: {
                    Text("Ansicht")
                } footer: {
                    Text("Akzentfarbe für Buttons, Links und aktive Elemente.")
                }

                Section {
                    AppLockToggleView(kind: biometricKind)
                } header: {
                    Text("Sicherheit")
                } footer: {
                    Text("Schützt deinen lokalen Mail-Cache zusätzlich zum Mail-Konto-Login, falls dein Gerät verloren geht oder gestohlen wird.")
                }

                // [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-
                // FEATURES" Punkt 1 ("Unbekannte Absender streng
                // behandeln"): reine Client-Darstellungsentscheidung, steuert
                // nur, ob MessageDetailView eine staerkere Hervorhebung als
                // das bestehende dezente "Neuer Absender"-Flag zeigt.
                Section {
                    Toggle("Unbekannte Absender streng behandeln", isOn: Binding(
                        get: { environment.strictUnknownSenders },
                        set: { newValue in Task { try? await environment.updateStrictUnknownSenders(newValue) } }
                    ))
                } footer: {
                    Text("Hebt Nachrichten von Absendern, die noch nicht auf deiner Whitelist stehen, deutlicher hervor.")
                }

                // [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): BYOK-
                // Einstellung fuer den optionalen Cloud-KI-Fallback, siehe
                // AiSettingsView.swift.
                Section {
                    NavigationLink("KI-Anbindung") {
                        AiSettingsView()
                    }
                } footer: {
                    Text("Geräte-eigene KI läuft immer zuerst. Hier optional einen eigenen Cloud-Zugang hinterlegen.")
                }

                // [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG -
                // Abwesenheitsassistent".
                Section {
                    NavigationLink("Abwesenheitsassistent") {
                        AbsenceResponderView()
                    }
                } footer: {
                    Text("Antwortet automatisch auf eingehende Mails, solange du abwesend bist.")
                }

                // Einfache, nicht-technische Übersicht der aktiven
                // Sicherheits-Features (WEB_INBOX.md 21.09.
                // "Einstellungsbereich") -- keine technischen Details,
                // sondern in einfachen Worten, was driftmail im
                // Hintergrund tut.
                Section {
                    Text(Self.securityOverviewText)
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                }

                // Platzhalter-URL: die eigentliche Info-Seite auf
                // driftware.online wird in einer separaten Claude-Session
                // gebaut (WEB_INBOX.md 21.09.) -- Route ggf. anpassen,
                // sobald diese Seite fertig ist.
                Section {
                    Link("Installationsanleitung", destination: URL(string: "https://driftware.online")!)
                } header: {
                    Text("Hilfe")
                }

                // [2026-09-21] WEB_INBOX.md 19.09. "Onboarding: Provider-
                // Auswahlbildschirm" ("voll verdrahten"): mit einem echten
                // Login-Gate in RootView braucht es zwingend einen Weg
                // zurück, sonst ist ein falsch verbundenes Konto nicht mehr
                // korrigierbar ohne App-Neuinstallation.
                Section {
                    Button("Alle Konten trennen", role: .destructive) {
                        showLogoutConfirm = true
                    }
                } footer: {
                    Text("Trennt ALLE verbundenen Konten. Du musst dich danach erneut anmelden.")
                }
            }
            .navigationTitle("Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
            .confirmationDialog(
                "Konto trennen?",
                isPresented: $showLogoutConfirm,
                titleVisibility: .visible
            ) {
                Button("Konto trennen", role: .destructive) {
                    environment.logOut()
                    dismiss()
                }
                Button("Abbrechen", role: .cancel) {}
            } message: {
                Text("Du musst dich danach erneut mit einem E-Mail-Konto verbinden.")
            }
            .sheet(isPresented: $isAddingAccount) {
                OnboardingAccountConnectView(mode: .addAccount) { account, _ in
                    isAddingAccount = false
                    Task { await environment.handleAccountAdded(account) }
                }
            }
        }
    }

    @ViewBuilder
    private func accentSwatch(for theme: AccentTheme) -> some View {
        ZStack {
            if let gradientHexes = theme.gradientHexes {
                Circle().fill(
                    LinearGradient(
                        colors: gradientHexes.map { SwiftUI.Color(hex: $0) },
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            } else {
                Circle().fill(SwiftUI.Color(hex: theme.accentHex))
            }
            if environment.accentTheme == theme {
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 32, height: 32)
    }

    private func applyAccentTheme(_ theme: AccentTheme) async {
        try? await environment.updateAccentTheme(theme)
    }

    private func removeAccount(_ account: MailAccount) async {
        removingAccountId = account.id
        accountError = nil
        defer { removingAccountId = nil }
        do {
            try await environment.removeAccount(account.id)
        } catch APIError.badRequest(let message) {
            accountError = message ?? "Konto konnte nicht entfernt werden."
        } catch {
            accountError = "Konto konnte nicht entfernt werden. Bitte später erneut versuchen."
        }
    }
}

#Preview {
    FolderListView()
        .environmentObject(AppEnvironment())
}
