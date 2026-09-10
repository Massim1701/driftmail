import SwiftUI

/// Zeigt den "entwuerfe"-Systemordner: `GET /drafts`, NICHT
/// `GET /messages` (siehe `Folder.isDrafts`, WEB_INBOX.md 09.09.
/// "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags").
///
/// Bewusst nur Liste + Löschen, kein Bearbeiten -- ein Entwurfs-Editor
/// bräuchte einen eigenen Compose-Screen ("neue Mail verfassen"), der noch
/// nicht Teil dieser App ist (siehe README "Entwürfe").
struct DraftListView: View {
    let folder: Folder

    @EnvironmentObject private var environment: AppEnvironment
    @State private var drafts: [Draft] = []
    @State private var isLoading = true

    var body: some View {
        List {
            if drafts.isEmpty && !isLoading {
                ContentUnavailableCompat(title: "Keine Entwürfe", systemImage: folder.systemImage)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            ForEach(drafts) { draft in
                DraftRowView(draft: draft)
                    .listRowBackground(DesignTokens.Color.surfaceCard)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            Task { await delete(draft) }
                        } label: {
                            Label("Löschen", systemImage: "trash")
                        }
                    }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(DesignTokens.Color.surfacePage)
        .navigationTitle(folder.name)
        .overlay {
            if isLoading && drafts.isEmpty {
                ProgressView()
            }
        }
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            drafts = try await environment.apiClient.fetchDrafts()
        } catch {
            drafts = []
        }
    }

    private func delete(_ draft: Draft) async {
        do {
            try await environment.apiClient.deleteDraft(id: draft.id)
            drafts.removeAll { $0.id == draft.id }
        } catch {
            await load()
        }
    }
}

private struct DraftRowView: View {
    let draft: Draft

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(draft.to.isEmpty ? "(kein Empfänger)" : draft.to.joined(separator: ", "))
                .font(.system(size: DesignTokens.Typography.Size.body, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .lineLimit(1)
            Text(draft.subject?.isEmpty == false ? draft.subject! : "(kein Betreff)")
                .font(.system(size: DesignTokens.Typography.Size.small))
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .lineLimit(1)
            if let bodyText = draft.bodyText, !bodyText.isEmpty {
                Text(bodyText)
                    .font(.system(size: DesignTokens.Typography.Size.small))
                    .foregroundStyle(DesignTokens.Color.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, DesignTokens.Spacing.xs)
    }
}

#Preview {
    NavigationStack {
        DraftListView(folder: Folder(
            id: "folder-entwuerfe", name: "Entwürfe", icon: "file-text",
            isSystem: true, systemKey: .entwuerfe, sortOrder: 1
        ))
    }
    .environmentObject(AppEnvironment())
}
