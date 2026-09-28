import Foundation

/// Mirrors `components/schemas/MailProvider` in contracts/api-spec.yaml,
/// served by `GET /mail-providers` (`contracts/mail-providers.json`).
/// Drives the onboarding provider-picker (WEB_INBOX.md 19.09.
/// "Onboarding: Provider-Auswahlbildschirm") and, since 25.09., the
/// domain-matching in `OnboardingAccountConnectView` (WEB_INBOX.md 21.09.
/// "Anbieter automatisch aus E-Mail-Adresse erkennen").
struct MailProvider: Codable, Identifiable, Hashable {
    enum AuthType: String, Codable {
        case oauth
        case imap
        // [2026-09-22] "web.de ist POP3": manche Provider-Presets nutzen
        // POP3 statt IMAP -- automatisch vorbefuellt, User wird dafuer
        // NICHT gefragt (Massimo: "das sind ja keine Geheimnisse, nur bei
        // unbekannten Mailservern abfragen"). Gleiche imap*/smtp*-Felder
        // wie authType=.imap, siehe contracts/api-spec.yaml MailProvider.
        case pop3
    }

    let id: String
    let label: String
    let authType: AuthType
    let comingSoon: Bool
    let imapHost: String?
    let imapPort: Int?
    let imapSecure: Bool?
    let smtpHost: String?
    let smtpPort: Int?
    let smtpSecure: Bool?
    let requiresAppPassword: Bool
    let appPasswordHelpUrl: String?
    /// [2026-09-25] Kleinbuchstaben-Domains ohne "@", die dieser Provider
    /// abdeckt (siehe contracts/mail-providers.json). `other_imap` hat
    /// bewusst eine leere Liste -- das ist der Fallback fuer jede nicht
    /// erkannte Domain, kein eigenes Matching noetig/moeglich.
    let domains: [String]
    /// [2026-09-28] Kurzer Einrichtungshinweis (z.B. "IMAP in den
    /// Einstellungen erlauben"), `nil` = keiner.
    let setupHint: String?
    /// [2026-09-28] Schritt-fuer-Schritt-Anleitung in der Geraetesprache
    /// (der Server waehlt sie per Accept-Language, siehe RemoteAPIClient),
    /// leer = keine. `setupLinkLabel` beschriftet `appPasswordHelpUrl`.
    let setupSteps: [String]
    let setupLinkLabel: String?
    /// [2026-09-28] Vom Server gesetzt: OAuth auf diesem Server eingerichtet.
    /// Auf iOS ohne Bedeutung (OAuth-Rücksprung zeigt auf den Web-Client),
    /// hier nur mitgelesen.
    let oauthAvailable: Bool

    init(id: String, label: String, authType: AuthType, comingSoon: Bool, imapHost: String?, imapPort: Int?, imapSecure: Bool?, smtpHost: String?, smtpPort: Int?, smtpSecure: Bool?, requiresAppPassword: Bool, appPasswordHelpUrl: String?, domains: [String] = [], setupHint: String? = nil, setupSteps: [String] = [], setupLinkLabel: String? = nil, oauthAvailable: Bool = false) {
        self.id = id
        self.label = label
        self.authType = authType
        self.comingSoon = comingSoon
        self.imapHost = imapHost
        self.imapPort = imapPort
        self.imapSecure = imapSecure
        self.smtpHost = smtpHost
        self.smtpPort = smtpPort
        self.smtpSecure = smtpSecure
        self.requiresAppPassword = requiresAppPassword
        self.appPasswordHelpUrl = appPasswordHelpUrl
        self.domains = domains
        self.setupHint = setupHint
        self.setupSteps = setupSteps
        self.setupLinkLabel = setupLinkLabel
        self.oauthAvailable = oauthAvailable
    }

