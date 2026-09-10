import SwiftUI
import UniformTypeIdentifiers

/// GET /messages/{messageId} — full message + security analysis, plus the
/// on-demand actions from api-spec.yaml: /summary, /reply-draft and /move.
///
/// [2026-09-08] Contract-Änderung: `detail.folder == .quarantaene` gibt es
/// nicht mehr (Ordner sind kein Enum mehr) — der aktuelle Ordner wird über
/// `detail.folderId` gegen `environment.folders` nachgeschlagen. Neu: ein
/// "Verschieben"-Menü nutzt `POST /messages/{id}/move`.
struct MessageDetailView: View {
    let messageId: String

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environment: AppEnvironment
    @State private var detail: MessageDetail?
    @State private var summary: MailSummary?
    @State private var draft: String?
    @State private var isLoadingSummary = false
    @State private var isLoadingDraft = false
    @State private var isQuarantining = false
    @State private var isMoving = false
    @State private var isDeleting = false
    @State private var isPermanentlyDeleting = false
    @State private var showPermanentDeleteConfirm = false
    @State private var errorMessage: String?
    @State private var isSending = false
    @State private var sendBlockedReason: String?
    @State private var sentConfirmation: String?
    @State private var composeAttachments: [ComposeAttachment] = []
    @State private var showFileImporter = false
    @State private var isUnsubscribing = false
    @State private var unsubscribeStatus: UnsubscribeStatus?

    /// The folder the message currently sits in, looked up from
    /// `environment.folders` via `detail.folderId`. `nil` while folders or
    /// the detail haven't loaded yet.
    private var currentFolder: Folder? {
        guard let detail else { return nil }
        return environment.folders.first { $0.id == detail.folderId }
    }

    /// Solange ein Anhang noch hochgeladen/geprüft wird, fehlgeschlagen ist
    /// oder nicht `.clean` ist, bleibt Senden blockiert (WEB_INBOX.md
    /// 09.09. "Erweiterung des Send-Endpunkt-Eintrags von eben").
    private var hasBlockingAttachment: Bool {
        composeAttachments.contains { !$0.status.isClean }
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

                    if draft != nil {
                        draftCard(for: detail)
                    }

                    if let sentConfirmation {
                        Text("Antwort an \(sentConfirmation) wurde gesendet.")
                            .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                            .foregroundStyle(DesignTokens.Color.success)
                            .padding(DesignTokens.Spacing.lg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                                    .fill(DesignTokens.Color.success.opacity(0.1))
                            )
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
        .confirmationDialog(
            "Endgültig löschen?",
            isPresented: $showPermanentDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Endgültig löschen", role: .destructive) {
                Task { await permanentlyDelete() }
            }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Diese Nachricht wird unwiderruflich gelöscht und kann nicht wiederhergestellt werden.")
        }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result {
                for url in urls { Task { await uploadAttachment(from: url) } }
            }
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
                    // Label-Umbenennung (WEB_INBOX.md 09.09. "Ordner-Umbau-
                    // Eintrags", Punkt 2): reine UI-Textänderung, das Feld
                    // heißt technisch weiterhin summaryText.
                    Label("Inhalt", systemImage: "text.bubble")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                }
                .buttonStyle(.bordered)
                .disabled(isLoadingSummary)

