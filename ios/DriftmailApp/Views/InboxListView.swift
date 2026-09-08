import SwiftUI

/// Message list for a single folder (GET /messages?folder=...).
/// Shows the quarantine warning banner when browsing "Quarantäne".
struct InboxListView: View {
    let folder: Folder

    @EnvironmentObject private var environment: AppEnvironment
    @State private var messages: [Message] = []
    @State private var isLoading = true

    var body: some View {
        List {
            if folder == .quarantaene && !messages.isEmpty {
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
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(DesignTokens.Color.surfacePage)
        .navigationTitle(folder.label)
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
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            messages = try await environment.apiClient.fetchMessages(folder: folder, accountId: nil)
        } catch {
            messages = []
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
        InboxListView(folder: .quarantaene)
    }
    .environmentObject(AppEnvironment())
}
