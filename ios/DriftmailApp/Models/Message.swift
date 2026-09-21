import Foundation

/// Mirrors `components/schemas/Message` in contracts/api-spec.yaml.
/// [2026-09-08] Contract-Änderung: `folder: Folder` (Enum) → `folderId`
/// (Referenz auf `Folder.id`), da Ordner jetzt benutzerdefiniert sind.
struct Message: Codable, Identifiable, Hashable {
    let id: String
    let fromAddress: String
    let fromDisplayName: String?
    let subject: String?
    let receivedAt: Date
    let folderId: String
    let classification: Classification
    /// [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt 4
    /// "Threaded Ansicht" -- vorher nur auf `MessageDetail`. Grundlage für
    /// client-seitiges Gruppieren in `InboxListView` (nur innerhalb der
    /// gerade geladenen Ordner-Liste auflösbar, siehe backend/README.md
    /// "Fuenf Komfort-Features" für die bewusste Grenze). `Optional`, damit
    /// ein fehlender Schlüssel in älteren Mock-Daten nicht crasht.
    let inReplyToMessageId: String?
    /// [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2
    /// ("Nudge"): true, wenn diese Nachricht seit mindestens 3 Tagen
    /// unbeantwortet ist UND der User die Erinnerung nicht deaktiviert hat.
    /// Zur Laufzeit vom Backend abgeleitet, kein eigenes Feld. `Optional`
    /// mit Default `false`, damit ältere Mock-Daten ohne dieses Feld nicht
    /// crashen (siehe `inReplyToMessageId`-Kommentar oben für dasselbe Muster).
    let awaitingReply: Bool
    /// [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 3
    /// ("Vertraulicher Modus"): nur bei selbst gesendeten Nachrichten
    /// setzbar. Nach Ablauf wird `MessageDetail.bodyText` serverseitig
    /// gelöscht -- dieses Feld bleibt erhalten, damit die UI "war
    /// vertraulich, seit X abgelaufen" anzeigen kann.
    let confidentialUntil: Date?
    /// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze"): solange
    /// dieser Zeitpunkt in der Zukunft liegt, taucht die Nachricht in
    /// `GET /messages` nicht auf -- dieses Feld ist deshalb praktisch nur
    /// über `GET /messages/{id}` direkt sichtbar (siehe api-spec.yaml).
    let snoozedUntil: Date?

    init(
        id: String, fromAddress: String, fromDisplayName: String?, subject: String?, receivedAt: Date,
        folderId: String, classification: Classification, inReplyToMessageId: String?,
        awaitingReply: Bool = false, confidentialUntil: Date? = nil, snoozedUntil: Date? = nil
    ) {
        self.id = id
        self.fromAddress = fromAddress
        self.fromDisplayName = fromDisplayName
        self.subject = subject
        self.receivedAt = receivedAt
        self.folderId = folderId
        self.classification = classification
        self.inReplyToMessageId = inReplyToMessageId
        self.awaitingReply = awaitingReply
        self.confidentialUntil = confidentialUntil
        self.snoozedUntil = snoozedUntil
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        fromAddress = try container.decode(String.self, forKey: .fromAddress)
        fromDisplayName = try container.decodeIfPresent(String.self, forKey: .fromDisplayName)
        subject = try container.decodeIfPresent(String.self, forKey: .subject)
        receivedAt = try container.decode(Date.self, forKey: .receivedAt)
        folderId = try container.decode(String.self, forKey: .folderId)
        classification = try container.decode(Classification.self, forKey: .classification)
        inReplyToMessageId = try container.decodeIfPresent(String.self, forKey: .inReplyToMessageId)
        awaitingReply = try container.decodeIfPresent(Bool.self, forKey: .awaitingReply) ?? false
        confidentialUntil = try container.decodeIfPresent(Date.self, forKey: .confidentialUntil)
        snoozedUntil = try container.decodeIfPresent(Date.self, forKey: .snoozedUntil)
    }
}

/// Mirrors `components/schemas/SecurityResult` in contracts/api-spec.yaml
/// (1:1 with contracts/ai-adapter-interface.ts SecurityResult and
/// db-schema.sql message_security).
struct SecurityResult: Codable, Hashable {
    let spfStatus: PassFailNone
    let dkimStatus: PassFailNone
    let dmarcStatus: PassFailNone
    let senderDomainAgeDays: Int?
    let domainReputationScore: Double?
    let homoglyphDetected: Bool
    let linkMismatchDetected: Bool
    // [2026-09-21] WEB_INBOX.md 19.09. "Sichtbare Kennzeichen/Badges für
    // die neuen Sicherheitssignale" -- Felder existieren im Contract/
    // Backend bereits seit den Sicherheits-Ergänzungen vom 15.09., waren
    // hier bisher nicht gespiegelt (analog zum Web-Client vor demselben Fix).
    let displayNameSpoofingDetected: Bool
    let replyToMismatchDetected: Bool
    let urgencyLanguageScore: Double?
    let containsNewIban: Bool
    let ibanChangedInThread: Bool
    let classification: Classification
    let confidenceScore: Double
}

