import SwiftUI
import UniformTypeIdentifiers

/// [2026-09-21] Compose-Screen (WEB_INBOX.md 21.09. "BUG - Massimo beim
/// echten Live-Test entdeckt" + "ERGAENZUNG" + "DREI WEITERE
/// GRUNDFUNKTIONEN"): EIN gemeinsamer Compose-Dialog für alle drei Fälle
/// (neue Mail, Antworten, Weiterleiten), analog zu
/// web/src/components/ComposeModal.tsx -- To/CC/BCC/Betreff/Body sind in
/// allen drei Fällen dieselben Felder, nur die Vorbefüllung unterscheidet
/// sich. Ersetzt das bisherige inline in `MessageDetailView` eingebettete
/// Antwortfeld (kein eigenes To-Feld, kein CC/BCC, für Weiterleiten
/// ungeeignet).
enum ComposeMode {
    case new
    case reply(MessageDetail)
    case forward(MessageDetail)
}

struct ComposeView: View {
    let mode: ComposeMode
    /// `POST /messages/send` war erfolgreich -- Aufrufer nutzt das, um z.B.
    /// den "gesendet"-Zähler neu zu laden (analog zu `onSent` in
    /// web/src/App.tsx).
    let onSent: () -> Void

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environment: AppEnvironment

    @State private var accountId: String?
    @State private var to = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var showCcBcc = false
    @State private var subject = ""
    @State private var bodyText = ""
    @State private var composeAttachments: [ComposeAttachment] = []
    @State private var showFileImporter = false
    @State private var isLoadingDraft = false
    @State private var showAiOverwriteConfirm = false
    @State private var isSending = false
    @State private var sendBlockedReason: String?
    @State private var errorMessage: String?

    private var original: MessageDetail? {
        switch mode {
        case .new: return nil
        case .reply(let message), .forward(let message): return message
        }
    }

    private var isReply: Bool {
        if case .reply = mode { return true }
        return false
    }

    private var title: String {
        switch mode {
        case .new: return "Neue Nachricht"
        case .reply: return "Antworten"
        case .forward: return "Weiterleiten"
        }
    }

    /// Solange ein Anhang noch hochgeladen/geprüft wird, fehlgeschlagen ist
    /// oder nicht `.clean` ist, bleibt Senden blockiert (wie zuvor in
    /// `MessageDetailView`, siehe WEB_INBOX.md 09.09.).
    private var hasBlockingAttachment: Bool {
        composeAttachments.contains { !$0.status.isClean }
    }

    private var toList: [String] { Self.addressList(from: to) }

