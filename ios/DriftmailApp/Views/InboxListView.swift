import SwiftUI

/// Message list for a single folder (`GET /messages?folderId=...`).
/// Shows the quarantine warning banner when browsing "Quarantäne".
///
/// [2026-09-08] Contract-Änderung: `folder` ist jetzt das `Folder`-Objekt
/// statt eines Enum-Falls; Vergleich gegen "die Quarantäne" läuft über
/// `folder.systemKey` statt `folder == .quarantaene`.
/// [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt 4
/// "Threaded Ansicht": ein Thread ist eine Gruppe von Nachrichten, die
/// innerhalb der GERADE GELADENEN Liste über `inReplyToMessageId`
/// zusammenhängen (siehe `groupIntoThreads(_:)` unten für die bewusste
/// Grenze -- ein Elternteil in einem anderen Ordner bleibt unverknüpft).
/// `newest` ist die sichtbare Zeile, `older` klappt über "+N ältere" auf.
private struct MessageThread: Identifiable {
    let newest: Message
    let older: [Message]
    var id: String { newest.id }
}

/// Gruppiert `messages` nach dem am weitesten zurückverfolgbaren Elternteil
/// INNERHALB von `messages` selbst (kein Nachladen aus anderen Ordnern) --
/// alle Nachrichten mit demselben Wurzel-Vorfahren bilden einen Thread,
/// die neueste davon ist die sichtbare Zeile. Threads sind nach ihrer
/// neuesten Nachricht sortiert, genau wie die flache Liste zuvor.
private func groupIntoThreads(_ messages: [Message]) -> [MessageThread] {
    let byId = Dictionary(uniqueKeysWithValues: messages.map { ($0.id, $0) })

    func rootId(for message: Message) -> String {
        var current = message
        var visited: Set<String> = []
        while let parentId = current.inReplyToMessageId, let parent = byId[parentId], !visited.contains(parentId) {
            visited.insert(parentId)
            current = parent
        }
        return current.id
    }

    var groups: [String: [Message]] = [:]
    for message in messages {
        groups[rootId(for: message), default: []].append(message)
    }

    return groups.values
        .map { group -> MessageThread in
            let sorted = group.sorted { $0.receivedAt > $1.receivedAt }
            return MessageThread(newest: sorted[0], older: Array(sorted.dropFirst()))
        }
        .sorted { $0.newest.receivedAt > $1.newest.receivedAt }
}

struct InboxListView: View {
    let folder: Folder

    @EnvironmentObject private var environment: AppEnvironment
    @State private var messages: [Message] = []
    @State private var isLoading = true
    @State private var messagePendingPermanentDelete: Message?
    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze"): Nachricht,
    /// fuer die gerade der Zeitpunkt-Auswahl-Dialog offen ist.
    @State private var messagePendingSnooze: Message?
    /// Thread-IDs (= `MessageThread.id`, die ID der neuesten Nachricht),
    /// deren "+N ältere" gerade aufgeklappt ist.
    @State private var expandedThreadIds: Set<String> = []

    private var threads: [MessageThread] { groupIntoThreads(messages) }

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

            ForEach(threads) { thread in
                messageRow(thread.newest)

                if !thread.older.isEmpty {
                    if expandedThreadIds.contains(thread.id) {
                        ForEach(thread.older) { older in
                            messageRow(older)
                        }
                        Button {
                            expandedThreadIds.remove(thread.id)
                        } label: {
                            Label("Weniger anzeigen", systemImage: "chevron.up")
                                .font(.system(size: DesignTokens.Typography.Size.small))
                        }
                        .listRowBackground(DesignTokens.Color.surfaceCard)
                    } else {
                        Button {
                            expandedThreadIds.insert(thread.id)
                        } label: {
                            Label("+\(thread.older.count) ältere", systemImage: "chevron.down")
                                .font(.system(size: DesignTokens.Typography.Size.small))
                                .foregroundStyle(DesignTokens.Color.textSecondary)
                        }
                        .listRowBackground(DesignTokens.Color.surfaceCard)
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
        .confirmationDialog(
            "Wann soll die Nachricht wieder erscheinen?",
            isPresented: Binding(
                get: { messagePendingSnooze != nil },
                set: { if !$0 { messagePendingSnooze = nil } }
            ),
            titleVisibility: .visible
        ) {
            ForEach(SnoozeOption.allCases) { option in
                Button(option.label) {
                    if let message = messagePendingSnooze {
                        Task { await snooze(message, until: option.date()) }
                    }
                }
            }
            Button("Abbrechen", role: .cancel) {
                messagePendingSnooze = nil
            }
        }
    }

    /// Extracted from the former single `ForEach(messages)` body so both
    /// the visible (newest) row AND expanded "+N ältere" rows share
    /// identical rendering/swipe-actions -- no behavior change for the
    /// common case (a thread of size 1 looks exactly like before).
    @ViewBuilder
    private func messageRow(_ message: Message) -> some View {
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
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze") --
            // Papierkorb/Quarantäne bewusst ausgenommen, dort ergibt ein
            // "spaeter wieder vorlegen" keinen Sinn (Nachricht ist bereits
            // aussortiert).
            if !folder.isTrash && folder.systemKey != .quarantaene {
                Button {
                    messagePendingSnooze = message
                } label: {
                    Label("Später", systemImage: "clock")
                }
                .tint(DesignTokens.Color.textSecondary)
            }
        }
    }

    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5: feste Zeitpunkte statt
    /// eines freien Datumspickers -- analog zum ueblichen Snooze-Angebot
    /// bekannter Mail-Clients, weniger Taps als eine volle Datumsauswahl.
    private enum SnoozeOption: CaseIterable, Identifiable {
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
                let nextMonday = calendar.nextDate(after: now, matching: DateComponents(hour: 8, minute: 0, weekday: 2), matchingPolicy: .nextTime) ?? calendar.date(byAdding: .day, value: 7, to: now) ?? now
                return nextMonday
            }
        }
    }

    /// `POST /messages/{messageId}/snooze`. Entfernt die Nachricht sofort
    /// aus der Liste (der Server zeigt sie bis zum Ablauf ohnehin nicht
    /// mehr bei `GET /messages`), analog zum optimistischen Entfernen bei
    /// `delete(_:)`.
    private func snooze(_ message: Message, until: Date) async {
        messagePendingSnooze = nil
        do {
            _ = try await environment.apiClient.snoozeMessage(id: message.id, until: until)
            messages.removeAll { $0.id == message.id }
        } catch {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            messages = try await environment.apiClient.fetchMessages(folderId: folder.id, accountId: nil, query: nil)
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
/// require a specific SDK version beyond what's already targeted. Not
/// `private` -- reused by `DraftListView` for the "entwuerfe"-Ordner.
struct ContentUnavailableCompat: View {
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
            id: "folder-quarantaene", accountId: "preview-account", name: "Quarantäne", icon: "shield-exclamation",
            isSystem: true, systemKey: .quarantaene, sortOrder: 3
        ))
    }
    .environmentObject(AppEnvironment())
}