/// Mirrors `components/schemas/MessageLink` in contracts/api-spec.yaml.
/// [2026-09-22] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies": echte
/// `<a href>`-Links, extrahiert aus dem HTML-Koerper beim Sync
/// (`message_links`-Tabelle), siehe `MessageDetail.links`-Kommentar.
struct MessageLink: Codable, Identifiable, Hashable {
    let id: String
    let displayText: String?
    let actualUrl: String
    /// false = klassischer Phishing-Indikator (Anzeigetext behauptet eine
    /// Domain, das tatsaechliche href-Ziel zeigt auf eine andere). Nur
    /// ausgewertet, wenn der Anzeigetext selbst wie eine Domain/URL aussieht.
    let domainMatchesDisplay: Bool
    /// Immer `false` -- kein externer Blocklist-Abgleich angebunden (siehe
    /// api-spec.yaml-Kommentar, gleiches Grenzen-Muster wie
    /// `ipReputationFlag`/`domainReputationScore`).
    let isKnownMalicious: Bool
}

/// Mirrors `components/schemas/MessageDetail` in contracts/api-spec.yaml
/// (Message + bodyText + security, via allOf).
struct MessageDetail: Codable, Identifiable, Hashable {
    let id: String
    let fromAddress: String
    let fromDisplayName: String?
    let subject: String?
    let receivedAt: Date
    let folderId: String
    let classification: Classification
    let bodyText: String?
    /// [2026-09-22] "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies":
    /// bereits serverseitig sanitisiert (kein `<script>`/`<style>`/
    /// `<iframe>`/`<form>`, keine Event-Handler-Attribute), Links bereits
    /// auf `/link-check` umgeschrieben, Remote-Bild-`src` bereits entfernt
    /// falls `blockRemoteImages` aktiv ist (siehe backend/README.md
    /// "HTML-Rendering des Mail-Bodies"). `nil` bei reinen Text-Mails ODER
    /// wenn der Vertrauliche-Modus-Ablauf den Inhalt bereits geloescht hat
    /// (gleiche Bedingung wie bei `bodyText` oben). Wird AUSSCHLIESSLICH per
    /// `WKWebView` mit deaktiviertem JavaScript gerendert
    /// (`Views/MailBodyWebView.swift`) -- niemals als vertrauenswürdiger
    /// nativer `Text`/AttributedString, siehe dort (nicht-verhandelbare
    /// Sicherheitsanforderung, WEB_INBOX.md 22.09.).
    let bodyHtml: String?
    let security: SecurityResult?
    /// Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.): true, wenn die
    /// Nachricht einen syntaktisch gültigen List-Unsubscribe-Header hat
    /// (unabhängig von classification) -- steuert den "Von Absender
    /// abmelden"-Button in MessageDetailView, siehe backend/README.md.
    let canUnsubscribe: Bool
    /// "Erster Kontakt"-Kennzeichnung (WEB_INBOX.md 15.09./19.09.): true,
    /// wenn es für dieses Konto keine andere Nachricht von derselben
    /// `fromAddress` gibt. Kombiniert sich mit `GET /trusted-senders` --
    /// Badge nur zeigen, wenn `isNewSender=true` UND Absender nicht auf der
    /// Whitelist, siehe api-spec.yaml und `MessageDetailView`.
    let isNewSender: Bool
    /// [2026-09-21] siehe `Message.inReplyToMessageId`-Kommentar -- hier
    /// war das Feld schon vorher vorhanden (nur `Message`, die Listenform,
    /// hatte es bisher nicht).
    let inReplyToMessageId: String?
    /// [2026-09-21] siehe `Message.awaitingReply`-Kommentar.
    let awaitingReply: Bool
    /// [2026-09-21] siehe `Message.confidentialUntil`-Kommentar. `nil` bei
    /// `bodyText`, obwohl `confidentialUntil` gesetzt UND in der
    /// Vergangenheit liegt, bedeutet: die Mail war vertraulich und ist
    /// jetzt abgelaufen -- Text wurde serverseitig gelöscht.
    let confidentialUntil: Date?
    /// [2026-09-21] siehe `Message.snoozedUntil`-Kommentar.
    let snoozedUntil: Date?
    /// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan":
    /// Anhänge dieser Nachricht, bereits gescannt (ClamAV + Magic-Bytes-
    /// Prüfung) BEVOR sie hier sichtbar werden. Ein nicht-`clean` Anhang
    /// darf clientseitig NICHT zum Öffnen angeboten werden.
    let attachments: [MessageAttachment]
    /// [2026-09-22] siehe `bodyHtml`-Kommentar -- echte `<a href>`-Links aus
    /// dem HTML-Koerper. Leeres Array bei reinen Text-Mails oder wenn der
    /// HTML-Koerper keine `<a href>`-Tags enthaelt. Aktuell nur als
    /// Datenquelle mitgefuehrt (kein eigenes UI-Element in
    /// `MessageDetailView` -- laut Auftrag "optional/nice-to-have", der
    /// Haupt-Fokus ist sicheres Rendern von `bodyHtml`).
    let links: [MessageLink]

