import Foundation

/// Mirrors `components/schemas/MailProvider` in contracts/api-spec.yaml,
/// served by `GET /mail-providers` (`contracts/mail-providers.json`).
/// Drives the onboarding provider-picker (WEB_INBOX.md 19.09.
/// "Onboarding: Provider-Auswahlbildschirm").
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

    init(id: String, label: String, authType: AuthType, comingSoon: Bool, imapHost: String?, imapPort: Int?, imapSecure: Bool?, smtpHost: String?, smtpPort: Int?, smtpSecure: Bool?, requiresAppPassword: Bool, appPasswordHelpUrl: String?) {
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
    }

    // `contracts/mail-providers.json` laesst `requiresAppPassword` fuer
    // authType=oauth-Eintraege (gmail/outlook/yahoo) komplett weg statt
    // `false` zu senden (siehe die Datei selbst) -- Standard-Codable-Decoding
    // wuerde das als fehlenden Pflichtschluessel werten und die GESAMTE
    // Provider-Liste verwerfen (ein Decoding-Fehler im Array wirft fuer
    // alle Elemente), nicht nur den betroffenen Eintrag. Das war die
    // tatsaechliche Ursache von WEB_INBOX.md "BUG - iOS erreicht lokales
    // Backend nicht" (21.09.) -- keine ATS-/Netzwerk-Eigenheit wie zunaechst
    // vermutet, siehe ios/README.md.
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
    }
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
        MailProvider(id: "gmail", label: "Gmail", authType: .oauth, comingSoon: false, imapHost: nil, imapPort: nil, imapSecure: nil, smtpHost: nil, smtpPort: nil, smtpSecure: nil, requiresAppPassword: false, appPasswordHelpUrl: nil),
        MailProvider(id: "outlook", label: "Outlook / Microsoft 365", authType: .oauth, comingSoon: true, imapHost: nil, imapPort: nil, imapSecure: nil, smtpHost: nil, smtpPort: nil, smtpSecure: nil, requiresAppPassword: false, appPasswordHelpUrl: nil),
        MailProvider(id: "yahoo", label: "Yahoo", authType: .oauth, comingSoon: true, imapHost: nil, imapPort: nil, imapSecure: nil, smtpHost: nil, smtpPort: nil, smtpSecure: nil, requiresAppPassword: false, appPasswordHelpUrl: nil),
        MailProvider(id: "icloud", label: "iCloud Mail", authType: .imap, comingSoon: false, imapHost: "imap.mail.me.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecure: false, requiresAppPassword: true, appPasswordHelpUrl: "https://support.apple.com/en-us/102654"),
        MailProvider(id: "gmx", label: "GMX", authType: .imap, comingSoon: false, imapHost: "imap.gmx.net", imapPort: 993, imapSecure: true, smtpHost: "mail.gmx.net", smtpPort: 587, smtpSecure: false, requiresAppPassword: true, appPasswordHelpUrl: "https://hilfe.gmx.net"),
        MailProvider(id: "web_de", label: "web.de", authType: .pop3, comingSoon: false, imapHost: "pop3.web.de", imapPort: 995, imapSecure: true, smtpHost: "smtp.web.de", smtpPort: 587, smtpSecure: false, requiresAppPassword: true, appPasswordHelpUrl: "https://hilfe.web.de"),
        MailProvider(id: "other_imap", label: "Anderer Anbieter (IMAP)", authType: .imap, comingSoon: false, imapHost: nil, imapPort: 993, imapSecure: true, smtpHost: nil, smtpPort: 587, smtpSecure: false, requiresAppPassword: false, appPasswordHelpUrl: nil),
    ]
}
