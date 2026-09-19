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

    var body: some View {
        NavigationStack {
            List {
                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.dangerText)
                        .listRowBackground(Color.clear)
                }

                ForEach(environment.folders) { folder in
                    NavigationLink(value: folder) {
                        FolderRow(folder: folder, count: counts[folder.id] ?? 0)
                    }
                    .listRowBackground(DesignTokens.Color.surfaceCard)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(DesignTokens.Color.surfacePage)
            // [2026-09-15] WEB_INBOX.md 10.09.: zeigt die E-Mail-Adresse des
            // verbundenen Kontos statt des App-Namens, sobald geladen --
            // User soll immer sofort sehen, in welchem Postfach er ist.
            // Fällt auf "driftmail" zurück, solange das Konto noch lädt
            // oder aus einem echten Fehler heraus (loadAccount() lässt
            // account dann bewusst nil statt einen Ladezustand zu erzwingen).
            .navigationTitle(environment.account?.emailAddress ?? "driftmail")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Einstellungen")
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
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsView()
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
            .overlay {
                if isLoading && environment.folders.isEmpty {
                    ProgressView()
                }
            }
            .task {
                await environment.loadAccount()
                await loadFoldersAndCounts()
            }
            .refreshable {
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

    private func loadFoldersAndCounts(forceRefresh: Bool = false) async {
        isLoading = counts.isEmpty
        defer { isLoading = false }
        await environment.loadFolders(forceRefresh: forceRefresh)
        do {
            let all = try await environment.apiClient.fetchMessages(folderId: nil, accountId: nil)
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

    private func createFolder() async {
        let name = newFolderName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        do {
            _ = try await environment.apiClient.createFolder(name: name, icon: nil)
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
    private let biometricKind = BiometricLock.availableKind()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    AppLockToggleView(kind: biometricKind)
                } footer: {
                    Text("Schützt deinen lokalen Mail-Cache zusätzlich zum Mail-Konto-Login, falls dein Gerät verloren geht oder gestohlen wird.")
                }
            }
            .navigationTitle("Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    FolderListView()
        .environmentObject(AppEnvironment())
}