    /// Antworten leitet das Konto serverseitig aus `inReplyToMessageId` ab
    /// (kein `accountId` nötig) -- neue Mail/Weiterleiten brauchen ein
    /// gewähltes Konto, analog zu web/src/components/ComposeModal.tsx
    /// `canSend`.
    private var canSend: Bool {
        !toList.isEmpty
            && !bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !hasBlockingAttachment
            && (isReply || accountId != nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                // Sender-Auswahl (WEB_INBOX.md 21.09. "ERGAENZUNG"): nur bei
                // neuer Mail UND mehr als einem Konto -- Antworten/
                // Weiterleiten übernehmen `environment.activeAccountId`
                // automatisch, Antworten braucht gar keine accountId (siehe
                // oben).
                if case .new = mode, environment.accounts.count > 1 {
                    Section {
                        Picker("Von", selection: Binding(get: { accountId ?? "" }, set: { accountId = $0 })) {
                            ForEach(environment.accounts) { account in
                                Text(account.emailAddress).tag(account.id)
                            }
                        }
                    }
                }

                Section {
                    TextField("An", text: $to)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    if showCcBcc {
                        TextField("CC", text: $cc)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("BCC", text: $bcc)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } else {
                        Button("CC/BCC hinzufügen") { showCcBcc = true }
                    }

                    TextField("Betreff", text: $subject)
                } footer: {
                    Text("Mehrere Adressen durch Komma trennen.")
                }

                Section {
                    TextEditor(text: $bodyText)
                        .frame(minHeight: 180)
                }

                if !composeAttachments.isEmpty {
                    Section("Anhänge") {
                        ForEach(composeAttachments) { attachment in
                            HStack(spacing: DesignTokens.Spacing.sm) {
                                Text(attachment.filename)
                                    .font(.system(size: DesignTokens.Typography.Size.small))
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
                        }
                    }
                }

                if let sendBlockedReason {
                    Section {
                        Text(sendBlockedReason)
                            .font(.system(size: DesignTokens.Typography.Size.small))
                            .foregroundStyle(DesignTokens.Color.dangerText)
                    }
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.system(size: DesignTokens.Typography.Size.small))
                            .foregroundStyle(DesignTokens.Color.dangerText)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Verwerfen") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(isSending ? "Sende…" : "Senden") {
                        Task { await send() }
                    }
                    .disabled(isSending || !canSend)
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button {
                        showFileImporter = true
                    } label: {
                        Label("Anhang", systemImage: "paperclip")
                    }
                    // Optionaler Zusatz-Button, nur beim Antworten sinnvoll
                    // (`requestReplyDraft` bezieht sich auf eine
                    // Ursprungsnachricht, hat kein Pendant für neue Mail/
                    // Weiterleiten).
                    if isReply {
                        Spacer()
                        Button {
                            if bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                Task { await requestAiDraft() }
                            } else {
                                showAiOverwriteConfirm = true
                            }
                        } label: {
                            Label(isLoadingDraft ? "Erstelle Entwurf…" : "KI-Entwurf", systemImage: "sparkles")
                        }
                        .disabled(isLoadingDraft)
                    }
                }
            }
            .onAppear(perform: setUpPrefill)
            .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result {
                    for url in urls { Task { await uploadAttachment(from: url) } }
                }
            }
            .confirmationDialog(
                "Vorhandenen Text durch einen KI-Entwurf ersetzen?",
                isPresented: $showAiOverwriteConfirm,
                titleVisibility: .visible
            ) {
                Button("Ersetzen", role: .destructive) {
                    Task { await requestAiDraft() }
                }
                Button("Abbrechen", role: .cancel) {}
            }
        }
    }

    // MARK: - Prefill

    /// Vorbefüllung je Modus, analog zu web/src/components/ComposeModal.tsx
    /// `prefill`: Antworten -> An = Absender, Betreff mit "Re:"-Präfix
    /// (idempotent), Body leer ("Antworten ohne KI-Zwang", siehe
    /// WEB_INBOX.md 10.09.). Weiterleiten -> Betreff mit "Fwd:"-Präfix
    /// (idempotent), Body mit zitiertem Original, An leer.
    private func setUpPrefill() {
        accountId = environment.activeAccountId
        switch mode {
        case .new:
            break
        case .reply(let original):
            to = original.fromAddress
            subject = Self.prefixedSubject(original.subject, prefix: "Re:")
        case .forward(let original):
            subject = Self.prefixedSubject(original.subject, prefix: "Fwd:")
            bodyText = Self.quotedBody(for: original)
        }
    }

    private static func prefixedSubject(_ subject: String?, prefix: String) -> String {
        guard let subject, !subject.isEmpty else { return prefix }
        return subject.lowercased().hasPrefix(prefix.lowercased()) ? subject : "\(prefix) \(subject)"
    }

    private static let quoteDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "de_DE")
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    /// **Grenze, bewusst so belassen** (wie auf Web): Original-Anhänge
    /// werden NICHT automatisch mitgenommen (WEB_INBOX.md nannte das
    /// explizit "optional") -- der User kann aber über den normalen
    /// "Anhang"-Weg neue Anhänge auswählen.
    private static func quotedBody(for original: MessageDetail) -> String {
        let fromLine = original.fromDisplayName.map { "\($0) <\(original.fromAddress)>" } ?? original.fromAddress
        return [
            "",
            "",
            "---- Weitergeleitete Nachricht ----",
            "Von: \(fromLine)",
            "Datum: \(quoteDateFormatter.string(from: original.receivedAt))",
            "Betreff: \(original.subject ?? "")",
            "",
            original.bodyText ?? "",
        ].joined(separator: "\n")
    }

    private static func addressList(from raw: String) -> [String] {
        raw
            .split(whereSeparator: { $0 == "," || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    // MARK: - Actions

    /// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): ruft jetzt
    /// `AppEnvironment.requestReplyDraft(messageId:thread:)` statt direkt
    /// `apiClient.requestReplyDraft` -- versucht davor lokal Foundation
    /// Models (Geraete-eigene KI als primaere Quelle), `apiClient` ist nur
    /// noch der Fallback-Pfad (siehe backend/README.md "KI-Anbindung
    /// (BYOK)"). Kann praktisch nicht mehr fehlschlagen (beide Pfade
    /// degradieren graceful bis zur Heuristik statt zu werfen), `do/catch`
    /// bleibt trotzdem als Absicherung gegen den `apiClient`-Fallback-Pfad.
    private func requestAiDraft() async {
        guard let original else { return }
        isLoadingDraft = true
        defer { isLoadingDraft = false }
        let thread = MailThread(messages: [
            .init(
                fromAddress: original.fromAddress,
                subject: original.subject ?? "",
                bodyText: original.bodyText ?? "",
                receivedAt: ISO8601DateFormatter().string(from: original.receivedAt)
            )
        ])
        let (draftText, _) = await environment.requestReplyDraft(messageId: original.id, thread: thread)
        if draftText.isEmpty {
            errorMessage = "KI-Entwurf fehlgeschlagen."
        } else {
            bodyText = draftText
            errorMessage = nil
        }
    }

    /// `POST /attachments` — liest die vom `.fileImporter` gelieferte
    /// (security-scoped) URL, lädt sie hoch und trägt das Scan-Ergebnis in
    /// `composeAttachments` ein (dieselbe Logik wie zuvor in
    /// `MessageDetailView`).
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

    private func send() async {
        guard canSend else { return }
        isSending = true
        sendBlockedReason = nil
        errorMessage = nil
        defer { isSending = false }
        do {
            _ = try await environment.apiClient.sendMessage(
                accountId: isReply ? nil : accountId,
                inReplyToMessageId: isReply ? original?.id : nil,
                to: toList,
                cc: Self.addressList(from: cc),
                bcc: Self.addressList(from: bcc),
                subject: subject,
                bodyText: bodyText,
                attachmentIds: composeAttachments.compactMap(\.attachmentId),
                draftId: nil
            )
            onSent()
            dismiss()
        } catch APIError.blocked(let reason) {
            sendBlockedReason = reason ?? "Versand wurde aus Sicherheitsgründen blockiert."
        } catch {
            errorMessage = "Versand fehlgeschlagen. Bitte später erneut versuchen."
        }
    }
}

#Preview {
    ComposeView(mode: .new, onSent: {})
        .environmentObject(AppEnvironment())
}
