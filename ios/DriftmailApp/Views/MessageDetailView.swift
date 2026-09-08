import SwiftUI

/// GET /messages/{messageId} — full message + security analysis, plus the
/// on-demand actions from api-spec.yaml: /summary, /reply-draft and /move.
///
/// [2026-09-08] Contract-Änderung: `detail.folder == .quarantaene` gibt es
/// nicht mehr (Ordner sind kein Enum mehr) — der aktuelle Ordner wird über
/// `detail.folderId` gegen `environment.folders` nachgeschlagen. Neu: ein
/// "Verschieben"-Menü nutzt `POST /messages/{id}/move`.
struct MessageDetailView: View {
    let messageId: String

    @EnvironmentObject private var environment: AppEnvironment
    @State private var detail: MessageDetail?
    @State private var summary: MailSummary?
    @State private var draft: String?
    @State private var isLoadingSummary = false
    @State private var isLoadingDraft = false
    @State private var isQuarantining = false
    @State private var isMoving = false
    @State private var errorMessage: String?

    /// The folder the message currently sits in, looked up from
    /// `environment.folders` via `detail.folderId`. `nil` while folders or
    /// the detail haven't loaded yet.
    private var currentFolder: Folder? {
        guard let detail else { return nil }
        return environment.folders.first { $0.id == detail.folderId }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.Spacing.lg) {
                if let detail {
                    header(for: detail)

                    if currentFolder?.systemKey == .quarantaene {
                        QuarantineWarningView(count: 1)
                    }

                    if let security = detail.security {
                        SecurityBadgesView(security: security)
                    }

                    Text(detail.bodyText ?? "")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .padding(DesignTokens.Spacing.lg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                                .fill(DesignTokens.Color.surfaceCard)
                        )

                    actions(for: detail)

                    if let summary {
                        summaryCard(summary)
                    }

                    if let draft {
                        draftCard(draft)
                    }
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, DesignTokens.Spacing.xl)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.dangerText)
                }
            }
            .padding(DesignTokens.Spacing.lg)
        }
        .background(DesignTokens.Color.surfacePage)
        .navigationTitle(detail?.subject ?? "Nachricht")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await environment.loadFolders()
            await loadDetail()
        }
    }

    // MARK: - Sections

    private func header(for detail: MessageDetail) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text(detail.subject ?? "(kein Betreff)")
                .font(.system(size: DesignTokens.Typography.Size.heading, weight: .medium))
            Text("\(detail.fromDisplayName ?? detail.fromAddress) <\(detail.fromAddress)>")
                .font(.system(size: DesignTokens.Typography.Size.small))
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text(detail.receivedAt, style: .date)
                .font(.system(size: DesignTokens.Typography.Size.caption))
                .foregroundStyle(DesignTokens.Color.textMuted)
        }
    }

    private func actions(for detail: MessageDetail) -> some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            HStack(spacing: DesignTokens.Spacing.sm) {
                Button {
                    Task { await loadSummary() }
                } label: {
                    Label("Was wollen die von mir?", systemImage: "text.bubble")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                }
                .buttonStyle(.bordered)
                .disabled(isLoadingSummary)

                Button {
                    Task { await loadDraft() }
                } label: {
                    Label("Antwortentwurf", systemImage: "pencil")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                }
                .buttonStyle(.bordered)
                .disabled(isLoadingDraft)
            }

            if !environment.folders.isEmpty {
                Menu {
                    ForEach(environment.folders.filter { $0.id != detail.folderId }) { target in
                        Button {
                            Task { await move(to: target) }
                        } label: {
                            Label(target.name, systemImage: target.systemImage)
                        }
                    }
                } label: {
                    Label("Verschieben nach…", systemImage: "folder")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isMoving)
            }

            if currentFolder?.systemKey != .quarantaene {
                Button(role: .destructive) {
                    Task { await quarantine() }
                } label: {
                    Label("In Quarantäne verschieben", systemImage: "exclamationmark.shield")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(DesignTokens.Color.danger)
                .disabled(isQuarantining)
            }
        }
    }

    private func summaryCard(_ summary: MailSummary) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            HStack {
                Text("Zusammenfassung")
                    .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textSecondary)
                Spacer()
                SourceTag(source: summary.source)
            }
            Text(summary.summaryText)
                .font(.system(size: DesignTokens.Typography.Size.body))
            if summary.actionRequired, let action = summary.actionDescription {
                Label(action, systemImage: "checklist")
                    .font(.system(size: DesignTokens.Typography.Size.small))
                    .foregroundStyle(DesignTokens.Color.accent)
            }
        }
        .padding(DesignTokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                .fill(DesignTokens.Color.accent.opacity(0.08))
        )
    }

    private func draftCard(_ draft: String) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
            Text("Antwortentwurf (nicht gesendet — bitte prüfen)")
                .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text(draft)
                .font(.system(size: DesignTokens.Typography.Size.body))
        }
        .padding(DesignTokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                .fill(DesignTokens.Color.surfaceCard)
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                        .stroke(DesignTokens.Color.border, lineWidth: 1)
                )
        )
    }

    // MARK: - Loading

    private func loadDetail() async {
        do {
            detail = try await environment.apiClient.fetchMessageDetail(id: messageId)
        } catch {
            errorMessage = "Nachricht konnte nicht geladen werden."
        }
    }

    private func loadSummary() async {
        isLoadingSummary = true
        defer { isLoadingSummary = false }
        do {
            summary = try await environment.apiClient.fetchSummary(messageId: messageId)
        } catch {
            errorMessage = "Zusammenfassung fehlgeschlagen."
        }
    }

    private func loadDraft() async {
        isLoadingDraft = true
        defer { isLoadingDraft = false }
        do {
            draft = try await environment.apiClient.requestReplyDraft(messageId: messageId)
        } catch {
            errorMessage = "Antwortentwurf fehlgeschlagen."
        }
    }

    private func quarantine() async {
        isQuarantining = true
        defer { isQuarantining = false }
        do {
            try await environment.apiClient.quarantineMessage(id: messageId)
            await loadDetail()
        } catch {
            errorMessage = "In Quarantäne verschieben fehlgeschlagen."
        }
    }

    private func move(to target: Folder) async {
        isMoving = true
        defer { isMoving = false }
        do {
            _ = try await environment.apiClient.moveMessage(id: messageId, toFolderId: target.id)
            await loadDetail()
        } catch {
            errorMessage = "Verschieben nach \"\(target.name)\" fehlgeschlagen."
        }
    }
}

