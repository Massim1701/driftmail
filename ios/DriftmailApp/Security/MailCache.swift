import Foundation

/// [2026-09-28] WEB_INBOX.md 27.09. "ENTSCHEIDUNG - Lokaler Mail-Cache":
/// kleiner, verschlüsselter Offline-Spiegel der zuletzt gesehenen Mails.
/// Das Backend bleibt die Wahrheit -- der Cache wird bei jedem erfolgreichen
/// Online-Abruf überschrieben und nur gelesen, um die Liste sofort zu zeigen
/// bzw. ohne Netz den "Stand vom ..." anzuzeigen.
///
/// Bewusst JSON-Dateien statt Core Data (Wahl laut Auftrag bei Track C):
/// die Datenmenge ist klein und begrenzt, `Message`/`MessageDetail` sind
/// bereits `Codable`, und Dateien lassen sich direkt mit Data Protection
/// schreiben und vom Backup ausnehmen -- kein Datenmodell/Migrationspfad
/// nötig.
///
/// Schutz:
/// - Data Protection `.complete`: Dateien sind nur lesbar, solange das
///   Gerät entsperrt ist. Die App hat keinen Hintergrundabruf
///   (keine `UIBackgroundModes`), deshalb ist die strengste Klasse ohne
///   Nachteil möglich. Kommt später ein Hintergrundabruf dazu, müsste die
///   Klasse auf `.completeUntilFirstUserAuthentication` gelockert werden.
/// - Ordner mit `isExcludedFromBackup`: nichts davon landet in iCloud-/
///   Rechner-Backups.
///
/// Umfang (Grenzen):
/// - Listen: je Ordner die neuesten 200 Nachrichten (nur Kopfzeilen).
/// - Details: nur Text (`bodyText`); `bodyHtml` und Links werden NICHT
///   gespeichert (HTML könnte offline Remote-Bilder nachladen wollen).
///   Anhänge nie, nur deren Metadaten (Name, Scan-Status).
/// - Details nur für Mails der letzten 30 Tage, höchstens 300 Stück.
///
/// Gelöscht wird alles bei Abmelden, Konto-Entfernen, Verbinden eines neuen
/// Kontos und über "Offline-Kopie löschen" in den Einstellungen.
actor MailCache {
    static let shared = MailCache()

    static let maxMessagesPerFolder = 200
    static let maxDetails = 300
    static let detailMaxAge: TimeInterval = 30 * 24 * 3600

    struct Snapshot<Value: Codable>: Codable {
        let savedAt: Date
        let value: Value
    }

    private let directory: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(directory: URL? = nil) {
        let base = directory ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MailCache", isDirectory: true)
        self.directory = base
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
        self.decoder = DriftmailDateDecoding.makeDecoder()
    }

    // MARK: - Listen

    func messages(folderId: String) -> Snapshot<[Message]>? {
        read(listURL(folderId: folderId))
    }

    func store(messages: [Message], folderId: String) {
        let newest = messages
            .sorted { $0.receivedAt > $1.receivedAt }
            .prefix(Self.maxMessagesPerFolder)
        write(Snapshot(savedAt: Date(), value: Array(newest)), to: listURL(folderId: folderId))
    }

    // MARK: - Details

    func detail(messageId: String) -> Snapshot<MessageDetail>? {
        read(detailURL(messageId: messageId))
    }

    func store(detail: MessageDetail) {
        guard Date().timeIntervalSince(detail.receivedAt) <= Self.detailMaxAge else { return }
        let textOnly = MessageDetail(
            id: detail.id,
            fromAddress: detail.fromAddress,
            fromDisplayName: detail.fromDisplayName,
            subject: detail.subject,
            receivedAt: detail.receivedAt,
            folderId: detail.folderId,
            classification: detail.classification,
            bodyText: detail.bodyText,
            bodyHtml: nil,
            security: detail.security,
            canUnsubscribe: detail.canUnsubscribe,
            isNewSender: detail.isNewSender,
            inReplyToMessageId: detail.inReplyToMessageId,
            awaitingReply: detail.awaitingReply,
            confidentialUntil: detail.confidentialUntil,
            snoozedUntil: detail.snoozedUntil,
            attachments: detail.attachments,
            links: []
        )
        write(Snapshot(savedAt: Date(), value: textOnly), to: detailURL(messageId: detail.id))
        pruneDetails()
    }

    // MARK: - Aktualisieren / Löschen

    /// Nach Quarantäne, Verschieben, Löschen oder Snooze: Nachricht aus
    /// allen gespeicherten Listen und ihren Detail-Eintrag entfernen, damit
    /// offline nie ein veralteter Ort/Status gezeigt wird.
    func remove(messageId: String) {
        try? FileManager.default.removeItem(at: detailURL(messageId: messageId))
        for url in files(prefix: "list-") {
            guard let snapshot: Snapshot<[Message]> = read(url) else { continue }
            let remaining = snapshot.value.filter { $0.id != messageId }
            if remaining.count != snapshot.value.count {
                write(Snapshot(savedAt: snapshot.savedAt, value: remaining), to: url)
            }
        }
    }

    func clearAll() {
        try? FileManager.default.removeItem(at: directory)
    }

    // MARK: - Intern

    private func listURL(folderId: String) -> URL {
        directory.appendingPathComponent("list-\(Self.safeName(folderId)).json")
    }

    private func detailURL(messageId: String) -> URL {
        directory.appendingPathComponent("detail-\(Self.safeName(messageId)).json")
    }

    /// IDs sind UUIDs; trotzdem nichts anderes als Buchstaben, Ziffern und
    /// `-` in einen Dateinamen übernehmen.
    private static func safeName(_ id: String) -> String {
        String(id.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" }.map(Character.init))
    }

    private func files(prefix: String) -> [URL] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        return urls.filter { $0.lastPathComponent.hasPrefix(prefix) }
    }

    private func read<Value: Codable>(_ url: URL) -> Snapshot<Value>? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(Snapshot<Value>.self, from: data)
    }

    /// Schreibfehler (z.B. Gerät gesperrt -> `.complete` verweigert den
    /// Zugriff) werden bewusst geschluckt: der Cache ist nur eine
    /// Beschleunigung, die App funktioniert ohne ihn genauso.
    private func write<Value: Codable>(_ snapshot: Snapshot<Value>, to url: URL) {
        guard ensureDirectory(), let data = try? encoder.encode(snapshot) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
    }

    private func ensureDirectory() -> Bool {
        let fm = FileManager.default
        if !fm.fileExists(atPath: directory.path) {
            do {
                try fm.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.complete]
                )
            } catch {
                return false
            }
        }
        var dir = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return true
    }

    /// Details älter als 30 Tage und alles über 300 Stück (älteste zuerst)
    /// entfernen.
    private func pruneDetails() {
        var entries: [(url: URL, receivedAt: Date)] = []
        for url in files(prefix: "detail-") {
            guard let snapshot: Snapshot<MessageDetail> = read(url) else {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            if Date().timeIntervalSince(snapshot.value.receivedAt) > Self.detailMaxAge {
                try? FileManager.default.removeItem(at: url)
            } else {
                entries.append((url, snapshot.value.receivedAt))
            }
        }
        guard entries.count > Self.maxDetails else { return }
        for entry in entries.sorted(by: { $0.receivedAt > $1.receivedAt }).dropFirst(Self.maxDetails) {
            try? FileManager.default.removeItem(at: entry.url)
        }
    }
}
