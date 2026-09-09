import SwiftUI

/// Message list for a single folder (`GET /messages?folderId=...`).
/// Shows the quarantine warning banner when browsing "Quarantäne".
///
/// [2026-09-08] Contract-Änderung: `folder` ist jetzt das `Folder`-Objekt
/// statt eines Enum-Falls; Vergleich gegen "die Quarantäne" läuft über
/// `folder.systemKey` statt `folder == .quarantaene`.
struct InboxListView: View {
    let folder: Folder

    @EnvironmentObject private var environment: AppEnvironment
    @State private var messages: [Message] = []
    @State private var isLoading = true
    @State private var messagePendingPermanentDelete: Message?

    var body: some View {
        List {
            if folder.systemKey == .quarantaene && !messages.isEmpty {
                QuarantineWarningView(count: messages.count)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if messages.isEmpty && !isLoading {
                ContentUnavailableCompat(
                    title: "Keine Nachrichten",
                    systemImage: folder.systemImage
                )
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            ForEach(messages) { message in
                NavigationLink(value: message) {
                    MessageRowView(message: message)
                }
                .listRowBackground(DesignTokens.Color.surfaceCard)
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    // [2026-09-08] Löschen per Swipe, analog zum
                    // "Verschieben nach…"-Menü in der Detailansicht — im
                    // Papierkorb selbst ist der Swipe "Endgültig löschen"
                    // statt nochmal "in den Papierkorb verschieben", siehe
                    // WEB_INBOX.md "Fehlende Basis-Funktion entdeckt".
                    if folder.isTrash {
                        Button(role: .destructive) {
                            messagePendingPermanentDelete = message
                        } label: {
                            Label("Endgültig löschen", systemImage: "trash.slash")
                        }
                    } else {
                        Button(role: .destructive) {
                            Task { await delete(message) }
                        } label: {
                            Label("Löschen", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(DesignTokens.Color.surfacePage)
        .navigationTitle(folder.name)
        .navigationDestination(for: Message.self) { message in
            MessageDetailView(messageId: message.id)
        }
        .overlay {
            if isLoading && messages.isEmpty {
                ProgressView()
            }
        }
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
        .confirmationDialog(
            "Endgültig löschen?",
            isPresented: Binding(
                get: { messagePendingPermanentDelete != nil },
                set: { if !$0 { messagePendingPermanentDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Endgültig löschen", role: .destructive) {
                if let message = messagePendingPermanentDelete {
                    Task { await permanentlyDelete(message) }
                }
            }
            Button("Abbrechen", role: .cancel) {
                messagePendingPermanentDelete = nil
            }
        } message: {
            Text("Diese Nachricht wird unwiderruflich gelöscht und kann nicht wiederhergestellt werden.")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            messages = try await environment.apiClient.fetchMessages(folderId: folder.id, accountId: nil)
        } catch {
            messages = []
        }
    }

    /// `DELETE /messages/{messageId}` — soft delete in den Papierkorb.
    private func delete(_ message: Message) async {
        do {
            try await environment.apiClient.deleteMessage(id: message.id)
            messages.removeAll { $0.id == message.id }
        } catch {
            await load()
        }
    }

    /// `DELETE /messages/{messageId}/permanent` — nur im Papierkorb
    /// angeboten (siehe `folder.isTrash` in den swipeActions oben).
    private func permanentlyDelete(_ message: Message) async {
        messagePendingPermanentDelete = nil
        do {
            try await environment.apiClient.permanentlyDeleteMessage(id: message.id)
            messages.removeAll { $0.id == message.id }
        } catch {
            await load()
        }
    }
}

/// design-tokens.json colorRole "danger" applied to the quarantine folder.
/// Explains why messages landed here and that they auto-delete
/// (db-schema.sql `quarantine.auto_delete_at`) unless reviewed.
struct QuarantineWarningView: View {
    let count: Int

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.Spacing.md) {
            Image(systemName: "exclamationmark.shield.fill")
                .foregroundStyle(DesignTokens.Color.danger)
                .font(.system(size: 18))

            VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                Text("\(count) verdächtige Nachricht\(count == 1 ? "" : "en")")
                    .font(.system(size: DesignTokens.Typography.Size.bodyLarge, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.dangerText)

                Text("driftmail hat diese Nachrichten wegen Phishing- oder Spam-Verdacht automatisch in Quarantäne verschoben. Sie werden nach einer Weile automatisch gelöscht, falls du sie nicht prüfst. Öffne keine Links und gib keine Daten ein.")
                    .font(.system(size: DesignTokens.Typography.Size.small))
                    .foregroundStyle(DesignTokens.Color.dangerText.opacity(0.85))
            }
        }
        .padding(DesignTokens.Spacing.lg)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                .fill(DesignTokens.Color.danger.opacity(0.12))
        )
        .padding(.vertical, DesignTokens.Spacing.sm)
    }
}

/// Minimal stand-in for `ContentUnavailableView` so this file doesn't
/// require a specific SDK version beyond what's already targeted.
private struct ContentUnavailableCompat: View {
    let title: String
    let systemImage: String

    var body: some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 28))
                .foregroundStyle(DesignTokens.Color.textMuted)
            Text(title)
                .font(.system(size: DesignTokens.Typography.Size.body))
                .foregroundStyle(DesignTokens.Color.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DesignTokens.Spacing.xl)
    }
}

#Preview {
    NavigationStack {
        InboxListView(folder: Folder(
            id: "folder-quarantaene", name: "Quarantäne", icon: "shield-exclamation",
            isSystem: true, systemKey: .quarantaene, sortOrder: 3
        ))
    }
    .environmentObject(AppEnvironment())
}