    // `contracts/mail-providers.json` laesst `requiresAppPassword` fuer
    // authType=oauth-Eintraege (gmail/outlook/yahoo) komplett weg statt
    // `false` zu senden (siehe die Datei selbst) -- Standard-Codable-Decoding
    // wuerde das als fehlenden Pflichtschluessel werten und die GESAMTE
    // Provider-Liste verwerfen (ein Decoding-Fehler im Array wirft fuer
    // alle Elemente), nicht nur den betroffenen Eintrag. Das war die
    // tatsaechliche Ursache von WEB_INBOX.md "BUG - iOS erreicht lokales
    // Backend nicht" (21.09.) -- keine ATS-/Netzwerk-Eigenheit wie zunaechst
    // vermutet, siehe ios/README.md. `domains` (neu 25.09.) bekommt aus
    // demselben Grund vorsorglich dieselbe decodeIfPresent-Behandlung,
    // auch wenn die aktuelle Contract-Datei es fuer jeden Eintrag mitgibt.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        label = try container.decode(String.self, forKey: .label)
        authType = try container.decode(AuthType.self, forKey: .authType)
        comingSoon = try container.decode(Bool.self, forKey: .comingSoon)
        imapHost = try container.decodeIfPresent(String.self, forKey: .imapHost)
        imapPort = try container.decodeIfPresent(Int.self, forKey: .imapPort)
        imapSecure = try container.decodeIfPresent(Bool.self, forKey: .imapSecure)
        smtpHost = try container.decodeIfPresent(String.self, forKey: .smtpHost)
        smtpPort = try container.decodeIfPresent(Int.self, forKey: .smtpPort)
        smtpSecure = try container.decodeIfPresent(Bool.self, forKey: .smtpSecure)
        requiresAppPassword = try container.decodeIfPresent(Bool.self, forKey: .requiresAppPassword) ?? false
        appPasswordHelpUrl = try container.decodeIfPresent(String.self, forKey: .appPasswordHelpUrl)
        domains = try container.decodeIfPresent([String].self, forKey: .domains) ?? []
        setupHint = try container.decodeIfPresent(String.self, forKey: .setupHint)
        setupSteps = try container.decodeIfPresent([String].self, forKey: .setupSteps) ?? []
        setupLinkLabel = try container.decodeIfPresent(String.self, forKey: .setupLinkLabel)
        oauthAvailable = try container.decodeIfPresent(Bool.self, forKey: .oauthAvailable) ?? false
    }

    /// [2026-09-28] OAuth-Anbieter mit IMAP-Presets (Gmail) als IMAP-Anbieter
    /// mit App-Passwort -- auf iOS der einzige Weg für Gmail.
    var asImapFallback: MailProvider {
        MailProvider(id: id, label: label, authType: authType == .oauth ? .imap : authType, comingSoon: comingSoon, imapHost: imapHost, imapPort: imapPort, imapSecure: imapSecure, smtpHost: smtpHost, smtpPort: smtpPort, smtpSecure: smtpSecure, requiresAppPassword: authType == .oauth ? true : requiresAppPassword, appPasswordHelpUrl: appPasswordHelpUrl, domains: domains, setupHint: setupHint, setupSteps: setupSteps, setupLinkLabel: setupLinkLabel)
    }

    /// Nutzbar ohne OAuth: eigener IMAP/POP3-Weg oder OAuth mit IMAP-Presets.
    var usableWithPassword: Bool {
        !comingSoon && (authType != .oauth || imapHost != nil)
    }

    /// [2026-09-28] Ergebnis von `GET /mail-providers/discover` als
    /// Formular-Preset (Label = Domain).
    static func discovered(domain: String, settings d: DiscoveredMailSettings) -> MailProvider {
        MailProvider(id: "discovered", label: domain, authType: d.protocol == "pop3" ? .pop3 : .imap, comingSoon: false, imapHost: d.imapHost, imapPort: d.imapPort, imapSecure: d.imapSecure, smtpHost: d.smtpHost, smtpPort: d.smtpPort, smtpSecure: d.smtpSecure, requiresAppPassword: false, appPasswordHelpUrl: nil, domains: [], setupHint: "Die Servereinstellungen wurden automatisch erkannt. Falls dein Anbieter ein App-Passwort verlangt, verwende dieses statt deines normalen Passworts.")
    }
}