    init(
        id: String, fromAddress: String, fromDisplayName: String?, subject: String?, receivedAt: Date,
        folderId: String, classification: Classification, bodyText: String?, bodyHtml: String? = nil,
        security: SecurityResult?,
        canUnsubscribe: Bool, isNewSender: Bool, inReplyToMessageId: String?,
        awaitingReply: Bool = false, confidentialUntil: Date? = nil, snoozedUntil: Date? = nil,
        attachments: [MessageAttachment] = [], links: [MessageLink] = []
    ) {
        self.id = id
        self.fromAddress = fromAddress
        self.fromDisplayName = fromDisplayName
        self.subject = subject
        self.receivedAt = receivedAt
        self.folderId = folderId
        self.classification = classification
        self.bodyText = bodyText
        self.bodyHtml = bodyHtml
        self.security = security
        self.canUnsubscribe = canUnsubscribe
        self.isNewSender = isNewSender
        self.inReplyToMessageId = inReplyToMessageId
        self.awaitingReply = awaitingReply
        self.confidentialUntil = confidentialUntil
        self.snoozedUntil = snoozedUntil
        self.attachments = attachments
        self.links = links
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        fromAddress = try container.decode(String.self, forKey: .fromAddress)
        fromDisplayName = try container.decodeIfPresent(String.self, forKey: .fromDisplayName)
        subject = try container.decodeIfPresent(String.self, forKey: .subject)
        receivedAt = try container.decode(Date.self, forKey: .receivedAt)
        folderId = try container.decode(String.self, forKey: .folderId)
        classification = try container.decode(Classification.self, forKey: .classification)
        bodyText = try container.decodeIfPresent(String.self, forKey: .bodyText)
        bodyHtml = try container.decodeIfPresent(String.self, forKey: .bodyHtml)
        security = try container.decodeIfPresent(SecurityResult.self, forKey: .security)
        canUnsubscribe = try container.decode(Bool.self, forKey: .canUnsubscribe)
        isNewSender = try container.decode(Bool.self, forKey: .isNewSender)
        inReplyToMessageId = try container.decodeIfPresent(String.self, forKey: .inReplyToMessageId)
        awaitingReply = try container.decodeIfPresent(Bool.self, forKey: .awaitingReply) ?? false
        confidentialUntil = try container.decodeIfPresent(Date.self, forKey: .confidentialUntil)
        snoozedUntil = try container.decodeIfPresent(Date.self, forKey: .snoozedUntil)
        attachments = try container.decodeIfPresent([MessageAttachment].self, forKey: .attachments) ?? []
        links = try container.decodeIfPresent([MessageLink].self, forKey: .links) ?? []
    }

    var asMessage: Message {
        Message(
            id: id,
            fromAddress: fromAddress,
            fromDisplayName: fromDisplayName,
            subject: subject,
            receivedAt: receivedAt,
            folderId: folderId,
            classification: classification,
            inReplyToMessageId: inReplyToMessageId,
            awaitingReply: awaitingReply,
            confidentialUntil: confidentialUntil,
            snoozedUntil: snoozedUntil
        )
    }

    /// Convenience for `MockAPIClient` — returns a copy moved to another
    /// folder (`POST /messages/{messageId}/move` and the quarantine
    /// shortcut both go through this).
    func movedTo(folderId newFolderId: String) -> MessageDetail {
        MessageDetail(
            id: id,
            fromAddress: fromAddress,
            fromDisplayName: fromDisplayName,
            subject: subject,
            receivedAt: receivedAt,
            folderId: newFolderId,
            classification: classification,
            bodyText: bodyText,
            bodyHtml: bodyHtml,
            security: security,
            canUnsubscribe: canUnsubscribe,
            isNewSender: isNewSender,
            inReplyToMessageId: inReplyToMessageId,
            awaitingReply: awaitingReply,
            confidentialUntil: confidentialUntil,
            snoozedUntil: snoozedUntil,
            attachments: attachments,
            links: links
        )
    }

    /// `POST /messages/{messageId}/snooze` — copy with an updated
    /// `snoozedUntil` (used by `MockAPIClient`, mirrors `movedTo(folderId:)`).
    func snoozed(until: Date?) -> MessageDetail {
        MessageDetail(
            id: id, fromAddress: fromAddress, fromDisplayName: fromDisplayName, subject: subject,
            receivedAt: receivedAt, folderId: folderId, classification: classification, bodyText: bodyText,
            bodyHtml: bodyHtml,
            security: security, canUnsubscribe: canUnsubscribe, isNewSender: isNewSender,
            inReplyToMessageId: inReplyToMessageId, awaitingReply: awaitingReply,
            confidentialUntil: confidentialUntil, snoozedUntil: until, attachments: attachments, links: links
        )
    }
}