                // WEB_INBOX.md 09.09. "KORREKTUR der letzten Regel":
                // ausgeblendet bei aktuellem Ordner spam (folderId-/
                // systemKey-Check), nicht bei eingefrorenem
                // classification='spam' -- Antworten auf Spam macht keinen
                // Sinn, auf Phishing (Quarantäne) schon (Warnbanner oben).
                if currentFolder?.systemKey != .spam {
                    Button {
                        Task { await loadDraft() }
                    } label: {
                        Label("Antwortentwurf", systemImage: "pencil")
                            .font(.system(size: DesignTokens.Typography.Size.body))
                    }
                    .buttonStyle(.bordered)
                    .disabled(isLoadingDraft)
                }
            }

            // Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.):
            // manueller Abmelden-Button, unabhängig von der Klassifikation
            // -- nur wenn die Nachricht einen gültigen List-Unsubscribe-
            // Header hat (siehe backend/README.md).
            if detail.canUnsubscribe {
                if let unsubscribeStatus {
                    Text(unsubscribeStatus == .pendingConfirmation ? "Abmeldung angestoßen" : "Abgemeldet")
                        .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.success)
                } else {
                    Button {
                        Task { await unsubscribe() }
                    } label: {
                        Label("Von Absender abmelden", systemImage: "envelope.badge.shield.half.filled")
                            .font(.system(size: DesignTokens.Typography.Size.body))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isUnsubscribing)
                }
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

            // [2026-09-08] Löschen: analog zum "Verschieben nach…"-Menü,
            // aber als eigener Button, da Löschen (in den Papierkorb) die
            // häufigere Aktion ist als ein beliebiges Zielordner-Menü.
            // Siehe WEB_INBOX.md "Fehlende Basis-Funktion entdeckt".
            if currentFolder?.isTrash == true {
                Button(role: .destructive) {
                    showPermanentDeleteConfirm = true
                } label: {
                    Label("Endgültig löschen", systemImage: "trash.slash")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(DesignTokens.Color.danger)
                .disabled(isPermanentlyDeleting)
            } else {
                Button(role: .destructive) {
                    Task { await delete() }
                } label: {
                    Label("Löschen", systemImage: "trash")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(DesignTokens.Color.danger)
                .disabled(isDeleting)
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

    /// Zeigt den (editierbaren) Antwortentwurf + Senden-Button. Bindet
    /// direkt an `$draft` (statt einen unveränderlichen String
    /// entgegenzunehmen), damit der Nutzer den KI-generierten Text vor dem
    /// Versand noch anpassen kann — der Versand selbst wird erst durch
    /// den Klick auf "Senden" ausgelöst (`POST /messages/send`).
    private func draftCard(for detail: MessageDetail) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("Antwortentwurf (wird erst nach Tippen auf „Senden“ verschickt)")
                .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textSecondary)
            TextEditor(text: Binding(get: { draft ?? "" }, set: { draft = $0; sendBlockedReason = nil }))
                .font(.system(size: DesignTokens.Typography.Size.body))
                .frame(minHeight: 120)
                .scrollContentBackground(.hidden)

            if !composeAttachments.isEmpty {
                VStack(alignment: .leading, spacing: DesignTokens.Spacing.xs) {
                    ForEach(composeAttachments) { attachment in
                        HStack(spacing: DesignTokens.Spacing.sm) {
                            Text(attachment.filename)
                                .font(.system(size: DesignTokens.Typography.Size.small))
                                .foregroundStyle(DesignTokens.Color.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            Text(attachment.status.label)
                                .font(.system(size: DesignTokens.Typography.Size.caption, weight: .medium))
                                .foregroundStyle(attachment.status.isClean ? DesignTokens.Color.success : DesignTokens.Color.dangerText)
                            Button {
                                composeAttachments.removeAll { $0.id == attachment.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(DesignTokens.Color.textMuted)
                            }
                        }
                        .padding(.horizontal, DesignTokens.Spacing.sm)
                        .padding(.vertical, DesignTokens.Spacing.xs)
                        .background(
                            RoundedRectangle(cornerRadius: DesignTokens.Radius.control)
                                .fill(DesignTokens.Color.surfacePage)
                                .overlay(
                                    RoundedRectangle(cornerRadius: DesignTokens.Radius.control)
                                        .stroke(DesignTokens.Color.border, lineWidth: 1)
                                )
                        )
                    }
                }
            }

            if let sendBlockedReason {
                Text(sendBlockedReason)
                    .font(.system(size: DesignTokens.Typography.Size.small))
                    .foregroundStyle(DesignTokens.Color.dangerText)
            }

            HStack(spacing: DesignTokens.Spacing.sm) {
                Button {
                    showFileImporter = true
                } label: {
                    Label("Anhang hinzufügen", systemImage: "paperclip")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                }
                .buttonStyle(.bordered)

                Button {
                    Task { await send(to: detail) }
                } label: {
                    Text(isSending ? "Sende…" : "Senden")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSending || (draft ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasBlockingAttachment)
            }
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

    /// `POST /messages/send` — sendet den aktuellen Entwurfstext als
    /// Antwort auf diese Nachricht. Backend leitet Konto + In-Reply-To-
    /// Header aus `messageId` ab (siehe `APIClient.sendMessage`).
    private func send(to detail: MessageDetail) async {
        guard let draft, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        guard !hasBlockingAttachment else { return }
        isSending = true
        sendBlockedReason = nil
        defer { isSending = false }
        let subject = detail.subject.map { $0.lowercased().hasPrefix("re:") ? $0 : "Re: \($0)" } ?? ""
        let attachmentIds = composeAttachments.compactMap(\.attachmentId)
        do {
            _ = try await environment.apiClient.sendMessage(
                inReplyToMessageId: messageId,
                to: [detail.fromAddress],
                subject: subject,
                bodyText: draft,
                attachmentIds: attachmentIds,
                draftId: nil
            )
            sentConfirmation = detail.fromAddress
            self.draft = nil
            composeAttachments = []
        } catch APIError.blocked(let reason) {
            sendBlockedReason = reason ?? "Versand wurde aus Sicherheitsgründen blockiert."
        } catch {
            errorMessage = "Versand fehlgeschlagen. Bitte später erneut versuchen."
        }
    }

    /// `POST /attachments` — liest die vom `.fileImporter` gelieferte
    /// (security-scoped) URL, lädt sie hoch und trägt das Scan-Ergebnis in
    /// `composeAttachments` ein. Ein separater `ComposeAttachment`-Eintrag
    /// je Datei, damit Uploads parallel laufen können, ohne sich
    /// gegenseitig zu blockieren.
    private func uploadAttachment(from url: URL) async {
        let filename = url.lastPathComponent
        var entry = ComposeAttachment(filename: filename, status: .uploading)
        composeAttachments.append(entry)

        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }

        do {
            let data = try Data(contentsOf: url)
            let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            let result = try await environment.apiClient.uploadAttachment(filename: filename, mimeType: mimeType, data: data)
            entry.attachmentId = result.attachmentId
            entry.status = .scanned(result.scanStatus)
        } catch {
            entry.status = .error
        }

        if let index = composeAttachments.firstIndex(where: { $0.id == entry.id }) {
            composeAttachments[index] = entry
        }
    }

    /// `POST /messages/{messageId}/unsubscribe` — manueller Pfad (siehe
    /// `APIClient.unsubscribeFromMessage`). Kein `loadDetail()` danach, da
    /// sich `canUnsubscribe`/`folderId` dadurch nicht ändern -- nur der
    /// lokale Status wird zum sofortigen Feedback aktualisiert.
    private func unsubscribe() async {
        isUnsubscribing = true
        defer { isUnsubscribing = false }
        do {
            unsubscribeStatus = try await environment.apiClient.unsubscribeFromMessage(id: messageId)
        } catch {
            errorMessage = "Abmeldung fehlgeschlagen."
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

    /// `DELETE /messages/{messageId}` — Nachricht in den Papierkorb
    /// verschieben (soft delete). Bleibt auf der Detailansicht (analog
    /// `quarantine()`/`move(to:)`), da die Nachricht weiterhin existiert,
    /// nur in einem anderen Ordner.
    private func delete() async {
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await environment.apiClient.deleteMessage(id: messageId)
            await loadDetail()
        } catch {
            errorMessage = "Löschen fehlgeschlagen."
        }
    }

    /// `DELETE /messages/{messageId}/permanent` — endgültiges Löschen,
    /// nur aus dem Papierkorb heraus angeboten (siehe `currentFolder?.isTrash`
    /// in `actions(for:)`). Die Nachricht existiert danach nicht mehr, also
    /// die Detailansicht verlassen statt neu zu laden.
    private func permanentlyDelete() async {
        isPermanentlyDeleting = true
        defer { isPermanentlyDeleting = false }
        do {
            try await environment.apiClient.permanentlyDeleteMessage(id: messageId)
            dismiss()
        } catch {
            errorMessage = "Endgültiges Löschen fehlgeschlagen."
        }
    }
}

/// POST /attachments läuft synchron (siehe backend/README.md "Anhänge"),
/// "uploading"/"error" sind reiner Client-Zustand während des Requests,
/// nicht Teil des Backend-Enums (`AttachmentScanStatus`, Models/Attachment.swift).
enum ComposeAttachmentUiStatus: Equatable {
    case uploading
    case scanned(AttachmentScanStatus)
    case error

    var label: String {
        switch self {
        case .uploading: return "Wird hochgeladen…"
        case .error: return "Hochladen fehlgeschlagen"
        case .scanned(.pending): return "Wird geprüft…"
        case .scanned(.clean): return "Geprüft"
        case .scanned(.malicious): return "Gefährlich — wird nicht gesendet"
        case .scanned(.blockedType): return "Dateityp nicht erlaubt"
        case .scanned(.scanFailed): return "Prüfung fehlgeschlagen"
        }
    }

    var isClean: Bool {
        if case .scanned(.clean) = self { return true }
        return false
    }
}

struct ComposeAttachment: Identifiable {
    let id = UUID()
    let filename: String
    var attachmentId: String?
    var status: ComposeAttachmentUiStatus
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