/// [2026-09-28] Antwort von `GET /mail-providers/discover` (api-spec.yaml
/// `DiscoveredMailSettings`).
struct DiscoveredMailSettings: Decodable {
    let found: Bool
    let providerId: String?
    let `protocol`: String?
    let imapHost: String?
    let imapPort: Int?
    let imapSecure: Bool?
    let smtpHost: String?
    let smtpPort: Int?
    let smtpSecure: Bool?
    /// "localpart": Anmeldename ist nur der Teil vor dem "@".
    let username: String?
}

extension MailProvider {
    /// Hand-maintained mirror of `contracts/mail-providers.json`, same
    /// convention as `DesignTokens.swift` for `design-tokens.json` — used
    /// by `MockAPIClient` (no bundled copy of the JSON contract file today)
    /// and as `OnboardingAccountConnectView`'s fallback if `GET
    /// /mail-providers` fails against a real backend. If
    /// `contracts/mail-providers.json` changes, update this to match and
    /// note it in `SYNC.md` under "Contract-Änderungen".
    static let mocked: [MailProvider] = [
        MailProvider(id: "gmail", label: "Gmail", authType: .oauth, comingSoon: false, imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 587, smtpSecure: false, requiresAppPassword: true, appPasswordHelpUrl: "https://support.google.com/accounts/answer/185833", domains: ["gmail.com", "googlemail.com"], setupHint: "Gmail braucht ein App-Passwort: In deinem Google-Konto die Bestätigung in zwei Schritten einschalten und dann unter „App-Passwörter“ eines für driftmail erstellen. Dein normales Google-Passwort funktioniert hier nicht."),
        MailProvider(id: "outlook", label: "Outlook / Microsoft 365", authType: .oauth, comingSoon: true, imapHost: nil, imapPort: nil, imapSecure: nil, smtpHost: nil, smtpPort: nil, smtpSecure: nil, requiresAppPassword: false, appPasswordHelpUrl: nil, domains: ["outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de", "msn.com"], setupHint: "Microsoft erlaubt für Outlook.com und Hotmail keine Anmeldung per Passwort mehr, nur noch über eine eigene Microsoft-Anmeldung. Die ist in driftmail noch nicht eingerichtet."),
        MailProvider(id: "icloud", label: "iCloud Mail", authType: .imap, comingSoon: false, imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false, requiresAppPassword: true, appPasswordHelpUrl: "https://support.apple.com/en-us/102654", domains: ["icloud.com", "me.com", "mac.com"], setupHint: "iCloud braucht ein app-spezifisches Passwort: Auf account.apple.com unter „Anmelden und Sicherheit“ → „App-spezifische Passwörter“ eines erstellen."),
        MailProvider(id: "gmx", label: "GMX", authType: .imap, comingSoon: false, imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.net", smtpPort: 587, smtpSecure: false, requiresAppPassword: false, appPasswordHelpUrl: "https://hilfe.gmx.net", domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch"], setupHint: "Einmalig in GMX unter Einstellungen → „POP3/IMAP Abruf“ den Zugriff über IMAP erlauben. Dann dein GMX-Passwort (bei Zwei-Faktor-Schutz ein App-Passwort) verwenden."),
        MailProvider(id: "web_de", label: "web.de", authType: .imap, comingSoon: false, imapHost: "imap.web.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.web.de", smtpPort: 587, smtpSecure: false, requiresAppPassword: false, appPasswordHelpUrl: "https://hilfe.web.de", domains: ["web.de"], setupHint: "Einmalig in web.de unter Einstellungen → „POP3/IMAP Abruf“ den Zugriff erlauben. Dann dein normales web.de-Passwort verwenden."),
        MailProvider(id: "yahoo", label: "Yahoo", authType: .imap, comingSoon: false, imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecure: true, requiresAppPassword: true, appPasswordHelpUrl: "https://help.yahoo.com/kb/SLN15241.html", domains: ["yahoo.com", "yahoo.de", "ymail.com", "rocketmail.com"], setupHint: "Yahoo braucht ein App-Passwort: In den Yahoo-Kontoeinstellungen unter „Kontosicherheit“ → „App-Passwort generieren“ eines für driftmail erstellen."),
        MailProvider(id: "t_online", label: "T-Online", authType: .imap, comingSoon: false, imapHost: "secureimap.t-online.de", imapPort: 993, imapSecure: true, smtpHost: "securesmtp.t-online.de", smtpPort: 465, smtpSecure: true, requiresAppPassword: false, appPasswordHelpUrl: "https://www.telekom.de/hilfe/festnetz-internet-tv/e-mail/e-mail-passwort", domains: ["t-online.de", "magenta.de"], setupHint: "T-Online braucht dein E-Mail-Passwort, nicht das Passwort deines Telekom-Logins. Du legst es im Telekom Kundencenter unter „E-Mail-Passwort“ fest."),
        MailProvider(id: "freenet", label: "freenet", authType: .imap, comingSoon: false, imapHost: "mx.freenet.de", imapPort: 993, imapSecure: true, smtpHost: "mx.freenet.de", smtpPort: 587, smtpSecure: false, requiresAppPassword: false, appPasswordHelpUrl: nil, domains: ["freenet.de"], setupHint: "Einmalig in freenet Mail unter Einstellungen den Abruf per IMAP/POP3 aktivieren, dann dein freenet-Passwort verwenden."),
        MailProvider(id: "ionos", label: "IONOS / 1&1", authType: .imap, comingSoon: false, imapHost: "imap.ionos.de", imapPort: 993, imapSecure: true, smtpHost: "smtp.ionos.de", smtpPort: 587, smtpSecure: false, requiresAppPassword: false, appPasswordHelpUrl: nil, domains: ["online.de", "onlinehome.de", "1und1.de"], setupHint: "Dein normales Passwort des E-Mail-Postfachs (nicht das Passwort des IONOS-Kundenkontos)."),
        MailProvider(id: "posteo", label: "Posteo", authType: .imap, comingSoon: false, imapHost: "posteo.de", imapPort: 993, imapSecure: true, smtpHost: "posteo.de", smtpPort: 587, smtpSecure: false, requiresAppPassword: false, appPasswordHelpUrl: nil, domains: ["posteo.de", "posteo.net", "posteo.at", "posteo.ch", "posteo.eu", "posteo.org", "posteo.me", "posteo.uk", "posteo.us", "posteo.nl", "posteo.be", "posteo.dk", "posteo.es", "posteo.fi", "posteo.fr", "posteo.it", "posteo.jp", "posteo.se", "posteo.cl", "posteo.com.br", "posteo.co", "posteo.mx"], setupHint: "Dein normales Posteo-Passwort."),
        MailProvider(id: "mailbox_org", label: "mailbox.org", authType: .imap, comingSoon: false, imapHost: "imap.mailbox.org", imapPort: 993, imapSecure: true, smtpHost: "smtp.mailbox.org", smtpPort: 465, smtpSecure: true, requiresAppPassword: false, appPasswordHelpUrl: nil, domains: ["mailbox.org"], setupHint: "Dein normales mailbox.org-Passwort (bei Zwei-Faktor-Schutz ein App-Passwort)."),
        MailProvider(id: "aol", label: "AOL", authType: .imap, comingSoon: false, imapHost: "imap.aol.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.aol.com", smtpPort: 465, smtpSecure: true, requiresAppPassword: true, appPasswordHelpUrl: "https://help.aol.com/articles/Create-and-manage-app-password", domains: ["aol.com", "aol.de"], setupHint: "AOL braucht ein App-Passwort: In den AOL-Kontoeinstellungen unter „Kontosicherheit“ eines für driftmail erstellen."),
        MailProvider(id: "other_imap", label: "Anderer Anbieter (IMAP)", authType: .imap, comingSoon: false, imapHost: nil, imapPort: 993, imapSecure: true, smtpHost: nil, smtpPort: 587, smtpSecure: false, requiresAppPassword: false, appPasswordHelpUrl: nil, domains: [], setupHint: nil),
    ]
}
