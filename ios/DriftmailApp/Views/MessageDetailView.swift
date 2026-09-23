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

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environment: AppEnvironment
    @State private var detail: MessageDetail?
    @State private var summary: MailSummary?
    @State private var isLoadingSummary = false
    @State private var isQuarantining = false
    @State private var isMoving = false
    @State private var isDeleting = false
    @State private var isPermanentlyDeleting = false
    @State private var showPermanentDeleteConfirm = false
    @State private var errorMessage: String?
    @State private var isUnsubscribing = false
    @State private var unsubscribeStatus: UnsubscribeStatus?
    // [2026-09-21] Antworten/Weiterleiten öffnen jetzt den gemeinsamen
    // `ComposeView` als Sheet (siehe dort) statt eines inline hier
    // eingebetteten Compose-Felds -- dadurch stehen CC/BCC (WEB_INBOX.md
    // 21.09. "DREI WEITERE GRUNDFUNKTIONEN" Punkt 3) und Weiterleiten
    // (Punkt 1) auch hier zur Verfügung, nicht nur bei neuen Mails.
    @State private var composeMode: ComposeMode?
    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze").
    @State private var isSnoozing = false

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
                        SecurityBadgesView(
                            security: security,
                            isNewSender: detail.isNewSender && !environment.trustedSenderAddresses.contains(detail.fromAddress),
                            onTrustSender: {
                                Task { await environment.trustSender(detail.fromAddress) }
                            }
                        )
                    }

                    if let confidentialUntil = detail.confidentialUntil {
                        confidentialBanner(until: confidentialUntil, bodyGone: detail.bodyText == nil)
                    }

                    if let snoozedUntil = detail.snoozedUntil, snoozedUntil > Date() {
                        snoozedBanner(until: snoozedUntil)
                    }

                    // [2026-09-22] "NEUE GRUNDLAGE - HTML-Rendering des
                    // Mail-Bodies": `bodyHtml` (bereits serverseitig
                    // sanitisiert) wird AUSSCHLIESSLICH über die sandboxed
                    // `MailBodyWebView` (WKWebView, JS deaktiviert,
                    // eingeschränkte Navigation) gerendert -- niemals als
                    // nativer `Text`/AttributedString aus rohem HTML, siehe
                    // dort. Reine Text-Mails (`bodyHtml == nil`) verhalten
                    // sich unverändert wie vorher.
                    if let bodyHtml = detail.bodyHtml {
                        MailBodyHtmlCard(html: bodyHtml)
                    } else {
                        Text(detail.bodyText ?? "")
                            .font(.system(size: DesignTokens.Typography.Size.body))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .padding(DesignTokens.Spacing.lg)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                                    .fill(DesignTokens.Color.surfaceCard)
                            )
                    }

                    if !detail.attachments.isEmpty {
                        attachmentsCard(detail.attachments)
                    }

                    actions(for: detail)

                    if let summary {
                        summaryCard(summary)
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
            await environment.loadTrustedSenders()
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
        .sheet(isPresented: Binding(
            get: { composeMode != nil },
            set: { if !$0 { composeMode = nil } }
        )) {
            if let composeMode {
                ComposeView(mode: composeMode, onSent: {
                    Task { await environment.loadFolders(forceRefresh: true) }
                })
            }
        }
    }

    // MARK: - Sections

    /// [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt
    /// 1 ("Unbekannte Absender streng behandeln"): true, wenn der Schalter
    /// in den Einstellungen an ist UND die Nachricht von einem unbekannten,
    /// nicht auf der Whitelist stehenden Absender kommt -- mirrors web's
    /// `.detail-header-unknown-sender` condition.
    private func isStrictlyFlagged(_ detail: MessageDetail) -> Bool {
        environment.strictUnknownSenders && detail.isNewSender && !environment.trustedSenderAddresses.contains(detail.fromAddress)
    }

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
        .padding(isStrictlyFlagged(detail) ? DesignTokens.Spacing.md : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                .fill(isStrictlyFlagged(detail) ? DesignTokens.Color.warning.opacity(0.08) : .clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                .stroke(isStrictlyFlagged(detail) ? DesignTokens.Color.warning.opacity(0.45) : .clear, lineWidth: 1)
        )
    }

    private func actions(for detail: MessageDetail) -> some View {
        VStack(spacing: DesignTokens.Spacing.sm) {
            HStack(spacing: DesignTokens.Spacing.sm) {
                Button {
                    Task { await loadSummary() }
                } label: {
                    // Label-Umbenennung (zuletzt WEB_INBOX.md 21.09. "KLEINE
                    // LABEL-AENDERUNG", davor WEB_INBOX.md 09.09. "Ordner-
                    // Umbau-Eintrags", Punkt 2): reine UI-Textänderung, das
                    // Feld heißt technisch weiterhin summaryText.
                    Label("Check Mail", systemImage: "text.bubble")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                }
                .buttonStyle(.bordered)
                .disabled(isLoadingSummary)

                // Antworten/Weiterleiten öffnen den gemeinsamen
                // `ComposeView` als Sheet (siehe `composeMode`-Kommentar
                // oben). WEB_INBOX.md 09.09. "KORREKTUR der letzten Regel"
                // weiterhin gültig für Antworten: ausgeblendet bei
                // aktuellem Ordner spam (folderId-/systemKey-Check), nicht
                // bei eingefrorenem classification='spam' -- Antworten auf
                // Spam macht keinen Sinn, auf Phishing (Quarantäne) schon
                // (Warnbanner oben). Weiterleiten (WEB_INBOX.md 21.09.
                // "DREI WEITERE GRUNDFUNKTIONEN" Punkt 1) ist unabhängig
                // davon immer sinnvoll.
                if currentFolder?.systemKey != .spam {
                    Button {
                        composeMode = .reply(detail)
                    } label: {
                        Label("Antworten", systemImage: "arrowshape.turn.up.left")
                            .font(.system(size: DesignTokens.Typography.Size.body))
                    }
                    .buttonStyle(.bordered)
                }

                Button {
                    composeMode = .forward(detail)
                } label: {
                    Label("Weiterleiten", systemImage: "arrowshape.turn.up.right")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                }
                .buttonStyle(.bordered)
            }

            // Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.):
            // manueller Abmelden-Button, unabhängig von der Klassifikation
            // -- nur wenn die Nachricht einen gültigen List-Unsubscribe-
            // Header hat (siehe backend/README.md).
            //
            // [2026-09-21] "LUECKE SCHLIESSEN - echter Abmelde-Aufruf": der
            // Aufruf ist jetzt ein echter Netzwerk-Seiteneffekt und kann
            // fehlschlagen -- bei .failed bleibt der Button sichtbar
            // (erneuter Versuch möglich), statt den User mit einer stillen
            // Fehlanzeige hängenzulassen.
            if detail.canUnsubscribe {
                if unsubscribeStatus == .failed {
                    Text("Abmeldung fehlgeschlagen")
                        .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.danger)
                }
                if unsubscribeStatus == .confirmed {
                    Text("Abgemeldet")
                        .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                        .foregroundStyle(DesignTokens.Color.success)
                } else {
                    Button {
                        Task { await unsubscribe() }
                    } label: {
                        Label(
                            unsubscribeStatus == .failed ? "Erneut versuchen" : "Von Absender abmelden",
                            systemImage: "envelope.badge.shield.half.filled",
                        )
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

            // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze") --
            // dieselben festen Zeitpunkte wie der Swipe in `InboxListView`
            // (dupliziert statt geteilt, kleine eigenstaendige Enums pro
            // View, analog zum Muster bei anderen Konstanten in dieser App).
            if currentFolder?.isTrash != true && currentFolder?.systemKey != .quarantaene {
                Menu {
                    ForEach(DetailSnoozeOption.allCases) { option in
                        Button(option.label) {
                            Task { await snooze(until: option.date()) }
                        }
                    }
                } label: {
                    Label("Später", systemImage: "clock")
                        .font(.system(size: DesignTokens.Typography.Size.body))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isSnoozing)
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

    /// [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 3
    /// ("Vertraulicher Modus"): `bodyGone == true` bedeutet, der
    /// Ablaufzeitpunkt liegt in der Vergangenheit UND der Server hat
    /// `bodyText` bereits gelöscht (siehe `MessageDetail.confidentialUntil`-
    /// Kommentar) -- eigener Hinweistext statt eines leeren Bodys ohne
    /// Erklärung.
    private func confidentialBanner(until: Date, bodyGone: Bool) -> some View {
        HStack(spacing: DesignTokens.Spacing.sm) {
            Image(systemName: bodyGone ? "lock.slash" : "lock.fill")
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text(bodyGone
                 ? "Vertraulich -- der Inhalt wurde am \(until.formatted(date: .abbreviated, time: .shortened)) automatisch gelöscht."
                 : "Vertraulich bis \(until.formatted(date: .abbreviated, time: .shortened)).")
                .font(.system(size: DesignTokens.Typography.Size.small))
                .foregroundStyle(DesignTokens.Color.textSecondary)
        }
        .padding(DesignTokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                .fill(DesignTokens.Color.surfaceCard)
        )
    }

    private func snoozedBanner(until: Date) -> some View {
        HStack(spacing: DesignTokens.Spacing.sm) {
            Image(systemName: "clock.fill")
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Text("Zurückgestellt bis \(until.formatted(date: .abbreviated, time: .shortened)).")
                .font(.system(size: DesignTokens.Typography.Size.small))
                .foregroundStyle(DesignTokens.Color.textSecondary)
            Spacer()
            Button("Jetzt zeigen") {
                Task { await unsnooze() }
            }
            .font(.system(size: DesignTokens.Typography.Size.small))
        }
        .padding(DesignTokens.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                .fill(DesignTokens.Color.surfaceCard)
        )
    }

    /// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan":
    /// zeigt den ECHTEN ClamAV-Scan-Status pro Anhang -- ein nicht-`clean`
    /// Anhang bekommt bewusst keine Öffnen-Aktion (die App hat ohnehin
    /// keinen eigenen Dateibetrachter, dieser Screen ist reine Information/
    /// Warnung, kein Download).
    private func attachmentsCard(_ attachments: [MessageAttachment]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            Text("Anhänge")
                .font(.system(size: DesignTokens.Typography.Size.small, weight: .medium))
                .foregroundStyle(DesignTokens.Color.textSecondary)
            ForEach(attachments) { attachment in
                HStack(spacing: DesignTokens.Spacing.sm) {
                    Image(systemName: attachment.scanStatus == .clean ? "paperclip" : "exclamationmark.triangle.fill")
                        .foregroundStyle(attachment.scanStatus == .clean ? DesignTokens.Color.textMuted : DesignTokens.Color.danger)
                    Text(attachment.filename)
                        .font(.system(size: DesignTokens.Typography.Size.small))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .lineLimit(1)
                    Spacer()
                    Text(attachment.scanStatus.label)
                        .font(.system(size: DesignTokens.Typography.Size.caption, weight: .medium))
                        .foregroundStyle(attachment.scanStatus == .clean ? DesignTokens.Color.success : DesignTokens.Color.dangerText)
                }
            }
        }
        .padding(DesignTokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                .fill(DesignTokens.Color.surfaceCard)
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

    /// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): ruft jetzt
    /// `AppEnvironment.summarize(messageId:bodyText:)` statt direkt
    /// `apiClient.fetchSummary` -- versucht davor lokal Foundation Models
    /// (Geraete-eigene KI als primaere Quelle, Inhalt verlaesst dann nie
    /// das Geraet), `apiClient` ist nur noch der Fallback-Pfad (siehe
    /// backend/README.md "KI-Anbindung (BYOK)"). Kann nicht mehr werfen --
    /// beide Pfade degradieren graceful bis zu einer Heuristik-Antwort.
    private func loadSummary() async {
        guard let bodyText = detail?.bodyText else { return }
        isLoadingSummary = true
        defer { isLoadingSummary = false }
        summary = await environment.summarize(messageId: messageId, bodyText: bodyText)
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

    /// `POST /messages/{messageId}/snooze`. Verlaesst die Detailansicht
    /// danach (die Nachricht taucht bis zum Ablauf nicht mehr in
    /// `GET /messages` auf, ein Zurueckbleiben auf ihrer eigenen -- dann
    /// unsichtbaren -- Detailseite waere verwirrend).
    private func snooze(until: Date) async {
        isSnoozing = true
        defer { isSnoozing = false }
        do {
            _ = try await environment.apiClient.snoozeMessage(id: messageId, until: until)
            dismiss()
        } catch {
            errorMessage = "Zurückstellen fehlgeschlagen."
        }
    }

    /// Hebt ein bestehendes Snooze sofort auf (`until: nil`), z.B. per
    /// "Jetzt zeigen" im `snoozedBanner(until:)`.
    private func unsnooze() async {
        isSnoozing = true
        defer { isSnoozing = false }
        do {
            _ = try await environment.apiClient.snoozeMessage(id: messageId, until: nil)
            await loadDetail()
        } catch {
            errorMessage = "Zurückstellen aufheben fehlgeschlagen."
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
        case .scanned(.malicious): return "Gefährlich — wird nicht gesendet"
        case .scanned(let status): return status.label
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

/// See `InboxListView.SnoozeOption` -- identische Zeitpunkte, dupliziert
/// statt geteilt (siehe Kommentar am Aufrufer oben).
private enum DetailSnoozeOption: CaseIterable, Identifiable {
    case laterToday, tomorrowMorning, nextWeek

    var id: Self { self }

    var label: String {
        switch self {
        case .laterToday: return "Heute Abend (18 Uhr)"
        case .tomorrowMorning: return "Morgen früh (8 Uhr)"
        case .nextWeek: return "Nächste Woche (Montag, 8 Uhr)"
        }
    }

    func date(calendar: Calendar = .current, now: Date = Date()) -> Date {
        switch self {
        case .laterToday:
            let candidate = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: now) ?? now
            return candidate > now ? candidate : calendar.date(byAdding: .day, value: 1, to: candidate) ?? candidate
        case .tomorrowMorning:
            let tomorrow = calendar.date(byAdding: .day, value: 1, to: now) ?? now
            return calendar.date(bySettingHour: 8, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        case .nextWeek:
            return calendar.nextDate(after: now, matching: DateComponents(hour: 8, minute: 0, weekday: 2), matchingPolicy: .nextTime) ?? calendar.date(byAdding: .day, value: 7, to: now) ?? now
        }
    }
}

/// Card wrapper around `MailBodyWebView` -- owns the `@State height` that
/// the webview measures its rendered content into after load (see
/// `MailBodyWebView.Coordinator.webView(_:didFinish:)`), matching the same
/// card styling `bodyText` used before this feature.
private struct MailBodyHtmlCard: View {
    let html: String
    @State private var height: CGFloat = 200

    var body: some View {
        MailBodyWebView(html: html, height: $height)
            .frame(height: height)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: DesignTokens.Radius.card)
                    .fill(DesignTokens.Color.surfaceCard)
            )
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.Radius.card))
    }
}

private struct SourceTag: View {
    let source: AiSource

    /// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): dritte, ehrliche
    /// Beschriftung fuer `.heuristic` -- kein KI-Modell beteiligt, weder
    /// On-Device noch Cloud (siehe backend/README.md "KI-Anbindung (BYOK)").
    private var label: String {
        switch source {
        case .onDevice: return "On-Device"
        case .cloudFallback: return "Cloud (eigener Zugang)"
        case .heuristic: return "Regelbasiert"
        }
    }

    var body: some View {
        Text(label)
            .font(.system(size: DesignTokens.Typography.Size.caption, weight: .medium))
            .padding(.horizontal, DesignTokens.Spacing.sm)
            .padding(.vertical, 2)
            .background(Capsule().fill(DesignTokens.Color.border))
            .foregroundStyle(DesignTokens.Color.textSecondary)
    }
}

private struct SecurityBadgesView: View {
    let security: SecurityResult
    /// [2026-09-21] WEB_INBOX.md 19.09. "Sichtbare Kennzeichen/Badges für
    /// die neuen Sicherheitssignale": bereits mit `GET /trusted-senders`
    /// abgeglichen übergeben (siehe `MessageDetailView` -- Whitelist-Check
    /// gehört nicht in diese rein darstellende View).
    let isNewSender: Bool
    /// [2026-09-21] WEB_INBOX.md 21.09. "KLEINE VERKNUEPFUNG - Neuer-
    /// Absender-Badge mit Whitelist verbinden": direkt am Badge zur
    /// Whitelist hinzufügen können, mirrors web's `SecuritySignalBadges`
    /// `onTrustSender` prop.
    let onTrustSender: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.Spacing.sm) {
            FlowLayout(spacing: DesignTokens.Spacing.sm, lineSpacing: DesignTokens.Spacing.sm) {
                badge("SPF", security.spfStatus)
                badge("DKIM", security.dkimStatus)
                badge("DMARC", security.dmarcStatus)
            }
            // Wrapping row (FlowLayout statt HStack): mit sechs moeglichen
            // Signalen plus dem "Neuer Absender"-Hinweis passt das laengst
            // nicht immer in eine Zeile -- eine starre HStack wuerde die
            // Labels dann Buchstabe fuer Buchstabe in ihrer eigenen Kapsel
            // umbrechen statt in eine neue Zeile zu wandern.
            FlowLayout(spacing: DesignTokens.Spacing.sm, lineSpacing: DesignTokens.Spacing.sm) {
                if security.homoglyphDetected {
                    flag("Homoglyph erkannt")
                }
                if security.linkMismatchDetected {
                    flag("Link-Ziel weicht ab")
                }
                if security.displayNameSpoofingDetected {
                    flag("Anzeigename gefälscht")
                }
                if security.replyToMismatchDetected {
                    flag("Antwort-Adresse weicht ab")
                }
                if security.containsNewIban {
                    flag("Neue IBAN")
                }
                if security.ibanChangedInThread {
                    flag("IBAN im Verlauf geändert")
                }
                if isNewSender {
                    HStack(spacing: DesignTokens.Spacing.xs) {
                        flag("Neuer Absender", tone: .warning)
                        Button("Absender vertrauen", action: onTrustSender)
                            .font(.system(size: DesignTokens.Typography.Size.caption, weight: .medium))
                    }
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
            .fixedSize()
            .padding(.horizontal, DesignTokens.Spacing.sm)
            .padding(.vertical, 2)
            .background(Capsule().stroke(color, lineWidth: 1))
    }

    /// Zwei Varianten: `danger` (bisheriges Verhalten für Homoglyph/Link-
    /// Mismatch/IBAN-Signale, Text in `dangerText`) und `warning` (neu, nur
    /// für "Neuer Absender" -- Text direkt in `DesignTokens.Color.warning`,
    /// analog zu web/src/components/SecurityBadge.tsx's `tone-warning`,
    /// dort ebenfalls das einzige Signal mit dieser Tonalität statt Danger).
    private enum FlagTone { case danger, warning }

    private func flag(_ label: String, tone: FlagTone = .danger) -> some View {
        let color = tone == .danger ? DesignTokens.Color.danger : DesignTokens.Color.warning
        let textColor = tone == .danger ? DesignTokens.Color.dangerText : DesignTokens.Color.warning
        return Text(label)
            .font(.system(size: DesignTokens.Typography.Size.caption, weight: .medium))
            .foregroundStyle(textColor)
            .fixedSize()
            .padding(.horizontal, DesignTokens.Spacing.sm)
            .padding(.vertical, 2)
            .background(Capsule().fill(color.opacity(0.15)))
    }
}

#Preview {
    NavigationStack {
        MessageDetailView(messageId: "msg-007")
    }
    .environmentObject(AppEnvironment())
}
