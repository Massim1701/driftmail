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

    /// [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 3
    /// ("Vertraulicher Modus") -- rein manueller Schalter, KEIN
    /// automatischer Vorschlag (der braeuchte `POST
    /// /messages/draft/phishing-check`s `containsSensitiveData`, das dieser
    /// Screen bisher nirgends aufruft -- bewusst ausgeklammerte
    /// Vereinfachung, siehe ios/README.md). Default-Ablaufzeit 7 Tage,
    /// analog zu gaengigen "verschwindende Nachricht"-Implementierungen.
    @State private var confidentialModeEnabled = false
    @State private var confidentialUntilDate = Date(timeIntervalSinceNow: 7 * 24 * 3600)

    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send").
    /// Default-Zeitpunkt: naechste volle Stunde ab jetzt + 1h.
    @State private var scheduleSendEnabled = false
    @State private var scheduledDate = Date(timeIntervalSinceNow: 3600)

    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 6 ("Undo Send"): reiner
    /// Client-Mechanismus -- `send()` loest KEINEN sofortigen
    /// `apiClient.sendMessage(...)`-Aufruf mehr aus, sondern startet einen
    /// Countdown; erst wenn der ablaeuft (und nicht per "Rückgängig"
    /// abgebrochen wurde), geht die Anfrage tatsaechlich raus. Kein
    /// Server-Pendant (der Contract kennt kein "Senden zurückziehen"),
    /// funktioniert also NUR solange der User innerhalb des Zeitfensters
    /// in dieser Ansicht bleibt (dokumentierte Grenze, siehe ios/README.md).
    @State private var undoSendTask: Task<Void, Never>?
    @State private var undoSendSecondsRemaining: Int?
    private let undoSendWindowSeconds = 6

    /// [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 1
    /// ("Vergessener-Anhang-Erkennung"), rein client-seitige Heuristik --
    /// kein Contract-/Backend-Bezug.
    @State private var showForgottenAttachmentConfirm = false

    /// [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt
    /// 2 ("Kontakt-Autovervollstaendigung"): welches Feld gerade fokussiert
    /// ist, steuert wo die Vorschlagsliste erscheint.
    private enum ComposeField { case to, cc, bcc }
    @FocusState private var focusedField: ComposeField?

    /// [2026-09-21] "FUENF NEUE KOMFORT-FEATURES" Punkt 3 ("Entwuerfe
    /// automatisch speichern"): `nil`, bis der erste Autosave gelaufen ist
    /// -- danach `PATCH` statt `POST` fuer alle Folge-Speicherungen. Beim
    /// erfolgreichen Senden wird die ID durchgereicht, damit der Server den
    /// Entwurf automatisch verwirft (siehe `send()` unten).
    @State private var draftId: String?
    @State private var autosaveTask: Task<Void, Never>?
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
                        .focused($focusedField, equals: .to)
                        .onChange(of: to) { scheduleAutosave() }
                    contactSuggestions(for: .to, text: $to)

                    if showCcBcc {
                        TextField("CC", text: $cc)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focusedField, equals: .cc)
                            .onChange(of: cc) { scheduleAutosave() }
                        contactSuggestions(for: .cc, text: $cc)
                        TextField("BCC", text: $bcc)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focusedField, equals: .bcc)
                        contactSuggestions(for: .bcc, text: $bcc)
                    } else {
                        Button("CC/BCC hinzufügen") { showCcBcc = true }
                    }

                    TextField("Betreff", text: $subject)
                        .onChange(of: subject) { scheduleAutosave() }
                } footer: {
                    Text("Mehrere Adressen durch Komma trennen.")
                }

                Section {
                    TextEditor(text: $bodyText)
                        .frame(minHeight: 180)
                        .onChange(of: bodyText) { scheduleAutosave() }
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

                Section {
                    Toggle("Vertraulich senden", isOn: $confidentialModeEnabled)
                    if confidentialModeEnabled {
                        DatePicker("Läuft ab", selection: $confidentialUntilDate, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                    }
                } footer: {
                    if confidentialModeEnabled {
                        Text("Der Nachrichtentext wird nach Ablauf automatisch aus deiner \"gesendet\"-Kopie gelöscht.")
                    }
                }

                Section {
                    Toggle("Für später planen", isOn: $scheduleSendEnabled)
                    if scheduleSendEnabled {
                        DatePicker("Senden am", selection: $scheduledDate, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                    }
                } footer: {
                    if scheduleSendEnabled {
                        Text("Die Nachricht wird automatisch zum gewählten Zeitpunkt verschickt (in \"Entwürfe\" einsehbar/abbrechbar).")
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
                    Button("Verwerfen") {
                        // Bricht ein laufendes Undo-Send-Zeitfenster mit ab --
                        // ohne das würde die Nachricht trotz "Verwerfen" nach
                        // Ablauf des Countdowns noch rausgehen (siehe
                        // `dispatchSend()`-Kommentar).
                        cancelUndoSend()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(primaryActionLabel) {
                        Task { await send() }
                    }
                    .disabled(isSending || !canSend || undoSendSecondsRemaining != nil)
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
            .task { await environment.loadContacts() }
            .onDisappear {
                // "...oder beim Verlassen des Compose-Screens" (siehe PATCH
                // /drafts/{draftId}-Summary im Contract) -- letzter,
                // sofortiger Speicherversuch statt auf den Debounce zu
                // warten, falls der User direkt nach dem letzten
                // Tastendruck wegnavigiert. Kein Effekt, wenn schon
                // gesendet wurde (dann ist der Entwurf serverseitig bereits
                // verworfen, ein 404 beim Update wird still verschluckt).
                autosaveTask?.cancel()
                // Siehe "Verwerfen"-Button-Kommentar oben -- greift auch bei
                // Wegwischen des Sheets waehrend des Undo-Send-Countdowns.
                cancelUndoSend()
                if hasUnsavedContent {
                    Task { await performAutosave() }
                }
            }
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
            .confirmationDialog(
                "Anhang vergessen?",
                isPresented: $showForgottenAttachmentConfirm,
                titleVisibility: .visible
            ) {
                Button("Trotzdem senden") {
                    Task { await proceedAfterForgottenAttachmentCheck() }
                }
                Button("Abbrechen", role: .cancel) {}
            } message: {
                Text("Der Text erwähnt einen Anhang, aber es ist keiner angefügt.")
            }
            .safeAreaInset(edge: .bottom) {
                if let undoSendSecondsRemaining {
                    undoSendBanner(secondsRemaining: undoSendSecondsRemaining)
                }
            }
        }
    }

    private var primaryActionLabel: String {
        if isSending { return "Sende…" }
        if scheduleSendEnabled { return "Planen" }
        return "Senden"
    }

    private func undoSendBanner(secondsRemaining: Int) -> some View {
        HStack(spacing: DesignTokens.Spacing.md) {
            Text("Wird in \(secondsRemaining)s gesendet…")
                .font(.system(size: DesignTokens.Typography.Size.body))
                .foregroundStyle(DesignTokens.Color.textPrimary)
            Spacer()
            Button("Rückgängig") {
                cancelUndoSend()
            }
            .font(.system(size: DesignTokens.Typography.Size.body, weight: .medium))
        }
        .padding(DesignTokens.Spacing.lg)
        .background(DesignTokens.Color.surfaceCard)
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

    /// [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 1
    /// ("Vergessener-Anhang-Erkennung"): einfache Substring-Heuristik --
    /// kein NLP, keine Server-Anfrage, bewusst simpel (analog zu Gmails
    /// eigener Heuristik, die ebenfalls nur auf Schluesselwoertern beruht).
    private static let attachmentMentionKeywords = [
        "anhang", "anhänge", "anhaenge", "angehängt", "angehaengt", "anbei", "beigefügt", "beigefuegt",
        "attached", "attachment", "enclosed",
    ]

    private var seemsToForgetAttachment: Bool {
        guard composeAttachments.isEmpty else { return false }
        let needle = bodyText.lowercased()
        return Self.attachmentMentionKeywords.contains { needle.contains($0) }
    }

    private func send() async {
        guard canSend else { return }
        if seemsToForgetAttachment {
            showForgottenAttachmentConfirm = true
            return
        }
        await proceedAfterForgottenAttachmentCheck()
    }

    private func proceedAfterForgottenAttachmentCheck() async {
        sendBlockedReason = nil
        errorMessage = nil
        if scheduleSendEnabled {
            await scheduleSend()
        } else {
            beginUndoSendCountdown()
        }
    }

    /// `POST /drafts` mit `scheduledFor` (Schedule Send) -- anders als der
    /// sofortige Versand unten OHNE Undo-Send-Fenster: es gibt noch keinen
    /// tatsaechlichen Netzwerk-Seiteneffekt gegenueber dem Empfaenger, den
    /// man "rueckgaengig" machen muesste (die Planung selbst kann jederzeit
    /// in "Entwürfe" abgebrochen werden, siehe `DraftListView`).
    private func scheduleSend() async {
        isSending = true
        defer { isSending = false }
        do {
            _ = try await environment.apiClient.scheduleDraft(
                accountId: isReply ? nil : accountId,
                inReplyToMessageId: isReply ? original?.id : nil,
                to: toList,
                cc: Self.addressList(from: cc),
                bcc: Self.addressList(from: bcc),
                subject: subject,
                bodyText: bodyText,
                scheduledFor: scheduledDate
            )
            autosaveTask?.cancel()
            // Ein bereits per Autosave angelegter Entwurf wird NICHT
            // verworfen (anders als beim echten Versand) -- `scheduleDraft`
            // legt einen ZWEITEN, eigenen Entwurf mit `scheduledFor` an
            // (Contract kennt kein "bestehenden Entwurf nachtraeglich
            // planen"). Dokumentierte Grenze: bei aktivem Autosave-Entwurf
            // bleibt ein doppelter, ungeplanter Entwurf in "Entwürfe" zurueck.
            onSent()
            dismiss()
        } catch APIError.badRequest(let message) {
            errorMessage = message ?? "Planen fehlgeschlagen."
        } catch {
            errorMessage = "Planen fehlgeschlagen. Bitte später erneut versuchen."
        }
    }

    /// "5 Wettbewerbs-Luecken" Punkt 6 ("Undo Send"): startet den
    /// Countdown, der Bildschirm bleibt offen (Felder bleiben editierbar
    /// gesperrt ueber `disabled(isSending || ...)` am Senden-Button, siehe
    /// oben) bis entweder die Zeit ablaeuft (-> `dispatchSend()`) oder
    /// `cancelUndoSend()` den Task abbricht.
    private func beginUndoSendCountdown() {
        undoSendSecondsRemaining = undoSendWindowSeconds
        undoSendTask = Task {
            var remaining = undoSendWindowSeconds
            while remaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                remaining -= 1
                undoSendSecondsRemaining = remaining
            }
            guard !Task.isCancelled else { return }
            await dispatchSend()
        }
    }

    private func cancelUndoSend() {
        undoSendTask?.cancel()
        undoSendTask = nil
        undoSendSecondsRemaining = nil
    }

    /// Der tatsächliche `POST /messages/send`-Aufruf, ausgelagert aus
    /// `send()`, weil er jetzt erst NACH dem Undo-Send-Countdown läuft
    /// (siehe `beginUndoSendCountdown()`).
    private func dispatchSend() async {
        isSending = true
        defer {
            isSending = false
            undoSendSecondsRemaining = nil
            undoSendTask = nil
        }
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
                // [2026-09-21] "FUENF NEUE KOMFORT-FEATURES" Punkt 3: falls
                // ein Autosave-Entwurf angelegt wurde, verwirft der Server
                // ihn nach erfolgreichem Versand automatisch.
                draftId: draftId,
                confidentialUntil: confidentialModeEnabled ? confidentialUntilDate : nil
            )
            autosaveTask?.cancel()
            onSent()
            dismiss()
        } catch APIError.blocked(let reason) {
            sendBlockedReason = reason ?? "Versand wurde aus Sicherheitsgründen blockiert."
        } catch {
            errorMessage = "Versand fehlgeschlagen. Bitte später erneut versuchen."
        }
    }

    // MARK: - Kontakt-Autovervollständigung (WEB_INBOX.md 21.09. "FUENF
    // NEUE KOMFORT-FEATURES" Punkt 2)

    /// Fragment nach dem letzten Komma/Semikolon des übergebenen Textes --
    /// derselbe Trennzeichen-Satz wie `addressList(from:)`.
    private static func lastFragment(of raw: String) -> String {
        raw.split(whereSeparator: { $0 == "," || $0 == ";" }).last
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func suggestions(for field: ComposeField, text: String) -> [String] {
        guard focusedField == field else { return [] }
        let fragment = Self.lastFragment(of: text).lowercased()
        guard !fragment.isEmpty else { return [] }
        return environment.contacts
            .filter { $0.contains(fragment) && $0 != fragment }
            .prefix(5)
            .map { $0 }
    }

    /// Ersetzt nur das Fragment NACH dem letzten Komma durch die gewählte
    /// Adresse (Rest des Feldes bleibt unangetastet) -- analog zu einer
    /// nativen `<datalist>`-Auswahl auf Web.
    private func applySuggestion(_ address: String, to text: Binding<String>) {
        if let lastSeparator = text.wrappedValue.lastIndex(where: { $0 == "," || $0 == ";" }) {
            text.wrappedValue = String(text.wrappedValue[...lastSeparator]) + " " + address + ", "
        } else {
            text.wrappedValue = address + ", "
        }
    }

    @ViewBuilder
    private func contactSuggestions(for field: ComposeField, text: Binding<String>) -> some View {
        let matches = suggestions(for: field, text: text.wrappedValue)
        if !matches.isEmpty {
            ForEach(matches, id: \.self) { address in
                Button(address) {
                    applySuggestion(address, to: text)
                }
                .font(.system(size: DesignTokens.Typography.Size.small))
                .foregroundStyle(DesignTokens.Color.textSecondary)
            }
        }
    }

    // MARK: - Entwürfe automatisch speichern (WEB_INBOX.md 21.09. "FUENF
    // NEUE KOMFORT-FEATURES" Punkt 3)

    /// Nur relevant für `mode != .reply` -- Antworten haben laut Contract
    /// kein eigenes Entwurfs-Konzept über diesen Screen (kein
    /// `inReplyToMessageId`-loser Fall), aber technisch spricht nichts
    /// dagegen, auch Antwort-Entwürfe zu sichern -- daher bewusst NICHT
    /// eingeschränkt, `createDraft` akzeptiert `inReplyToMessageId` ohnehin.
    private var hasUnsavedContent: Bool {
        !toList.isEmpty || !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Debounced um ~3 Sekunden nach dem letzten Tastendruck, wie im
    /// Contract-Kommentar für `PATCH /drafts/{draftId}` beschrieben
    /// ("Laufendes Speichern waehrend des Tippens").
    private func scheduleAutosave() {
        autosaveTask?.cancel()
        autosaveTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            await performAutosave()
        }
    }

    private func performAutosave() async {
        guard hasUnsavedContent else { return }
        do {
            if let draftId {
                _ = try await environment.apiClient.updateDraft(
                    id: draftId, to: toList, cc: Self.addressList(from: cc), subject: subject, bodyText: bodyText
                )
            } else {
                let created = try await environment.apiClient.createDraft(
                    inReplyToMessageId: isReply ? original?.id : nil,
                    to: toList, cc: Self.addressList(from: cc), subject: subject, bodyText: bodyText
                )
                draftId = created.id
            }
        } catch {
            // Stiller Fehlschlag -- Autosave ist eine Komfortfunktion, kein
            // Blocker für das eigentliche Verfassen/Senden. Der nächste
            // Tastendruck löst ohnehin einen neuen Versuch aus.
        }
    }
}

#Preview {
    ComposeView(mode: .new, onSent: {})
        .environmentObject(AppEnvironment())
}
