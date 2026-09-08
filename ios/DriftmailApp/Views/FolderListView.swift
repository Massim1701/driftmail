import SwiftUI

/// Root inbox screen: the 5 folders from contracts/design-tokens.json
/// ("folders"), each with an unread-ish count pulled from GET /messages.
struct FolderListView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var counts: [Folder: Int] = [:]
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            List {
                ForEach(Folder.allCases) { folder in
                    NavigationLink(value: folder) {
                        FolderRow(folder: folder, count: counts[folder] ?? 0)
                    }
                    .listRowBackground(DesignTokens.Color.surfaceCard)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(DesignTokens.Color.surfacePage)
            .navigationTitle("driftmail")
            .navigationDestination(for: Folder.self) { folder in
                InboxListView(folder: folder)
            }
            .overlay {
                if isLoading {
                    ProgressView()
                }
            }
            .task {
                await loadCounts()
            }
            .refreshable {
                await loadCounts()
            }
        }
    }

    private func loadCounts() async {
        isLoading = counts.isEmpty
        defer { isLoading = false }
        do {
            let all = try await environment.apiClient.fetchMessages(folder: nil, accountId: nil)
            counts = Dictionary(grouping: all, by: \.folder).mapValues(\.count)
        } catch {
            counts = [:]
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

            Text(folder.label)
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