private struct SourceTag: View {
    let source: AiSource

    var body: some View {
        Text(source == .onDevice ? "On-Device" : "Cloud")
            .font(.system(size: DesignTokens.Typography.Size.caption, weight: .medium))
            .padding(.horizontal, DesignTokens.Spacing.sm)
            .padding(.vertical, 2)
            .background(Capsule().fill(DesignTokens.Color.border))
            .foregroundStyle(DesignTokens.Color.textSecondary)
    }
}

private struct SecurityBadgesView: View {
    let security: SecurityResult

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            HStack(spacing: DesignTokens.Spacing.sm) {
                badge("SPF", security.spfStatus)
                badge("DKIM", security.dkimStatus)
                badge("DMARC", security.dmarcStatus)
            }
            HStack(spacing: DesignTokens.Spacing.sm) {
                if security.homoglyphDetected {
                    flag("Homoglyph erkannt")
                }
                if security.linkMismatchDetected {
                    flag("Link-Ziel weicht ab")
                }
                if security.containsNewIban {
                    flag("Neue IBAN")
                }
            }
            Text("Konfidenz: \(Int(security.confidenceScore * 100))%")
                .font(.system(size: DesignTokens.Typography.Size.caption))
                .foregroundStyle(DesignTokens.Color.textMuted)
        }
    }

    private func badge(_ label: String, _ status: PassFailNone) -> some View {
        let color: Color = status == .pass ? DesignTokens.Color.success
            : status == .fail ? DesignTokens.Color.danger
            : DesignTokens.Color.textMuted
        return Text("\(label): \(status.rawValue)")
            .font(.system(size: DesignTokens.Typography.Size.caption, weight: .medium))
            .foregroundStyle(color)
            .padding(.horizontal, DesignTokens.Spacing.sm)
            .padding(.vertical, 2)
            .background(Capsule().stroke(color, lineWidth: 1))
    }

    private func flag(_ label: String) -> some View {
        Text(label)
            .font(.system(size: DesignTokens.Typography.Size.caption, weight: .medium))
            .foregroundStyle(DesignTokens.Color.dangerText)
            .padding(.horizontal, DesignTokens.Spacing.sm)
            .padding(.vertical, 2)
            .background(Capsule().fill(DesignTokens.Color.danger.opacity(0.15)))
    }
}

#Preview {
    NavigationStack {
        MessageDetailView(messageId: "msg-007")
    }
    .environmentObject(AppEnvironment())
}
