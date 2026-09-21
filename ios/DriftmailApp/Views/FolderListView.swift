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

/// Minimale Settings-Fläche (WEB_INBOX.md 15.09., "App-Sperre ... in den
/// Einstellungen aktivierbar") -- bewusst nur der eine Toggle, kein
/// Platzhalter für zukünftige Einstellungen, die es noch nicht gibt.
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

    var body: some View {
        NavigationStack {
            List {
                Section {
                    AppLockToggleView(kind: biometricKind)
                } footer: {
                    Text("Schützt deinen lokalen Mail-Cache zusätzlich zum Mail-Konto-Login, falls dein Gerät verloren geht oder gestohlen wird.")
                }

                Section {
                    ForEach(environment.accounts) { acc in
                        Text(acc.emailAddress)
                            .foregroundStyle(acc.id == environment.activeAccountId ? DesignTokens.Color.accent : DesignTokens.Color.textPrimary)
                    }
                    Button("Konto hinzufügen") {
                        isAddingAccount = true
                    }
                } header: {
                    Text("Verbundene Konten")
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
}

#Preview {
    FolderListView()
        .environmentObject(AppEnvironment())
}
