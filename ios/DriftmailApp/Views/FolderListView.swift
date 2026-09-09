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
            .navigationTitle("driftmail")
            .toolbar {
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
            .navigationDestination(for: Folder.self) { folder in
                InboxListView(folder: folder)
            }
            .overlay {
                if isLoading && environment.folders.isEmpty {
                    ProgressView()
                }
            }
            .task {
                await loadFoldersAndCounts()
            }
            .refreshable {
                await loadFoldersAndCounts(forceRefresh: true)
            }
            .alert("Neuer Ordner", isPresented: $isCreatingFolder) {
                TextField("Name", text: $newFolderName)
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

#Preview {
    FolderListView()
        .environmentObject(AppEnvironment())
}
